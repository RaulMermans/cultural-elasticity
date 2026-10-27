/**
 * SPRINT 9H — COMPARATIVE CULTURAL ELASTICITY BRIDGE
 *
 * Provides the deterministic bridge between a single-hypothesis investigation
 * and the multi-territory comparative elasticity analysis.
 *
 * Enforces:
 *   - Comparison Eligibility Gate (canonical brand, valid target representation,
 *     at least 3 represented territories of compatible entity type, max 6,
 *     no duplicate concepts/exemplars, paid authorization check).
 *   - Trustworthy reference suggestions grounded in observed Qloo tags.
 *   - Distinction between user-selected and evidence-derived reference candidates.
 *   - Strategic report projection answering the 7 core strategic questions while
 *     strictly keeping facts, deterministic numbers, interpretations, and unknowns separate.
 */
import type {
  AgentAnalysisResult,
  AgentTerritoryResult,
  ComparativeStrategicReport,
  ComparisonEligibility,
  ComparisonEligibilityCode,
} from "@cultural-elasticity/shared";
import { matchOperationalRule } from "../methodology/operational-tags.js";
import { agentRequestSchema, type AgentRequest, type RankableType } from "./contracts.js";
import { MAX_PANEL_OPTIONS } from "../methodology/contracts.js";
import { MIN_COMPARISON_SET } from "./router.js";

export type ReferenceCandidateInput = {
  key?: string;
  label: string;
  entityType?: string;
  conceptId?: string;
  origin?: "user" | "evidence";
  exemplars?: { id: string; label: string }[];
};

export type EligibilityOptions = {
  requirePaidAuthorization?: boolean;
  paidAuthorized?: boolean;
};

export class QueryAlreadyExecutedError extends Error {
  constructor(readonly queryId: string) {
    super(`query ${queryId} was already executed`);
    this.name = "QueryAlreadyExecutedError";
  }
}

const norm = (s: string) => s.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();

/**
 * Validates whether a target territory from a single-hypothesis investigation
 * and a set of candidate reference territories meet the strict requirements
 * for comparative cultural elasticity analysis.
 */
