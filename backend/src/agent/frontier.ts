/**
 * Frontier candidate set: validation, diversity and comparison-set construction.
 *
 * Two candidate channels feed EXPLORE_FRONTIER:
 *   qloo_grounded     concepts derived from Qloo evidence (related-entity profiles, tags, pools)
 *   agent_hypothesis  lateral territories the model proposes; NEVER accepted because the model named them
 * Before analysis every frontier candidate must pass, in order:
 *   resolution   anchored to a Qloo concept                                  else TERRITORY_UNRESOLVED
 *   qloo_support Qloo returned ≥ 1 brand-independent member for the concept  else HYPOTHESIS_UNSUPPORTED
 *   semantic     (Sprint 5A) not a venue-listing attribute / operational tag  else INCIDENTAL_CONCEPT;
 *                not judged weak/mismatched by the agent (advisory veto)       else SEMANTIC_REFERENCE_REJECTED
 *   (representation feasibility and evidence availability are then decided by the analysis route)
 * Then duplicates are removed (concept-dedup.ts) and, when more candidates exist than the set needs,
 * candidates that overlap an earlier one culturally are pruned for diversity.
 *
 * Relative positions and classes depend on the comparison set, so how the set was built is always
 * recorded (ComparisonSetConstruction) and returned with the result.
 */
import type { AgentTerritoryResult, AnchorDecision, CandidateCanonicalization, CandidateSource, ComparisonSetConstruction, TerritoryEvidenceStatus } from "@cultural-elasticity/shared";
import { setOverlap } from "../analysis/overlap.js";
import { matchOperationalRule } from "../methodology/operational-tags.js";
import { frontierConcepts, labelTokens } from "./candidate-discovery.js";
import { canonicalConceptKey, canonicalRelation, canonicalTagName } from "./concept-dedup.js";
import { conceptPools, eligibleMembers, territoryConcepts, territoryProbeState, territoryQueryTags } from "./probe-policy.js";
import { memoRun } from "./derived-cache.js";
import { preferredTypeFor } from "./representation-alignment.js";
import { MIN_FRONTIER_SUPPORTED } from "./contracts.js";
import { incidentalConcept } from "./semantic-comparison.js";
import { activeTerritories, turnsAvailable, type AgentRunState, type TerritoryState } from "./state.js";

/** Union-of-exemplar-profile Jaccard at or above this marks two candidates as culturally overlapping. */
export const DIVERSITY_OVERLAP = 0.5;

/** Qloo support for a concept: a non-empty brand-independent pool of any type, or a profile carrying it. */
export function qlooSupport(state: AgentRunState, t: TerritoryState): boolean {
  if (!t.concept) return false;
  const brandId = state.brand.entity?.id;
  if (state.pools.some((p) => p.conditionedOn === null && p.tagIds.includes(t.concept!.id) && p.memberIds.some((id) => id !== brandId))) return true;
  return [...state.profiles.values()].some((p) => p.subjectId !== brandId && p.tagIds.includes(t.concept!.id));
}

function drop(state: AgentRunState, t: TerritoryState, stage: AgentRunState["candidateRejections"][number]["stage"], code: NonNullable<TerritoryState["dropReason"]>["code"], detail: string) {
  t.status = "dropped";
  t.dropReason = { code, detail };
  state.candidateRejections.push({ key: t.key, stage, code, reason: detail });
}

/** Resolution and Qloo-support gates for frontier candidates in `keys` (dropped ones are removed). */
export function gateFrontierCandidates(state: AgentRunState, keys: readonly string[]): string[] {
  for (const key of keys) {
    const t = state.territories.find((x) => x.key === key);
    if (!t || t.role !== "frontier_candidate" || t.status === "dropped" || t.status === "analyzed") continue;
    if (!t.concept) drop(state, t, "resolution", "TERRITORY_UNRESOLVED", `${t.source === "agent_hypothesis" ? "agent hypothesis" : "candidate"} was never anchored to a Qloo concept`);
    else if (!qlooSupport(state, t)) drop(state, t, "qloo_support", "HYPOTHESIS_UNSUPPORTED", `Qloo returned no brand-independent member for ${t.concept.label}; the hypothesis is not supported by Qloo evidence`);
    else if (incidentalConcept(t.concept.id)) drop(state, t, "semantic", "INCIDENTAL_CONCEPT", `${t.concept.label}: ${incidentalConcept(t.concept.id)!.explanation}`);
    else if (t.semanticJudgment && (t.semanticJudgment.relevance === "WEAK" || t.semanticJudgment.relevance === "MISMATCH")) drop(state, t, "semantic", "SEMANTIC_REFERENCE_REJECTED", `the agent judged ${t.concept.label} ${t.semanticJudgment.relevance.toLowerCase()} as a frontier territory (advisory veto): ${t.semanticJudgment.reason}`);
  }
  return keys.filter((k) => state.territories.some((t) => t.key === k && t.status !== "dropped"));
}

