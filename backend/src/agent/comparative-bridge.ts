/**
 * SPRINT 9H/9I — COMPARATIVE CULTURAL ELASTICITY BRIDGE
 *
 * The deterministic bridge between a completed single-hypothesis investigation and a governed comparative run
 * of the existing agent runtime (compare_territories). Used by the comparative handoff routes in api/agent.ts.
 *
 *   collectReferenceCandidates   references the server can offer, built only from server-held evidence
 *   assessComparisonEligibility  the eligibility gate (identity, representation, provenance, type, duplicates)
 *   buildComparativeHandoffRequest   the typed compare_territories request for the existing runtime
 *   validateComparativeOutcome   checks the finished run against the plan the server authorized
 *   projectComparativeStrategicReport   the report answering the strategic questions (facts, numbers,
 *                                       interpretation and unknowns kept apart)
 *
 * Sprint 9I corrections: a reference type is never taken from the caller or copied from the target; it needs
 * server-held Qloo evidence (a validated representation, or an observed member of that type). Paid authorization
 * is not decided here: it is checked where the job is admitted and where each provider call is dispatched.
 */
import type {
  AgentAnalysisResult,
  AgentTerritoryResult,
  AnyBrandBaselineResult,
  ComparativeOutcome,
  ComparativeOutcomeCheck,
  ComparativeReferenceCandidate,
  ComparativeStrategicReport,
  ComparisonEligibility,
  ComparisonEligibilityCode,
} from "@cultural-elasticity/shared";
import { matchOperationalRule } from "../methodology/operational-tags.js";
import { agentRequestSchema, shortEntityType, type AgentRequest, type RankableType } from "./contracts.js";
import { MAX_PANEL_OPTIONS } from "../methodology/contracts.js";
import { MIN_COMPARISON_SET } from "./router.js";

export type BrandIdentity = { id: string; label: string; resolution?: string };

export type EligibilityOptions = {
  /** The authorized scan's canonical Qloo brand id. A different brand is refused. */
  expectedBrandId?: string;
  requirePaidAuthorization?: boolean;
  paidAuthorized?: boolean;
};

export { QueryAlreadyExecutedError } from "./query/service.js";

/** Distinct exemplars a representation needs before it can enter a comparison (substitution must be testable). */
export const MIN_DISTINCT_EXEMPLARS = 2;

const norm = (s: string) => s.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();

type Refusal = { code: ComparisonEligibilityCode; reason: string; missing: string };

/** Why a territory's validated representation cannot anchor a comparison, or null when it can. */
export function representationProblem(territory: AgentTerritoryResult): string | null {
  const representation = territory.representation;
  if (!representation || representation.failure) return `it has no validated representation${representation?.failure ? ` (${representation.failure.detail})` : ""}`;
  if (!shortEntityType(representation.entityType ?? undefined)) return `its representation type "${representation.entityType ?? "none"}" is not a Qloo rankable type`;
  const ids = representation.exemplars.map((e) => e.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) return "its representation repeats an exemplar entity";
  if (ids.length < MIN_DISTINCT_EXEMPLARS) return `its representation has ${ids.length} distinct exemplar entit${ids.length === 1 ? "y" : "ies"}; at least ${MIN_DISTINCT_EXEMPLARS} are needed to test exemplar substitution`;
  if (territory.analysisRoute === "INSUFFICIENT_EVIDENCE") return "its investigation found insufficient Qloo evidence";
  if (!territory.provenance.correlationIds.length) return "it has no source reference to a Qloo call";
  return null;
}

