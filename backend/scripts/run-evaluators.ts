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
 * Sprint 5A.2 (run-evaluators-v2), from the Sprint 5A.1 frontier traces:
 *   TAG_TYPE_EVIDENCE_VALID         every reported successful / empty probe type is backed by a recommend call with
 *                                   that outcome, and each concept's namespace is its tag namespace
 *   PROBE_PRIORITY_JUSTIFIED        no probe ignored namespace evidence available at the start of its turn: a type that
 *                                   returned members for another concept of the namespace, untried for this concept,
 *                                   while the probed type had none there
 *   NULL_POPULARITY_HANDLED         no Qloo call failed on a popularity contract error, and no reported popularity is
 *                                   anything but a number or null (unknown is never converted)
 *   ANCHOR_PROVENANCE_PRESERVED     a grounded candidate anchored to another tag has a recorded anchor decision that is
 *                                   one of its evidence tags or an accepted alternate (never an unrelated concept)
 *   SUPPORTED_CONCEPT_NOT_LOST      a frontier candidate whose grounding (or anchored) concept returned members is not
 *                                   reported unsupported, unless a semantic, diversity or dedup rule removed it (a dedup
 *                                   drop that kept a duplicate WITHOUT members in its place is a loss)
 *   RECOVERY_WITHIN_BUDGET          no territory exceeded the territory probe limit, no turn was spent entirely on
 *                                   repeated calls or exhausted strategies, and no call refused as exhausted was
 *                                   re-proposed in a later turn
 *   FRONTIER_RESULT_CONSISTENCY     supported frontier routes have a Qloo concept, evidence statuses match routes, the
 *                                   final set holds only supported candidates, and the candidate pool is stably ordered
 *
 * Direction is eval → product: this module imports runtime constants; nothing in the runtime imports it.
 */
import type { AgentAnalysisResult, AgentRunResponse, AgentTerritoryResult } from "@cultural-elasticity/shared";
import { evidenceStatus } from "../src/agent/frontier.js";
import { MAX_EMPTY_PROBES_PER_TERRITORY, MAX_EMPTY_TYPE_PROBES_PER_CONCEPT, tagNamespace } from "../src/agent/probe-policy.js";

export type EvaluatorId =
  | "PROBE_BUDGET_VALID"
  | "COMMON_TYPE_FEASIBILITY"
  | "REFERENCE_SET_MEANINGFUL"
  | "COMPLETION_BUDGET_FEASIBLE"
  | "CANONICAL_CANDIDATE_VALID"
  | "FRONTIER_DISCOVERY_CONSISTENCY"
  | "TAG_TYPE_EVIDENCE_VALID"
  | "PROBE_PRIORITY_JUSTIFIED"
  | "NULL_POPULARITY_HANDLED"
  | "ANCHOR_PROVENANCE_PRESERVED"
  | "SUPPORTED_CONCEPT_NOT_LOST"
  | "RECOVERY_WITHIN_BUDGET"
  | "FRONTIER_RESULT_CONSISTENCY";

export type EvaluatorResult = { id: EvaluatorId; applicable: boolean; passed: boolean; detail: string };

/** v2.1 (Sprint 5A.2, grader fix after the final live run): RECOVERY_WITHIN_BUDGET counts a re-proposal only when it is refused again. */
export const RUN_EVALUATORS_VERSION = "run-evaluators-v2.1";

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

// ---- Sprint 5A.2 ----

type ProbeCall = { iteration: number; tagId: string; type: string; outcome: "ok" | "empty" };

/** Brand-independent single-tag recommends Qloo answered (ok or empty), in execution order. */
export function probeCalls(r: AgentRunResponse): ProbeCall[] {
  return r.trace.toolCalls.flatMap((c) => {
    const a = c.arguments as { tagIds?: string[]; targetType?: string; conditionOnBrand?: boolean } | undefined;
    if (c.tool !== "qloo_recommend" || (c.status !== "ok" && c.status !== "empty") || a?.conditionOnBrand !== false || a.tagIds?.length !== 1 || !a.targetType) return [];
    return [{ iteration: c.iteration, tagId: a.tagIds[0]!, type: a.targetType, outcome: c.status }];
  });
}

