/**
 * Wall-clock reconciliation for an investigation. Stage clocks may overlap; they are never summed
 * as independent components of elapsed time.
 */
export type LatencyStages = {
  latencyMs: number;
  modelLatencyMs: number;
  qlooLatencyMs: number;
  qlooSpacingMs: number;
  analysisLatencyMs: number;
  synthesisLatencyMs: number;
  interpretationLatencyMs?: number;
  turnWallMs?: number;
};

export type LatencyBreakdown = {
  wallMs: number;
  stages: {
    modelMs: number;
    qlooMs: number;
    qlooSpacingMs: number;
    qlooActiveMs: number;
    analysisMs: number;
    synthesisMs: number;
    interpretationMs: number;
  };
  /** model + qloo + analysis + synthesis. Overlap makes this able to exceed wall time. */
  naiveSumMs: number;
  /** max(0, wall - naiveSum) when stages are treated as sequential; 0 when they overlap. */
  unattributedMs: number;
  overlapMs: number;
  note: string;
};

export function reconcileLatency(stages: LatencyStages): LatencyBreakdown {
  const wallMs = Math.max(0, stages.latencyMs);
  const modelMs = Math.max(0, stages.modelLatencyMs);
  const qlooMs = Math.max(0, stages.qlooLatencyMs);
  const qlooSpacingMs = Math.max(0, stages.qlooSpacingMs);
  const analysisMs = Math.max(0, stages.analysisLatencyMs);
  const synthesisMs = Math.max(0, stages.synthesisLatencyMs);
  const interpretationMs = Math.max(0, stages.interpretationLatencyMs ?? 0);
  const naiveSumMs = modelMs + qlooMs + analysisMs + synthesisMs;
  const overlapMs = Math.max(0, naiveSumMs - wallMs);
  const unattributedMs = Math.max(0, wallMs - naiveSumMs);
  const qlooActiveMs = Math.max(0, qlooMs - qlooSpacingMs);
  const note =
    overlapMs > 0
      ? "Stage clocks overlap; do not add them as independent parts of wall time."
      : unattributedMs > 0
        ? "Unattributed time includes turn overhead, context assembly, retries, queue wait outside the agent, and waits between decisions."
        : "Attributed stages cover wall time without a remainder.";
  return {
    wallMs,
    stages: { modelMs, qlooMs, qlooSpacingMs, qlooActiveMs, analysisMs, synthesisMs, interpretationMs },
    naiveSumMs,
    unattributedMs,
    overlapMs,
    note,
  };
}
