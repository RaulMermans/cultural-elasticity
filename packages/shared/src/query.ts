// Query Intelligence contract (Sprint 5B.1). Provider-independent.
//
// Natural language is the control interface; the investigation capabilities are fixed. A model may PROPOSE how a
// query maps onto them. Only deterministic backend code approves an execution, and only an EXECUTABLE interpretation
// reaches the agent runtime. Nothing here is Qloo evidence: brand and territory names are the user's words until the
// runtime resolves them against Qloo in the investigation itself.

import type { AgentIntent, AgentRunResponse, AnalysisRoute, TerritoryEvidenceStatus } from "./agent.js";

export const QUERY_SCHEMA_VERSION = "ce-query/0.1" as const;

/** The operations the runtime executes today. */
export const EXECUTABLE_QUERY_INTENTS = ["explore_frontier", "analyze_move", "compare_territories"] as const;
/** Operations on an existing investigation; each resolves to an executable intent, a navigation, or a question. */
export const CONTEXTUAL_QUERY_INTENTS = ["refine_territory", "switch_territory", "return_to_parent", "clarify_reference"] as const;
/** Recognized but not implemented: reported as unsupported, never converted silently into a supported operation. */
export const DEFERRED_QUERY_INTENTS = ["compare_brands", "competitor_whitespace", "bridge_builder", "multi_brand_portfolio_analysis"] as const;
export const QUERY_INTENTS = [...EXECUTABLE_QUERY_INTENTS, ...CONTEXTUAL_QUERY_INTENTS, ...DEFERRED_QUERY_INTENTS, "out_of_scope"] as const;
export type QueryIntent = (typeof QUERY_INTENTS)[number];

export type QueryDisposition = "EXECUTABLE" | "NEEDS_CLARIFICATION" | "PARTIALLY_SUPPORTED" | "UNSUPPORTED" | "CONTEXT_UNAVAILABLE" | "NAVIGATION";

/**
 * UI-facing state of one query. INVESTIGATION_STARTED is the asynchronous preview: the gate has accepted the
 * investigation and it is still running. A terminal state replaces it when the run finishes.
 */
export const QUERY_STATES = [
  "INTERPRETED",
  "NEEDS_CLARIFICATION",
  "UNSUPPORTED_OPERATION",
  "PARTIALLY_SUPPORTED",
  "CONTEXT_UNAVAILABLE",
  "INTERPRETATION_FAILED",
  "RETURNED_TO_INVESTIGATION",
  "INVESTIGATION_STARTED",
  "INVESTIGATION_NEEDS_INPUT",
  "INVESTIGATION_COMPLETED",
  "INVESTIGATION_INCOMPLETE",
  "INVESTIGATION_FAILED",
] as const;
export type QueryState = (typeof QUERY_STATES)[number];

/** How the parent-child relationship came about. An Atlas edge is an investigation step, never a cultural distance. */
export type InvestigationOperation = "NEW_INVESTIGATION" | "FOLLOW_UP" | "REFINE_TERRITORY" | "SWITCH_TERRITORY" | "CHANGE_BRAND";

export type FieldSource = "EXPLICIT" | "INHERITED" | "UNRESOLVED";

export type QueryReasonCode = { code: string; detail: string };

export type QueryInterpretation = {
  schemaVersion: typeof QUERY_SCHEMA_VERSION;
  rawQuery: string;
  primaryIntent: QueryIntent;
  secondaryIntents: QueryIntent[];
  /** The brand the operation is about. INHERITED means taken from the server's own record of the parent run. */
  brand: { name: string | null; source: FieldSource; inheritedId?: string };
  /** Every brand the query named (more than one is either a deferred multi-brand operation or an ambiguity). */
  brandsNamed: string[];
  territories: { name: string; source: "EXPLICIT" | "INHERITED" }[];
  references: { parentRunId?: string; selectedTerritoryKey?: string; returnToRunId?: string };
  /** User qualifiers, preserved verbatim. They are passed to the investigation; the methodology does not filter by them. */
  constraints: string[];
  unresolvedReferences: string[];
  /** Instructions aimed at the system itself (overrides, forced results, credentials, tools, budgets). Never authorized. */
  systemDirectives: string[];
  confidence: "HIGH" | "MEDIUM" | "LOW";
  disposition: QueryDisposition;
  clarificationQuestion?: string;
  unsupportedCapabilities: string[];
  interpretationWarnings: string[];
  /** Deterministic reasons for every rejection, deferral or clarification. */
  reasonCodes: QueryReasonCode[];
  interpreter: { kind: "llm" | "scripted" | "structural"; model?: string; effort?: string };
};

