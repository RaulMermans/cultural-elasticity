// Agentic Investigation Runtime output contract (Sprint 3; Sprint 4 adds skills, representation quality,
// concept deduplication, comparison-set construction, next-action value and model reliability telemetry).
// Provider-independent.
//
// The agent decides WHAT to investigate. Every number and class below is produced by deterministic
// backend code from Qloo evidence; the model's only free text is the summary, which is validated
// against these values before it is returned. Capabilities that a territory's evidence cannot support
// are reported as unavailable: never as zero, never filled in with prose.

import type { Limitation } from "./analysis.js";
import type { CulturalElasticityResult, ElasticityClass, RobustnessLevel } from "./methodology.js";

/**
 * 0.3 (Sprint 5A, additive): semantic comparison assessments, grounded findings, synthesis attempt details,
 * model effort, reference-plan and latency telemetry. Every 0.2 field is unchanged.
 * Sprint 5A.1 adds only OPTIONAL fields under the same version (candidate canonicalization, evidence status, probe
 * views, representation plans, completion checks, frontier candidate pool, probe metrics): a 0.3 reader keeps working.
 */
export const AGENT_RESULT_SCHEMA_VERSION = "ce-agent-result/0.3" as const;

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
  | "NOT_INVESTIGATED"
  /** Every surviving exemplar was WEAK under the representation-quality rules (no VALID primary). */
  | "REPRESENTATION_QUALITY_WEAK"
  /** The same (concept, entity type) strategy failed repeatedly; the runtime refuses to retry it. */
  | "STRATEGY_EXHAUSTED"
  /** An agent hypothesis that Qloo does not support (no concept, or no brand-independent members). */
  | "HYPOTHESIS_UNSUPPORTED"
  /** Dropped to keep the frontier set conceptually diverse. */
  | "LOW_DIVERSITY"
  /** Sprint 5A: a venue-listing attribute or operational tag, not a cultural territory. */
  | "INCIDENTAL_CONCEPT"
  /** Sprint 5A: a reference the semantic comparison validator did not accept. */
  | "SEMANTIC_REFERENCE_REJECTED";

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
  /** Representation-quality outcome (Sprint 4): WEAK exemplars are only ever alternates. */
  quality?: "VALID" | "WEAK";
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
  comparisonSet: { territoryKeys: string[]; labels: string[]; methodologyVersion: string; semanticStatus?: SemanticComparisonStatus } | null;
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
  /** Sprint 5A.1 (additive): how the candidate's concept was canonicalized (frontier reproducibility). */
  candidate?: CandidateCanonicalization;
  /** Sprint 5A.1 (additive): evidence status for the UI. A connected node never implies a measured distance. */
  evidenceStatus?: TerritoryEvidenceStatus;
  /** Sprint 5A.1 (additive): brand-independent entity-type probes of the territory's concepts, and why probing stopped. */
  probes?: ConceptProbeView[];
};

/**
 * Sprint 5A.1. EVIDENCE_SUPPORTED_TERRITORY: a FULL relative analysis (positions hold only within its comparison
 * set). PARTIAL_EVIDENCE: partial or descriptive Qloo evidence. UNSUPPORTED: Qloo does not support it.
 * HYPOTHESIS_PENDING_VALIDATION: proposed but not yet validated (never present in a finished result).
 */
export type TerritoryEvidenceStatus = "EVIDENCE_SUPPORTED_TERRITORY" | "PARTIAL_EVIDENCE" | "HYPOTHESIS_PENDING_VALIDATION" | "UNSUPPORTED";

/** Sprint 5A.1: one concept's entity-type probes (counted from brand-independent pools; errors are not probes). */
export type ConceptProbeView = {
  conceptKey: string;
  label: string;
  /** Sprint 5A.2: the concept's Qloo tag namespace (category:source, e.g. "genre:media"). */
  namespace?: string;
  attemptedTypes: string[];
  emptyTypes: string[];
  successfulTypes: string[];
  /** Probes whose Qloo call was partial or degraded: not evidence that the type is unsupported. */
  unreliableTypes: string[];
  totalEmptyTypeProbes: number;
  probingExhausted: boolean;
  exhaustionReason: string | null;
};

/**
 * Sprint 5A.1: canonical identity of a candidate concept. Deduplication order: exact Qloo id → canonical tag name →
 * normalized label → token-containment alias (recorded as uncertain, never merged) → no semantic merge.
 */
