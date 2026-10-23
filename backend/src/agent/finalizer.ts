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
import { AGENT_RESULT_SCHEMA_VERSION, type AgentAnalysisResult, type AgentMetrics, type AgentNeedsInputResponse, type AgentResultLayers, type AgentTerritoryResult, type Limitation } from "@cultural-elasticity/shared";
import { reconcileLatency } from "../ops/latency.js";
import { priceUsd } from "../ops/pricing.js";
import { unanalyzedResult } from "./analysis-runner.js";
import { classifyRunFailure } from "./failure-taxonomy.js";
import { candidateCanonicalization, comparisonSetConstruction, evidenceStatus } from "./frontier.js";
import { conceptProbeState, probeViews } from "./probe-policy.js";
import { categorize, validateClaims, validateFindings } from "./claim-validator.js";
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

/** Grounded findings → territory notes (one note per territory, findings in order), appended to free notes. */
export function renderFindings(s: Synthesis): Synthesis {
  const notes = new Map(s.territoryNotes.map((n) => [n.territoryKey, n.text]));
  for (const f of s.findings) notes.set(f.territoryKey, [notes.get(f.territoryKey), f.interpretation].filter(Boolean).join(" "));
  return { ...s, territoryNotes: [...notes.entries()].map(([territoryKey, text]) => ({ territoryKey, text })) };
}

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
  return { summary: [head, ...lines].join("\n"), territoryNotes: [], findings: [], followUpOptions: templateFollowUps(results) };
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

export { priceUsd } from "../ops/pricing.js";

/** Rejection codes that are valid-schema actions the current state does not support. */
const UNSUPPORTED_STATE_CODES = new Set([
  "WRONG_PHASE",
  "NOT_EXPOSED",
  "PRECONDITION",
  "NEEDS_USER_INPUT",
  "NOT_READY",
  "FINISH_BEFORE_SUFFICIENCY",
  "NOTHING_ANALYZED",
  "NOTHING_TO_ANALYZE",
  "NO_OPEN_AMBIGUITY",
  "EVIDENCE_SUFFICIENT",
  "STRATEGY_EXHAUSTED",
  "DUPLICATE_ACTION",
  "NO_VALUE_ACTION",
  "EARLY_STOP",
  "SKILL_BUDGET_EXHAUSTED",
  "ANALYSIS_RESERVE",
  "BUDGET_EXHAUSTED",
  "UNKNOWN_RESULT_IDS",
]);

export function modelCostUsd(state: AgentRunState): number | null {
  const usd = state.model.kind === "llm" ? priceUsd(state.model.id, state.usage) : null;
  return usd === null ? null : Math.round(usd * 10_000) / 10_000;
}

