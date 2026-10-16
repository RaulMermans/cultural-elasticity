// Agentic Investigation Runtime output contract (Sprint 3). Provider-independent.
//
// The agent decides WHAT to investigate. Every number and class below is produced by deterministic
// backend code from Qloo evidence; the model's only free text is the summary, which is validated
// against these values before it is returned. Capabilities that a territory's evidence cannot support
// are reported as unavailable: never as zero, never filled in with prose.

import type { Limitation } from "./analysis.js";
import type { CulturalElasticityResult, ElasticityClass, RobustnessLevel } from "./methodology.js";

export const AGENT_RESULT_SCHEMA_VERSION = "ce-agent-result/0.1" as const;

export type AgentIntent = "analyze_move" | "compare_territories" | "explore_frontier";

export type AgentRunStatus = "INTAKE" | "PLANNING" | "RESOLVING" | "INVESTIGATING" | "ANALYZING" | "NEEDS_INPUT" | "COMPLETE" | "FAILED" | "BUDGET_EXHAUSTED";

export type EvidenceSufficiencyVerdict = "SUFFICIENT" | "MORE_EVIDENCE_USEFUL" | "NEEDS_USER_INPUT" | "INSUFFICIENT" | "BUDGET_EXHAUSTED";

/** How a territory is represented in Qloo terms. Chosen from observed Qloo structure, never from the territory's name. */
export type RepresentationStrategy =
  | "ENTITY_PANEL"
  | "PLACE_PANEL"
  | "TAG_DERIVED_ENTITY_PANEL"
  | "CONDITIONED_ENTITY_EVIDENCE"
  | "DESCRIPTIVE_ONLY"
  | "UNSUPPORTED";

/** Which analysis the evidence supports. Selected by a deterministic router. */
export type AnalysisRoute = "FULL_RELATIVE_ANALYSIS" | "PARTIAL_CULTURAL_ANALYSIS" | "DESCRIPTIVE_ANALYSIS" | "INSUFFICIENT_EVIDENCE";

/**
 * AVAILABLE      computed from evidence
 * INSUFFICIENT   attempted, but the evidence is too thin for the measure (e.g. one exemplar → no robustness)
 * EMPTY          the call was made and Qloo returned nothing (observed absence, not missing data)
 * UNAVAILABLE    this route cannot produce the measure
 * NOT_COLLECTED  the measure was possible but the evidence was not gathered (budget or agent choice)
 */
export type CapabilityStatus = "AVAILABLE" | "INSUFFICIENT" | "EMPTY" | "UNAVAILABLE" | "NOT_COLLECTED";

export type CapabilityAvailability = {
  representation: "SUPPORTED" | "PARTIAL" | "UNSUPPORTED";
  relativePosition: CapabilityStatus;
  robustness: CapabilityStatus;
  coherence: CapabilityStatus;
  conditionedEvidence: CapabilityStatus;
  classification: CapabilityStatus;
};

/** Small failure taxonomy for representation and analysis problems (used by evals). */
export type RepresentationFailureCode =
  | "ENTITY_UNRESOLVED"
  | "TERRITORY_AMBIGUOUS"
  | "TERRITORY_UNRESOLVED"
  | "NO_VALID_REPRESENTATION"
  | "INSUFFICIENT_EXEMPLARS"
  | "MIXED_ENTITY_TYPES"
  | "EXEMPLAR_SEMANTIC_MISMATCH"
  | "BRAND_CONDITIONED_SELECTION"
  | "BRAND_AS_EXEMPLAR"
  | "DUPLICATE_EXEMPLAR"
  | "NEAR_DUPLICATE_EXEMPLAR"
  | "EXEMPLAR_EVIDENCE_EMPTY"
  | "LOW_REPRESENTATION_ROBUSTNESS"
  | "QLOO_EMPTY"
  | "QLOO_DEGRADED"
  | "METHODOLOGY_NOT_APPLICABLE"
  | "COMPARISON_SET_TOO_SMALL"
  | "DUPLICATE_TERRITORY"
  | "BUDGET_EXHAUSTED"
  | "NOT_INVESTIGATED";

export type TerritoryRole = "target" | "reference" | "frontier_candidate";
export type TerritoryOrigin = "user" | "agent_hypothesis" | "qloo_evidence";

export type AgentExemplarView = {
  id: string;
  label: string;
  type: string;
  role: "primary" | "alternate";
  /** Why the agent chose it (concise; recorded at selection time). */
  selectionReason: string;
  /** How Qloo itself links this entity to the territory concept. */
  conceptSupport: "tag_member" | "profile_tag";
  /** Qloo popularity from the call that surfaced it (scale undocumented; shown, never computed with). */
  popularity: number | null;
};

export type AgentRepresentationView = {
  strategy: RepresentationStrategy;
  entityType: string | null;
  exemplars: AgentExemplarView[];
  rejectedExemplars: { id: string | null; label: string; code: RepresentationFailureCode; reason: string }[];
  /** "unknown" whenever Qloo evidence cannot establish distinctness. Never invented. */
  diversity: "adequate" | "low" | "unknown";
  diversityDetail: string;
  attempts: number;
  summary: string;
  failure: { code: RepresentationFailureCode; detail: string } | null;
};

