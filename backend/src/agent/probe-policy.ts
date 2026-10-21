/**
 * Bounded entity-type probing (Sprint 5A.1, from live traces).
 *
 * A probe is one brand-independent, single-tag recommend call: "does Qloo have members of type T for concept C?".
 * Sprint 5A's recovery guidance listed every untried supported type, and Haiku walked eight types for a concept Qloo
 * does not support (live L-C2: 8 empty probes over four turns), leaving no turns to build references.
 *
 *   ConceptProbeState   derived from state.pools (no second ledger): attempted, empty, successful and unreliable types
 *   probe limits        MAX_EMPTY_TYPE_PROBES_PER_CONCEPT empty types per concept, MAX_EMPTY_PROBES_PER_TERRITORY across a
 *                       territory's concepts; then further NEW-type probes of that concept (territory) have no value
 *   what counts         only probes Qloo answered with status ok/empty and no members. A failed call (network, timeout,
 *                       contract error) never becomes a pool, and a partial/degraded empty answer is "unreliable": neither
 *                       is evidence that a type is unsupported
 *   what is kept        members already observed stay usable: a type that returned members is never refused
 *   type ranking        recovery priority: the comparison's preferred common type, then types that returned members in
 *                       this run (most productive first), then place and brand, then the other rankable types
 *
 * Nothing here depends on a territory's name: only on what Qloo returned in this run.
 */
import type { ConceptProbeView } from "@cultural-elasticity/shared";
import { RANKABLE_TYPES, type RankableType } from "./contracts.js";
import type { AgentRunState, PoolRecord, TerritoryState } from "./state.js";

export const PROBE_POLICY_VERSION = "probe-policy-v1";
/** Empty entity-type probes allowed per concept before probing it with new types stops. */
export const MAX_EMPTY_TYPE_PROBES_PER_CONCEPT = 3;
/** Empty probes allowed across one territory's concepts while none of them returned members. */
export const MAX_EMPTY_PROBES_PER_TERRITORY = 6;

export type ConceptProbeState = {
  conceptKey: string;
  attemptedTypes: RankableType[];
  emptyTypes: RankableType[];
  successfulTypes: RankableType[];
  /** Probed, but Qloo's answer was partial or degraded and empty: not counted as unsupported. */
  unreliableTypes: RankableType[];
  remainingTypeOptions: RankableType[];
  currentPreferredType: RankableType | null;
  consecutiveEmptyProbes: number;
  totalEmptyTypeProbes: number;
  probingExhausted: boolean;
  exhaustionReason: string | null;
};

const unreliable = (pool: PoolRecord) => pool.call.envelope.status === "partial" || pool.call.envelope.status === "degraded";

/** Brand-independent single-tag pools for a concept, in call order. */
export function conceptPools(state: AgentRunState, conceptId: string): PoolRecord[] {
  return state.pools.filter((p) => p.conditionedOn === null && p.tagIds.length === 1 && p.tagIds[0] === conceptId);
}

/** Members other than the brand itself. */
export function eligibleMembers(state: AgentRunState, pool: PoolRecord): number {
  const brandId = state.brand.entity?.id;
  return pool.memberIds.filter((id) => id !== brandId).length;
}

/**
 * Entity types in recovery order (see the header). Every type listed is accepted by qloo_recommend; none is invented.
 * `preferred` (the comparison's common type, when one exists) comes first.
 */
export function typePreference(state: AgentRunState, preferred: RankableType | null = null): RankableType[] {
  const yieldByType = new Map<RankableType, number>();
  for (const pool of state.pools) if (pool.conditionedOn === null && eligibleMembers(state, pool) > 0) yieldByType.set(pool.targetType, (yieldByType.get(pool.targetType) ?? 0) + 1);
  const fixed: RankableType[] = ["place", "brand"];
  const ordered = [...RANKABLE_TYPES].sort((a, b) => (yieldByType.get(b) ?? 0) - (yieldByType.get(a) ?? 0) || (fixed.includes(a) ? fixed.indexOf(a) : 9) - (fixed.includes(b) ? fixed.indexOf(b) : 9));
  return preferred ? [preferred, ...ordered.filter((t) => t !== preferred)] : ordered;
}

