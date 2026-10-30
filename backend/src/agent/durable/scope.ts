/**
 * Sprint 10C: the durable execution scope of one job attempt, carried by AsyncLocalStorage so the shared tool provider,
 * the model and the interpreter journal their calls without threading a parameter through the runtime.
 *
 * Journal protocol (one row per logical provider operation, `agent_provider_calls`):
 *
 *   opKey = <provider>:<sha256(operation + canonical request)>:<occurrence>
 *
 *   no row / RESERVED / UNKNOWN_ACCEPTED ─→ reserve (fenced) ─→ DISPATCHING (fenced, just before the request leaves)
 *                                         ─→ provider answers ─→ COMPLETED | FAILED with the answer (fenced) ─→ runtime
 *   COMPLETED | FAILED                   ─→ the committed answer is returned; nothing is sent again
 *   DISPATCHING | OUTCOME_UNKNOWN        ─→ OutcomeUnknownError: the request may have reached the provider and been
 *                                           charged; it is never sent again without an operator decision
 *
 * The key depends on the request and how many identical requests the job made before, never on timing or call order,
 * so a deterministic replay of a job reaches the same rows. A replay that stops matching committed rows (divergence)
 * is refused before anything new is sent.
 *
 * Without a scope (tests, scripts, the in-memory deployment) every function here is a pass-through.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { LeaseLostError, type CallProvider, type DurableAgentStore, type Lease } from "./store.js";
import type { CheckpointBoundary } from "./checkpoint.js";
import type { AgentRunState } from "../state.js";

export class OutcomeUnknownError extends Error {
  constructor(readonly opKey: string) {
    super(`OUTCOME_UNKNOWN: provider operation ${opKey} may have been dispatched; it is not repeated without authorization`);
    this.name = "OutcomeUnknownError";
  }
}

export class ReplayDivergedError extends Error {
  constructor(readonly opKey: string, readonly unconsumed: number) {
    super(`REPLAY_DIVERGED: the recovered job requested ${opKey} while ${unconsumed} committed operation(s) were not reproduced`);
    this.name = "ReplayDivergedError";
  }
}

/** The job stopped because its worker is suspending (graceful shutdown) or lost its lease. Not a result. */
export class RunSuspendedError extends Error {
  constructor(readonly reason: "shutdown" | "lease_lost" | "outcome_unknown" | "replay_diverged") {
    super(`RUN_SUSPENDED: ${reason}`);
    this.name = "RunSuspendedError";
  }
}

export type DurableMetrics = { reused: number; dispatched: number; refusedUnknown: number; checkpoints: number; checkpointMs: number };

export type DurableScope = {
  jobId: string;
  store: DurableAgentStore;
  lease: Lease;
  /** True for an attempt after the first: committed rows must be reproduced before anything new is dispatched. */
  recovering: boolean;
  /** Committed op keys the replay has not reproduced yet. */
  unconsumed: Set<string>;
  occurrences: Map<string, number>;
  idCounters: Map<string, number>;
  checkpointSeq: number;
  /** Set when the job must stop without producing a result (shutdown, lease lost, unknown outcome, divergence). */
  halt: RunSuspendedError | null;
  metrics: DurableMetrics;
  /** Called on halt so the job's abort signal fires. */
  onHalt: (error: RunSuspendedError) => void;
  /** Records which run this job is executing (job ↔ run linkage). */
  onRun?: (runId: string) => void;
  /** The last committed checkpoint id per run (a continuation starts from it). */
  lastCheckpoint: Map<string, { id: number; boundary: CheckpointBoundary; digest: string }>;
  /** Checkpoint writer; injected by the job manager (keeps this module free of serialization). */
  writeCheckpoint: (state: AgentRunState, boundary: CheckpointBoundary) => Promise<void>;
};

const storage = new AsyncLocalStorage<DurableScope>();

export function durableScope(): DurableScope | undefined {
  return storage.getStore();
}

