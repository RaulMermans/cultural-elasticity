/**
 * Investigations detached from the HTTP request.
 *
 * Two modes, one contract:
 *   - In-process (default): jobs live in memory. A restart drops them; nothing here is a queue or a database.
 *   - Durable (Sprint 10C, `durable` option): every job is a PostgreSQL row (agent_jobs). A worker owns a job through a
 *     fenced lease, provider calls are journaled before they leave the process (durable/scope.ts), run state is
 *     checkpointed at turn boundaries, and the terminal result is committed atomically with the lease release. After
 *     a restart, `recover()` applies deterministic rules (durable/recovery.ts): resume by replaying the committed
 *     journal, quarantine a job whose provider call may have been sent without a committed answer, or finish it
 *     (cancelled, timed out). Results stay readable for the retention window, across restarts.
 *
 * The work itself is QueryService / AgentRuntime. A job only detaches that work from the HTTP connection, bounds how
 * many run at once, and carries an opaque access token (only its SHA-256 is stored). Qloo calls stay serialized by the
 * shared tool provider. Durable mode is validated for one worker process at a time plus a stale one fenced out; it is
 * not a claim of distributed execution.
 */
import type { TerritoryGrounding } from "../state.js";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { AgentRunResponse, AgentTrace, DiscoverySeed, QueryResponse } from "@cultural-elasticity/shared";
import { jobActivity, type JobActivity } from "./activity.js";
import { AgentInputError, AgentNotConfiguredError, RunNotFoundError, RunNotWaitingError } from "../errors.js";
import { fixedSpendBound, type SpendBound } from "../../ops/spend.js";
import { observedUsage } from "../../ops/usage.js";
import type { QueryBody } from "./contracts.js";
import { QueryAlreadyExecutedError, type QueryHooks, type QueryProgress, type QueryRecord, type QueryStore } from "./service.js";
import type { RunStore } from "../run-store.js";
import { evidenceDigest, hydrateRunState, serializeRunState, CHECKPOINT_SCHEMA_VERSION, type CheckpointBoundary } from "../durable/checkpoint.js";
import { decideRecovery, DEFAULT_MAX_ATTEMPTS, type RecoveryDecision } from "../durable/recovery.js";
import { fault, RunSuspendedError, runInScope, type DurableScope } from "../durable/scope.js";
import { LeaseLostError, type DurableAgentStore, type DurableJobStatus, type JobRow, type Lease } from "../durable/store.js";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "expired";
export type JobStage = "queued" | "interpreting" | "investigating" | "preparing" | "done";

export type JobView = {
  jobId: string;
  status: JobStatus;
  stage: JobStage;
  stageLabel: string;
  stopping: boolean;
  response: QueryResponse | null;
  error: { code: string; message: string } | null;
  /** What the agent is doing, read from its live trace. Model reasons are its own notes, never evidence. */
  activity: JobActivity[];
};

export type JobCreated = JobView & { accessToken: string };

export type JobRequest =
  | { kind: "execute"; body: QueryBody; model: string; expectedBrandId?: string; territoryGrounding?: TerritoryGrounding; discoverySeeds?: DiscoverySeed[]; handoff?: HandoffRecord }
  | { kind: "confirm"; queryId: string; model: string }
  | { kind: "continue"; runId: string; clarification: string; model: string };

/**
 * Sprint 10D: the handoff that admitted a job, stored with its durable request so that idempotency and a comparative
 * report plan outlive a restart. Never read by the runtime; `plan` is the route's own projection (opaque here).
 */
export type HandoffRecord = { idempotencyKey: string; requestKey: string; plan?: unknown };

export interface InvestigationRunner {
  execute(body: QueryBody, hooks?: QueryHooks): Promise<QueryResponse>;
  confirm(queryId: string, hooks?: QueryHooks): Promise<QueryResponse>;
  continueRun(runId: string, clarification: string, hooks?: QueryHooks): Promise<QueryResponse>;
}

export class JobRejectedError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "JobRejectedError";
  }
}

/** Sprint 10C durable mode. */
export type DurableJobOptions = {
  store: DurableAgentStore;
  /** This process's worker identity (a lease owner). */
  workerId?: string;
  leaseMs?: number;
  heartbeatMs?: number;
  /** How long a finished job's result stays readable (durably). */
  retentionMs?: number;
  maxAttempts?: number;
  /** How often recover() runs again (a lease left by a crashed process expires after leaseMs). */
  recoveryIntervalMs?: number;
  /** Run states are restored here (continuations, follow-ups, saved research). */
  runStore?: RunStore;
  /** Interpreted queries are restored here (confirmation after a restart). */
  queryStore?: QueryStore;
};

export type JobManagerOptions = {
  runnerFor: (model: string) => InvestigationRunner;
  maxRunning?: number;
  maxQueued?: number;
  /** How long a finished job can still be read from memory. */
  ttlMs?: number;
  /** Aborts a running investigation at the next turn boundary. */
  maxRunMs?: number;
  now?: () => number;
  log?: (event: Record<string, unknown>) => void;
  durable?: DurableJobOptions;
};

type AbortReason = "user" | "timeout" | "shutdown" | null;