export function conceptProbeState(state: AgentRunState, conceptId: string, preferred: RankableType | null = null): ConceptProbeState {
  const pools = conceptPools(state, conceptId);
  const attempted: RankableType[] = [];
  const successful: RankableType[] = [];
  for (const pool of pools) {
    if (!attempted.includes(pool.targetType)) attempted.push(pool.targetType);
    if (eligibleMembers(state, pool) > 0 && !successful.includes(pool.targetType)) successful.push(pool.targetType);
  }
  const empty = attempted.filter((type) => !successful.includes(type) && pools.some((p) => p.targetType === type && !unreliable(p)));
  const unreliableTypes = attempted.filter((type) => !successful.includes(type) && !empty.includes(type));
  let consecutive = 0;
  for (const pool of [...pools].reverse()) {
    if (unreliable(pool)) continue;
    if (eligibleMembers(state, pool) > 0) break;
    consecutive += 1;
  }
  const exhausted = empty.length >= MAX_EMPTY_TYPE_PROBES_PER_CONCEPT;
  const label = state.tags.get(conceptId)?.label ?? conceptId;
  const remaining = exhausted ? [] : typePreference(state, preferred).filter((type) => !attempted.includes(type)).slice(0, MAX_EMPTY_TYPE_PROBES_PER_CONCEPT - empty.length);
  const rank = typePreference(state, preferred);
  return {
    conceptKey: conceptId,
    attemptedTypes: attempted,
    emptyTypes: empty,
    successfulTypes: [...successful].sort((a, b) => rank.indexOf(a) - rank.indexOf(b)),
    unreliableTypes,
    remainingTypeOptions: remaining,
    currentPreferredType: [...successful].sort((a, b) => rank.indexOf(a) - rank.indexOf(b))[0] ?? remaining[0] ?? null,
    consecutiveEmptyProbes: consecutive,
    totalEmptyTypeProbes: empty.length,
    probingExhausted: exhausted,
    exhaustionReason: exhausted ? `${label}: ${empty.length} entity types (${empty.join(", ")}) returned no members; probing it with further types has no expected value` : null,
  };
}

/** The candidate concepts of a territory: its anchor, its source evidence tag and the tags its own label search returned. */
export function territoryConcepts(state: AgentRunState, t: TerritoryState): string[] {
  return [...new Set([...(t.concept ? [t.concept.id] : []), ...(t.sourceTagId ? [t.sourceTagId] : []), ...(state.searchedQueries.get(t.label.trim().toLowerCase()) ?? [])])];
}

export type TerritoryProbeState = { totalEmpty: number; anySuccessful: boolean; exhausted: boolean; reason: string | null };

export function territoryProbeState(state: AgentRunState, t: TerritoryState): TerritoryProbeState {
  const concepts = territoryConcepts(state, t).map((id) => conceptProbeState(state, id));
  const totalEmpty = concepts.reduce((n, c) => n + c.totalEmptyTypeProbes, 0);
  const anySuccessful = concepts.some((c) => c.successfulTypes.length > 0);
  const exhausted = !anySuccessful && totalEmpty >= MAX_EMPTY_PROBES_PER_TERRITORY;
  return { totalEmpty, anySuccessful, exhausted, reason: exhausted ? `${t.label}: ${totalEmpty} empty probes across its Qloo concepts and none returned members` : null };
}

/**
 * Refusal reason for a brand-independent probe (null when allowed). A type that already returned members for the
 * concept is never refused (reuse); a new type is refused once the concept, or the territory owning it, is exhausted.
 */
export function probeRefusal(state: AgentRunState, tagId: string, type: RankableType): string | null {
  const concept = conceptProbeState(state, tagId);
  if (concept.successfulTypes.includes(type)) return null;
  const others = concept.successfulTypes.length > 0 ? `reuse the type that returned members (${concept.successfulTypes.join(", ")}), ` : "";
  if (concept.probingExhausted) return `${concept.exhaustionReason}. Instead: ${others}anchor a materially different Qloo concept, declare_concept_only, or drop the territory`;
  for (const t of state.territories.filter((x) => x.status !== "dropped" && x.status !== "analyzed")) {
    if (!territoryConcepts(state, t).includes(tagId)) continue;
    const territory = territoryProbeState(state, t);
    if (territory.exhausted) return `${territory.reason}; it is unsupported by Qloo evidence in this run (declare_concept_only if anchored, or drop it)`;
  }
  return null;
}

/** Compact view of a territory's probes for results and context. */
export function probeViews(state: AgentRunState, t: TerritoryState): ConceptProbeView[] {
  return territoryConcepts(state, t)
    .map((id) => ({ id, s: conceptProbeState(state, id) }))
    .filter(({ s }) => s.attemptedTypes.length > 0)
    .map(({ id, s }) => ({
      conceptKey: id,
      label: state.tags.get(id)?.label ?? id,
      attemptedTypes: s.attemptedTypes,
      emptyTypes: s.emptyTypes,
      successfulTypes: s.successfulTypes,
      unreliableTypes: s.unreliableTypes,
      totalEmptyTypeProbes: s.totalEmptyTypeProbes,
      probingExhausted: s.probingExhausted,
      exhaustionReason: s.exhaustionReason,
    }));
}