export type CandidateCanonicalization = {
  originalLabel: string;
  /** The Qloo tag that grounded the candidate (its evidence tag), if any. */
  sourceTagId: string | null;
  /** The Qloo concept the territory was anchored to. */
  resolvedId: string | null;
  canonicalConceptKey: string;
  normalizationReason: "SOURCE_TAG_CANONICAL_NAME" | "ANCHORED_TAG_CANONICAL_NAME" | "LABEL_NORMALIZED";
  candidateSource: CandidateSource;
  /** Relation between the source tag and the anchored concept. */
  anchorRelation: "SAME_CONCEPT" | "SAME_CANONICAL_NAME" | "ALIAS_TOKEN_CONTAINMENT" | "DIFFERENT_NAME" | "NOT_ANCHORED" | "NO_SOURCE_TAG";
  /** Set when equivalence between the source tag and the anchored concept is not established. */
  uncertainty: string | null;
};

/**
 * Sprint 5A.2: evidence priority of a recommended probe type. CONCEPT_MEMBERS: the type returned members for the
 * concept. NAMESPACE_MEMBERS: for other concepts of its Qloo tag namespace. COMPARISON_TYPE: the comparison's shared type.
 * STRUCTURAL: a same-named concept or an observed profile carries it. EXPLORATION: bounded exploration of the rest.
 */
export type ProbePriority = "CONCEPT_MEMBERS" | "NAMESPACE_MEMBERS" | "COMPARISON_TYPE" | "STRUCTURAL" | "EXPLORATION";

/**
 * Sprint 5A.2: one anchoring decision for a generated candidate. SOURCE_TAG_MEMBERS: the runtime anchored the candidate
 * to its grounding tag once Qloo returned members for it. LABEL_TAG_MEMBERS: the runtime anchored a territory to a tag
 * its own search returned whose canonical name is the territory's name, once that tag returned members. MODEL_ANCHOR: the agent anchored it (same concept or another
 * of its evidence tags). ALTERNATE_WITH_MEMBERS: an accepted alternate anchor (same canonical name or alias, with
 * observed members, the grounding tag having none). REFUSED: an alternate anchor the runtime refused (reasonCode).
 */
export type AnchorDecision = {
  iteration: number;
  territoryKey: string;
  sourceTagId: string | null;
  anchoredTagId: string;
  relation: CandidateCanonicalization["anchorRelation"];
  basis: "SOURCE_TAG_MEMBERS" | "LABEL_TAG_MEMBERS" | "MODEL_ANCHOR" | "ALTERNATE_WITH_MEMBERS" | "REFUSED";
  decidedBy: "runtime" | "agent";
  reasonCode: string | null;
  evidence: string;
  correlationIds: string[];
};

/** Sprint 5A.1: can the territories of one comparison share a Qloo entity type? Planned before expensive anchoring. */
export type ComparisonRepresentationPlan = {
  territoryKeys: string[];
  candidateEntityTypes: string[];
  preferredCommonType: string | null;
  /** Territories with observed brand-independent members (or a representation) of each type. */
  supportedTerritoriesByType: Record<string, string[]>;
  /** Territories that could still reach a type through an untested, non-exhausted probe. */
  possibleTerritoriesByType: Record<string, string[]>;
  feasibility: "SUPPORTED" | "POSSIBLE" | "UNSUPPORTED";
  /** Territories one type must cover for a relative position. */
  required: number;
  missingRequirements: string[];
  reasonCodes: string[];
  rulesVersion: string;
};

/** Sprint 5A.1: can the intended FULL route still be finished within the remaining turns and Qloo calls? */
export type CompletionFeasibility = {
  requiredReferenceCount: number;
  validReferenceCount: number;
  missingReferenceCount: number;
  compatibleEntityType: string | null;
  remainingRelevantCandidates: number;
  remainingTurns: number;
  remainingQlooCalls: number;
  turnsNeeded: number;
  callsNeeded: number;
  fullAnalysisFeasible: boolean;
  reason: string;
};

// ---- Sprint 4: skills, quality, deduplication, comparison sets, next-action value ----