export function assessComparisonEligibility(
  brand: { id: string; label: string; resolution?: string } | null | undefined,
  target: AgentTerritoryResult | null | undefined,
  references: readonly ReferenceCandidateInput[],
  options: EligibilityOptions = {},
): ComparisonEligibility {
  // 1. Canonical brand identity check
  if (!brand || !brand.id || !brand.label) {
    return {
      eligible: false,
      code: "BRAND_NOT_CONFIRMED",
      reason: "A canonical, confirmed brand identity is required for comparative analysis.",
      candidateSet: [],
      missingRequirements: ["canonical_brand_identity"],
    };
  }

  // 2. Target territory and valid representation check
  if (!target) {
    return {
      eligible: false,
      code: "INVALID_TARGET_REPRESENTATION",
      reason: "No target territory provided for comparative analysis.",
      candidateSet: [],
      missingRequirements: ["target_territory"],
    };
  }

  const targetEntityType = target.representation?.entityType as RankableType | undefined;
  const targetExemplars = target.representation?.exemplars ?? [];

  if (!target.representation || !targetEntityType || targetExemplars.length === 0) {
    return {
      eligible: false,
      code: "INVALID_TARGET_REPRESENTATION",
      reason: `Target territory "${target.label}" lacks a validated representation with at least one exemplar entity.`,
      candidateSet: [target.label],
      missingRequirements: ["target_valid_representation"],
      target: {
        key: target.key,
        label: target.label,
        entityType: targetEntityType ?? "unknown",
        conceptId: target.resolvedConcept?.id,
        exemplarCount: targetExemplars.length,
      },
    };
  }

  // 3. Paid authorization check
  if (options.requirePaidAuthorization && !options.paidAuthorized) {
    return {
      eligible: false,
      code: "PAID_ADMISSION_PAUSED",
      reason: "Comparative investigation requires paid provider dispatches, which are currently paused.",
      candidateSet: [target.label, ...references.map((r) => r.label)],
      missingRequirements: ["paid_execution_authorization"],
      target: {
        key: target.key,
        label: target.label,
        entityType: targetEntityType,
        conceptId: target.resolvedConcept?.id,
        exemplarCount: targetExemplars.length,
      },
    };
  }

  const totalCount = 1 + references.length;

  // 4. Cardinality bounds (MIN_COMPARISON_SET = 3, MAX_PANEL_OPTIONS = 6)
  if (totalCount < MIN_COMPARISON_SET) {
    return {
      eligible: false,
      code: "INSUFFICIENT_REFERENCES",
      reason: `Agent-side relative classification requires at least ${MIN_COMPARISON_SET} represented territories including the target (found ${totalCount}). Provide at least ${MIN_COMPARISON_SET - 1} compatible reference territories.`,
      candidateSet: [target.label, ...references.map((r) => r.label)],
      missingRequirements: [`need_${MIN_COMPARISON_SET - totalCount}_more_references`],
      target: {
        key: target.key,
        label: target.label,
        entityType: targetEntityType,
        conceptId: target.resolvedConcept?.id,
        exemplarCount: targetExemplars.length,
      },
    };
  }

  if (totalCount > MAX_PANEL_OPTIONS) {
    return {
      eligible: false,
      code: "TOO_MANY_TERRITORIES",
      reason: `A comparative panel supports at most ${MAX_PANEL_OPTIONS} candidates (found ${totalCount}). Remove ${totalCount - MAX_PANEL_OPTIONS} reference(s).`,
      candidateSet: [target.label, ...references.map((r) => r.label)],
      missingRequirements: [`remove_${totalCount - MAX_PANEL_OPTIONS}_territories`],
      target: {
        key: target.key,
        label: target.label,
        entityType: targetEntityType,
        conceptId: target.resolvedConcept?.id,
        exemplarCount: targetExemplars.length,
      },
    };
  }

  // 5. Duplicate territory labels check
  const allLabels = [target.label, ...references.map((r) => r.label)];
  const normalizedLabels = allLabels.map(norm);
  const seenLabels = new Set<string>();
  for (const label of normalizedLabels) {
    if (seenLabels.has(label)) {
      return {
        eligible: false,
        code: "DUPLICATE_TERRITORIES",
        reason: `Duplicate territory label detected: "${label}". Comparative analysis requires distinct territory names.`,
        candidateSet: allLabels,
        missingRequirements: ["distinct_territory_labels"],
      };
    }
    seenLabels.add(label);
  }

  // 6. Duplicate concept IDs check
  const allConcepts = [target.resolvedConcept?.id, ...references.map((r) => r.conceptId)].filter(Boolean);
  const seenConcepts = new Set<string>();
  for (const conceptId of allConcepts) {
    if (seenConcepts.has(conceptId!)) {
      return {
        eligible: false,
        code: "DUPLICATE_TERRITORIES",
        reason: `Duplicate Qloo concept anchor detected: "${conceptId}". Two territories cannot anchor to the same concept in a comparative set.`,
        candidateSet: allLabels,
        missingRequirements: ["distinct_concept_anchors"],
      };
    }
    seenConcepts.add(conceptId!);
  }

  // 7. Entity type compatibility check
  const validatedReferences: ComparisonEligibility["validatedReferences"] = [];
  for (const ref of references) {
    const refEntityType: string = ref.entityType ?? targetEntityType;
    if (refEntityType !== targetEntityType) {
      return {
        eligible: false,
        code: "INCOMPATIBLE_ENTITY_TYPES",
        reason: `Reference territory "${ref.label}" uses entity type "${refEntityType}", which is incompatible with target entity type "${targetEntityType}". Comparative ranking requires all territories to share one ranking entity type.`,
        candidateSet: allLabels,
        missingRequirements: ["shared_entity_type"],
        target: {
          key: target.key,
          label: target.label,
          entityType: targetEntityType,
          conceptId: target.resolvedConcept?.id,
          exemplarCount: targetExemplars.length,
        },
      };
    }

    validatedReferences.push({
      key: ref.key ?? norm(ref.label).replace(/\s+/gu, "_"),
      label: ref.label,
      entityType: refEntityType,
      conceptId: ref.conceptId,
      origin: ref.origin ?? "user",
    });
  }

  // All checks pass
  return {
    eligible: true,
    code: "ELIGIBLE",
    reason: `Comparison set of ${totalCount} territories with shared entity type "${targetEntityType}" is eligible for comparative cultural elasticity analysis.`,
    candidateSet: allLabels,
    missingRequirements: [],
    target: {
      key: target.key,
      label: target.label,
      entityType: targetEntityType,
      conceptId: target.resolvedConcept?.id,
      exemplarCount: targetExemplars.length,
    },
    validatedReferences,
  };
}

export type ReferenceSuggestion = {
  key: string;
  label: string;
  entityType: string;
  conceptId?: string;
  origin: "evidence";
  rationale: string;
};

/**
 * Suggests trustworthy reference territories derived from observed Qloo evidence
 * (target exemplar profiles, brand baseline directions, and concept pools).
 */
