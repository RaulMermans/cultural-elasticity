/** In-process operational counters. Not durable. Never stores access tokens or prompts. */

export type OpsEventName =
  | "job_accepted"
  | "job_queued"
  | "job_started"
  | "job_completed"
  | "job_failed"
  | "job_cancelled"
  | "job_expired"
  | "admission_rejected"
  | "provider_call_failed"
  | "budget_exceeded"
  | "backend_restart"
  | "result_unavailable";

export type LatencyBucket = { count: number; totalMs: number; maxMs: number };

export type OpsSnapshot = {
  events: Record<OpsEventName, number>;
  concurrentJobs: number;
  queueDepth: number;
  jobDuration: LatencyBucket;
  interpretationLatency: LatencyBucket;
  qlooCalls: number;
  modelTokens: { input: number; output: number };
  estimatedModelCostUsd: number;
  failureRate: number | null;
  cancellationRate: number | null;
  qlooProviderErrorRate: number | null;
  qlooCallsRecorded: number;
  qlooCallFailures: number;
};

const EVENT_NAMES: OpsEventName[] = [
  "job_accepted",
  "job_queued",
  "job_started",
  "job_completed",
  "job_failed",
  "job_cancelled",
  "job_expired",
  "admission_rejected",
  "provider_call_failed",
  "budget_exceeded",
  "backend_restart",
  "result_unavailable",
];

function emptyEvents(): Record<OpsEventName, number> {
  return Object.fromEntries(EVENT_NAMES.map((name) => [name, 0])) as Record<OpsEventName, number>;
}

function emptyBucket(): LatencyBucket {
  return { count: 0, totalMs: 0, maxMs: 0 };
}

function note(bucket: LatencyBucket, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  bucket.count += 1;
  bucket.totalMs += ms;
  if (ms > bucket.maxMs) bucket.maxMs = ms;
}

export class OpsMetrics {
  private readonly events = emptyEvents();
  private concurrentJobs = 0;
  private queueDepth = 0;
  private readonly jobDuration = emptyBucket();
  private readonly interpretationLatency = emptyBucket();
  private qlooCalls = 0;
  private qlooCallFailures = 0;
  private modelTokens = { input: 0, output: 0 };
  private estimatedModelCostUsd = 0;

  record(name: OpsEventName, extra: Record<string, unknown> = {}): void {
    this.events[name] += 1;
    if (name === "job_queued") this.queueDepth += 1;
    if (name === "job_started") {
      this.concurrentJobs += 1;
      this.queueDepth = Math.max(0, this.queueDepth - 1);
    }
    if (name === "job_completed" || name === "job_failed" || name === "job_cancelled" || name === "job_expired") {
      this.concurrentJobs = Math.max(0, this.concurrentJobs - 1);
    }
    if (typeof extra.durationMs === "number") note(this.jobDuration, extra.durationMs);
    if (typeof extra.interpretationLatencyMs === "number") note(this.interpretationLatency, extra.interpretationLatencyMs);
    if (typeof extra.qlooCalls === "number" && extra.qlooCalls > 0) this.qlooCalls += extra.qlooCalls;
    if (typeof extra.qlooCallFailures === "number" && extra.qlooCallFailures > 0) this.qlooCallFailures += extra.qlooCallFailures;
    if (typeof extra.inputTokens === "number") this.modelTokens.input += extra.inputTokens;
    if (typeof extra.outputTokens === "number") this.modelTokens.output += extra.outputTokens;
    if (typeof extra.estimatedModelCostUsd === "number" && extra.estimatedModelCostUsd > 0) {
      this.estimatedModelCostUsd += extra.estimatedModelCostUsd;
    }
  }

  setQueue(depth: number, running: number): void {
    this.queueDepth = Math.max(0, depth);
    this.concurrentJobs = Math.max(0, running);
  }

  snapshot(): OpsSnapshot {
    const finished = this.events.job_completed + this.events.job_failed + this.events.job_cancelled + this.events.job_expired;
    return {
      events: { ...this.events },
      concurrentJobs: this.concurrentJobs,
      queueDepth: this.queueDepth,
      jobDuration: { ...this.jobDuration },
      interpretationLatency: { ...this.interpretationLatency },
      qlooCalls: this.qlooCalls,
      modelTokens: { ...this.modelTokens },
      estimatedModelCostUsd: Math.round(this.estimatedModelCostUsd * 1_000_000) / 1_000_000,
      failureRate: finished === 0 ? null : this.events.job_failed / finished,
      cancellationRate: finished === 0 ? null : this.events.job_cancelled / finished,
      qlooProviderErrorRate: this.qlooCalls === 0 ? null : this.qlooCallFailures / this.qlooCalls,
      qlooCallsRecorded: this.qlooCalls,
      qlooCallFailures: this.qlooCallFailures,
    };
  }
}

let metrics = new OpsMetrics();

export function opsMetrics(): OpsMetrics {
  return metrics;
}

export function resetMetrics(): OpsMetrics {
  metrics = new OpsMetrics();
  return metrics;
}
