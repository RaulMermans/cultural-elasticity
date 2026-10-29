/**
 * SemanticComparisonValidator (Sprint 5A): may this comparison set carry a FULL relative analysis?
 *
 * A comparison set can be STRUCTURALLY valid (Qloo-resolved concepts, one entity type, ≥ 3 members, independent
 * exemplars, provenance, one rank call) and still be culturally meaningless: Sprint 4 live runs placed a
 * fly-fishing move among "Breakfast Buffet" and "Breakfast Available" (venue-listing attributes carried by one
 * lodge's tag profile). Structure and meaning are therefore judged separately:
 *
 *   structural   ≥ MIN_COMPARISON_SET members of one entity type, distinct concepts, no exemplar shared between
 *                territories, every exemplar and concept provenance-backed
 *   semantic     per REFERENCE territory (targets are the user's question; frontier candidates were gated before):
 *                  INCOMPARABLE  the concept is a venue-listing attribute or operational tag (namespace policy
 *                                below), or the model judged it weak/mismatched (advisory veto: it can only remove)
 *                  WEAK          the only Qloo tie is one target-exemplar profile, or the concept is a descriptor
 *                                (tone/adjective/audience/ambience) rather than a territory at the target's level
 *                  MEANINGFUL    Qloo ties it to the question: on the brand's own tag profile, or carried by ≥ 2
 *                                validated target-exemplar profiles
 *                  UNKNOWN       no Qloo tie observed in this run (e.g. a reference the agent named freely)
 * Only MEANINGFUL references are accepted. A set is used for FULL only when it is structurally VALID and still has
 * ≥ MIN_COMPARISON_SET accepted members; otherwise its territories degrade (PARTIAL / DESCRIPTIVE) with the reason.
 *
 * Model judgments never ADD support: a model saying "strong" does not turn WEAK or UNKNOWN into MEANINGFUL
 * (AGENTS.md runtime rule 12). Nothing here names a brand, territory or exemplar; the namespace lists are
 * categories of Qloo's tag taxonomy, each backed by values observed live (see the notes).
 */
import type { SemanticComparisonAssessment, SemanticComparisonStatus, SemanticRelevance } from "@cultural-elasticity/shared";
import { matchOperationalRule, tagNamespace } from "../methodology/operational-tags.js";
import type { RankableType } from "./contracts.js";
import type { AgentRunState, TerritoryState } from "./state.js";

export const SEMANTIC_RULES_VERSION = "semantic-comparison-v1";

/** Qloo `:qloo` namespaces that describe how a venue listing operates, not a cultural territory. */
export const INCIDENTAL_ATTRIBUTE_NAMESPACES: readonly { namespace: string; note: string }[] = [
  // [live 2026-10-20] air_conditioning, airport_shuttle_service, bicycle_rental, breakfast_buffet
  { namespace: "amenity", note: "facility of a venue listing" },
  // [live 2026-10-20] breakfast_available
  { namespace: "dining_option", note: "meal service offered by a venue listing" },
  // [live 2026-10-20] takeout
  { namespace: "service_type", note: "service mode of a venue listing" },
  // [live 2026-10-20] conferences, weddings, lunch, group_gatherings
  { namespace: "good_for", note: "occasion a venue listing suits" },
  // [live 2026-10-20] casual_elegance
  { namespace: "decor", note: "interior decor of a venue listing" },
];

/** Namespaces of descriptors (tone, adjective, audience, ambience): a different analytical level than a territory. */
export const DESCRIPTOR_NAMESPACES: readonly { namespace: string; note: string }[] = [
  // [live 2026-10-20] cozy, bustling, laid_back, upscale
  { namespace: "ambience", note: "atmosphere descriptor of a venue" },
  // [live 2026-10-20] nostalgic, light_hearted, practical, curiosity
  { namespace: "emotional_tone", note: "emotional-tone descriptor" },
  // [live 2026-10-20] humor_seeking, educational_seeking
  { namespace: "audience", note: "audience-motivation descriptor" },
  // [live 2026-10-20] crafted, luxury, technical, organic
  { namespace: "adjective", note: "adjective descriptor" },
];

const qlooSource = (tagId: string) => tagNamespace({ id: tagId });