export function computeMetrics(state: AgentRunState, results: AgentTerritoryResult[]): AgentMetrics {
  const calls = state.trace.toolCalls;
  const turns = state.trace.turns;
  const codes = turns.flatMap((t) => t.decisions.flatMap((d) => (d.rejection ? [d.rejection.split(":")[0]!] : [])));
  const sizes = turns.flatMap((t) => (t.contextChars !== undefined ? [t.contextChars] : []));
  const tokens = turns.flatMap((t) => (t.contextTokensEstimate !== undefined ? [t.contextTokensEstimate] : []));
  const avg = (values: number[]) => (values.length === 0 ? null : Math.round(values.reduce((a, b) => a + b, 0) / values.length));
  const executed = calls.filter((c) => c.status !== "rejected");
  const succeeded = executed.filter((c) => c.status === "ok" || c.status === "empty");
  const count = (route: string) => results.filter((r) => r.analysisRoute === route).length;
  const latencyMs = Date.now() - state.startedAt;
  const modelLatencyMs = turns.reduce((n, t) => n + t.latencyMs, 0);
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
    latency_ms: latencyMs,
    model_input_tokens: state.usage.inputTokens,
    model_output_tokens: state.usage.outputTokens,
    retry_count: state.usage.retries,
    budget_exhausted: state.status === "BUDGET_EXHAUSTED",
    model_turns: turns.length,
    model_attempts: turns.reduce((n, t) => n + (t.modelAttempts ?? 1), 0),
    first_attempt_valid_turns: turns.filter((t) => t.firstAttemptValid).length,
    valid_after_repair_turns: turns.filter((t) => t.decisions.some((d) => d.accepted)).length,
    repairs: turns.filter((t) => (t.modelAttempts ?? 1) > 1).length,
    unknown_tool_attempts: codes.filter((c) => c === "UNKNOWN_TOOL").length,
    invalid_argument_attempts: codes.filter((c) => c === "INVALID_ARGUMENTS" || c === "INVALID_DECISION").length,
    unsupported_state_actions: codes.filter((c) => UNSUPPORTED_STATE_CODES.has(c)).length,
    synthesis_attempts: state.usage.synthesisAttempts,
    calls_avoided: state.trace.earlyStops.reduce((n, e) => n + e.callsAvoided, 0),
    avg_context_chars: avg(sizes),
    max_context_chars: sizes.length ? Math.max(...sizes) : null,
    avg_context_tokens_estimate: avg(tokens),
    model_latency_ms: modelLatencyMs,
    qloo_latency_ms: state.usage.qlooLatencyMs,
    model_cost_usd: modelCostUsd(state),
    model_id: state.model.id,
    model_effort: state.model.effort ?? null,
    synthesis_latency_ms: state.timing.synthesisMs,
    analysis_latency_ms: state.timing.analysisMs,
    /** Part of qloo_latency_ms spent waiting on rate-limit spacing and back-off (not Qloo response time). */
    qloo_spacing_ms: state.usage.qlooSpacingMs,
    unattributed_ms: reconcileLatency({
      latencyMs,
      modelLatencyMs,
      qlooLatencyMs: state.usage.qlooLatencyMs,
      qlooSpacingMs: state.usage.qlooSpacingMs,
      analysisLatencyMs: state.timing.analysisMs,
      synthesisLatencyMs: state.timing.synthesisMs,
    }).unattributedMs,
    synthesis_first_attempt_valid: state.trace.synthesis?.attemptDetails?.length ? state.trace.synthesis.attemptDetails[0]!.accepted : null,
    synthesis_valid_after_repair: state.trace.synthesis?.attemptDetails?.length ? state.trace.synthesis.attemptDetails.some((a) => a.accepted) : null,
    synthesis_fallback: state.trace.synthesis?.source === "deterministic_template",
    reference_deferrals: state.referenceDeferrals,
    ...probeMetrics(state),
  };
}

function layers(state: AgentRunState, results: AgentTerritoryResult[], summary: { text: string; source: "model" | "deterministic_template"; passed: boolean }, followUps: string[], findings: Synthesis["findings"]): AgentResultLayers {
  const decisions = state.trace.representationQuality;
  const brand = state.brand.entity;
  return {
    qlooEvidence: {
      brand: brand ? { id: brand.id, label: brand.label, correlationId: brand.call.envelope.execution.correlation_id } : null,
      concepts: state.territories.flatMap((t) => (t.concept ? [{ territoryKey: t.key, id: t.concept.id, label: t.concept.label, correlationIds: (state.tags.get(t.concept.id)?.sources ?? []).map((x) => x.correlationId) }] : [])),
      exemplars: state.territories.flatMap((t) => (t.representation?.exemplars ?? []).map((e) => ({ territoryKey: t.key, id: e.id, label: e.label, conceptSupport: e.conceptSupport, supportCorrelationId: e.supportCorrelationId }))),
      qlooCalls: state.usage.qlooCalls,
    },
    systemAnalysis: {
      routes: results.map((r) => ({ territoryKey: r.key, route: r.analysisRoute, classification: r.classification?.label ?? null, position: r.relativePosition?.position ?? null, robustness: r.robustness?.level ?? null })),
      methodologyRunIds: state.methodologyRuns.map((m) => m.id),
      finalSufficiency: assessEvidenceSufficiency(state).verdict,
      representationDecisions: { valid: decisions.filter((d) => d.final === "VALID").length, weak: decisions.filter((d) => d.final === "WEAK").length, rejected: decisions.filter((d) => d.final === "REJECT").length },
      semanticComparison: state.semanticAssessments.map((a) => ({ semanticStatus: a.semanticStatus, structuralStatus: a.structuralStatus, usedForFull: a.usedForFull, memberTerritoryKeys: a.memberTerritoryKeys })),
    },
    agentInterpretation: {
      summary: summary.text,
      source: summary.source,
      claimValidationPassed: summary.passed,
      semanticJudgments: [
        ...decisions.flatMap((d) => (d.modelAssessment ? [{ territoryKey: d.territoryKey, label: d.label, relevance: d.modelAssessment.relevance, reason: d.modelAssessment.reason }] : [])),
        ...state.territories.flatMap((t) => (t.semanticJudgment ? [{ territoryKey: t.key, label: t.label, relevance: t.semanticJudgment.relevance, reason: t.semanticJudgment.reason }] : [])),
      ],
      followUpOptions: followUps,
      findings,
    },
  };
}

