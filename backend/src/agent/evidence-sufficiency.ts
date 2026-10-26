/**
 * Deterministic evidence sufficiency (v2): may the agent keep investigating, and what is the next action
 * worth?
 *
 *   NEEDS_USER_INPUT      an unresolved ambiguity only the user can settle (no silent choice)
 *   BUDGET_EXHAUSTED      iterations or Qloo calls are spent while work remains
 *   INSUFFICIENT          nothing analyzable can be produced (e.g. the brand cannot be resolved)
 *   SUFFICIENT            every in-scope territory has an analysis result (and, for frontier
 *                         exploration, enough supported candidates or no room for more)
 *   MORE_EVIDENCE_USEFUL  otherwise, with the concrete next steps
 *
 * v2 adds `nextActions`: a RULE-BASED expected value (HIGH / MEDIUM / LOW / NONE) for each candidate next
 * action, so calls go to unresolved blockers first:
 *   HIGH    resolves a blocker (unresolved brand or concept, no representation yet, comparison set < 3
 *           with usable references, too few frontier candidates)
 *   MEDIUM  improves an existing result (a second exemplar enables robustness; candidate profiles enable
 *           the quality check; untested reference concepts)
 *   LOW     marginal (a further exemplar beyond two)
 *   NONE    cannot change the result (fixed Qloo tag cap reached, strategy exhausted, nothing left to try)
 * and `materialGap`: true while any investigation action is HIGH or MEDIUM. Without a material gap the
 * runtime stops Qloo investigation (early stopping) and analysis is the next step.
 *
 * The runtime enforces it: once SUFFICIENT, further Qloo calls are refused; INSUFFICIENT and
 * BUDGET_EXHAUSTED end the loop. The model cannot keep looping because it "feels uncertain".
 *
 * v3 (Sprint 5A, from live traces): reference construction is valued from the deterministic referencePlan —
 * HIGH while a semantically meaningful comparison set is still feasible within the remaining budget (analyzing
 * the targets first would lock a PARTIAL route), NONE with the reason once it is not (an honest partial result
 * is a valid outcome). Barren probes (an entity type that returned nothing for ≥ 2 of a territory's concepts) are
 * NONE until another supported type has been tried for that territory (it forces diversification, it never bans a type). `investigationStage` names the stage the run is in.
 */
import type { EvidenceSufficiencyVerdict, NextActionValue } from "@cultural-elasticity/shared";
import { exemplarCandidates, frontierConcepts } from "./candidate-discovery.js";
import { analysisReserve } from "./analysis-runner.js";
import { MIN_FRONTIER_SUPPORTED } from "./contracts.js";
import { frontierEvidenceBaseGap, viableFrontierCandidates } from "./frontier.js";
import { barrenTypes, isReady, recoverable, recoveryOptions, territoryReadiness, typePreference } from "./readiness.js";
import { comparisonSetSize, referenceEntityType, referencePlan } from "./reference-strategy.js";
import { MIN_COMPARISON_SET } from "./router.js";
import { conceptPools, territoryQueryTags } from "./probe-policy.js";
import { activeTerritories, remainingQlooCalls, turnsAvailable, type AgentRunState } from "./state.js";

export { MIN_FRONTIER_SUPPORTED };

export type SufficiencyAssessment = { verdict: EvidenceSufficiencyVerdict; reasons: string[]; nextSteps: string[]; nextActions: NextActionValue[]; materialGap: boolean };

const INVESTIGATION = (a: NextActionValue) => a.action !== "analyze" && a.action !== "finish" && a.action !== "ask_user";