/** Primary failure category of a run or eval case (Sprint 4 taxonomy). */
export const AGENT_FAILURE_CATEGORIES = [
  "MODEL_DECISION_ERROR",
  "TOOL_SELECTION_ERROR",
  "TOOL_ARGUMENT_ERROR",
  "ENTITY_RESOLUTION_ERROR",
  "TERRITORY_RESOLUTION_ERROR",
  "REPRESENTATION_ERROR",
  "EXEMPLAR_SEMANTIC_ERROR",
  "CONCEPT_DUPLICATION_ERROR",
  "EVIDENCE_SUFFICIENCY_ERROR",
  "ANALYSIS_ROUTE_ERROR",
  "QLOO_DATA_LIMIT",
  "QLOO_TOOL_ERROR",
  "BUDGET_EXHAUSTED",
  "CLAIM_VALIDATION_ERROR",
  "BENCHMARK_LABEL_ERROR",
  "METHODOLOGY_ERROR",
  // Sprint 5A
  "SEMANTIC_REFERENCE_ERROR",
  "REPRESENTATION_RECOVERY_FAILURE",
  "REFERENCE_CONSTRUCTION_FAILURE",
  "SYNTHESIS_VALIDATION_FAILURE",
  "SYNTHESIS_FALSE_POSITIVE",
  "INCOMPLETE_LIVE_EVALUATION",
  "FRONTIER_INSTABILITY",
  "AGENT_BUDGET_EXHAUSTED",
] as const;
export type AgentFailureCategory = (typeof AGENT_FAILURE_CATEGORIES)[number];

/** A runtime skill and the version that governed a turn or tool call. */
export type SkillRef = { id: string; version: number };

/** Rule-based expected value of a next action (never a learned or numeric estimate). */
export type ExpectedValue = "HIGH" | "MEDIUM" | "LOW" | "NONE";
export type NextActionValue = { action: string; target: string | null; value: ExpectedValue; reason: string };

export type ExemplarQualityLevel = "VALID" | "WEAK" | "REJECT";
/** The model's ADVISORY semantic judgment. Never Qloo evidence; stored apart from deterministic signals. */
export type SemanticRelevance = "STRONG" | "ADEQUATE" | "WEAK" | "MISMATCH";

export type RepresentationQualityDecision = {
  territoryKey: string;
  attempt: number;
  candidateId: string;
  label: string;
  deterministic: { level: ExemplarQualityLevel; signals: Record<string, string | number | boolean | null>; reasons: string[] };
  modelAssessment: { relevance: SemanticRelevance; reason: string; advisory: true } | null;
  final: ExemplarQualityLevel;
  /** The combination rule that produced `final` (see representation-quality rules). */
  rule: string;
  rulesVersion: string;
};

export type ConceptDedupVerdict = "DUPLICATE" | "NEAR_DUPLICATE" | "DISTINCT";
export type ConceptDedupDecision = {
  a: { key: string; label: string };
  b: { key: string; label: string };
  /** Layer that produced the final verdict. */
  layer: "deterministic" | "structural" | "semantic";
  verdict: ConceptDedupVerdict;
  basis: string;
  /** The model's advisory label, when one was given. */
  modelJudgment: { verdict: ConceptDedupVerdict; reason: string; applied: boolean } | null;
  action: "dropped" | "warned" | "kept";
  dropped: string | null;
};

export type CandidateSource = "user" | "qloo_grounded" | "agent_hypothesis" | "reference_strategy";

export type SemanticComparisonStatus = "MEANINGFUL" | "WEAK" | "INCOMPARABLE" | "UNKNOWN";

/**
 * Sprint 5A: may a comparison set carry a FULL relative analysis? Structure and meaning are judged separately;
 * only a structurally VALID set whose accepted members still number ≥ 3 is used for FULL.
 */
export type SemanticComparisonAssessment = {
  targetTerritoryKey: string;
  referenceTerritoryKeys: string[];
  memberTerritoryKeys: string[];
  entityType: string;
  structuralStatus: "VALID" | "INVALID";
  structuralIssues: string[];
  /** Status of the set after rejected references are removed. */
  semanticStatus: SemanticComparisonStatus;
  acceptedReferences: string[];
  rejectedReferences: { territoryKey: string; reasonCode: string; explanation: string }[];
  /** True when an advisory model judgment was part of the decision (it can only remove a reference). */
  modelAssessed: boolean;
  /** Correlation ids of the Qloo calls that tie accepted references to the question. */
  evidenceReferences: string[];
  usedForFull: boolean;
  rulesVersion: string;
};

/** Sprint 5A: one model-selected, runtime-validated claim about one territory. */
export type GroundedFinding = { territoryKey: string; claimType: string; supportingFields: string[]; interpretation: string; limitationCodes: string[] };

