/**
 * Deterministic evaluators for a baseline projection. Evaluation code only: production never imports this.
 * Integrity and usefulness are separate verdicts. A result can be honest and still not useful.
 */
import type { BrandBaselineResult } from "@cultural-elasticity/shared";
import { matchOperationalRule, tagNamespace } from "../../src/methodology/operational-tags.js";
import { normalizedName, type BaselineObservation } from "../../src/brand-baseline/research.js";
import { brandBaselineResultSchema } from "../../src/brand-baseline/schema.js";
import type { CulturalSignal } from "../../src/contracts/qloo.js";

export type Check = { id: string; pass: boolean; detail: string };

function observed(observations: BaselineObservation[]) {
  const byKey = new Map<string, { signal: CulturalSignal; observation: BaselineObservation }>();
  for (const observation of observations) {
    if (observation.outcome.kind !== "ok") continue;
    const data = observation.outcome.data as { tags?: CulturalSignal[]; entities?: CulturalSignal[] };
    for (const signal of data.tags ?? data.entities ?? []) byKey.set(`${observation.outcome.provenance.correlationId}\0${signal.qlooId}`, { signal, observation });
  }
  return byKey;
}

// Operation names are snake_case (entity_tags), so the snake_case pattern covers them; "describe" and "recommend" are ordinary English.
const USER_FACING_FORBIDDEN = /urn:|[Cc]orrelation|mcp-|[a-z]+_[a-z]+|[{}]|[A-Z]{3,}_[A-Z]{2,}|\b[Jj][Ss][Oo][Nn]\b|\b[Ss]chema\b|\b[Ee]ntity type\b/u;

export function userFacingText(result: BrandBaselineResult): string[] {
  return [
    ...result.fingerprint.limitations, ...result.discovery.reasons, ...result.discovery.nextSteps,
    ...result.fingerprint.themes.map((theme) => theme.label),
    ...result.territories.flatMap((item) => [item.explanation, item.nextInvestigation, ...item.limitations]),
  ];
}

export function integrityChecks(result: BrandBaselineResult, observations: BaselineObservation[], expected: { brandQlooId: string; describeCorrelationId: string }): Check[] {
  const evidence = observed(observations);
  const refKey = (ref: { correlationId: string; sourceId: string }) => `${ref.correlationId}\0${ref.sourceId}`;
  const signals = result.fingerprint.signals;
  const tags = signals.filter((signal) => signal.kind === "tag");
  const entities = signals.filter((signal) => signal.kind === "entity");
  const checks: Check[] = [];
  const add = (id: string, pass: boolean, detail: string) => checks.push({ id, pass, detail });

  const parsed = brandBaselineResultSchema.safeParse(result);
  add("schema_valid", parsed.success, parsed.success ? "0.2 schema" : parsed.error.issues.map((issue) => issue.path.join(".")).join(", "));
  add("brand_identity", result.brand.qlooId === expected.brandQlooId && result.brand.source.operation === "describe" && result.brand.source.correlationId === expected.describeCorrelationId && result.brand.source.sourceId === expected.brandQlooId, `${result.brand.name} ${result.brand.qlooId}`);

  const refs = [...signals.map((signal) => signal.source), ...result.fingerprint.excluded.map((item) => item.source), ...result.territories.flatMap((item) => item.supportingReferences)];
  const orphan = refs.filter((ref) => !evidence.has(refKey(ref)));
  add("provenance_integrity", orphan.length === 0 && signals.every((signal) => signal.id === signal.source.sourceId), `${refs.length} references, ${orphan.length} without a recorded observation`);

  const names = [...signals, ...result.fingerprint.excluded].filter((item) => evidence.get(refKey(item.source))?.signal.label !== item.name);
  const hypothesisNames = result.territories.filter((item) => !tags.some((tag) => tag.id === item.canonicalConcept && tag.name === item.name));
  add("zero_fabricated_claims", names.length === 0 && hypothesisNames.length === 0 && !/score|probabilit|percent|elasticity|"affinity"|"popularity"/iu.test(JSON.stringify(result)), `${names.length} renamed items, ${hypothesisNames.length} hypotheses without a retained tag`);

  const typeErrors = entities.filter((entity) => {
    const source = evidence.get(refKey(entity.source));
    const grounding = entity.grounding;
    if (!source || !grounding) return true;
    const specific = [source.signal.type, source.signal.subtype].filter((value) => value && value !== "urn:entity");
    if (grounding.typeEvidence === "PROVIDER_CONFIRMED_TYPE") return !specific.some((value) => value === grounding.requestedType || value === entity.domain || value?.startsWith(`${grounding.requestedType}:`));
    if (grounding.typeEvidence === "QUERY_SCOPED") return specific.length > 0 || grounding.scopeBasis === null;
    if (grounding.typeEvidence === "GENERIC_TYPE_UNRESOLVED") return specific.length > 0 || grounding.scopeBasis !== null;
    return true;
  });
  add("type_grounding", typeErrors.length === 0, `${entities.length} retained entities, ${typeErrors.length} with a type claim the evidence does not support`);

  const scopeErrors = entities.filter((entity) => {
    const grounding = entity.grounding!;
    const observation = evidence.get(refKey(entity.source))?.observation;
    if (grounding.requestedType !== `urn:entity:${entity.domain}`) return true;
    if (grounding.scopeBasis === "RECORDED_PROVIDER_REQUEST") {
      const recorded = observation?.recordedRequestType ?? (observation?.outcome.provenance.requests ?? []).map((request) => (request.query as Record<string, unknown>)["filter.type"]).find((value) => typeof value === "string");
      return recorded !== grounding.requestedType;
    }
    if (grounding.scopeBasis === "BASELINE_TEMPLATE_STAGE") return observation?.scopeFromTemplateStage !== true;
    return false;
  });
  add("query_scope_accuracy", scopeErrors.length === 0, `${scopeErrors.length} entities with an unverifiable scope basis`);

  const operationalKept = tags.filter((tag) => matchOperationalRule({ id: tag.id, category: undefined }));
  const operationalReturned = [...evidence.values()].filter(({ signal, observation }) => observation.domain === "tags" && matchOperationalRule({ id: signal.qlooId, category: undefined }));
  const operationalAccounted = operationalReturned.filter(({ signal }) => result.fingerprint.excluded.some((item) => item.id === signal.qlooId) || !signals.some((kept) => kept.id === signal.qlooId));
  add("cultural_vs_operational", operationalKept.length === 0 && operationalAccounted.length === operationalReturned.length, `${operationalReturned.length} operational tags returned, ${operationalKept.length} kept as cultural`);

  const keys = signals.map((signal) => refKey(signal.source));
  const duplicateHypothesis = result.territories.filter((item) => tags.find((tag) => tag.id === item.canonicalConcept)?.possibleDuplicateOf);
  const falseMulti = result.territories.filter((item) => item.evidenceStatus === "MULTI_SIGNAL_SUPPORT" && new Set(item.supportingReferences.map((ref) => ref.correlationId)).size < 2);
  add("duplicate_handling", new Set(keys).size === keys.length && duplicateHypothesis.length === 0 && falseMulti.length === 0 && new Set(result.territories.map((item) => item.canonicalConcept)).size === result.territories.length, `${keys.length - new Set(keys).size} repeated references, ${falseMulti.length} unsupported multi-signal claims`);

  const badThemes = result.fingerprint.themes.filter((theme) => {
    const members = theme.memberIds.map((id) => tags.find((tag) => tag.id === id));
    return members.some((member) => !member || member.facet !== theme.facet || `${tagNamespace({ id: member.id, category: undefined })?.namespace}:${tagNamespace({ id: member.id, category: undefined })?.source}` !== theme.facet) || new Set(members.map((member) => normalizedName(member?.name ?? ""))).size < 2;
  });
  add("grouping_rule_validity", badThemes.length === 0, `${result.fingerprint.themes.length} themes, ${badThemes.length} invalid`);

  const badHypotheses = result.territories.filter((item) => {
    const tag = tags.find((candidate) => candidate.id === item.canonicalConcept);
    return !tag || tag.role !== "AUDIENCE_TASTE" || item.supportingReferences.some((ref) => ref.operation !== "entity_tags") || !item.explanation.includes(item.name);
  });
  add("territory_evidence_sufficiency", badHypotheses.length === 0 && result.territories.length <= 5, `${result.territories.length} hypotheses, ${badHypotheses.length} without sufficient tag evidence`);

  // Numbers are only within-call ranks and counts. No cross-call value may appear.
  add("zero_cross_call_comparisons", !JSON.stringify(result).match(/"(affinity|popularity|average|mean|weight)"/u), "no affinity or popularity values are carried into the result");
  return checks;
}