/** Why a concept is incidental (venue attribute or operational tag), or undefined. */
export function incidentalConcept(tagId: string): { code: "OPERATIONAL_TAG" | "INCIDENTAL_ATTRIBUTE"; explanation: string } | undefined {
  const operational = matchOperationalRule({ id: tagId });
  if (operational) return { code: "OPERATIONAL_TAG", explanation: `operational tag (${operational.reason})` };
  const ns = qlooSource(tagId);
  const hit = ns && INCIDENTAL_ATTRIBUTE_NAMESPACES.find((n) => n.namespace === ns.namespace);
  return hit ? { code: "INCIDENTAL_ATTRIBUTE", explanation: `${hit.note} (namespace ${ns!.namespace}), not a cultural territory` } : undefined;
}

export function descriptorConcept(tagId: string): string | undefined {
  const ns = qlooSource(tagId);
  const hit = ns && DESCRIPTOR_NAMESPACES.find((n) => n.namespace === ns.namespace);
  return hit ? `${hit.note} (namespace ${ns!.namespace}), not a territory at the target's analytical level` : undefined;
}

/** Validated target-exemplar profiles that must carry a concept for it to be a MEANINGFUL reference (see the header). */
export const MEANINGFUL_EXEMPLAR_SUPPORT = 2;

export type ReferenceTie = { strength: "STRONG" | "WEAK" | "NONE"; onBrandProfile: boolean; exemplarSupport: number; evidenceReferences: string[] };

/** How Qloo itself ties a concept to the question: the brand's profile and validated target-exemplar profiles. */
export function referenceTie(state: AgentRunState, tagId: string): ReferenceTie {
  const brandId = state.brand.entity?.id;
  const evidence: string[] = [];
  const brandProfile = brandId ? state.profiles.get(brandId) : undefined;
  const onBrandProfile = brandProfile?.tagIds.includes(tagId) ?? false;
  if (onBrandProfile) evidence.push(brandProfile!.call.envelope.execution.correlation_id);
  let exemplarSupport = 0;
  for (const t of state.territories.filter((x) => x.role === "target" && x.status !== "dropped" && x.representation)) {
    for (const e of t.representation!.exemplars.filter((x) => x.quality === "VALID")) {
      const profile = state.profiles.get(e.id);
      if (profile?.tagIds.includes(tagId)) {
        exemplarSupport += 1;
        evidence.push(profile.call.envelope.execution.correlation_id);
      }
    }
  }
  return { strength: onBrandProfile || exemplarSupport >= MEANINGFUL_EXEMPLAR_SUPPORT ? "STRONG" : exemplarSupport === 1 ? "WEAK" : "NONE", onBrandProfile, exemplarSupport, evidenceReferences: [...new Set(evidence)] };
}

export type ReferenceVerdict = { status: SemanticComparisonStatus; reasonCode: string; explanation: string; evidenceReferences: string[]; modelAssessed: boolean };

/** Semantic verdict on one reference concept. `judgment` is the model's advisory relevance (can only remove). */
export function assessReferenceConcept(state: AgentRunState, tagId: string, judgment: { relevance: SemanticRelevance; reason: string } | null = null): ReferenceVerdict {
  const modelAssessed = judgment !== null;
  const incidental = incidentalConcept(tagId);
  if (incidental) return { status: "INCOMPARABLE", reasonCode: incidental.code, explanation: incidental.explanation, evidenceReferences: [], modelAssessed };
  if (judgment && (judgment.relevance === "WEAK" || judgment.relevance === "MISMATCH")) {
    return { status: "INCOMPARABLE", reasonCode: "SEMANTIC_REFERENCE_VETO", explanation: `the agent judged it ${judgment.relevance.toLowerCase()} as a comparison territory (advisory veto): ${judgment.reason}`, evidenceReferences: [], modelAssessed };
  }
  const descriptor = descriptorConcept(tagId);
  const tie = referenceTie(state, tagId);
  if (descriptor) return { status: "WEAK", reasonCode: "DESCRIPTOR_CONCEPT", explanation: descriptor, evidenceReferences: tie.evidenceReferences, modelAssessed };
  if (tie.strength === "STRONG") {
    const basis = [tie.onBrandProfile ? "on the brand's own Qloo tag profile" : null, tie.exemplarSupport >= MEANINGFUL_EXEMPLAR_SUPPORT ? `carried by ${tie.exemplarSupport} validated target-exemplar profiles` : null].filter(Boolean).join("; ");
    return { status: "MEANINGFUL", reasonCode: "QLOO_CULTURAL_TIE", explanation: basis, evidenceReferences: tie.evidenceReferences, modelAssessed };
  }
  if (tie.strength === "WEAK") return { status: "WEAK", reasonCode: "WEAK_CULTURAL_TIE", explanation: "its only Qloo tie is one target-exemplar profile (likely an incidental attribute of that exemplar)", evidenceReferences: tie.evidenceReferences, modelAssessed };
  return { status: "UNKNOWN", reasonCode: "NO_QLOO_TIE", explanation: "no Qloo evidence in this run ties it to the brand or the target", evidenceReferences: [], modelAssessed };
}

