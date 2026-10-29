/**
 * Sprint 9O record / replay of real Qloo responses for the competence evaluation (evaluation code, not runtime).
 *
 * RecordingProvider wraps the live provider and keeps every call's operation, input and result, so a live run can be
 * replayed offline later. ReplayProvider serves those recorded results to a new engine or model:
 *   - an identical call (same operation and canonical input) returns the recorded result, correlation id included;
 *   - a call never recorded returns a FAILED call (NOT_RECORDED). A failed call is never evidence (AGENTS.md), so a
 *     replay can lose evidence but never invent it; misses are counted and reported as coverage.
 * Replay mode is "scripted", so results are labelled synthetic, never live.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { AgentToolProvider, QlooCallResult } from "../../src/agent/tool-provider.js";
import type { QlooOperation, QlooOperationInput } from "../../src/qloo/types.js";

export const CASSETTE_SCHEMA = "ce-qloo-cassette/1" as const;
export type CassetteEntry = { operation: QlooOperation; key: string; input: unknown; result: QlooCallResult; recordedAt: string };
export type Cassette = { schema: typeof CASSETTE_SCHEMA; caseId: string; recordedWith: { engineRevision: string; model: string }; entries: CassetteEntry[] };

/** Canonical JSON: object keys sorted at every level, so equal inputs give equal keys. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as object).sort().filter((k) => (value as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
export const callKey = (operation: string, input: unknown) => `${operation} ${canonical(input)}`;

export class RecordingProvider implements AgentToolProvider {
  readonly name: string;
  readonly mode: "live" | "scripted";
  readonly evidenceSource: string;
  readonly entries: CassetteEntry[] = [];
  constructor(private readonly inner: AgentToolProvider) {
    this.name = `recording:${inner.name}`;
    this.mode = inner.mode;
    this.evidenceSource = inner.evidenceSource;
  }
  async call<O extends QlooOperation>(operation: O, input: QlooOperationInput[O], options?: { maxRetries?: number }): Promise<QlooCallResult> {
    const result = await this.inner.call(operation, input, options);
    this.entries.push({ operation, key: callKey(operation, input), input: structuredClone(input), result: structuredClone(result), recordedAt: new Date().toISOString() });
    return result;
  }
  close(): void {
    this.inner.close?.();
  }
}

export class ReplayProvider implements AgentToolProvider {
  readonly name: string;
  readonly mode = "scripted" as const;
  readonly evidenceSource = "recorded-live-replay";
  readonly misses: { operation: string; key: string }[] = [];
  hits = 0;
  private readonly byKey = new Map<string, CassetteEntry>();
  constructor(cassettes: readonly Cassette[]) {
    this.name = `replay:${cassettes.map((c) => c.caseId).join("+")}`;
    // The first recording of a call wins; failed recordings are never served (they were not evidence either).
    for (const c of cassettes) for (const e of c.entries) if (e.result.outcome !== "failed" && !this.byKey.has(e.key)) this.byKey.set(e.key, e);
  }
  async call<O extends QlooOperation>(operation: O, input: QlooOperationInput[O]): Promise<QlooCallResult> {
    const key = callKey(operation, input);
    const entry = this.byKey.get(key);
    const callMeta = { operationId: `replay-${this.hits + this.misses.length + 1}`, spacingMs: 0, rateLimitMs: 0, startupMs: 0 };
    if (!entry) {
      this.misses.push({ operation, key });
      return { outcome: "failed", code: "NOT_RECORDED", retryable: false, detail: `no recorded Qloo response for this ${operation} call`, attempts: 1, callMeta };
    }
    this.hits += 1;
    return { ...structuredClone(entry.result), callMeta } as QlooCallResult;
  }
}

export function writeCassette(path: string, cassette: Cassette): void {
  writeFileSync(path, `${JSON.stringify(cassette)}\n`);
}
export function readCassette(path: string): Cassette {
  const value = JSON.parse(readFileSync(path, "utf8")) as Cassette;
  if (value.schema !== CASSETTE_SCHEMA) throw new Error(`${path}: not a ${CASSETTE_SCHEMA} cassette`);
  return value;
}

/**
 * Matched live comparison: a call already recorded for this case is served from the recording (no Qloo call), any
 * other call goes live and is recorded. Two engines run on the same case therefore see identical Qloo answers for the
 * calls they share. Live calls stop at `maxLiveCalls` (a refused call is a FAILED call, never evidence).
 */
export class CachingRecorder implements AgentToolProvider {
  readonly name: string;
  readonly mode: "live" | "scripted";
  readonly evidenceSource: string;
  liveCalls = 0;
  cacheHits = 0;
  private readonly byKey = new Map<string, CassetteEntry>();
  constructor(
    private readonly inner: AgentToolProvider,
    readonly cassette: Cassette,
    private readonly budget: { maxLiveCalls: number; used: () => number; onLive: (dispatches: number) => void },
  ) {
    this.name = `caching:${inner.name}`;
    this.mode = inner.mode;
    this.evidenceSource = inner.evidenceSource;
    for (const e of cassette.entries) if (e.result.outcome !== "failed" && !this.byKey.has(e.key)) this.byKey.set(e.key, e);
  }
  async call<O extends QlooOperation>(operation: O, input: QlooOperationInput[O], options?: { maxRetries?: number }): Promise<QlooCallResult> {
    const key = callKey(operation, input);
    const hit = this.byKey.get(key);
    if (hit) {
      this.cacheHits += 1;
      return structuredClone(hit.result);
    }
    const callMeta = { operationId: `cap-${this.liveCalls + 1}`, spacingMs: 0, rateLimitMs: 0, startupMs: 0 };
    if (this.budget.used() >= this.budget.maxLiveCalls) return { outcome: "failed", code: "EVAL_QLOO_CAP", retryable: false, detail: "the approved live Qloo allowance for this evaluation is spent", attempts: 0, callMeta };
    this.liveCalls += 1;
    const result = await this.inner.call(operation, input, options);
    // Charged by provider dispatches (a retryable error may be retried once).
    this.budget.onLive(Math.max(1, result.attempts));
    const entry: CassetteEntry = { operation, key, input: structuredClone(input), result: structuredClone(result), recordedAt: new Date().toISOString() };
    this.cassette.entries.push(entry);
    if (result.outcome !== "failed") this.byKey.set(key, entry);
    return result;
  }
}
