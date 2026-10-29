/**
 * Reference strategy: which comparison territories can place a single move (or a two-territory
 * comparison) in a set of ≥ 3 territories of ONE entity type?
 *
 * Candidates are Qloo concept tags observed in this run, from two structural sources:
 *   brand_profile             tags on the brand's own Qloo profile (the brand's cultural home ground)
 *   target_exemplar_profiles  tags carried by the represented targets' exemplar profiles (the target's
 *                             neighbouring culture), with support = how many of those profiles carry it
 * Each candidate is then judged only on run evidence:
 *   comparison compatibility  the reference must be representable with the targets' entity type, so it is
 *                             probed (and later represented) with that type, never a fixed one
 *   namespace yield           tag namespaces that already returned members of that type in this run are
 *                             productive; namespaces probed ≥ 2 times with no eligible member are
 *                             unproductive and sink to the bottom (no list of namespaces is hard-coded)
 *   structural match          same namespace as a target concept
 *   evidence availability     a probe with ≥ MIN_REFERENCE_POOL eligible members
 * Excluded: operational tags, concepts already anchoring a territory, and concepts that duplicate a
 * territory (ConceptDeduplicator layer 1). Every candidate carries a recorded justification.
 *
 * v2 (Sprint 5A): "Qloo returned two eligible entities" is not "a meaningful comparison territory". Each candidate
 * also carries the SemanticComparisonValidator verdict (semantic-comparison.ts); only MEANINGFUL candidates are
 * usable, and they rank first. `referencePlan` states the exact outstanding requirement (how many references are
 * still needed, which candidates were rejected and why, and whether FULL is still feasible within the budget).
 *
 * v3 (Sprint 9N, from the live traces of Sprint 5A.2): Haiku probed brand-profile media and music genres with the
 * place type seven times in one run (all empty) while place-profile tags of the target's own exemplars were waiting.
 * Under the enforce policy (state.feasibilityPolicy):
 *   type evidence        a candidate observed on the tag profile of an entity of the comparison type (a member of a
 *                        pool of that type, or an entity Qloo typed so) has direct evidence of applying to that type;
 *                        it ranks first. A namespace name never implies a type: only observed profiles count.
 *   namespace yield      a namespace with one empty probe and none productive ranks after untested ones (diversify)
 *   thin-panel discovery the target exemplars' profiles are reference discovery only when ≥ MEANINGFUL_EXEMPLAR_SUPPORT
 *                        validated exemplars exist: with one, their tags can be at most WEAK, so the calls cannot help
 *   bounded probing      after REFERENCE_EMPTY_PROBE_LIMIT empty reference probes of the type while references are still
 *                        missing and no usable probed candidate covers them, FULL is not feasible (NO_REFERENCE_YIELD)
 */
import { matchOperationalRule } from "../methodology/operational-tags.js";
import { tagNamespace, territoryQueryTags } from "./probe-policy.js";
import { exemplarCandidates } from "./candidate-discovery.js";
import { deterministicDuplicate, structuralDuplicate } from "./concept-dedup.js";
import type { RankableType } from "./contracts.js";
import { analysisReserve } from "./analysis-runner.js";
import { MIN_COMPARISON_SET } from "./router.js";
import { memoRun } from "./derived-cache.js";
import { assessReferenceConcept, assessReferenceTerritory, MEANINGFUL_EXEMPLAR_SUPPORT, type ReferenceVerdict } from "./semantic-comparison.js";
import { activeTerritories, remainingQlooCalls, turnsAvailable, type AgentRunState } from "./state.js";
import type { CompletionFeasibility } from "@cultural-elasticity/shared";

/** A reference concept is usable only if Qloo returns at least this many eligible members of the type. */
export const MIN_REFERENCE_POOL = 2;
/** Sprint 9N: empty brand-independent reference probes of the comparison type after which, with references still missing, FULL is not feasible. */
export const REFERENCE_EMPTY_PROBE_LIMIT = 4;

export type ReferenceSource = "brand_profile" | "target_exemplar_profiles";