export function assessComparisonEligibility(
  brand: BrandIdentity | null | undefined,
  target: AgentTerritoryResult | null | undefined,
  references: readonly ComparativeReferenceCandidate[],
  options: EligibilityOptions = {},
): ComparisonEligibility {
  const candidateSet = [...(target ? [target.label] : []), ...references.map((r) => r.label)];
  const refuse = (refusal: Refusal, extra: Partial<ComparisonEligibility> = {}): ComparisonEligibility => ({
    eligible: false,
    code: refusal.code,
    reason: refusal.reason,
    candidateSet,
    missingRequirements: [refusal.missing],
    ...extra,
  });

  if (!brand?.id || !brand.label || brand.resolution !== "confirmed") {
    return refuse({ code: "BRAND_NOT_CONFIRMED", reason: "A confirmed canonical Qloo brand identity is required for a comparison.", missing: "canonical_brand_identity" });
  }
  if (options.expectedBrandId && brand.id !== options.expectedBrandId) {
    return refuse({ code: "BRAND_MISMATCH", reason: "The investigation belongs to a different Qloo brand than the authorized research scan.", missing: "same_brand_as_scan" });
  }
  if (!target) return refuse({ code: "INVALID_TARGET_REPRESENTATION", reason: "No investigated target territory was provided.", missing: "target_territory" });

  const targetType = shortEntityType(target.representation?.entityType ?? undefined);
  const targetSummary = {
    key: target.key,
    label: target.label,
    entityType: targetType ?? "unknown",
    ...(target.resolvedConcept?.id ? { conceptId: target.resolvedConcept.id } : {}),
    exemplarCount: target.representation?.exemplars.length ?? 0,
  };
  const targetProblem = representationProblem(target);
  if (targetProblem || !targetType) {
    return refuse({ code: "INVALID_TARGET_REPRESENTATION", reason: `"${target.label}" cannot anchor a comparison: ${targetProblem ?? "no rankable type"}.`, missing: "target_valid_representation" }, { target: targetSummary });
  }

  if (options.requirePaidAuthorization && !options.paidAuthorized) {
    return refuse({ code: "PAID_ADMISSION_PAUSED", reason: "A comparison needs new paid provider calls, which are paused.", missing: "paid_execution_authorization" }, { target: targetSummary });
  }

  const total = 1 + references.length;
  if (total < MIN_COMPARISON_SET) {
    return refuse({ code: "INSUFFICIENT_REFERENCES", reason: `A relative position needs at least ${MIN_COMPARISON_SET} territories including the target (found ${total}). Select ${MIN_COMPARISON_SET - total} more compatible reference${MIN_COMPARISON_SET - total === 1 ? "" : "s"}.`, missing: `need_${MIN_COMPARISON_SET - total}_more_references` }, { target: targetSummary });
  }
  if (total > MAX_PANEL_OPTIONS) {
    return refuse({ code: "TOO_MANY_TERRITORIES", reason: `One Qloo rank panel holds at most ${MAX_PANEL_OPTIONS} options (found ${total}). Remove ${total - MAX_PANEL_OPTIONS} reference(s).`, missing: `remove_${total - MAX_PANEL_OPTIONS}_territories` }, { target: targetSummary });
  }

  const labels = new Set<string>();
  for (const label of candidateSet.map(norm)) {
    if (labels.has(label)) return refuse({ code: "DUPLICATE_TERRITORIES", reason: `"${label}" appears twice. A comparison needs distinct territories.`, missing: "distinct_territory_labels" }, { target: targetSummary });
    labels.add(label);
  }
  const concepts = new Set<string>();
  for (const conceptId of [target.resolvedConcept?.id, ...references.map((r) => r.conceptId)].filter((id): id is string => Boolean(id))) {
    if (concepts.has(conceptId)) return refuse({ code: "DUPLICATE_TERRITORIES", reason: `Two territories anchor to the same Qloo concept (${conceptId}).`, missing: "distinct_concept_anchors" }, { target: targetSummary });
    concepts.add(conceptId);
  }

  const exemplarOwner = new Map(target.representation.exemplars.map((e) => [e.id, target.label]));
  const validatedReferences: NonNullable<ComparisonEligibility["validatedReferences"]> = [];
  for (const ref of references) {
    if (ref.blocked) return refuse({ code: ref.blocked.code, reason: `"${ref.label}": ${ref.blocked.reason} ${ref.blocked.action}`, missing: `reference_${ref.id}` }, { target: targetSummary });
    if (!ref.correlationIds.length || ref.sourceStatus === "degraded") {
      return refuse({ code: "REFERENCE_UNGROUNDED", reason: `"${ref.label}" has no complete Qloo source reference${ref.sourceStatus === "degraded" ? " (its source call was degraded)" : ""}.`, missing: `reference_${ref.id}_source` }, { target: targetSummary });
    }
    if (!ref.typeEvidence) {
      return refuse({ code: "REFERENCE_TYPE_UNVERIFIED", reason: `No Qloo evidence held by the server shows that "${ref.label}" has ${targetType} members. Investigate it first; a completed investigation becomes a selectable reference.`, missing: `reference_${ref.id}_type_evidence` }, { target: targetSummary });
    }
    const refType = shortEntityType(ref.typeEvidence.entityType);
    if (refType !== targetType) {
      return refuse({ code: "INCOMPATIBLE_ENTITY_TYPES", reason: `"${ref.label}" is represented by ${ref.typeEvidence.entityType} entities and "${target.label}" by ${targetType} entities. A relative position needs one entity type in one rank panel; read "${ref.label}" as qualitative cross-domain evidence instead.`, missing: "shared_entity_type" }, { target: targetSummary });
    }
    if (new Set(ref.exemplarIds).size !== ref.exemplarIds.length) {
      return refuse({ code: "DUPLICATE_EXEMPLARS", reason: `"${ref.label}" repeats an exemplar entity in its representation.`, missing: `reference_${ref.id}_distinct_exemplars` }, { target: targetSummary });
    }
    for (const id of ref.exemplarIds) {
      const owner = exemplarOwner.get(id);
      if (owner) return refuse({ code: "DUPLICATE_EXEMPLARS", reason: `The same Qloo entity represents both "${owner}" and "${ref.label}". Territories in one panel need their own exemplars.`, missing: "distinct_exemplars_across_territories" }, { target: targetSummary });
      exemplarOwner.set(id, ref.label);
    }
    validatedReferences.push({ key: ref.id, label: ref.label, entityType: refType, ...(ref.conceptId ? { conceptId: ref.conceptId } : {}), origin: "evidence", typeBasis: ref.typeEvidence.basis });
  }

  return {
    eligible: true,
    code: "ELIGIBLE",
    reason: `${total} territories with server-verified ${targetType} evidence can share one Qloo rank panel. The agent still re-validates every representation before ranking.`,
    candidateSet,
    missingRequirements: [],
    target: targetSummary,
    validatedReferences,
  };
}