function runLimitations(state: AgentRunState, results: AgentTerritoryResult[]): Limitation[] {
  const out: Limitation[] = [
    { code: "NOT_A_SUCCESS_PREDICTION", detail: "nothing here predicts commercial success, purchase intent or any individual's preference" },
    { code: "NO_APPROVED_SCORE", detail: "no 0–100 score exists (Relative Elasticity Index REJECTED_FOR_NOW); results are positions, robustness, coherence, quality and provisional classes" },
  ];
  if (results.some((r) => r.analysisRoute === "FULL_RELATIVE_ANALYSIS")) out.push({ code: "RELATIVE_TO_COMPARISON_SET", detail: "positions and classes hold only for the comparison set shown with each territory" });
  if (state.toolProvider.mode === "scripted") out.push({ code: "SYNTHETIC_EVIDENCE", detail: "evidence came from the scripted SYNTHETIC world, not from Qloo; never cite it as Qloo evidence" });
  if (state.interpretation?.intent === "explore_frontier" || results.some((r) => r.role === "reference")) out.push({ code: "COMPARISON_SET_DEPENDENT", detail: "relative position depends on the comparison set; see comparisonSetConstruction for how it was assembled and what was rejected" });
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
  return territoryOrder(
    state.territories.map((t) => {
      const r = state.results.get(t.key) ?? unanalyzedResult(state, t, code);
      // Sprint 5A.1 (additive): canonical identity, UI evidence status and the probes behind the route.
      const probes = probeViews(state, t);
      return { ...r, candidate: candidateCanonicalization(state, t), evidenceStatus: evidenceStatus(r), ...(probes.length > 0 && { probes }) };
    }),
  );
}

export async function finalize(state: AgentRunState, model: AgentModel, options: { skipSynthesis?: boolean } = {}): Promise<AgentAnalysisResult> {
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
  const attemptDetails: NonNullable<NonNullable<AgentRunState["trace"]["synthesis"]>["attemptDetails"]> = [];
  const extraLabels = brandLabel ? [brandLabel] : [];
  const synthesisStarted = Date.now();
  if (results.length > 0 && state.status !== "FAILED" && model.synthesize && !options.skipSynthesis) {
    for (attempts = 1; attempts <= 2; attempts += 1) {
      state.usage.synthesisAttempts += 1;
      const turn = await model.synthesize(context, violations);
      if (turn.usage) {
        state.usage.inputTokens += turn.usage.inputTokens + (turn.usage.cacheReadTokens ?? 0) + (turn.usage.cacheCreationTokens ?? 0);
        state.usage.uncachedInputTokens += turn.usage.inputTokens;
        state.usage.cacheReadTokens += turn.usage.cacheReadTokens ?? 0;
        state.usage.cacheCreationTokens += turn.usage.cacheCreationTokens ?? 0;
        state.usage.outputTokens += turn.usage.outputTokens;
      }
      const record = (accepted: boolean, output?: unknown) => attemptDetails.push({ attempt: attempts, accepted, categories: categorize(violations), violations: [...violations], ...(!accepted && output !== undefined && { rejectedOutput: JSON.stringify(output).slice(0, 16_000) }) });
      if ("invalid" in turn) {
        violations = [`synthesis output invalid: ${turn.invalid}`];
        record(false);
        continue;
      }
      const parsed = synthesisSchema.safeParse(turn.output);
      if (!parsed.success) {
        violations = parsed.error.issues.map((i) => `synthesis schema: ${i.path.join(".")}: ${i.message}`);
        record(false, turn.output);
        continue;
      }
      // Grounded findings are validated against their cited fields, then rendered as territory notes.
      const rendered = renderFindings(parsed.data);
      violations = [...validateFindings(parsed.data.findings, results), ...validateClaims(rendered, results, extraLabels)];
      record(violations.length === 0, turn.output);
      if (violations.length === 0) {
        synthesis = rendered;
        break;
      }
    }
    attempts = Math.min(attempts, 2);
  }
  state.timing.synthesisMs += Date.now() - synthesisStarted;
  const source = synthesis ? ("model" as const) : ("deterministic_template" as const);
  const final = synthesis ?? templateSynthesis(brandLabel, results);
  const finalViolations = validateClaims(final, results, extraLabels);
  if (!synthesis && finalViolations.length > 0) throw new Error(`deterministic template failed claim validation: ${finalViolations.join("; ")}`);
  state.trace.synthesis = { source, attempts, violations, attemptDetails };
  state.trace.semanticAssessments = state.semanticAssessments;

  const territoryNotes = new Map(final.territoryNotes.map((n) => [n.territoryKey, n.text]));
  const summaryText = [final.summary, ...results.filter((r) => territoryNotes.has(r.key)).map((r) => `${r.label}: ${territoryNotes.get(r.key)}`)].join("\n");
  const status = state.status === "FAILED" ? "FAILED" : state.status === "BUDGET_EXHAUSTED" ? "BUDGET_EXHAUSTED" : "COMPLETE";
  const summary = { text: summaryText, source, claimValidation: { passed: finalViolations.length === 0, violations } };
  const result: AgentAnalysisResult = {
    schemaVersion: AGENT_RESULT_SCHEMA_VERSION,
    runId: state.runId,
    status,
    finalSufficiency: sufficiency,
    intent: state.interpretation?.intent ?? null,
    userQuery: state.request.userQuery,
    brand: state.brand.entity ? { id: state.brand.entity.id, label: state.brand.entity.label, type: state.brand.entity.type, resolution: state.brand.entity.resolution } : null,
    territories: results,
    methodologyRuns: state.methodologyRuns,
    summary,
    followUpOptions: final.followUpOptions,
    limitations: runLimitations(state, results),
    evidenceOrigin: state.toolProvider.mode === "live" ? "live" : "synthetic",
    model: state.model,
    trace: state.trace,
    metrics: computeMetrics(state, results),
    skillsUsed: [...state.skillUsage.values()].map((u) => u.skill),
    comparisonSetConstruction: comparisonSetConstruction(state, results),
    layers: layers(state, results, { text: summaryText, source, passed: finalViolations.length === 0 }, final.followUpOptions, final.findings),
    failureCategory: null,
  };
  result.failureCategory = classifyRunFailure(result);
  return result;
}

