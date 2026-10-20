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
import type { RepresentationFailureCode, RepresentationQualityDecision, RepresentationStrategy } from "@cultural-elasticity/shared";
import { exemplarCandidates, NEAR_IDENTICAL_PROFILE_JACCARD, profileJaccard } from "./candidate-discovery.js";
import { evaluateExemplarQuality, QUALITY_RULES_VERSION, type SemanticAssessment } from "./representation-quality.js";
import type { RankableType } from "./contracts.js";
import type { AcceptedRepresentation, AgentRunState, ExemplarChoice, RejectedExemplar, TerritoryState } from "./state.js";

export type RepresentationProposal = {
  territoryKey: string;
  entityType: RankableType;
  exemplars: { id: string; reason: string; semantic?: SemanticAssessment | undefined }[];
};

export type RepresentationValidation =
  | { accepted: true; representation: AcceptedRepresentation; rejected: RejectedExemplar[]; decisions: RepresentationQualityDecision[] }
  | { accepted: false; failure: { code: RepresentationFailureCode; detail: string }; rejected: RejectedExemplar[]; decisions: RepresentationQualityDecision[] };

/**
 * Validates a proposed representation exemplar by exemplar with the RepresentationQualityEvaluator
 * (representation-quality.ts): hard Qloo constraints, relative weak signals, and the model's advisory
 * semantic judgment, combined by explicit rules. Outcome:
 *   - VALID exemplars are accepted in proposal order; WEAK exemplars are accepted only as alternates,
 *     after every VALID one, and carry a warning;
 *   - if no VALID exemplar survives, the representation is refused (REPRESENTATION_QUALITY_WEAK when weak
 *     ones remained): a weak panel is never forced through to reach full analysis.
 * Robustness needs ≥ 2 exemplars; that is the methodology's call, not this validator's.
 */
