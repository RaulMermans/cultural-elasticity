/**
 * ScriptedAgentModel: a TEST TOOL, not the production agent.
 *
 * Replays a fixed list of turns so runtime control flow (state transitions, budgets, invalid actions,
 * tool execution, fallbacks) can be tested without model nondeterminism. A step is raw decisions, an
 * invalid-output marker, or a function of the decision context (so a script can refer to ids that the
 * synthetic world returned). When the script runs out it finishes.
 */
import type { AgentModelInfo } from "@cultural-elasticity/shared";
import type { ModelTurn } from "../contracts.js";
import type { AgentDecisionContext, AgentModel, FinalizationContext, SynthesisTurn } from "./provider.js";

export type ScriptStep = unknown[] | { invalid: string } | ((context: AgentDecisionContext) => unknown[] | { invalid: string });

export class ScriptedAgentModel implements AgentModel {
  readonly info: AgentModelInfo;
  private step = 0;
  private synthesisStep = 0;
  /** Every context the runtime showed this model (for assertions). */
  readonly seen: AgentDecisionContext[] = [];
  readonly seenFinalization: FinalizationContext[] = [];

  constructor(
    private readonly script: readonly ScriptStep[],
    private readonly synthesis: readonly unknown[] = [],
    name = "script",
  ) {
    this.info = { id: `scripted:${name}`, kind: "scripted", live: false };
  }

  async decide(context: AgentDecisionContext): Promise<ModelTurn> {
    this.seen.push(context);
    const step = this.script[this.step];
    this.step += 1;
    if (step === undefined) return { decisions: [{ action: "finish", resultIds: [], reasonSummary: "script exhausted" }] };
    const value = typeof step === "function" ? step(context) : step;
    return { decisions: Array.isArray(value) ? value : { invalid: value.invalid } };
  }

  /** Sprint 10C: a reused decision still consumes its script step. */
  async replay(context: AgentDecisionContext): Promise<void> {
    await this.decide(context);
  }

  async replaySynthesis(context: FinalizationContext): Promise<void> {
    await this.synthesize(context);
  }

  async synthesize(context: FinalizationContext): Promise<SynthesisTurn> {
    this.seenFinalization.push(context);
    const output = this.synthesis[this.synthesisStep];
    this.synthesisStep += 1;
    return output === undefined ? { invalid: "no scripted synthesis" } : { output };
  }
}
