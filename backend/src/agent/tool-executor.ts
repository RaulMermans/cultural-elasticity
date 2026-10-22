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
 * Sprint 5A.1:
 *   PROBE_LIMIT_REACHED          a new entity-type probe of a concept (or territory) whose probing is exhausted
 *   REFERENCE_NAMESPACE_BARREN   a reference probe in a tag namespace already barren twice for that type
 *   FRONTIER_EVIDENCE_BASE       a related-entity profile outside the fixed frontier evidence base
 *   TYPE_ALIGNMENT_PENDING       (precondition, once per target) an off-type anchor while the shared type is untested
 * Sprint 5A.2:
 *   NAMESPACE_TYPE_BARREN        a probe type that returned nothing for 2 other concepts of the tag namespace (and never
 *                                members there) while the concept still has another option (probe-policy.ts)
 *   FRONTIER_COMPLETION_RESERVE  the last two turns belong to representing and analyzing frontier candidates with members
 *   ALTERNATE_ANCHOR_REFUSED     (precondition) an alternate anchor for a grounded frontier candidate that is a different
 *                                concept, unsupported by Qloo members, or not needed (its grounding tag has members)
 * Refusals that save Qloo calls are recorded in trace.earlyStops with callsAvoided.
 * Then: run with a timeout; a thrown error becomes a failed tool result, never a crashed run.
 */
import type { AgentToolCallTrace } from "@cultural-elasticity/shared";
import { z } from "zod";
import type { ExpectedValue } from "@cultural-elasticity/shared";
import { assessEvidenceSufficiency, barrenProbe, type SufficiencyAssessment } from "./evidence-sufficiency.js";
import { cacheKey } from "./qloo-gateway.js";
import type { SkillDefinition } from "./skills/contracts.js";
import { skillRef } from "./skills/contracts.js";
import type { SkillRegistry } from "./skills/registry.js";
import { analysisReserve } from "./analysis-runner.js";
import type { RankableType } from "./contracts.js";
import { frontierCompletionReserve, outsideFrontierEvidenceBase, recordAnchorDecision } from "./frontier.js";
import { namespaceTypeBarren, probeRefusal } from "./probe-policy.js";
import { isReady, territoryReadiness } from "./readiness.js";
import { barrenReferenceNamespace } from "./reference-strategy.js";
import { activeTerritories, derivePhase, findTerritory, remainingQlooCalls, type AgentRunState } from "./state.js";
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

/**
 * Expected value of a Qloo-facing call under the sufficiency rules (see evidence-sufficiency.ts). `code` names the rule
 * when a dedicated refusal code applies (Sprint 5A.1: PROBE_LIMIT_REACHED, REFERENCE_NAMESPACE_BARREN,
 * FRONTIER_EVIDENCE_BASE); otherwise the executor uses NO_VALUE_ACTION / EARLY_STOP.
 */
