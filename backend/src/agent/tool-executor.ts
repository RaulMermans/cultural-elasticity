/**
 * Tool executor: validates one proposed tool call and, only if every check passes, runs it.
 *
 * Refusals (each recorded in the trace, the model sees the reason next turn):
 *   UNKNOWN_TOOL         no such tool in the registry
 *   UNAUTHORIZED_TOOL    the tool's permission class is not allowed for agents
 *   NEEDS_USER_INPUT     only ask_user is allowed while an ambiguity is open
 *   EVIDENCE_SUFFICIENT  deterministic sufficiency says stop: no more Qloo calls
 *   WRONG_PHASE          the tool is not available in the current phase
 *   PRECONDITION         state precondition failed (e.g. tag not observed, territory unknown)
 *   INVALID_ARGUMENTS    arguments fail the tool's schema
 *   BUDGET_EXHAUSTED     the tool's Qloo-call bound exceeds the remaining budget
 * Sprint 4 (when the runtime passes the active skills):
 *   NOT_EXPOSED          the tool is not in the active skills' allowlists this turn
 *   SKILL_BUDGET_EXHAUSTED  the attributed skill has no Qloo calls left
 *   DUPLICATE_ACTION     the identical call already ran in this run (a repeated useless action)
 *   NO_VALUE_ACTION      rule-based expected value NONE (e.g. a profile already collected)
 *   EARLY_STOP           no material evidence gap remains: further Qloo investigation is refused
 *   STRATEGY_EXHAUSTED   (precondition) the same representation strategy already failed twice
 *   ANALYSIS_RESERVE     the call would spend Qloo calls the analysis of ready territories needs
 * Refusals that save Qloo calls are recorded in trace.earlyStops with callsAvoided.
 * Then: run with a timeout; a thrown error becomes a failed tool result, never a crashed run.
 */
import type { AgentToolCallTrace } from "@cultural-elasticity/shared";
import { z } from "zod";
import type { ExpectedValue } from "@cultural-elasticity/shared";
import { assessEvidenceSufficiency, type SufficiencyAssessment } from "./evidence-sufficiency.js";
import { cacheKey } from "./qloo-gateway.js";
import type { SkillDefinition } from "./skills/contracts.js";
import { skillRef } from "./skills/contracts.js";
import type { SkillRegistry } from "./skills/registry.js";
import { analysisReserve } from "./analysis-runner.js";
import { isReady, territoryReadiness } from "./readiness.js";
import { activeTerritories, derivePhase, remainingQlooCalls, type AgentRunState } from "./state.js";
import type { AgentToolProvider } from "./tool-provider.js";
import type { ToolPermission, ToolRegistry, ToolResult } from "./tool-registry.js";

/** Permission classes an agent may use. `side_effect` exists only so it can be refused. */
export const AGENT_ALLOWED_PERMISSIONS: readonly ToolPermission[] = ["read_only_external", "local_computation"];

export type ToolExecution = { accepted: false; code: string; reason: string } | { accepted: true; result: ToolResult; trace: AgentToolCallTrace };

export function openToolTrace(state: AgentRunState, tool: string, permission: AgentToolCallTrace["permission"], args: unknown): AgentToolCallTrace {
  state.toolCallCounter += 1;
  const trace: AgentToolCallTrace = {
    id: `tc-${state.toolCallCounter}`,
    iteration: state.usage.iterations,
    tool,
    permission,
    arguments: args,
    status: "ok",
    summary: "",
    qlooOperations: [],
    correlationIds: [],
    attempts: 0,
    latencyMs: 0,
  };
  state.trace.toolCalls.push(trace);
  return trace;
}

