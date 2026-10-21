/**
 * Representation alignment (Sprint 5A.1): can the territories of one comparison share a Qloo entity type?
 *
 * A relative position needs ≥ 3 represented territories of ONE entity type, compared within one Qloo call. Sprint 5A
 * discovered type incompatibilities only after anchoring (live L-C1: two targets represented as places, the third
 * anchored to a concept with only brand members, so no comparison set existed). This planner looks at what Qloo
 * returned BEFORE the remaining territories are anchored:
 *
 *   supported(T)   territories with a representation of type T, or a concept whose brand-independent pool of T
 *                  returned eligible members in this run (observed provider evidence)
 *   possible(T)    territories not yet supported for T that still have a concept untested with T whose probing is not
 *                  exhausted (a viable probe path; no type is assumed available because its name sounds right)
 *   preferred      the type supported by the most territories (ties: represented territories, then recovery order)
 *   feasibility    SUPPORTED   the preferred type already covers the required territories
 *                  POSSIBLE    supported + possible cover them
 *                  UNSUPPORTED no type can: the comparison is not forced; the analysis stays PARTIAL/DESCRIPTIVE
 *
 * The plan never converts entity types, never treats tags as entities and never compares values across calls: it only
 * orders which probes to make and which concept to anchor. Nothing here depends on a territory's name.
 */
import type { ComparisonRepresentationPlan } from "@cultural-elasticity/shared";
import { RANKABLE_TYPES, type RankableType } from "./contracts.js";
import { conceptPools, conceptProbeState, eligibleMembers, territoryConcepts, territoryProbeState, typePreference } from "./probe-policy.js";
import { MIN_COMPARISON_SET } from "./router.js";
import { activeTerritories, type AgentRunState, type TerritoryState } from "./state.js";

export const ALIGNMENT_RULES_VERSION = "representation-alignment-v1";

/** Territories one comparison must align: user targets (compare), or frontier candidates (frontier). */
export function alignmentTerritories(state: AgentRunState): TerritoryState[] {
  const intent = state.interpretation?.intent;
  const active = activeTerritories(state).filter((t) => t.status !== "analyzed" || state.results.has(t.key));
  if (intent === "compare_territories") return active.filter((t) => t.role === "target");
  if (intent === "explore_frontier") return active.filter((t) => t.role === "frontier_candidate");
  return [];
}

/** True when a concept of the territory returned eligible members of the type, or it is represented with it. */
export function supportsType(state: AgentRunState, t: TerritoryState, type: RankableType): boolean {
  if (t.representation) return t.representation.entityType === type;
  return territoryConcepts(state, t).some((id) => conceptPools(state, id).some((p) => p.targetType === type && eligibleMembers(state, p) > 0));
}

/** Concepts of the territory that have not been probed with the type and whose probing is not exhausted. */
export function untestedConceptsFor(state: AgentRunState, t: TerritoryState, type: RankableType): string[] {
  if (t.representation || territoryProbeState(state, t).exhausted) return [];
  return territoryConcepts(state, t).filter((id) => {
    const probe = conceptProbeState(state, id);
    return !probe.attemptedTypes.includes(type) && !probe.probingExhausted;
  });
}