function tagTypeEvidence(r: AgentAnalysisResult): EvaluatorResult {
  const calls = probeCalls(r);
  const problems: string[] = [];
  for (const t of r.territories)
    for (const p of t.probes ?? []) {
      for (const type of p.successfulTypes) if (!calls.some((c) => c.tagId === p.conceptKey && c.type === type && c.outcome === "ok")) problems.push(`${p.conceptKey}: ${type} reported successful without a recommend call that returned members`);
      for (const type of p.emptyTypes) if (!calls.some((c) => c.tagId === p.conceptKey && c.type === type && c.outcome === "empty")) problems.push(`${p.conceptKey}: ${type} reported empty without an empty recommend answer`);
      if (p.namespace !== undefined && p.namespace !== tagNamespace(p.conceptKey)) problems.push(`${p.conceptKey}: namespace ${p.namespace} is not its tag namespace`);
    }
  if (!r.territories.some((t) => (t.probes ?? []).length > 0)) return na("TAG_TYPE_EVIDENCE_VALID", "no probes reported");
  return problems.length === 0 ? ok("TAG_TYPE_EVIDENCE_VALID", "every reported probe outcome is backed by a Qloo answer") : fail("TAG_TYPE_EVIDENCE_VALID", problems.slice(0, 4).join("; "));
}

/** Probes that ignored namespace evidence observed before their turn (see the header). */
export function unjustifiedProbes(r: AgentRunResponse): string[] {
  const calls = probeCalls(r);
  const out: string[] = [];
  for (const c of calls) {
    const ns = tagNamespace(c.tagId);
    const before = calls.filter((x) => x.iteration < c.iteration);
    const nsMembers = (type: string) => before.some((x) => x.tagId !== c.tagId && tagNamespace(x.tagId) === ns && x.type === type && x.outcome === "ok");
    if (nsMembers(c.type) || before.some((x) => x.tagId === c.tagId && x.outcome === "ok")) continue;
    const better = [...new Set(before.filter((x) => x.tagId !== c.tagId && tagNamespace(x.tagId) === ns && x.outcome === "ok").map((x) => x.type))].filter((type) => !before.some((x) => x.tagId === c.tagId && x.type === type));
    if (better.length > 0) out.push(`iteration ${c.iteration}: ${c.type} on ${c.tagId} although ${better.join("/")} had returned members in ${ns}`);
  }
  return out;
}

function probePriority(r: AgentRunResponse): EvaluatorResult {
  if (probeCalls(r).length === 0) return na("PROBE_PRIORITY_JUSTIFIED", "no probes");
  const bad = unjustifiedProbes(r);
  return bad.length === 0 ? ok("PROBE_PRIORITY_JUSTIFIED", `${probeCalls(r).length} probe(s); none ignored namespace evidence`) : fail("PROBE_PRIORITY_JUSTIFIED", bad.slice(0, 3).join("; "));
}

function nullPopularity(r: AgentRunResponse): EvaluatorResult {
  const contract = r.trace.toolCalls.filter((c) => c.status === "failed" && /popularity/iu.test(c.summary));
  if (contract.length > 0) return fail("NULL_POPULARITY_HANDLED", `${contract.length} call(s) failed on a popularity contract error`);
  if (r.status === "NEEDS_INPUT") return ok("NULL_POPULARITY_HANDLED", "no popularity contract failure");
  const bad = (r as AgentAnalysisResult).territories.flatMap((t) => t.representation.exemplars.filter((e) => e.popularity !== null && typeof e.popularity !== "number").map((e) => `${t.key}:${e.label}`));
  return bad.length === 0 ? ok("NULL_POPULARITY_HANDLED", "no popularity contract failure; unknown popularity stays null") : fail("NULL_POPULARITY_HANDLED", `non-numeric popularity reported for ${bad.join(", ")}`);
}

const grounded = (r: AgentAnalysisResult) => r.territories.filter((t) => t.role === "frontier_candidate" && t.candidate?.candidateSource === "qloo_grounded" && t.candidate.sourceTagId);

