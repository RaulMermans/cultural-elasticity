/**
 * Runtime skill contract. A skill is a bounded, versioned, reusable agent COMPETENCY:
 * which tools and terminal actions it may use, what context it needs, its budget, when it stops and how
 * it fails. It is not a prompt, not an agent and not a script: the runtime activates skills from state,
 * exposes only their tools, enforces their budgets and records their versions. The model cannot change a
 * skill's permissions.
 *
 * Versioning: changing a skill's procedure, allowed tools, stopping conditions or output semantics
 * requires a version increment (tests pin the current versions).
 */
import type { AgentFailureCategory, AnalysisRoute, SkillRef } from "@cultural-elasticity/shared";
import type { z } from "zod";
import type { AgentIntent } from "../contracts.js";
import type { AgentRunState } from "../state.js";

export const SKILL_IDS = [
  "interpret_request",
  "resolve_brand",
  "resolve_territory",
  "build_territory_representation",
  "build_comparison_set",
  "explore_candidate_territories",
  "analyze_territories",
] as const;
export type SkillId = (typeof SKILL_IDS)[number];

export type TerminalAction = "analyze" | "ask_user" | "finish";

/** Context sections a skill needs; the context builder includes only sections of active skills. */
export type ContextSection =
  | "observedTags"
  | "brandProfile"
  | "exemplarCandidates"
  | "representationRecovery"
  | "referenceCandidates"
  | "relatedEntities"
  | "frontierConcepts"
  | "conceptDedup"
  | "analysisResults";

export type SkillDefinition<I = unknown, O = unknown> = {
  id: SkillId;
  version: number;
  purpose: string;
  /** Intents the skill can serve. */
  intents: readonly AgentIntent[];
  /** Human-readable preconditions; `relevant` is their executable form. */
  preconditions: readonly string[];
  /** Deterministic just-in-time activation from state (intent, unresolved requirements, readiness). */
  relevant: (state: AgentRunState) => boolean;
  /** The skill's focus, derived from state (validated by inputSchema). */
  inputSchema: z.ZodType<I>;
  focus: (state: AgentRunState) => I;
  /** What the skill must leave in state when it succeeds (validated by outputSchema; used by skill evals). */
  outputSchema: z.ZodType<O>;
  outcome: (state: AgentRunState) => O;
  allowedTools: readonly string[];
  allowedActions: readonly TerminalAction[];
  allowedRoutes: readonly AnalysisRoute[];
  contextRequirements: readonly ContextSection[];
  /**
   * maxTurns: turns the skill may be shown; when spent the skill is deactivated.
   * maxQlooCalls: Qloo calls it may spend (× in-scope territories when perTerritory); when spent only its Qloo
   * calls are refused (SKILL_BUDGET_EXHAUSTED) — its local tools stay usable on the evidence already gathered.
   */
  budget: { maxTurns: number; maxQlooCalls: number; perTerritory?: boolean };
  stoppingConditions: readonly string[];
  failureModes: readonly AgentFailureCategory[];
  evalIds: readonly string[];
  /** Short procedure shown to the model while the skill is active. */
  procedure: string;
};

export const skillRef = (skill: Pick<SkillDefinition, "id" | "version">): SkillRef => ({ id: skill.id, version: skill.version });

/**
 * Offline learning hook (Sprint 4: interface only). Runtime outcomes per skill version, produced by eval
 * code from finished runs. Nothing consumes these automatically: no skill edits itself, no prompt is
 * rewritten, nothing is persisted. Promotion of a skill change requires eval evidence and review.
 */
export type SkillEvalOutcome = {
  skillId: SkillId;
  version: number;
  runId: string;
  success: boolean;
  failureCategory?: AgentFailureCategory;
  metrics: Record<string, number | string | boolean | null>;
};