export function comparisonRepresentationPlan(state: AgentRunState): ComparisonRepresentationPlan | null {
  const territories = alignmentTerritories(state);
  const intent = state.interpretation?.intent;
  if (territories.length < 2 || !state.brand.entity) return null;
  // Compare: every named target should share the type (two targets still need references of it). Frontier: a set of 3.
  const required = intent === "compare_territories" ? territories.length : Math.min(MIN_COMPARISON_SET, territories.length);
  const supported: Record<string, string[]> = {};
  const possible: Record<string, string[]> = {};
  for (const type of RANKABLE_TYPES) {
    const s = territories.filter((t) => supportsType(state, t, type)).map((t) => t.key);
    const p = territories.filter((t) => !s.includes(t.key) && untestedConceptsFor(state, t, type).length > 0).map((t) => t.key);
    if (s.length > 0) supported[type] = s;
    if (s.length > 0 && p.length > 0) possible[type] = p;
  }
  const order = typePreference(state);
  const represented = (type: string) => territories.filter((t) => t.representation?.entityType === type).length;
  const candidates = (Object.keys(supported) as RankableType[]).sort((a, b) => supported[b]!.length - supported[a]!.length || represented(b) - represented(a) || (possible[b]?.length ?? 0) - (possible[a]?.length ?? 0) || order.indexOf(a) - order.indexOf(b));
  const preferred = candidates[0] ?? null;
  const reasonCodes: string[] = [];
  const missing: string[] = [];
  if (!preferred) {
    reasonCodes.push("NO_TYPE_OBSERVED");
    return { territoryKeys: territories.map((t) => t.key), candidateEntityTypes: [], preferredCommonType: null, supportedTerritoriesByType: supported, possibleTerritoriesByType: possible, feasibility: "POSSIBLE", required, missingRequirements: ["no territory has returned Qloo members yet: probe the concepts first"], reasonCodes, rulesVersion: ALIGNMENT_RULES_VERSION };
  }
  const covered = supported[preferred]!.length;
  const reachable = covered + (possible[preferred]?.length ?? 0);
  const feasibility: ComparisonRepresentationPlan["feasibility"] = covered >= required ? "SUPPORTED" : reachable >= required ? "POSSIBLE" : "UNSUPPORTED";
  reasonCodes.push(feasibility === "SUPPORTED" ? "COMMON_TYPE_SUPPORTED" : feasibility === "POSSIBLE" ? "COMMON_TYPE_POSSIBLE" : "NO_COMMON_TYPE");
  for (const t of territories) {
    if (supported[preferred]!.includes(t.key)) continue;
    const untested = untestedConceptsFor(state, t, preferred);
    if (untested.length > 0) {
      reasonCodes.push(`TYPE_PROBE_PATH:${t.key}`);
      missing.push(`${t.key}: no ${preferred} members observed yet; probe ${preferred} on ${untested.slice(0, 3).map((id) => `${state.tags.get(id)?.label ?? id} [${id}]`).join(", ")} before switching to another type`);
    } else {
      reasonCodes.push(`TYPE_MISMATCH:${t.key}`);
      missing.push(`${t.key}: cannot be represented as ${preferred} with the concepts observed (${t.representation ? `represented as ${t.representation.entityType}` : "no untested concept left"}); it will not join the ${preferred} comparison set`);
    }
  }
  return {
    territoryKeys: territories.map((t) => t.key),
    candidateEntityTypes: candidates,
    preferredCommonType: preferred,
    supportedTerritoriesByType: supported,
    possibleTerritoriesByType: possible,
    feasibility,
    required,
    missingRequirements: missing,
    reasonCodes,
    rulesVersion: ALIGNMENT_RULES_VERSION,
  };
}

/** The type a territory should be probed or represented with first (null when no comparison type is planned). */
export function preferredTypeFor(state: AgentRunState, t: TerritoryState): RankableType | null {
  const plan = comparisonRepresentationPlan(state);
  if (!plan?.preferredCommonType || !plan.territoryKeys.includes(t.key)) return null;
  return plan.preferredCommonType as RankableType;
}

/**
 * Bounded alignment deferral (compare only, once per target): anchoring a target to a concept with no members of the
 * preferred common type while another of its concepts is still untested with that type. Returns the instruction, or
 * null. Anchoring again proceeds: alignment is steered, never forced.
 */
export function alignmentDeferral(state: AgentRunState, t: TerritoryState, tagId: string): string | null {
  if (state.interpretation?.intent !== "compare_territories" || t.role !== "target" || state.alignmentDeferrals.has(t.key)) return null;
  const plan = comparisonRepresentationPlan(state);
  const preferred = plan?.preferredCommonType as RankableType | null | undefined;
  if (!plan || !preferred) return null;
  const others = (plan.supportedTerritoriesByType[preferred] ?? []).filter((k) => k !== t.key);
  if (others.length === 0) return null;
  if (conceptPools(state, tagId).some((p) => p.targetType === preferred && eligibleMembers(state, p) > 0)) return null;
  const untested = untestedConceptsFor(state, t, preferred).filter((id) => id !== tagId);
  if (untested.length === 0) return null;
  return `${others.join(", ")} ha${others.length === 1 ? "s" : "ve"} ${preferred} members, but ${state.tags.get(tagId)?.label ?? tagId} has none, so ${t.key} would not share their comparison type. Probe ${preferred} on ${untested.slice(0, 3).map((id) => `${state.tags.get(id)?.label ?? id} [${id}]`).join(", ")} (qloo_recommend, conditionOnBrand=false) first. Deferred once: anchoring this concept again proceeds.`;
}