function anchorProvenance(r: AgentAnalysisResult): EvaluatorResult {
  if (r.intent !== "explore_frontier") return na("ANCHOR_PROVENANCE_PRESERVED", "not a frontier exploration");
  if (r.trace.anchorDecisions === undefined) return na("ANCHOR_PROVENANCE_PRESERVED", "trace predates anchor decisions (Sprint 5A.2)");
  const moved = grounded(r).filter((t) => t.candidate!.resolvedId && t.candidate!.resolvedId !== t.candidate!.sourceTagId);
  if (moved.length === 0) return ok("ANCHOR_PROVENANCE_PRESERVED", `${grounded(r).filter((t) => t.candidate!.resolvedId).length} grounded candidate(s) anchored to their grounding tag`);
  const problems = moved.flatMap((t) => {
    const d = [...r.trace.anchorDecisions!].reverse().find((x) => x.territoryKey === t.key && x.anchoredTagId === t.candidate!.resolvedId && x.basis !== "REFUSED");
    if (!d) return [`${t.key}: anchored to ${t.candidate!.resolvedId} with no recorded anchor decision`];
    if (d.basis === "ALTERNATE_WITH_MEMBERS" && d.relation === "DIFFERENT_NAME") return [`${t.key}: alternate anchor to an unrelated concept`];
    return [];
  });
  return problems.length === 0 ? ok("ANCHOR_PROVENANCE_PRESERVED", `${moved.length} candidate(s) anchored off their grounding tag, each with a recorded decision`) : fail("ANCHOR_PROVENANCE_PRESERVED", problems.join("; "));
}

/** Removal codes that are rules, not lost evidence (semantic validity, diversity, deduplication). */
const LEGITIMATE_REMOVAL = new Set(["INCIDENTAL_CONCEPT", "SEMANTIC_REFERENCE_REJECTED", "LOW_DIVERSITY", "DUPLICATE_TERRITORY"]);

function removalCode(r: AgentAnalysisResult, t: AgentTerritoryResult): string | null {
  return r.comparisonSetConstruction.rejected.find((x) => x.key === t.key)?.code ?? t.representation.failure?.code ?? null;
}

function supportedNotLost(r: AgentAnalysisResult): EvaluatorResult {
  if (r.intent !== "explore_frontier") return na("SUPPORTED_CONCEPT_NOT_LOST", "not a frontier exploration");
  const supportedTags = new Set(probeCalls(r).filter((c) => c.outcome === "ok").map((c) => c.tagId));
  const candidates = r.territories.filter((t) => t.role === "frontier_candidate");
  const hasMembers = (t: AgentTerritoryResult | undefined) => [t?.candidate?.sourceTagId, t?.resolvedConcept?.id].some((id) => typeof id === "string" && supportedTags.has(id));
  const lost = candidates.filter((t) => {
    if (t.analysisRoute !== "INSUFFICIENT_EVIDENCE" || !hasMembers(t)) return false;
    const code = removalCode(r, t) ?? "";
    // A duplicate drop must not remove the Qloo-supported member of a pair and keep one without members
    // (live L-E2: two candidates with movie members were dropped as near-duplicates of one with none).
    if (code === "DUPLICATE_TERRITORY") {
      const d = r.trace.conceptDedup.find((x) => x.dropped === t.key);
      const kept = d ? r.territories.find((x) => x.key === (d.a.key === t.key ? d.b.key : d.a.key)) : undefined;
      return kept !== undefined && !hasMembers(kept);
    }
    return !LEGITIMATE_REMOVAL.has(code);
  });
  if (candidates.length === 0) return na("SUPPORTED_CONCEPT_NOT_LOST", "no frontier candidate");
  return lost.length === 0 ? ok("SUPPORTED_CONCEPT_NOT_LOST", "no candidate with Qloo members was reported unsupported") : fail("SUPPORTED_CONCEPT_NOT_LOST", `Qloo members observed but reported INSUFFICIENT: ${lost.map((t) => `${t.key} (${removalCode(r, t) ?? "no code"})`).join(", ")}`);
}

/** Refusals that close a strategy (re-proposing the same call cannot succeed); one-time deferrals are not among them. */
const EXHAUSTION_CODES = new Set(["PROBE_LIMIT_REACHED", "STRATEGY_EXHAUSTED", "NAMESPACE_TYPE_BARREN", "REFERENCE_NAMESPACE_BARREN", "ALTERNATE_ANCHOR_REFUSED", "NO_VALUE_ACTION", "FRONTIER_EVIDENCE_BASE"]);