function rejected(state: AgentRunState, tool: string, args: unknown, code: string, reason: string): ToolExecution {
  const trace = openToolTrace(state, tool, "local_computation", args);
  trace.status = "rejected";
  trace.summary = `${code}: ${reason}`;
  trace.error = code;
  return { accepted: false, code, reason };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`TOOL_TIMEOUT after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Skill context for one turn: the active skills, the registry, and the tools they expose. */
export type SkillGate = { skills: SkillRegistry; active: readonly SkillDefinition[]; exposed: ReadonlySet<string>; actions: readonly string[]; seen?: SkillDefinition[] };

/** Tools whose repeated identical call is still useful (pure re-reads of deterministic state). */
const REPEATABLE = new Set(["assess_evidence_sufficiency"]);

const VALUE_RANK: Record<ExpectedValue, number> = { HIGH: 3, MEDIUM: 2, LOW: 1, NONE: 0 };

/** Expected value of a Qloo-facing call under the sufficiency rules (see evidence-sufficiency.ts). */
export function valueOfToolCall(state: AgentRunState, tool: string, input: Record<string, unknown>, assessment: SufficiencyAssessment): { value: ExpectedValue; reason: string } {
  if (tool === "qloo_get_entity_tags" && typeof input.entityId === "string" && state.profiles.has(input.entityId)) return { value: "NONE", reason: "this tag profile is already collected (fixed Qloo take)" };
  if (tool === "qloo_find_tags" && typeof input.query === "string" && state.searchedQueries.has(input.query.trim().toLowerCase())) return { value: "NONE", reason: "this tag query already ran in this run" };
  if (!assessment.materialGap) {
    const reserved = assessment.nextActions.find((a) => a.value === "NONE" && /reserved for the analysis/u.test(a.reason));
    return { value: "NONE", reason: reserved?.reason ?? "no material evidence gap remains; analyze the ready territories" };
  }
  const matching = assessment.nextActions.filter((a) => a.action === tool);
  const best = matching.sort((a, b) => VALUE_RANK[b.value] - VALUE_RANK[a.value])[0];
  return best ? { value: best.value, reason: best.reason } : { value: "MEDIUM", reason: "supports an open investigation step" };
}

function earlyStop(state: AgentRunState, tool: string, args: unknown, code: string, reason: string, callsAvoided: number): ToolExecution {
  state.trace.earlyStops.push({ iteration: state.usage.iterations, tool, code, reason, callsAvoided });
  return rejected(state, tool, args, code, reason);
}

export async function executeToolCall(
  state: AgentRunState,
  registry: ToolRegistry,
  provider: AgentToolProvider,
  name: string,
  rawArguments: unknown,
  allowed: readonly ToolPermission[] = AGENT_ALLOWED_PERMISSIONS,
  gate?: SkillGate,
): Promise<ToolExecution> {
  const tool = registry.get(name);
  if (!tool) return rejected(state, name, rawArguments, "UNKNOWN_TOOL", `no tool named "${name}"`);
  if (!allowed.includes(tool.permission)) return rejected(state, name, rawArguments, "UNAUTHORIZED_TOOL", `permission ${tool.permission} is not allowed`);

  const sufficiency = assessEvidenceSufficiency(state);
  if (sufficiency.verdict === "NEEDS_USER_INPUT") return rejected(state, name, rawArguments, "NEEDS_USER_INPUT", sufficiency.reasons.join("; "));
  if (sufficiency.verdict === "SUFFICIENT" && tool.permission === "read_only_external") return rejected(state, name, rawArguments, "EVIDENCE_SUFFICIENT", "evidence is sufficient; analyze or finish");

  const phase = derivePhase(state);
  if (!tool.phases.includes(phase)) return rejected(state, name, rawArguments, "WRONG_PHASE", `${name} is not available while ${phase}`);
  if (gate && !gate.exposed.has(name)) return rejected(state, name, rawArguments, "NOT_EXPOSED", `${name} is not offered by the active skills (${gate.active.map((s) => s.id).join(", ") || "none"})`);

  const parsed = (tool.inputSchema as z.ZodType).safeParse(rawArguments ?? {});
  if (!parsed.success) return rejected(state, name, rawArguments, "INVALID_ARGUMENTS", parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "));
  const input = parsed.data as never;

  const external = tool.permission === "read_only_external";
  const callKey = `${name}:${cacheKey("describe", parsed.data)}`;
  if (!REPEATABLE.has(name) && state.executedCalls.has(callKey)) return earlyStop(state, name, rawArguments, "DUPLICATE_ACTION", "this identical call already ran in this run; its result is in the state", external ? tool.maxQlooCalls : 0);
  const refusal = tool.precondition?.(state, input);
  if (refusal) return refusal.startsWith("STRATEGY_EXHAUSTED") ? earlyStop(state, name, rawArguments, "STRATEGY_EXHAUSTED", refusal.replace(/^STRATEGY_EXHAUSTED: /u, ""), 0) : rejected(state, name, rawArguments, "PRECONDITION", refusal);
  let expectedValue: ExpectedValue | undefined;
  if (external && gate) {
    const valued = valueOfToolCall(state, name, parsed.data as Record<string, unknown>, sufficiency);
    expectedValue = valued.value;
    if (valued.value === "NONE") return earlyStop(state, name, rawArguments, sufficiency.materialGap ? "NO_VALUE_ACTION" : "EARLY_STOP", valued.reason, tool.maxQlooCalls);
  }
  if (tool.maxQlooCalls > remainingQlooCalls(state)) return rejected(state, name, rawArguments, "BUDGET_EXHAUSTED", `needs up to ${tool.maxQlooCalls} Qloo call(s); ${remainingQlooCalls(state)} left`);
  if (external && gate) {
    const ready = activeTerritories(state).filter((t) => t.status !== "analyzed" && isReady(territoryReadiness(state, t)));
    const reserve = analysisReserve(state, ready);
    if (reserve > 0 && remainingQlooCalls(state) - tool.maxQlooCalls < reserve) {
      return earlyStop(state, name, rawArguments, "ANALYSIS_RESERVE", `${remainingQlooCalls(state)} Qloo call(s) left; ${reserve} are reserved for analyzing the ready territories`, tool.maxQlooCalls);
    }
  }
  const skill = gate?.skills.attribute(gate.active, name);
  if (gate && skill && external && gate.skills.qlooCallsLeft(state, skill) < tool.maxQlooCalls) {
    return earlyStop(state, name, rawArguments, "SKILL_BUDGET_EXHAUSTED", `skill ${skill.id} v${skill.version} has spent its ${skill.budget.maxQlooCalls} Qloo calls`, tool.maxQlooCalls);
  }

  const trace = openToolTrace(state, name, tool.permission === "side_effect" ? "local_computation" : tool.permission, parsed.data);
  trace.skill = skill ? skillRef(skill) : null;
  if (expectedValue) trace.expectedValue = expectedValue;
  const started = Date.now();
  try {
    const result = await withTimeout(tool.execute({ state, provider, trace }, input), tool.timeoutMs ?? state.limits.toolTimeoutMs);
    trace.status = result.status;
    trace.summary = result.summary;
    if (result.errorCode) trace.error = result.errorCode;
    if (result.status !== "failed") state.executedCalls.add(callKey);
    return { accepted: true, result, trace };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = message.startsWith("TOOL_TIMEOUT") ? "TOOL_TIMEOUT" : "TOOL_ERROR";
    trace.status = "failed";
    trace.summary = `${code}: ${message.slice(0, 300)}`;
    trace.error = code;
    state.trace.errors.push({ iteration: state.usage.iterations, code, detail: `${name}: ${message.slice(0, 300)}` });
    return { accepted: true, result: { status: "failed", summary: trace.summary, errorCode: code }, trace };
  } finally {
    trace.latencyMs = Date.now() - started;
    gate?.skills.recordToolCall(state, skill, trace.attempts);
  }
}