export type ReferenceCandidate = {
  tagId: string;
  label: string;
  namespace: string;
  sources: ReferenceSource[];
  /** Target exemplar profiles carrying the tag. */
  support: number;
  namespaceMatchesTarget: boolean;
  namespaceYield: "productive" | "unproductive" | "untested";
  /** Sprint 9N: empty reference probes of the type in the candidate's namespace (0 while untested). */
  namespaceEmptyProbes: number;
  /** Sprint 9N: profiled entities of the comparison type whose Qloo tag profile carries the candidate. */
  typeEvidence: number;
  probe: { entityType: RankableType; eligible: number } | null;
  usable: boolean | null;
  /** Set when the probe shows the concept duplicates an existing territory in Qloo structure. */
  duplicateOf: string | null;
  justification: string;
  /** Sprint 5A: semantic comparison verdict (only MEANINGFUL candidates are usable). */
  semantic: Pick<ReferenceVerdict, "status" | "reasonCode" | "explanation">;
};

/** One namespace definition for the run (probe-policy.ts tagNamespace). */
export const namespaceKey = tagNamespace;

/** Entity type of the represented targets (the comparison set must share it); null if none is represented. */
export function referenceEntityType(state: AgentRunState): RankableType | null {
  const types = activeTerritories(state)
    .filter((t) => t.role === "target" && t.representation)
    .map((t) => t.representation!.entityType);
  if (types.length === 0) return null;
  const counts = new Map<RankableType, number>();
  for (const type of types) counts.set(type, (counts.get(type) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
}

/**
 * Members that can support a reference: brand-independent POOL members of the type, excluding entities that
 * already represent a territory. Profile-tag support does not count here: the target's own exemplars carry
 * many tags, and a reference "supported" by them would compare the target with itself.
 */
export function referenceMembers(state: AgentRunState, tagId: string, entityType: RankableType): number {
  const used = new Set(activeTerritories(state).flatMap((t) => (t.representation?.exemplars ?? []).map((e) => e.id)));
  return exemplarCandidates(state, tagId, entityType).eligible.filter((c) => c.conceptSupport === "tag_member" && !used.has(c.id)).length;
}

/** Per tag namespace: did brand-independent probes of this type return eligible members in this run? */
export function namespaceYield(state: AgentRunState, entityType: RankableType): Map<string, { productive: number; barren: number }> {
  const out = new Map<string, { productive: number; barren: number }>();
  for (const pool of state.pools) {
    if (pool.conditionedOn !== null || pool.tagIds.length !== 1 || pool.targetType !== entityType) continue;
    const key = namespaceKey(pool.tagIds[0]!);
    const entry = out.get(key) ?? { productive: 0, barren: 0 };
    const eligible = referenceMembers(state, pool.tagIds[0]!, entityType);
    if (eligible >= MIN_REFERENCE_POOL) entry.productive += 1;
    else entry.barren += 1;
    out.set(key, entry);
  }
  return out;
}

/** Entities this run observed as `entityType`: Qloo typed them so, or they are members of a pool of that type. */
function entitiesOfType(state: AgentRunState, entityType: RankableType): Set<string> {
  const out = new Set<string>();
  for (const [id, e] of state.entities) if (e.type === entityType) out.add(id);
  for (const pool of state.pools) if (pool.targetType === entityType) for (const id of pool.memberIds) out.add(id);
  return out;
}

/** Sprint 9N: profiled entities of `entityType` carrying the tag (the brand's own profile never counts: it is a brand). */
export function typeEvidenceFor(state: AgentRunState, tagId: string, entityType: RankableType, ofType = entitiesOfType(state, entityType)): number {
  let n = 0;
  for (const [id, profile] of state.profiles) if (id !== state.brand.entity?.id && ofType.has(id) && profile.tagIds.includes(tagId)) n += 1;
  return n;
}

/** Tags that belong to a target territory (its concept, grounding tag, or tag-search results): their probes are not reference probes. */
export function targetTags(state: AgentRunState): Set<string> {
  return new Set(activeTerritories(state).filter((t) => t.role === "target").flatMap((t) => [...(t.concept ? [t.concept.id] : []), ...(t.sourceTagId ? [t.sourceTagId] : []), ...(territoryQueryTags(state, t) ?? [])]));
}

/** Sprint 9N: brand-independent single-tag probes of the comparison type made for references in this run. */
export function referenceProbeLedger(state: AgentRunState, entityType: RankableType | null = referenceEntityType(state)): { made: number; empty: number; productive: number } {
  if (!entityType) return { made: 0, empty: 0, productive: 0 };
  const own = targetTags(state);
  const seen = new Set<string>();
  let empty = 0;
  let productive = 0;
  for (const pool of state.pools) {
    if (pool.conditionedOn !== null || pool.tagIds.length !== 1 || pool.targetType !== entityType) continue;
    const tagId = pool.tagIds[0]!;
    if (own.has(tagId) || seen.has(tagId)) continue;
    seen.add(tagId);
    if (referenceMembers(state, tagId, entityType) >= MIN_REFERENCE_POOL) productive += 1;
    else empty += 1;
  }
  return { made: seen.size, empty, productive };
}

/** Validated exemplars across the represented targets (the profiles that can tie a reference to the question). */
export function validTargetExemplars(state: AgentRunState): number {
  return activeTerritories(state).filter((t) => t.role === "target" && t.representation).reduce((n, t) => n + t.representation!.exemplars.filter((e) => e.quality === "VALID").length, 0);
}

/**
 * Sprint 5A.1: a reference probe in a tag namespace that already returned no eligible member of the comparison type
 * twice (and never any) has no expected value. 5A only hid such candidates from the context; live L-M1 still probed
 * six brand-profile media/music genres with the brand type, three per turn. Probes of a territory's own concepts and
 * of a proposed reference's anchor are never refused by this rule.
 */
export function barrenReferenceNamespace(state: AgentRunState, tagId: string, type: RankableType): string | null {
  const intent = state.interpretation?.intent;
  if ((intent !== "analyze_move" && intent !== "compare_territories") || referenceEntityType(state) !== type) return null;
  if (activeTerritories(state).some((t) => t.concept?.id === tagId || t.sourceTagId === tagId || (territoryQueryTags(state, t) ?? []).includes(tagId))) return null;
  const ns = namespaceKey(tagId);
  const y = namespaceYield(state, type).get(ns);
  if (!y || y.productive > 0 || y.barren < 2) return null;
  return `tag namespace ${ns} returned no eligible ${type} member in ${y.barren} reference probes this run; choose a referenceCandidate from a productive or untested namespace, or analyze and accept a PARTIAL result`;
}

export function referenceCandidates(state: AgentRunState): ReferenceCandidate[] {
  const brandId = state.brand.entity?.id;
  const entityType = referenceEntityType(state);
  if (!brandId || !entityType) return [];
  const active = activeTerritories(state);
  const targets = active.filter((t) => t.role === "target" && t.concept);
  const targetNamespaces = new Set(targets.map((t) => namespaceKey(t.concept!.id)));
  const used = new Set(active.flatMap((t) => (t.concept ? [t.concept.id] : [])));
  const yieldByNs = namespaceYield(state, entityType);
  const ofType = entitiesOfType(state, entityType);
  const enforce = state.feasibilityPolicy === "enforce";

  const found = new Map<string, { sources: Set<ReferenceSource>; support: number }>();
  const add = (tagId: string, source: ReferenceSource) => {
    if (used.has(tagId) || matchOperationalRule({ id: tagId }) !== undefined) return;
    const entry = found.get(tagId) ?? { sources: new Set<ReferenceSource>(), support: 0 };
    entry.sources.add(source);
    if (source === "target_exemplar_profiles") entry.support += 1;
    found.set(tagId, entry);
  };
  for (const id of state.profiles.get(brandId)?.tagIds ?? []) add(id, "brand_profile");
  // Only VALID exemplars describe the target's neighbourhood (a weak outlier's tags would mislead).
  for (const t of targets) for (const e of (t.representation?.exemplars ?? []).filter((x) => x.quality === "VALID")) for (const id of new Set(state.profiles.get(e.id)?.tagIds ?? [])) add(id, "target_exemplar_profiles");

  const candidates: ReferenceCandidate[] = [];
  for (const [tagId, entry] of found) {
    const label = state.tags.get(tagId)?.label ?? tagId;
    if (active.some((t) => deterministicDuplicate({ label: t.label, conceptId: t.concept?.id ?? null }, { label, conceptId: tagId }))) continue;
    const namespace = namespaceKey(tagId);
    const y = yieldByNs.get(namespace);
    const nsYield: ReferenceCandidate["namespaceYield"] = y && y.productive > 0 ? "productive" : y && y.barren >= 2 ? "unproductive" : "untested";
    const probed = state.pools.some((p) => p.conditionedOn === null && p.tagIds.length === 1 && p.tagIds[0] === tagId && p.targetType === entityType);
    const eligible = probed ? referenceMembers(state, tagId, entityType) : null;
    // A probed reference whose Qloo members largely coincide with an existing territory's is a near-duplicate:
    // it would compare the target with itself.
    const pseudo = { key: `ref:${tagId}`, label, role: "reference", concept: { id: tagId, label, type: state.tags.get(tagId)?.type ?? "unknown" }, representation: null } as unknown as Parameters<typeof structuralDuplicate>[2];
    const structural = probed ? active.find((t) => structuralDuplicate(state, t, pseudo) !== null) : undefined;
    const typeEvidence = typeEvidenceFor(state, tagId, entityType, ofType);
    const sources = [...entry.sources].sort();
    const parts = [
      sources.includes("brand_profile") ? "on the brand's own Qloo profile" : null,
      entry.support > 0 ? `carried by ${entry.support} target exemplar profile(s)` : null,
      targetNamespaces.has(namespace) ? `same tag namespace (${namespace}) as a target concept` : null,
      nsYield === "productive" ? `namespace already returned ${entityType} members in this run` : nsYield === "unproductive" ? `namespace returned no ${entityType} members in this run` : null,
      typeEvidence > 0 ? `on the Qloo profile of ${typeEvidence} ${entityType} entit${typeEvidence === 1 ? "y" : "ies"} in this run` : null,
      eligible !== null ? `Qloo returned ${eligible} eligible ${entityType} member(s) in a brand-independent pool` : null,
      structural ? `its Qloo members largely coincide with ${structural.label} (near-duplicate, not usable)` : null,
    ].filter(Boolean);
    const verdict = assessReferenceConcept(state, tagId);
    candidates.push({
      tagId,
      label,
      namespace,
      sources,
      support: entry.support,
      namespaceMatchesTarget: targetNamespaces.has(namespace),
      namespaceYield: nsYield,
      namespaceEmptyProbes: y?.barren ?? 0,
      typeEvidence,
      probe: eligible === null ? null : { entityType, eligible },
      usable: verdict.status !== "MEANINGFUL" ? false : eligible === null ? null : eligible >= MIN_REFERENCE_POOL && !structural,
      duplicateOf: structural?.key ?? null,
      justification: parts.join("; "),
      semantic: { status: verdict.status, reasonCode: verdict.reasonCode, explanation: verdict.explanation },
    });
  }
  const nsRank = (c: ReferenceCandidate) => (c.namespaceYield === "productive" ? 0 : c.namespaceYield === "untested" ? (c.namespaceEmptyProbes > 0 ? 2 : 1) : 3);
  const rank = (c: ReferenceCandidate) =>
    enforce
      ? [c.semantic.status === "MEANINGFUL" ? 0 : 1, c.usable === true ? 0 : c.usable === null ? 1 : 2, c.typeEvidence > 0 ? 0 : 1, nsRank(c), c.namespaceMatchesTarget ? 0 : 1, -c.typeEvidence, -c.support, c.sources.length > 1 ? 0 : 1]
      : [c.semantic.status === "MEANINGFUL" ? 0 : 1, c.usable === true ? 0 : c.usable === null ? 1 : 2, c.namespaceYield === "productive" ? 0 : c.namespaceYield === "untested" ? 1 : 2, c.namespaceMatchesTarget ? 0 : 1, -c.support, c.sources.length > 1 ? 0 : 1];
  return candidates.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i += 1) if (ra[i] !== rb[i]) return ra[i]! - rb[i]!;
    return a.label.localeCompare(b.label) || a.tagId.localeCompare(b.tagId);
  });
}