export function runInScope<T>(scope: DurableScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function fingerprint(operation: string, request: unknown): string {
  return createHash("sha256").update(`${operation}\n${stableJson(request)}`).digest("hex");
}

/** A UUID derived from the job and a per-kind counter: the same on every replay of the job, random without a scope. */
export function durableId(kind: string): string {
  const scope = durableScope();
  if (!scope) return randomUUID();
  const n = scope.idCounters.get(kind) ?? 0;
  scope.idCounters.set(kind, n + 1);
  const hex = createHash("sha256").update(`${scope.jobId}:${kind}:${n}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function halt(scope: DurableScope, error: RunSuspendedError): never {
  if (!scope.halt) {
    scope.halt = error;
    scope.onHalt(error);
  }
  throw scope.halt;
}

function guard<T>(scope: DurableScope, work: () => Promise<T>): Promise<T> {
  return work().catch((error: unknown) => {
    if (error instanceof LeaseLostError) halt(scope, new RunSuspendedError("lease_lost"));
    throw error;
  });
}

export type JournalCodec<T> = {
  encode(value: T): { status: "COMPLETED" | "FAILED"; result: unknown; usage?: unknown; correlationId?: string | null; errorCode?: string | null };
  /** Rebuilds the committed answer. An Error is rethrown (the original call threw). */
  decode(stored: unknown, status: "COMPLETED" | "FAILED", opKey: string): T | Error;
};

/**
 * Runs one provider operation under the journal. `execute` receives `dispatching`, which it must await immediately
 * before the request leaves the process (after any local waiting such as rate-limit spacing). If `execute` never calls
 * it, the operation was answered without dispatch (a local refusal). A thrown error is committed as a FAILED answer and
 * rethrown, so a replay rethrows it too.
 */
export async function journaled<T>(
  provider: CallProvider,
  operation: string,
  request: unknown,
  codec: JournalCodec<T>,
  execute: (dispatching: () => Promise<void>, opKey: string | null) => Promise<T>,
  /** Called with a reused answer instead of `execute` (a local stateful policy rebuilds its memory; never a provider call). */
  onReuse?: (value: T) => Promise<void>,
): Promise<T> {
  const scope = durableScope();
  if (!scope) return execute(async () => undefined, null);
  if (scope.halt) throw scope.halt;
  const fp = fingerprint(operation, request);
  const base = `${provider}:${fp.slice(0, 40)}`;
  const n = scope.occurrences.get(base) ?? 0;
  scope.occurrences.set(base, n + 1);
  const opKey = `${base}:${n}`;
  const existing = await guard(scope, () => scope.store.getCall(scope.jobId, opKey));
  if (existing && (existing.status === "COMPLETED" || existing.status === "FAILED")) {
    if (existing.fingerprint !== fp) halt(scope, new RunSuspendedError("replay_diverged"));
    // The original run discarded this answer after a tool timeout; an instant replay cannot reproduce that timing.
    if (existing.discarded) halt(scope, new RunSuspendedError("replay_diverged"));
    scope.unconsumed.delete(opKey);
    scope.metrics.reused += 1;
    const value = codec.decode(existing.result, existing.status, opKey);
    if (value instanceof Error) throw value;
    await onReuse?.(value);
    return value;
  }
  if (existing && (existing.status === "DISPATCHING" || existing.status === "OUTCOME_UNKNOWN")) {
    scope.metrics.refusedUnknown += 1;
    halt(scope, new RunSuspendedError("outcome_unknown"));
  }
  if (scope.recovering && scope.unconsumed.size > 0) halt(scope, new RunSuspendedError("replay_diverged"));
  await guard(scope, () => scope.store.reserveCall(scope.lease, { opKey, provider, operation, fingerprint: fp }));
  await fault(`${provider}.before_dispatch`);
  let dispatched = false;
  const dispatching = async () => {
    if (scope.halt) throw scope.halt;
    await guard(scope, () => scope.store.markDispatching(scope.lease, opKey));
    if (!dispatched) scope.metrics.dispatched += 1;
    dispatched = true;
    await fault(`${provider}.after_dispatch_mark`);
  };
  let value: T;
  try {
    value = await execute(dispatching, opKey);
  } catch (error) {
    if (error instanceof RunSuspendedError || error instanceof LeaseLostError) throw error;
    await fault(`${provider}.before_commit`);
    await guard(scope, () => scope.store.completeCall(scope.lease, opKey, { status: "FAILED", result: { thrown: error instanceof Error ? error.message.slice(0, 500) : String(error) }, usage: null, correlationId: null, errorCode: "THROWN" }));
    throw error;
  }
  await fault(`${provider}.before_commit`);
  const stored = codec.encode(value);
  await guard(scope, () => scope.store.completeCall(scope.lease, opKey, { status: stored.status, result: stored.result, usage: stored.usage ?? null, correlationId: stored.correlationId ?? null, errorCode: stored.errorCode ?? null }));
  await fault(`${provider}.after_commit`);
  return value;
}

/** Marks a committed operation as discarded by the runtime (late answer after a tool timeout). */
export async function markJournalDiscarded(opKey: string | undefined): Promise<void> {
  const scope = durableScope();
  if (!scope || !opKey) return;
  await guard(scope, () => scope.store.markDiscarded(scope.lease, opKey)).catch(() => undefined);
}

/** Runtime hook: persist a checkpoint at a meaningful boundary. No-op without a scope. */
export async function checkpoint(state: AgentRunState, boundary: CheckpointBoundary): Promise<void> {
  const scope = durableScope();
  if (!scope) return;
  if (scope.halt) throw scope.halt;
  scope.onRun?.(state.runId);
  await fault(`checkpoint.${boundary}.before`);
  const started = performance.now();
  await guard(scope, () => scope.writeCheckpoint(state, boundary));
  scope.metrics.checkpoints += 1;
  scope.metrics.checkpointMs += performance.now() - started;
  await fault(`checkpoint.${boundary}.after`);
}

/** Throws the halt reason if the job must stop (checked by the runtime between turns). */
export function assertNotHalted(): void {
  const scope = durableScope();
  if (scope?.halt) throw scope.halt;
}

// ---- fault injection (process-interruption tests only) ----

const faultCounts = new Map<string, number>();
let faultSpec: { point: string; nth: number } | null | undefined;

/**
 * `CE_DURABLE_FAULT=<point>:<nth>` makes the process stop at the nth time it reaches `point`: it prints
 * `CE_FAULT_REACHED <point>` on stderr and waits forever, so a test harness can kill it there. Only honoured with
 * `CE_DURABLE_FAULT_INJECTION=1` on a non-public runtime; production never reads it.
 */
function spec(): { point: string; nth: number } | null {
  if (faultSpec !== undefined) return faultSpec;
  const env = process.env;
  const publicRuntime = env.NODE_ENV === "production" || env.CE_PUBLIC_DEPLOYMENT === "1";
  const raw = env.CE_DURABLE_FAULT_INJECTION === "1" && !publicRuntime ? env.CE_DURABLE_FAULT?.trim() : undefined;
  const match = raw ? /^([a-z_.]+):(\d+)$/u.exec(raw) : null;
  faultSpec = match ? { point: match[1]!, nth: Number(match[2]) } : null;
  return faultSpec;
}

export async function fault(point: string): Promise<void> {
  const target = spec();
  if (!target || target.point !== point) return;
  const count = (faultCounts.get(point) ?? 0) + 1;
  faultCounts.set(point, count);
  if (count !== target.nth) return;
  process.stderr.write(`CE_FAULT_REACHED ${point}\n`);
  // CE_DURABLE_FAULT_PAUSE_MS turns the stop into a pause (a stalled worker that later wakes up).
  const pause = Number(process.env.CE_DURABLE_FAULT_PAUSE_MS ?? 0);
  if (Number.isFinite(pause) && pause > 0) await new Promise((resolve) => setTimeout(resolve, pause));
  else await new Promise<never>(() => undefined);
}
