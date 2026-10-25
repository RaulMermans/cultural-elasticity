/** A baseline describes observed Qloo associations; it is not a relative analysis or score. */
export const BRAND_BASELINE_SCHEMA_VERSION = "ce-brand-baseline/0.1" as const;
export const BRAND_BASELINE_TEMPLATE_VERSION = "ce-brand-baseline/v1" as const;

export type BaselineStatus = "CREATED" | "QUEUED" | "RUNNING" | "COMPLETE" | "PARTIAL" | "NEEDS_BRAND_CONFIRMATION" | "INSUFFICIENT_EVIDENCE" | "FAILED" | "INTERRUPTED" | "CANCELLED";
export type BaselineEvidenceRef = {
  operation: "describe" | "entity_tags" | "recommend";
  correlationId: string;
  sourceId: string;
  capturedAt: string;
  sourceStatus: "ok" | "partial" | "degraded";
  scope: string;
};
export type BaselineSignal = {
  id: string;
  name: string;
  kind: "tag" | "entity";
  domain: string;
  source: BaselineEvidenceRef;
  rankWithinCall: number;
};
export type BaselineTerritory = {
  id: string;
  name: string;
  canonicalConcept: string;
  evidenceStatus: "OBSERVED_ASSOCIATION" | "PARTIAL_EVIDENCE";
  discoveryBasis: string;
  supportingReferences: BaselineEvidenceRef[];
  limitations: string[];
  availableActions: ["inspect_evidence"];
};
export type BrandBaselineResult = {
  schemaVersion: typeof BRAND_BASELINE_SCHEMA_VERSION;
  scanId: string;
  scanStatus: BaselineStatus;
  brand: { id: string; qlooId: string; name: string; resolutionStatus: "RESOLVED"; source: BaselineEvidenceRef };
  fingerprint: {
    signals: BaselineSignal[];
    domainCoverage: { domain: string; status: "OBSERVED" | "EMPTY" | "PARTIAL" | "DEGRADED" | "UNAVAILABLE"; entityCount: number }[];
    provenance: BaselineEvidenceRef[];
    limitations: string[];
  };
  territories: BaselineTerritory[];
  execution: {
    templateVersion: typeof BRAND_BASELINE_TEMPLATE_VERSION;
    startedAt: string;
    finishedAt: string;
    providerCallCount: number;
    completedStages: string[];
    incompleteStages: string[];
    recordedOrLive: "recorded" | "live";
    cacheSourceScanId?: string;
    budgetStatus: "WITHIN_LIMIT" | "EXHAUSTED" | "UNCERTAIN";
  };
};

/** Lightweight browser boundary guard; the backend applies the full Zod schema. */
export function isBrandBaselineResult(value: unknown): value is BrandBaselineResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== BRAND_BASELINE_SCHEMA_VERSION || typeof record.scanId !== "string") return false;
  if (!record.brand || typeof record.brand !== "object" || !record.fingerprint || typeof record.fingerprint !== "object" || !Array.isArray(record.territories)) return false;
  const fingerprint = record.fingerprint as Record<string, unknown>;
  return Array.isArray(fingerprint.signals) && Array.isArray(fingerprint.domainCoverage) && Array.isArray(fingerprint.provenance);
}
