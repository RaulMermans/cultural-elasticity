/**
 * Model provider boundary. The runtime depends on this interface only; no provider SDK leaks into the
 * agent loop, the tools or the methodology.
 *
 * A model sees an AgentDecisionContext (a compact view of state built by code) and returns raw
 * decisions, which the runtime validates. For synthesis it sees a FinalizationContext (deterministic
 * results only; never benchmark labels) and returns raw JSON, which the claim validator checks.
 */
import type { AgentModelInfo, EvidenceSufficiencyVerdict, AgentTerritoryResult, NextActionValue } from "@cultural-elasticity/shared";
import type { ModelTurn, ModelUsage } from "../contracts.js";

export type ToolSpec = { name: string; description: string; inputSchema: Record<string, unknown> };

/** Sprint 5A: the critical next step, first in the context (objective → stage → blocker → allowed actions). */
export type DecisionFocus = {
  objective: string;
  stage: string;
  activeSkills: string[];
  blocker: string | null;
  /** The exact outstanding requirements, phrased as instructions from deterministic state. */
  outstanding: string[];
  nextAllowed: string[];
  budget: { turnsLeft: number; qlooCallsLeft: number };
  /** Approaches already refused or failed in this run (do not repeat them). */
  rejectedApproaches: string[];
  /** Sprint 9N: the deterministic comparison-feasibility assessment (comparative runs only). Read-only. */
  feasibility?: FeasibilityView;
  /** Sprint 10B: tools a skill used earlier in the run no longer offers, with the deterministic reason it closed. */
  withdrawn?: string[];
};

/** Sprint 9N: what the model sees of comparison-feasibility/v1 (feasibility.ts). */
export type FeasibilityView = {
  status: "FEASIBLE" | "UNCERTAIN" | "INFEASIBLE";
  blocker: string | null;
  nextAction: string | null;
  target: string;
  comparisonSet: string;
  candidates: string;
  referenceProbes: string;
  capacity: string;
  stopReasons: string[];
};