type Job = {
  id: string;
  tokenHash: string;
  request: JobRequest;
  status: JobStatus;
  stage: JobStage;
  intent: string | null;
  stopping: boolean;
  abortReason: AbortReason;
  response: QueryResponse | null;
  error: { code: string; message: string } | null;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  expiresAt: number;
  /** Absolute run deadline. Kept across restarts (never reset by a recovery). */
  deadlineAt: number;
  controller: AbortController;
  trace: AgentTrace | null;
  timer: ReturnType<typeof setTimeout> | null;
  spend?: SpendBound;
  // ---- durable mode ----
  lease: Lease | null;
  scope: DurableScope | null;
  recovery: { decision: RecoveryDecision; priorDigests: Map<string, string> } | null;
  persisting: Promise<void> | null;
  heartbeat: ReturnType<typeof setInterval> | null;
  spendAuthorizedUsd: number | null;
  /** A continuation's starting state: the run's needs_input checkpoint at admission. */
  baseCheckpointId: number | null;
};

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_RUN_MS = 20 * 60 * 1000;
const SINGLE_HYPOTHESIS_MAX_RUN_MS = 4 * 60 * 1000;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const INTERRUPTED_MESSAGE =
  "The investigation was interrupted while a provider call was in flight. Its outcome is unknown, so it was not repeated automatically. Evidence gathered before the interruption is preserved; an operator can review and resume it. This is not evidence against the territory.";

function runLimitMs(request: JobRequest, defaultMs: number): number {
  return request.kind === "execute" && "researchMode" in request.body && request.body.researchMode === "single_hypothesis_v1"
    ? Math.min(defaultMs, SINGLE_HYPOTHESIS_MAX_RUN_MS) : defaultMs;
}

export function stageLabel(stage: JobStage, intent: string | null, recovering = false): string {
  if (recovering && stage !== "done") return "Resuming after a restart";
  if (stage === "queued") return "Waiting to start";
  if (stage === "interpreting") return "Interpreting question";
  if (stage === "investigating") return intent === "compare_territories" ? "Evaluating comparisons" : "Investigating available evidence";
  if (stage === "preparing") return "Preparing findings";
  return "Findings ready";
}

const TO_DURABLE: Record<JobStatus, DurableJobStatus> = { queued: "QUEUED", running: "RUNNING", completed: "COMPLETED", failed: "FAILED", cancelled: "CANCELLED", expired: "EXPIRED" };

export type RecoverySummary = { examined: number; resumed: number; requeued: number; quarantined: number; cancelled: number; failed: number; skipped: number; restoredRuns: number; restoredQueries: number };

export class JobManager {
  private readonly jobs = new Map<string, Job>();
  private readonly queue: Job[] = [];
  private readonly confirms = new Set<string>();
  private running = 0;
  private readonly maxRunning: number;
  private readonly maxQueued: number;
  private readonly ttlMs: number;
  private readonly maxRunMs: number;
  private readonly now: () => number;
  private readonly durable: (Required<Omit<DurableJobOptions, "runStore" | "queryStore">> & Pick<DurableJobOptions, "runStore" | "queryStore">) | null;
  private recoveryTimer: ReturnType<typeof setInterval> | null = null;
  private recovering: Promise<RecoverySummary> | null = null;
  private stopped = false;

  constructor(private readonly options: JobManagerOptions) {
    this.maxRunning = options.maxRunning ?? 2;
    this.maxQueued = options.maxQueued ?? 4;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxRunMs = options.maxRunMs ?? DEFAULT_MAX_RUN_MS;
    this.now = options.now ?? (() => Date.now());
    const d = options.durable;
    this.durable = d
      ? {
          store: d.store,
          workerId: d.workerId ?? randomUUID(),
          leaseMs: d.leaseMs ?? DEFAULT_LEASE_MS,
          heartbeatMs: d.heartbeatMs ?? Math.max(250, Math.floor((d.leaseMs ?? DEFAULT_LEASE_MS) / 3)),
          retentionMs: d.retentionMs ?? DEFAULT_RETENTION_MS,
          maxAttempts: d.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
          recoveryIntervalMs: d.recoveryIntervalMs ?? Math.max(1_000, Math.floor((d.leaseMs ?? DEFAULT_LEASE_MS) / 2)),
          runStore: d.runStore,
          queryStore: d.queryStore,
        }
      : null;
    if (!options.now) {
      const timer = setInterval(() => this.sweep(), 60_000);
      timer.unref?.();
    }
  }

  /** True when jobs are persisted (Sprint 10C durable mode). */
  get isDurable(): boolean {
    return this.durable !== null;
  }

  get workerId(): string | null {
    return this.durable?.workerId ?? null;
  }

  private newJob(request: JobRequest, extras?: { spend?: SpendBound }): { job: Job; accessToken: string } {
    const now = this.now();
    const accessToken = randomBytes(32).toString("base64url");
    const limit = runLimitMs(request, this.maxRunMs);
    const job: Job = {
      id: randomUUID(),
      tokenHash: hashToken(accessToken),
      request,
      status: "queued",
      stage: "queued",
      intent: null,
      stopping: false,
      abortReason: null,
      response: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      expiresAt: now + limit + this.ttlMs,
      deadlineAt: now + limit,
      controller: new AbortController(),
      trace: null,
      timer: null,
      lease: null,
      scope: null,
      recovery: null,
      persisting: null,
      heartbeat: null,
      spendAuthorizedUsd: extras?.spend?.authorizedUsd ?? null,
      baseCheckpointId: null,
    };
    if (extras?.spend) job.spend = extras.spend;
    return { job, accessToken };
  }

