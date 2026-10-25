import { z } from "zod";

const evidenceRef = z.strictObject({
  operation: z.enum(["describe", "entity_tags", "recommend"]),
  correlationId: z.string().min(1).max(200),
  sourceId: z.string().min(1).max(300),
  capturedAt: z.iso.datetime(),
  sourceStatus: z.enum(["ok", "partial", "degraded"]),
  scope: z.string().min(1).max(80),
});
const scanStatus = z.enum(["CREATED", "QUEUED", "RUNNING", "COMPLETE", "PARTIAL", "NEEDS_BRAND_CONFIRMATION", "INSUFFICIENT_EVIDENCE", "FAILED", "INTERRUPTED", "CANCELLED"]);
const brand = z.strictObject({ id: z.uuid(), qlooId: z.string().min(1), name: z.string().min(1), resolutionStatus: z.literal("RESOLVED"), source: evidenceRef });
const coverage = z.strictObject({ domain: z.string(), status: z.enum(["OBSERVED", "EMPTY", "PARTIAL", "DEGRADED", "UNAVAILABLE"]), entityCount: z.number().int().nonnegative() });
const execution = {
  startedAt: z.iso.datetime(), finishedAt: z.iso.datetime(), providerCallCount: z.number().int().min(0).max(7),
  completedStages: z.array(z.string()), incompleteStages: z.array(z.string()),
  recordedOrLive: z.enum(["recorded", "live"]), budgetStatus: z.enum(["WITHIN_LIMIT", "EXHAUSTED", "UNCERTAIN"]),
  cacheSourceScanId: z.uuid().optional(),
};
const legacySignal = z.strictObject({ id: z.string().min(1), name: z.string(), kind: z.enum(["tag", "entity"]), domain: z.string(), source: evidenceRef, rankWithinCall: z.number().int().positive() });

/** Sprint 9B as-run contract. Frozen: stored 0.1 artifacts must keep parsing exactly as they were written. */
export const legacyBrandBaselineResultSchema = z.strictObject({
  schemaVersion: z.literal("ce-brand-baseline/0.1"),
  scanId: z.uuid(),
  scanStatus,
  brand,
  fingerprint: z.strictObject({
    signals: z.array(legacySignal).max(100),
    domainCoverage: z.array(coverage).max(8),
    provenance: z.array(evidenceRef).max(100),
    limitations: z.array(z.string().max(400)).max(30),
  }),
  territories: z.array(z.strictObject({
    id: z.string().min(1), name: z.string(), canonicalConcept: z.string().min(1),
    evidenceStatus: z.enum(["OBSERVED_ASSOCIATION", "PARTIAL_EVIDENCE"]),
    discoveryBasis: z.string().min(1), supportingReferences: z.array(evidenceRef).min(1),
    limitations: z.array(z.string()), availableActions: z.tuple([z.literal("inspect_evidence")]),
  })).max(5),
  execution: z.strictObject({ templateVersion: z.literal("ce-brand-baseline/v1"), ...execution }),
});

const typeEvidence = z.enum(["PROVIDER_CONFIRMED_TYPE", "QUERY_SCOPED", "GENERIC_TYPE_UNRESOLVED", "CONFLICTING_TYPE"]);
const signal = legacySignal.extend({
  facet: z.string().min(1).max(80).optional(),
  role: z.enum(["AUDIENCE_TASTE", "BRAND_CLASSIFICATION", "DESCRIPTIVE_KEYWORD"]).optional(),
  possibleDuplicateOf: z.string().min(1).optional(),
  grounding: z.strictObject({
    typeEvidence,
    providerType: z.string().nullable(),
    providerSubtype: z.string().nullable(),
    requestedType: z.string().min(1),
    scopeBasis: z.enum(["RECORDED_PROVIDER_REQUEST", "BASELINE_TEMPLATE_STAGE"]).nullable(),
  }).optional(),
});