/** Cultural tags across a territory's exemplar profiles (null when no exemplar profile is known). */
function culturalUnion(state: AgentRunState, t: TerritoryState): Set<string> | null {
  const profiles = (t.representation?.exemplars ?? []).flatMap((e) => (state.profiles.get(e.id) ? [state.profiles.get(e.id)!.tagIds] : []));
  if (profiles.length === 0) return null;
  return new Set(profiles.flat().filter((id) => matchOperationalRule({ id }) === undefined));
}

export type SimilarPair = { a: string; b: string; basis: string; similarity: number };

/** Pairwise cultural overlap between candidates, from exemplar profiles and label tokens. */
export function similarPairs(state: AgentRunState, territories: readonly TerritoryState[]): { pairs: SimilarPair[]; unknown: boolean } {
  const pairs: SimilarPair[] = [];
  let unknown = false;
  for (let i = 0; i < territories.length; i += 1) {
    for (let j = i + 1; j < territories.length; j += 1) {
      const a = territories[i]!;
      const b = territories[j]!;
      const ua = culturalUnion(state, a);
      const ub = culturalUnion(state, b);
      if (ua && ub) {
        const jaccard = setOverlap(ua, ub).jaccard ?? 0;
        if (jaccard >= DIVERSITY_OVERLAP) pairs.push({ a: a.key, b: b.key, basis: `exemplar profiles share ${Math.round(jaccard * 100) / 100} of their cultural tags (Jaccard)`, similarity: jaccard });
      } else {
        unknown = true;
      }
      const tokens = setOverlap(labelTokens(a.label), labelTokens(b.label)).jaccard ?? 0;
      if (tokens >= 0.5 && !pairs.some((p) => p.a === a.key && p.b === b.key)) pairs.push({ a: a.key, b: b.key, basis: "labels share most words", similarity: tokens });
    }
  }
  return { pairs, unknown };
}

/** Drops later candidates that overlap an earlier kept one, while ≥ MIN_FRONTIER_SUPPORTED would remain. */
export function pruneForDiversity(state: AgentRunState, keys: readonly string[]): string[] {
  const candidates = keys.map((k) => state.territories.find((t) => t.key === k)!).filter((t) => t.role === "frontier_candidate" && t.status !== "dropped" && t.status !== "analyzed");
  if (candidates.length <= MIN_FRONTIER_SUPPORTED) return [...keys];
  const kept: TerritoryState[] = [];
  let remaining = candidates.length;
  for (const t of candidates) {
    const near = kept.find((k) => similarPairs(state, [k, t]).pairs.some((p) => p.basis.startsWith("exemplar profiles")));
    if (near && remaining > MIN_FRONTIER_SUPPORTED) {
      drop(state, t, "diversity", "LOW_DIVERSITY", `culturally overlaps ${near.label} (exemplar profiles); kept the earlier candidate so the set spans different territories`);
      remaining -= 1;
      continue;
    }
    kept.push(t);
  }
  return keys.filter((k) => state.territories.some((t) => t.key === k && t.status !== "dropped"));
}

// ---- Sprint 5A.1: stable, evidence-grounded frontier discovery ----

/**
 * Related entities requested for the brand, at a FIXED take (Qloo's tie order depends on `take`, so a model-chosen
 * limit changed the related set from run to run).
 */
export const FRONTIER_RELATED_TAKE = 8;
/** Related entities, in Qloo's order, whose tag profiles form the frontier evidence base. */
export const FRONTIER_EVIDENCE_BASE = 6;
/** Candidate-pool size shown to the agent. */
export const FRONTIER_POOL_SIZE = 12;

/** The brand's related entities in Qloo order (first related call for the current canonical brand id). */
function relatedOrder(state: AgentRunState): string[] {
  const brandId = state.brand.entity?.id;
  return state.related.find((r) => r.subjectId === brandId)?.memberIds ?? [];
}

/**
 * Stage A evidence base: the first FRONTIER_EVIDENCE_BASE related entities in Qloo order, extended by one for each of
 * them whose profile came back empty. Fixed given Qloo's answer, so repeated runs see the same evidence.
 */
export function frontierEvidenceBase(state: AgentRunState): string[] {
  const order = relatedOrder(state);
  let size = FRONTIER_EVIDENCE_BASE;
  for (let i = 0; i < Math.min(size, order.length); i += 1) if (state.profiles.get(order[i]!)?.tagIds.length === 0) size += 1;
  return order.slice(0, size);
}

/** Refusal reason for profiling a related entity outside the evidence base (null when allowed). */
export function outsideFrontierEvidenceBase(state: AgentRunState, entityId: string): string | null {
  if (state.interpretation?.intent !== "explore_frontier") return null;
  const order = relatedOrder(state);
  if (!order.includes(entityId)) return null;
  // An entity that is also an exemplar candidate (tag-pool member) may be profiled for the quality check.
  if (state.entities.get(entityId)?.sources.some((s) => s.kind === "tag_member")) return null;
  const base = frontierEvidenceBase(state);
  if (base.includes(entityId)) return null;
  return `the frontier evidence base is the first ${base.length} related entities in Qloo's order (fixed, so repeated runs see the same evidence); this entity is outside it. Choose candidates from frontierConcepts`;
}

