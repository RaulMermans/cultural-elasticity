/**
 * SYNTHETIC agent-runtime helpers. The world (evals/fixtures/synthetic/agent/world.json) has fictional
 * names and SYN- placeholder ids; it is not Qloo evidence.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createScriptedToolProvider } from "../../../src/agent/factory.js";
import { BaselinePolicyModel } from "../../../src/agent/model/baseline.js";
import type { AgentModel } from "../../../src/agent/model/provider.js";
import { AgentRuntime } from "../../../src/agent/runtime.js";
import { createRunState, transition, type AgentRunState } from "../../../src/agent/state.js";
import { syntheticWorldSchema, type SyntheticFault, type SyntheticWorld } from "../../../src/agent/synthetic-world.js";
import type { AgentRequest, InvestigationLimits } from "../../../src/agent/contracts.js";

export const WORLD_PATH = fileURLToPath(new URL("../../../../evals/fixtures/synthetic/agent/world.json", import.meta.url));

export function loadWorld(): SyntheticWorld {
  return syntheticWorldSchema.parse(JSON.parse(readFileSync(WORLD_PATH, "utf8")));
}

export function scripted(faults: SyntheticFault[] = []) {
  return createScriptedToolProvider(loadWorld(), faults);
}

export function runtime(model: AgentModel = new BaselinePolicyModel(), faults: SyntheticFault[] = []) {
  const provider = scripted(faults);
  return { runtime: new AgentRuntime({ model, provider }), provider };
}

/** A fresh run state wired to the synthetic world, already past intake. */
export function freshState(request: Partial<AgentRequest> = {}, limits?: Partial<InvestigationLimits>): AgentRunState {
  const req: AgentRequest = { userQuery: "synthetic test", ...request };
  const state = createRunState(req, { id: "test", kind: "scripted", live: false }, { name: "synthetic-world", mode: "scripted", evidenceSource: "synthetic-fixture" });
  if (limits) {
    Object.assign(state.limits, limits);
    if (limits.maxQlooCalls !== undefined) state.qlooBudgetExplicit = true;
  }
  transition(state, "PLANNING", "test");
  return state;
}

export const call = (tool: string, args: unknown, reasonSummary = "test") => ({ action: "call_tool", tool, arguments: args, reasonSummary });
