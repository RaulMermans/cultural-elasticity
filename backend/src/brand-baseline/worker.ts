import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { HarnessQlooClient, type QlooClient } from "../qloo/client.js";
import { harnessChildEnv, LIVE_QLOO_HOST_VERIFIED, requireHackathonBaseUrl, verifyHarnessHost } from "../qloo/environment.js";
import { HarnessMcpTransport } from "../qloo/mcp-transport.js";
import { parseEnvelope } from "../qloo/normalize.js";
import { defaultHarnessBinPath, type QlooTransport, type TransportResult } from "../qloo/transport.js";
import { DEFAULT_QLOO_SPACING_MS } from "../config/production.js";
import { QlooWorkflowError, QlooContractError } from "../qloo/errors.js";
import { BASELINE_DOMAINS, BASELINE_ENTITY_TAKE, BASELINE_TAG_TAKE, buildBaselineResult, type BaselineObservation } from "./research.js";
import { BaselineRepository, BaselineRepositoryError } from "./repository.js";

type Scope = { scanId: string; owner: string; stage: string } | { resolutionId: string };

/** Shared clock serializes all baseline dispatches, including identity resolution. */
export class BaselineCallGate {
  private nextAt = 0;
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly repository: BaselineRepository, private readonly transport: QlooTransport, private readonly spacingMs: number = DEFAULT_QLOO_SPACING_MS) {
    if (!Number.isFinite(spacingMs) || spacingMs < DEFAULT_QLOO_SPACING_MS) throw new Error("BASELINE_QLOO_SPACING_UNSAFE");
  }

  scoped(scope: Scope): QlooClient {
    let attempt = 0;
    const wrapper: QlooTransport = {
      name: `baseline-${this.transport.name}`,
      execute: async (operation, input) => {
        const previous = this.queue;
        let release: () => void = () => undefined;
        this.queue = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        try {
          const wait = this.nextAt - Date.now();
          if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait));
          attempt += 1;
          const callId = "resolutionId" in scope
            ? await this.repository.reserveResolutionCall(scope.resolutionId, attempt)
            : await this.repository.reserveCall(scope.scanId, scope.owner, scope.stage, operation as "describe" | "entity_tags" | "recommend", attempt);
          this.nextAt = Date.now() + this.spacingMs;
          const started = performance.now();
          try {
            const response: TransportResult = await this.transport.execute(operation, input);
            let correlationId: string | undefined;
            let category = response.kind === "failure" ? response.failure.code : "ok";
            if (response.kind === "result") {
              try {
                const envelope = parseEnvelope(operation, response.raw);
                correlationId = envelope.execution.correlation_id;
                category = envelope.status;
              } catch { category = "CONTRACT_DRIFT"; }
            } else correlationId = response.failure.correlationId;
            await this.repository.settleCall(callId, { status: response.kind === "failure" || category === "error" || category === "CONTRACT_DRIFT" ? "FAILED" : "COMPLETE", correlationId, category, durationMs: performance.now() - started });
            return response;
          } catch (error) {
            await this.repository.settleCall(callId, { status: "UNKNOWN", category: "DISPATCH_OUTCOME_UNKNOWN", durationMs: performance.now() - started }).catch(() => undefined);
            throw error;
          }
        } finally {
          release();
        }
      },
    };
    return new HarnessQlooClient(wrapper);
  }

  close(): void { (this.transport as { close?: () => void }).close?.(); }
}

export function createLiveBaselineCallGate(repository: BaselineRepository, env: NodeJS.ProcessEnv = process.env): BaselineCallGate {
  if (!env.QLOO_API_KEY?.trim()) throw new Error("QLOO_NOT_CONFIGURED");
  const origin = requireHackathonBaseUrl(env.QLOO_API_BASE_URL);
  const childEnv = harnessChildEnv(env, origin);
  const verified = verifyHarnessHost(defaultHarnessBinPath(), childEnv, origin);
  if (verified.status !== LIVE_QLOO_HOST_VERIFIED) throw new Error("QLOO_HOST_NOT_VERIFIED");
  const spacing = Number(env.QLOO_CALL_SPACING_MS ?? DEFAULT_QLOO_SPACING_MS);
  return new BaselineCallGate(repository, new HarnessMcpTransport({ env: childEnv, timeoutMs: 90_000 }), spacing);
}

export class BaselineWorker {
  readonly owner = randomUUID();
  private timer: NodeJS.Timeout | undefined;
  private busy = false;
  constructor(private readonly repository: BaselineRepository, private readonly calls: BaselineCallGate, private readonly source: "live" | "recorded" = "live") {}