export type FrontierEvidenceBaseGap = {
  action: "qloo_related_entities" | "qloo_get_entity_tags";
  target: string;
  remaining: number;
  reason: string;
};

/**
 * Sprint 8D: Channel A is incomplete when related entities have not been fetched, or a member of the fixed
 * evidence base still has no tag profile. Derived from this run's Qloo answers only.
 */
export function frontierEvidenceBaseGap(state: AgentRunState): FrontierEvidenceBaseGap | null {
  if (state.interpretation?.intent !== "explore_frontier") return null;
  const brandId = state.brand.entity?.id;
  if (!brandId) return null;
  // Sprint 8E: only a related call for THIS brand id starts the evidence base; a related call about another entity
  // (or an earlier canonical brand id) is not evidence that the brand's related entities were collected.
  if (!state.related.some((r) => r.subjectId === brandId)) {
    return {
      action: "qloo_related_entities",
      target: brandId,
      remaining: 1,
      reason: "the frontier evidence base starts with the brand's related entities (qloo_related_entities)",
    };
  }
  const base = frontierEvidenceBase(state);
  const unprofiled = base.filter((id) => !state.profiles.has(id));
  if (unprofiled.length === 0) return null;
  return {
    action: "qloo_get_entity_tags",
    target: unprofiled[0]!,
    remaining: unprofiled.length,
    reason: `profile the remaining ${unprofiled.length} related entit${unprofiled.length === 1 ? "y" : "ies"} in the fixed evidence base before ungrounded probes`,
  };
}

function inFlightCandidateTags(state: AgentRunState): Set<string> {
  const ids = new Set<string>();
  const open = activeTerritories(state).filter((x) => x.role === "frontier_candidate" && x.status !== "analyzed");
  const labelKeys = new Set(open.map((t) => canonicalConceptKey(t.label)));
  for (const t of open) {
    for (const id of territoryConcepts(state, t)) ids.add(id);
  }
  // A proposed candidate may be probed on an observed tag that is the same concept as its label, even before
  // the tag is attached as sourceTagId (scripted and live hypothesis investigation).
  for (const [id] of state.tags) {
    if (labelKeys.has(canonicalConceptKey(id))) ids.add(id);
  }
  return ids;
}

/**
 * Sprint 8D: refuse brand-independent probes of hypothesized tags while Channel A is incomplete.
 * Related entities must be fetched first. After that, tags already in frontierConcepts (from collected related
 * profiles) and in-flight candidate concepts stay legal so a partial evidence base can still be investigated.
 * Hypothesized tags that are not in that pool wait until the remaining related profiles are collected.
 */
export function ungroundedFrontierProbeReason(state: AgentRunState, tagIds: readonly string[]): string | null {
  const gap = frontierEvidenceBaseGap(state);
  if (!gap) return null;
  const allowed = inFlightCandidateTags(state);
  if (tagIds.some((id) => allowed.has(id))) return null;
  if (gap.action === "qloo_get_entity_tags") {
    const poolIds = new Set(frontierCandidatePool(state).map((entry) => entry.tagId));
    if (tagIds.length > 0 && tagIds.every((id) => poolIds.has(id))) return null;
  }
  return `${gap.reason}; do not probe hypothesized concepts until they appear in frontierConcepts or are proposed as candidates`;
}

/** Pool members not yet used as a territory's grounding tag, concept, or proposal evidence. */
export function unusedFrontierPoolEntries(state: AgentRunState): FrontierPoolEntry[] {
  return frontierCandidatePool(state).filter(
    (entry) =>
      !state.territories.some(
        (t) => t.sourceTagId === entry.tagId || t.concept?.id === entry.tagId || t.evidenceTagIds.includes(entry.tagId),
      ),
  );
}

/**
 * Frontier candidates that still count toward the exploration target.
 * Sprint 8D: unsupported agent hypotheses and probe-exhausted shells do not fill the quota.
 */
export function viableFrontierCandidates(state: AgentRunState): number {
  return activeTerritories(state).filter((t) => {
    if (t.role !== "frontier_candidate") return false;
    if (state.results.get(t.key)?.analysisRoute === "INSUFFICIENT_EVIDENCE") return false;
    if (qlooSupport(state, t)) return true;
    return t.origin === "qloo_evidence" && !territoryProbeState(state, t).exhausted;
  }).length;
}

/**
 * Sprint 8D: an agent hypothesis that already returned no members must not consume further empty probes while unused
 * Qloo-grounded pool concepts remain. The first empty probe is exploration; a second is unproductive.
 */
export function unproductiveHypothesisProbeReason(state: AgentRunState, tagIds: readonly string[]): string | null {
  if (state.interpretation?.intent !== "explore_frontier") return null;
  if (unusedFrontierPoolEntries(state).length === 0) return null;
  for (const t of activeTerritories(state).filter((x) => x.role === "frontier_candidate" && x.origin === "agent_hypothesis")) {
    if (!tagIds.some((id) => territoryConcepts(state, t).includes(id))) continue;
    const probe = territoryProbeState(state, t);
    if (!probe.anySuccessful && probe.totalEmpty >= 1) {
      return `${t.label} is an agent hypothesis whose probes returned no members; unused Qloo-grounded frontierConcepts remain. Propose one of those instead of another empty probe`;
    }
  }
  return null;
}