export function suggestReferenceTerritories(options: {
  targetEntityType: string;
  targetKey: string;
  targetLabel: string;
  targetConceptId?: string;
  brandTags?: { id: string; label: string }[];
  exemplarTags?: { id: string; label: string }[];
  baselineDirections?: { name: string; conceptId?: string; categoryLabel?: string }[];
}): ReferenceSuggestion[] {
  const suggestions: ReferenceSuggestion[] = [];
  const seenConcepts = new Set<string>();
  const seenLabels = new Set<string>();

  if (options.targetConceptId) seenConcepts.add(options.targetConceptId);
  seenLabels.add(norm(options.targetLabel));

  // 1. Check baseline directions sharing target domain/entity type
  for (const dir of options.baselineDirections ?? []) {
    const nLabel = norm(dir.name);
    if (seenLabels.has(nLabel)) continue;
    if (dir.conceptId && seenConcepts.has(dir.conceptId)) continue;

    seenLabels.add(nLabel);
    if (dir.conceptId) seenConcepts.add(dir.conceptId);

    suggestions.push({
      key: nLabel.replace(/\s+/gu, "_"),
      label: dir.name,
      entityType: options.targetEntityType,
      conceptId: dir.conceptId,
      origin: "evidence",
      rationale: `Baseline research direction from the same brand scan (${dir.categoryLabel ?? "observed cultural category"}).`,
    });
    if (suggestions.length >= 4) break;
  }

  // 2. Check tags from exemplar profiles (neighboring culture)
  for (const tag of options.exemplarTags ?? []) {
    if (matchOperationalRule({ id: tag.id })) continue;
    const nLabel = norm(tag.label);
    if (seenLabels.has(nLabel) || seenConcepts.has(tag.id)) continue;

    seenLabels.add(nLabel);
    seenConcepts.add(tag.id);

    suggestions.push({
      key: nLabel.replace(/\s+/gu, "_"),
      label: tag.label,
      entityType: options.targetEntityType,
      conceptId: tag.id,
      origin: "evidence",
      rationale: `Cultural tag observed in the target territory's exemplar profiles.`,
    });
    if (suggestions.length >= 5) break;
  }

  return suggestions;
}

export type ComparativeHandoffResult =
  | { ok: true; request: AgentRequest; eligibility: ComparisonEligibility }
  | { ok: false; code: ComparisonEligibilityCode; reason: string; eligibility: ComparisonEligibility };

/**
 * Builds the typed AgentRequest for comparative analysis from an existing target result
 * and selected references.
 */