/** How the set of territories that relative results depend on was assembled. Always reported. */
export type ComparisonSetConstruction = {
  intent: AgentIntent | null;
  proposed: { key: string; label: string; role: TerritoryRole; source: CandidateSource; evidence: string }[];
  rejected: { key: string; label: string; stage: "resolution" | "qloo_support" | "representation" | "evidence" | "dedup" | "diversity" | "budget" | "agent" | "semantic"; code: string; reason: string }[];
  final: { key: string; label: string; role: TerritoryRole; source: CandidateSource; route: AnalysisRoute }[];
  dedupDecisions: ConceptDedupDecision[];
  diversity: { assessment: "diverse" | "overlapping" | "unknown"; similarPairs: { a: string; b: string; basis: string }[]; detail: string };
  /** Sprint 5A: every comparison set considered for FULL, with its structural and semantic verdict. */
  semanticAssessments?: SemanticComparisonAssessment[];
  /**
   * Sprint 5A.1 (frontier): the deterministic, evidence-grounded candidate pool the agent chose from, and the related
   * entities whose profiles formed it. Two runs with equal pools that chose differently differ by model choice.
   */
  candidatePool?: { canonicalConceptKey: string; tagId: string; label: string; support: number }[];
  evidenceBase?: string[];
  note: string;
};

/** Three separated layers: what Qloo returned, what deterministic code computed, what the model wrote. */
export type AgentResultLayers = {
  qlooEvidence: {
    brand: { id: string; label: string; correlationId: string | null } | null;
    concepts: { territoryKey: string; id: string; label: string; correlationIds: string[] }[];
    exemplars: { territoryKey: string; id: string; label: string; conceptSupport: string; supportCorrelationId: string }[];
    qlooCalls: number;
  };
  systemAnalysis: {
    routes: { territoryKey: string; route: AnalysisRoute; classification: ElasticityClass | null; position: number | null; robustness: RobustnessLevel | null }[];
    /** Sprint 5A: semantic validity of each comparison set considered for FULL. */
    semanticComparison?: { semanticStatus: SemanticComparisonStatus; structuralStatus: "VALID" | "INVALID"; usedForFull: boolean; memberTerritoryKeys: string[] }[];
    methodologyRunIds: string[];
    finalSufficiency: EvidenceSufficiencyVerdict;
    representationDecisions: { valid: number; weak: number; rejected: number };
  };
  agentInterpretation: {
    summary: string;
    source: "model" | "deterministic_template";
    claimValidationPassed: boolean;
    /** Advisory model judgments, kept apart from Qloo evidence. */
    semanticJudgments: { territoryKey: string; label: string; relevance: SemanticRelevance; reason: string }[];
    followUpOptions: string[];
    /** Sprint 5A: grounded findings the model selected and the runtime validated (empty for the template). */
    findings?: GroundedFinding[];
  };
};

export type AgentModelInfo = {
  id: string;
  /** "llm" = a live model provider; "scripted" and "baseline" are deterministic test/reference policies. */
  kind: "llm" | "scripted" | "baseline";
  live: boolean;
  /** Reasoning effort sent to a live model (Sprint 5A: recorded in every trace). */
  effort?: string;
};

export type AgentDecisionTrace = {
  action: string;
  tool?: string;
  arguments?: unknown;
  reasonSummary: string;
  accepted: boolean;
  rejection?: string;
};

export type AgentTurnTrace = {
  iteration: number;
  decisions: AgentDecisionTrace[];
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number } | null;
  latencyMs: number;
  invalidOutput?: string;
  /** Skills the runtime activated for this turn (just-in-time), with versions. */
  skills?: SkillRef[];
  /** Tools and terminal actions the model was offered this turn. */
  toolsExposed?: string[];
  /** Serialized decision-context size (characters) and a chars/4 token estimate. */
  contextChars?: number;
  contextTokensEstimate?: number;
  /** Model calls this turn (2 = one bounded repair after a validator rejection). */
  modelAttempts?: number;
  repairReason?: string | null;
  /** Every decision of the first model attempt was schema-valid and accepted. */
  firstAttemptValid?: boolean;
};