/** One profile the parent investigation fetched for a target exemplar (server-held run state). */
export type ExemplarProfileEvidence = {
  subjectId: string;
  subjectType: string | null;
  tags: { id: string; label: string }[];
  correlationId: string;
  status: "ok" | "partial" | "degraded";
};

export type SiblingInvestigation = { jobId: string; result: AgentAnalysisResult };

const MAX_PROFILE_SUGGESTIONS = 6;

/**
 * Reference candidates from server-held evidence only:
 *   completed investigations of the same brand from the same scan (validated representation),
 *   tags Qloo returned in the target exemplars' own profiles (each exemplar is an observed member of its type),
 *   baseline directions (shown, but not selectable until investigated: no type evidence).
 * The target's type is never copied onto a candidate.
 */
export function collectReferenceCandidates(input: {
  brandId: string;
  target: AgentTerritoryResult;
  exemplarProfiles: readonly ExemplarProfileEvidence[];
  siblings: readonly SiblingInvestigation[];
  baseline: AnyBrandBaselineResult | null;
}): ComparativeReferenceCandidate[] {
  const { target } = input;
  const taken = new Set<string>([norm(target.label)]);
  const takenConcepts = new Set<string>(target.resolvedConcept ? [target.resolvedConcept.id] : []);
  const free = (label: string, conceptId: string | null) => !taken.has(norm(label)) && !(conceptId && takenConcepts.has(conceptId));
  const claim = (label: string, conceptId: string | null) => {
    taken.add(norm(label));
    if (conceptId) takenConcepts.add(conceptId);
  };
  const candidates: ComparativeReferenceCandidate[] = [];

  for (const sibling of input.siblings) {
    const run = sibling.result;
    if (run.status !== "COMPLETE" || run.brand?.id !== input.brandId) continue;
    for (const territory of run.territories.filter((t) => t.role === "target")) {
      const conceptId = territory.resolvedConcept?.id ?? null;
      if (!free(territory.label, conceptId)) continue;
      claim(territory.label, conceptId);
      const problem = representationProblem(territory);
      const type = shortEntityType(territory.representation.entityType ?? undefined);
      candidates.push({
        id: `investigation:${sibling.jobId}:${territory.key}`,
        label: territory.label,
        conceptId,
        source: "completed_investigation",
        typeEvidence: !problem && type ? { entityType: type, basis: "VALIDATED_REPRESENTATION", memberIds: territory.representation.exemplars.map((e) => e.id), correlationIds: territory.provenance.correlationIds } : null,
        exemplarIds: territory.representation.exemplars.map((e) => e.id),
        sourceStatus: limitationStatus(territory),
        correlationIds: territory.provenance.correlationIds,
        rationale: `Investigated earlier in this research session; its validated representation uses ${type ?? "no rankable"} entities.`,
        blocked: problem || !type ? { code: "REFERENCE_UNGROUNDED", reason: `Its investigation cannot anchor a comparison: ${problem ?? "no rankable type"}.`, action: "Choose another reference." } : null,
      });
    }
  }

  const byTag = new Map<string, { label: string; members: { id: string; type: RankableType }[]; correlationIds: Set<string>; statuses: Set<string> }>();
  const exemplarTypes = new Map(target.representation.exemplars.map((e) => [e.id, shortEntityType(e.type)]));
  for (const profile of input.exemplarProfiles) {
    const type = exemplarTypes.get(profile.subjectId) ?? shortEntityType(profile.subjectType ?? undefined);
    if (!type) continue;
    for (const tag of profile.tags) {
      if (matchOperationalRule({ id: tag.id }) || !free(tag.label, tag.id)) continue;
      const entry = byTag.get(tag.id) ?? { label: tag.label, members: [], correlationIds: new Set<string>(), statuses: new Set<string>() };
      if (!entry.members.some((m) => m.id === profile.subjectId)) entry.members.push({ id: profile.subjectId, type });
      entry.correlationIds.add(profile.correlationId);
      entry.statuses.add(profile.status);
      byTag.set(tag.id, entry);
    }
  }
  // Tags carried by more of the target's exemplars first; ties keep Qloo's first-seen order (Map order).
  const profileTags = [...byTag.entries()].sort(([, a], [, b]) => b.members.length - a.members.length).slice(0, MAX_PROFILE_SUGGESTIONS);
  for (const [tagId, entry] of profileTags) {
    if (!free(entry.label, tagId)) continue;
    claim(entry.label, tagId);
    const types = [...new Set(entry.members.map((m) => m.type))];
    candidates.push({
      id: `profile-tag:${tagId}`,
      label: entry.label,
      conceptId: tagId,
      source: "target_exemplar_profile",
      typeEvidence: types.length === 1 ? { entityType: types[0]!, basis: "OBSERVED_MEMBER", memberIds: entry.members.map((m) => m.id), correlationIds: [...entry.correlationIds] } : null,
      exemplarIds: [],
      sourceStatus: entry.statuses.has("degraded") ? "degraded" : entry.statuses.has("partial") ? "partial" : "ok",
      correlationIds: [...entry.correlationIds],
      rationale: `Qloo returned this tag in the profile of ${entry.members.length} of the ${target.label} exemplars, so ${types.join("/")} entities carry it. The comparison run must still find its own exemplars.`,
      blocked: types.length === 1 ? null : { code: "INCOMPATIBLE_ENTITY_TYPES", reason: "It was observed on entities of more than one type.", action: "Investigate it on its own first." },
    });
  }

  for (const direction of input.baseline?.territories ?? []) {
    if (!free(direction.name, direction.canonicalConcept)) continue;
    claim(direction.name, direction.canonicalConcept);
    candidates.push({
      id: `baseline:${direction.id}`,
      label: direction.name,
      conceptId: direction.canonicalConcept,
      source: "baseline_direction",
      typeEvidence: null,
      exemplarIds: [],
      sourceStatus: direction.supportingReferences.some((r) => r.sourceStatus === "degraded") ? "degraded" : direction.supportingReferences.some((r) => r.sourceStatus === "partial") ? "partial" : "ok",
      correlationIds: direction.supportingReferences.map((r) => r.correlationId),
      rationale: "A baseline research direction from this brand scan.",
      blocked: {
        code: "REFERENCE_TYPE_UNVERIFIED",
        reason: "The scan observed it as a tag only; no Qloo evidence yet shows which entity type represents it.",
        action: "Investigate this direction first; its completed investigation becomes a selectable reference.",
      },
    });
  }
  return candidates;
}