export function buildComparativeHandoffRequest(
  brand: { id: string; label: string; resolution?: string } | null | undefined,
  target: AgentTerritoryResult | null | undefined,
  references: readonly ReferenceCandidateInput[],
  options: EligibilityOptions = {},
): ComparativeHandoffResult {
  const eligibility = assessComparisonEligibility(brand, target, references, options);
  if (!eligibility.eligible) {
    return { ok: false, code: eligibility.code, reason: eligibility.reason, eligibility };
  }

  const territoryNames = [target!.label, ...references.map((r) => r.label)];
  const userQuery = `Compare proposed brand expansion "${target!.label}" relative to alternative territories [${references.map((r) => `"${r.label}"`).join(", ")}] for brand "${brand!.label}".`;

  const parsed = agentRequestSchema.safeParse({
    userQuery,
    intent: "compare_territories",
    brand: brand!.label,
    territories: territoryNames,
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: "COMPARISON_NOT_READY",
      reason: `Failed to construct valid agent request: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      eligibility,
    };
  }

  return {
    ok: true,
    request: parsed.data as AgentRequest,
    eligibility,
  };
}

/**
 * Deterministically projects a ComparativeStrategicReport from a comparative run result
 * and optional single-hypothesis prior result, answering all seven strategic research questions.
 */
export function projectComparativeStrategicReport(
  comparativeResult: AgentAnalysisResult,
  targetKey: string,
  singleHypothesisOutcome?: string,
): ComparativeStrategicReport {
  const brand = comparativeResult.brand ?? { id: "unknown", label: "Unknown Brand" };
  const target = comparativeResult.territories.find((t) => t.key === targetKey || norm(t.label) === norm(targetKey)) ?? comparativeResult.territories[0]!;
  const alternatives = comparativeResult.territories.filter((t) => t.key !== target.key);

  const candidateSet = target.comparisonSet?.labels ?? comparativeResult.territories.map((t) => t.label);

  // Question 1: What cultural signals define the observed brand profile?
  const brandSignals = comparativeResult.layers?.qlooEvidence?.brand
    ? "Verified brand profile tags from Qloo entity catalog."
    : "Observed brand identity anchored in Qloo cultural knowledge graph.";

  // Question 2: What evidence supports the proposed expansion territory?
  const whatEvidenceEstablishes: string[] = [
    `Brand Grounding: ${brand.label} is resolved to Qloo entity ${brand.id}. ${brandSignals}`,
    `Expansion Target: "${target.label}" evaluated with ${target.representation.exemplars.length} exemplar(s) (${target.representation.exemplars.map((e) => e.label).join(", ")}).`,
    ...(target.keyEvidence ?? []),
  ];

  // Question 3 & 4: Alternatives evaluated and relative positioning
  const alternativesEvaluated: ComparativeStrategicReport["alternativesEvaluated"] = alternatives.map((alt) => ({
    key: alt.key,
    name: alt.label,
    role: alt.role as "reference" | "frontier_candidate",
    origin: alt.origin === "user" ? "user" : "evidence",
    relativePosition: alt.relativePosition
      ? {
          position: alt.relativePosition.position,
          of: alt.relativePosition.of,
          medianPercentile: alt.relativePosition.medianPercentile,
        }
      : null,
    classification: alt.classification ? { label: alt.classification.label } : null,
    robustness: alt.robustness ? { level: alt.robustness.level } : null,
  }));

  // Relative comparison finding
  if (target.relativePosition) {
    whatEvidenceEstablishes.push(
      `Relative Position: "${target.label}" sits at rank position ${target.relativePosition.position} of ${target.relativePosition.of} among candidates [${candidateSet.join(", ")}].`,
    );
  } else {
    whatEvidenceEstablishes.push(
      `Relative Position: Unavailable for "${target.label}". The comparison set did not yield a valid single-call ranking panel.`,
    );
  }

  // Question 5: Sensitivity to exemplar selection
  let sensitivityDetail = "No alternate exemplars panelled to test substitution sensitivity.";
  if (target.robustness) {
    sensitivityDetail = `Robustness is ${target.robustness.level}. ${target.robustness.reasons.join(" ") || "Rank position held under tested exemplar panels."}`;
  }

  // Question 6: What does the evidence establish, and what remains unknown?
  const whatRemainsUnknown: string[] = [
    "Commercial success, revenue potential, consumer purchase intent, and audience demand are not measured by cultural association.",
    "No absolute cultural distance number or universal graph separation is implied; relative positions hold strictly within the evaluated candidate set.",
    "Hypothetical business partnerships or operational collaborations are not established facts.",
    ...target.limitations.map((l) => l.detail),
  ];

  // Question 7: Strategic implications and next research actions
  const strategicImplications: string[] = [];
  if (target.classification) {
    strategicImplications.push(
      `Provisional Class: "${target.classification.label}" relative to [${candidateSet.join(", ")}]. ${target.classification.reasons.join(" ")}`,
    );
  } else if (singleHypothesisOutcome) {
    strategicImplications.push(
      `Single Hypothesis Baseline: Evaluated as ${singleHypothesisOutcome}. Comparative ranking adds relative reference context.`,
    );
  }

  const nextResearchActions = comparativeResult.followUpOptions.length
    ? comparativeResult.followUpOptions
    : [
        `Review the specific exemplar entities representing ${target.label} before making strategic commitments.`,
        `Expand or rotate reference territories to test whether relative positioning remains stable across alternative domains.`,
      ];

  const correlationIds = [
    ...new Set(comparativeResult.territories.flatMap((t) => t.provenance.correlationIds)),
  ];

  return {
    schemaVersion: "ce-comparative-report/0.1",
    brand: { id: brand.id, name: brand.label },
    targetTerritory: {
      key: target.key,
      name: target.label,
      singleHypothesisOutcome,
      relativePosition: target.relativePosition
        ? {
            position: target.relativePosition.position,
            of: target.relativePosition.of,
            medianPercentile: target.relativePosition.medianPercentile,
          }
        : null,
      provisionalClassification: target.classification
        ? {
            label: target.classification.label,
            statement: `Provisional class "${target.classification.label}" relative to comparison set [${candidateSet.join(", ")}].`,
          }
        : null,
      robustness: target.robustness
        ? {
            level: target.robustness.level,
            sensitivityDetail,
          }
        : null,
      coherence: target.coherence
        ? {
            band: target.coherence.filteredBand ?? "NONE",
            consistentlyShared: target.coherence.consistentlyShared ?? [],
          }
        : null,
      evidenceQuality: target.evidenceQuality
        ? {
            level: target.evidenceQuality.level,
            drivers: target.evidenceQuality.drivers,
          }
        : null,
      candidateSet,
    },
    alternativesEvaluated,
    whatEvidenceEstablishes,
    whatRemainsUnknown,
    strategicImplications,
    nextResearchActions,
    evidenceOrigin: comparativeResult.evidenceOrigin,
    provenance: {
      correlationIds,
      methodologyVersion: target.comparisonSet?.methodologyVersion ?? "ce-methodology/0.1",
    },
  };
}
