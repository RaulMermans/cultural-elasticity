/**
 * Deterministic routing.
 *
 *   resolveInterpretation   the model proposes intent / brand / territories; explicit request fields win
 *                           and a proposal that contradicts them is rejected (never silently merged)
 *   applyInterpretation     the one place an accepted interpretation changes run state (agent turn or query layer)
 *   planComparisonGroups    which territories can share one rank-panel comparison set
 *   selectAnalysisRoute     FULL / PARTIAL / DESCRIPTIVE / INSUFFICIENT from capability availability
 *
 * The model can influence what is investigated. It cannot pick a route or invent a methodology.
 */
import { initialApproach, policyOf } from "./research-intelligence.js";
import type { AnalysisRoute, CapabilityAvailability } from "@cultural-elasticity/shared";
import { MAX_PANEL_OPTIONS } from "../methodology/contracts.js";
import { DEFAULT_QLOO_CALLS, interpretationSchema, type AgentRequest, type Interpretation, type RankableType } from "./contracts.js";
import { planRepresentation } from "./representation-planner.js";
import { addTerritory, recordTag, type AgentRunState, type TerritoryState } from "./state.js";

/**
 * A relative position needs at least three territories in one panel: with two options every rank
 * percentile is 0 or 1, so the "position" collapses to a binary order and the middle class
 * (CREDIBLE_STRETCH) becomes unreachable. The methodology accepts two; the agent requires three.
 */
export const MIN_COMPARISON_SET = 3;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export type InterpretationCheck = { ok: true; interpretation: Interpretation } | { ok: false; reason: string };

export function resolveInterpretation(request: AgentRequest, proposed: unknown): InterpretationCheck {
  const parsed = interpretationSchema.safeParse(proposed);
  if (!parsed.success) return { ok: false, reason: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
  const value = parsed.data;
  if (request.intent && request.intent !== value.intent) return { ok: false, reason: `the request fixes intent ${request.intent}` };
  if (request.brand && !same(request.brand, value.brand)) return { ok: false, reason: `the request fixes brand "${request.brand}"` };
  if (request.territories) {
    const wanted = request.territories.map((t) => t.toLowerCase()).sort();
    const got = value.territories.map((t) => t.toLowerCase()).sort();
    if (wanted.length !== got.length || wanted.some((t, i) => t !== got[i])) return { ok: false, reason: "the request fixes the territory list" };
  }
  return { ok: true, interpretation: value };
}

/**
 * Records an interpretation already accepted by resolveInterpretation. Sprint 5B.1: shared by the agent's own
 * interpret_request turn and the query layer's execution gate, so both paths have identical effects.
 */
export function applyInterpretation(state: AgentRunState, interpretation: Interpretation, source: "agent_turn" | "query_layer"): void {
  state.interpretation = interpretation;
  state.brand.query = interpretation.brand;
  state.trace.intent = interpretation.intent;
  state.trace.interpretedRequest = { ...interpretation };
  state.trace.interpretationSource = source;
  if (!state.qlooBudgetExplicit && !state.request.intent && !state.request.researchMode) {
    // Budget defaults are per intent (spec §25); the intent is only known now.
    state.limits.maxQlooCalls = Math.max(state.usage.qlooCalls, DEFAULT_QLOO_CALLS[interpretation.intent]);
    state.trace.limits.maxQlooCalls = state.limits.maxQlooCalls;
  }
  for (const label of interpretation.territories) {
    // Sprint 9O: a direction handed over from the baseline keeps the Qloo tag the scan observed (live Carhartt → Blue
    // Collar re-resolved the name and never probed it). It is the first concept to probe, not evidence of support.
    const g = state.territoryGrounding;
    const grounded = g && g.territory.trim().toLowerCase() === label.trim().toLowerCase() ? g : null;
    if (grounded) recordTag(state, { id: grounded.tagId, label: grounded.label, type: grounded.type }, { kind: "profile", query: null, subjectId: grounded.subjectId, correlationId: grounded.correlationId });
    addTerritory(state, { label, role: "target", origin: "user", rationale: grounded ? `named by the user; the brand baseline observed it as Qloo tag ${grounded.tagId}` : "named by the user", ...(grounded && { sourceTagId: grounded.tagId }) });
  }
  // Sprint 11: the research approach is fixed once the operation is known (v1 only; v0 keeps the Sprint 10 flow).
  if (policyOf(state) === "v1") state.researchApproach = initialApproach(state);
}

/** Intent implied by the request structure alone, when it is unambiguous. */
export function structuralIntent(request: AgentRequest): Interpretation["intent"] | undefined {
  if (request.intent) return request.intent;
  if (!request.brand || request.territories === undefined) return undefined;
  const n = request.territories.length;
  return n === 0 ? "explore_frontier" : n === 1 ? "analyze_move" : "compare_territories";
}

export type ComparisonGroup = { entityType: RankableType; territoryKeys: string[] };

export function planComparisonGroups(state: AgentRunState, territories: readonly TerritoryState[]): { groups: ComparisonGroup[]; excluded: { key: string; reason: string }[] } {
  const byType = new Map<RankableType, TerritoryState[]>();
  const excluded: { key: string; reason: string }[] = [];
  for (const territory of territories) {
    const plan = planRepresentation(state, territory);
    if (!plan.rankable || plan.entityType === null) {
      excluded.push({ key: territory.key, reason: `strategy ${plan.strategy} is not rankable` });
      continue;
    }
    byType.set(plan.entityType, [...(byType.get(plan.entityType) ?? []), territory]);
  }
  const groups: ComparisonGroup[] = [];
  for (const [entityType, members] of [...byType.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (members.length < MIN_COMPARISON_SET) {
      for (const m of members) excluded.push({ key: m.key, reason: `only ${members.length} rankable ${entityType} territor${members.length === 1 ? "y" : "ies"} in this analysis; a relative position needs ≥ ${MIN_COMPARISON_SET} of one entity type` });
      continue;
    }
    // Keep user-named targets first, then references and frontier candidates, up to the panel cap.
    const ordered = [...members].sort((a, b) => roleOrder(a) - roleOrder(b));
    groups.push({ entityType, territoryKeys: ordered.slice(0, MAX_PANEL_OPTIONS).map((t) => t.key) });
    for (const m of ordered.slice(MAX_PANEL_OPTIONS)) excluded.push({ key: m.key, reason: `panel cap of ${MAX_PANEL_OPTIONS} options reached` });
  }
  return { groups, excluded };
}

const roleOrder = (t: TerritoryState) => (t.role === "target" ? 0 : t.role === "frontier_candidate" ? 1 : 2);

export function selectAnalysisRoute(capabilities: CapabilityAvailability): AnalysisRoute {
  if (capabilities.relativePosition === "AVAILABLE") return "FULL_RELATIVE_ANALYSIS";
  const coherence = capabilities.coherence === "AVAILABLE";
  const conditioned = capabilities.conditionedEvidence === "AVAILABLE";
  if (coherence && conditioned) return "PARTIAL_CULTURAL_ANALYSIS";
  if (coherence || conditioned) return "DESCRIPTIVE_ANALYSIS";
  return "INSUFFICIENT_EVIDENCE";
}
