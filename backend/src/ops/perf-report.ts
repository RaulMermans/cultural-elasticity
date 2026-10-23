/**
 * Trace-based latency and waste report. Numbers come from spans and the existing agent metrics.
 * Does not invent missing timestamps on historical traces.
 */
import type { AgentAnalysisResult, AgentRunResponse, RuntimeSpan, RuntimeSpanPhase } from "@cultural-elasticity/shared";
import { HISTORICAL_LATENCY_NOT_FULLY_RECONSTRUCTABLE, percentile, reconcileSpanCoverage, type SpanCoverage } from "./spans.js";
import { reconcileLatency, type LatencyBreakdown } from "./latency.js";

const isAnalysis = (r: AgentRunResponse): r is AgentAnalysisResult => r.status !== "NEEDS_INPUT";

export type WasteClass = "NECESSARY_INVESTIGATION" | "AVOIDABLE_EXECUTION_WASTE";

export type WasteFinding = {
  kind: string;
  classification: WasteClass;
  detail: string;
  count: number;
};

export type TokenDistribution = {
  samples: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
  ceiling: number;
  truncated: number;
};

export type PerfReport = {
  runId: string;
  reconstructable: boolean;
  historicalNote: string | null;
  wallMs: number;
  naiveStages: LatencyBreakdown;
  spanCoverage: SpanCoverage | null;
  perTurn: { iteration: number; modelMs: number; toolMs: number; contextChars: number | null; invalidDecisions: number; repairs: number }[];
  toolCalls: { tool: string; count: number; p50Ms: number | null; p95Ms: number | null; maxMs: number | null };
  qloo: { calls: number; latencyMs: number; spacingMs: number; activeMs: number; cached: number; startupMs: number };
  model: { latencyMs: number; inputTokens: number; outputTokens: number; costUsd: number | null; effort: string | null };
  analysisMs: number;
  synthesisMs: number;
  context: { avgChars: number | null; maxChars: number | null };
  invalidOverhead: { invalidActions: number; repairs: number; rejectedToolCalls: number };
  waste: WasteFinding[];
  outcomes: {
    supportedFindings: number;
    validFull: number;
    invalidFull: number;
    partial: number;
    insufficient: number;
    supportedPerMinute: number | null;
    supportedPerQlooCall: number | null;
    validOutcomesPerDollar: number | null;
  };
};

function ofPhase(spans: readonly RuntimeSpan[], phase: RuntimeSpanPhase): RuntimeSpan[] {
  return spans.filter((s) => s.phase === phase);
}

function sum(spans: readonly RuntimeSpan[]): number {
  return spans.reduce((n, s) => n + s.durationMs, 0);
}

