/**
 * Bounded entity-type probing (Sprint 5A.1, from live traces) and evidence-ranked probe types (Sprint 5A.2).
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
 *
 * Sprint 5A.2 type ranking (probe-policy-v2). Sprint 5A.1 ranked types by global productivity, then place and brand;
 * live L-E1/L-E2 spent their three probe slots on place, brand and artist for `genre:media` / `keyword:media` concepts
 * whose members Qloo returned as books and movies in the same runs. Types are now ranked per concept by the evidence
 * hierarchy (rankProbeTypes):
 *   1 CONCEPT_MEMBERS    the type returned members for this exact concept
 *   2 NAMESPACE_MEMBERS  the type returned members for other concepts of the same observed Qloo tag namespace
 *   3 COMPARISON_TYPE    the comparison's preferred common type (alignment), unless the namespace is barren for it
 *   4 STRUCTURAL         a same-canonical-name concept in another namespace returned members of the type, or entities of
 *                        the type (not the brand) carry the concept in their observed Qloo profiles
 *   5 EXPLORATION        the remaining types: those not yet empty in the namespace first, then run-wide yield, then
 *                        the default order (place, brand, …)
 * The namespace is the tag id's category and source ("genre:media"). It is evidence about where Qloo keeps members, scoped to the
 * namespace and this run, never proof: no type is inferred from a namespace's English name, and a namespace whose
 * concepts returned no members of a type twice (NAMESPACE_BARREN_MIN) only defers that type while the concept has
 * another option (namespaceTypeBarren).
 *
 * Nothing here depends on a territory's name: only on what Qloo returned in this run.
 */
import type { ConceptProbeView, ProbePriority } from "@cultural-elasticity/shared";
import { tagNamespace as parseTagNamespace } from "../methodology/operational-tags.js";
import { canonicalConceptKey } from "./concept-dedup.js";
import { RANKABLE_TYPES, type RankableType } from "./contracts.js";
import type { AgentRunState, PoolRecord, TerritoryState } from "./state.js";

export const PROBE_POLICY_VERSION = "probe-policy-v2";
/** Empty entity-type probes allowed per concept before probing it with new types stops. */
export const MAX_EMPTY_TYPE_PROBES_PER_CONCEPT = 3;
/** Empty probes allowed across one territory's concepts while none of them returned members. */
export const MAX_EMPTY_PROBES_PER_TERRITORY = 6;
/** Other concepts of a namespace that returned no members of a type (and none did) before that type is deferred there. */
export const NAMESPACE_BARREN_MIN = 2;

export type { ProbePriority };
const PRIORITY_RANK: Record<ProbePriority, number> = { CONCEPT_MEMBERS: 1, NAMESPACE_MEMBERS: 2, COMPARISON_TYPE: 3, STRUCTURAL: 4, EXPLORATION: 5 };

export type RankedProbeType = { type: RankableType; priority: ProbePriority; reason: string; namespaceBarren: boolean };

export type ConceptProbeState = {
  conceptKey: string;
  /** Sprint 5A.2: the concept's Qloo tag namespace. */
  namespace: string;
  attemptedTypes: RankableType[];
  emptyTypes: RankableType[];
  successfulTypes: RankableType[];
  /** Probed, but Qloo's answer was partial or degraded and empty: not counted as unsupported. */
  unreliableTypes: RankableType[];
  remainingTypeOptions: RankableType[];
  /** Sprint 5A.2: the untried types of remainingTypeOptions with their evidence priority and reason. */
  typeRanking: RankedProbeType[];
  currentPreferredType: RankableType | null;
  consecutiveEmptyProbes: number;
  totalEmptyTypeProbes: number;
  probingExhausted: boolean;
  exhaustionReason: string | null;
};

const unreliable = (pool: PoolRecord) => pool.call.envelope.status === "partial" || pool.call.envelope.status === "degraded";

/**
 * "urn:tag:genre:media:cooking" → "genre:media": Qloo's tag namespace, the same scope as the reference strategy's
 * namespace yield (evidence, not proof, of where Qloo keeps members of a type).
 */
