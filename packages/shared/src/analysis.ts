// Analysis output contracts: the boundary between the deterministic Cultural Evidence Core (backend)
// and its consumers (future Elasticity methodology, future agent, frontend).
//
// Provider-independent by design. Nothing here names Qloo or any upstream payload shape.
// There is deliberately no score, no weight and no composite metric in these types.

export const ANALYSIS_INGREDIENTS_SCHEMA_VERSION = "ce-ingredients/0.1" as const;

// ---- Evidence primitives (mirrored by the backend's zod schemas; alignment is type-checked there) ----

/** Compact pointer to the observation a value came from. Never a raw payload. */
export type ProvenanceRef = {
  source: string;
  operation: string;
  correlationId?: string;
  capturedAt?: string;
};

/**
 * Which other values a number may be compared with.
 *   within_call          only values from the same identifiable call (same correlationId)
 *   within_profile       only values inside the same profile
 *   cross_call_verified  values from different calls, on the same declared scale, verified comparable
 *   unknown              nothing; the number is carried as evidence but never compared
 */
export type ComparisonScope = "within_call" | "within_profile" | "cross_call_verified" | "unknown";

/** A number whose scale is preserved as given. It is never assumed to be 0–1. */
export type NumericEvidence = {
  value: number;
  scale?: string;
  comparisonScope: ComparisonScope;
};

export type CulturalSignal = {
  id: string;
  label: string;
  category?: string;
  /** 1-based position in the source's ordering. */
  rank?: number;
  numeric?: NumericEvidence;
  provenance: ProvenanceRef[];
};

export type EntityResolution = "confirmed" | "unconfirmed" | "unknown";

export type ResolvedEntity = {
  id: string;
  label: string;
  type: string;
  resolution: EntityResolution;
  provenance: ProvenanceRef[];
};

export type Limitation = {
  /** UPPER_SNAKE_CASE, stable for programmatic use. */
  code: string;
  detail: string;
};

export type MetricDirection = "higher_is_closer" | "higher_is_farther" | "neutral";

export type InterpretableMetric = {
  id: string;
  label: string;
  value: number;
  direction: MetricDirection;
  scale?: { min?: number; max?: number };
  comparisonScope: ComparisonScope;
  provenance: ProvenanceRef[];
};

// ---- Ingredient wrapper: missing evidence is never a zero ----

export type IngredientStatus = "available" | "unavailable" | "insufficient_evidence" | "not_comparable";

/** Invariant (enforced by the backend): `value !== null` exactly when `status === "available"`. */
export type Ingredient<T> = {
  value: T | null;
  status: IngredientStatus;
  provenance: ProvenanceRef[];
  limitations: Limitation[];
};

// ---- Overlap ----

export type SharedSignal = {
  id: string;
  label: string;
  category?: string;
  brandRank?: number;
  targetRank?: number;
  /** Union of the brand-side and target-side observations. */
  provenance: ProvenanceRef[];
};

export type WeightedSharedOverlap = {
  /** Σ min / Σ max over shared signals with comparable values. Absent signals are NOT treated as zero. */
  ratio: number;
  comparedSignalCount: number;
  basis: "shared_signals_only";
};

export type OverlapReport = {
  /** Ratios need both profiles non-empty. */
  status: "available" | "insufficient_evidence";
  /** Counts describe the observed representation, which may be truncated. */
  brandSignalCount: number;
  targetSignalCount: number;
  sharedSignalCount: number;
  unionCount: number;
  jaccard: number | null;
  overlapCoefficient: number | null;
  shared: SharedSignal[];
  uniqueToBrand: CulturalSignal[];
  uniqueToTarget: CulturalSignal[];
  weightedSharedOverlap: Ingredient<WeightedSharedOverlap>;
  provenance: ProvenanceRef[];
  limitations: Limitation[];
};

// ---- Profile coverage and top-N stability (representation richness, not elasticity) ----

export type Truncation = "truncated" | "not_truncated" | "unknown";

export type ProvenanceCoverage = {
  items: number;
  withProvenance: number;
  withCorrelationId: number;
  /** withCorrelationId / items; null when there are no items. */
  completeness: number | null;
};

export type ProfileCoverage = {
  totalSignals: number;
  rankedSignalCount: number;
  numericSignalCount: number;
  numericCoverage: number | null;
  missingNumericRatio: number | null;
  numericComparability: "no_numeric_values" | "comparable_within_profile" | "not_comparable";
  truncation: Truncation;
  provenance: ProvenanceCoverage;
  /** Null when no signal carries a category. */
  categoryCount: number | null;
  uncategorizedSignalCount: number;
};

export type ProfileCoverageReport = {
  brand: ProfileCoverage;
  target: ProfileCoverage;
  /** sharedSignalCount / profile size; null when the profile is empty. */
  sharedOfBrand: number | null;
  sharedOfTarget: number | null;
};

export type TopNPoint = {
  n: number;
  brandSignalsUsed: number;
  targetSignalsUsed: number;
  /** True when a profile has fewer than n signals, so the cut is the whole profile. */
  saturated: boolean;
  sharedCount: number;
  jaccard: number;
  sharedIds: string[];
};

export type StabilityReport = {
  status: "available" | "insufficient_evidence";
  points: TopNPoint[];
  summary: {
    jaccardMin: number;
    jaccardMax: number;
    jaccardRange: number;
    /** Shared at every evaluated N. */
    persistentSharedIds: string[];
    /** Number of consecutive N steps where the shared set changed. */
    sharedSetChanges: number;
  } | null;
  limitations: Limitation[];
};

