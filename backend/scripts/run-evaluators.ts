/**
 * Sprint 5A.1 targeted runtime evaluators: cheap, deterministic checks over ONE finished agent result (its territories,
 * trace and metrics). They run in `pnpm eval:agent` (synthetic) and `pnpm eval:agent:live` (live arms) and feed the
 * competence half of the readiness gate. No LLM is called; nothing here changes a run.
 *
 *   PROBE_BUDGET_VALID              no concept was probed with more than MAX_EMPTY_TYPE_PROBES_PER_CONCEPT empty types
 *                                   (recomputed from the tool-call trace, independently of the runtime's own counter)
 *   COMMON_TYPE_FEASIBILITY         in a comparison, a target represented with another type than the others had the
 *                                   shared type probed on at least one of its concepts (the mismatch was not avoidable)
 *   REFERENCE_SET_MEANINGFUL        every FULL result rests on a comparison set the semantic validator accepted
 *   COMPLETION_BUDGET_FEASIBLE      the run did not end with a represented territory left unanalyzed, and every
 *                                   completion check is arithmetically consistent (feasible ⇔ turns and calls suffice)
 *   CANONICAL_CANDIDATE_VALID       generated candidates carry a canonical record; uncertain anchors say so; no two
 *                                   in-scope candidates share a canonical key
 *   FRONTIER_DISCOVERY_CONSISTENCY  Qloo-grounded frontier candidates come from the run's evidence-grounded pool
 *
 * Direction is eval → product: this module imports runtime constants; nothing in the runtime imports it.
 */
import type { AgentAnalysisResult, AgentRunResponse } from "@cultural-elasticity/shared";
import { MAX_EMPTY_TYPE_PROBES_PER_CONCEPT } from "../src/agent/probe-policy.js";

export type EvaluatorId = "PROBE_BUDGET_VALID" | "COMMON_TYPE_FEASIBILITY" | "REFERENCE_SET_MEANINGFUL" | "COMPLETION_BUDGET_FEASIBLE" | "CANONICAL_CANDIDATE_VALID" | "FRONTIER_DISCOVERY_CONSISTENCY";

export type EvaluatorResult = { id: EvaluatorId; applicable: boolean; passed: boolean; detail: string };

export const RUN_EVALUATORS_VERSION = "run-evaluators-v1";

const ok = (id: EvaluatorId, detail = "ok"): EvaluatorResult => ({ id, applicable: true, passed: true, detail });
const fail = (id: EvaluatorId, detail: string): EvaluatorResult => ({ id, applicable: true, passed: false, detail });
const na = (id: EvaluatorId, detail: string): EvaluatorResult => ({ id, applicable: false, passed: true, detail });

/** Empty entity types per concept, from the trace (brand-independent single-tag recommends Qloo answered empty). */
export function emptyTypesPerConcept(r: AgentRunResponse): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const c of r.trace.toolCalls) {
    const a = c.arguments as { tagIds?: string[]; targetType?: string; conditionOnBrand?: boolean } | undefined;
    if (c.tool !== "qloo_recommend" || c.status !== "empty" || a?.conditionOnBrand !== false || a.tagIds?.length !== 1 || !a.targetType) continue;
    out.set(a.tagIds[0]!, (out.get(a.tagIds[0]!) ?? new Set()).add(a.targetType));
  }
  return out;
}

function probeBudget(r: AgentRunResponse): EvaluatorResult {
  const worst = [...emptyTypesPerConcept(r).entries()].sort((a, b) => b[1].size - a[1].size)[0];
  if (!worst) return ok("PROBE_BUDGET_VALID", "no empty probes");
  return worst[1].size <= MAX_EMPTY_TYPE_PROBES_PER_CONCEPT ? ok("PROBE_BUDGET_VALID", `max ${worst[1].size} empty type(s) for one concept`) : fail("PROBE_BUDGET_VALID", `${worst[0]} was probed with ${worst[1].size} empty types (${[...worst[1]].join(", ")})`);
}

function commonType(r: AgentAnalysisResult): EvaluatorResult {
  if (r.intent !== "compare_territories") return na("COMMON_TYPE_FEASIBILITY", "not a comparison");
  const targets = r.territories.filter((t) => t.role === "target" && t.representation.entityType && t.representation.exemplars.length > 0);
  const counts = new Map<string, number>();
  for (const t of targets) counts.set(t.representation.entityType!, (counts.get(t.representation.entityType!) ?? 0) + 1);
  if (counts.size <= 1) return ok("COMMON_TYPE_FEASIBILITY", counts.size === 1 ? `all represented targets share ${[...counts.keys()][0]}` : "no represented target");
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
  const avoidable = targets.filter((t) => t.representation.entityType !== dominant && !(t.probes ?? []).some((p) => p.attemptedTypes.includes(dominant)));
  return avoidable.length === 0 ? ok("COMMON_TYPE_FEASIBILITY", `mismatched target(s) were probed with ${dominant} first`) : fail("COMMON_TYPE_FEASIBILITY", `${avoidable.map((t) => t.key).join(", ")} represented as ${avoidable.map((t) => t.representation.entityType).join("/")} without probing the shared type ${dominant}`);
}