export type AgentDecisionContext = {
  focus?: DecisionFocus;
  runId: string;
  iteration: number;
  userQuery: string;
  /** Fields the request fixed explicitly; the interpretation must agree with them. */
  requestFields: { intent?: string; brand?: string; territories?: string[]; researchMode?: string };
  /** Sprint 11 (research policy v1): objective, approach, concept judgments and the Brand Intelligence Brief. */
  research?: {
    brief: import("@cultural-elasticity/shared").ResearchBrief | null;
    approach: import("@cultural-elasticity/shared").ResearchApproachRecord | null;
    conceptAlignments: (import("@cultural-elasticity/shared").ConceptAlignment & { territoryKey: string })[];
    brand: { facts: { ref: number; statement: string; source: string }[]; positioning: string | null; qlooCategoryTags: string[] | null; unverified: string[] } | null;
  };
  interpretation: { intent: string; brand: string; territories: string[] } | null;
  phase: string;
  brand:
    | { status: "resolved"; id: string; label: string; type: string; resolution: string }
    | { status: "ambiguous"; input: string; candidates: { id: string; label: string; type: string | null }[] }
    | { status: "not_found" | "unresolved"; query: string | null };
  /** Skills the runtime activated for this turn (just-in-time), with their procedures. */
  skills: { id: string; version: number; purpose: string; procedure: string }[];
  territories: {
    key: string;
    label: string;
    role: string;
    origin: string;
    status: string;
    readiness: string;
    concept: { id: string; label: string; type: string } | null;
    representation: { entityType: string; exemplars: { id: string; label: string; quality: string }[]; diversity: string } | null;
    analysisRoute: string | null;
    dropReason?: string | null;
    /** Present only while the territory is being represented. */
    attemptsLeft?: number;
    rejectedExemplars?: { label: string; code: string; reason: string }[];
    /** Brand-independent exemplar candidates Qloo returned for the concept (eligible only). */
    exemplarCandidates?: { type: string; id: string; label: string; popularity: number | null; support: string; profiled: boolean }[];
    recovery?: unknown;
    /** Sprint 5A: state-grounded recovery steps (what failed, what remains, which tools). */
    recoveryGuidance?: string[];
    /** Sprint 5A: brand-independent probes already made for this territory's candidate concepts. */
    probes?: { tagId: string; label: string; probes: { type: string; members: number }[] }[];
    /** Sprint 5A.2: the evidence-ranked next probe (priority and reason, the namespace evidence behind it, slots left). */
    nextProbe?: { tagId: string; entityType: string; priority: string; reason: string; namespace: string; namespaceEvidence: string[]; tested: string[]; emptyProbesLeft: number; call: string };
  }[];
  /** Only the sections the active skills require. */
  evidence: {
    observedTags?: { id: string; label: string; type: string }[];
    brandProfile?: { id: string; label: string }[] | null;
    relatedEntities?: { id: string; label: string; profiled: boolean }[];
    /** Concepts carried by Qloo-related entities but not by the brand (deterministically derived). */
    frontierConcepts?: { tagId: string; label: string; support: number; canonicalKey?: string; probes?: { type: string; members: number }[]; facet?: string | null; facetRole?: string | null; domainRelation?: string; supportedBy?: string[] }[];
    /** Sprint 10A: baseline-scan entities this explore run starts from (observations, never support). */
    seeds?: { id: string; label: string; domain: string; profiled: boolean }[];
    /** Sprint 10A: facets of the brand's own Qloo tag profile (what "within"/"outside" the brand's profile means). */
    brandProfileFacets?: string[];
    /** Sprint 5A.1: the entity type the comparison can share, and what each territory still needs for it. */
    representationPlan?: { preferredCommonType: string | null; feasibility: string; supportedTerritoriesByType: Record<string, string[]>; missingRequirements: string[] };
    referenceCandidates?: { tagId: string; label: string; namespace: string; namespaceYield: string; probe: { entityType: string; eligible: number } | null; usable: boolean | null; semantic: string; justification: string; typeEvidence?: number }[];
    /** Sprint 5A: the deterministic reference plan (needed, feasible, rejected candidates and why). */
    referencePlan?: { entityType: string | null; required: number; valid: number; needed: number; pending: string[]; feasible: boolean; reason: string; rejectedCandidates: { label: string; status: string; reasonCode: string }[]; turnsNeeded?: number; turnsLeft?: number };
    conceptDedup?: string[];
    analysisResults?: { key: string; route: string; classification: string | null; robustness: string | null }[];
    /** Sprint 8D: ids and queries that cannot change the result if requested again. */
    alreadyCollected?: { profiledEntityIds: string[]; searchedQueries: string[] };
    recentConceptQueries?: { tagId: string; entityType: string; brandConditioned: boolean; outcome: string; members: number; correlationId: string }[];
  };
  /** Sprint 5A: nextSteps and the open plan moved into `focus` (one authoritative statement of what remains). */
  sufficiency: { verdict: EvidenceSufficiencyVerdict; reasons: string[]; nextActions: NextActionValue[]; materialGap: boolean };
  budget: { iterationsLeft: number; qlooCallsLeft: number; maxActionsPerTurn: number; maxExemplarsPerTerritory: number; maxCandidateTerritories: number; skillQlooCallsLeft: Record<string, number> };
  lastTurn: { results: { tool: string; status: string; summary: string; data?: unknown }[]; rejections: { action: string; code: string; reason: string }[] } | null;
  clarifications: string[];
  tools: ToolSpec[];
  /** Terminal actions (analyze / ask_user / finish) the active skills allow this turn. */
  actions: string[];
  /** Set on the single bounded repair attempt: the validator's actionable rejections of the first attempt. */
  repair: { attempt: 2; rejections: { action: string; code: string; reason: string }[] } | null;
};

export type FinalizationContext = {
  userQuery: string;
  intent: string | null;
  brand: { label: string; id: string } | null;
  territories: ReturnType<typeof import("../prompts.js").synthesisTerritoryView>[];
  runLimitations: string[];
  finalSufficiency: EvidenceSufficiencyVerdict;
  /** Sprint 11 (research policy v1): the question as the user meant it and the brand context; selects the two-layer synthesis. */
  research?: {
    researchBrief: import("@cultural-elasticity/shared").ResearchBrief | null;
    approach: import("@cultural-elasticity/shared").ResearchApproachRecord | null;
    brandIntelligence: { facts: { ref: number; statement: string; source: string }[]; positioning: string | null; qlooCategoryTags: string[] } | null;
  };
};

export type SynthesisTurn = { output: unknown; usage?: ModelUsage } | { invalid: string; usage?: ModelUsage };

export interface AgentModel {
  readonly info: AgentModelInfo;
  decide(context: AgentDecisionContext): Promise<ModelTurn>;
  /**
   * Optional: models that write no synthesis get the deterministic template.
   * `feedback` lists claim-validation violations of the previous attempt.
   */
  synthesize?(context: FinalizationContext, feedback: string[]): Promise<SynthesisTurn>;
  /**
   * Sprint 10C: a durable replay reused a committed decision for `context` instead of calling `decide`. A LOCAL policy
   * that keeps memory across turns (the baseline reference policy, scripted test models) updates it here; it must never
   * call a provider. A stateless adapter (the Anthropic model: one request per decision) omits it.
   */
  replay?(context: AgentDecisionContext): Promise<void>;
  /** Sprint 10C: the same for a reused synthesis. */
  replaySynthesis?(context: FinalizationContext, feedback: string[]): Promise<void>;
}

export type { AgentTerritoryResult };