/**
 * Represented rankable territories of the reference entity type (targets + references). v2: a reference the
 * semantic comparison validator would reject does not count (a set completed with junk is not complete).
 */
export function comparisonSetSize(state: AgentRunState): number {
  const type = referenceEntityType(state);
  if (!type) return 0;
  return activeTerritories(state).filter((t) => t.representation?.entityType === type && (t.role !== "reference" || assessReferenceTerritory(state, t)?.status === "MEANINGFUL")).length;
}

/** Qloo calls one more reference typically needs: a brand-independent probe and a primary-exemplar profile. */
export const REFERENCE_CALL_COST = 2;
/** Turns a reference needs after the probe (propose + anchor + validate fit in one) plus the analysis turn. */
export const REFERENCE_TURN_COST = 2;

/**
 * Sprint 5A.1 completion arithmetic (live L-C2: three usable references were in hand with three turns left, yet the
 * plan said "only 2 turn(s) left; reference construction needs 3" and the comparison skill switched off). Turns are
 * counted with `turnsAvailable` (the open turn included, the same value inside and between turns), and a reference
 * whose brand-independent pool was already probed with ≥ MIN_REFERENCE_POOL eligible members costs no probe:
 *   turns  = 1 (analyze; finish is automatic at the iteration budget)
 *          + 1 if references still have to be proposed / anchored / validated (one turn for all of them)
 *          + 1 if some needed reference has not been probed yet (the probe must return before it can be proposed)
 *          + 1 if the tag profiles that reveal candidates are not collected yet
 *   calls  = 2 per unprobed reference + 1 (primary profile) per probed one + pending + analysis reserve + panel growth
 *          + profiles still to collect (≤ 4)
 */