/** The exact, validated arguments handed to the agent runtime. */
export type QueryHandoff = { intent: AgentIntent; brand: string; territories: string[]; operation: InvestigationOperation };

/** A smaller supported task. Never equivalent to the request; executing it needs the user's explicit confirmation. */
export type SupportedAlternative = { description: string; handoff: QueryHandoff; equivalent: false; confirmQueryId: string };

/** Parent-child link recorded on a run (server-side; the client only ever sends run ids and territory keys). */
export type InvestigationLink = {
  queryId: string;
  operation: InvestigationOperation;
  parentRunId: string | null;
  selectedTerritoryKey: string | null;
  /** Brand carried from the parent run. The child re-resolves it in Qloo; its classification and positions are never inherited. */
  inheritedBrand: { id: string; label: string } | null;
  constraints: string[];
  reason: string;
};

/** One investigation as the Living Atlas sees it. Built from the backend's in-memory runs only. */
export type InvestigationNode = {
  runId: string;
  parentRunId: string | null;
  operation: InvestigationOperation;
  selectedTerritoryKey: string | null;
  intent: AgentIntent | null;
  status: string;
  brand: { id: string; label: string } | null;
  territories: { key: string; label: string; role: string; evidenceStatus: TerritoryEvidenceStatus | null; analysisRoute: AnalysisRoute | null }[];
};

export type InvestigationContextView = {
  current: InvestigationNode;
  /** Current node first, then each ancestor still held by this process. */
  lineage: InvestigationNode[];
  /** True when an ancestor was evicted or the process restarted: continuity is not invented past this point. */
  lineageTruncated: boolean;
  children: string[];
};

/**
 * A territory node for the Atlas. NOT_INVESTIGATED: named but never sent to Qloo (e.g. an unsupported operation).
 * INVESTIGATED: the runtime handled it; evidenceStatus and analysisRoute then say what Qloo supported, including UNSUPPORTED.
 */
export type QueryTerritoryNode = {
  name: string;
  investigationState: "NOT_INVESTIGATED" | "INVESTIGATED";
  territoryKey: string | null;
  evidenceStatus: TerritoryEvidenceStatus | null;
  analysisRoute: AnalysisRoute | null;
};

export type QueryTelemetry = {
  queryId: string;
  schemaVersion: typeof QUERY_SCHEMA_VERSION;
  intent: QueryIntent | null;
  secondaryIntents: QueryIntent[];
  explicitFields: string[];
  inheritedFieldNames: string[];
  clarificationRequired: boolean;
  validationOutcome: QueryDisposition | null;
  selectedCapability: AgentIntent | null;
  routingOutcome: QueryState;
  parentRunId: string | null;
  childRunId: string | null;
  interpretationLatencyMs: number;
  interpretationTokens: { input: number; output: number };
  interpretationCostUsd: number | null;
  repairAttempts: number;
  executionHandOffStatus: "NOT_ATTEMPTED" | "HANDED_OFF" | "REFUSED";
  errorCodes: string[];
  /** The raw query is not stored in telemetry: only its length and a short hash. */
  queryChars: number;
  queryHash: string;
};

export type QueryResponse = {
  schemaVersion: typeof QUERY_SCHEMA_VERSION;
  queryId: string;
  state: QueryState;
  interpretation: QueryInterpretation | null;
  /** Every deterministic reason code behind this state (also when no interpretation exists, e.g. context unavailable). */
  reasons: QueryReasonCode[];
  /** Present when the gate approved an execution (also on a dry run). */
  handoff: QueryHandoff | null;
  supportedAlternative: SupportedAlternative | null;
  context: InvestigationContextView | null;
  /** The investigation run, when one was executed or returned to. `result` is the unchanged agent result contract. */
  investigation: { runId: string; reused: boolean; link: InvestigationLink | null; result: AgentRunResponse | null } | null;
  territories: QueryTerritoryNode[];
  /** Follow-up operations the runtime can execute from here (capabilities, not suggestions of content). */
  nextOperations: QueryIntent[];
  telemetry: QueryTelemetry;
};

