/**
 * Finalization: deterministic results first, model synthesis second, claim validation last.
 *
 *   every territory gets a result (unanalyzed ones: INSUFFICIENT_EVIDENCE with the reason)
 *   ─→ FinalizationContext (results only; the runtime has no benchmark labels to leak)
 *   ─→ model synthesis ─→ schema + claim validation ─→ one retry with the violations
 *   ─→ otherwise a deterministic template (which must pass the same validator)
 * The synthesis can explain results. It cannot change a route, class, level or number: those are
 * copied from deterministic code into the result regardless of what the model wrote.
 */
import { AGENT_RESULT_SCHEMA_VERSION, type AgentAnalysisResult, type AgentMetrics, type AgentNeedsInputResponse, type AgentTerritoryResult, type Limitation } from "@cultural-elasticity/shared";
import { unanalyzedResult } from "./analysis-runner.js";
import { validateClaims } from "./claim-validator.js";
import { synthesisSchema, type Synthesis } from "./contracts.js";
import { assessEvidenceSufficiency } from "./evidence-sufficiency.js";
import type { AgentModel, FinalizationContext } from "./model/provider.js";
import { synthesisTerritoryView } from "./prompts.js";
import type { AgentRunState } from "./state.js";

const CLASS_PHRASE: Record<string, string> = {
  NATURAL_ADJACENCY: "natural adjacency",
  CREDIBLE_STRETCH: "credible stretch",
  UNCERTAIN_REPRESENTATION_SENSITIVE: "uncertain (representation-sensitive)",
  CULTURAL_BREAK: "cultural break",
  INSUFFICIENT_EVIDENCE: "insufficient evidence",
};

const ROUTE_PHRASE: Record<string, string> = {
  FULL_RELATIVE_ANALYSIS: "full relative analysis",
  PARTIAL_CULTURAL_ANALYSIS: "partial cultural analysis (brand-conditioned evidence and shared signals, no relative position)",
  DESCRIPTIVE_ANALYSIS: "descriptive evidence only (no relative position)",
  INSUFFICIENT_EVIDENCE: "not measurable with the Qloo evidence available",
};

export function territoryOrder(results: AgentTerritoryResult[]): AgentTerritoryResult[] {
  const role = { target: 0, frontier_candidate: 1, reference: 2 } as const;
  const route = { FULL_RELATIVE_ANALYSIS: 0, PARTIAL_CULTURAL_ANALYSIS: 1, DESCRIPTIVE_ANALYSIS: 2, INSUFFICIENT_EVIDENCE: 3 } as const;
  return [...results].sort((a, b) => role[a.role] - role[b.role] || route[a.analysisRoute] - route[b.analysisRoute] || (a.relativePosition?.position ?? 99) - (b.relativePosition?.position ?? 99) || a.key.localeCompare(b.key));
}

/** A synthesis built only from deterministic values. It must always pass validateClaims. */
export function templateSynthesis(brandLabel: string | null, results: AgentTerritoryResult[]): Synthesis {
  const lines = results.map((r) => {
    if (r.analysisRoute === "FULL_RELATIVE_ANALYSIS" && r.relativePosition && r.classification && r.robustness && r.comparisonSet) {
      return `${r.label}: position ${r.relativePosition.position ?? "n/a"} of ${r.relativePosition.of} within ${r.comparisonSet.labels.join(", ")}; provisional class ${CLASS_PHRASE[r.classification.label]} relative to that set, with ${r.robustness.level.toLowerCase()} robustness.`;
    }
    if (r.analysisRoute === "INSUFFICIENT_EVIDENCE") return `${r.label}: ${ROUTE_PHRASE[r.analysisRoute]} (${r.representation.failure?.code ?? "no evidence"}).`;
    return `${r.label}: ${ROUTE_PHRASE[r.analysisRoute]}.`;
  });
  const head = `${brandLabel ?? "The brand"}: ${results.length} territory result(s), each reported only to the extent its Qloo evidence supports. Classes are provisional and relative to their comparison set; these results describe cultural-affinity evidence, not commercial outcomes.`;
  return { summary: [head, ...lines].join("\n"), territoryNotes: [], followUpOptions: templateFollowUps(results) };
}