/** Rule-based next-action values for the current state (see the header). */
export function nextActionValues(state: AgentRunState): NextActionValue[] {
  const out: NextActionValue[] = [];
  const add = (action: string, target: string | null, value: NextActionValue["value"], reason: string) => out.push({ action, target, value, reason });
  if (!state.interpretation) {
    add("interpret_request", null, "HIGH", "the goal is not interpreted yet");
    return out;
  }
  const brand = state.brand.entity;
  if (!brand) {
    if (state.brand.ambiguity && state.clarifications.length === 0) add("ask_user", null, "HIGH", "the brand is ambiguous in Qloo");
    else add("qloo_resolve_entity", null, "HIGH", state.brand.ambiguity ? "resolve the candidate the user chose" : "the brand is not resolved");
    return out;
  }
  if (state.profiles.has(brand.id)) add("more_brand_tags", brand.id, "NONE", "the brand profile is already at the fixed Qloo tag cap (20); more tags cannot be requested");
  else add("qloo_get_entity_tags", brand.id, "MEDIUM", "the brand profile is needed for analysis and reference/frontier discovery");

  const open = activeTerritories(state).filter((t) => t.status !== "analyzed");
  for (const t of open) {
    const r = territoryReadiness(state, t);
    if (r.state === "needs_concept" && t.sourceTagId && conceptPools(state, t.sourceTagId).length === 0 && !territoryQueryTags(state, t)) {
      // Sprint 5A.1: a grounded candidate is first tested on the Qloo tag that grounded it (its canonical concept).
      add("qloo_recommend", t.key, "HIGH", `probe the candidate's own Qloo concept ${t.sourceTagId} before searching other tags`);
      add("qloo_find_tags", t.key, "MEDIUM", "search for an alternate concept only if the grounding tag has no members");
    } else if (r.state === "needs_concept") add(territoryQueryTags(state, t) ? "anchor_territory" : "qloo_find_tags", t.key, "HIGH", r.reason);
    else if (r.state === "unsupported") add("investigate", t.key, "NONE", `${r.reason}; report it as unsupported`);
    else if (r.state === "needs_representation") {
      const options = recoveryOptions(state, t);
      if (options.strategies.length === 0) add("qloo_recommend", t.key, "HIGH", "no Qloo member pool requested for the concept yet");
      else add("validate_territory_representation", t.key, "HIGH", "Qloo returned exemplar candidates for an available strategy");
      const top = options.strategies.find((s) => s.status === "available");
      if (top && t.concept) {
        const candidates = exemplarCandidates(state, t.concept.id, top.entityType).eligible;
        const profiled = candidates.filter((c) => state.profiles.has(c.id)).length;
        if (candidates.length >= 3 && profiled < 3) add("qloo_get_entity_tags", t.key, "MEDIUM", "candidate tag profiles let the quality check compare peers before choosing exemplars");
      }
    } else if (r.state === "ready" && r.mode === "panel" && t.representation && t.concept) {
      const n = t.representation.exemplars.length;
      const more = exemplarCandidates(state, t.concept.id, t.representation.entityType).eligible.filter((c) => !t.representation!.exemplars.some((e) => e.id === c.id) && !t.rejectedExemplars.some((x) => x.id === c.id)).length;
      if (n >= state.limits.maxExemplarsPerTerritory || more === 0) add("add_exemplar", t.key, "NONE", n >= state.limits.maxExemplarsPerTerritory ? "exemplar limit reached" : "no further eligible candidate in the observed Qloo pools");
      else if (n === 1) add("add_exemplar", t.key, "MEDIUM", "a second exemplar enables the representation-robustness test");
      else add("add_exemplar", t.key, "LOW", "robustness is already testable; a further exemplar changes little");
    } else if (r.state === "ready" && recoverable(state, t)) add("qloo_recommend", t.key, "MEDIUM", "recovery: an untried entity type or alternate Qloo concept may yield valid exemplars");
    else if (r.state === "ready") add("add_exemplar", t.key, "NONE", r.reason);
  }

  const intent = state.interpretation.intent;
  const room = state.territories.length < state.limits.maxCandidateTerritories && remainingQlooCalls(state) >= 2;
  let referencesPending = false;
  if (state.request.researchMode !== "single_hypothesis_v1" && (intent === "analyze_move" || intent === "compare_territories") && referenceEntityType(state) !== null && comparisonSetSize(state) < MIN_COMPARISON_SET) {
    const plan = referencePlan(state);
    if (plan.feasible) {
      referencesPending = true;
      add("add_references", null, "HIGH", plan.outstanding ?? plan.reason);
    } else if (plan.applicable) add("add_references", null, "NONE", plan.reason || "no meaningful reference can be added; analysis stays partial");
    else if (!room) add("add_references", null, "NONE", "no room left in the candidate or call budget; analysis stays partial");
  }
  if (intent === "explore_frontier") {
    const viable = viableFrontierCandidates(state);
    const gap = frontierEvidenceBaseGap(state);
    const frontierTarget = MIN_FRONTIER_SUPPORTED + 1;
    // Channel A is a discovery priority, not a territory-level finish blocker (runtime finish refuses HIGH
    // actions with a target). Keep the entity id in the reason; outstanding still names the exact call.
    if (gap) add(gap.action, null, viable < frontierTarget ? "HIGH" : "MEDIUM", `${gap.reason} (${gap.action} ${gap.target})`);
    if (viable >= frontierTarget) add("propose_frontier", null, "NONE", `${viable} viable Qloo-grounded candidates`);
    else if (!room) add("propose_frontier", null, "NONE", "no room left in the candidate or call budget");
    else if (state.skillUsage.get("explore_candidate_territories")?.exhausted || state.skillUsage.get("explore_candidate_territories")?.qlooSpent) add("propose_frontier", null, "NONE", "the frontier skill budget is spent");
    else add("propose_frontier", null, gap ? "MEDIUM" : frontierConcepts(state, 1).length > 0 ? "HIGH" : "MEDIUM", `${viable} viable Qloo-grounded candidate(s); fewer than ${frontierTarget}`);
  }

  const ready = open.filter((t) => isReady(territoryReadiness(state, t)));
  // Calls the analysis of ready territories needs are reserved: once only the reserve is left, investigation has no value.
  const reserve = analysisReserve(state, ready);
  if (ready.length > 0 && remainingQlooCalls(state) <= reserve) {
    for (const a of out) if (INVESTIGATION(a) && a.value !== "NONE") Object.assign(a, { value: "NONE", reason: `${remainingQlooCalls(state)} Qloo call(s) left are reserved for the analysis of ready territories (${reserve} needed)` });
  }
  // Sprint 5A.1 completion reserve: the last turn the run can act in belongs to the analysis of what is ready.
  if (ready.length > 0 && turnsAvailable(state) <= 1) {
    for (const a of out) if (INVESTIGATION(a) && a.value !== "NONE") Object.assign(a, { value: "NONE", reason: "COMPLETION_RESERVE: this is the last turn; analyze the ready territories instead of investigating further" });
  }
  const gap = out.some((a) => INVESTIGATION(a) && (a.value === "HIGH" || a.value === "MEDIUM"));
  if (ready.length > 0 && referencesPending && state.referenceDeferrals === 0 && ready.some((t) => t.role === "target")) add("analyze", ready.map((t) => t.key).join(","), "LOW", "analyzing the targets now would lock a PARTIAL route while a meaningful comparison set is still constructible (see add_references)");
  else if (ready.length > 0) add("analyze", ready.map((t) => t.key).join(","), gap ? "MEDIUM" : "HIGH", gap ? "these territories are ready; other gaps remain" : "no material evidence gap remains: analyze");
  if (open.length === 0 && activeTerritories(state).length > 0) add("finish", null, gap ? "LOW" : "HIGH", "every in-scope territory is analyzed");
  return out;
}