export function classifyWaste(result: AgentRunResponse): WasteFinding[] {
  const findings: WasteFinding[] = [];
  const calls = result.trace.toolCalls;
  const keys = new Map<string, number>();
  for (const c of calls.filter((x) => x.status !== "rejected")) {
    const key = `${c.tool}:${JSON.stringify(c.arguments)}`;
    keys.set(key, (keys.get(key) ?? 0) + 1);
  }
  const duplicates = [...keys.values()].filter((n) => n > 1).reduce((a, b) => a + (b - 1), 0);
  if (duplicates > 0) findings.push({ kind: "repeated_identical_executed_call", classification: "AVOIDABLE_EXECUTION_WASTE", detail: "identical tool arguments executed more than once (cache or DUPLICATE_ACTION should have stopped them)", count: duplicates });
  const rejected = calls.filter((c) => c.status === "rejected");
  const rejectedRepeat = new Map<string, number>();
  for (const c of rejected) {
    const key = `${c.error ?? c.summary}`;
    rejectedRepeat.set(key, (rejectedRepeat.get(key) ?? 0) + 1);
  }
  const unjustified = [...rejectedRepeat.entries()].filter(([, n]) => n >= 2);
  if (unjustified.length > 0) findings.push({ kind: "repeated_rejected_decision", classification: "AVOIDABLE_EXECUTION_WASTE", detail: unjustified.map(([k, n]) => `${n}× ${k.slice(0, 80)}`).join("; "), count: unjustified.reduce((n, [, c]) => n + c - 1, 0) });
  const emptyProbes = calls.filter((c) => c.tool === "qloo_recommend" && c.status === "empty");
  if (emptyProbes.length > 0) findings.push({ kind: "empty_exploratory_probe", classification: "NECESSARY_INVESTIGATION", detail: "an empty Qloo probe is rational exploration unless it repeats a refused type", count: emptyProbes.length });
  const late = calls.filter((c) => c.qlooOperations.some((o) => o.includes("late answer discarded")));
  if (late.length > 0) findings.push({ kind: "late_qloo_answer_discarded", classification: "AVOIDABLE_EXECUTION_WASTE", detail: "a timed-out call's late answer was discarded and still counted against the budget", count: late.length });
  const repairs = result.trace.turns.filter((t) => (t.modelAttempts ?? 1) > 1).length;
  if (repairs > 0) findings.push({ kind: "repair_loop", classification: repairs > 3 ? "AVOIDABLE_EXECUTION_WASTE" : "NECESSARY_INVESTIGATION", detail: "bounded one-shot repair after a validator rejection", count: repairs });
  const cached = calls.flatMap((c) => c.qlooOperations.filter((o) => o.includes("cached"))).length;
  if (cached > 0) findings.push({ kind: "cache_hit", classification: "NECESSARY_INVESTIGATION", detail: "identical Qloo requests answered from the run cache", count: cached });
  return findings;
}

export function supportedFindingCount(result: AgentRunResponse): number {
  if (!isAnalysis(result)) return 0;
  return result.territories.filter((t) => t.analysisRoute === "FULL_RELATIVE_ANALYSIS" || t.analysisRoute === "PARTIAL_CULTURAL_ANALYSIS").length;
}

