/**
 * Production wiring for the agent runtime (API and CLI).
 *
 * Tool provider (live): QlooToolProvider over the official `qloo mcp` server (HarnessMcpTransport), after
 * the same host gate as the Sprint 0B scripts: credential present → QLOO_API_BASE_URL is the hackathon
 * origin → the harness itself reports that origin offline. AGENT_QLOO_TRANSPORT=exec selects the
 * verified `qloo exec` transport behind the same contract (documented fallback).
 *
 * Model: Claude (AnthropicAgentModel) when ANTHROPIC_API_KEY is set. The deterministic baseline policy is
 * used ONLY when explicitly requested (it is a reference policy, never a silent substitute for the agent).
 */
import { researchPolicyFromEnv } from "./research-intelligence.js";
import { harnessChildEnv, LIVE_QLOO_HOST_VERIFIED, QlooEnvironmentError, requireHackathonBaseUrl, verifyHarnessHost } from "../qloo/environment.js";
import { withProcessDispatchLimit } from "../qloo/dispatch-limit.js";
import { HarnessMcpTransport } from "../qloo/mcp-transport.js";
import { defaultHarnessBinPath, HarnessExecTransport } from "../qloo/transport.js";
import { AgentNotConfiguredError } from "./errors.js";
import { AnthropicAgentModel } from "./model/anthropic.js";
import { BaselinePolicyModel } from "./model/baseline.js";
import type { AgentModel } from "./model/provider.js";
import { AnthropicQueryInterpreter, StructuralQueryInterpreter, type QueryInterpreter } from "./query/interpreter.js";
import { QlooToolProvider } from "./tool-provider.js";

export const LIVE_AGENT_MODEL_VALIDATION_NOT_RUN = "LIVE_AGENT_MODEL_VALIDATION_NOT_RUN";

export type ModelChoice = "auto" | "anthropic" | "baseline";

export function hasModelCredential(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY?.trim());
}

export function createAgentModel(choice: ModelChoice = "auto", env: NodeJS.ProcessEnv = process.env): AgentModel {
  if (choice === "baseline") return new BaselinePolicyModel();
  if (!hasModelCredential(env)) {
    throw new AgentNotConfiguredError("AGENT_MODEL_NOT_CONFIGURED", `no ANTHROPIC_API_KEY is configured (${LIVE_AGENT_MODEL_VALIDATION_NOT_RUN}). Use the baseline reference policy explicitly if you only need to exercise the runtime.`);
  }
  const effort = env.AGENT_EFFORT?.trim();
  return new AnthropicAgentModel({
    ...(env.AGENT_MODEL?.trim() && { model: env.AGENT_MODEL.trim() }),
    ...(effort && ["low", "medium", "high", "xhigh", "max"].includes(effort) && { effort: effort as "low" | "medium" | "high" | "xhigh" | "max" }),
  });
}

/**
 * Sprint 5B.1 query interpreter: the same model and credential policy as the agent (Haiku 5.5; AGENT_MODEL for
 * development only), at its own effort (AGENT_QUERY_EFFORT, default low). "baseline" selects the structural
 * interpreter, which reads structured fields only; it is never substituted silently for a missing credential.
 */
export function createQueryInterpreter(choice: ModelChoice = "auto", env: NodeJS.ProcessEnv = process.env): QueryInterpreter {
  if (choice === "baseline") return new StructuralQueryInterpreter();
  if (!hasModelCredential(env)) throw new AgentNotConfiguredError("AGENT_MODEL_NOT_CONFIGURED", "no ANTHROPIC_API_KEY is configured (LIVE_HAIKU_QUERY_VALIDATION_NOT_RUN)");
  const effort = env.AGENT_QUERY_EFFORT?.trim();
  return new AnthropicQueryInterpreter({
    ...(env.AGENT_MODEL?.trim() && { model: env.AGENT_MODEL.trim() }),
    ...(effort && ["low", "medium", "high"].includes(effort) && { effort: effort as "low" | "medium" | "high" }),
    researchPolicy: researchPolicyFromEnv(env),
  });
}

export function createLiveToolProvider(env: NodeJS.ProcessEnv = process.env): QlooToolProvider {
  if (!env.QLOO_API_KEY?.trim()) throw new AgentNotConfiguredError("QLOO_NOT_CONFIGURED", "QLOO_API_KEY is not set (LIVE_QLOO_VALIDATION_NOT_RUN)");
  let origin: string;
  try {
    origin = requireHackathonBaseUrl(env.QLOO_API_BASE_URL);
  } catch (error) {
    if (error instanceof QlooEnvironmentError) throw new AgentNotConfiguredError("QLOO_HOST_NOT_VERIFIED", error.message);
    throw error;
  }
  const childEnv = harnessChildEnv(env, origin);
  const gate = verifyHarnessHost(defaultHarnessBinPath(), childEnv, origin);
  if (gate.status !== LIVE_QLOO_HOST_VERIFIED) throw new AgentNotConfiguredError("QLOO_HOST_NOT_VERIFIED", gate.reason);
  const exec = env.AGENT_QLOO_TRANSPORT === "exec";
  const transport = withProcessDispatchLimit(exec ? new HarnessExecTransport({ env: childEnv, timeoutMs: 90_000 }) : new HarnessMcpTransport({ env: childEnv, timeoutMs: 90_000 }), env);
  const spacing = Number(env.QLOO_CALL_SPACING_MS ?? 7_000);
  return new QlooToolProvider(transport, { name: exec ? "qloo-harness-exec" : "qloo-mcp", mode: "live", spacingMs: Number.isFinite(spacing) && spacing >= 0 ? spacing : 7_000 });
}