export type UsefulnessCriterion = { id: string; question: string; pass: boolean; detail: string };

/** The deterministic half of the product usefulness gate. The human-review half is recorded separately. */
export function usefulnessChecks(result: BrandBaselineResult): { verdict: "PASS" | "INSUFFICIENT"; criteria: UsefulnessCriterion[] } {
  const tasteTags = result.fingerprint.signals.filter((signal) => signal.role === "AUDIENCE_TASTE");
  const text = userFacingText(result);
  const jargon = text.filter((line) => USER_FACING_FORBIDDEN.test(line));
  const criteria: UsefulnessCriterion[] = [
    { id: "observed", question: "What did Qloo actually observe?", pass: result.fingerprint.signals.length > 0, detail: `${result.audit.culturalTags} cultural tags, ${result.audit.retainedAssociations} related entities` },
    { id: "meaningful", question: "Which cultural connections are meaningful enough to show?", pass: result.territories.length > 0 || (tasteTags.length > 0 && result.fingerprint.themes.length > 0), detail: `${result.territories.length} hypotheses, ${tasteTags.length} audience-taste tags, ${result.fingerprint.themes.length} themes` },
    { id: "why", question: "Why did the system include them?", pass: result.territories.every((item) => item.explanation.includes(item.name)) && (result.territories.length > 0 || result.discovery.reasons.length > 0), detail: "explanations or zero-hypothesis reasons present" },
    { id: "evidence", question: "What evidence supports each connection?", pass: result.territories.every((item) => item.supportingReferences.length > 0), detail: "every hypothesis cites a Qloo call" },
    { id: "limitations", question: "What limitations prevent stronger claims?", pass: result.scanStatus === "COMPLETE" || result.fingerprint.limitations.length > 0, detail: `${result.fingerprint.limitations.length} limitations` },
    { id: "next", question: "Which next research action is justified?", pass: result.discovery.nextSteps.length > 0 && result.territories.every((item) => item.nextInvestigation.length > 0), detail: `${result.discovery.nextSteps.length} next steps` },
    { id: "plain_language", question: "Can a non-technical user understand it?", pass: jargon.length === 0, detail: jargon.length ? `technical terms in: ${jargon.slice(0, 2).join(" | ")}` : `${text.length} user-facing statements checked` },
  ];
  return { verdict: criteria.every((criterion) => criterion.pass) ? "PASS" : "INSUFFICIENT", criteria };
}
