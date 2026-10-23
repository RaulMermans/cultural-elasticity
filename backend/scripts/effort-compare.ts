/**
 * `pnpm effort:compare`: high vs medium effort on frozen synthetic scenarios.
 * Default: scripted/baseline (no Haiku) — not LIVE_HAIKU evidence.
 * `--live-haiku` uses Claude Haiku 5.5 with the SYNTHETIC Qloo world (no live Qloo).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentRuntime } from "../src/agent/runtime.js";
import { BaselinePolicyModel } from "../src/agent/model/baseline.js";
import { AnthropicAgentModel, DEFAULT_AGENT_EFFORT } from "../src/agent/model/anthropic.js";
import { buildPerfReport } from "../src/ops/perf-report.js";
import { createScriptedToolProvider, syntheticWorldSchema } from "./synthetic/synthetic-world.js";
import { EFFORT_EXPERIMENT, PRODUCTION_AGENT_EFFORT } from "./experiments.js";
import { evaluateRun, RUN_EVALUATORS_VERSION } from "./run-evaluators.js";
import { loadLocalEnvFile } from "../src/config/env.js";
import { hasModelCredential, LIVE_AGENT_MODEL_VALIDATION_NOT_RUN } from "../src/agent/factory.js";
import { scrubSecrets } from "../src/qloo/transport.js";

const backendRoot = fileURLToPath(new URL("..", import.meta.url));
const WORLD = fileURLToPath(new URL("../../evals/fixtures/synthetic/agent/world.json", import.meta.url));

const CASES = [
  { id: "move", request: { userQuery: "Could Northwind Atelier enter boutique hospitality?", brand: "Northwind Atelier", territories: ["Boutique Hospitality"] } },
  { id: "compare", request: { userQuery: "For Saffron & Salt compare tableware, skincare and slow travel", brand: "Saffron & Salt", territories: ["Tableware", "Skincare", "Slow Travel"] } },
];

const liveHaiku = process.argv.includes("--live-haiku");

async function main(): Promise<number> {
  loadLocalEnvFile();
  if (PRODUCTION_AGENT_EFFORT !== DEFAULT_AGENT_EFFORT) {
    console.log("production effort drifted from the Anthropic default high; aborting");
    return 1;
  }
  if (liveHaiku && !hasModelCredential()) {
    console.log(LIVE_AGENT_MODEL_VALIDATION_NOT_RUN);
    return 3;
  }
  const world = syntheticWorldSchema.parse(JSON.parse(readFileSync(WORLD, "utf8")));
  const arms = EFFORT_EXPERIMENT.arms;
  const rows = [];
  for (const arm of arms) {
    for (const c of CASES) {
      const provider = createScriptedToolProvider(world);
      const model = liveHaiku ? new AnthropicAgentModel({ effort: arm }) : new BaselinePolicyModel();
      const started = Date.now();
      const result = await new AgentRuntime({ model, provider }).run(c.request);
      const elapsed = Date.now() - started;
      const report = buildPerfReport(result);
      const evals = result.status === "NEEDS_INPUT" ? [] : evaluateRun(result);
      rows.push({
        arm: liveHaiku ? arm : `scripted(${arm}-config-only)`,
        caseId: c.id,
        liveHaiku,
        status: result.status,
        model: result.model,
        elapsedMs: elapsed,
        modelCalls: result.metrics.agent_iterations,
        qlooCalls: result.metrics.qloo_calls,
        outputTokens: result.metrics.model_output_tokens,
        inputTokens: result.metrics.model_input_tokens,
        costUsd: result.metrics.model_cost_usd,
        validFull: report.outcomes.validFull,
        invalidFull: report.outcomes.invalidFull,
        partial: report.outcomes.partial,
        evaluatorFailures: evals.filter((e) => !e.passed).map((e) => e.id),
        evaluators: RUN_EVALUATORS_VERSION,
      });
      console.log(`${c.id} ${arm} status=${result.status} full=${report.outcomes.validFull} invalidFull=${report.outcomes.invalidFull ?? "unmeasured"} tokens_out=${result.metrics.model_output_tokens} ${elapsed}ms`);
    }
  }
  const outDir = join(backendRoot, "feasibility-output", "sprint8b-effort");
  mkdirSync(outDir, { recursive: true });
  const payload = {
    notice: liveHaiku
      ? "LIVE_HAIKU_INTERPRETATION-equivalent: live Haiku, SYNTHETIC Qloo. Not live Qloo. Not the prescribed readiness gate."
      : "OFFLINE scripted/baseline. Effort arms do not change the baseline policy. LIVE_HAIKU_EVAL_NOT_RUN.",
    liveHaiku,
    productionDefault: PRODUCTION_AGENT_EFFORT,
    rows,
  };
  const text = JSON.stringify(payload, null, 2);
  if (scrubSecrets(text) !== text) throw new Error("credential material detected; not written");
  writeFileSync(join(outDir, liveHaiku ? "live-haiku.json" : "offline.json"), `${text}\n`, { mode: 0o600 });
  return 0;
}

process.exit(await main());