function limitationStatus(territory: AgentTerritoryResult): "ok" | "partial" | "degraded" {
  const codes = territory.limitations.map((l) => l.code);
  if (codes.some((c) => /DEGRADED/u.test(c))) return "degraded";
  if (codes.some((c) => /PARTIAL|TRUNCATED/u.test(c))) return "partial";
  return "ok";
}

export type ComparativeHandoffResult =
  | { ok: true; request: AgentRequest; eligibility: ComparisonEligibility }
  | { ok: false; code: ComparisonEligibilityCode; reason: string; eligibility: ComparisonEligibility };

/** Builds the compare_territories request for the existing runtime. Labels only: the runtime re-resolves everything. */
export function buildComparativeHandoffRequest(
  brand: BrandIdentity | null | undefined,
  target: AgentTerritoryResult | null | undefined,
  references: readonly ComparativeReferenceCandidate[],
  options: EligibilityOptions = {},
): ComparativeHandoffResult {
  const eligibility = assessComparisonEligibility(brand, target, references, options);
  if (!eligibility.eligible) return { ok: false, code: eligibility.code, reason: eligibility.reason, eligibility };
  const userQuery = `Compare the proposed cultural direction "${target!.label}" for ${brand!.label} with the reference territories ${references.map((r) => `"${r.label}"`).join(", ")}.`;
  const parsed = agentRequestSchema.safeParse({ userQuery, intent: "compare_territories", brand: brand!.label, territories: [target!.label, ...references.map((r) => r.label)] });
  if (!parsed.success) {
    return { ok: false, code: "COMPARISON_NOT_READY", reason: `The comparison request is invalid: ${parsed.error.issues.map((i) => i.message).join("; ")}`, eligibility };
  }
  return { ok: true, request: parsed.data, eligibility };
}