function templateFollowUps(results: AgentTerritoryResult[]): string[] {
  const out: string[] = [];
  for (const r of results) {
    if (r.robustness && (r.robustness.level === "LOW" || r.robustness.level === "INSUFFICIENT")) out.push(`Add or swap exemplars for ${r.label} to test whether its position holds.`);
    else if (r.analysisRoute === "PARTIAL_CULTURAL_ANALYSIS" || r.analysisRoute === "DESCRIPTIVE_ANALYSIS") out.push(`Add represented reference territories of the same entity type so ${r.label} can be placed in a comparison set.`);
    else if (r.analysisRoute === "INSUFFICIENT_EVIDENCE") out.push(`Rephrase ${r.label} as a concept Qloo recognises, or name example entities for it.`);
  }
  out.push("Review the exemplar choices behind each territory before acting on any class.");
  return [...new Set(out)].slice(0, 6);
}

export function computeMetrics(state: AgentRunState, results: AgentTerritoryResult[]): AgentMetrics {
  const calls = state.trace.toolCalls;
  const executed = calls.filter((c) => c.status !== "rejected");
  const succeeded = executed.filter((c) => c.status === "ok" || c.status === "empty");
  const count = (route: string) => results.filter((r) => r.analysisRoute === route).length;
  return {
    agent_iterations: state.usage.iterations,
    qloo_calls: state.usage.qlooCalls,
    tool_calls: calls.length,
    tool_success_rate: executed.length === 0 ? null : Math.round((succeeded.length / executed.length) * 1000) / 1000,
    invalid_actions: state.trace.turns.reduce((n, t) => n + t.decisions.filter((d) => !d.accepted).length + (t.invalidOutput ? 1 : 0), 0),
    representation_attempts: state.territories.reduce((n, t) => n + t.attempts, 0),
    territories_proposed: state.territories.length,
    territories_resolved: state.territories.filter((t) => t.concept !== null).length,
    territories_rejected: state.territories.filter((t) => t.status === "dropped" || t.concept === null).length,
    full_analysis_count: count("FULL_RELATIVE_ANALYSIS"),
    partial_analysis_count: count("PARTIAL_CULTURAL_ANALYSIS"),
    descriptive_analysis_count: count("DESCRIPTIVE_ANALYSIS"),
    unsupported_count: count("INSUFFICIENT_EVIDENCE"),
    methodology_calls: state.methodologyRuns.length,
    latency_ms: Date.now() - state.startedAt,
    model_input_tokens: state.usage.inputTokens,
    model_output_tokens: state.usage.outputTokens,
    retry_count: state.usage.retries,
    budget_exhausted: state.status === "BUDGET_EXHAUSTED",
  };
}