export type FrontierPoolEntry = { tagId: string; label: string; canonicalConceptKey: string; support: number; probes: { type: string; members: number }[] };

/**
 * Stage A candidate pool: concepts carried by the evidence-base profiles but not by the brand (frontierConcepts),
 * deduplicated by canonical concept key (the best-supported tag of each key is kept; ties by tag id), bounded and in a
 * stable order (support, then canonical key). The agent (stage B) prioritizes, chooses and may add lateral hypotheses;
 * every choice is still validated with Qloo.
 */
export function frontierCandidatePool(state: AgentRunState): FrontierPoolEntry[] {
  return memoRun(state, "frontierPool", () => computeFrontierCandidatePool(state));
}

function computeFrontierCandidatePool(state: AgentRunState): FrontierPoolEntry[] {
  const base = new Set(frontierEvidenceBase(state));
  const concepts = frontierConcepts(state, 1).map((c) => ({ ...c, support: countSupport(state, c.tagId, base) })).filter((c) => c.support > 0);
  const byKey = new Map<string, (typeof concepts)[number]>();
  for (const c of concepts) {
    const key = canonicalConceptKey(c.tagId);
    const prev = byKey.get(key);
    if (!prev || c.support > prev.support || (c.support === prev.support && c.tagId < prev.tagId)) byKey.set(key, c);
  }
  return [...byKey.entries()]
    .map(([key, c]) => ({ tagId: c.tagId, label: c.label, canonicalConceptKey: key, support: c.support, probes: conceptPools(state, c.tagId).map((p) => ({ type: p.targetType, members: eligibleMembers(state, p) })) }))
    .sort((a, b) => b.support - a.support || a.canonicalConceptKey.localeCompare(b.canonicalConceptKey))
    .slice(0, FRONTIER_POOL_SIZE);
}

/** Evidence-base profiles carrying the tag. */
function countSupport(state: AgentRunState, tagId: string, base: ReadonlySet<string>): number {
  return [...base].filter((id) => state.profiles.get(id)?.tagIds.includes(tagId)).length;
}

/** Sprint 5A.1 canonical identity of a territory's concept (see CandidateCanonicalization in the shared contract). */
export function candidateCanonicalization(state: AgentRunState, t: TerritoryState): CandidateCanonicalization {
  const source: CandidateSource = t.role === "reference" ? "reference_strategy" : t.source;
  const resolvedId = t.concept?.id ?? null;
  const key = t.sourceTagId ? canonicalConceptKey(t.sourceTagId) : resolvedId ? canonicalConceptKey(resolvedId) : canonicalConceptKey(t.label);
  const reason: CandidateCanonicalization["normalizationReason"] = t.sourceTagId ? "SOURCE_TAG_CANONICAL_NAME" : resolvedId ? "ANCHORED_TAG_CANONICAL_NAME" : "LABEL_NORMALIZED";
  let relation: CandidateCanonicalization["anchorRelation"] = "NO_SOURCE_TAG";
  let uncertainty: string | null = null;
  if (t.sourceTagId && !resolvedId) relation = "NOT_ANCHORED";
  else if (t.sourceTagId && resolvedId) {
    const rel = resolvedId === t.sourceTagId ? "SAME_CONCEPT" : canonicalRelation(canonicalConceptKey(t.sourceTagId), canonicalConceptKey(resolvedId));
    relation = rel === "SAME_CONCEPT" ? "SAME_CONCEPT" : rel === "SAME" ? "SAME_CANONICAL_NAME" : rel === "ALIAS" ? "ALIAS_TOKEN_CONTAINMENT" : "DIFFERENT_NAME";
    if (relation === "ALIAS_TOKEN_CONTAINMENT") uncertainty = `anchored ${resolvedId} only shares name tokens with the grounding tag ${t.sourceTagId}: a plausible alias, not established equivalence`;
    if (relation === "DIFFERENT_NAME") uncertainty = `anchored ${resolvedId} has a different name from the grounding tag ${t.sourceTagId}: equivalence is not established`;
  }
  return { originalLabel: t.label, sourceTagId: t.sourceTagId, resolvedId, canonicalConceptKey: key, normalizationReason: reason, candidateSource: source, anchorRelation: relation, uncertainty };
}

// ---- Sprint 5A.2: anchor identity (live L-E1 / L-E2) ----

/** Brand-independent pools of a concept that returned eligible members. */
function supportingPools(state: AgentRunState, tagId: string) {
  return conceptPools(state, tagId).filter((p) => eligibleMembers(state, p) > 0);
}

