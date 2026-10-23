/**
 * Low-overhead monotonic span recorder for one investigation.
 *
 * Wall time (`Date.now`) can jump if the host sleeps. Span durations always use `performance.now`.
 * A historical trace without `trace.spans` is HISTORICAL_LATENCY_NOT_FULLY_RECONSTRUCTABLE.
 */
import { randomUUID } from "node:crypto";
import type { RuntimeSpan, RuntimeSpanOutcome, RuntimeSpanPhase } from "@cultural-elasticity/shared";

export const HISTORICAL_LATENCY_NOT_FULLY_RECONSTRUCTABLE = "HISTORICAL_LATENCY_NOT_FULLY_RECONSTRUCTABLE";

export type SpanStart = {
  runId: string;
  phase: RuntimeSpanPhase;
  operation: string;
  turnIndex?: number | null;
  parentSpanId?: string | null;
};

export type SpanHandle = {
  spanId: string;
  end: (outcome?: RuntimeSpanOutcome, errorCode?: string) => RuntimeSpan;
};

type OpenSpan = {
  span: Omit<RuntimeSpan, "durationMs" | "outcome" | "errorCode"> & { outcome?: RuntimeSpanOutcome; errorCode?: string };
  startMono: number;
};

const round = (n: number) => Math.max(0, Math.round(n));

export class SpanRecorder {
  readonly originMono: number;
  readonly originWall: number;
  private seq = 0;
  private readonly open = new Map<string, OpenSpan>();
  private readonly completed: RuntimeSpan[] = [];

  constructor(
    readonly runId: string,
    readonly nowMono: () => number = () => performance.now(),
    readonly nowWall: () => number = () => Date.now(),
  ) {
    this.originMono = this.nowMono();
    this.originWall = this.nowWall();
  }

  offsetMs(): number {
    return round(this.nowMono() - this.originMono);
  }

  wallElapsedMs(): number {
    return round(this.nowWall() - this.originWall);
  }

  monotonicElapsedMs(): number {
    return this.offsetMs();
  }

  start(input: SpanStart): SpanHandle {
    this.seq += 1;
    const spanId = `s-${this.seq}-${randomUUID().slice(0, 8)}`;
    const startMono = this.nowMono();
    const open: OpenSpan = {
      startMono,
      span: {
        spanId,
        parentSpanId: input.parentSpanId ?? null,
        runId: input.runId,
        turnIndex: input.turnIndex ?? null,
        phase: input.phase,
        operation: input.operation,
        startOffsetMs: round(startMono - this.originMono),
      },
    };
    this.open.set(spanId, open);
    return {
      spanId,
      end: (outcome: RuntimeSpanOutcome = "ok", errorCode?: string) => this.close(spanId, outcome, errorCode),
    };
  }

  /** Record a span whose duration was measured elsewhere (spacing waits, provider startup). */
  record(input: SpanStart & { startOffsetMs: number; durationMs: number; outcome?: RuntimeSpanOutcome; errorCode?: string }): RuntimeSpan {
    this.seq += 1;
    const span: RuntimeSpan = {
      spanId: `s-${this.seq}-${randomUUID().slice(0, 8)}`,
      parentSpanId: input.parentSpanId ?? null,
      runId: input.runId,
      turnIndex: input.turnIndex ?? null,
      phase: input.phase,
      operation: input.operation,
      startOffsetMs: round(input.startOffsetMs),
      durationMs: round(input.durationMs),
      outcome: input.outcome ?? "ok",
      ...(input.errorCode && { errorCode: input.errorCode }),
    };
    this.completed.push(span);
    return span;
  }

  async measure<T>(input: SpanStart, fn: () => Promise<T>, outcomeOf?: (value: T) => RuntimeSpanOutcome): Promise<T> {
    const handle = this.start(input);
    try {
      const value = await fn();
      handle.end(outcomeOf ? outcomeOf(value) : "ok");
      return value;
    } catch (error) {
      const code = error instanceof Error && error.message.startsWith("TOOL_TIMEOUT") ? "TOOL_TIMEOUT" : "SPAN_ERROR";
      handle.end(code === "TOOL_TIMEOUT" ? "timeout" : "error", code);
      throw error;
    }
  }

  measureSync<T>(input: SpanStart, fn: () => T): T {
    const handle = this.start(input);
    try {
      const value = fn();
      handle.end("ok");
      return value;
    } catch (error) {
      handle.end("error", error instanceof Error ? error.name : "SPAN_ERROR");
      throw error;
    }
  }

  flush(outcome: RuntimeSpanOutcome = "cancelled"): void {
    for (const id of [...this.open.keys()]) this.close(id, outcome, outcome === "cancelled" ? "INVESTIGATION_CANCELLED" : undefined);
  }

  snapshot(): RuntimeSpan[] {
    return [...this.completed];
  }

  private close(spanId: string, outcome: RuntimeSpanOutcome, errorCode?: string): RuntimeSpan {
    const open = this.open.get(spanId);
    if (!open) {
      const existing = this.completed.find((s) => s.spanId === spanId);
      if (existing) return existing;
      throw new Error(`unknown span ${spanId}`);
    }
    this.open.delete(spanId);
    const span: RuntimeSpan = {
      ...open.span,
      durationMs: round(this.nowMono() - open.startMono),
      outcome,
      ...(errorCode && { errorCode }),
    };
    this.completed.push(span);
    return span;
  }
}

const recorders = new WeakMap<object, SpanRecorder>();

