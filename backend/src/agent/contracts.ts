/**
 * Agent boundary contracts (zod). Everything the model proposes is validated here before the runtime
 * acts on it: requests, interpretations, decisions and tool arguments. Nothing in this file names a
 * brand, territory or exemplar: the runtime works for any Qloo-resolvable input.
 */
import { z } from "zod";

export const AGENT_INTENTS = ["analyze_move", "compare_territories", "explore_frontier"] as const;
export type AgentIntent = (typeof AGENT_INTENTS)[number];

const text = z.string().trim().min(1);

// ---- Budgets ----

export const investigationLimitsSchema = z.strictObject({
  maxAgentIterations: z.number().int().min(1).max(30),
  maxQlooCalls: z.number().int().min(1).max(120),
  maxRepresentationAttemptsPerTerritory: z.number().int().min(1).max(10),
  maxCandidateTerritories: z.number().int().min(1).max(6),
  maxExemplarsPerTerritory: z.number().int().min(1).max(3),
  maxRetryPerToolCall: z.number().int().min(0).max(1),
  /** Tool calls the model may batch in one turn. Terminal actions (analyze/ask_user/finish) stand alone. */
  maxActionsPerTurn: z.number().int().min(1).max(12),
  /** Consecutive turns with no valid action before the run fails. */
  maxInvalidTurns: z.number().int().min(1).max(5),
  toolTimeoutMs: z.number().int().min(1_000).max(600_000),
});
export type InvestigationLimits = z.output<typeof investigationLimitsSchema>;

/**
 * Sprint 4 limits. Turns are smaller (just-in-time context) and a representation now includes candidate
 * tag profiles for the quality check, so the iteration and call budgets were raised from 8 / 20-30-30.
 * Early stopping (no-value and duplicate calls are refused) keeps runs from spending budget they don't need.
 */
const BASE_LIMITS: Omit<InvestigationLimits, "maxQlooCalls"> = {
  maxAgentIterations: 12,
  maxRepresentationAttemptsPerTerritory: 3,
  maxCandidateTerritories: 6,
  maxExemplarsPerTerritory: 3,
  maxRetryPerToolCall: 1,
  maxActionsPerTurn: 12,
  maxInvalidTurns: 2,
  toolTimeoutMs: 300_000,
};

/** Frontier exploration stops proposing once this many candidates have a non-INSUFFICIENT analysis. */
export const MIN_FRONTIER_SUPPORTED = 3;

/** Starting engineering limits (Sprint 3 spec §25). Configurable per request. */
export const DEFAULT_QLOO_CALLS: Record<AgentIntent, number> = { analyze_move: 24, compare_territories: 32, explore_frontier: 32 };

export function defaultLimits(intent: AgentIntent | undefined): InvestigationLimits {
  return { ...BASE_LIMITS, maxQlooCalls: DEFAULT_QLOO_CALLS[intent ?? "explore_frontier"] };
}

// ---- Request (deterministic intake) ----

export const agentRequestSchema = z.strictObject({
  userQuery: text.max(2_000),
  intent: z.enum(AGENT_INTENTS).optional(),
  brand: text.max(200).optional(),
  territories: z.array(text.max(200)).max(6).optional(),
  limits: investigationLimitsSchema.partial().optional(),
});
export type AgentRequest = z.output<typeof agentRequestSchema>;

// ---- Interpretation (proposed by the model, validated by code) ----

export const interpretationSchema = z
  .strictObject({
    intent: z.enum(AGENT_INTENTS),
    brand: text.max(200),
    territories: z.array(text.max(200)).max(6),
  })
  .superRefine((value, ctx) => {
    const n = value.territories.length;
    if (value.intent === "analyze_move" && n !== 1) ctx.addIssue({ code: "custom", path: ["territories"], message: "analyze_move needs exactly one target territory" });
    if (value.intent === "compare_territories" && n < 2) ctx.addIssue({ code: "custom", path: ["territories"], message: "compare_territories needs at least two territories" });
    if (value.intent === "explore_frontier" && n !== 0) ctx.addIssue({ code: "custom", path: ["territories"], message: "explore_frontier starts with no territories (they are discovered)" });
    const keys = value.territories.map((t) => t.toLowerCase());
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", path: ["territories"], message: "duplicate territories" });
  });
export type Interpretation = z.output<typeof interpretationSchema>;

// ---- Decisions ----

const reasonSummary = z.string().trim().min(1).max(400);

export const callToolDecisionSchema = z.strictObject({
  action: z.literal("call_tool"),
  tool: text,
  arguments: z.unknown(),
  reasonSummary,
});
export const analyzeDecisionSchema = z.strictObject({
  action: z.literal("analyze"),
  targetIds: z.array(text).min(1).max(6),
  reasonSummary,
});
export const askUserDecisionSchema = z.strictObject({
  action: z.literal("ask_user"),
  question: z.string().trim().min(1).max(600),
  ambiguity: z.string().trim().min(1).max(600),
  reasonSummary: reasonSummary.optional(),
});
export const finishDecisionSchema = z.strictObject({
  action: z.literal("finish"),
  resultIds: z.array(text).max(12),
  reasonSummary,
});
export const agentDecisionSchema = z.discriminatedUnion("action", [callToolDecisionSchema, analyzeDecisionSchema, askUserDecisionSchema, finishDecisionSchema]);
export type AgentDecision = z.output<typeof agentDecisionSchema>;

/** What a model returns for one turn, before validation. */
export type ModelTurn = {
  /** Raw decisions (validated by the runtime), or the reason the model output could not be parsed. */
  decisions: unknown[] | { invalid: string };
  /** Provider-reported usage. inputTokens excludes cache reads/writes, which are reported separately. */
  usage?: ModelUsage;
};

export type ModelUsage = { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number };

// ---- Synthesis ----

/**
 * Sprint 5A: the model may answer with grounded findings (preferred) instead of free territory notes. Each finding
 * names one territory, a claim type, the result fields that support it and its limitation codes; the runtime
 * validates the fields and renders the notes. Free-text territoryNotes remain accepted (scripted fixtures, 0.2).
 */
export const groundedFindingSchema = z.strictObject({
  territoryKey: text,
  claimType: text.max(40),
  supportingFields: z.array(text.max(80)).max(6).default([]),
  interpretation: z.string().trim().min(1).max(600),
  limitationCodes: z.array(text.max(60)).max(6).default([]),
});

export const synthesisSchema = z.strictObject({
  summary: z.string().trim().min(1).max(4_000),
  territoryNotes: z.array(z.strictObject({ territoryKey: text, text: z.string().trim().min(1).max(1_200) })).max(12).default([]),
  findings: z.array(groundedFindingSchema).max(16).default([]),
  followUpOptions: z.array(z.string().trim().min(1).max(300)).max(6),
});
export type Synthesis = z.output<typeof synthesisSchema>;

// ---- Entity types the runtime can rank (Qloo Insights types) ----

export const RANKABLE_TYPES = ["brand", "place", "artist", "book", "movie", "person", "podcast", "tv_show", "videogame"] as const;
export type RankableType = (typeof RANKABLE_TYPES)[number];

/** "urn:entity:brand" / "brand" → "brand". Unknown or generic types → undefined. */
export function shortEntityType(type: string | undefined): RankableType | undefined {
  if (!type) return undefined;
  const last = type.startsWith("urn:entity:") ? type.slice("urn:entity:".length) : type;
  return (RANKABLE_TYPES as readonly string[]).includes(last) ? (last as RankableType) : undefined;
}