/** Records one anchoring decision of a generated candidate (trace.anchorDecisions). */
export function recordAnchorDecision(state: AgentRunState, t: TerritoryState, tagId: string, basis: AnchorDecision["basis"], decidedBy: AnchorDecision["decidedBy"], reasonCode: string | null, evidence: string): void {
  const pools = supportingPools(state, tagId);
  const relation = !t.sourceTagId ? "NO_SOURCE_TAG" : tagId === t.sourceTagId ? "SAME_CONCEPT" : relationOf(t.sourceTagId, tagId);
  (state.trace.anchorDecisions ??= []).push({ iteration: state.usage.iterations, territoryKey: t.key, sourceTagId: t.sourceTagId, anchoredTagId: tagId, relation, basis, decidedBy, reasonCode, evidence: evidence.slice(0, 300), correlationIds: pools.map((p) => p.call.envelope.execution.correlation_id) });
}

function relationOf(sourceTagId: string, tagId: string): CandidateCanonicalization["anchorRelation"] {
  const rel = canonicalRelation(canonicalConceptKey(sourceTagId), canonicalConceptKey(tagId));
  return rel === "SAME" ? "SAME_CANONICAL_NAME" : rel === "ALIAS" ? "ALIAS_TOKEN_CONTAINMENT" : "DIFFERENT_NAME";
}

/**
 * When a brand-independent probe returns members for a territory's OWN concept, the runtime anchors the territory to it,
 * so observed support cannot be lost to the turn or resolution budget:
 *   SOURCE_TAG_MEMBERS  a frontier candidate's grounding tag (live L-E1: Cooking and Feminism found book members on their
 *                       own tags in the second-to-last turn, were never anchored, and ended INSUFFICIENT). The grounding
 *                       tag is the candidate's canonical identity, so this also removes anchor drift.
 *   LABEL_TAG_MEMBERS   a tag the territory's own search returned whose canonical name IS the territory's name, of the
 *                       comparison's shared type when one is planned (live L-C2, Sprint 5A.2 full run: Heavy Metal found
 *                       place members on interests:…:heavy_metal in the turn that spent its resolution budget, then was
 *                       declared unsupported and dropped).
 * Nothing is anchored for a tag another territory already uses (or shares its canonical name with). Returns the keys.
 */
export function anchorOnObservedMembers(state: AgentRunState, tagId: string, targetType: string, members: number): string[] {
  if (members <= 0) return [];
  const tag = state.tags.get(tagId);
  if (!tag) return [];
  const anchored: string[] = [];
  for (const t of activeTerritories(state)) {
    if (t.concept || t.status !== "open" || t.role === "reference") continue;
    const source = t.role === "frontier_candidate" && t.sourceTagId === tagId;
    const preferred = preferredTypeFor(state, t);
    const named = !source && canonicalConceptKey(tagId) === canonicalConceptKey(t.label) && (territoryQueryTags(state, t) ?? []).includes(tagId) && (preferred === null || preferred === targetType);
    if (!source && !named) continue;
    if (activeTerritories(state).some((o) => o.key !== t.key && o.concept && (o.concept.id === tagId || canonicalTagName(o.concept.id) === canonicalTagName(tagId)))) continue;
    t.concept = { id: tag.id, label: tag.label, type: tag.type };
    t.status = "anchored";
    recordAnchorDecision(state, t, tagId, source ? "SOURCE_TAG_MEMBERS" : "LABEL_TAG_MEMBERS", "runtime", null, `${source ? "grounding tag" : "the territory's own same-named tag"} returned ${members} ${targetType} member(s) (brand-independent pool)`);
    anchored.push(t.key);
  }
  return anchored;
}

/**
 * Refusal of an ALTERNATE anchor for a Qloo-grounded frontier candidate (a tag other than its evidence tags), or null.
 * An alternate is allowed only when it is the same concept under another tag (same canonical name, or a token alias,
 * recorded as uncertain), Qloo returned members for it, and the grounding tag was probed and returned none. A different
 * concept is a different candidate: it is proposed with its own provenance and the original stays unsupported.
 */
export function alternateAnchorRefusal(state: AgentRunState, t: TerritoryState, tagId: string): { code: string; reason: string } | null {
  if (t.role !== "frontier_candidate" || !t.sourceTagId || tagId === t.sourceTagId || t.evidenceTagIds.includes(tagId)) return null;
  const source = state.tags.get(t.sourceTagId)?.label ?? t.sourceTagId;
  const relation = relationOf(t.sourceTagId, tagId);
  if (relation === "DIFFERENT_NAME") return { code: "ALTERNATE_ANCHOR_UNRELATED", reason: `${tagId} does not share the canonical name of the grounding tag ${source} [${t.sourceTagId}]; a different concept is a different candidate (propose_territory with its own evidence tag), and this one stays unsupported unless its own tag has members` };
  const sourcePools = conceptPools(state, t.sourceTagId);
  const sourceMembers = sourcePools.filter((p) => eligibleMembers(state, p) > 0);
  if (sourceMembers.length > 0) return { code: "ALTERNATE_ANCHOR_SOURCE_SUPPORTED", reason: `the grounding tag ${source} [${t.sourceTagId}] has ${[...new Set(sourceMembers.map((p) => p.targetType))].join(", ")} members: anchor it (it is the candidate's canonical concept)` };
  if (sourcePools.length === 0) return { code: "ALTERNATE_ANCHOR_SOURCE_UNTESTED", reason: `probe the grounding tag ${source} [${t.sourceTagId}] first (qloo_recommend, conditionOnBrand=false, the type its probe plan recommends); anchor an alternate only when the grounding tag has no members` };
  if (supportingPools(state, tagId).length === 0) return { code: "ALTERNATE_ANCHOR_UNSUPPORTED", reason: `${tagId} has no brand-independent members observed in this run: probe it first and anchor it only if Qloo returns members` };
  return null;
}