function referenceMeaningful(r: AgentAnalysisResult): EvaluatorResult {
  const full = r.territories.filter((t) => t.analysisRoute === "FULL_RELATIVE_ANALYSIS");
  if (full.length === 0) return na("REFERENCE_SET_MEANINGFUL", "no FULL result");
  const assessments = r.comparisonSetConstruction.semanticAssessments ?? [];
  const unaccepted = full.filter((t) => t.comparisonSet?.semanticStatus !== undefined && t.comparisonSet.semanticStatus !== "MEANINGFUL" && !assessments.some((a) => a.usedForFull && a.memberTerritoryKeys.includes(t.key)));
  return unaccepted.length === 0 ? ok("REFERENCE_SET_MEANINGFUL", `${full.length} FULL result(s) on accepted comparison sets`) : fail("REFERENCE_SET_MEANINGFUL", `${unaccepted.map((t) => t.key).join(", ")} FULL without an accepted comparison set`);
}

function completionBudget(r: AgentAnalysisResult): EvaluatorResult {
  // A FAILED run failed on model validity (counted elsewhere); a spent Qloo budget is not a turn-planning failure.
  if (r.status === "FAILED") return na("COMPLETION_BUDGET_FEASIBLE", "the run failed for another reason");
  if (r.status === "BUDGET_EXHAUSTED" && r.metrics.qloo_calls >= (r.trace.limits.maxQlooCalls ?? Infinity)) return na("COMPLETION_BUDGET_FEASIBLE", "the Qloo-call budget, not the turn budget, was spent");
  const stranded = r.territories.filter((t) => t.representation.exemplars.length > 0 && (t.representation.failure?.code === "BUDGET_EXHAUSTED" || t.representation.failure?.code === "NOT_INVESTIGATED"));
  if (stranded.length > 0) return fail("COMPLETION_BUDGET_FEASIBLE", `represented but never analyzed: ${stranded.map((t) => t.key).join(", ")}`);
  const inconsistent = (r.trace.completion ?? []).filter((c) => c.turnsNeeded > 0 && c.fullAnalysisFeasible && (c.remainingTurns < c.turnsNeeded || c.remainingQlooCalls < c.callsNeeded));
  if (inconsistent.length > 0) return fail("COMPLETION_BUDGET_FEASIBLE", `completion judged feasible with too few turns/calls at iteration(s) ${inconsistent.map((c) => c.iteration).join(", ")}`);
  return ok("COMPLETION_BUDGET_FEASIBLE", `${(r.trace.completion ?? []).length} completion check(s); no represented territory stranded`);
}

function canonical(r: AgentAnalysisResult): EvaluatorResult {
  const generated = r.territories.filter((t) => t.role !== "target" && t.representation.failure?.code !== "DUPLICATE_TERRITORY");
  if (generated.length === 0) return na("CANONICAL_CANDIDATE_VALID", "no generated candidate");
  const problems: string[] = [];
  for (const t of generated) {
    const c = t.candidate;
    if (!c) {
      problems.push(`${t.key}: no canonical record`);
      continue;
    }
    if ((c.anchorRelation === "DIFFERENT_NAME" || c.anchorRelation === "ALIAS_TOKEN_CONTAINMENT") && !c.uncertainty) problems.push(`${t.key}: uncertain anchor without a recorded uncertainty`);
    if (c.normalizationReason === "SOURCE_TAG_CANONICAL_NAME" && !c.sourceTagId) problems.push(`${t.key}: canonical key claims a source tag that is absent`);
  }
  const inScope = generated.filter((t) => t.analysisRoute !== "INSUFFICIENT_EVIDENCE" && t.candidate);
  const keys = inScope.map((t) => t.candidate!.canonicalConceptKey);
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dup) problems.push(`two in-scope candidates share the canonical key ${dup}`);
  return problems.length === 0 ? ok("CANONICAL_CANDIDATE_VALID", `${generated.length} candidate(s) canonicalized`) : fail("CANONICAL_CANDIDATE_VALID", problems.join("; "));
}

function frontierConsistency(r: AgentAnalysisResult): EvaluatorResult {
  if (r.intent !== "explore_frontier") return na("FRONTIER_DISCOVERY_CONSISTENCY", "not a frontier exploration");
  const pool = new Set((r.comparisonSetConstruction.candidatePool ?? []).map((p) => p.canonicalConceptKey));
  const grounded = r.territories.filter((t) => t.role === "frontier_candidate" && t.candidate?.candidateSource === "qloo_grounded" && t.candidate.sourceTagId);
  if (grounded.length === 0) return na("FRONTIER_DISCOVERY_CONSISTENCY", "no Qloo-grounded candidate");
  const outside = grounded.filter((t) => !pool.has(t.candidate!.canonicalConceptKey));
  return outside.length === 0 ? ok("FRONTIER_DISCOVERY_CONSISTENCY", `${grounded.length} grounded candidate(s), all from the evidence-grounded pool`) : fail("FRONTIER_DISCOVERY_CONSISTENCY", `not in the candidate pool: ${outside.map((t) => t.candidate!.canonicalConceptKey).join(", ")}`);
}

export function evaluateRun(response: AgentRunResponse): EvaluatorResult[] {
  if (response.status === "NEEDS_INPUT") return [probeBudget(response)];
  const r = response as AgentAnalysisResult;
  return [probeBudget(r), commonType(r), referenceMeaningful(r), completionBudget(r), canonical(r), frontierConsistency(r)];
}

/** Failed applicable evaluators across runs, as "runId-or-case: EVALUATOR — detail". */
export function evaluatorFailures(runs: readonly { id: string; response: AgentRunResponse }[]): string[] {
  return runs.flatMap((run) => evaluateRun(run.response).filter((e) => e.applicable && !e.passed).map((e) => `${run.id}: ${e.id} — ${e.detail}`));
}