export function tagNamespace(tagId: string): string {
  const ns = parseTagNamespace({ id: tagId });
  return ns ? `${ns.namespace}:${ns.source}` : "unknown";
}

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
 * Entity types in run-wide order: types that returned members anywhere in this run (most productive first), then place
 * and brand, then the other rankable types. Used where no single concept is in question (alignment tie-breaks); a
 * concept's own probes are ranked by rankProbeTypes. Every type listed is accepted by qloo_recommend; none is invented.
 */
export function typePreference(state: AgentRunState, preferred: RankableType | null = null): RankableType[] {
  const yieldByType = new Map<RankableType, number>();
  for (const pool of state.pools) if (pool.conditionedOn === null && eligibleMembers(state, pool) > 0) yieldByType.set(pool.targetType, (yieldByType.get(pool.targetType) ?? 0) + 1);
  const fixed: RankableType[] = ["place", "brand"];
  const ordered = [...RANKABLE_TYPES].sort((a, b) => (yieldByType.get(b) ?? 0) - (yieldByType.get(a) ?? 0) || (fixed.includes(a) ? fixed.indexOf(a) : 9) - (fixed.includes(b) ? fixed.indexOf(b) : 9));
  return preferred ? [preferred, ...ordered.filter((t) => t !== preferred)] : ordered;
}

export type NamespaceTypeEvidence = { type: RankableType; successfulProbes: number; emptyProbes: number; unreliableProbes: number; memberCount: number };

/** Sprint 5A.2: per-type probe outcomes of one tag namespace in this run, derived from state.pools (no second store). */
export type NamespaceProbeEvidence = {
  namespace: string;
  /** Concepts of the namespace counted (each concept once per type); `excluded` is not among them. */
  scope: { concepts: number; excluded: string | null };
  observedEntityTypes: NamespaceTypeEvidence[];
  /** Correlation ids of the counted pools. */
  provenance: string[];
};

/**
 * What the run observed for a namespace's concepts, per entity type: concepts with members, concepts with a genuine
 * empty answer, concepts with only unreliable (partial/degraded) answers. `exclude` leaves one concept out, so a concept
 * is never its own namespace evidence.
 */
export function namespaceProbeEvidence(state: AgentRunState, namespace: string, exclude: string | null = null): NamespaceProbeEvidence {
  const byConcept = new Map<string, PoolRecord[]>();
  for (const pool of state.pools) {
    if (pool.conditionedOn !== null || pool.tagIds.length !== 1) continue;
    const tagId = pool.tagIds[0]!;
    if (tagId === exclude || tagNamespace(tagId) !== namespace) continue;
    byConcept.set(tagId, [...(byConcept.get(tagId) ?? []), pool]);
  }
  const evidence = new Map<RankableType, NamespaceTypeEvidence>();
  const provenance: string[] = [];
  for (const pools of byConcept.values()) {
    for (const type of new Set(pools.map((p) => p.targetType))) {
      const ofType = pools.filter((p) => p.targetType === type);
      const e = evidence.get(type) ?? { type, successfulProbes: 0, emptyProbes: 0, unreliableProbes: 0, memberCount: 0 };
      const members = Math.max(...ofType.map((p) => eligibleMembers(state, p)));
      if (members > 0) {
        e.successfulProbes += 1;
        e.memberCount += members;
      } else if (ofType.some((p) => !unreliable(p))) e.emptyProbes += 1;
      else e.unreliableProbes += 1;
      evidence.set(type, e);
      provenance.push(...ofType.map((p) => p.call.envelope.execution.correlation_id));
    }
  }
  return { namespace, scope: { concepts: byConcept.size, excluded: exclude }, observedEntityTypes: [...evidence.values()].sort((a, b) => RANKABLE_TYPES.indexOf(a.type) - RANKABLE_TYPES.indexOf(b.type)), provenance: [...new Set(provenance)] };
}

const barrenIn = (e: NamespaceTypeEvidence | undefined) => e !== undefined && e.successfulProbes === 0 && e.emptyProbes >= NAMESPACE_BARREN_MIN;