/** Semantic verdict on a reference TERRITORY (its anchored concept and the agent's judgment of it). */
export function assessReferenceTerritory(state: AgentRunState, t: TerritoryState): ReferenceVerdict | null {
  if (t.role !== "reference" || !t.concept) return null;
  return assessReferenceConcept(state, t.concept.id, t.semanticJudgment);
}

const MIN_SET = 3;

/** Structural + semantic assessment of one comparison group (all members share `entityType`). */
export function assessComparisonGroup(state: AgentRunState, entityType: RankableType, members: readonly TerritoryState[]): SemanticComparisonAssessment {
  const issues: string[] = [];
  if (members.length < MIN_SET) issues.push(`only ${members.length} territories; a relative position needs ≥ ${MIN_SET}`);
  if (members.some((t) => t.representation?.entityType !== entityType)) issues.push("mixed entity types");
  const concepts = members.map((t) => t.concept?.id ?? null);
  if (concepts.some((c) => c === null)) issues.push("a member has no Qloo concept");
  if (new Set(concepts).size !== concepts.length) issues.push("two members share a Qloo concept (duplicate territory)");
  const exemplarOwners = new Map<string, string>();
  for (const t of members)
    for (const e of t.representation?.exemplars ?? []) {
      const other = exemplarOwners.get(e.id);
      if (other && other !== t.key) issues.push(`exemplar ${e.label} represents both ${other} and ${t.key} (not independent)`);
      exemplarOwners.set(e.id, t.key);
      if (!e.supportCorrelationId) issues.push(`exemplar ${e.label} has no Qloo provenance`);
    }
  for (const t of members) if (t.concept && !(state.tags.get(t.concept.id)?.sources.length)) issues.push(`concept ${t.concept.id} has no Qloo provenance`);

  const target = members.find((t) => t.role === "target") ?? members[0];
  const references = members.filter((t) => t.role === "reference");
  const rejected: SemanticComparisonAssessment["rejectedReferences"] = [];
  const accepted: string[] = [];
  const evidence = new Set<string>();
  let modelAssessed = false;
  const statuses: SemanticComparisonStatus[] = [];
  for (const r of references) {
    const verdict = assessReferenceTerritory(state, r)!;
    modelAssessed ||= verdict.modelAssessed;
    for (const id of verdict.evidenceReferences) evidence.add(id);
    if (verdict.status === "MEANINGFUL") accepted.push(r.key);
    else {
      statuses.push(verdict.status);
      rejected.push({ territoryKey: r.key, reasonCode: verdict.reasonCode, explanation: `${r.label}: ${verdict.status} — ${verdict.explanation}` });
    }
  }
  const remaining = members.length - rejected.length;
  const semanticStatus: SemanticComparisonStatus = remaining >= MIN_SET ? "MEANINGFUL" : statuses.includes("INCOMPARABLE") ? "INCOMPARABLE" : statuses.includes("WEAK") ? "WEAK" : statuses.includes("UNKNOWN") ? "UNKNOWN" : "MEANINGFUL";
  return {
    targetTerritoryKey: target?.key ?? "",
    referenceTerritoryKeys: references.map((t) => t.key),
    memberTerritoryKeys: members.map((t) => t.key),
    entityType,
    structuralStatus: issues.length === 0 ? "VALID" : "INVALID",
    structuralIssues: [...new Set(issues)],
    semanticStatus,
    acceptedReferences: accepted,
    rejectedReferences: rejected,
    modelAssessed,
    evidenceReferences: [...evidence],
    usedForFull: false,
    rulesVersion: SEMANTIC_RULES_VERSION,
  };
}