/**
 * Frontier completion reserve: in the last two turns, while a frontier candidate with Qloo members is still unanalyzed,
 * probing candidates without any member (and new tag searches) cannot finish in time and is refused, so the supported
 * candidates are represented and analyzed instead (live L-E1: the last turns went to low-yield probes and the supported
 * candidates were never analyzed). Returns the reason, or null.
 */
export function frontierCompletionReserve(state: AgentRunState, tool: string, tagId: string | null): string | null {
  if (state.interpretation?.intent !== "explore_frontier" || turnsAvailable(state) > 2) return null;
  const open = activeTerritories(state).filter((t) => t.role === "frontier_candidate" && t.status !== "analyzed");
  const supported = open.filter((t) => t.concept && supportingPools(state, t.concept.id).length > 0);
  if (supported.length === 0) return null;
  if (tool === "qloo_find_tags") return `FRONTIER_COMPLETION_RESERVE: ${turnsAvailable(state)} turn(s) left and ${supported.map((t) => t.key).join(", ")} ha${supported.length === 1 ? "s" : "ve"} Qloo members: represent and analyze ${supported.length === 1 ? "it" : "them"} instead of searching new concepts`;
  if (tool !== "qloo_recommend" || !tagId) return null;
  if (supported.some((t) => t.concept!.id === tagId)) return null;
  const owner = open.find((t) => t.sourceTagId === tagId || t.concept?.id === tagId);
  if (owner && supportingPools(state, owner.concept?.id ?? tagId).length > 0) return null;
  return `FRONTIER_COMPLETION_RESERVE: ${turnsAvailable(state)} turn(s) left; ${supported.map((t) => t.key).join(", ")} ha${supported.length === 1 ? "s" : "ve"} Qloo members and must still be represented and analyzed, so probing a candidate without members has no expected value now`;
}

/** Sprint 5A.1 evidence status for the UI (a connected node never implies a measured distance). */
export function evidenceStatus(r: AgentTerritoryResult): TerritoryEvidenceStatus {
  if (r.analysisRoute === "FULL_RELATIVE_ANALYSIS") return "EVIDENCE_SUPPORTED_TERRITORY";
  if (r.analysisRoute === "PARTIAL_CULTURAL_ANALYSIS" || r.analysisRoute === "DESCRIPTIVE_ANALYSIS") return "PARTIAL_EVIDENCE";
  return "UNSUPPORTED";
}

const STAGE_BY_CODE: Record<string, ComparisonSetConstruction["rejected"][number]["stage"]> = {
  TERRITORY_UNRESOLVED: "resolution",
  TERRITORY_AMBIGUOUS: "resolution",
  HYPOTHESIS_UNSUPPORTED: "qloo_support",
  QLOO_EMPTY: "qloo_support",
  NO_VALID_REPRESENTATION: "representation",
  REPRESENTATION_QUALITY_WEAK: "representation",
  DUPLICATE_TERRITORY: "dedup",
  LOW_DIVERSITY: "diversity",
  BUDGET_EXHAUSTED: "budget",
  INCIDENTAL_CONCEPT: "semantic",
  SEMANTIC_REFERENCE_REJECTED: "semantic",
};

const NOTE =
  "Relative positions and provisional classes hold only for this comparison set: a different set of territories can change every position. The set was assembled from the candidates listed here; rejected candidates and the reason for each rejection are shown.";