export function buildPerfReport(result: AgentRunResponse): PerfReport {
  const m = result.metrics;
  const spans = result.trace.spans ?? [];
  const naive = reconcileLatency({
    latencyMs: m.latency_ms,
    modelLatencyMs: m.model_latency_ms,
    qlooLatencyMs: m.qloo_latency_ms,
    qlooSpacingMs: m.qloo_spacing_ms ?? 0,
    analysisLatencyMs: m.analysis_latency_ms ?? 0,
    synthesisLatencyMs: m.synthesis_latency_ms ?? 0,
  });
  const reconstructable = spans.length > 0;
  const spanCoverage = reconstructable
    ? reconcileSpanCoverage(spans, m.latency_ms, m.monotonic_elapsed_ms ?? spans.reduce((n, s) => Math.max(n, s.startOffsetMs + s.durationMs), 0))
    : null;
  const perTurn = result.trace.turns.map((t) => ({
    iteration: t.iteration,
    modelMs: t.latencyMs,
    toolMs: result.trace.toolCalls.filter((c) => c.iteration === t.iteration).reduce((n, c) => n + c.latencyMs, 0),
    contextChars: t.contextChars ?? null,
    invalidDecisions: t.decisions.filter((d) => !d.accepted).length + (t.invalidOutput ? 1 : 0),
    repairs: (t.modelAttempts ?? 1) > 1 ? 1 : 0,
  }));
  const toolMs = result.trace.toolCalls.map((c) => c.latencyMs);
  const cached = result.trace.toolCalls.flatMap((c) => c.qlooOperations.filter((o) => o.includes("cached"))).length;
  const supported = supportedFindingCount(result);
  const minutes = m.latency_ms > 0 ? m.latency_ms / 60_000 : 0;
  const validFull = isAnalysis(result) ? result.territories.filter((t) => t.analysisRoute === "FULL_RELATIVE_ANALYSIS").length : 0;
  return {
    runId: result.runId,
    reconstructable,
    historicalNote: reconstructable ? null : HISTORICAL_LATENCY_NOT_FULLY_RECONSTRUCTABLE,
    wallMs: m.latency_ms,
    naiveStages: naive,
    spanCoverage,
    perTurn,
    toolCalls: {
      tool: "all",
      count: result.trace.toolCalls.length,
      p50Ms: percentile(toolMs, 50),
      p95Ms: percentile(toolMs, 95),
      maxMs: toolMs.length ? Math.max(...toolMs) : null,
    },
    qloo: {
      calls: m.qloo_calls,
      latencyMs: m.qloo_latency_ms,
      spacingMs: m.qloo_spacing_ms ?? 0,
      activeMs: Math.max(0, m.qloo_latency_ms - (m.qloo_spacing_ms ?? 0)),
      cached,
      startupMs: sum(ofPhase(spans, "QLOO_TRANSPORT_STARTUP")),
    },
    model: {
      latencyMs: m.model_latency_ms,
      inputTokens: m.model_input_tokens,
      outputTokens: m.model_output_tokens,
      costUsd: m.model_cost_usd,
      effort: m.model_effort ?? result.model?.effort ?? null,
    },
    analysisMs: m.analysis_latency_ms ?? 0,
    synthesisMs: m.synthesis_latency_ms ?? 0,
    context: { avgChars: m.avg_context_chars, maxChars: m.max_context_chars },
    invalidOverhead: {
      invalidActions: m.invalid_actions,
      repairs: m.repairs,
      rejectedToolCalls: result.trace.toolCalls.filter((c) => c.status === "rejected").length,
    },
    waste: classifyWaste(result),
    outcomes: {
      supportedFindings: supported,
      validFull,
      invalidFull: 0,
      partial: isAnalysis(result) ? result.territories.filter((t) => t.analysisRoute === "PARTIAL_CULTURAL_ANALYSIS").length : 0,
      insufficient: isAnalysis(result) ? result.territories.filter((t) => t.analysisRoute === "INSUFFICIENT_EVIDENCE").length : 0,
      supportedPerMinute: minutes > 0 ? Math.round((supported / minutes) * 1000) / 1000 : null,
      supportedPerQlooCall: m.qloo_calls > 0 ? Math.round((supported / m.qloo_calls) * 1000) / 1000 : null,
      validOutcomesPerDollar: m.model_cost_usd && m.model_cost_usd > 0 ? Math.round((supported / m.model_cost_usd) * 1000) / 1000 : null,
    },
  };
}

export function formatPerfReport(report: PerfReport): string {
  const cov = report.spanCoverage;
  const lines = [
    `run ${report.runId}`,
    `wall ${report.wallMs} ms  reconstructable=${report.reconstructable}`,
    report.historicalNote ? report.historicalNote : `span coverage ${cov?.coverageRatio ?? "n/a"} covered ${cov?.coveredMs ?? 0} unattributed ${cov?.unattributedMs ?? 0} skew ${cov?.clockSkewMs ?? 0}`,
    `naive stages model=${report.naiveStages.stages.modelMs} qloo=${report.naiveStages.stages.qlooMs} analysis=${report.naiveStages.stages.analysisMs} synthesis=${report.naiveStages.stages.synthesisMs} residual=${report.naiveStages.unattributedMs}`,
    `model tokens in=${report.model.inputTokens} out=${report.model.outputTokens} cost=${report.model.costUsd ?? "n/a"} effort=${report.model.effort ?? "n/a"}`,
    `supported ${report.outcomes.supportedFindings} /min ${report.outcomes.supportedPerMinute ?? "n/a"} /qloo ${report.outcomes.supportedPerQlooCall ?? "n/a"} /$ ${report.outcomes.validOutcomesPerDollar ?? "n/a"}`,
    ...report.waste.map((w) => `waste ${w.classification} ${w.kind} ×${w.count}: ${w.detail}`),
  ];
  return lines.join("\n");
}