  private admissible(request: JobRequest): void {
    this.sweep();
    if (this.stopped) throw new JobRejectedError(503, "service_stopping", "The investigation service is stopping.");
    if (request.kind === "confirm" && this.confirms.has(request.queryId)) {
      throw new JobRejectedError(409, "query_already_executed", "That confirmation is already running.");
    }
    if (this.running >= this.maxRunning && this.queue.length >= this.maxQueued) {
      throw new JobRejectedError(429, "too_many_investigations", "Too many investigations are already in progress.");
    }
  }

  private enqueue(job: Job, front = false): void {
    this.jobs.set(job.id, job);
    if (job.request.kind === "confirm") this.confirms.add(job.request.queryId);
    if (front) this.queue.unshift(job);
    else this.queue.push(job);
    this.options.log?.({ jobId: job.id, status: job.status, kind: job.request.kind, event: job.recovery ? "job_recovered" : "job_queued" });
    this.pump();
  }

  /** In-process admission. In durable mode use `admit`, which persists the job before it can start. */
  create(request: JobRequest, extras?: { spend?: SpendBound }): JobCreated {
    if (this.durable) throw new Error("JobManager.create is in-process only; use admit() in durable mode");
    this.admissible(request);
    const { job, accessToken } = this.newJob(request, extras);
    this.enqueue(job);
    return { ...this.view(job), accessToken };
  }

  /**
   * Admission in either mode. Durable: the job row (request, token hash, deadline, spend authorization) is committed
   * before the job is queued, so an accepted job survives a restart; a database failure rejects the job (503).
   */
  async admit(request: JobRequest, extras?: { spend?: SpendBound; origin?: string }): Promise<JobCreated> {
    if (!this.durable) return this.create(request, extras);
    this.admissible(request);
    const { job, accessToken } = this.newJob(request, extras);
    const { store } = this.durable;
    let baseCheckpointId: number | null = null;
    if (request.kind === "continue") baseCheckpointId = (await store.latestCheckpoint(request.runId, ["needs_input"]).catch(() => null))?.id ?? null;
    const parentRunId = request.kind === "continue" ? request.runId : request.kind === "execute" && "context" in request.body ? (request.body.context?.runId ?? null) : null;
    try {
      await store.createJob({ id: job.id, accessTokenHash: job.tokenHash, request, kind: request.kind, deadlineAt: new Date(job.deadlineAt), parentRunId, baseCheckpointId, originScope: extras?.origin ?? null, spendAuthorizedUsd: job.spendAuthorizedUsd });
    } catch {
      throw new JobRejectedError(503, "durability_unavailable", "The investigation could not be recorded durably, so it was not started.");
    }
    job.baseCheckpointId = baseCheckpointId;
    this.enqueue(job);
    return { ...this.view(job), accessToken };
  }

  counts(): { running: number; queued: number; held: number } {
    return { running: this.running, queued: this.queue.filter((job) => job.status === "queued").length, held: this.jobs.size };
  }

  /**
   * Stops new work. In-process: aborts queued and running jobs (BACKEND_RESTART). Durable: running jobs are suspended
   * without a result and their leases released, and queued jobs stay queued in the database, so the next process
   * recovers them. Finished results stay readable.
   */
  shutdown(message = "The investigation service is stopping."): void {
    this.stopped = true;
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    for (const job of this.jobs.values()) {
      if (job.status !== "queued" && job.status !== "running") continue;
      if (this.durable) {
        job.stopping = true;
        if (job.scope && !job.scope.halt) {
          job.scope.halt = new RunSuspendedError("shutdown");
          job.controller.abort();
        }
        continue;
      }
      job.abortReason = "shutdown";
      job.stopping = true;
      job.controller.abort();
      if (job.status === "queued") {
        this.finish(job, "cancelled", null, { code: "BACKEND_RESTART", message });
      }
    }
  }