export function completionCost(input: { needed: number; usableProbed: number; pending: number; discovery: number; reserve: number }): { turns: number; calls: number } {
  const probed = Math.min(input.needed, input.usableProbed);
  const unprobed = input.needed - probed;
  const turns = 1 + (input.needed > 0 || input.pending > 0 ? 1 : 0) + (unprobed > 0 ? 1 : 0) + (input.discovery > 0 && unprobed > 0 ? 1 : 0);
  const calls = unprobed * REFERENCE_CALL_COST + probed + input.pending + input.reserve + input.needed + Math.min(input.discovery, 4);
  return { turns, calls };
}

export type ReferencePlan = {
  applicable: boolean;
  entityType: RankableType | null;
  required: number;
  valid: number;
  pending: string[];
  needed: number;
  meaningfulCandidates: { tagId: string; label: string; usable: boolean | null }[];
  rejectedCandidates: { tagId: string; label: string; status: string; reasonCode: string; explanation: string }[];
  feasible: boolean;
  reason: string;
  /** The exact outstanding requirement, phrased as an instruction (shown to the model). */
  outstanding: string | null;
  /** Sprint 5A.1: the completion-feasibility contract (same values, named for the UI and the evaluators). */
  completion: CompletionFeasibility | null;
  /** Sprint 9N: why FULL is not feasible, as a code (null while feasible or not applicable). */
  blockedBy: "SKILL_BUDGET" | "CANDIDATE_SLOTS" | "TURN_BUDGET" | "QLOO_BUDGET" | "NO_MEANINGFUL_REFERENCE_CANDIDATES" | "NO_REFERENCE_YIELD" | null;
};