/** What the server authorized; the finished run is checked against it. */
export type ComparativePlan = {
  brandId: string;
  brandLabel: string;
  target: { label: string; conceptId: string | null; entityType: string; singleHypothesisOutcome?: string };
  references: { id: string; label: string; conceptId: string | null; entityType: string; typeBasis: string }[];
};

/** A territory holds a relative position only when the methodology produced a numeric position (not an empty panel). */
const isRanked = (t: AgentTerritoryResult) => typeof t.relativePosition?.position === "number";

export type ComparativeVerdict = { outcome: ComparativeOutcome; checks: (ComparativeOutcomeCheck & { blocking: boolean })[]; target: AgentTerritoryResult | null };

export function validateComparativeOutcome(plan: ComparativePlan, result: AgentAnalysisResult | null): ComparativeVerdict {
  if (!result || result.status === "FAILED") return { outcome: "NOT_COMPLETED", checks: [], target: null };
  const checks: ComparativeVerdict["checks"] = [];
  const check = (code: ComparativeOutcomeCheck["code"], passed: boolean, detail: string, blocking = true) => checks.push({ code, passed, detail, blocking });

  check("BRAND_MATCHES_SCAN", result.brand?.id === plan.brandId, result.brand?.id === plan.brandId ? `The run resolved ${plan.brandLabel} to the scan's Qloo brand.` : "The run resolved a different Qloo brand than the authorized scan.");
  const target = result.territories.find((t) => norm(t.label) === norm(plan.target.label)) ?? null;
  check("TARGET_PRESENT", Boolean(target), target ? `"${plan.target.label}" is in the result.` : `"${plan.target.label}" is missing from the result.`);

  const ranked = result.territories.filter(isRanked);
  const sets = new Set(ranked.map((t) => (t.comparisonSet?.territoryKeys ?? []).join("|")));
  const types = new Set(ranked.map((t) => shortEntityType(t.representation.entityType ?? undefined) ?? "unknown"));
  check("SINGLE_RANKING_TYPE", ranked.length === 0 || (sets.size === 1 && types.size === 1 && !types.has("unknown")), ranked.length === 0 ? "No territory was ranked." : sets.size === 1 && types.size === 1 ? `All ranked territories share one ${[...types][0]} panel.` : "Ranked territories do not share one comparison set and entity type.");
  const unrepresented = ranked.filter((t) => t.representation.exemplars.length === 0).map((t) => t.label);
  check("RANKED_TERRITORIES_REPRESENTED", unrepresented.length === 0, unrepresented.length ? `Ranked without exemplars: ${unrepresented.join(", ")}.` : "Every ranked territory has exemplar entities.");
  const unsourced = ranked.filter((t) => t.provenance.correlationIds.length === 0).map((t) => t.label);
  check("RANKED_TERRITORIES_SOURCED", unsourced.length === 0, unsourced.length ? `Ranked without a source reference: ${unsourced.join(", ")}.` : "Every ranked territory cites its Qloo calls.");
  // INSUFFICIENT_EVIDENCE is the methodology's own "no class"; every relative class needs a numeric position.
  const classedWithoutPosition = result.territories.filter((t) => t.classification && t.classification.label !== "INSUFFICIENT_EVIDENCE" && !isRanked(t)).map((t) => t.label);
  check("CLASSIFICATION_HAS_POSITION", classedWithoutPosition.length === 0, classedWithoutPosition.length ? `Classified without a position: ${classedWithoutPosition.join(", ")}.` : "Every classification rests on a relative position.");

  if (target && plan.target.conceptId) {
    const same = target.resolvedConcept?.id === plan.target.conceptId;
    check("CONCEPT_ANCHOR_MATCHES", same, same ? `"${plan.target.label}" kept its investigated Qloo concept.` : `The comparison anchored "${plan.target.label}" to ${target.resolvedConcept?.id ?? "no concept"}, not the investigated ${plan.target.conceptId}.`);
  }
  const drifted = plan.references.filter((ref) => {
    if (!ref.conceptId) return false;
    const found = result.territories.find((t) => norm(t.label) === norm(ref.label));
    return found?.resolvedConcept && found.resolvedConcept.id !== ref.conceptId;
  });
  if (drifted.length) check("CONCEPT_ANCHOR_MATCHES", false, `References anchored to a different Qloo concept than selected: ${drifted.map((r) => r.label).join(", ")}. Their positions describe the concept actually ranked.`, false);

  if (checks.some((c) => c.blocking && !c.passed)) return { outcome: "INTEGRITY_FAILED", checks, target };
  if (target && isRanked(target) && target.analysisRoute === "FULL_RELATIVE_ANALYSIS") return { outcome: "RELATIVE_POSITION_ESTABLISHED", checks, target };
  return { outcome: "NO_RELATIVE_POSITION", checks, target };
}