/** Sprint 5A: entity types a brand-independent probe should not repeat for this territory (barren), and what is untried. */
export function barrenProbe(state: AgentRunState, tagId: string, type: string): { barren: string; untried: string[] } | null {
  for (const t of activeTerritories(state).filter((x) => x.status !== "analyzed")) {
    const tags = new Set([...(t.concept ? [t.concept.id] : []), ...(territoryQueryTags(state, t) ?? [])]);
    if (!tags.has(tagId)) continue;
    const barren = barrenTypes(state, t);
    if (!barren.includes(type as never)) continue;
    const tried = new Set(state.pools.filter((p) => p.conditionedOn === null && p.tagIds.length === 1 && tags.has(p.tagIds[0]!)).map((p) => p.targetType as string));
    // The rule forces diversification, never a ban: yield varies by tag namespace (live: brand and place were empty
    // for genre/subgenre heavy-metal tags while place returned 20 members for the interests tag). Once another
    // entity type has been probed for this territory, further probes of this type are allowed again.
    if ([...tried].some((x) => x !== type)) continue;
    return { barren: `${type} probes of ${t.label}'s Qloo concepts returned no members ≥ 2 times`, untried: typePreference(state).filter((x) => !tried.has(x)).slice(0, 3) };
  }
  return null;
}

export type InvestigationStage = "INTERPRETATION" | "RESOLUTION" | "REPRESENTATION" | "REFERENCE_CONSTRUCTION" | "FRONTIER_DISCOVERY" | "ANALYSIS" | "FINISH";

/** Sprint 5A: the stage the run is in, from state (shown to the model; it orders the critical next action). */
export function investigationStage(state: AgentRunState): InvestigationStage {
  if (!state.interpretation) return "INTERPRETATION";
  if (!state.brand.entity) return "RESOLUTION";
  const open = activeTerritories(state).filter((t) => t.status !== "analyzed");
  if (open.some((t) => territoryReadiness(state, t).state === "needs_concept")) return "RESOLUTION";
  if (open.some((t) => territoryReadiness(state, t).state === "needs_representation" || recoverable(state, t))) return "REPRESENTATION";
  if (state.request.researchMode !== "single_hypothesis_v1" && referencePlan(state).feasible) return "REFERENCE_CONSTRUCTION";
  if (state.interpretation.intent === "explore_frontier" && nextActionValues(state).some((a) => a.action === "propose_frontier" && a.value !== "NONE")) return "FRONTIER_DISCOVERY";
  if (open.length > 0) return "ANALYSIS";
  return "FINISH";
}

