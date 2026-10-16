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
import { harnessChildEnv, LIVE_QLOO_HOST_VERIFIED, QlooEnvironmentError, requireHackathonBaseUrl, verifyHarnessHost } from "../qloo/environment.js";
import { HarnessMcpTransport } from "../qloo/mcp-transport.js";
import { defaultHarnessBinPath, HarnessExecTransport } from "../qloo/transport.js";
import { AgentNotConfiguredError } from "./errors.js";
import { AnthropicAgentModel } from "./model/anthropic.js";
import { BaselinePolicyModel } from "./model/baseline.js";
import type { AgentModel } from "./model/provider.js";
import { SyntheticWorldTransport, type SyntheticFault, type SyntheticWorld } from "./synthetic-world.js";
import { QlooToolProvider, SYNTHETIC_SOURCE } from "./tool-provider.js";

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
  return new AnthropicAgentModel({ ...(env.AGENT_MODEL?.trim() && { model: env.AGENT_MODEL.trim() }) });
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
  const transport = exec ? new HarnessExecTransport({ env: childEnv, timeoutMs: 90_000 }) : new HarnessMcpTransport({ env: childEnv, timeoutMs: 90_000 });
  const spacing = Number(env.QLOO_CALL_SPACING_MS ?? 7_000);
  return new QlooToolProvider(transport, { name: exec ? "qloo-harness-exec" : "qloo-mcp", mode: "live", spacingMs: Number.isFinite(spacing) && spacing >= 0 ? spacing : 7_000 });
}

/** The scripted (synthetic) tool provider: a TEST TOOL. Evidence is labelled synthetic end to end. */
export function createScriptedToolProvider(world: SyntheticWorld, faults: SyntheticFault[] = []): QlooToolProvider & { world: SyntheticWorldTransport } {
  const transport = new SyntheticWorldTransport(world, faults);
  const provider = new QlooToolProvider(transport, { name: "synthetic-world", mode: "scripted", evidenceSource: SYNTHETIC_SOURCE, spacingMs: 0, rateLimitWaitMs: 0, sleep: async () => {} });
  return Object.assign(provider, { world: transport });
}
