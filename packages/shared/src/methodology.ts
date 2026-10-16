// Cultural Elasticity Methodology v0 output contract (provider-independent).
//
// What the result says, in four separate dimensions that are never collapsed into one number:
//   Relative position          where a territory sits among THIS candidate set, from same-call rank order
//   Representation robustness  whether that position survives swapping the territory's exemplars
//   Cultural coherence         which cultural signals the brand and the territory exemplars share (sets only)
//   Evidence quality           whether the evidence packet is technically trustworthy and complete
//
// Nothing here is a probability, a prediction of commercial success, a measured network separation,
// or a statement about any individual's preferences. There is deliberately no field named
// "confidence". A Relative Elasticity Index exists ONLY when the index gate passes.

import type { ConditionedEvidenceView, EvidenceOrigin, Limitation, ProvenanceRef, ResolvedEntity } from "./analysis.js";

export const ELASTICITY_RESULT_SCHEMA_VERSION = "ce-elasticity-result/0.1" as const;

export type RobustnessLevel = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";

export type ElasticityClass = "NATURAL_ADJACENCY" | "CREDIBLE_STRETCH" | "UNCERTAIN_REPRESENTATION_SENSITIVE" | "CULTURAL_BREAK" | "INSUFFICIENT_EVIDENCE";

export type TerritoryExemplarView = {
  id: string;
  label: string;
  type: string;
  role: "primary" | "alternate";
  note?: string;
  provenance: ProvenanceRef[];
};

export type TerritoryRepresentationView = {
  id: string;
  label: string;
  concept?: { id: string; label: string; type: string };
  exemplars: TerritoryExemplarView[];
  rejectedExemplars: { label: string; reason: string }[];
  assumptions: string[];
  approximationWarnings: string[];
  provenance: ProvenanceRef[];
};

// ---- Panels: one rank call each, one exemplar per territory ----

export type PanelStatus = "valid" | "missing" | "scope_unverified" | "unranked";

export type PanelReport = {
  id: string;
  purpose: "primary" | "alternate" | "repeat";
  repeatOf?: string;
  status: PanelStatus;
  correlationId: string | null;
  size: number;
  /** In the call's rank order. Values are raw, on this call's own scale, and comparable only inside this panel. */
  order: { territoryId: string; exemplarId: string; exemplarLabel: string; rank: number; withinCallValue: number | null }[];
  reasons: string[];
};

export type RepeatCheck = {
  panelId: string;
  repeatOf: string;
  status: "identical" | "different" | "not_comparable";
  detail: string;
};

/** One territory's observation in one aggregated (non-repeat) panel. */
export type PanelObservation = {
  panelId: string;
  exemplarId: string;
  exemplarLabel: string;
  rank: number;
  panelSize: number;
  /** (panelSize − rank) / (panelSize − 1): 1 = top of this panel, 0 = bottom. Rank-derived, never value-derived. */
  percentile: number;
  /** Raw value on the panel call's own scale. Never compared across panels. */
  withinCallValue: number | null;
  correlationId: string;
};

export type RelativePosition = {
  status: "available" | "insufficient_evidence";
  /** Competition rank of the median panel percentile among territories with evidence (1 = closest in this set). */
  position: number | null;
  of: number;
  /** Median over panels of the rank percentile. The central ordinal position. */
  medianPercentile: number | null;
  /** Median over panels of the raw rank (all panels have the same size in v0 inputs). */
  medianRank: number | null;
  tiedWith: string[];
  semantics: "relative_candidate_position";
};

export type PairwiseRecord = {
  otherTerritoryId: string;
  /** Panels in which this territory ranked above the other one. */
  wins: number;
  losses: number;
  sharedPanels: number;
};

export type Robustness = {
  level: RobustnessLevel;
  rule: string;
  declaredExemplars: number;
  /** Distinct exemplars with at least one valid panel observation. */
  panelledExemplars: number;
  validObservations: number;
  bestRank: number | null;
  worstRank: number | null;
  rankSpread: number | null;
  percentileSpread: number | null;
  /** True when every observation lies on the same side of the panel midpoint (all ≥ 0.5 or all ≤ 0.5). */
  directionConsistent: boolean | null;
  reasons: string[];
};

// ---- Cultural coherence (set membership only; tag affinity is never a weight) ----

export type CoherenceExemplar = {
  exemplarId: string;
  exemplarLabel: string;
  status: "available" | "insufficient_evidence" | "unavailable";
  brandSignalCount: number | null;
  targetSignalCount: number | null;
  sharedCount: number | null;
  unionCount: number | null;
  jaccard: number | null;
  overlapCoefficient: number | null;
  shared: { id: string; label: string }[];
  brandOnly: { id: string; label: string }[];
  targetOnly: { id: string; label: string }[];
  provenance: ProvenanceRef[];
};

export type CoherenceBand = "NONE" | "SPARSE" | "SOME" | "SUBSTANTIAL";