/**
 * Projects the strategic report from a comparative run and the server's verdict on it. An INTEGRITY_FAILED or
 * NOT_COMPLETED verdict shows no position or classification at all.
 */
export function projectComparativeStrategicReport(result: AgentAnalysisResult, plan: ComparativePlan, verdict: ComparativeVerdict): ComparativeStrategicReport {
  const trusted = verdict.outcome === "RELATIVE_POSITION_ESTABLISHED" || verdict.outcome === "NO_RELATIVE_POSITION";
  const target = verdict.target;
  const targetType = target ? shortEntityType(target.representation.entityType ?? undefined) ?? null : null;
  const candidateSet = (trusted && target?.comparisonSet?.labels) || [plan.target.label, ...plan.references.map((r) => r.label)];
  const position = (t: AgentTerritoryResult) => (trusted && isRanked(t) ? { position: t.relativePosition!.position, of: t.relativePosition!.of, medianPercentile: t.relativePosition!.medianPercentile } : null);

  const alternatives = result.territories.filter((t) => t !== target).map((t) => {
    const type = shortEntityType(t.representation.entityType ?? undefined) ?? null;
    let limitation: string | null = null;
    if (!position(t)) {
      if (type && targetType && type !== targetType) limitation = `Represented by ${type} entities while "${plan.target.label}" uses ${targetType} entities. A relative position needs one entity type in one rank panel, so it is qualitative evidence only.`;
      else if (t.analysisRoute === "INSUFFICIENT_EVIDENCE") limitation = "Qloo evidence was insufficient for this territory.";
      else limitation = t.limitations[0]?.detail ?? "Not part of a valid single-call rank panel.";
    }
    return {
      key: t.key,
      name: t.label,
      role: t.role === "reference" || t.role === "frontier_candidate" || t.role === "target" ? t.role : "reference",
      origin: t.origin === "user" ? ("user" as const) : ("evidence" as const),
      entityType: type,
      analysisRoute: t.analysisRoute,
      relativePosition: position(t),
      classification: trusted && t.classification && isRanked(t) ? { label: t.classification.label } : null,
      robustness: trusted && t.robustness ? { level: t.robustness.level } : null,
      comparisonLimitation: limitation,
    };
  });

  const established: string[] = [`${plan.brandLabel} is resolved to Qloo brand ${plan.brandId}.`];
  const unknown: string[] = [
    "Commercial success, revenue, purchase intent and audience demand are not measured by cultural association.",
    "No absolute cultural distance is implied; relative positions hold only within the evaluated candidate set.",
    "Partnerships or collaborations are not established by co-occurrence.",
  ];
  const implications: string[] = [];
  if (verdict.outcome === "INTEGRITY_FAILED") {
    unknown.push(`No ranking from this run is shown: ${verdict.checks.filter((c) => c.blocking && !c.passed).map((c) => c.detail).join(" ")}`);
  } else if (verdict.outcome === "NOT_COMPLETED") {
    unknown.push("The comparative run did not complete. That is not evidence against the territory.");
  } else if (target) {
    established.push(`"${target.label}" was represented by ${target.representation.exemplars.length} ${targetType ?? "unranked"} exemplar(s): ${target.representation.exemplars.map((e) => e.label).join(", ")}.`);
    established.push(...target.keyEvidence);
    if (isRanked(target) && verdict.outcome === "RELATIVE_POSITION_ESTABLISHED") {
      established.push(`Within [${candidateSet.join(", ")}], "${target.label}" holds position ${target.relativePosition!.position} of ${target.relativePosition!.of} in one Qloo rank call.`);
    } else {
      unknown.push(`"${target.label}" has no relative position: the run formed no valid single-call panel that includes it.`);
    }
    unknown.push(...target.limitations.map((l) => l.detail));
    if (target.classification && isRanked(target)) implications.push(`Provisional class ${target.classification.label} relative to [${candidateSet.join(", ")}]. ${target.classification.reasons.join(" ")}`);
  }
  for (const failed of verdict.checks.filter((c) => !c.blocking && !c.passed)) unknown.push(failed.detail);
  if (plan.target.singleHypothesisOutcome && !implications.length) implications.push(`The earlier single-direction investigation was ${plan.target.singleHypothesisOutcome}; this comparison adds no relative position to it.`);

  const robustness = trusted && target?.robustness ? { level: target.robustness.level, sensitivityDetail: target.robustness.reasons.join(" ") || "The position held across the tested exemplar panels." } : null;
  return {
    schemaVersion: "ce-comparative-report/0.2",
    outcome: verdict.outcome,
    checks: verdict.checks.map(({ code, passed, detail }) => ({ code, passed, detail })),
    brand: { id: plan.brandId, name: plan.brandLabel },
    targetTerritory: {
      key: target?.key ?? "",
      name: plan.target.label,
      ...(plan.target.singleHypothesisOutcome ? { singleHypothesisOutcome: plan.target.singleHypothesisOutcome } : {}),
      relativePosition: target ? position(target) : null,
      provisionalClassification: trusted && target?.classification && isRanked(target) ? { label: target.classification.label, statement: `Provisional class ${target.classification.label} relative to [${candidateSet.join(", ")}].` } : null,
      robustness,
      coherence: trusted && target?.coherence ? { band: target.coherence.filteredBand ?? "NONE", consistentlyShared: target.coherence.consistentlyShared } : null,
      evidenceQuality: trusted && target?.evidenceQuality ? { level: target.evidenceQuality.level, drivers: target.evidenceQuality.drivers } : null,
      candidateSet,
      entityType: targetType,
    },
    alternativesEvaluated: alternatives,
    whatEvidenceEstablishes: established,
    whatRemainsUnknown: unknown,
    strategicImplications: implications,
    nextResearchActions: result.followUpOptions.length ? result.followUpOptions : [`Inspect the exemplar entities representing ${plan.target.label} before any decision.`, "Rotate the reference territories to test whether the relative position holds."],
    interpretation: trusted && result.summary.claimValidation.passed ? { text: result.summary.text, validated: true } : null,
    evidenceOrigin: result.evidenceOrigin,
    provenance: {
      runId: result.runId,
      correlationIds: [...new Set(result.territories.flatMap((t) => t.provenance.correlationIds))],
      methodologyVersion: target?.comparisonSet?.methodologyVersion ?? result.methodologyRuns[0]?.result.methodologyVersion ?? "unavailable",
    },
  };
}
