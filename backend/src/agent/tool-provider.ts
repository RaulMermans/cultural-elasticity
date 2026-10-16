/**
 * AgentToolProvider: the agent's only route to Qloo.
 *
 *   Agent → tool registry → AgentToolProvider → QlooTransport → `qloo mcp` (live) | synthetic world (scripted)
 *
 * The provider applies the AGENTS.md status policy once, for every Qloo-facing tool:
 *   - needs_input is returned as needs_input (never silently continued);
 *   - partial and degraded are flagged;
 *   - error is retried at most once, and only when Qloo marks it retryable;
 *   - QLOO_AUTH is never retried.
 * It never interprets results; the tools and the deterministic planner do that.
 */
import type { Limitation } from "../evidence/schema.js";
import { QlooContractError, QlooError } from "../qloo/errors.js";
import { liveCall, QLOO_LIVE_SOURCE, type LiveCall } from "../qloo/live-adapter.js";
import { toResolutionIssues, type ResolutionIssue } from "../qloo/normalize.js";
import type { QlooTransport } from "../qloo/transport.js";
import type { QlooOperation, QlooOperationInput } from "../qloo/types.js";

/** Provenance source for the scripted synthetic world (shared with the Sprint 1 synthetic fixtures). */
export const SYNTHETIC_SOURCE = "synthetic-fixture";

export type QlooCallResult =
  | { outcome: "ok" | "empty"; call: LiveCall; attempts: number; flags: Limitation[] }
  | { outcome: "needs_input"; call: LiveCall; issues: ResolutionIssue[]; attempts: number; flags: Limitation[] }
  | { outcome: "failed"; code: string; retryable: boolean; detail: string; attempts: number; correlationId?: string };

export interface AgentToolProvider {
  readonly name: string;
  /** "live" = real Qloo through the hackathon API; "scripted" = deterministic synthetic world. */
  readonly mode: "live" | "scripted";
  readonly evidenceSource: string;
  /** `maxRetries` caps automatic retries for this call (the runtime lowers it to stay within budget). */
  call<O extends QlooOperation>(operation: O, input: QlooOperationInput[O], options?: { maxRetries?: number }): Promise<QlooCallResult>;
  close?(): void;
}

export type QlooToolProviderOptions = {
  name: string;
  mode: "live" | "scripted";
  evidenceSource?: string;
  /** Minimum spacing between upstream calls ([live] 7 s avoided rate limits in Sprint 2). */
  spacingMs: number;
  rateLimitWaitMs?: number;
  maxRetries?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

export class QlooToolProvider implements AgentToolProvider {
  readonly name: string;
  readonly mode: "live" | "scripted";
  readonly evidenceSource: string;
  private lastCall = 0;

  constructor(
    private readonly transport: QlooTransport,
    private readonly options: QlooToolProviderOptions,
  ) {
    this.name = options.name;
    this.mode = options.mode;
    this.evidenceSource = options.evidenceSource ?? QLOO_LIVE_SOURCE;
  }

  private sleep(ms: number) {
    return (this.options.sleep ?? ((t: number) => new Promise<void>((resolve) => setTimeout(resolve, t))))(ms);
  }

  async call<O extends QlooOperation>(operation: O, input: QlooOperationInput[O], callOptions: { maxRetries?: number } = {}): Promise<QlooCallResult> {
    const maxRetries = Math.min(this.options.maxRetries ?? 1, callOptions.maxRetries ?? 1);
    for (let attempt = 1; ; attempt += 1) {
      const wait = this.lastCall + this.options.spacingMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.lastCall = Date.now();
      const capturedAt = (this.options.now ?? (() => new Date()))().toISOString();
      let call: LiveCall | undefined;
      let failure: { code: string; retryable: boolean; detail: string; correlationId?: string } | undefined;
      try {
        const result = await this.transport.execute(operation, input);
        if (result.kind === "failure") {
          failure = { code: result.failure.code, retryable: result.failure.retryable, detail: result.failure.recovery, ...(result.failure.correlationId && { correlationId: result.failure.correlationId }) };
        } else {
          call = { ...liveCall(operation, result.raw, capturedAt), source: this.evidenceSource };
          const error = call.envelope.status === "error" ? call.envelope.error : undefined;
          if (error) failure = { code: error.code, retryable: error.retryable, detail: error.recovery, correlationId: call.envelope.execution.correlation_id };
        }
      } catch (error) {
        if (error instanceof QlooContractError) return { outcome: "failed", code: "QLOO_CONTRACT", retryable: false, detail: error.message, attempts: attempt };
        if (error instanceof QlooError) return { outcome: "failed", code: "QLOO_TRANSPORT", retryable: false, detail: error.message, attempts: attempt };
        throw error;
      }

      if (failure) {
        if (failure.code !== "QLOO_AUTH" && failure.retryable && attempt <= maxRetries) {
          if (failure.code === "QLOO_RATE_LIMIT") await this.sleep(this.options.rateLimitWaitMs ?? 60_000);
          continue;
        }
        return { outcome: "failed", ...failure, attempts: attempt };
      }

      const ok = call as LiveCall;
      const flags: Limitation[] = [];
      const status = ok.envelope.status;
      if (status === "partial" || status === "degraded") {
        flags.push({ code: `QLOO_${status.toUpperCase()}`, detail: `${operation} ${ok.envelope.execution.correlation_id}: Qloo marked this result ${status} (${(ok.envelope.warnings ?? []).join("; ") || "no detail"})` });
      }
      if (status === "needs_input") return { outcome: "needs_input", call: ok, issues: toResolutionIssues(operation, ok.envelope), attempts: attempt, flags };
      const empty = status === "empty" || (Array.isArray(ok.envelope.results) && ok.envelope.results.length === 0);
      return { outcome: empty ? "empty" : "ok", call: ok, attempts: attempt, flags };
    }
  }

  close(): void {
    (this.transport as { close?: () => void }).close?.();
  }
}
