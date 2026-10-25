import { z } from "zod";

const evidenceRef = z.strictObject({
  operation: z.enum(["describe", "entity_tags", "recommend"]),
  correlationId: z.string().min(1).max(200),
  sourceId: z.string().min(1).max(300),
  capturedAt: z.iso.datetime(),
  sourceStatus: z.enum(["ok", "partial", "degraded"]),
  scope: z.string().min(1).max(80),
});

export const brandBaselineResultSchema = z.strictObject({
  schemaVersion: z.literal("ce-brand-baseline/0.1"),
  scanId: z.uuid(),
  scanStatus: z.enum(["CREATED", "QUEUED", "RUNNING", "COMPLETE", "PARTIAL", "NEEDS_BRAND_CONFIRMATION", "INSUFFICIENT_EVIDENCE", "FAILED", "INTERRUPTED", "CANCELLED"]),
  brand: z.strictObject({ id: z.uuid(), qlooId: z.string().min(1), name: z.string().min(1), resolutionStatus: z.literal("RESOLVED"), source: evidenceRef }),
  fingerprint: z.strictObject({
    signals: z.array(z.strictObject({ id: z.string().min(1), name: z.string(), kind: z.enum(["tag", "entity"]), domain: z.string(), source: evidenceRef, rankWithinCall: z.number().int().positive() })).max(100),
    domainCoverage: z.array(z.strictObject({ domain: z.string(), status: z.enum(["OBSERVED", "EMPTY", "PARTIAL", "DEGRADED", "UNAVAILABLE"]), entityCount: z.number().int().nonnegative() })).max(8),
    provenance: z.array(evidenceRef).max(100),
    limitations: z.array(z.string().max(400)).max(30),
  }),
  territories: z.array(z.strictObject({
    id: z.string().min(1), name: z.string(), canonicalConcept: z.string().min(1),
    evidenceStatus: z.enum(["OBSERVED_ASSOCIATION", "PARTIAL_EVIDENCE"]),
    discoveryBasis: z.string().min(1), supportingReferences: z.array(evidenceRef).min(1),
    limitations: z.array(z.string()), availableActions: z.tuple([z.literal("inspect_evidence")]),
  })).max(5),
  execution: z.strictObject({
    templateVersion: z.literal("ce-brand-baseline/v1"),
    startedAt: z.iso.datetime(), finishedAt: z.iso.datetime(), providerCallCount: z.number().int().min(0).max(7),
    completedStages: z.array(z.string()), incompleteStages: z.array(z.string()),
    recordedOrLive: z.enum(["recorded", "live"]), budgetStatus: z.enum(["WITHIN_LIMIT", "EXHAUSTED", "UNCERTAIN"]),
    cacheSourceScanId: z.uuid().optional(),
  }),
});

export const baselineObservationSchema = z.strictObject({
  domain: z.string().min(1).max(40),
  capturedAt: z.iso.datetime(),
  kind: z.enum(["ok", "empty", "needs_input"]),
  operation: z.enum(["entity_tags", "recommend"]),
  correlationId: z.string().min(1).max(200),
  sourceStatus: z.enum(["ok", "partial", "degraded", "empty", "needs_input"]),
  signals: z.array(z.strictObject({
    id: z.string().min(1), name: z.string(), kind: z.enum(["tag", "entity"]),
    type: z.string().optional(),
    // Optional only so pre-0.2 observation artifacts remain inspectable; new captures always set it.
    sourceCorrelationId: z.string().min(1).optional(),
  })).max(10),
});

export const resolveBrandBody = z.strictObject({ name: z.string().trim().min(2).max(200), selectedQlooId: z.string().min(2).max(200).optional() });
export const createBaselineBody = z.strictObject({ resolutionId: z.uuid(), idempotencyKey: z.string().min(16).max(128) });