export type AgentTerritoryResult = {
  key: string;
  label: string;
  role: TerritoryRole;
  origin: TerritoryOrigin;
  rationale: string;
  resolvedConcept: { id: string; label: string; type: string } | null;
  representation: AgentRepresentationView;
  analysisRoute: AnalysisRoute;
  capabilities: CapabilityAvailability;
  /** Present only for FULL_RELATIVE_ANALYSIS: every relative statement holds only for this set. */
  comparisonSet: { territoryKeys: string[]; labels: string[]; methodologyVersion: string } | null;
  relativePosition: { position: number | null; of: number; medianPercentile: number | null; medianRank: number | null } | null;
  robustness: { level: RobustnessLevel; percentileSpread: number | null; panelledExemplars: number; declaredExemplars: number; reasons: string[] } | null;
  coherence: {
    rawSharedMedian: number | null;
    filteredSharedMedian: number | null;
    filteredBand: string | null;
    exemplarsCompared: number;
    consistentlyShared: { id: string; label: string }[];
  } | null;
  conditionedEvidence: { support: string; entityCount: number; topEntities: { label: string; rank: number }[]; correlationId: string | null } | null;
  evidenceQuality: { level: "HIGH" | "MEDIUM" | "LOW"; drivers: string[] } | null;
  classification: { label: ElasticityClass; status: "PROVISIONAL"; reasons: string[] } | null;
  /** Deterministic one-line statements, each traceable to a value above. */
  keyEvidence: string[];
  limitations: Limitation[];
  provenance: { correlationIds: string[]; sources: string[] };
};

export type AgentModelInfo = {
  id: string;
  /** "llm" = a live model provider; "scripted" and "baseline" are deterministic test/reference policies. */
  kind: "llm" | "scripted" | "baseline";
  live: boolean;
};

export type AgentDecisionTrace = {
  action: string;
  tool?: string;
  arguments?: unknown;
  reasonSummary: string;
  accepted: boolean;
  rejection?: string;
};

export type AgentToolCallTrace = {
  id: string;
  iteration: number;
  tool: string;
  permission: "read_only_external" | "local_computation" | "side_effect";
  arguments: unknown;
  status: "ok" | "empty" | "needs_input" | "failed" | "rejected";
  summary: string;
  qlooOperations: string[];
  correlationIds: string[];
  attempts: number;
  latencyMs: number;
  error?: string;
};

export type AgentTrace = {
  runId: string;
  intent: AgentIntent | null;
  userQuery: string;
  interpretedRequest: { intent: AgentIntent; brand: string; territories: string[] } | null;
  model: AgentModelInfo;
  toolProvider: { name: string; mode: "live" | "scripted" };
  limits: Record<string, number>;
  statusTransitions: { iteration: number; from: AgentRunStatus; to: AgentRunStatus; reason: string }[];
  planRevisions: { iteration: number; items: string[]; note: string | null }[];
  turns: { iteration: number; decisions: AgentDecisionTrace[]; usage: { inputTokens: number; outputTokens: number } | null; latencyMs: number; invalidOutput?: string }[];
  toolCalls: AgentToolCallTrace[];
  resolvedEntities: { role: string; id: string; label: string; type: string; match: string | null; resolution: string }[];
  territoryHypotheses: { key: string; label: string; role: TerritoryRole; origin: TerritoryOrigin; status: string; rationale: string }[];
  representations: { territoryKey: string; attempt: number; accepted: string[]; rejected: { label: string; code: RepresentationFailureCode; reason: string }[] }[];
  sufficiency: { iteration: number; verdict: EvidenceSufficiencyVerdict; reasons: string[] }[];
  methodologyInvocations: { id: string; territoryKeys: string[]; entityType: string; panelIds: string[]; correlationIds: string[]; methodologyVersion: string }[];
  synthesis: { source: "model" | "deterministic_template"; attempts: number; violations: string[] } | null;
  errors: { iteration: number; code: string; detail: string }[];
  userClarifications: string[];
};

export type AgentMetrics = {
  agent_iterations: number;
  qloo_calls: number;
  tool_calls: number;
  tool_success_rate: number | null;
  invalid_actions: number;
  representation_attempts: number;
  territories_proposed: number;
  territories_resolved: number;
  territories_rejected: number;
  full_analysis_count: number;
  partial_analysis_count: number;
  descriptive_analysis_count: number;
  unsupported_count: number;
  methodology_calls: number;
  latency_ms: number;
  model_input_tokens: number;
  model_output_tokens: number;
  retry_count: number;
  budget_exhausted: boolean;
};

export type AgentAnalysisResult = {
  schemaVersion: typeof AGENT_RESULT_SCHEMA_VERSION;
  runId: string;
  status: "COMPLETE" | "BUDGET_EXHAUSTED" | "FAILED";
  finalSufficiency: EvidenceSufficiencyVerdict;
  intent: AgentIntent | null;
  userQuery: string;
  brand: { id: string; label: string; type: string; resolution: string } | null;
  territories: AgentTerritoryResult[];
  /** Full deterministic methodology outputs, one per comparison set. */
  methodologyRuns: { id: string; territoryKeys: string[]; result: CulturalElasticityResult }[];
  summary: { text: string; source: "model" | "deterministic_template"; claimValidation: { passed: boolean; violations: string[] } };
  followUpOptions: string[];
  limitations: Limitation[];
  /** "synthetic" whenever any evidence came from the scripted synthetic world. Never presented as live. */
  evidenceOrigin: "live" | "synthetic";
  model: AgentModelInfo;
  trace: AgentTrace;
  metrics: AgentMetrics;
};

export type AgentNeedsInputResponse = {
  schemaVersion: typeof AGENT_RESULT_SCHEMA_VERSION;
  runId: string;
  status: "NEEDS_INPUT";
  question: string;
  ambiguity: string;
  options: { id: string; label: string; type?: string }[];
  model: AgentModelInfo;
  trace: AgentTrace;
  metrics: AgentMetrics;
};

export type AgentRunResponse = AgentAnalysisResult | AgentNeedsInputResponse;

export function isAgentRunResponse(value: unknown): value is AgentRunResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === AGENT_RESULT_SCHEMA_VERSION && typeof record.runId === "string" && typeof record.status === "string" && typeof record.trace === "object";
}