export const brandBaselineResultSchema = z.strictObject({
  schemaVersion: z.literal("ce-brand-baseline/0.2"),
  scanId: z.uuid(),
  scanStatus,
  brand,
  fingerprint: z.strictObject({
    signals: z.array(signal).max(100),
    excluded: z.array(z.strictObject({ id: z.string().min(1), name: z.string(), domain: z.string(), rule: z.string().min(1), reason: z.string().max(400), source: evidenceRef })).max(100),
    themes: z.array(z.strictObject({ id: z.string().min(1), label: z.string().min(1), rule: z.string().min(1), facet: z.string().min(1), memberIds: z.array(z.string().min(1)).min(2), possibleDuplicateIds: z.array(z.string()) })).max(20),
    domainCoverage: z.array(coverage).max(8),
    provenance: z.array(evidenceRef).max(150),
    limitations: z.array(z.string().max(400)).max(30),
  }),
  territories: z.array(z.strictObject({
    id: z.string().min(1), name: z.string(), canonicalConcept: z.string().min(1),
    level: z.literal("TERRITORY_HYPOTHESIS"), validation: z.literal("UNVALIDATED"),
    evidenceStatus: z.enum(["OBSERVED_ASSOCIATION", "PARTIAL_EVIDENCE", "MULTI_SIGNAL_SUPPORT"]),
    discoveryBasis: z.string().min(1), facet: z.string().min(1), observedDomains: z.array(z.string()).min(1),
    supportingReferences: z.array(evidenceRef).min(1),
    explanation: z.string().min(1).max(400), nextInvestigation: z.string().min(1).max(400),
    limitations: z.array(z.string()), availableActions: z.tuple([z.literal("inspect_evidence")]),
  })).max(5),
  discovery: z.strictObject({ rule: z.string().min(1), themeRule: z.string().min(1), outcome: z.enum(["HYPOTHESES_FOUND", "NO_HYPOTHESIS"]), reasons: z.array(z.string().max(400)).max(10), nextSteps: z.array(z.string().max(400)).max(10) }),
  audit: z.strictObject({
    returnedTags: z.number().int().nonnegative(), operationalTags: z.number().int().nonnegative(), culturalTags: z.number().int().nonnegative(),
    possibleDuplicateTags: z.number().int().nonnegative(), returnedEntities: z.number().int().nonnegative(),
    typeEvidence: z.strictObject({ PROVIDER_CONFIRMED_TYPE: z.number().int().nonnegative(), QUERY_SCOPED: z.number().int().nonnegative(), GENERIC_TYPE_UNRESOLVED: z.number().int().nonnegative(), CONFLICTING_TYPE: z.number().int().nonnegative() }),
    retainedAssociations: z.number().int().nonnegative(), excludedEntities: z.number().int().nonnegative(),
    themes: z.number().int().nonnegative(), hypotheses: z.number().int().nonnegative(),
  }),
  execution: z.strictObject({
    templateVersion: z.enum(["ce-brand-baseline/v1", "ce-brand-baseline/v2"]),
    ...execution,
    derivedFrom: z.strictObject({ scanId: z.uuid(), schemaVersion: z.string().min(1), note: z.string().min(1).max(400) }).optional(),
  }),
});

/** Reads either stored result version. Writes only ever use `brandBaselineResultSchema`. */
export const storedBrandBaselineResultSchema = z.discriminatedUnion("schemaVersion", [brandBaselineResultSchema, legacyBrandBaselineResultSchema]);

export const BASELINE_OBSERVATION_SCHEMA_VERSION = "ce-brand-baseline-observation/0.3" as const;
export const baselineObservationSchema = z.strictObject({
  domain: z.string().min(1).max(40),
  capturedAt: z.iso.datetime(),
  kind: z.enum(["ok", "empty", "needs_input"]),
  operation: z.enum(["entity_tags", "recommend"]),
  correlationId: z.string().min(1).max(200),
  sourceStatus: z.enum(["ok", "partial", "degraded", "empty", "needs_input"]),
  /** 0.3+: the `filter.type` the harness recorded sending upstream. Absent on 0.2 artifacts, which never captured it. */
  recordedRequestType: z.string().min(1).max(80).optional(),
  signals: z.array(z.strictObject({
    id: z.string().min(1), name: z.string(), kind: z.enum(["tag", "entity"]),
    type: z.string().optional(),
    // 0.3+: Qloo's own subtype, verbatim. Absent on 0.2 artifacts.
    subtype: z.string().optional(),
    // Optional only so pre-0.2 observation artifacts remain inspectable; new captures always set it.
    sourceCorrelationId: z.string().min(1).optional(),
  })).max(20),
});
export type StoredBaselineObservation = z.infer<typeof baselineObservationSchema>;

export const resolveBrandBody = z.strictObject({ name: z.string().trim().min(2).max(200), selectedQlooId: z.string().min(2).max(200).optional() });
export const createBaselineBody = z.strictObject({ resolutionId: z.uuid(), idempotencyKey: z.string().min(16).max(128) });
