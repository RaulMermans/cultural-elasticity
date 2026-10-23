/**
 * Evaluation-only experiment configuration. Production defaults stay high effort and 16_000 max_tokens
 * until a measured comparison justifies a change. Not imported by the runtime loop.
 */
export const PRODUCTION_AGENT_EFFORT = "high" as const;
export const PRODUCTION_DECISION_MAX_TOKENS = 16_000;
export const PRODUCTION_SYNTHESIS_MAX_TOKENS = 16_000;
export const PRODUCTION_INTERPRET_MAX_TOKENS = 4_000;
export const PRODUCTION_REPAIR_MAX_TOKENS = 16_000;

export type EffortArm = "high" | "medium" | "low";

export type EffortExperimentConfig = {
  id: string;
  version: "effort-experiment-v1";
  productionDefault: typeof PRODUCTION_AGENT_EFFORT;
  arms: EffortArm[];
  identical: {
    scenarios: "evals/agent/scenarios.json";
    toolBudgets: "frozen";
    qlooFixtures: "evals/fixtures/synthetic/agent/world.json";
    methodology: "elasticity-v0.1";
    evaluators: "run-evaluators-v2.1";
    maxIterations: number;
  };
  measures: readonly string[];
  optionalLow: "only after high-vs-medium preserves competence within measured uncertainty";
};

export const EFFORT_EXPERIMENT: EffortExperimentConfig = {
  id: "sprint-8a-effort-high-vs-medium",
  version: "effort-experiment-v1",
  productionDefault: PRODUCTION_AGENT_EFFORT,
  arms: ["high", "medium"],
  identical: {
    scenarios: "evals/agent/scenarios.json",
    toolBudgets: "frozen",
    qlooFixtures: "evals/fixtures/synthetic/agent/world.json",
    methodology: "elasticity-v0.1",
    evaluators: "run-evaluators-v2.1",
    maxIterations: 12,
  },
  measures: [
    "correct action selection",
    "valid tool arguments",
    "invalid decisions",
    "successful entity resolution",
    "evidence sufficiency",
    "valid FULL outcomes",
    "hallucinated claims",
    "latency",
    "input/output tokens",
    "total estimated model cost",
  ],
  optionalLow: "only after high-vs-medium preserves competence within measured uncertainty",
};

export type TokenCeilingProposal = {
  decision: number;
  repair: number;
  synthesis: number;
  interpret: number;
  changeProduction: boolean;
  reason: string;
};

export type OutputTokenSample = { source: string; role: "decision" | "repair" | "synthesis" | "interpret"; outputTokens: number; truncated: boolean };

export function proposeTokenCeilings(samples: readonly OutputTokenSample[]): TokenCeilingProposal {
  const byRole = (role: OutputTokenSample["role"]) => samples.filter((s) => s.role === role).map((s) => s.outputTokens);
  const maxOf = (values: number[], fallback: number) => (values.length ? Math.max(...values) : fallback);
  const truncated = samples.filter((s) => s.truncated).length;
  const decisionMax = maxOf(byRole("decision"), 0);
  const synthesisMax = maxOf(byRole("synthesis"), 0);
  const interpretMax = maxOf(byRole("interpret"), 0);
  const repairMax = maxOf(byRole("repair"), decisionMax);
  const withHeadroom = (observed: number, production: number) => {
    if (truncated > 0) return production;
    if (observed <= 0) return production;
    const proposed = Math.min(production, Math.max(1_024, Math.ceil((observed * 2) / 256) * 256));
    return proposed < production && observed < production * 0.25 ? proposed : production;
  };
  const decision = withHeadroom(Math.max(decisionMax, repairMax), PRODUCTION_DECISION_MAX_TOKENS);
  const synthesis = withHeadroom(synthesisMax, PRODUCTION_SYNTHESIS_MAX_TOKENS);
  const interpret = withHeadroom(interpretMax, PRODUCTION_INTERPRET_MAX_TOKENS);
  const change =
    decision < PRODUCTION_DECISION_MAX_TOKENS || synthesis < PRODUCTION_SYNTHESIS_MAX_TOKENS || interpret < PRODUCTION_INTERPRET_MAX_TOKENS;
  return {
    decision,
    repair: Math.max(decision, withHeadroom(repairMax, PRODUCTION_REPAIR_MAX_TOKENS)),
    synthesis,
    interpret,
    changeProduction: change && truncated === 0,
    reason:
      truncated > 0
        ? `${truncated} truncated sample(s); production ceilings stay ${PRODUCTION_DECISION_MAX_TOKENS}`
        : change
          ? "observed output stayed well below the ceiling with headroom; still eval-only until a live comparison"
          : "observed maxima do not justify lowering production ceilings",
  };
}

export function truncationFromStopReason(stopReason: string | null | undefined): boolean {
  return stopReason === "max_tokens";
}
