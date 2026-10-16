/**
 * RepresentationPlanner: how can THIS territory be represented in Qloo terms, given what Qloo returned?
 *
 * The model may propose a representation (a concept and exemplars). This module decides whether the
 * proposal is valid (objective constraints only) and which strategy the observed structure supports.
 * Nothing here depends on a territory's name: two territories with the same Qloo structure get the same
 * strategy, and the same territory gets a different strategy if Qloo returns different structure.
 *
 *   concept anchored? ── no ──────────────────────────────────────────────→ UNSUPPORTED
 *        │ yes
 *   accepted exemplars? ── yes ─ type place ──────────────────────────────→ PLACE_PANEL
 *        │                     └ all from brand-independent tag pools ───→ TAG_DERIVED_ENTITY_PANEL
 *        │                     └ otherwise (profile-tag support) ────────→ ENTITY_PANEL
 *        │ no
 *   every observed pool for the concept empty? ── yes ───────────────────→ DESCRIPTIVE_ONLY
 *        └ no ───────────────────────────────────────────────────────────→ CONDITIONED_ENTITY_EVIDENCE
 */
import type { RepresentationFailureCode, RepresentationStrategy } from "@cultural-elasticity/shared";
import { exemplarCandidates, labelFamily, NEAR_IDENTICAL_PROFILE_JACCARD, profileJaccard } from "./candidate-discovery.js";
import type { RankableType } from "./contracts.js";
import type { AcceptedRepresentation, AgentRunState, ExemplarChoice, RejectedExemplar, TerritoryState } from "./state.js";

export type RepresentationProposal = {
  territoryKey: string;
  entityType: RankableType;
  exemplars: { id: string; reason: string }[];
};

export type RepresentationValidation =
  | { accepted: true; representation: AcceptedRepresentation; rejected: RejectedExemplar[] }
  | { accepted: false; failure: { code: RepresentationFailureCode; detail: string }; rejected: RejectedExemplar[] };

/**
 * Objective checks per proposed exemplar:
 *   ENTITY_UNRESOLVED             never observed in a Qloo response in this run (no provenance)
 *   BRAND_AS_EXEMPLAR             the brand itself
 *   DUPLICATE_EXEMPLAR            proposed twice, or already an exemplar of another territory
 *   MIXED_ENTITY_TYPES            observed type differs from the representation's entity type
 *   BRAND_CONDITIONED_SELECTION   only seen in brand-conditioned lists (the brand would pick its own comparators)
 *   EXEMPLAR_SEMANTIC_MISMATCH    Qloo does not link it to the concept (no tag-pool membership, no profile tag)
 *   NEAR_DUPLICATE_EXEMPLAR       same name family as an earlier exemplar in this proposal
 *   EXEMPLAR_EVIDENCE_EMPTY       its tag profile was fetched and is empty
 * Surviving exemplars are accepted (≥ 1). Robustness needs ≥ 2; that is the methodology's call.
 */
export function validateTerritoryRepresentation(state: AgentRunState, proposal: RepresentationProposal): RepresentationValidation {
  const territory = state.territories.find((t) => t.key === proposal.territoryKey);
  const rejected: RejectedExemplar[] = [];
  if (!territory) return { accepted: false, failure: { code: "TERRITORY_UNRESOLVED", detail: `unknown territory "${proposal.territoryKey}"` }, rejected };
  if (!territory.concept) return { accepted: false, failure: { code: "TERRITORY_AMBIGUOUS", detail: "anchor the territory to a Qloo concept before proposing exemplars" }, rejected };
  if (proposal.exemplars.length === 0) return { accepted: false, failure: { code: "INSUFFICIENT_EXEMPLARS", detail: "no exemplars proposed" }, rejected };
  if (proposal.exemplars.length > state.limits.maxExemplarsPerTerritory) {
    return { accepted: false, failure: { code: "INSUFFICIENT_EXEMPLARS", detail: `at most ${state.limits.maxExemplarsPerTerritory} exemplars per territory` }, rejected };
  }

  const conceptId = territory.concept.id;
  const brandId = state.brand.entity?.id;
  const elsewhere = new Map(state.territories.filter((t) => t.key !== territory.key && t.status !== "dropped").flatMap((t) => (t.representation?.exemplars ?? []).map((e) => [e.id, t.label] as const)));
  const { eligible } = exemplarCandidates(state, conceptId, proposal.entityType);
  const eligibleById = new Map(eligible.map((c) => [c.id, c]));
  const accepted: ExemplarChoice[] = [];

  for (const { id, reason } of proposal.exemplars) {
    const entity = state.entities.get(id);
    const label = entity?.label ?? id;
    const reject = (code: RepresentationFailureCode, why: string) => rejected.push({ id, label, code, reason: why });
    if (!entity) {
      reject("ENTITY_UNRESOLVED", "not observed in any Qloo response in this run");
      continue;
    }
    if (id === brandId) {
      reject("BRAND_AS_EXEMPLAR", "the brand cannot represent a territory it is compared with");
      continue;
    }
    if (accepted.some((e) => e.id === id)) {
      reject("DUPLICATE_EXEMPLAR", "proposed twice");
      continue;
    }
    if (elsewhere.has(id)) {
      reject("DUPLICATE_EXEMPLAR", `already represents ${elsewhere.get(id)}`);
      continue;
    }
    if (entity.type !== undefined && entity.type !== proposal.entityType) {
      reject("MIXED_ENTITY_TYPES", `observed as ${entity.type}, representation type is ${proposal.entityType}`);
      continue;
    }
    const candidate = eligibleById.get(id);
    if (!candidate) {
      const onlyConditioned = entity.sources.length > 0 && entity.sources.every((s) => s.kind === "conditioned");
      if (onlyConditioned) reject("BRAND_CONDITIONED_SELECTION", "seen only in a brand-conditioned list; choose exemplars from brand-independent evidence");
      else reject("EXEMPLAR_SEMANTIC_MISMATCH", `Qloo has not linked it to ${territory.concept.label} in this run (no tag-pool membership, no profile tag)`);
      continue;
    }
    const family = accepted.find((e) => labelFamily(e.label, label));
    if (family) {
      reject("NEAR_DUPLICATE_EXEMPLAR", `same name family as ${family.label}`);
      continue;
    }
    const profile = state.profiles.get(id);
    if (profile && profile.tagIds.length === 0) {
      reject("EXEMPLAR_EVIDENCE_EMPTY", "Qloo returned an empty tag profile");
      continue;
    }
    accepted.push({
      id,
      label,
      type: proposal.entityType,
      popularity: candidate.popularity,
      selectionReason: reason.trim().slice(0, 300) || "no reason given",
      conceptSupport: candidate.conceptSupport,
      supportCorrelationId: candidate.supportCorrelationId,
    });
  }

  if (accepted.length === 0) {
    const codes = [...new Set(rejected.map((r) => r.code))];
    return { accepted: false, failure: { code: codes.length === 1 ? codes[0]! : "NO_VALID_REPRESENTATION", detail: "no proposed exemplar passed validation" }, rejected };
  }
  return { accepted: true, representation: { entityType: proposal.entityType, exemplars: accepted, ...assessDiversity(state, accepted), warnings: [] }, rejected };
}

