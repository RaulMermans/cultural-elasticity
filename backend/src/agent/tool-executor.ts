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
 * Then: run with a timeout; a thrown error becomes a failed tool result, never a crashed run.
 */
import type { AgentToolCallTrace } from "@cultural-elasticity/shared";
import { z } from "zod";
import { assessEvidenceSufficiency } from "./evidence-sufficiency.js";
import { derivePhase, remainingQlooCalls, type AgentRunState } from "./state.js";
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

export async function executeToolCall(
  state: AgentRunState,
  registry: ToolRegistry,
  provider: AgentToolProvider,
  name: string,
  rawArguments: unknown,
  allowed: readonly ToolPermission[] = AGENT_ALLOWED_PERMISSIONS,
): Promise<ToolExecution> {
  const tool = registry.get(name);
  if (!tool) return rejected(state, name, rawArguments, "UNKNOWN_TOOL", `no tool named "${name}"`);
  if (!allowed.includes(tool.permission)) return rejected(state, name, rawArguments, "UNAUTHORIZED_TOOL", `permission ${tool.permission} is not allowed`);

  const sufficiency = assessEvidenceSufficiency(state);
  if (sufficiency.verdict === "NEEDS_USER_INPUT") return rejected(state, name, rawArguments, "NEEDS_USER_INPUT", sufficiency.reasons.join("; "));
  if (sufficiency.verdict === "SUFFICIENT" && tool.permission === "read_only_external") return rejected(state, name, rawArguments, "EVIDENCE_SUFFICIENT", "evidence is sufficient; analyze or finish");

  const phase = derivePhase(state);
  if (!tool.phases.includes(phase)) return rejected(state, name, rawArguments, "WRONG_PHASE", `${name} is not available while ${phase}`);

  const parsed = (tool.inputSchema as z.ZodType).safeParse(rawArguments ?? {});
  if (!parsed.success) return rejected(state, name, rawArguments, "INVALID_ARGUMENTS", parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "));
  const input = parsed.data as never;

  const refusal = tool.precondition?.(state, input);
  if (refusal) return rejected(state, name, rawArguments, "PRECONDITION", refusal);
  if (tool.maxQlooCalls > remainingQlooCalls(state)) return rejected(state, name, rawArguments, "BUDGET_EXHAUSTED", `needs up to ${tool.maxQlooCalls} Qloo call(s); ${remainingQlooCalls(state)} left`);

  const trace = openToolTrace(state, name, tool.permission === "side_effect" ? "local_computation" : tool.permission, parsed.data);
  const started = Date.now();
  try {
    const result = await withTimeout(tool.execute({ state, provider, trace }, input), tool.timeoutMs ?? state.limits.toolTimeoutMs);
    trace.status = result.status;
    trace.summary = result.summary;
    if (result.errorCode) trace.error = result.errorCode;
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
  }
}