export function valueOfToolCall(state: AgentRunState, tool: string, input: Record<string, unknown>, assessment: SufficiencyAssessment): { value: ExpectedValue; reason: string; code?: string } {
  if (tool === "qloo_get_entity_tags" && typeof input.entityId === "string" && state.profiles.has(input.entityId)) return { value: "NONE", reason: "this tag profile is already collected (fixed Qloo take)" };
  if (tool === "qloo_find_tags" && typeof input.query === "string" && state.searchedQueries.has(input.query.trim().toLowerCase())) return { value: "NONE", reason: "this tag query already ran in this run" };
  if (tool === "qloo_get_entity_tags" && typeof input.entityId === "string") {
    const outside = outsideFrontierEvidenceBase(state, input.entityId);
    if (outside) return { value: "NONE", reason: outside, code: "FRONTIER_EVIDENCE_BASE" };
  }
  // Sprint 5A.2: the last two turns of a frontier run belong to the candidates that have Qloo members.
  const tagIds = Array.isArray(input.tagIds) ? input.tagIds.map(String) : [];
  const reserve = frontierCompletionReserve(state, tool, tool === "qloo_recommend" && input.conditionOnBrand === false && tagIds.length === 1 ? tagIds[0]! : null);
  if (reserve) return { value: "NONE", reason: reserve.replace(/^FRONTIER_COMPLETION_RESERVE: /u, ""), code: "FRONTIER_COMPLETION_RESERVE" };
  // Sprint 5A: an entity type that already came back empty for ≥ 2 of a territory's concepts has no expected gain.
  if (tool === "qloo_recommend" && input.conditionOnBrand === false && Array.isArray(input.tagIds) && input.tagIds.length === 1 && typeof input.targetType === "string") {
    const tagId = String(input.tagIds[0]);
    // Sprint 5A.1: bounded entity-type probing per concept and per territory (probe-policy.ts).
    const limit = probeRefusal(state, tagId, input.targetType as RankableType);
    if (limit) return { value: "NONE", reason: limit, code: "PROBE_LIMIT_REACHED" };
    const barren = barrenProbe(state, tagId, input.targetType);
    if (barren) return { value: "NONE", reason: `${barren.barren}; probe an untried supported entity type instead (${barren.untried.join(", ") || "none left"}), anchor a concept with members, or declare_concept_only` };
    const namespace = barrenReferenceNamespace(state, tagId, input.targetType as RankableType);
    if (namespace) return { value: "NONE", reason: namespace, code: "REFERENCE_NAMESPACE_BARREN" };
    // Sprint 5A.2 (after the more specific reference rule): namespace evidence defers a type the namespace has shown to be
    // barren while the concept has better-evidenced options.
    const namespaceBarren = namespaceTypeBarren(state, tagId, input.targetType as RankableType);
    if (namespaceBarren) return { value: "NONE", reason: namespaceBarren, code: "NAMESPACE_TYPE_BARREN" };
  }
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
  if (refusal?.startsWith("STRATEGY_EXHAUSTED")) return earlyStop(state, name, rawArguments, "STRATEGY_EXHAUSTED", refusal.replace(/^STRATEGY_EXHAUSTED: /u, ""), 0);
  if (refusal?.startsWith("TYPE_ALIGNMENT_PENDING")) {
    // Sprint 5A.1: bounded (once per target) — the deferral is recorded so the next identical anchor proceeds.
    const key = (parsed.data as { territoryKey?: string }).territoryKey;
    if (key) state.alignmentDeferrals.add(key);
    return rejected(state, name, rawArguments, "TYPE_ALIGNMENT_PENDING", refusal.replace(/^TYPE_ALIGNMENT_PENDING: /u, ""));
  }
  if (refusal?.startsWith("ALTERNATE_ANCHOR_REFUSED")) {
    const { territoryKey, tagId } = parsed.data as { territoryKey: string; tagId: string };
    const code = /^ALTERNATE_ANCHOR_REFUSED: (\w+)/u.exec(refusal)?.[1] ?? null;
    const t = findTerritory(state, territoryKey);
    if (t) recordAnchorDecision(state, t, tagId, "REFUSED", "runtime", code, refusal.replace(/^ALTERNATE_ANCHOR_REFUSED: \w+ — /u, ""));
    return earlyStop(state, name, rawArguments, "ALTERNATE_ANCHOR_REFUSED", refusal.replace(/^ALTERNATE_ANCHOR_REFUSED: /u, ""), 0);
  }
  if (refusal) return rejected(state, name, rawArguments, "PRECONDITION", refusal);
  let expectedValue: ExpectedValue | undefined;
  if (external && gate) {
    const valued = valueOfToolCall(state, name, parsed.data as Record<string, unknown>, sufficiency);
    expectedValue = valued.value;
    if (valued.value === "NONE") return earlyStop(state, name, rawArguments, valued.code ?? (sufficiency.materialGap ? "NO_VALUE_ACTION" : "EARLY_STOP"), valued.reason, tool.maxQlooCalls);
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