export type AgentToolCallTrace = {
  id: string;
  iteration: number;
  tool: string;
  skill?: SkillRef | null;
  expectedValue?: ExpectedValue;
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
  turns: AgentTurnTrace[];
  toolCalls: AgentToolCallTrace[];
  resolvedEntities: { role: string; id: string; label: string; type: string; match: string | null; resolution: string }[];
  territoryHypotheses: { key: string; label: string; role: TerritoryRole; origin: TerritoryOrigin; status: string; rationale: string }[];
  representations: { territoryKey: string; attempt: number; accepted: string[]; rejected: { label: string; code: RepresentationFailureCode; reason: string }[] }[];
  sufficiency: { iteration: number; verdict: EvidenceSufficiencyVerdict; reasons: string[]; nextActions?: NextActionValue[]; materialGap?: boolean }[];
  representationQuality: RepresentationQualityDecision[];
  conceptDedup: ConceptDedupDecision[];
  /** Runtime refusals that saved Qloo calls (duplicate actions, no-value calls, exhausted strategies). */
  earlyStops: { iteration: number; tool: string; code: string; reason: string; callsAvoided: number }[];
  /** Calls spent per skill (attribution: the first active skill whose allowlist contains the tool). */
  skillUsage: { skill: SkillRef; turns: number; qlooCalls: number; toolCalls: number }[];
  methodologyInvocations: { id: string; territoryKeys: string[]; entityType: string; panelIds: string[]; correlationIds: string[]; methodologyVersion: string }[];
  synthesis: {
    source: "model" | "deterministic_template";
    attempts: number;
    violations: string[];
    /** Sprint 5A: per-attempt rejection categories and the rejected model output (an answer, never reasoning). */
    attemptDetails?: { attempt: number; accepted: boolean; categories: Record<string, number>; violations: string[]; rejectedOutput?: string }[];
  } | null;
  /** Sprint 5A: comparison sets considered for FULL. */
  semanticAssessments?: SemanticComparisonAssessment[];
  /** Sprint 5A: why the agent stopped, in one reason code + detail. */
  stopReason?: { code: string; detail: string } | null;
  /** Sprint 5A.1: representation-alignment plans, recorded whenever the plan changes. */
  representationPlans?: { iteration: number; plan: ComparisonRepresentationPlan }[];
  /** Sprint 5A.1: completion-feasibility checks, recorded whenever the verdict or reason changes. */
  completion?: ({ iteration: number } & CompletionFeasibility)[];
  /** Sprint 5A.2: every anchoring of a generated candidate (who anchored it, to what, on which Qloo evidence) and refusals. */
  anchorDecisions?: AnchorDecision[];
  /** Sprint 5A.2: the evidence-ranked probe recommended per unresolved territory, recorded whenever it changes. */
  probeRecommendations?: { iteration: number; territoryKey: string; conceptKey: string; namespace: string; type: string; priority: ProbePriority; reason: string }[];
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
  // Sprint 4 reliability and efficiency telemetry
  model_turns: number;
  model_attempts: number;
  first_attempt_valid_turns: number;
  valid_after_repair_turns: number;
  repairs: number;
  unknown_tool_attempts: number;
  invalid_argument_attempts: number;
  unsupported_state_actions: number;
  synthesis_attempts: number;
  calls_avoided: number;
  avg_context_chars: number | null;
  max_context_chars: number | null;
  avg_context_tokens_estimate: number | null;
  model_latency_ms: number;
  qloo_latency_ms: number;
  /** USD from provider-reported usage and a known price table; null when unavailable. */
  model_cost_usd: number | null;
  // Sprint 5A
  model_id?: string;
  model_effort?: string | null;
  synthesis_latency_ms?: number;
  analysis_latency_ms?: number;
  qloo_spacing_ms?: number;
  synthesis_first_attempt_valid?: boolean | null;
  synthesis_valid_after_repair?: boolean | null;
  synthesis_fallback?: boolean;
  reference_deferrals?: number;
  // Sprint 5A.1
  empty_type_probes?: number;
  max_empty_type_probes_per_concept?: number;
  probe_limit_refusals?: number;
  type_alignment_deferrals?: number;
  reference_namespace_refusals?: number;
  // Sprint 5A.2
  successful_type_probes?: number;
  namespace_type_refusals?: number;
  alternate_anchor_refusals?: number;
  source_evidence_anchors?: number;
  frontier_completion_refusals?: number;
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
  /** Skills (with versions) the runtime activated during the run. */
  skillsUsed: SkillRef[];
  /** How the comparison set was assembled; relative results depend on it. */
  comparisonSetConstruction: ComparisonSetConstruction;
  layers: AgentResultLayers;
  /** Primary failure category when the run did not complete with measurable evidence; null otherwise. */
  failureCategory: AgentFailureCategory | null;
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
