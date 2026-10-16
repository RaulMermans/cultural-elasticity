/**
 * Model provider boundary. The runtime depends on this interface only; no provider SDK leaks into the
 * agent loop, the tools or the methodology.
 *
 * A model sees an AgentDecisionContext (a compact view of state built by code) and returns raw
 * decisions, which the runtime validates. For synthesis it sees a FinalizationContext (deterministic
 * results only; never benchmark labels) and returns raw JSON, which the claim validator checks.
 */
import type { AgentModelInfo, EvidenceSufficiencyVerdict, AgentTerritoryResult } from "@cultural-elasticity/shared";
import type { ModelTurn } from "../contracts.js";

export type ToolSpec = { name: string; description: string; inputSchema: Record<string, unknown> };

export type AgentDecisionContext = {
  runId: string;
  iteration: number;
  userQuery: string;
  /** Fields the request fixed explicitly; the interpretation must agree with them. */
  requestFields: { intent?: string; brand?: string; territories?: string[] };
  interpretation: { intent: string; brand: string; territories: string[] } | null;
  phase: string;
  brand:
    | { status: "resolved"; id: string; label: string; type: string; resolution: string }
    | { status: "ambiguous"; input: string; candidates: { id: string; label: string; type: string | null }[] }
    | { status: "not_found" | "unresolved"; query: string | null };
  territories: {
    key: string;
    label: string;
    role: string;
    origin: string;
    status: string;
    concept: { id: string; label: string; type: string } | null;
    representation: { entityType: string; exemplars: { id: string; label: string }[]; diversity: string } | null;
    attemptsLeft: number;
    rejectedExemplars: { label: string; code: string; reason: string }[];
    /** Brand-independent exemplar candidates Qloo returned for the concept (eligible only). */
    exemplarCandidates: { type: string; id: string; label: string; popularity: number | null; support: string }[];
    analysisRoute: string | null;
  }[];
  evidence: {
    observedTags: { id: string; label: string; type: string }[];
    brandProfile: { id: string; label: string }[] | null;
    relatedEntities: { id: string; label: string; profiled: boolean }[];
    /** Concepts carried by Qloo-related entities but not by the brand (deterministically derived). */
    frontierConcepts: { tagId: string; label: string; support: number }[];
    duplicateWarnings: string[];
  };
  sufficiency: { verdict: EvidenceSufficiencyVerdict; reasons: string[]; nextSteps: string[] };
  budget: { iterationsLeft: number; qlooCallsLeft: number; maxActionsPerTurn: number; maxExemplarsPerTerritory: number; maxCandidateTerritories: number };
  plan: string[];
  lastTurn: { results: { tool: string; status: string; summary: string; data?: unknown }[]; rejections: { action: string; code: string; reason: string }[] } | null;
  clarifications: string[];
  tools: ToolSpec[];
};

export type FinalizationContext = {
  userQuery: string;
  intent: string | null;
  brand: { label: string; id: string } | null;
  territories: ReturnType<typeof import("../prompts.js").synthesisTerritoryView>[];
  runLimitations: string[];
  finalSufficiency: EvidenceSufficiencyVerdict;
};

export type SynthesisTurn = { output: unknown; usage?: { inputTokens: number; outputTokens: number } } | { invalid: string; usage?: { inputTokens: number; outputTokens: number } };

export interface AgentModel {
  readonly info: AgentModelInfo;
  decide(context: AgentDecisionContext): Promise<ModelTurn>;
  /**
   * Optional: models that write no synthesis get the deterministic template.
   * `feedback` lists claim-validation violations of the previous attempt.
   */
  synthesize?(context: FinalizationContext, feedback: string[]): Promise<SynthesisTurn>;
}

export type { AgentTerritoryResult };
