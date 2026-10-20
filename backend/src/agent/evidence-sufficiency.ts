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
 */
import type { EvidenceSufficiencyVerdict, NextActionValue } from "@cultural-elasticity/shared";
import { exemplarCandidates, frontierConcepts } from "./candidate-discovery.js";
import { analysisReserve } from "./analysis-runner.js";
import { MIN_FRONTIER_SUPPORTED } from "./contracts.js";
import { isReady, recoverable, recoveryOptions, territoryReadiness } from "./readiness.js";
import { comparisonSetSize, referenceCandidates, referenceEntityType } from "./reference-strategy.js";
import { MIN_COMPARISON_SET } from "./router.js";
import { activeTerritories, remainingQlooCalls, type AgentRunState } from "./state.js";

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
    if (r.state === "needs_concept") add(state.searchedQueries.has(t.label.trim().toLowerCase()) ? "anchor_territory" : "qloo_find_tags", t.key, "HIGH", r.reason);
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
  if ((intent === "analyze_move" || intent === "compare_territories") && referenceEntityType(state) !== null && comparisonSetSize(state) < MIN_COMPARISON_SET) {
    if (!room) add("add_references", null, "NONE", "no room left in the candidate or call budget; analysis stays partial");
    else if (state.skillUsage.get("build_comparison_set")?.exhausted || state.skillUsage.get("build_comparison_set")?.qlooSpent) add("add_references", null, "NONE", "the comparison-set skill budget is spent; analysis stays partial");
    else {
      const candidates = referenceCandidates(state).filter((c) => c.usable !== false && c.namespaceYield !== "unproductive");
      if (candidates.some((c) => c.usable === true)) add("add_references", null, "HIGH", `Qloo has members for a reference concept; ${MIN_COMPARISON_SET - comparisonSetSize(state)} more represented territory(ies) enable a relative position`);
      else if (candidates.length > 0) add("add_references", null, "MEDIUM", "untested reference concepts remain");
      else add("add_references", null, "NONE", "no reference concept with Qloo members of the target's type; analysis stays partial");
    }
  }
  if (intent === "explore_frontier") {
    const viable = activeTerritories(state).filter((t) => t.role === "frontier_candidate" && state.results.get(t.key)?.analysisRoute !== "INSUFFICIENT_EVIDENCE").length;
    if (viable >= MIN_FRONTIER_SUPPORTED + 1) add("propose_frontier", null, "NONE", `${viable} viable candidates`);
    else if (!room) add("propose_frontier", null, "NONE", "no room left in the candidate or call budget");
    else if (state.skillUsage.get("explore_candidate_territories")?.exhausted || state.skillUsage.get("explore_candidate_territories")?.qlooSpent) add("propose_frontier", null, "NONE", "the frontier skill budget is spent");
    else add("propose_frontier", null, state.related.length === 0 || frontierConcepts(state, 1).length > 0 ? "HIGH" : "MEDIUM", `${viable} viable frontier candidate(s); fewer than ${MIN_FRONTIER_SUPPORTED + 1}`);
  }

  const ready = open.filter((t) => isReady(territoryReadiness(state, t)));
  // Calls the analysis of ready territories needs are reserved: once only the reserve is left, investigation has no value.
  const reserve = analysisReserve(state, ready);
  if (ready.length > 0 && remainingQlooCalls(state) <= reserve) {
    for (const a of out) if (INVESTIGATION(a) && a.value !== "NONE") Object.assign(a, { value: "NONE", reason: `${remainingQlooCalls(state)} Qloo call(s) left are reserved for the analysis of ready territories (${reserve} needed)` });
  }
  const gap = out.some((a) => INVESTIGATION(a) && (a.value === "HIGH" || a.value === "MEDIUM"));
  if (ready.length > 0) add("analyze", ready.map((t) => t.key).join(","), gap ? "MEDIUM" : "HIGH", gap ? "these territories are ready; other gaps remain" : "no material evidence gap remains: analyze");
  if (open.length === 0 && activeTerritories(state).length > 0) add("finish", null, gap ? "LOW" : "HIGH", "every in-scope territory is analyzed");
  return out;
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