/** Structural Qloo observations (priority 4) for a type: same-canonical-name concepts with members, profile carriers. */
function structuralEvidence(state: AgentRunState, conceptId: string, type: RankableType): string | null {
  const key = canonicalConceptKey(conceptId);
  const siblings = [...state.tags.keys()].filter((id) => id !== conceptId && canonicalConceptKey(id) === key && conceptPools(state, id).some((p) => p.targetType === type && eligibleMembers(state, p) > 0));
  if (siblings.length > 0) return `the same-named concept ${siblings.slice(0, 2).join(", ")} returned ${type} members`;
  const brandId = state.brand.entity?.id;
  const carriers = [...state.profiles.values()].filter((p) => p.subjectId !== brandId && p.tagIds.includes(conceptId) && state.entities.get(p.subjectId)?.type === type).length;
  return carriers > 0 ? `${carriers} ${type} profile(s) observed in this run carry the concept (Qloo entity_tags)` : null;
}

/**
 * Sprint 5A.2: the concept's untried entity types ranked by the evidence hierarchy (see the header), most promising
 * first. Types that already returned members for the concept come first (CONCEPT_MEMBERS); types already probed
 * without members are omitted (they are in the probe ledger).
 */
export function rankProbeTypes(state: AgentRunState, conceptId: string, preferred: RankableType | null = null): RankedProbeType[] {
  const pools = conceptPools(state, conceptId);
  const namespace = tagNamespace(conceptId);
  const ns = new Map(namespaceProbeEvidence(state, namespace, conceptId).observedEntityTypes.map((e) => [e.type, e]));
  const global = typePreference(state);
  const fallback = (t: RankableType) => global.indexOf(t);
  const ranked: (RankedProbeType & { score: number })[] = [];
  for (const type of RANKABLE_TYPES) {
    const ofType = pools.filter((p) => p.targetType === type);
    const members = ofType.length > 0 ? Math.max(...ofType.map((p) => eligibleMembers(state, p))) : 0;
    const e = ns.get(type);
    const barren = barrenIn(e);
    if (members > 0) {
      ranked.push({ type, priority: "CONCEPT_MEMBERS", reason: `returned ${members} member(s) for this concept`, namespaceBarren: false, score: -members });
      continue;
    }
    if (ofType.length > 0) continue;
    if (e && e.successfulProbes > 0) ranked.push({ type, priority: "NAMESPACE_MEMBERS", reason: `${e.successfulProbes} other concept(s) of ${namespace} returned ${type} members (${e.memberCount} in total)${e.emptyProbes ? `; ${e.emptyProbes} returned none` : ""}`, namespaceBarren: false, score: -e.successfulProbes * 1000 - e.memberCount + e.emptyProbes * 100 });
    else if (type === preferred && !barren) ranked.push({ type, priority: "COMPARISON_TYPE", reason: `the comparison's shared entity type`, namespaceBarren: false, score: 0 });
    else {
      const structural = structuralEvidence(state, conceptId, type);
      const emptyHere = e?.emptyProbes ?? 0;
      if (structural && !barren) ranked.push({ type, priority: "STRUCTURAL", reason: structural, namespaceBarren: false, score: fallback(type) });
      else ranked.push({ type, priority: "EXPLORATION", reason: barren ? `no members for ${emptyHere} other concept(s) of ${namespace} (deferred while other types remain)` : emptyHere > 0 ? `no members for ${emptyHere} other concept(s) of ${namespace}` : `untested in ${namespace}`, namespaceBarren: barren, score: emptyHere * 100 + fallback(type) });
    }
  }
  return ranked.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.score - b.score).map(({ type, priority, reason, namespaceBarren }) => ({ type, priority, reason, namespaceBarren }));
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
  const ranking = rankProbeTypes(state, conceptId, preferred);
  const untried = exhausted ? [] : ranking.filter((r) => r.priority !== "CONCEPT_MEMBERS" && !attempted.includes(r.type)).slice(0, MAX_EMPTY_TYPE_PROBES_PER_CONCEPT - empty.length);
  const order = ranking.map((r) => r.type);
  const successfulOrdered = [...successful].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return {
    conceptKey: conceptId,
    namespace: tagNamespace(conceptId),
    attemptedTypes: attempted,
    emptyTypes: empty,
    successfulTypes: successfulOrdered,
    unreliableTypes,
    remainingTypeOptions: untried.map((r) => r.type),
    typeRanking: untried,
    currentPreferredType: successfulOrdered[0] ?? untried[0]?.type ?? null,
    consecutiveEmptyProbes: consecutive,
    totalEmptyTypeProbes: empty.length,
    probingExhausted: exhausted,
    exhaustionReason: exhausted ? `${label}: ${empty.length} entity types (${empty.join(", ")}) returned no members; probing it with further types has no expected value` : null,
  };
}