/**
 * Deterministic reference-construction plan for a single move or a two-territory comparison: how many
 * meaningful references are still needed, and whether a FULL relative analysis is still feasible within the
 * remaining iterations, Qloo calls, candidate slots and skill budget. When it is not, analysis proceeds and the
 * result is an honest PARTIAL.
 */
export function referencePlan(state: AgentRunState): ReferencePlan {
  return memoRun(state, "referencePlan", () => computeReferencePlan(state));
}

function computeReferencePlan(state: AgentRunState): ReferencePlan {
  const intent = state.interpretation?.intent;
  const entityType = referenceEntityType(state);
  const empty: ReferencePlan = { applicable: false, entityType, required: MIN_COMPARISON_SET, valid: 0, pending: [], needed: 0, meaningfulCandidates: [], rejectedCandidates: [], feasible: false, reason: "", outstanding: null, completion: null, blockedBy: null };
  if ((intent !== "analyze_move" && intent !== "compare_territories") || !state.brand.entity || !entityType) return { ...empty, reason: "no represented target yet, or not a move / comparison" };
  const active = activeTerritories(state);
  if (active.some((t) => t.role === "target" && t.status === "analyzed")) return { ...empty, applicable: true, entityType, reason: "the targets are already analyzed" };
  const valid = comparisonSetSize(state);
  const pending = active.filter((t) => t.role === "reference" && !t.representation && t.status !== "analyzed" && (!t.concept || assessReferenceTerritory(state, t)?.status === "MEANINGFUL")).map((t) => t.key);
  const needed = Math.max(0, MIN_COMPARISON_SET - valid - pending.length);
  const candidates = referenceCandidates(state);
  const meaningful = candidates.filter((c) => c.semantic.status === "MEANINGFUL" && c.usable !== false && c.namespaceYield !== "unproductive");
  const rejected = candidates.filter((c) => c.semantic.status !== "MEANINGFUL" || c.usable === false).slice(0, 6).map((c) => ({ tagId: c.tagId, label: c.label, status: c.semantic.status === "MEANINGFUL" ? "NO_MEMBERS" : c.semantic.status, reasonCode: c.semantic.status === "MEANINGFUL" ? (c.duplicateOf ? "NEAR_DUPLICATE" : "NO_ELIGIBLE_MEMBERS") : c.semantic.reasonCode, explanation: c.semantic.status === "MEANINGFUL" ? c.justification : c.semantic.explanation }));
  const base = { applicable: true, entityType, required: MIN_COMPARISON_SET, valid, pending, needed, meaningfulCandidates: meaningful.slice(0, 8).map((c) => ({ tagId: c.tagId, label: c.label, usable: c.usable })), rejectedCandidates: rejected };
  const completion = (feasible: boolean, reason: string, turnsNeeded = 0, callsNeeded = 0): CompletionFeasibility => ({ requiredReferenceCount: MIN_COMPARISON_SET, validReferenceCount: valid, missingReferenceCount: needed, compatibleEntityType: entityType, remainingRelevantCandidates: meaningful.length, remainingTurns: turnsAvailable(state), remainingQlooCalls: remainingQlooCalls(state), turnsNeeded, callsNeeded, fullAnalysisFeasible: feasible, reason });
  if (valid >= MIN_COMPARISON_SET) {
    const reason = `the comparison set already has ${valid} meaningful ${entityType} territories`;
    return { ...base, feasible: false, reason, outstanding: null, completion: completion(true, reason, 1), blockedBy: null };
  }
  const turnsLeft = turnsAvailable(state);
  const brand = state.brand.entity;
  const discovery = [
    ...(state.profiles.has(brand.id) ? [] : [{ id: brand.id, label: `the brand ${brand.label}` }]),
    // Sprint 9N: one validated exemplar cannot make an exemplar-derived reference MEANINGFUL, so its profile is no discovery.
    ...(state.feasibilityPolicy === "enforce" && validTargetExemplars(state) < MEANINGFUL_EXEMPLAR_SUPPORT
      ? []
      : active.filter((t) => t.role === "target").flatMap((t) => (t.representation?.exemplars ?? []).filter((e) => e.quality === "VALID" && !state.profiles.has(e.id)).map((e) => ({ id: e.id, label: e.label })))),
  ];
  const ready = active.filter((t) => t.status !== "analyzed" && (t.representation || t.conceptOnly));
  const usableProbed = meaningful.filter((c) => c.usable === true).length;
  const cost = completionCost({ needed, usableProbed, pending: pending.length, discovery: meaningful.length >= needed ? 0 : discovery.length, reserve: analysisReserve(state, ready) });
  const skill = state.skillUsage.get("build_comparison_set");
  const probes = state.feasibilityPolicy === "enforce" ? referenceProbeLedger(state, entityType) : { made: 0, empty: 0, productive: 0 };
  const validExemplars = validTargetExemplars(state);
  const thin = validExemplars < MEANINGFUL_EXEMPLAR_SUPPORT ? ` (the target has ${validExemplars} validated exemplar(s); tags of its exemplar profiles need ${MEANINGFUL_EXEMPLAR_SUPPORT} to count as meaningful)` : "";
  const [blockedBy, blocked]: [ReferencePlan["blockedBy"], string | null] =
    skill?.exhausted || skill?.qlooSpent
      ? ["SKILL_BUDGET", "the comparison-set skill budget is spent"]
      : state.territories.length + needed > state.limits.maxCandidateTerritories
        ? ["CANDIDATE_SLOTS", "no candidate-territory slot left for more references"]
        : turnsLeft < cost.turns
          ? ["TURN_BUDGET", `only ${turnsLeft} turn(s) left; references and analysis need ${cost.turns}`]
          : remainingQlooCalls(state) < cost.calls
            ? ["QLOO_BUDGET", `${remainingQlooCalls(state)} Qloo call(s) left; references and analysis need about ${cost.calls}`]
            : needed > 0 && probes.empty >= REFERENCE_EMPTY_PROBE_LIMIT && usableProbed < needed
              ? ["NO_REFERENCE_YIELD", `${probes.empty} brand-independent reference probes returned no eligible ${entityType} member and the ${needed} missing reference(s) have no usable probed candidate${thin}`]
              : needed > 0 && meaningful.length < needed && discovery.length === 0
                ? ["NO_MEANINGFUL_REFERENCE_CANDIDATES", `only ${meaningful.length} semantically meaningful reference candidate(s) with possible ${entityType} members; ${needed} needed${thin}`]
                : [null, null];
  if (blocked) {
    const reason = `FULL is not feasible: ${blocked}; analysis will be partial`;
    return { ...base, feasible: false, reason, outstanding: null, completion: completion(false, reason, cost.turns, cost.calls), blockedBy };
  }
  // Candidates come from the brand profile and the target exemplars' profiles: until those are collected,
  // "no candidate" means "not yet discovered", not "none exists".
  if (needed > 0 && meaningful.length < needed && discovery.length > 0) {
    return { ...base, feasible: true, completion: completion(true, `reference discovery pending: ${discovery.length} tag profile(s) not yet collected`, cost.turns, cost.calls), reason: `reference discovery pending: ${discovery.length} tag profile(s) not yet collected`, blockedBy: null, outstanding: `Reference candidates are found on tag profiles that are not collected yet: fetch ${discovery.map((d) => d.label).join(", ")} with qloo_get_entity_tags, then choose ${needed} meaningful ${entityType} reference(s) from referenceCandidates. If none is meaningful, analyze and accept a PARTIAL result.` };
  }
  const pendingText = pending.length ? ` ${pending.length} proposed reference(s) (${pending.join(", ")}) still need a validated ${entityType} representation.` : "";
  const outstanding =
    needed > 0
      ? `${needed} more meaningful ${entityType} reference territor${needed === 1 ? "y is" : "ies are"} required for a relative position (have ${valid} of ${MIN_COMPARISON_SET}).${pendingText} Choose from referenceCandidates with semantic MEANINGFUL: probe its brand-independent ${entityType} pool if untested, then propose_territory (role reference) + anchor_territory + validate_territory_representation. If none fits, analyze now and accept a PARTIAL result.`
      : `${pendingText.trim()} Represent them, then analyze all ${MIN_COMPARISON_SET} together.`;
  const reason = `FULL is feasible: ${needed} reference(s) needed, ${meaningful.length} meaningful candidate(s) (${usableProbed} already probed with members), ${remainingQlooCalls(state)} Qloo call(s) and ${turnsLeft} turn(s) left (needs ${cost.turns} turn(s), about ${cost.calls} call(s))`;
  return { ...base, feasible: true, reason, outstanding, completion: completion(true, reason, cost.turns, cost.calls), blockedBy: null };
}

/**
 * After this many deferred `analyze` decisions the runtime stops deferring: the agent saw the exact requirement and
 * still chose to analyze, so the result is an honest PARTIAL. Reference construction itself stays available.
 */
export const MAX_REFERENCE_DEFERRALS = 1;