/** Diversity from Qloo evidence only: "unknown" unless every exemplar's tag profile is known. */
export function assessDiversity(state: AgentRunState, exemplars: readonly { id: string; label: string }[]): { diversity: AcceptedRepresentation["diversity"]; diversityDetail: string } {
  if (exemplars.length < 2) return { diversity: "unknown", diversityDetail: "fewer than two exemplars" };
  const pairs: string[] = [];
  let unknown = false;
  for (let i = 0; i < exemplars.length; i += 1) {
    for (let j = i + 1; j < exemplars.length; j += 1) {
      const jaccard = profileJaccard(state, exemplars[i]!.id, exemplars[j]!.id);
      if (jaccard === null) unknown = true;
      else if (jaccard >= NEAR_IDENTICAL_PROFILE_JACCARD) pairs.push(`${exemplars[i]!.label} / ${exemplars[j]!.label} (${Math.round(jaccard * 100) / 100})`);
    }
  }
  if (pairs.length > 0) return { diversity: "low", diversityDetail: `near-identical tag profiles: ${pairs.join("; ")}` };
  if (unknown) return { diversity: "unknown", diversityDetail: "not every exemplar's tag profile is known, so distinctness is not established" };
  return { diversity: "adequate", diversityDetail: `no exemplar pair shares ≥ ${NEAR_IDENTICAL_PROFILE_JACCARD} of its cultural tags` };
}

export type TerritoryRepresentationPlan = {
  strategy: RepresentationStrategy;
  /** Entity type for panels and for brand-conditioned evidence; null when nothing is collectable. */
  entityType: RankableType | null;
  rankable: boolean;
  minimumEvidence: string[];
  limitations: string[];
};

/** Strategy from observed structure (see the diagram at the top of this file). */
export function planRepresentation(state: AgentRunState, territory: TerritoryState): TerritoryRepresentationPlan {
  if (!territory.concept) {
    return { strategy: "UNSUPPORTED", entityType: null, rankable: false, minimumEvidence: [], limitations: ["no Qloo concept anchors this territory"] };
  }
  const rep = territory.representation;
  if (rep) {
    const strategy: RepresentationStrategy = rep.entityType === "place" ? "PLACE_PANEL" : rep.exemplars.every((e) => e.conceptSupport === "tag_member") ? "TAG_DERIVED_ENTITY_PANEL" : "ENTITY_PANEL";
    const limitations = rep.exemplars.length < 2 ? ["only one exemplar: representation robustness cannot be tested"] : [];
    return {
      strategy,
      entityType: rep.entityType,
      rankable: true,
      minimumEvidence: ["brand tag profile", "≥ 1 exemplar tag profile", "one rank call per panel over a comparison set of ≥ 3 territories of the same entity type"],
      limitations,
    };
  }
  const conceptPools = state.pools.filter((p) => p.conditionedOn === null && p.tagIds.includes(territory.concept!.id));
  const nonEmpty = conceptPools.find((p) => p.memberIds.length > 0);
  if (conceptPools.length > 0 && !nonEmpty) {
    return { strategy: "DESCRIPTIVE_ONLY", entityType: null, rankable: false, minimumEvidence: ["concept tag"], limitations: ["Qloo returned no entities for this concept in any requested type"] };
  }
  return {
    strategy: "CONDITIONED_ENTITY_EVIDENCE",
    entityType: nonEmpty?.targetType ?? "brand",
    rankable: false,
    minimumEvidence: ["brand-conditioned recommend filtered to the concept"],
    limitations: ["no validated exemplar panel: no relative position, robustness or classification"],
  };
}
