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
 */
import { matchOperationalRule, tagNamespace } from "../methodology/operational-tags.js";
import { exemplarCandidates } from "./candidate-discovery.js";
import { deterministicDuplicate, structuralDuplicate } from "./concept-dedup.js";
import type { RankableType } from "./contracts.js";
import { analysisReserve } from "./analysis-runner.js";
import { MIN_COMPARISON_SET } from "./router.js";
import { assessReferenceConcept, assessReferenceTerritory, type ReferenceVerdict } from "./semantic-comparison.js";
import { activeTerritories, remainingQlooCalls, type AgentRunState } from "./state.js";

/** A reference concept is usable only if Qloo returns at least this many eligible members of the type. */
export const MIN_REFERENCE_POOL = 2;

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
  probe: { entityType: RankableType; eligible: number } | null;
  usable: boolean | null;
  /** Set when the probe shows the concept duplicates an existing territory in Qloo structure. */
  duplicateOf: string | null;
  justification: string;
  /** Sprint 5A: semantic comparison verdict (only MEANINGFUL candidates are usable). */
  semantic: Pick<ReferenceVerdict, "status" | "reasonCode" | "explanation">;
};

export function namespaceKey(tagId: string): string {
  const ns = tagNamespace({ id: tagId });
  return ns ? `${ns.namespace}:${ns.source}` : "unknown";
}

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

export function referenceCandidates(state: AgentRunState): ReferenceCandidate[] {
  const brandId = state.brand.entity?.id;
  const entityType = referenceEntityType(state);
  if (!brandId || !entityType) return [];
  const active = activeTerritories(state);
  const targets = active.filter((t) => t.role === "target" && t.concept);
  const targetNamespaces = new Set(targets.map((t) => namespaceKey(t.concept!.id)));
  const used = new Set(active.flatMap((t) => (t.concept ? [t.concept.id] : [])));
  const yieldByNs = namespaceYield(state, entityType);

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
    const sources = [...entry.sources].sort();
    const parts = [
      sources.includes("brand_profile") ? "on the brand's own Qloo profile" : null,
      entry.support > 0 ? `carried by ${entry.support} target exemplar profile(s)` : null,
      targetNamespaces.has(namespace) ? `same tag namespace (${namespace}) as a target concept` : null,
      nsYield === "productive" ? `namespace already returned ${entityType} members in this run` : nsYield === "unproductive" ? `namespace returned no ${entityType} members in this run` : null,
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
      probe: eligible === null ? null : { entityType, eligible },
      usable: verdict.status !== "MEANINGFUL" ? false : eligible === null ? null : eligible >= MIN_REFERENCE_POOL && !structural,
      duplicateOf: structural?.key ?? null,
      justification: parts.join("; "),
      semantic: { status: verdict.status, reasonCode: verdict.reasonCode, explanation: verdict.explanation },
    });
  }
  const rank = (c: ReferenceCandidate) => [c.semantic.status === "MEANINGFUL" ? 0 : 1, c.usable === true ? 0 : c.usable === null ? 1 : 2, c.namespaceYield === "productive" ? 0 : c.namespaceYield === "untested" ? 1 : 2, c.namespaceMatchesTarget ? 0 : 1, -c.support, c.sources.length > 1 ? 0 : 1];
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
};

/**
 * Deterministic reference-construction plan for a single move or a two-territory comparison: how many
 * meaningful references are still needed, and whether a FULL relative analysis is still feasible within the
 * remaining iterations, Qloo calls, candidate slots and skill budget. When it is not, analysis proceeds and the
 * result is an honest PARTIAL.
 */