function recoveryWithinBudget(r: AgentRunResponse): EvaluatorResult {
  const problems: string[] = [];
  if (r.status !== "NEEDS_INPUT")
    for (const t of (r as AgentAnalysisResult).territories) {
      const probes = t.probes ?? [];
      const empty = probes.reduce((n, p) => n + p.emptyTypes.length, 0);
      if (!probes.some((p) => p.successfulTypes.length > 0) && empty > MAX_EMPTY_PROBES_PER_TERRITORY) problems.push(`${t.key}: ${empty} empty probes with no member (limit ${MAX_EMPTY_PROBES_PER_TERRITORY})`);
    }
  const refused = new Map<string, { iteration: number; code: string }>();
  for (const turn of r.trace.turns) {
    const codes = turn.decisions.map((d) => d.rejection?.split(":")[0] ?? "");
    // A turn whose every action repeated a call that already ran or an exhausted strategy was spent for nothing
    // (live L-E1: four duplicate tag searches filled a turn).
    if (turn.decisions.length > 0 && codes.every((c) => c === "DUPLICATE_ACTION" || EXHAUSTION_CODES.has(c))) problems.push(`iteration ${turn.iteration}: every action repeated a call that already ran or an exhausted strategy`);
    for (const d of turn.decisions) {
      if (d.action !== "call_tool" || !d.tool) continue;
      const code = d.rejection?.split(":")[0] ?? "";
      const key = `${d.tool}:${JSON.stringify(d.arguments ?? {})}`;
      const first = refused.get(key);
      // Only a re-proposal that is refused again repeats an exhausted strategy: an accepted one means the refusal's
      // condition changed (e.g. the barren-probe deferral lifts once another type was tried).
      if (first && first.iteration < turn.iteration && !d.accepted) problems.push(`iteration ${turn.iteration}: ${d.tool} re-proposed after ${first.code} at iteration ${first.iteration}`);
      if (!d.accepted && !first && EXHAUSTION_CODES.has(code)) refused.set(key, { iteration: turn.iteration, code });
    }
  }
  return problems.length === 0 ? ok("RECOVERY_WITHIN_BUDGET", "probe limits held and no refused action was repeated") : fail("RECOVERY_WITHIN_BUDGET", [...new Set(problems)].slice(0, 4).join("; "));
}

function frontierResultConsistency(r: AgentAnalysisResult): EvaluatorResult {
  if (r.intent !== "explore_frontier") return na("FRONTIER_RESULT_CONSISTENCY", "not a frontier exploration");
  const problems: string[] = [];
  for (const t of r.territories.filter((x) => x.role === "frontier_candidate")) {
    if (t.analysisRoute !== "INSUFFICIENT_EVIDENCE" && !t.resolvedConcept) problems.push(`${t.key}: route ${t.analysisRoute} without a Qloo concept`);
    if (t.evidenceStatus !== undefined && t.evidenceStatus !== evidenceStatus(t)) problems.push(`${t.key}: evidence status ${t.evidenceStatus} does not match route ${t.analysisRoute}`);
  }
  const byKey = new Map(r.territories.map((t) => [t.key, t]));
  for (const f of r.comparisonSetConstruction.final) if (byKey.get(f.key)?.analysisRoute === "INSUFFICIENT_EVIDENCE") problems.push(`${f.key}: in the final set but INSUFFICIENT`);
  const pool = r.comparisonSetConstruction.candidatePool ?? [];
  for (let i = 1; i < pool.length; i += 1) {
    const a = pool[i - 1]!;
    const b = pool[i]!;
    if (a.support < b.support || (a.support === b.support && a.canonicalConceptKey.localeCompare(b.canonicalConceptKey) > 0)) problems.push(`candidate pool not in stable order at ${b.canonicalConceptKey}`);
  }
  if (new Set(pool.map((p) => p.canonicalConceptKey)).size !== pool.length) problems.push("candidate pool repeats a canonical key");
  return problems.length === 0 ? ok("FRONTIER_RESULT_CONSISTENCY", "frontier routes, statuses, final set and pool are consistent") : fail("FRONTIER_RESULT_CONSISTENCY", problems.slice(0, 4).join("; "));
}

export function evaluateRun(response: AgentRunResponse): EvaluatorResult[] {
  if (response.status === "NEEDS_INPUT") return [probeBudget(response), probePriority(response), nullPopularity(response), recoveryWithinBudget(response)];
  const r = response as AgentAnalysisResult;
  return [
    probeBudget(r),
    commonType(r),
    referenceMeaningful(r),
    completionBudget(r),
    canonical(r),
    frontierConsistency(r),
    tagTypeEvidence(r),
    probePriority(r),
    nullPopularity(r),
    anchorProvenance(r),
    supportedNotLost(r),
    recoveryWithinBudget(r),
    frontierResultConsistency(r),
  ];
}

/** Failed applicable evaluators across runs, as "runId-or-case: EVALUATOR — detail". */
export function evaluatorFailures(runs: readonly { id: string; response: AgentRunResponse }[]): string[] {
  return runs.flatMap((run) => evaluateRun(run.response).filter((e) => e.applicable && !e.passed).map((e) => `${run.id}: ${e.id} — ${e.detail}`));
}
