/** A bounded qualitative projection of one completed target. This adds no provider evidence or score. */
import type { AgentAnalysisResult, AgentTerritoryResult } from "@cultural-elasticity/shared";
import type { AgentRunState } from "./state.js";

type Assessment = NonNullable<AgentAnalysisResult["hypothesisAssessment"]>;

export function assessSingleHypothesis(state: AgentRunState, target: AgentTerritoryResult | undefined): Assessment {
  const brand = state.brand.entity;
  const concept = target?.resolvedConcept;
  const question = state.request.userQuery;
  const relevant = target && brand && concept
    ? state.pools.filter((pool) => pool.conditionedOn === brand.id && pool.tagIds.length === 1 && pool.tagIds[0] === concept.id)
    : [];
  const eligible = relevant.filter((pool) => ["ok", "empty"].includes(pool.call.envelope.status));
  const observed = eligible.find((pool) => pool.call.envelope.execution.correlation_id === target?.conditionedEvidence?.correlationId);
  const members = [...new Set(observed?.memberIds ?? [])];
  const correlationId = observed?.call.envelope.execution.correlation_id;
  const sourceIsEligible = Boolean(correlationId && target?.conditionedEvidence?.correlationId === correlationId && target.provenance.correlationIds.includes(correlationId));
  const allRelevantQueriesCleanEmpty = relevant.length > 0 && relevant.every((pool) => ["ok", "empty"].includes(pool.call.envelope.status) && pool.memberIds.length === 0);
  const shared = target?.coherence?.consistentlyShared ?? [];
  const brandProfile = brand ? state.profiles.get(brand.id) : undefined;
  const inBrandProfile = Boolean(concept && brandProfile?.tagIds.includes(concept.id));
  const conceptSearches = state.trace.toolCalls.filter((tool) => tool.tool === "qloo_find_tags" && tool.status !== "rejected" && (tool.arguments as { query?: unknown })?.query === target?.label);
  const cleanEmptyConceptSearch = conceptSearches.length > 0 && conceptSearches.every((tool) => tool.status === "empty" && tool.correlationIds.length > 0);
  const observedLines = sourceIsEligible && observed
    ? [members.length ? `Qloo returned ${members.length} distinct ${observed.targetType} entities in the brand-conditioned ${concept!.label} query.` : `Qloo returned no entities in the brand-conditioned ${concept!.label} query.`]
    : [];
  const supporting = state.status === "COMPLETE" && !inBrandProfile && sourceIsEligible && members.length > 0 && target?.representation.exemplars.length && shared.length > 0
    ? [`A source-linked brand-conditioned query returned members. Separately, the validated concept representation shares ${shared.map((item) => item.label).join(", ")} with the brand profile.`]
    : [];
  // Sprint 11: evidence about a related but different concept is never a verdict on the concept the user asked about.
  const alignment = target?.conceptAlignment;
  const substituted = alignment?.relation === "RELATED_DIFFERENT";
  let outcome: Assessment["outcome"] = "INCONCLUSIVE";
  if (state.status !== "COMPLETE" || !brand) outcome = "UNABLE_TO_COMPLETE_RESEARCH";
  else if (!concept && cleanEmptyConceptSearch) outcome = "NOT_SUPPORTED_BY_CURRENT_EVIDENCE";
  else if (sourceIsEligible && allRelevantQueriesCleanEmpty) outcome = "NOT_SUPPORTED_BY_CURRENT_EVIDENCE";
  else if (supporting.length > 0 && !inBrandProfile && !substituted) outcome = "WORTH_FURTHER_INVESTIGATION";
  const limitations = [
    ...(alignment && alignment.relation !== "EQUIVALENT" ? [`The investigated Qloo concept "${alignment.qlooConcept.label}" is not the same as "${alignment.userConcept}" (${alignment.relation.toLowerCase().replaceAll("_", " ")}): ${alignment.reason}`] : []),
    ...(inBrandProfile ? [`${concept!.label} already appears in the observed brand profile; this does not establish a new direction.`] : []),
    ...(!sourceIsEligible ? ["A completed, source-linked brand-conditioned query for this concept is unavailable."] : []),
    ...(members.length > 0 && shared.length === 0 ? ["The observed relationship lacks a verified shared cultural signal in the available profiles."] : []),
    ...(target?.limitations ?? []).filter((item) => /QLOO_|CONDITIONED_|NOT_COLLECTED|TERRITORY_UNRESOLVED/u.test(item.code)).map((item) => item.detail),
  ];
  return {
    version: "single-hypothesis/v1",
    outcome,
    question,
    observed: observedLines,
    supports: supporting,
    limitations: [...new Set(limitations)],
    unknowns: ["Cultural association does not establish demand, purchase intent, commercial viability, or partnership feasibility."],
    nextStep: outcome === "WORTH_FURTHER_INVESTIGATION"
      ? `Review the returned ${observed!.targetType} entities and test whether the association is meaningful for the proposed ${concept!.label} direction.`
      : concept ? `Refine the ${concept.label} question or identify an alternative Qloo-resolvable concept before drawing a strategic conclusion.` : "Specify a Qloo-resolvable cultural concept and investigate it as a new hypothesis.",
    correlationIds: sourceIsEligible && correlationId ? [correlationId, ...target!.provenance.correlationIds.filter((id) => id !== correlationId)] : [],
  };
}