/**
 * Sprint 5A.2: find_tags query keys that belong to a territory: its label, and the canonical name of its grounding tag
 * (live L-E1: Haiku searched "Cooking" for the candidate "Cooking and food culture"; keyed by label only, those tags
 * were detached from the territory, so it searched again and the duplicate was refused).
 */
export function territoryQueryKeys(t: TerritoryState): string[] {
  const keys = [t.label.trim().toLowerCase()];
  if (t.sourceTagId) keys.push(canonicalConceptKey(t.sourceTagId).replace(/_/gu, " "));
  return [...new Set(keys)];
}

/** Tags returned by the territory's find_tags queries (undefined when none of its queries ran). */
export function territoryQueryTags(state: AgentRunState, t: TerritoryState): string[] | undefined {
  const hits = territoryQueryKeys(t).filter((k) => state.searchedQueries.has(k));
  return hits.length === 0 ? undefined : [...new Set(hits.flatMap((k) => state.searchedQueries.get(k)!))];
}

/** The candidate concepts of a territory: its anchor, its source evidence tag and the tags its own searches returned. */
export function territoryConcepts(state: AgentRunState, t: TerritoryState): string[] {
  return [...new Set([...(t.concept ? [t.concept.id] : []), ...(t.sourceTagId ? [t.sourceTagId] : []), ...(territoryQueryTags(state, t) ?? [])])];
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

/**
 * Sprint 5A.2: refusal reason for probing a type that the concept's namespace has already shown to be barren
 * (NAMESPACE_BARREN_MIN other concepts returned no members of it, none did), while the concept still has an untried
 * type that is not barren there. Deferral, not a ban: once no other option remains, the type may be probed.
 */
export function namespaceTypeBarren(state: AgentRunState, tagId: string, type: RankableType): string | null {
  const ranking = rankProbeTypes(state, tagId);
  const entry = ranking.find((r) => r.type === type);
  if (!entry?.namespaceBarren) return null;
  const alternatives = ranking.filter((r) => !r.namespaceBarren && r.priority !== "CONCEPT_MEMBERS").slice(0, 3);
  if (alternatives.length === 0 || conceptProbeState(state, tagId).probingExhausted) return null;
  return `${type}: ${entry.reason}. Probe ${alternatives.map((a) => `${a.type} (${a.priority}: ${a.reason})`).join("; ")} on this concept first`;
}

/**
 * The Sprint 5A barren-probe rule at territory level (evidence-sufficiency barrenProbe refuses these probes): types that
 * returned no members for ≥ 2 of the territory's concepts, none with members, while no other type has been probed on
 * them yet. Recommendations never name such a type (live L-C2, Sprint 5A.2 full run: the comparison's shared type was
 * recommended after this rule had refused it, and the agent re-proposed the refused probe for three turns).
 */
export function territoryBarrenTypes(state: AgentRunState, t: TerritoryState): RankableType[] {
  const pools = territoryConcepts(state, t).flatMap((id) => conceptPools(state, id).map((p) => ({ id, p })));
  const tried = new Set(pools.map(({ p }) => p.targetType));
  return [...tried].filter((type) => {
    const ofType = pools.filter(({ p }) => p.targetType === type);
    const concepts = new Set(ofType.map(({ id }) => id));
    return concepts.size >= 2 && ofType.every(({ p }) => eligibleMembers(state, p) === 0) && [...tried].every((x) => x === type);
  });
}

/** Sprint 5A.2: the next probe the evidence supports for a territory still without Qloo members. */
export type ProbeRecommendation = {
  territoryKey: string;
  conceptKey: string;
  namespace: string;
  type: RankableType;
  priority: ProbePriority;
  reason: string;
  /** Empty probe slots the concept has left. */
  emptySlotsLeft: number;
  /** Probe outcomes observed for this concept (members, or 0 for a genuine empty answer). */
  tested: { type: RankableType; members: number }[];
};

/**
 * Sprint 5A.2: one recommended (concept, type) probe per open territory that has no Qloo members yet. The grounding tag
 * comes first among equally ranked concepts (it is the candidate's canonical identity). Territories sharing a namespace
 * with no positive evidence are given different exploration types, so one turn of parallel probes tests several types
 * instead of repeating one (live L-E1: four place probes, then four brand probes). Advisory, but never contradicted by
 * the executor: types it would refuse (exhausted concept, namespace-barren, territory-barren) are never recommended.
 */
export function probeRecommendations(state: AgentRunState, territories: readonly TerritoryState[], preferredFor: (t: TerritoryState) => RankableType | null = () => null): ProbeRecommendation[] {
  const out: ProbeRecommendation[] = [];
  const claimed = new Set<string>();
  for (const t of territories) {
    if (t.status === "dropped" || t.status === "analyzed" || t.representation) continue;
    const concepts = territoryConcepts(state, t);
    if (concepts.some((id) => conceptPools(state, id).some((p) => eligibleMembers(state, p) > 0))) continue;
    if (territoryProbeState(state, t).exhausted) continue;
    const ordered = [...(t.concept ? [t.concept.id] : []), ...(t.sourceTagId && t.sourceTagId !== t.concept?.id ? [t.sourceTagId] : []), ...concepts.filter((id) => id !== t.concept?.id && id !== t.sourceTagId)];
    const barren = territoryBarrenTypes(state, t);
    const options = ordered.flatMap((id, order) => {
      const probe = conceptProbeState(state, id, preferredFor(t));
      return probe.typeRanking.filter((r) => !barren.includes(r.type) && !r.namespaceBarren).map((r) => ({ id, order, probe, r }));
    });
    if (options.length === 0) continue;
    options.sort((a, b) => PRIORITY_RANK[a.r.priority] - PRIORITY_RANK[b.r.priority] || a.order - b.order || a.probe.typeRanking.indexOf(a.r) - b.probe.typeRanking.indexOf(b.r));
    const exploratory = (o: (typeof options)[number]) => o.r.priority === "STRUCTURAL" || o.r.priority === "EXPLORATION";
    const pick = options.find((o) => !exploratory(o) || !claimed.has(`${o.probe.namespace}|${o.r.type}`)) ?? options[0]!;
    if (exploratory(pick)) claimed.add(`${pick.probe.namespace}|${pick.r.type}`);
    out.push({
      territoryKey: t.key,
      conceptKey: pick.id,
      namespace: pick.probe.namespace,
      type: pick.r.type,
      priority: pick.r.priority,
      reason: pick.r.reason,
      emptySlotsLeft: MAX_EMPTY_TYPE_PROBES_PER_CONCEPT - pick.probe.totalEmptyTypeProbes,
      tested: conceptPools(state, pick.id).map((p) => ({ type: p.targetType, members: eligibleMembers(state, p) })),
    });
  }
  return out;
}

/** Compact view of a territory's probes for results and context. */
export function probeViews(state: AgentRunState, t: TerritoryState): ConceptProbeView[] {
  return territoryConcepts(state, t)
    .map((id) => ({ id, s: conceptProbeState(state, id) }))
    .filter(({ s }) => s.attemptedTypes.length > 0)
    .map(({ id, s }) => ({
      conceptKey: id,
      label: state.tags.get(id)?.label ?? id,
      namespace: s.namespace,
      attemptedTypes: s.attemptedTypes,
      emptyTypes: s.emptyTypes,
      successfulTypes: s.successfulTypes,
      unreliableTypes: s.unreliableTypes,
      totalEmptyTypeProbes: s.totalEmptyTypeProbes,
      probingExhausted: s.probingExhausted,
      exhaustionReason: s.exhaustionReason,
    }));
}