export function comparisonSetConstruction(state: AgentRunState, results: readonly AgentTerritoryResult[]): ComparisonSetConstruction {
  const byKey = new Map(results.map((r) => [r.key, r]));
  const sourceOf = (t: TerritoryState): CandidateSource => (t.role === "reference" ? "reference_strategy" : t.source);
  const rejected: ComparisonSetConstruction["rejected"] = [];
  for (const t of state.territories) {
    const recorded = [...state.candidateRejections].reverse().find((r) => r.key === t.key);
    if (t.status === "dropped") {
      rejected.push({ key: t.key, label: t.label, stage: recorded?.stage ?? STAGE_BY_CODE[t.dropReason?.code ?? ""] ?? "agent", code: t.dropReason?.code ?? "DROPPED", reason: t.dropReason?.detail ?? "dropped" });
      continue;
    }
    const r = byKey.get(t.key);
    if (t.role !== "target" && r?.analysisRoute === "INSUFFICIENT_EVIDENCE") {
      rejected.push({ key: t.key, label: t.label, stage: "evidence", code: r.representation.failure?.code ?? "INSUFFICIENT_EVIDENCE", reason: r.representation.failure?.detail ?? "no measurable Qloo evidence" });
    }
  }
  const finalTerritories = state.territories.filter((t) => t.status !== "dropped" && byKey.has(t.key) && !rejected.some((x) => x.key === t.key));
  const frontier = finalTerritories.filter((t) => t.role !== "target");
  const diversity = similarPairs(state, frontier);
  return {
    intent: state.interpretation?.intent ?? null,
    proposed: state.territories.map((t) => ({ key: t.key, label: t.label, role: t.role, source: sourceOf(t), evidence: t.sourceEvidence })),
    rejected,
    final: finalTerritories.map((t) => ({ key: t.key, label: t.label, role: t.role, source: sourceOf(t), route: byKey.get(t.key)!.analysisRoute })),
    dedupDecisions: state.trace.conceptDedup,
    semanticAssessments: state.semanticAssessments,
    ...(state.interpretation?.intent === "explore_frontier" && { candidatePool: frontierCandidatePool(state).map(({ canonicalConceptKey, tagId, label, support }) => ({ canonicalConceptKey, tagId, label, support })), evidenceBase: frontierEvidenceBase(state) }),
    diversity: {
      assessment: frontier.length < 2 ? "unknown" : diversity.pairs.length > 0 ? "overlapping" : diversity.unknown ? "unknown" : "diverse",
      similarPairs: diversity.pairs.map(({ a, b, basis }) => ({ a, b, basis })),
      detail:
        frontier.length < 2
          ? "fewer than two non-target territories: diversity not assessed"
          : diversity.pairs.length > 0
            ? `${diversity.pairs.length} overlapping pair(s) remain`
            : diversity.unknown
              ? "no overlap detected, but not every candidate has exemplar profiles"
              : "no pair of candidates overlaps culturally in Qloo evidence",
    },
    note: NOTE,
  };
}

// ---- Frontier set stability (repeated runs of the same request) ----

export type FrontierRun = {
  candidates: {
    key: string;
    label: string;
    conceptId: string | null;
    route: string;
    position: number | null;
    classification: string | null;
    /** Sprint 5A.1: canonical concept key (grounding tag, else anchored tag, else label). */
    canonicalKey?: string | null;
    /** Sprint 5A.1: canonical keys of the FULL comparison set the candidate was ranked in (empty if none). */
    comparisonKeys?: string[];
  }[];
};

export type FrontierStability = {
  runs: number;
  /** Mean pairwise Jaccard of candidate labels (normalized). */
  exactCandidateOverlap: number | null;
  /** Mean pairwise Jaccard of resolved Qloo concept ids. */
  resolvedConceptOverlap: number | null;
  /** Share of runs whose top-positioned candidate concept equals the most common top concept. */
  topCandidateConsistency: number | null;
  /** For concepts analyzed with a class in ≥ 2 runs: share with an identical class every time. */
  methodologyStability: number | null;
  /** Sprint 5A.1 (FRONTIER_STABILITY_METRICS_VERSION): mean pairwise Jaccard of canonical concept keys (all candidates). */
  canonicalConceptOverlap?: number | null;
  /** Mean pairwise Jaccard of canonical keys of supported candidates (route other than INSUFFICIENT_EVIDENCE). */
  supportedCanonicalOverlap?: number | null;
  /** Supported canonical keys that recur in ≥ 2 runs. */
  recurringSupportedCanonical?: string[];
  /** For canonical keys present in ≥ 2 runs: share anchored to the same Qloo concept id in every run. */
  anchorConsistency?: number | null;
  /** Rubric proxy (label content words, plural-normalized), reported separately from ids; never a gate on its own. */
  themeOverlapProxy?: number | null;
  /** Run pairs whose FULL comparison sets hold the same canonical concepts, of pairs where both have one. */
  comparisonSetCompatibility?: { comparablePairs: number; pairsWithFull: number };
};

/**
 * v3 (Sprint 5A.2, grader fix): two runs with NO supported candidate count 0 for supportedCanonicalOverlap, not 1 —
 * nothing supported twice is not stability (v2 scored it 1, so repeated unsupported runs could look stable). Every other
 * metric is unchanged from v2; results scored with v2 are kept as run.
 */
export const FRONTIER_STABILITY_METRICS_VERSION = "frontier-stability-metrics-v3";

const THEME_STOPWORDS = new Set(["and", "the", "of", "for", "with", "culture", "lifestyle", "living"]);
const themeTokens = (label: string) => new Set(labelTokens(label).filter((t) => !THEME_STOPWORDS.has(t)));

const mean = (values: number[]) => (values.length === 0 ? null : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1000) / 1000);