  /** Durable mode: waits (bounded) for suspended jobs to release their leases. */
  async drain(timeoutMs = 5_000): Promise<void> {
    const pending = [...this.jobs.values()].filter((job) => job.status === "running" && job.lease);
    const settled = Promise.all(pending.map((job) => new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!job.lease || job.status !== "running") {
          clearInterval(check);
          resolve();
        }
      }, 25);
      check.unref?.();
    })));
    await Promise.race([settled, new Promise((resolve) => setTimeout(resolve, timeoutMs).unref?.())]);
    for (const job of pending) if (job.lease) await this.durable?.store.release(job.lease);
  }

  /** Returns null when the id is unknown or the token does not match. The two cases are not distinguished. */
  get(id: string, token: string): JobView | null {
    const job = this.jobs.get(id);
    if (job && tokenMatches(job.tokenHash, token) && job.finishedAt !== null && this.now() > job.expiresAt && !this.durable) {
      const expired = this.expire(job);
      this.jobs.delete(job.id);
      this.sweep();
      return expired;
    }
    this.sweep();
    const current = this.jobs.get(id);
    if (!current || !tokenMatches(current.tokenHash, token)) return null;
    return this.view(current);
  }

  /** `get`, falling back to the durable record (after a restart, or once memory let the job go). */
  async read(id: string, token: string): Promise<JobView | null> {
    const held = this.get(id, token);
    if (held || !this.durable || !isUuid(id)) return held;
    const row = await this.durable.store.getJob(id).catch(() => null);
    if (!row || !tokenMatches(row.accessTokenHash, token)) return null;
    return durableView(row);
  }

  /**
   * Server-side read without a token. Only for jobs the server itself linked to a caller's authorized scope
   * (for example, investigations started from the same baseline scan); never for a client-supplied id alone.
   */
  peek(id: string): JobView | null {
    this.sweep();
    const job = this.jobs.get(id);
    return job ? this.view(job) : null;
  }

  async peekDurable(id: string): Promise<JobView | null> {
    const held = this.peek(id);
    if (held || !this.durable || !isUuid(id)) return held;
    const row = await this.durable.store.getJob(id).catch(() => null);
    return row ? durableView(row) : null;
  }

  /** Durable mode: the handoff records of the jobs recorded under an origin scope. */
  async originHandoffs(origin: string): Promise<{ jobId: string; handoff: HandoffRecord }[]> {
    if (!this.durable) return [];
    const rows = await this.durable.store.jobsByOrigin(origin).catch(() => []);
    return rows.flatMap((row) => {
      const handoff = handoffOf(row.request);
      return handoff ? [{ jobId: row.id, handoff }] : [];
    });
  }

  /** Durable mode: the handoff record of one job, for a reader that already proved the job token. */
  async durableHandoff(id: string): Promise<HandoffRecord | null> {
    if (!this.durable || !isUuid(id)) return null;
    const row = await this.durable.store.getJob(id).catch(() => null);
    return row ? handoffOf(row.request) : null;
  }

  /** Durable mode: jobs the server recorded under an origin scope (e.g. one baseline scan). */
  async originJobs(origin: string): Promise<string[]> {
    if (!this.durable) return [];
    return (await this.durable.store.jobsByOrigin(origin).catch(() => [])).map((row) => row.id);
  }

  cancel(id: string, token: string): JobView | null {
    const job = this.jobs.get(id);
    if (!job || !tokenMatches(job.tokenHash, token)) return null;
    if (job.status !== "queued" && job.status !== "running") return this.view(job);
    job.abortReason = "user";
    job.stopping = true;
    job.controller.abort();
    job.updatedAt = this.now();
    if (this.durable) void this.durable.store.requestCancel(job.id).catch(() => undefined);
    if (job.status === "queued") this.finish(job, "cancelled", null, { code: "INVESTIGATION_CANCELLED", message: "Cancelled before it started." });
    return this.view(job);
  }

  /** `cancel`, also for a job this process does not hold (recorded durably; recovery then cancels it). */
  async stop(id: string, token: string): Promise<JobView | null> {
    const held = this.cancel(id, token);
    if (held || !this.durable || !isUuid(id)) return held;
    const { store, retentionMs } = this.durable;
    const row = await store.getJob(id).catch(() => null);
    if (!row || !tokenMatches(row.accessTokenHash, token)) return null;
    await store.requestCancel(id);
    if (row.status === "INTERRUPTED_UNCERTAIN" || row.status === "QUEUED") {
      await store.finishUnowned(id, { status: "CANCELLED", errorCode: "INVESTIGATION_CANCELLED", errorMessage: "Cancelled before it resumed.", retentionMs });
    }
    const after = await store.getJob(id);
    return after ? durableView(after) : null;
  }

  private pump(): void {
    while (this.running < this.maxRunning) {
      const next = this.queue.shift();
      if (!next) return;
      if (next.status !== "queued") continue;
      this.start(next);
    }
  }

  private start(job: Job): void {
    job.status = "running";
    job.updatedAt = this.now();
    this.running += 1;
    this.options.log?.({ jobId: job.id, status: job.status, event: "job_started", queueWaitMs: job.updatedAt - job.createdAt, recovered: job.recovery !== null });
    const timer = setTimeout(() => {
      job.abortReason = "timeout";
      job.controller.abort();
    }, Math.max(0, job.deadlineAt - this.now()));
    timer.unref?.();
    job.timer = timer;
    const work = this.durable ? this.executeDurable(job) : this.execute(job);
    void work.finally(async () => {
      if (job.persisting) await job.persisting.catch(() => undefined);
      this.running -= 1;
      if (job.timer) clearTimeout(job.timer);
      job.timer = null;
      if (job.heartbeat) clearInterval(job.heartbeat);
      job.heartbeat = null;
      this.pump();
    });
  }

  // ---- durable execution ----

  private async executeDurable(job: Job): Promise<void> {
    const d = this.durable!;
    if (!job.lease) {
      const lease = await d.store.claim(job.id, d.workerId, d.leaseMs, "RUNNING").catch(() => null);
      if (!lease) {
        // Another worker owns it, or it was finished elsewhere (e.g. cancelled before it started).
        this.forget(job);
        return;
      }
      job.lease = lease;
    }
    const lease = job.lease;
    const scope: DurableScope = {
      jobId: job.id,
      store: d.store,
      lease,
      recovering: job.recovery !== null,
      unconsumed: new Set(job.recovery?.decision.committed ?? []),
      occurrences: new Map(),
      idCounters: new Map(),
      checkpointSeq: 0,
      halt: null,
      metrics: { reused: 0, dispatched: 0, refusedUnknown: 0, checkpoints: 0, checkpointMs: 0 },
      onHalt: () => job.controller.abort(),
      lastCheckpoint: new Map(),
      onRun: (runId) => {
        if (job.scope?.lastCheckpoint.has(runId)) return;
        void d.store.updateProgress(lease, { runId }).catch(() => undefined);
      },
      writeCheckpoint: (state, boundary) => this.writeCheckpoint(job, scope, state, boundary),
    };
    job.scope = scope;
    job.heartbeat = setInterval(() => {
      void d.store.heartbeat(lease, d.leaseMs).then((ok) => {
        if (!ok && !scope.halt) {
          scope.halt = new RunSuspendedError("lease_lost");
          job.controller.abort();
        }
      });
    }, d.heartbeatMs);
    job.heartbeat.unref?.();
    if (job.request.kind === "continue") {
      // A continuation starts from the run's needs_input checkpoint, never from state a failed attempt mutated.
      const base = job.baseCheckpointId;
      const row = base !== null ? await d.store.checkpoint(base).catch(() => null) : null;
      if (row && d.runStore) d.runStore.put(hydrateRunState({ schemaVersion: row.schemaVersion, state: row.state }));
    }
    await runInScope(scope, () => this.execute(job));
    if (job.status === "running" && !job.persisting) {
      // Suspended without a result (shutdown, lease lost, unknown outcome, divergence).
      await this.suspended(job, scope);
    }
    this.options.log?.({ jobId: job.id, event: "job_durable_metrics", ...scope.metrics, checkpointMs: Math.round(scope.metrics.checkpointMs) });
  }

  private async writeCheckpoint(job: Job, scope: DurableScope, state: import("../state.js").AgentRunState, boundary: CheckpointBoundary): Promise<void> {
    const seq = (scope.checkpointSeq += 1);
    const digest = evidenceDigest(state);
    const prior = job.recovery?.priorDigests.get(`${state.runId}:${seq}`);
    if (prior !== undefined && prior !== digest) {
      scope.halt = new RunSuspendedError("replay_diverged");
      job.controller.abort();
      throw scope.halt;
    }
    const serialized = serializeRunState(state);
    const id = await scope.store.putCheckpoint(scope.lease, { runId: state.runId, seq, boundary, schemaVersion: CHECKPOINT_SCHEMA_VERSION, digest, state: serialized.state });
    scope.lastCheckpoint.set(state.runId, { id, boundary, digest });
  }

  private async suspended(job: Job, scope: DurableScope): Promise<void> {
    const d = this.durable!;
    const reason = scope.halt?.reason ?? "shutdown";
    if (reason === "lease_lost") {
      this.options.log?.({ jobId: job.id, event: "job_lease_lost" });
      this.forget(job);
      return;
    }
    if (reason === "shutdown") {
      await d.store.release(scope.lease);
      job.lease = null;
      this.options.log?.({ jobId: job.id, event: "job_suspended" });
      this.forget(job);
      return;
    }
    // outcome_unknown / replay_diverged: quarantine. Nothing is presented as a finding.
    const code = reason === "replay_diverged" ? "INVESTIGATION_REPLAY_DIVERGED" : "INVESTIGATION_INTERRUPTED_UNCERTAIN";
    await this.quarantine(job, scope.lease, code);
  }

  private async quarantine(job: Job, lease: Lease, code: string): Promise<void> {
    const d = this.durable!;
    try {
      await d.store.markUnknown(lease);
      await d.store.finish(lease, { status: "INTERRUPTED_UNCERTAIN", result: null, errorCode: code, errorMessage: INTERRUPTED_MESSAGE, retentionMs: d.retentionMs });
      await d.store.event(job.id, "QUARANTINED", { code });
    } catch (error) {
      if (!(error instanceof LeaseLostError)) this.options.log?.({ jobId: job.id, event: "job_quarantine_failed" });
    }
    job.lease = null;
    this.memoryFinish(job, "failed", null, { code, message: INTERRUPTED_MESSAGE });
  }

  /** Drops a job from this process (another worker or the database is authoritative now). */
  private forget(job: Job): void {
    job.status = "failed";
    job.stage = "done";
    const index = this.queue.indexOf(job);
    if (index >= 0) this.queue.splice(index, 1);
    if (job.request.kind === "confirm") this.confirms.delete(job.request.queryId);
    this.jobs.delete(job.id);
  }

  private async persistTerminal(job: Job, status: JobStatus, response: QueryResponse | null, error: { code: string; message: string } | null): Promise<void> {
    const d = this.durable!;
    await fault("job.before_terminal_commit");
    const outcome = { status: TO_DURABLE[status], result: response, errorCode: error?.code ?? null, errorMessage: error?.message ?? null, retentionMs: d.retentionMs, runId: response?.investigation?.runId ?? null };
    try {
      if (job.lease) {
        await d.store.finish(job.lease, outcome);
        job.lease = null;
      } else {
        await d.store.finishUnowned(job.id, { status: outcome.status, errorCode: outcome.errorCode ?? "JOB_FINISHED", errorMessage: outcome.errorMessage ?? "", retentionMs: d.retentionMs });
      }
      await fault("job.after_terminal_commit");
    } catch (failure) {
      if (failure instanceof LeaseLostError) {
        // A newer worker owns this job; its result is the canonical one.
        this.options.log?.({ jobId: job.id, event: "job_commit_fenced" });
        this.jobs.delete(job.id);
        return;
      }
      this.options.log?.({ jobId: job.id, event: "job_commit_failed" });
    }
  }

  // ---- recovery ----

  /**
   * Recovers jobs a previous process left unfinished, then restores held runs and queries. Safe to call repeatedly;
   * a job whose lease is still live is skipped until it expires. Starts a periodic re-check.
   */
  recover(): Promise<RecoverySummary> {
    if (!this.durable) return Promise.resolve({ examined: 0, resumed: 0, requeued: 0, quarantined: 0, cancelled: 0, failed: 0, skipped: 0, restoredRuns: 0, restoredQueries: 0 });
    if (this.recovering) return this.recovering;
    this.recovering = this.recoverOnce().finally(() => {
      this.recovering = null;
    });
    if (!this.recoveryTimer && !this.stopped) {
      this.recoveryTimer = setInterval(() => void this.recover(), this.durable.recoveryIntervalMs);
      this.recoveryTimer.unref?.();
    }
    return this.recovering;
  }

  private async recoverOnce(): Promise<RecoverySummary> {
    const d = this.durable!;
    const summary: RecoverySummary = { examined: 0, resumed: 0, requeued: 0, quarantined: 0, cancelled: 0, failed: 0, skipped: 0, restoredRuns: 0, restoredQueries: 0 };
    if (this.stopped) return summary;
    await d.store.sweep().catch(() => undefined);
    const rows = await d.store.activeJobs();
    for (const row of rows) {
      if (this.jobs.has(row.id)) continue;
      summary.examined += 1;
      const started = this.now();
      if (row.status === "QUEUED" && row.attempt === 0) {
        if (row.cancelRequested) {
          await d.store.finishUnowned(row.id, { status: "CANCELLED", errorCode: "INVESTIGATION_CANCELLED", errorMessage: "Cancelled before it started.", retentionMs: d.retentionMs });
          summary.cancelled += 1;
          continue;
        }
        this.enqueue(this.rebuild(row, null, null), false);
        summary.requeued += 1;
        await d.store.event(row.id, "RECOVERY_DECISION", { action: "requeue", reason: "admitted but never started" });
        continue;
      }
      const lease = await d.store.claim(row.id, d.workerId, d.leaseMs, "RECOVERING").catch(() => null);
      if (!lease) {
        summary.skipped += 1;
        continue;
      }
      const claimed = (await d.store.getJob(row.id))!;
      const calls = await d.store.calls(row.id);
      const decision = decideRecovery(claimed, calls, new Date(this.now()), d.maxAttempts);
      await d.store.event(row.id, "RECOVERY_DECISION", { action: decision.action, reason: decision.reason, attempt: claimed.attempt, unknown: decision.unknown.length, committed: decision.committed.length, worker: d.workerId, decisionMs: this.now() - started });
      if (decision.action === "cancel") {
        await d.store.finish(lease, { status: "CANCELLED", result: null, errorCode: "INVESTIGATION_CANCELLED", errorMessage: "The investigation was cancelled. Partial observations were not recorded as findings.", retentionMs: d.retentionMs });
        summary.cancelled += 1;
      } else if (decision.action === "quarantine") {
        await d.store.markUnknown(lease);
        await d.store.finish(lease, { status: "INTERRUPTED_UNCERTAIN", result: null, errorCode: "INVESTIGATION_INTERRUPTED_UNCERTAIN", errorMessage: INTERRUPTED_MESSAGE, retentionMs: d.retentionMs });
        summary.quarantined += 1;
      } else if (decision.action === "timeout") {
        await d.store.finish(lease, { status: "FAILED", result: null, errorCode: "INVESTIGATION_TIMEOUT", errorMessage: "The investigation reached its time limit while it was interrupted. That is not evidence against a territory.", retentionMs: d.retentionMs });
        summary.failed += 1;
      } else if (decision.action === "attempts_exhausted") {
        await d.store.finish(lease, { status: "FAILED", result: null, errorCode: "RECOVERY_LIMIT_REACHED", errorMessage: "The investigation was interrupted too many times to resume safely. Its evidence is preserved.", retentionMs: d.retentionMs });
        summary.failed += 1;
      } else {
        const checkpoints = await d.store.jobCheckpoints(row.id);
        const priorDigests = new Map(checkpoints.map((c) => [`${c.runId}:${c.seq}`, c.digest]));
        const job = this.rebuild(claimed, lease, { decision, priorDigests });
        this.enqueue(job, true);
        summary.resumed += 1;
      }
    }
    if (d.runStore || d.queryStore) {
      const restored = await this.restoreHeld().catch(() => ({ runs: 0, queries: 0 }));
      summary.restoredRuns = restored.runs;
      summary.restoredQueries = restored.queries;
    }
    this.options.log?.({ event: "durable_recovery", ...summary });
    return summary;
  }

  /** Restores finished and waiting runs (continuations, follow-ups, saved research) and interpreted queries. */
  private async restoreHeld(): Promise<{ runs: number; queries: number }> {
    const d = this.durable!;
    let runs = 0;
    let queries = 0;
    if (d.runStore) {
      for (const row of (await d.store.recentRunCheckpoints(100)).reverse()) {
        if (d.runStore.get(row.runId)) continue;
        try {
          d.runStore.put(hydrateRunState({ schemaVersion: row.schemaVersion, state: row.state }));
          runs += 1;
        } catch {
          // An incompatible checkpoint version is not restored (reported as unavailable, never guessed).
        }
      }
    }
    if (d.queryStore) {
      for (const row of (await d.store.queries(200)).reverse()) {
        if (d.queryStore.get(row.queryId)) continue;
        d.queryStore.remember({ ...(row.record as QueryRecord), executed: row.executed });
        queries += 1;
      }
    }
    return { runs, queries };
  }

  private rebuild(row: JobRow, lease: Lease | null, recovery: Job["recovery"]): Job {
    const now = this.now();
    const request = row.request as JobRequest;
    const job: Job = {
      id: row.id,
      tokenHash: row.accessTokenHash,
      request,
      status: "queued",
      stage: "queued",
      intent: row.intent,
      stopping: false,
      abortReason: null,
      response: null,
      error: null,
      createdAt: row.createdAt.getTime(),
      updatedAt: now,
      finishedAt: null,
      expiresAt: row.deadlineAt.getTime() + this.ttlMs,
      deadlineAt: row.deadlineAt.getTime(),
      controller: new AbortController(),
      trace: null,
      timer: null,
      lease,
      scope: null,
      recovery,
      persisting: null,
      heartbeat: null,
      spendAuthorizedUsd: row.spendAuthorizedUsd,
      baseCheckpointId: row.baseCheckpointId,
    };
    // The original reservation is still held durably; the recovered job is bounded by what it authorized.
    if (row.spendAuthorizedUsd !== null) job.spend = fixedSpendBound(row.spendAuthorizedUsd);
    return job;
  }

  // ---- shared execution ----

  private async execute(job: Job): Promise<void> {
    const hooks: QueryHooks = {
      signal: job.controller.signal,
      onProgress: (event) => this.note(job, event),
      onTrace: (trace) => { job.trace = trace; },
      onPreview: (response) => {
        if (job.controller.signal.aborted || job.status !== "running") return;
        job.response = structuredClone(response);
        job.updatedAt = this.now();
      },
      queueWaitMs: Math.max(0, job.updatedAt - job.createdAt),
      ...(job.spend ? { spend: job.spend } : {}),
    };
    try {
      const runner = this.options.runnerFor(job.request.model);
      const response = await runRequest(runner, job.request, hooks);
      if (job.scope?.halt) return;
      if (job.abortReason === "timeout") {
        this.finishTimeout(job, response);
      } else if (job.abortReason === "shutdown") {
        this.finish(job, "failed", null, { code: "BACKEND_RESTART", message: "The investigation service stopped before this run finished. It is not evidence against the territory." });
      } else if (job.controller.signal.aborted || response.reasons.some((reason) => reason.code === "INVESTIGATION_CANCELLED")) {
        this.finish(job, "cancelled", response, { code: "INVESTIGATION_CANCELLED", message: "The investigation was stopped. Partial observations were not recorded as findings." });
      } else {
        this.finish(job, "completed", response, null);
      }
    } catch (error) {
      if (error instanceof RunSuspendedError || job.scope?.halt) return;
      if (job.abortReason === "timeout") {
        this.finishTimeout(job, job.response);
      } else if (job.abortReason === "shutdown") {
        this.finish(job, "failed", null, { code: "BACKEND_RESTART", message: "The investigation service stopped before this run finished. It is not evidence against the territory." });
      } else if (job.controller.signal.aborted || job.stopping) {
        this.finish(job, "cancelled", null, { code: "INVESTIGATION_CANCELLED", message: "The investigation was stopped. Partial observations were not recorded as findings." });
      } else {
        this.options.log?.({ jobId: job.id, status: "failed", code: error instanceof Error ? error.name : "Error" });
        this.finish(job, "failed", null, publicError(error));
      }
    }
  }

  private note(job: Job, event: QueryProgress): void {
    if (job.status !== "running") return;
    job.stage = event.phase;
    if (event.intent) job.intent = event.intent;
    job.updatedAt = this.now();
    if (this.durable && job.lease) void this.durable.store.updateProgress(job.lease, { stage: event.phase, intent: event.intent ?? null }).catch(() => undefined);
  }

  private finishTimeout(job: Job, response: QueryResponse | null): void {
    const kept = response ?? job.response;
    const error = {
      code: "INVESTIGATION_TIMEOUT",
      message: kept
        ? "The investigation reached its time limit. Prepared findings were kept. A timeout is not evidence against a territory."
        : "The investigation reached its time limit before findings could be prepared. That is not evidence against a territory.",
    };
    this.finish(job, kept ? "completed" : "failed", kept, error);
  }

  private finish(job: Job, status: JobStatus, response: QueryResponse | null, error: { code: string; message: string } | null): void {
    if (job.finishedAt !== null) return;
    const aborted = job.stopping || job.controller.signal.aborted;
    if (aborted && job.abortReason !== "timeout" && job.abortReason !== "shutdown" && status !== "cancelled" && status !== "expired") {
      const alreadyCancelled = response?.reasons.some((reason) => reason.code === "INVESTIGATION_CANCELLED") ?? false;
      status = "cancelled";
      error = { code: "INVESTIGATION_CANCELLED", message: "The investigation was stopped. Partial observations were not recorded as findings." };
      if (!alreadyCancelled) response = null;
    }
    this.memoryFinish(job, status, response, error);
    if (this.durable) job.persisting = this.persistTerminal(job, status, job.response, error);
  }

  private memoryFinish(job: Job, status: JobStatus, response: QueryResponse | null, error: { code: string; message: string } | null): void {
    if (job.finishedAt !== null) return;
    const now = this.now();
    job.status = status;
    job.stage = "done";
    job.stopping = false;
    job.response = response ? structuredClone(response) : null;
    job.error = error;
    job.finishedAt = now;
    job.updatedAt = now;
    job.expiresAt = now + this.ttlMs;
    if (job.request.kind === "confirm") this.confirms.delete(job.request.queryId);
    const index = this.queue.indexOf(job);
    if (index >= 0) this.queue.splice(index, 1);
    const usage = observedUsage(job.response);
    this.options.log?.({
      jobId: job.id,
      status,
      event: status === "completed" ? "job_completed" : status === "failed" ? "job_failed" : status === "cancelled" ? "job_cancelled" : status === "expired" ? "job_expired" : "job_completed",
      durationMs: now - job.createdAt,
      abortReason: job.abortReason,
      usage,
    });
  }

  private expire(job: Job): JobView {
    return {
      jobId: job.id,
      status: "expired",
      stage: "done",
      stageLabel: "Findings ready",
      stopping: false,
      response: null,
      error: { code: "JOB_EXPIRED", message: "This investigation is no longer held. You can start a new one." },
      activity: [],
    };
  }

  private sweep(): void {
    const now = this.now();
    for (const job of [...this.jobs.values()]) {
      if (job.status === "running") continue;
      if (job.status === "queued" && now - job.createdAt > this.ttlMs && !this.durable) {
        job.controller.abort();
        this.finish(job, "expired", null, { code: "JOB_EXPIRED", message: "This investigation waited too long and was not started." });
      }
      if (this.durable) {
        // Memory only caches finished durable jobs; the database keeps them for the retention window.
        if (job.finishedAt !== null && now > job.expiresAt) this.jobs.delete(job.id);
        continue;
      }
      if (job.finishedAt !== null && now > job.expiresAt) {
        job.response = null;
        if (job.status !== "expired") {
          job.status = "expired";
          job.error = { code: "JOB_EXPIRED", message: "This investigation is no longer held. You can start a new one." };
        }
      }
      if (job.finishedAt !== null && now > job.expiresAt + this.ttlMs) this.jobs.delete(job.id);
    }
  }

  private view(job: Job): JobView {
    const recovering = job.status === "running" && job.scope !== null && job.scope.recovering && job.scope.unconsumed.size > 0;
    return {
      jobId: job.id,
      status: job.status,
      stage: job.stage,
      stageLabel: stageLabel(job.stage, job.intent, recovering),
      stopping: job.stopping,
      response: job.response,
      error: job.error,
      activity: job.status === "expired" ? [] : jobActivity(job.trace),
    };
  }
}