export type CoherenceView = {
  view: "RAW" | "CULTURAL_FILTERED";
  /** Set for CULTURAL_FILTERED: the operational-tag policy that produced the view. */
  policyVersion: string | null;
  status: "available" | "insufficient_evidence";
  perExemplar: CoherenceExemplar[];
  summary: {
    exemplarsCompared: number;
    sharedCountMin: number;
    sharedCountMedian: number;
    sharedCountMax: number;
    jaccardMedian: number;
    /** Signals the brand shares with at least half of the compared exemplars. */
    consistentlyShared: { id: string; label: string; exemplarCount: number }[];
  } | null;
  /** Descriptive label of the median shared count. Not calibrated and not used in classification. */
  band: CoherenceBand | null;
  bandRule: string;
};

export type ExcludedSignal = {
  signal: { id: string; label: string; category?: string };
  reason: string;
  rule: string;
};

export type TagFilterReport = {
  policyVersion: string;
  profileSubjectId: string;
  rawCount: number;
  keptCount: number;
  excluded: ExcludedSignal[];
};

// ---- Classification, index, quality ----

export type ElasticityClassification = {
  label: ElasticityClass;
  status: "PROVISIONAL";
  rule: string;
  reasons: string[];
};

/** Present ONLY when the index decision is APPROVED and this analysis passes the index gate. */
export type RelativeElasticityIndex = {
  value: number;
  semantics: "relative_candidate_position";
  formula: string;
  comparisonSet: string[];
  methodologyVersion: string;
  NOT_A_PROBABILITY: true;
};

export type TerritoryEvidenceQuality = {
  level: "HIGH" | "MEDIUM" | "LOW";
  rule: string;
  perExemplar: { exemplarId: string; level: "HIGH" | "MEDIUM" | "LOW" | "MISSING"; drivers: string[] }[];
  drivers: string[];
};

/** Conditioned list for the territory, plus which declared exemplars Qloo itself returned in it (face-validity check). */
export type TerritoryConditionedEvidence = ConditionedEvidenceView & {
  declaredExemplarsFound: { id: string; label: string; rank: number }[];
};

export type TerritoryElasticity = {
  territory: TerritoryRepresentationView;
  relativePosition: RelativePosition;
  panelEvidence: PanelObservation[];
  pairwise: PairwiseRecord[];
  robustness: Robustness;
  coherenceRaw: CoherenceView;
  coherenceFiltered: CoherenceView;
  /** null when no brand-conditioned evidence was collected for this territory (never an empty "0"). */
  conditionedEvidence: TerritoryConditionedEvidence | null;
  classification: ElasticityClassification;
  relativeElasticityIndex?: RelativeElasticityIndex;
  evidenceQuality: TerritoryEvidenceQuality;
  limitations: Limitation[];
  provenance: ProvenanceRef[];
};

export type IndexGateCheck = {
  id: "A" | "B" | "C" | "D" | "E" | "F" | "G";
  name: string;
  status: "PASS" | "FAIL" | "NOT_TESTED";
  detail: string;
};

export type IndexGateReport = {
  status: "PASS" | "FAIL";
  candidateFormula: string;
  checks: IndexGateCheck[];
};

export type MethodologyTrace = {
  methodologyVersion: string;
  steps: { step: string; detail: string }[];
  panels: { id: string; purpose: string; correlationId: string | null; ranks: { territoryId: string; exemplarId: string; rank: number }[] }[];
  aggregation: { territoryId: string; percentiles: number[]; medianPercentile: number | null; position: number | null }[];
  robustness: { territoryId: string; level: RobustnessLevel; percentileSpread: number | null }[];
  tagFiltering: { profileSubjectId: string; kept: number; excluded: number }[];
  coherence: { territoryId: string; rawSharedMedian: number | null; filteredSharedMedian: number | null }[];
  classification: { territoryId: string; label: ElasticityClass }[];
  index: { decision: "APPROVED" | "REJECTED_FOR_NOW"; gate: "PASS" | "FAIL"; emitted: number };
};

export type CulturalElasticityResult = {
  schemaVersion: typeof ELASTICITY_RESULT_SCHEMA_VERSION;
  methodologyVersion: string;
  evidenceOrigin: EvidenceOrigin;
  brand: ResolvedEntity;
  /** Every relative statement depends on exactly this set. */
  comparisonSet: { territories: { id: string; label: string }[]; panels: string[]; note: string };
  semantics: {
    relativePosition: string;
    representationRobustness: string;
    culturalCoherence: string;
    evidenceQuality: string;
    classification: string;
    notMeasured: string[];
  };
  /** Ordered by relative position (closest first), then territory id. */
  territories: TerritoryElasticity[];
  panels: PanelReport[];
  repeatChecks: RepeatCheck[];
  brandTagFilter: TagFilterReport;
  operationalTagPolicy: { version: string; rules: { id: string; matches: string; reason: string }[] };
  classificationPolicy: { status: "PROVISIONAL"; naturalAdjacencyMinMedianPercentile: number; culturalBreakMaxMedianPercentile: number; basis: string };
  indexDecision: { decision: "APPROVED" | "REJECTED_FOR_NOW"; basis: string };
  indexGate: IndexGateReport;
  limitations: Limitation[];
  provenance: ProvenanceRef[];
  trace: MethodologyTrace;
};

/** Shallow structural check for values received over HTTP. The backend validates the full invariants. */
export function isCulturalElasticityResult(value: unknown): value is CulturalElasticityResult {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === ELASTICITY_RESULT_SCHEMA_VERSION && typeof record.methodologyVersion === "string" && Array.isArray(record.territories) && typeof record.indexGate === "object";
}