export function frontierStability(runs: readonly FrontierRun[]): FrontierStability {
  const pairwise = (key: (c: FrontierRun["candidates"][number]) => string | null, emptyPair = 1) => {
    const values: number[] = [];
    for (let i = 0; i < runs.length; i += 1)
      for (let j = i + 1; j < runs.length; j += 1) {
        const a = runs[i]!.candidates.map(key).filter((x): x is string => x !== null);
        const b = runs[j]!.candidates.map(key).filter((x): x is string => x !== null);
        values.push(setOverlap(a, b).jaccard ?? (a.length === 0 && b.length === 0 ? emptyPair : 0));
      }
    return mean(values);
  };
  const tops = runs.map((r) => [...r.candidates].filter((c) => c.position !== null).sort((a, b) => a.position! - b.position!)[0]?.conceptId ?? null).filter((x): x is string => x !== null);
  const counts = new Map<string, number>();
  for (const t of tops) counts.set(t, (counts.get(t) ?? 0) + 1);
  const modal = Math.max(0, ...counts.values());
  const classes = new Map<string, Set<string>>();
  const seen = new Map<string, number>();
  for (const r of runs)
    for (const c of r.candidates) {
      if (!c.conceptId || !c.classification) continue;
      seen.set(c.conceptId, (seen.get(c.conceptId) ?? 0) + 1);
      classes.set(c.conceptId, (classes.get(c.conceptId) ?? new Set()).add(c.classification));
    }
  const repeated = [...seen.entries()].filter(([, n]) => n >= 2).map(([id]) => id);
  return {
    runs: runs.length,
    exactCandidateOverlap: runs.length < 2 ? null : pairwise((c) => c.label.trim().toLowerCase()),
    resolvedConceptOverlap: runs.length < 2 ? null : pairwise((c) => c.conceptId),
    topCandidateConsistency: tops.length === 0 ? null : Math.round((modal / runs.length) * 1000) / 1000,
    methodologyStability: repeated.length === 0 ? null : Math.round((repeated.filter((id) => classes.get(id)!.size === 1).length / repeated.length) * 1000) / 1000,
    ...canonicalStability(runs, pairwise),
  };
}

/** Sprint 5A.1 canonical-level stability (see FrontierStability). */
function canonicalStability(runs: readonly FrontierRun[], pairwise: (key: (c: FrontierRun["candidates"][number]) => string | null, emptyPair?: number) => number | null) {
  const supported = (c: FrontierRun["candidates"][number]) => c.route !== "INSUFFICIENT_EVIDENCE";
  const counts = new Map<string, number>();
  for (const r of runs) for (const k of new Set(r.candidates.filter(supported).flatMap((c) => (c.canonicalKey ? [c.canonicalKey] : [])))) counts.set(k, (counts.get(k) ?? 0) + 1);
  const anchors = new Map<string, { runs: number; ids: Set<string> }>();
  for (const r of runs) {
    const seen = new Set<string>();
    for (const c of r.candidates) {
      if (!c.canonicalKey || seen.has(c.canonicalKey)) continue;
      seen.add(c.canonicalKey);
      const entry = anchors.get(c.canonicalKey) ?? { runs: 0, ids: new Set<string>() };
      entry.runs += 1;
      entry.ids.add(c.conceptId ?? "(unanchored)");
      anchors.set(c.canonicalKey, entry);
    }
  }
  const recurring = [...anchors.values()].filter((a) => a.runs >= 2);
  const themes = runs.map((r) => new Set(r.candidates.flatMap((c) => [...themeTokens(c.label)])));
  const themePairs: number[] = [];
  for (let i = 0; i < themes.length; i += 1) for (let j = i + 1; j < themes.length; j += 1) themePairs.push(setOverlap(themes[i]!, themes[j]!).jaccard ?? (themes[i]!.size + themes[j]!.size === 0 ? 1 : 0));
  const sets = runs.map((r) => [...new Set(r.candidates.flatMap((c) => (c.comparisonKeys && c.comparisonKeys.length > 0 ? [c.comparisonKeys.join("|")] : [])))]);
  let pairsWithFull = 0;
  let comparablePairs = 0;
  for (let i = 0; i < sets.length; i += 1)
    for (let j = i + 1; j < sets.length; j += 1) {
      if (sets[i]!.length === 0 || sets[j]!.length === 0) continue;
      pairsWithFull += 1;
      if (sets[i]!.some((x) => sets[j]!.includes(x))) comparablePairs += 1;
    }
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return {
    canonicalConceptOverlap: runs.length < 2 ? null : pairwise((c) => c.canonicalKey ?? null),
    supportedCanonicalOverlap: runs.length < 2 ? null : pairwise((c) => (supported(c) ? (c.canonicalKey ?? null) : null), 0),
    recurringSupportedCanonical: [...counts.entries()].filter(([, n]) => n >= 2).map(([k]) => k).sort(),
    anchorConsistency: recurring.length === 0 ? null : r3(recurring.filter((a) => a.ids.size === 1 && !a.ids.has("(unanchored)")).length / recurring.length),
    themeOverlapProxy: themePairs.length === 0 ? null : r3(themePairs.reduce((a, b) => a + b, 0) / themePairs.length),
    comparisonSetCompatibility: { comparablePairs, pairsWithFull },
  };
}
