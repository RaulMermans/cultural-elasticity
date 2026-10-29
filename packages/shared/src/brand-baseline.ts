import type { FacetRole } from "./opportunity.js";

/** A baseline describes observed Qloo associations; it is not a relative analysis or score. */
export const BRAND_BASELINE_SCHEMA_VERSION = "ce-brand-baseline/0.2" as const;
/** Sprint 9B results. Stored as-run artifacts keep this version and stay readable; they are never rewritten. */
export const BRAND_BASELINE_LEGACY_SCHEMA_VERSION = "ce-brand-baseline/0.1" as const;
/** v2 asks the same five Qloo questions as v1, with a 20-tag profile instead of 10 (no extra call). */
export const BRAND_BASELINE_TEMPLATE_VERSION = "ce-brand-baseline/v2" as const;
export const BRAND_BASELINE_LEGACY_TEMPLATE_VERSION = "ce-brand-baseline/v1" as const;
export type BaselineTemplateVersion = typeof BRAND_BASELINE_TEMPLATE_VERSION | typeof BRAND_BASELINE_LEGACY_TEMPLATE_VERSION;

export type BaselineStatus = "CREATED" | "QUEUED" | "RUNNING" | "COMPLETE" | "PARTIAL" | "NEEDS_BRAND_CONFIRMATION" | "INSUFFICIENT_EVIDENCE" | "FAILED" | "INTERRUPTED" | "CANCELLED";
export type BaselineEvidenceRef = {
  operation: "describe" | "entity_tags" | "recommend";
  correlationId: string;
  sourceId: string;
  capturedAt: string;
  sourceStatus: "ok" | "partial" | "degraded";
  scope: string;
};
export type BaselineCoverage = { domain: string; status: "OBSERVED" | "EMPTY" | "PARTIAL" | "DEGRADED" | "UNAVAILABLE"; entityCount: number };

/**
 * How a returned tag is used. AUDIENCE_TASTE and BRAND_CLASSIFICATION come from Qloo taxonomy facets;
 * DESCRIPTIVE_KEYWORD is a free media keyword. None of them is an opportunity.
 */
export type BaselineTagRole = FacetRole;
/**
 * What Qloo evidence says about a returned entity's type. QUERY_SCOPED means only that the entity was returned
 * by a query restricted to that type; it is never relabelled as an entity-level confirmation.
 */
export type BaselineTypeEvidence = "PROVIDER_CONFIRMED_TYPE" | "QUERY_SCOPED" | "GENERIC_TYPE_UNRESOLVED" | "CONFLICTING_TYPE";
export type BaselineScopeBasis = "RECORDED_PROVIDER_REQUEST" | "BASELINE_TEMPLATE_STAGE";

export type BaselineSignal = {
  id: string;
  name: string;
  kind: "tag" | "entity";
  domain: string;
  source: BaselineEvidenceRef;
  rankWithinCall: number;
  /** Tags only: Qloo URN facet (`namespace:source`) and how the baseline uses it. */
  facet?: string;
  role?: BaselineTagRole;
  /** Another retained tag in the same call whose normalized name is identical. Recorded as uncertain, never merged or counted twice. */
  possibleDuplicateOf?: string;
  /** Entities only. */
  grounding?: {
    typeEvidence: BaselineTypeEvidence;
    providerType: string | null;
    providerSubtype: string | null;
    requestedType: string;
    scopeBasis: BaselineScopeBasis | null;
  };
};
export type BaselineExclusion = { id: string; name: string; domain: string; rule: string; reason: string; source: BaselineEvidenceRef };
/** A transparent grouping of observations by a versioned rule. Not a territory and not a conclusion. */
export type BaselineTheme = { id: string; label: string; rule: string; facet: string; memberIds: string[]; possibleDuplicateIds: string[] };

