/**
 * Deterministic evidence sufficiency: may the agent keep investigating?
 *
 *   NEEDS_USER_INPUT      an unresolved ambiguity only the user can settle (no silent choice)
 *   BUDGET_EXHAUSTED      iterations or Qloo calls are spent while work remains
 *   INSUFFICIENT          nothing analyzable can be produced (e.g. the brand cannot be resolved)
 *   SUFFICIENT            every in-scope territory has an analysis result (and, for frontier
 *                         exploration, enough supported candidates or no room for more)
 *   MORE_EVIDENCE_USEFUL  otherwise, with the concrete next steps
 *
 * The runtime enforces it: once SUFFICIENT, further Qloo calls are refused; INSUFFICIENT and
 * BUDGET_EXHAUSTED end the loop. The model cannot keep looping because it "feels uncertain".
 */
import type { EvidenceSufficiencyVerdict } from "@cultural-elasticity/shared";
import { activeTerritories, remainingQlooCalls, type AgentRunState } from "./state.js";

/** Frontier exploration stops proposing once this many candidates have a non-INSUFFICIENT analysis. */
export const MIN_FRONTIER_SUPPORTED = 3;

export type SufficiencyAssessment = { verdict: EvidenceSufficiencyVerdict; reasons: string[]; nextSteps: string[] };

export function assessEvidenceSufficiency(state: AgentRunState): SufficiencyAssessment {
  const reasons: string[] = [];
  const nextSteps: string[] = [];
  const done = (verdict: EvidenceSufficiencyVerdict) => ({ verdict, reasons, nextSteps });

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
  // Work remains: allowed only while iterations remain.
  const more = () => {
    if (state.usage.iterations >= state.limits.maxAgentIterations) {
      reasons.push(`iteration budget (${state.limits.maxAgentIterations}) spent`);
      return done("BUDGET_EXHAUSTED");
    }
    return done("MORE_EVIDENCE_USEFUL");
  };
  if (!state.interpretation) {
    nextSteps.push("interpret the request (interpret_request)");
    return more();
  }
  if (!state.brand.entity) {
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
  const roomForMore = state.territories.length < state.limits.maxCandidateTerritories && remainingQlooCalls(state) >= 2;

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
    if (!t.concept) nextSteps.push(`${t.key}: find and anchor a Qloo concept (qloo_find_tags → anchor_territory), or drop it`);
    else if (!t.representation && t.attempts < state.limits.maxRepresentationAttemptsPerTerritory) nextSteps.push(`${t.key}: discover exemplars (qloo_recommend on the concept) and propose a representation, or analyze with concept-only evidence`);
    else nextSteps.push(`${t.key}: ready to analyze`);
  }
  reasons.push(`${open.length} in-scope territory(ies) not yet analyzed`);
  return more();
}