export function validateTerritoryRepresentation(state: AgentRunState, proposal: RepresentationProposal, attempt = 0): RepresentationValidation {
  const territory = state.territories.find((t) => t.key === proposal.territoryKey);
  const rejected: RejectedExemplar[] = [];
  const decisions: RepresentationQualityDecision[] = [];
  if (!territory) return { accepted: false, failure: { code: "TERRITORY_UNRESOLVED", detail: `unknown territory "${proposal.territoryKey}"` }, rejected, decisions };
  if (!territory.concept) return { accepted: false, failure: { code: "TERRITORY_AMBIGUOUS", detail: "anchor the territory to a Qloo concept before proposing exemplars" }, rejected, decisions };
  if (proposal.exemplars.length === 0) return { accepted: false, failure: { code: "INSUFFICIENT_EXEMPLARS", detail: "no exemplars proposed" }, rejected, decisions };
  if (proposal.exemplars.length > state.limits.maxExemplarsPerTerritory) {
    return { accepted: false, failure: { code: "INSUFFICIENT_EXEMPLARS", detail: `at most ${state.limits.maxExemplarsPerTerritory} exemplars per territory` }, rejected, decisions };
  }

  const concept = territory.concept;
  const usedElsewhere = new Map(state.territories.filter((t) => t.key !== territory.key && t.status !== "dropped").flatMap((t) => (t.representation?.exemplars ?? []).map((e) => [e.id, t.label] as const)));
  const { eligible } = exemplarCandidates(state, concept.id, proposal.entityType);
  const eligibleById = new Map(eligible.map((c) => [c.id, c]));
  const valid: ExemplarChoice[] = [];
  const weak: { choice: ExemplarChoice; reasons: string[] }[] = [];

  for (const { id, reason, semantic } of proposal.exemplars) {
    const label = state.entities.get(id)?.label ?? id;
    const verdict = evaluateExemplarQuality(state, {
      conceptId: concept.id,
      conceptLabel: concept.label,
      entityType: proposal.entityType,
      candidateId: id,
      eligible,
      acceptedSoFar: [...valid, ...weak.map((w) => w.choice)],
      usedElsewhere,
      semantic: semantic ?? null,
    });
    decisions.push({
      territoryKey: territory.key,
      attempt,
      candidateId: id,
      label,
      deterministic: { level: verdict.deterministic.level, signals: verdict.deterministic.signals, reasons: verdict.deterministic.reasons },
      modelAssessment: semantic ? { relevance: semantic.relevance, reason: semantic.reason, advisory: true } : null,
      final: verdict.final,
      rule: verdict.rule,
      rulesVersion: QUALITY_RULES_VERSION,
    });
    if (verdict.final === "REJECT") {
      const code: RepresentationFailureCode = verdict.deterministic.hardCode ?? (verdict.rule.startsWith("R2") ? "EXEMPLAR_SEMANTIC_MISMATCH" : "REPRESENTATION_QUALITY_WEAK");
      const why = verdict.deterministic.hardCode
        ? (verdict.deterministic.reasons[0] ?? code).replace(/^[A-Z_]+: /u, "")
        : verdict.rule.startsWith("R2")
          ? `model judged it a semantic mismatch (advisory): ${semantic?.reason ?? ""}`.trim()
          : `weak Qloo evidence and weak model judgment: ${[...verdict.deterministic.reasons.filter((r) => /^(PEER_OUTLIER|CONCEPT_ABSENT)/u.test(r)), semantic?.reason ?? ""].filter(Boolean).join("; ")}`;
      rejected.push({ id, label, code, reason: why });
      continue;
    }
    const candidate = eligibleById.get(id)!;
    const choice: ExemplarChoice = {
      id,
      label,
      type: proposal.entityType,
      popularity: candidate.popularity,
      selectionReason: reason.trim().slice(0, 300) || "no reason given",
      conceptSupport: candidate.conceptSupport,
      supportCorrelationId: candidate.supportCorrelationId,
      quality: verdict.final,
      semantic: semantic ? { relevance: semantic.relevance, reason: semantic.reason } : null,
    };
    if (verdict.final === "VALID") valid.push(choice);
    else weak.push({ choice, reasons: verdict.deterministic.reasons.filter((r) => /^(PEER_OUTLIER|CONCEPT_ABSENT)/u.test(r)).concat(semantic?.relevance === "WEAK" ? [`model: ${semantic.reason}`] : []) });
  }

  if (valid.length === 0) {
    for (const w of weak) rejected.push({ id: w.choice.id, label: w.choice.label, code: "REPRESENTATION_QUALITY_WEAK", reason: `weak exemplar with no valid primary: ${w.reasons.join("; ") || "weak"}` });
    const codes = [...new Set(rejected.map((r) => r.code))];
    const code: RepresentationFailureCode = weak.length > 0 ? "REPRESENTATION_QUALITY_WEAK" : codes.length === 1 ? codes[0]! : "NO_VALID_REPRESENTATION";
    return { accepted: false, failure: { code, detail: weak.length > 0 ? "only weak exemplars survived; a weak panel is not forced through" : "no proposed exemplar passed validation" }, rejected, decisions };
  }
  const accepted = [...valid, ...weak.map((w) => w.choice)];
  const warnings = weak.map((w) => `weak alternate exemplar ${w.choice.label}: ${w.reasons.join("; ") || "weak"}`);
  return { accepted: true, representation: { entityType: proposal.entityType, exemplars: accepted, ...assessDiversity(state, accepted), warnings }, rejected, decisions };
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
  if (territory.conceptOnly) {
    const pool = state.pools.find((p) => p.conditionedOn === null && p.tagIds.includes(territory.concept!.id) && p.memberIds.length > 0);
    return { strategy: "CONDITIONED_ENTITY_EVIDENCE", entityType: pool?.targetType ?? "brand", rankable: false, minimumEvidence: ["brand-conditioned recommend filtered to the concept"], limitations: [`concept-level evidence chosen instead of an exemplar panel: ${territory.conceptOnly}`] };
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