/** The public view of a durable job row (a job this process does not hold). */
export function durableView(row: JobRow): JobView {
  const response = (row.result as QueryResponse | null) ?? null;
  const trace = (response?.investigation?.result as AgentRunResponse | null | undefined)?.trace ?? null;
  const error = row.errorCode ? { code: row.errorCode, message: row.errorMessage ?? "" } : null;
  const base = { jobId: row.id, stopping: false, response, error, activity: row.status === "EXPIRED" ? [] : jobActivity(trace as AgentTrace | null) };
  switch (row.status) {
    case "QUEUED":
      return { ...base, status: "queued", stage: "queued", stageLabel: stageLabel("queued", row.intent), stopping: row.cancelRequested };
    case "RUNNING":
    case "RECOVERING":
      return { ...base, status: "running", stage: (row.stage as JobStage) ?? "investigating", stageLabel: row.status === "RECOVERING" ? "Resuming after a restart" : stageLabel(row.stage as JobStage, row.intent), stopping: row.cancelRequested };
    case "COMPLETED":
      return { ...base, status: "completed", stage: "done", stageLabel: "Findings ready" };
    case "CANCELLED":
      return { ...base, status: "cancelled", stage: "done", stageLabel: "Findings ready" };
    case "EXPIRED":
      return { ...base, status: "expired", stage: "done", stageLabel: "Findings ready", response: null, error: { code: "JOB_EXPIRED", message: "This investigation is no longer held. You can start a new one." } };
    default:
      return { ...base, status: "failed", stage: "done", stageLabel: "Findings ready" };
  }
}

