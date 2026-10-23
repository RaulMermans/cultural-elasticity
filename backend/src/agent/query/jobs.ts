/**
 * In-process investigations for the Living Atlas.
 *
 * Deployment contract: this requires a continuously running Node.js process. Jobs live in memory. A restart drops
 * them; nothing here is a queue, a database, or a claim of durable execution. Serverless hosts that freeze the
 * process after the HTTP response must not use this manager.
 *
 * The work itself is QueryService / AgentRuntime. A job only detaches that work from the HTTP connection, bounds how
 * many run at once, and carries an opaque access token. Qloo calls stay serialized by the shared tool provider.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { QueryResponse } from "@cultural-elasticity/shared";
import { AgentInputError, AgentNotConfiguredError, RunNotFoundError, RunNotWaitingError } from "../errors.js";
import { observedUsage } from "../../ops/usage.js";
import type { QueryBody } from "./contracts.js";
import { QueryAlreadyExecutedError, type QueryHooks, type QueryProgress } from "./service.js";

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
};

export type JobCreated = JobView & { accessToken: string };

export type JobRequest =
  | { kind: "execute"; body: QueryBody; model: string }
  | { kind: "confirm"; queryId: string; model: string }
  | { kind: "continue"; runId: string; clarification: string; model: string };

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

export type JobManagerOptions = {
  runnerFor: (model: string) => InvestigationRunner;
  maxRunning?: number;
  maxQueued?: number;
  /** How long a finished job can still be read. */
  ttlMs?: number;
  /** Aborts a running investigation at the next turn boundary. */
  maxRunMs?: number;
  now?: () => number;
  log?: (event: Record<string, unknown>) => void;
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
  controller: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
};

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_RUN_MS = 20 * 60 * 1000;

export function stageLabel(stage: JobStage, intent: string | null): string {
  if (stage === "queued") return "Waiting to start";
  if (stage === "interpreting") return "Interpreting question";
  if (stage === "investigating") return intent === "compare_territories" ? "Evaluating comparisons" : "Investigating available evidence";
  if (stage === "preparing") return "Preparing findings";
  return "Findings ready";
}

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

  constructor(private readonly options: JobManagerOptions) {
    this.maxRunning = options.maxRunning ?? 2;
    this.maxQueued = options.maxQueued ?? 4;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxRunMs = options.maxRunMs ?? DEFAULT_MAX_RUN_MS;
    this.now = options.now ?? Date.now;
    if (!options.now) {
      const timer = setInterval(() => this.sweep(), 60_000);
      timer.unref?.();
    }
  }

  create(request: JobRequest): JobCreated {
    this.sweep();
    if (request.kind === "confirm" && this.confirms.has(request.queryId)) {
      throw new JobRejectedError(409, "query_already_executed", "That confirmation is already running.");
    }
    if (this.running >= this.maxRunning && this.queue.length >= this.maxQueued) {
      throw new JobRejectedError(429, "too_many_investigations", "Too many investigations are already in progress.");
    }
    const now = this.now();
    const accessToken = randomBytes(32).toString("base64url");
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
      expiresAt: now + this.maxRunMs + this.ttlMs,
      controller: new AbortController(),
      timer: null,
    };
    this.jobs.set(job.id, job);
    if (request.kind === "confirm") this.confirms.add(request.queryId);
    this.queue.push(job);
    this.options.log?.({ jobId: job.id, status: job.status, kind: request.kind, event: "job_queued" });
    this.pump();
    return { ...this.view(job), accessToken };
  }

  counts(): { running: number; queued: number; held: number } {
    return { running: this.running, queued: this.queue.filter((job) => job.status === "queued").length, held: this.jobs.size };
  }

  /** Stops new work and aborts queued or running jobs. Finished results stay readable until TTL. */
  shutdown(message = "The investigation service is stopping."): void {
    for (const job of this.jobs.values()) {
      if (job.status !== "queued" && job.status !== "running") continue;
      job.abortReason = "shutdown";
      job.stopping = true;
      job.controller.abort();
      if (job.status === "queued") {
        this.finish(job, "cancelled", null, { code: "BACKEND_RESTART", message });
      }
    }
  }

  /** Returns null when the id is unknown or the token does not match. The two cases are not distinguished. */
  get(id: string, token: string): JobView | null {
    const job = this.jobs.get(id);
    if (job && tokenMatches(job.tokenHash, token) && job.finishedAt !== null && this.now() > job.expiresAt) {
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

  cancel(id: string, token: string): JobView | null {
    const job = this.jobs.get(id);
    if (!job || !tokenMatches(job.tokenHash, token)) return null;
    if (job.status !== "queued" && job.status !== "running") return this.view(job);
    job.abortReason = "user";
    job.stopping = true;
    job.controller.abort();
    job.updatedAt = this.now();
    if (job.status === "queued") this.finish(job, "cancelled", null, { code: "INVESTIGATION_CANCELLED", message: "Cancelled before it started." });
    return this.view(job);
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
    this.options.log?.({ jobId: job.id, status: job.status, event: "job_started" });
    const timer = setTimeout(() => {
      job.abortReason = "timeout";
      job.controller.abort();
    }, this.maxRunMs);
    timer.unref?.();
    job.timer = timer;
    void this.execute(job).finally(() => {
      this.running -= 1;
      if (job.timer) clearTimeout(job.timer);
      job.timer = null;
      this.pump();
    });
  }

  private async execute(job: Job): Promise<void> {
    const hooks: QueryHooks = {
      signal: job.controller.signal,
      onProgress: (event) => this.note(job, event),
      onPreview: (response) => {
        if (job.controller.signal.aborted || job.status !== "running") return;
        job.response = structuredClone(response);
        job.updatedAt = this.now();
      },
    };
    try {
      const runner = this.options.runnerFor(job.request.model);
      const response = await runRequest(runner, job.request, hooks);
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
    };
  }

  private sweep(): void {
    const now = this.now();
    for (const job of [...this.jobs.values()]) {
      if (job.status === "running") continue;
      if (job.status === "queued" && now - job.createdAt > this.ttlMs) {
        job.controller.abort();
        this.finish(job, "expired", null, { code: "JOB_EXPIRED", message: "This investigation waited too long and was not started." });
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
    return {
      jobId: job.id,
      status: job.status,
      stage: job.stage,
      stageLabel: stageLabel(job.stage, job.intent),
      stopping: job.stopping,
      response: job.response,
      error: job.error,
    };
  }
}

async function runRequest(runner: InvestigationRunner, request: JobRequest, hooks: QueryHooks): Promise<QueryResponse> {
  if (request.kind === "confirm") return runner.confirm(request.queryId, hooks);
  if (request.kind === "continue") return runner.continueRun(request.runId, request.clarification, hooks);
  return runner.execute(request.body, hooks);
}

function publicError(error: unknown): { code: string; message: string } {
  if (error instanceof QueryAlreadyExecutedError) return { code: "QUERY_ALREADY_EXECUTED", message: "That confirmation was already used." };
  if (error instanceof RunNotFoundError) return { code: "RUN_NOT_FOUND", message: "That investigation is no longer available." };
  if (error instanceof RunNotWaitingError) return { code: "RUN_NOT_WAITING", message: "That investigation is not waiting for an answer." };
  if (error instanceof AgentNotConfiguredError) return { code: "AGENT_NOT_CONFIGURED", message: "The investigation service is not configured." };
  if (error instanceof AgentInputError) return { code: "INVALID_AGENT_REQUEST", message: "The investigation could not accept that answer." };
  return { code: "JOB_FAILED", message: "The investigation failed before it could finish." };
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