export function referencePlan(state: AgentRunState): ReferencePlan {
  const intent = state.interpretation?.intent;
  const entityType = referenceEntityType(state);
  const empty: ReferencePlan = { applicable: false, entityType, required: MIN_COMPARISON_SET, valid: 0, pending: [], needed: 0, meaningfulCandidates: [], rejectedCandidates: [], feasible: false, reason: "", outstanding: null };
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
  if (valid >= MIN_COMPARISON_SET) return { ...base, feasible: false, reason: `the comparison set already has ${valid} meaningful ${entityType} territories`, outstanding: null };
  const iterationsLeft = state.limits.maxAgentIterations - state.usage.iterations;
  const brand = state.brand.entity;
  const discovery = [
    ...(state.profiles.has(brand.id) ? [] : [{ id: brand.id, label: `the brand ${brand.label}` }]),
    ...active.filter((t) => t.role === "target").flatMap((t) => (t.representation?.exemplars ?? []).filter((e) => e.quality === "VALID" && !state.profiles.has(e.id)).map((e) => ({ id: e.id, label: e.label }))),
  ];
  const ready = active.filter((t) => t.status !== "analyzed" && (t.representation || t.conceptOnly));
  const callsNeeded = needed * REFERENCE_CALL_COST + pending.length + analysisReserve(state, ready) + needed + Math.min(discovery.length, 4);
  const skill = state.skillUsage.get("build_comparison_set");
  const blocked =
    skill?.exhausted || skill?.qlooSpent
      ? "the comparison-set skill budget is spent"
      : state.territories.length + needed > state.limits.maxCandidateTerritories
          ? "no candidate-territory slot left for more references"
          : iterationsLeft < REFERENCE_TURN_COST + 1
            ? `only ${iterationsLeft} turn(s) left; reference construction needs ${REFERENCE_TURN_COST + 1}`
            : remainingQlooCalls(state) < callsNeeded
              ? `${remainingQlooCalls(state)} Qloo call(s) left; references and analysis need about ${callsNeeded}`
              : needed > 0 && meaningful.length < needed && discovery.length === 0
                ? `only ${meaningful.length} semantically meaningful reference candidate(s) with possible ${entityType} members; ${needed} needed`
                : null;
  if (blocked) return { ...base, feasible: false, reason: `FULL is not feasible: ${blocked}; analysis will be partial`, outstanding: null };
  // Candidates come from the brand profile and the target exemplars' profiles: until those are collected,
  // "no candidate" means "not yet discovered", not "none exists".
  if (needed > 0 && meaningful.length < needed && discovery.length > 0) {
    return { ...base, feasible: true, reason: `reference discovery pending: ${discovery.length} tag profile(s) not yet collected`, outstanding: `Reference candidates are found on tag profiles that are not collected yet: fetch ${discovery.map((d) => d.label).join(", ")} with qloo_get_entity_tags, then choose ${needed} meaningful ${entityType} reference(s) from referenceCandidates. If none is meaningful, analyze and accept a PARTIAL result.` };
  }
  const pendingText = pending.length ? ` ${pending.length} proposed reference(s) (${pending.join(", ")}) still need a validated ${entityType} representation.` : "";
  const outstanding =
    needed > 0
      ? `${needed} more meaningful ${entityType} reference territor${needed === 1 ? "y is" : "ies are"} required for a relative position (have ${valid} of ${MIN_COMPARISON_SET}).${pendingText} Choose from referenceCandidates with semantic MEANINGFUL: probe its brand-independent ${entityType} pool if untested, then propose_territory (role reference) + anchor_territory + validate_territory_representation. If none fits, analyze now and accept a PARTIAL result.`
      : `${pendingText.trim()} Represent them, then analyze all ${MIN_COMPARISON_SET} together.`;
  return { ...base, feasible: true, reason: `FULL is feasible: ${needed} reference(s) needed, ${meaningful.length} meaningful candidate(s), ${remainingQlooCalls(state)} Qloo call(s) and ${iterationsLeft} turn(s) left`, outstanding };
}

/**
 * After this many deferred `analyze` decisions the runtime stops deferring: the agent saw the exact requirement and
 * still chose to analyze, so the result is an honest PARTIAL. Reference construction itself stays available.
 */
export const MAX_REFERENCE_DEFERRALS = 1;