export function attachRecorder(host: object, runId: string, recorder?: SpanRecorder): SpanRecorder {
  const existing = recorders.get(host);
  if (existing) return existing;
  const created = recorder ?? new SpanRecorder(runId);
  recorders.set(host, created);
  return created;
}

export function recorderOf(host: object): SpanRecorder | undefined {
  return recorders.get(host);
}

export function requireRecorder(host: object, runId: string): SpanRecorder {
  return attachRecorder(host, runId);
}

export type Interval = { start: number; end: number };

export function spanInterval(span: RuntimeSpan): Interval {
  return { start: span.startOffsetMs, end: span.startOffsetMs + span.durationMs };
}

/** Union of half-open intervals. Overlap is counted once. */
export function unionDuration(intervals: readonly Interval[]): number {
  const ordered = intervals
    .map((i) => ({ start: Math.min(i.start, i.end), end: Math.max(i.start, i.end) }))
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (ordered.length === 0) return 0;
  let covered = 0;
  let cur = { ...ordered[0]! };
  for (const next of ordered.slice(1)) {
    if (next.start <= cur.end) {
      cur.end = Math.max(cur.end, next.end);
    } else {
      covered += cur.end - cur.start;
      cur = { ...next };
    }
  }
  return covered + (cur.end - cur.start);
}

export function overlapDuration(intervals: readonly Interval[]): number {
  const sum = intervals.reduce((n, i) => n + Math.max(0, i.end - i.start), 0);
  return Math.max(0, sum - unionDuration(intervals));
}

export function exclusiveDuration(parent: Interval, children: readonly Interval[]): number {
  const clipped = children
    .map((c) => ({ start: Math.max(c.start, parent.start), end: Math.min(c.end, parent.end) }))
    .filter((c) => c.end > c.start);
  return Math.max(0, parent.end - parent.start - unionDuration(clipped));
}

export type PhaseExclusive = { phase: RuntimeSpanPhase; exclusiveMs: number; inclusiveMs: number; count: number };

export type SpanCoverage = {
  wallMs: number;
  monotonicElapsedMs: number;
  coveredMs: number;
  unattributedMs: number;
  overlapMs: number;
  clockSkewMs: number;
  coverageRatio: number | null;
  exclusiveByPhase: PhaseExclusive[];
  note: string;
};

const MARKERS = new Set<RuntimeSpanPhase>(["RUN_START", "RUN_END"]);
/** Measured before AgentRuntime.run origin; reported separately, never part of run-wall coverage. */
const PRE_RUN = new Set<RuntimeSpanPhase>(["QUEUE_ADMISSION", "QUERY_INTERPRETATION"]);

/**
 * Reconcile wall time with the union of measured activity. Nested children are not double-counted.
 * Marker spans (duration 0) do not contribute coverage.
 */
export function reconcileSpanCoverage(spans: readonly RuntimeSpan[], wallMs: number, monotonicElapsedMs: number): SpanCoverage {
  const activity = spans.filter((s) => !MARKERS.has(s.phase) && !PRE_RUN.has(s.phase) && s.durationMs > 0);
  const intervals = activity.map(spanInterval);
  const coveredMs = round(unionDuration(intervals));
  const overlapMs = round(overlapDuration(intervals));
  const clockSkewMs = Math.max(0, round(wallMs) - round(monotonicElapsedMs));
  const unattributedMs = Math.max(0, round(monotonicElapsedMs) - coveredMs);
  const coverageRatio = monotonicElapsedMs > 0 ? Math.round((coveredMs / monotonicElapsedMs) * 1000) / 1000 : null;
  const byPhase = new Map<RuntimeSpanPhase, { exclusiveMs: number; inclusiveMs: number; count: number }>();
  for (const span of activity) {
    const children = activity.filter((s) => s.parentSpanId === span.spanId);
    const exclusiveMs = exclusiveDuration(spanInterval(span), children.map(spanInterval));
    const cur = byPhase.get(span.phase) ?? { exclusiveMs: 0, inclusiveMs: 0, count: 0 };
    cur.exclusiveMs += exclusiveMs;
    cur.inclusiveMs += span.durationMs;
    cur.count += 1;
    byPhase.set(span.phase, cur);
  }
  const exclusiveByPhase = [...byPhase.entries()]
    .map(([phase, v]) => ({ phase, exclusiveMs: round(v.exclusiveMs), inclusiveMs: round(v.inclusiveMs), count: v.count }))
    .sort((a, b) => b.exclusiveMs - a.exclusiveMs || a.phase.localeCompare(b.phase));
  const note =
    spans.length === 0
      ? HISTORICAL_LATENCY_NOT_FULLY_RECONSTRUCTABLE
      : coverageRatio !== null && coverageRatio >= 0.95
        ? "Measured spans cover at least 95% of monotonic elapsed time."
        : "Unattributed monotonic time is a gap between measured spans (scheduling, uninstrumented work), not a second copy of nested activity.";
  return {
    wallMs: round(wallMs),
    monotonicElapsedMs: round(monotonicElapsedMs),
    coveredMs,
    unattributedMs,
    overlapMs,
    clockSkewMs,
    coverageRatio,
    exclusiveByPhase,
    note,
  };
}

export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? null;
}

export function redactSpan(span: RuntimeSpan): RuntimeSpan {
  return {
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    runId: span.runId,
    turnIndex: span.turnIndex,
    phase: span.phase,
    operation: span.operation.slice(0, 80),
    startOffsetMs: span.startOffsetMs,
    durationMs: span.durationMs,
    outcome: span.outcome,
    ...(span.errorCode && { errorCode: span.errorCode.slice(0, 80) }),
  };
}