export function assessEvidenceSufficiency(state: AgentRunState): SufficiencyAssessment {
  const reasons: string[] = [];
  const nextSteps: string[] = [];
  let nextActions: NextActionValue[] = [];
  const done = (verdict: EvidenceSufficiencyVerdict) => ({ verdict, reasons, nextSteps, nextActions, materialGap: nextActions.some((a) => INVESTIGATION(a) && (a.value === "HIGH" || a.value === "MEDIUM")) });

  if (state.pendingQuestion) {
    reasons.push("waiting for the user's answer");
    return done("NEEDS_USER_INPUT");
  }
  if (state.brand.ambiguity && !state.brand.entity) {
    if (state.clarifications.length === 0) {
      reasons.push(`brand "${state.brand.ambiguity.input}" is ambiguous in Qloo (${state.brand.ambiguity.candidates.map((c) => c.label).join(" | ")}); only the user can choose`);
      return done("NEEDS_USER_INPUT");
    }
    nextSteps.push("resolve the brand using the user's clarification (qloo_resolve_entity with the chosen candidate id)");
  }
  nextActions = nextActionValues(state);
  // Work remains: allowed only while iterations remain.
  const more = () => {
    if (state.usage.iterations >= state.limits.maxAgentIterations) {
      reasons.push(`iteration budget (${state.limits.maxAgentIterations}) spent`);
      return done("BUDGET_EXHAUSTED");
    }
    return done("MORE_EVIDENCE_USEFUL");
  };
  if (!state.interpretation) {
    if (state.skillUsage.get("interpret_request")?.exhausted) {
      reasons.push("the goal could not be interpreted within the interpretation skill's budget");
      return done("INSUFFICIENT");
    }
    nextSteps.push("interpret the request (interpret_request)");
    return more();
  }
  if (!state.brand.entity) {
    if (state.skillUsage.get("resolve_brand")?.exhausted) {
      reasons.push("the brand could not be resolved within the brand-resolution skill's budget");
      return done("INSUFFICIENT");
    }
    if (state.brand.notFound && state.brand.attempts >= 2) {
      reasons.push(`the brand could not be resolved in Qloo after ${state.brand.attempts} attempts`);
      return done("INSUFFICIENT");
    }
    if (remainingQlooCalls(state) < 1) {
      reasons.push("Qloo budget spent before the brand was resolved");
      return done("BUDGET_EXHAUSTED");
    }
    nextSteps.push("resolve the brand (qloo_resolve_entity, role brand)");
    return more();
  }

  const active = activeTerritories(state);
  const open = active.filter((t) => t.status !== "analyzed");
  const useful = [...state.results.values()].filter((r) => r.analysisRoute !== "INSUFFICIENT_EVIDENCE" && active.some((t) => t.key === r.key));
  const intent = state.interpretation.intent;
  const roomForMore = state.territories.length < state.limits.maxCandidateTerritories && remainingQlooCalls(state) >= 2 && !state.skillUsage.get("explore_candidate_territories")?.exhausted && !state.skillUsage.get("explore_candidate_territories")?.qlooSpent;

  if (open.length === 0) {
    if (intent === "explore_frontier") {
      const supported = useful.filter((r) => r.role === "frontier_candidate").length;
      if (supported < MIN_FRONTIER_SUPPORTED && roomForMore) {
        reasons.push(`${supported} supported frontier candidate(s); fewer than ${MIN_FRONTIER_SUPPORTED} and budget remains`);
        nextSteps.push("propose and investigate further frontier candidates grounded in Qloo evidence");
        return more();
      }
    }
    if (active.length === 0) {
      reasons.push("no territory remains in scope");
      return done("INSUFFICIENT");
    }
    if (useful.length === 0) {
      reasons.push("every in-scope territory was analyzed, but none has measurable evidence");
      return done("INSUFFICIENT");
    }
    reasons.push(`all ${active.length} in-scope territories have analysis results`);
    return done("SUFFICIENT");
  }

  if (remainingQlooCalls(state) < 1) {
    reasons.push(`Qloo budget (${state.limits.maxQlooCalls}) spent with ${open.length} territory(ies) unanalyzed`);
    nextSteps.push(`analyze what has evidence already (${open.map((t) => t.key).join(", ")})`);
    return done("BUDGET_EXHAUSTED");
  }
  for (const t of open) {
    const r = territoryReadiness(state, t);
    if (r.state === "needs_concept") nextSteps.push(`${t.key}: find and anchor a Qloo concept (qloo_find_tags → anchor_territory), or drop it`);
    else if (r.state === "needs_representation") nextSteps.push(`${t.key}: discover exemplars (qloo_recommend on the concept), check candidate quality and propose a representation; or declare_concept_only`);
    else nextSteps.push(`${t.key}: ready to analyze (${"reason" in r ? r.reason : r.state})`);
  }
  reasons.push(`${open.length} in-scope territory(ies) not yet analyzed`);
  return more();
}