export function needsInputResponse(state: AgentRunState): AgentNeedsInputResponse {
  const question = state.pendingQuestion!;
  state.trace.skillUsage = [...state.skillUsage.values()].map(({ skill, turns, qlooCalls, toolCalls }) => ({ skill, turns, qlooCalls, toolCalls }));
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

/** Sprint 5A.1/5A.2 probe telemetry: empty and successful probes (from pools), refusals by rule (from early stops), anchors. */
function probeMetrics(state: AgentRunState): Pick<AgentMetrics, "empty_type_probes" | "max_empty_type_probes_per_concept" | "probe_limit_refusals" | "type_alignment_deferrals" | "reference_namespace_refusals" | "successful_type_probes" | "namespace_type_refusals" | "alternate_anchor_refusals" | "source_evidence_anchors" | "frontier_completion_refusals"> {
  const concepts = [...new Set(state.pools.filter((p) => p.conditionedOn === null && p.tagIds.length === 1).map((p) => p.tagIds[0]!))].map((id) => conceptProbeState(state, id).totalEmptyTypeProbes);
  const stops = (code: string) => state.trace.earlyStops.filter((e) => e.code === code).length;
  return {
    empty_type_probes: concepts.reduce((a, b) => a + b, 0),
    max_empty_type_probes_per_concept: Math.max(0, ...concepts),
    probe_limit_refusals: stops("PROBE_LIMIT_REACHED"),
    type_alignment_deferrals: state.alignmentDeferrals.size,
    reference_namespace_refusals: stops("REFERENCE_NAMESPACE_BARREN"),
    successful_type_probes: [...new Set(state.pools.filter((p) => p.conditionedOn === null && p.tagIds.length === 1).map((p) => p.tagIds[0]!))].reduce((n, id) => n + conceptProbeState(state, id).successfulTypes.length, 0),
    namespace_type_refusals: stops("NAMESPACE_TYPE_BARREN"),
    alternate_anchor_refusals: stops("ALTERNATE_ANCHOR_REFUSED"),
    source_evidence_anchors: (state.trace.anchorDecisions ?? []).filter((d) => d.basis === "SOURCE_TAG_MEMBERS" || d.basis === "LABEL_TAG_MEMBERS").length,
    frontier_completion_refusals: stops("FRONTIER_COMPLETION_RESERVE"),
  };
}