  async start(): Promise<void> {
    await this.repository.recoverStale();
    this.timer = setInterval(() => { void this.tick(); }, 1500);
    this.timer.unref();
    void this.tick();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.calls.close(); }

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const next = await this.repository.nextQueued();
      if (next) await this.run(next);
    } finally {
      this.busy = false;
    }
  }

  async run(scanId: string): Promise<void> {
    if (!(await this.repository.claim(scanId, this.owner))) return;
    const brand = await this.repository.scanBrand(scanId);
    if (!brand) { await this.repository.fail(scanId, this.owner, "FAILED", "BRAND_MISSING"); return; }
    const startedAt = new Date().toISOString();
    const observations: BaselineObservation[] = [];
    const incomplete: string[] = [];
    let exhausted = false;
    const heartbeat = setInterval(() => { void this.repository.heartbeat(scanId, this.owner); }, 30_000);
    heartbeat.unref();
    try {
      const stages = ["tags", ...BASELINE_DOMAINS];
      for (const stage of stages) {
        await this.repository.stage(scanId, this.owner, stage, "RUNNING");
        const client = this.calls.scoped({ scanId, owner: this.owner, stage });
        try {
          const outcome = stage === "tags"
            ? await client.entityTags({ entities: [brand.qlooId], entity_type: "brand", limit: BASELINE_TAG_TAKE })
            : await client.recommend({ signals: [brand.qlooId], target_type: stage as (typeof BASELINE_DOMAINS)[number], limit: BASELINE_ENTITY_TAKE });
          const observation = { domain: stage as BaselineObservation["domain"], outcome, capturedAt: new Date().toISOString() } as BaselineObservation;
          await this.repository.recordObservation(scanId, this.owner, observation);
          observations.push(observation);
        } catch (error) {
          const code = error instanceof BaselineRepositoryError ? error.code : "QLOO_STAGE_FAILED";
          await this.repository.stage(scanId, this.owner, stage, "FAILED", { code });
          incomplete.push(stage);
          if (error instanceof QlooContractError) {
            await this.repository.fail(scanId, this.owner, "INTERRUPTED", "CONTRACT_DRIFT");
            return;
          }
          if (code === "GLOBAL_CALL_LIMIT_EXHAUSTED" || code === "SCAN_CALL_LIMIT_EXHAUSTED") {
            exhausted = true;
            for (const skipped of stages.slice(stages.indexOf(stage) + 1)) {
              await this.repository.stage(scanId, this.owner, skipped, "SKIPPED", { code: "CALL_BUDGET_EXHAUSTED" });
              incomplete.push(skipped);
            }
            break;
          }
          // A transport timeout may have reached Qloo. Stop; restart recovery never replays it.
          if (code === "QLOO_STAGE_FAILED" && !(error instanceof QlooWorkflowError) && !(error instanceof QlooContractError)) {
            await this.repository.fail(scanId, this.owner, "INTERRUPTED", "PROVIDER_OUTCOME_UNCERTAIN");
            return;
          }
        }
        if (!(await this.repository.heartbeat(scanId, this.owner))) throw new BaselineRepositoryError("LEASE_LOST");
      }
      const count = await this.repository.pool.query<{ provider_call_count: number }>("SELECT provider_call_count FROM baseline_scans WHERE id=$1", [scanId]);
      const result = buildBaselineResult({
        scanId, brandId: brand.id,
        brand: { kind: "entity", input: brand.name, label: brand.name, qlooId: brand.qlooId, type: "urn:entity:brand", confirmation: "unambiguous", alternatives: [], provenance: [{ operation: "describe", correlationId: brand.correlationId, status: "ok", warnings: [], degraded: false, partial: false }] },
        brandCapturedAt: brand.capturedAt,
        observations, startedAt, finishedAt: new Date().toISOString(), providerCallCount: count.rows[0]?.provider_call_count ?? 0,
        recordedOrLive: this.source, incompleteStages: incomplete,
        budgetStatus: exhausted ? "EXHAUSTED" : "WITHIN_LIMIT",
      });
      await this.repository.stage(scanId, this.owner, "validation", "COMPLETE", { status: result.scanStatus });
      await this.repository.complete(scanId, this.owner, result);
    } catch (error) {
      const code = error instanceof BaselineRepositoryError ? error.code : error instanceof ZodError ? "RESULT_VALIDATION_FAILED" : "WORKER_FAILURE";
      await this.repository.fail(scanId, this.owner, "INTERRUPTED", code).catch(() => undefined);
    } finally {
      clearInterval(heartbeat);
    }
  }
}