async function runRequest(runner: InvestigationRunner, request: JobRequest, hooks: QueryHooks): Promise<QueryResponse> {
  if (request.kind === "confirm") return runner.confirm(request.queryId, hooks);
  if (request.kind === "continue") return runner.continueRun(request.runId, request.clarification, hooks);
  return runner.execute(request.body, { ...hooks, expectedBrandId: request.expectedBrandId, territoryGrounding: request.territoryGrounding, discoverySeeds: request.discoverySeeds });
}

function publicError(error: unknown): { code: string; message: string } {
  if (error instanceof QueryAlreadyExecutedError) return { code: "QUERY_ALREADY_EXECUTED", message: "That confirmation was already used." };
  if (error instanceof RunNotFoundError) return { code: "RUN_NOT_FOUND", message: "That investigation is no longer available." };
  if (error instanceof RunNotWaitingError) return { code: "RUN_NOT_WAITING", message: "That investigation is not waiting for an answer." };
  if (error instanceof AgentNotConfiguredError) return { code: "AGENT_NOT_CONFIGURED", message: "The investigation service is not configured." };
  if (error instanceof AgentInputError) return { code: "INVALID_AGENT_REQUEST", message: "The investigation could not accept that answer." };
  return { code: "JOB_FAILED", message: "The investigation failed before it could finish." };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
function isUuid(value: string): boolean {
  return UUID.test(value);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokenMatches(stored: string, presented: string): boolean {
  if (!presented) return false;
  const left = Buffer.from(stored);
  const right = Buffer.from(hashToken(presented));
  return left.length === right.length && timingSafeEqual(left, right);
}

function handoffOf(request: unknown): HandoffRecord | null {
  const handoff = (request as { handoff?: Partial<HandoffRecord> } | null)?.handoff;
  return handoff && typeof handoff.idempotencyKey === "string" && typeof handoff.requestKey === "string"
    ? { idempotencyKey: handoff.idempotencyKey, requestKey: handoff.requestKey, ...(handoff.plan !== undefined && { plan: handoff.plan }) }
    : null;
}