function runLimitations(state: AgentRunState, results: AgentTerritoryResult[]): Limitation[] {
  const out: Limitation[] = [
    { code: "NOT_A_SUCCESS_PREDICTION", detail: "nothing here predicts commercial success, purchase intent or any individual's preference" },
    { code: "NO_APPROVED_SCORE", detail: "no 0–100 score exists (Relative Elasticity Index REJECTED_FOR_NOW); results are positions, robustness, coherence, quality and provisional classes" },
  ];
  if (results.some((r) => r.analysisRoute === "FULL_RELATIVE_ANALYSIS")) out.push({ code: "RELATIVE_TO_COMPARISON_SET", detail: "positions and classes hold only for the comparison set shown with each territory" });
  if (state.toolProvider.mode === "scripted") out.push({ code: "SYNTHETIC_EVIDENCE", detail: "evidence came from the scripted SYNTHETIC world, not from Qloo; never cite it as Qloo evidence" });
  if (state.model.kind !== "llm") out.push({ code: "AGENT_POLICY_NOT_LLM", detail: `investigation decisions were made by the deterministic ${state.model.kind} policy "${state.model.id}", not by a live language model` });
  const seen = new Set<string>();
  for (const flag of state.flags) {
    const key = `${flag.code}|${flag.detail}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(flag);
    }
  }
  return out;
}

export function allResults(state: AgentRunState): AgentTerritoryResult[] {
  const code = state.status === "BUDGET_EXHAUSTED" ? "BUDGET_EXHAUSTED" : "NOT_INVESTIGATED";
  return territoryOrder(state.territories.map((t) => state.results.get(t.key) ?? unanalyzedResult(state, t, code)));
}

export async function finalize(state: AgentRunState, model: AgentModel): Promise<AgentAnalysisResult> {
  const results = allResults(state);
  state.trace.territoryHypotheses = state.territories.map((t) => ({ key: t.key, label: t.label, role: t.role, origin: t.origin, status: t.dropReason ? `dropped (${t.dropReason.code})` : t.status, rationale: t.rationale }));
  const sufficiency = assessEvidenceSufficiency(state).verdict;
  const brandLabel = state.brand.entity?.label ?? null;
  const context: FinalizationContext = {
    userQuery: state.request.userQuery,
    intent: state.interpretation?.intent ?? null,
    brand: state.brand.entity ? { label: state.brand.entity.label, id: state.brand.entity.id } : null,
    territories: results.map(synthesisTerritoryView),
    runLimitations: runLimitations(state, results).map((l) => `${l.code}: ${l.detail}`),
    finalSufficiency: sufficiency,
  };

  let synthesis: Synthesis | null = null;
  let violations: string[] = [];
  let attempts = 0;
  const extraLabels = brandLabel ? [brandLabel] : [];
  if (results.length > 0 && state.status !== "FAILED" && model.synthesize) {
    for (attempts = 1; attempts <= 2; attempts += 1) {
      const turn = await model.synthesize(context, violations);
      if (turn.usage) {
        state.usage.inputTokens += turn.usage.inputTokens;
        state.usage.outputTokens += turn.usage.outputTokens;
      }
      if ("invalid" in turn) {
        violations = [`synthesis output invalid: ${turn.invalid}`];
        continue;
      }
      const parsed = synthesisSchema.safeParse(turn.output);
      if (!parsed.success) {
        violations = parsed.error.issues.map((i) => `synthesis schema: ${i.path.join(".")}: ${i.message}`);
        continue;
      }
      violations = validateClaims(parsed.data, results, extraLabels);
      if (violations.length === 0) {
        synthesis = parsed.data;
        break;
      }
    }
    attempts = Math.min(attempts, 2);
  }
  const source = synthesis ? ("model" as const) : ("deterministic_template" as const);
  const final = synthesis ?? templateSynthesis(brandLabel, results);
  const finalViolations = validateClaims(final, results, extraLabels);
  if (!synthesis && finalViolations.length > 0) throw new Error(`deterministic template failed claim validation: ${finalViolations.join("; ")}`);
  state.trace.synthesis = { source, attempts, violations };

  const territoryNotes = new Map(final.territoryNotes.map((n) => [n.territoryKey, n.text]));
  const summaryText = [final.summary, ...results.filter((r) => territoryNotes.has(r.key)).map((r) => `${r.label}: ${territoryNotes.get(r.key)}`)].join("\n");
  const status = state.status === "FAILED" ? "FAILED" : state.status === "BUDGET_EXHAUSTED" ? "BUDGET_EXHAUSTED" : "COMPLETE";
  return {
    schemaVersion: AGENT_RESULT_SCHEMA_VERSION,
    runId: state.runId,
    status,
    finalSufficiency: sufficiency,
    intent: state.interpretation?.intent ?? null,
    userQuery: state.request.userQuery,
    brand: state.brand.entity ? { id: state.brand.entity.id, label: state.brand.entity.label, type: state.brand.entity.type, resolution: state.brand.entity.resolution } : null,
    territories: results,
    methodologyRuns: state.methodologyRuns,
    summary: { text: summaryText, source, claimValidation: { passed: finalViolations.length === 0, violations } },
    followUpOptions: final.followUpOptions,
    limitations: runLimitations(state, results),
    evidenceOrigin: state.toolProvider.mode === "live" ? "live" : "synthetic",
    model: state.model,
    trace: state.trace,
    metrics: computeMetrics(state, results),
  };
}

export function needsInputResponse(state: AgentRunState): AgentNeedsInputResponse {
  const question = state.pendingQuestion!;
  return {
    schemaVersion: AGENT_RESULT_SCHEMA_VERSION,
    runId: state.runId,
    status: "NEEDS_INPUT",
    question: question.question,
    ambiguity: question.ambiguity,
    options: question.options,
    model: state.model,
    trace: state.trace,
    metrics: computeMetrics(state, []),
  };
}