// ---- Audience ----

export type AudienceMetricAssessment = InterpretableMetric & {
  usableAsIngredient: boolean;
  crossCallComparable: boolean;
  exclusionReason?: string;
};

export type AudienceIngredients = {
  status: "available" | "unavailable" | "insufficient_evidence";
  metrics: AudienceMetricAssessment[];
  /** Upstream fields kept as evidence but never used in calculations. */
  opaqueFields: { paths: string[]; numericPaths: string[] };
  provenance: ProvenanceRef[];
  limitations: Limitation[];
};

// ---- Candidate ranking ----

export type RankingScopeCheck = {
  declared: "single_call" | "unknown";
  verified: boolean;
  correlationId?: string;
  reason?: string;
};

export type RankedCandidateView = {
  id: string;
  label: string;
  rank?: number;
  numeric?: NumericEvidence;
  provenance: ProvenanceRef[];
};

export type RankingIngredients = {
  status: "available" | "unavailable" | "insufficient_evidence" | "not_comparable";
  scope: RankingScopeCheck | null;
  rankedAgainst: string | null;
  candidateCount: number | null;
  /** Rank-sorted only when the single-call scope is verified; otherwise in id order and not to be read as a ranking. */
  candidates: RankedCandidateView[];
  target: {
    candidateId: string;
    rankPosition: Ingredient<number>;
    /** (n − position) / (n − 1): 1 = top of this call's candidates, 0 = bottom. */
    relativeRankPercentile: Ingredient<number>;
    positionsFromTop: Ingredient<number>;
    positionsFromBottom: Ingredient<number>;
    /** Raw value(top) − value(target). No direction is implied. */
    valueGapFromTop: Ingredient<number>;
    /** Raw value(target) − value(bottom). No direction is implied. */
    valueGapFromBottom: Ingredient<number>;
  } | null;
  provenance: ProvenanceRef[];
  limitations: Limitation[];
};

// ---- Bridges ----

export type BridgeSemantics = "shared_signal" | "joint_signal" | "intermediate_signal";

export type BridgeIngredients = {
  status: "available" | "unavailable";
  /** Distinct signals across all bridge evidence; null when unavailable (never 0 for "unknown"). */
  signalCount: number | null;
  signals: CulturalSignal[];
  bySemantics: Partial<Record<BridgeSemantics, number>>;
  categoryCount: number | null;
  numericCoverage: number | null;
  provenance: ProvenanceRef[];
  provenanceCoverage: ProvenanceCoverage | null;
  limitations: Limitation[];
};

// ---- Distance-proxy ingredients (no formula) ----

export type DistanceProxyIngredients = {
  /** No Cultural Distance Proxy formula exists yet; consumers must not combine these. */
  formula: "NOT_DEFINED";
  jaccardOverlap: Ingredient<number>;
  overlapCoefficient: Ingredient<number>;
  sharedSignalCount: Ingredient<number>;
  weightedSharedOverlap: Ingredient<WeightedSharedOverlap>;
  relativeRankPercentile: Ingredient<number>;
  audienceMetrics: Ingredient<AudienceMetricAssessment[]>;
  bridgeSignalCount: Ingredient<number>;
  profileCoverage: Ingredient<{ brandSignals: number; targetSignals: number; sharedOfBrand: number; sharedOfTarget: number }>;
  profileStability: Ingredient<{ jaccardMin: number; jaccardMax: number; jaccardRange: number }>;
};

// ---- Evidence quality (sufficiency of evidence, not confidence in an outcome) ----

export type QualityLevel = "good" | "limited" | "insufficient" | "unavailable" | "not_applicable";

export type QualityIndicator = {
  level: QualityLevel;
  reasons: string[];
};

export type EvidenceQuality = {
  indicators: {
    resolution: QualityIndicator;
    profileCoverage: QualityIndicator;
    numericEvidence: QualityIndicator;
    provenance: QualityIndicator;
    comparisonValidity: QualityIndicator;
    audienceSemantics: QualityIndicator;
    bridgeEvidence: QualityIndicator;
  };
  overall: {
    level: "HIGH" | "MEDIUM" | "LOW";
    rule: string;
    drivers: string[];
  };
  limitations: Limitation[];
};

// ---- Canonical result ----

export type EvidenceOrigin = "live" | "recorded" | "synthetic";

export type AnalysisIngredients = {
  schemaVersion: typeof ANALYSIS_INGREDIENTS_SCHEMA_VERSION;
  /** Copied from the packet. Synthetic results must never be presented as live evidence. */
  evidenceOrigin: EvidenceOrigin;
  subjects: { brand: ResolvedEntity; target: ResolvedEntity };
  overlap: OverlapReport;
  profileCoverage: ProfileCoverageReport;
  stability: StabilityReport;
  audience: AudienceIngredients;
  ranking: RankingIngredients;
  bridges: BridgeIngredients;
  distanceProxy: DistanceProxyIngredients;
  evidenceQuality: EvidenceQuality;
  limitations: Limitation[];
  provenance: ProvenanceRef[];
};

/** Shallow structural check for values received over HTTP. The backend validates the full invariants. */
export function isAnalysisIngredients(value: unknown): value is AnalysisIngredients {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === ANALYSIS_INGREDIENTS_SCHEMA_VERSION &&
    typeof record.evidenceOrigin === "string" &&
    typeof record.distanceProxy === "object" &&
    record.distanceProxy !== null &&
    typeof record.evidenceQuality === "object" &&
    record.evidenceQuality !== null
  );
}