export type BaselineTerritory = {
  id: string;
  name: string;
  canonicalConcept: string;
  evidenceStatus: "OBSERVED_ASSOCIATION" | "PARTIAL_EVIDENCE" | "MULTI_SIGNAL_SUPPORT";
  discoveryBasis: string;
  supportingReferences: BaselineEvidenceRef[];
  limitations: string[];
  availableActions: ["inspect_evidence"];
};
export type BaselineHypothesis = BaselineTerritory & {
  level: "TERRITORY_HYPOTHESIS";
  validation: "UNVALIDATED";
  facet: string;
  observedDomains: string[];
  /** Why this candidate appeared, in plain language, from deterministic facts only. */
  explanation: string;
  nextInvestigation: string;
};

/** Counts produced by the projection itself, for the audit report. */
export type BaselineAudit = {
  returnedTags: number;
  operationalTags: number;
  culturalTags: number;
  possibleDuplicateTags: number;
  returnedEntities: number;
  typeEvidence: Record<BaselineTypeEvidence, number>;
  retainedAssociations: number;
  excludedEntities: number;
  themes: number;
  hypotheses: number;
};

export type BrandBaselineResultV1 = {
  schemaVersion: typeof BRAND_BASELINE_LEGACY_SCHEMA_VERSION;
  scanId: string;
  scanStatus: BaselineStatus;
  brand: { id: string; qlooId: string; name: string; resolutionStatus: "RESOLVED"; source: BaselineEvidenceRef };
  fingerprint: { signals: BaselineSignal[]; domainCoverage: BaselineCoverage[]; provenance: BaselineEvidenceRef[]; limitations: string[] };
  territories: BaselineTerritory[];
  execution: {
    templateVersion: typeof BRAND_BASELINE_LEGACY_TEMPLATE_VERSION;
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

export type BrandBaselineResult = {
  schemaVersion: typeof BRAND_BASELINE_SCHEMA_VERSION;
  scanId: string;
  scanStatus: BaselineStatus;
  brand: { id: string; qlooId: string; name: string; resolutionStatus: "RESOLVED"; source: BaselineEvidenceRef };
  /** A. Observed cultural profile. Never depends on whether a territory hypothesis was found. */
  fingerprint: {
    signals: BaselineSignal[];
    excluded: BaselineExclusion[];
    themes: BaselineTheme[];
    domainCoverage: BaselineCoverage[];
    provenance: BaselineEvidenceRef[];
    limitations: string[];
  };
  /** B. Territory hypotheses worth further research. Empty when the evidence does not support one. */
  territories: BaselineHypothesis[];
  /** Why discovery produced what it did, and which research step the evidence justifies next. */
  discovery: { rule: string; themeRule: string; outcome: "HYPOTHESES_FOUND" | "NO_HYPOTHESIS"; reasons: string[]; nextSteps: string[] };
  audit: BaselineAudit;
  execution: Omit<BrandBaselineResultV1["execution"], "templateVersion"> & {
    templateVersion: BaselineTemplateVersion;
    /** Set only on an offline projection of stored observations. The source result is never modified. */
    derivedFrom?: { scanId: string; schemaVersion: string; note: string };
  };
};
export type AnyBrandBaselineResult = BrandBaselineResult | BrandBaselineResultV1;

/** Lightweight browser boundary guard; the backend applies the full Zod schema. */
export function isBrandBaselineResult(value: unknown): value is AnyBrandBaselineResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if ((record.schemaVersion !== BRAND_BASELINE_SCHEMA_VERSION && record.schemaVersion !== BRAND_BASELINE_LEGACY_SCHEMA_VERSION) || typeof record.scanId !== "string") return false;
  if (!record.brand || typeof record.brand !== "object" || !record.fingerprint || typeof record.fingerprint !== "object" || !Array.isArray(record.territories)) return false;
  const fingerprint = record.fingerprint as Record<string, unknown>;
  if (!Array.isArray(fingerprint.signals) || !Array.isArray(fingerprint.domainCoverage) || !Array.isArray(fingerprint.provenance)) return false;
  return record.schemaVersion === BRAND_BASELINE_LEGACY_SCHEMA_VERSION || (Array.isArray(fingerprint.themes) && Array.isArray(fingerprint.excluded) && typeof record.discovery === "object" && record.discovery !== null);
}
