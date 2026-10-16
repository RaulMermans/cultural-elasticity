/**
 * `pnpm agent:run -- "<question>" [options]`: run one agent investigation from the terminal.
 *
 *   --brand <name>          structured brand (required by the baseline policy; optional for the model)
 *   --territories "a,b"     structured territory list ("" for frontier exploration)
 *   --intent <intent>       analyze_move | compare_territories | explore_frontier
 *   --model auto|baseline   auto = Claude when ANTHROPIC_API_KEY is set; baseline = deterministic reference policy
 *   --synthetic             use the SYNTHETIC scripted world instead of live Qloo (no network)
 *   --answer "<text>"       answer a NEEDS_INPUT question automatically (one round)
 *   --max-qloo-calls <n>    override the Qloo call budget
 *   --json <file>           write the full result (trace included)
 *
 * Exit codes: 0 complete · 2 needs input · 3 not configured (LIVE_* not run) · 1 failure.
 * Never prints hidden reasoning: only reason summaries, tool statuses and deterministic results.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentAnalysisResult, AgentRunResponse } from "@cultural-elasticity/shared";
import { AgentNotConfiguredError } from "../src/agent/errors.js";
import { createAgentModel, createLiveToolProvider, createScriptedToolProvider, LIVE_AGENT_MODEL_VALIDATION_NOT_RUN, type ModelChoice } from "../src/agent/factory.js";
import { defaultLimits } from "../src/agent/contracts.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { syntheticWorldSchema } from "../src/agent/synthetic-world.js";
import type { AgentToolProvider } from "../src/agent/tool-provider.js";
import { loadLocalEnvFile } from "../src/config/env.js";
import { scrubSecrets } from "../src/qloo/transport.js";

const backendRoot = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2).filter((a) => a !== "--");
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const VALUE_FLAGS = ["--brand", "--territories", "--intent", "--model", "--answer", "--max-qloo-calls", "--json"];
const question = args.find((a, i) => !a.startsWith("--") && !VALUE_FLAGS.includes(args[i - 1] ?? ""));

function printResult(result: AgentRunResponse): void {
  console.log(`\nRun ${result.runId}: ${result.status}`);
  console.log(`Model: ${result.model.id} (${result.model.kind}${result.model.live ? ", live" : ""})`);
  if (result.model.kind !== "llm") console.log(`  ${LIVE_AGENT_MODEL_VALIDATION_NOT_RUN}: decisions came from the ${result.model.kind} policy, not a live model`);
  console.log(`Intent: ${result.trace.intent ?? "not interpreted"}`);
  console.log(`Agent iterations: ${result.metrics.agent_iterations} · Qloo calls: ${result.metrics.qloo_calls} · tool calls: ${result.metrics.tool_calls} · invalid actions: ${result.metrics.invalid_actions}`);
  console.log("\nTool timeline");
  for (const call of result.trace.toolCalls) console.log(`  [${call.iteration}] ${call.tool.padEnd(34)} ${call.status.padEnd(11)} ${call.summary.slice(0, 110)}`);
  if (result.status === "NEEDS_INPUT") {
    console.log(`\nNEEDS_INPUT: ${result.question}\n  ambiguity: ${result.ambiguity}`);
    for (const o of result.options) console.log(`  - ${o.label} (${o.id})`);
    return;
  }
  const r = result as AgentAnalysisResult;
  console.log(`\nResolved brand: ${r.brand ? `${r.brand.label} (${r.brand.id}, ${r.brand.resolution})` : "none"}`);
  console.log(`Evidence origin: ${r.evidenceOrigin} · final sufficiency: ${r.finalSufficiency}`);
  console.log("\nTerritories");
  for (const t of r.territories) {
    console.log(`  ${t.label} [${t.role}, ${t.origin}] → ${t.analysisRoute}`);
    console.log(`    concept: ${t.resolvedConcept ? `${t.resolvedConcept.label} (${t.resolvedConcept.id})` : "none"} · strategy ${t.representation.strategy}`);
    if (t.representation.exemplars.length) console.log(`    exemplars: ${t.representation.exemplars.map((e) => e.label).join(", ")} (diversity ${t.representation.diversity})`);
    for (const x of t.representation.rejectedExemplars) console.log(`    rejected: ${x.label} — ${x.code}: ${x.reason}`);
    for (const line of t.keyEvidence) console.log(`    · ${line}`);
  }
  console.log(`\nSummary (${r.summary.source}; claim validation ${r.summary.claimValidation.passed ? "passed" : "FAILED"})\n${r.summary.text}`);
  if (r.summary.claimValidation.violations.length) console.log(`  rejected model claims: ${r.summary.claimValidation.violations.join(" | ")}`);
  console.log("\nLimitations");
  for (const l of r.limitations) console.log(`  ${l.code}: ${l.detail}`);
  console.log(`\nFollow-up options\n${r.followUpOptions.map((f) => `  - ${f}`).join("\n")}`);
}

async function main(): Promise<number> {
  loadLocalEnvFile();
  if (!question) {
    console.error('usage: pnpm agent:run -- "<question>" [--brand X] [--territories "a,b"] [--model auto|baseline] [--synthetic]');
    return 1;
  }
  const choice = (flag("--model") ?? "auto") as ModelChoice;
  let provider: AgentToolProvider;
  let model;
  try {
    model = createAgentModel(choice);
    if (args.includes("--synthetic")) {
      const world = syntheticWorldSchema.parse(JSON.parse(readFileSync(join(backendRoot, "..", "evals", "fixtures", "synthetic", "agent", "world.json"), "utf8")));
      provider = createScriptedToolProvider(world);
      console.log("Tool provider: SYNTHETIC scripted world (not Qloo evidence)");
    } else {
      provider = createLiveToolProvider();
      console.log(`Tool provider: ${provider.name} (live Qloo hackathon API)`);
    }
  } catch (error) {
    if (error instanceof AgentNotConfiguredError) {
      console.log(`\n${error.message}`);
      if (error.code === "AGENT_MODEL_NOT_CONFIGURED") console.log(`${LIVE_AGENT_MODEL_VALIDATION_NOT_RUN}. Re-run with --model baseline to exercise the runtime with the deterministic reference policy.`);
      else console.log("LIVE_QLOO_VALIDATION_NOT_RUN. Re-run with --synthetic to use the scripted synthetic world.");
      return 3;
    }
    throw error;
  }

  const territoriesFlag = flag("--territories");
  const territories = territoriesFlag === undefined ? undefined : territoriesFlag.split(",").map((t) => t.trim()).filter(Boolean);
  const intent = flag("--intent") as "analyze_move" | "compare_territories" | "explore_frontier" | undefined;
  const maxCalls = flag("--max-qloo-calls");
  const runtime = new AgentRuntime({ model, provider });
  const request = { userQuery: question, ...(flag("--brand") && { brand: flag("--brand") }), ...(territories && { territories }), ...(intent && { intent }) };
  const limits = maxCalls ? { ...defaultLimits(intent ?? (territories ? (territories.length === 0 ? "explore_frontier" : territories.length === 1 ? "analyze_move" : "compare_territories") : undefined)), maxQlooCalls: Number(maxCalls) } : undefined;
  try {
    let result = await runtime.run(request, limits);
    const answer = flag("--answer");
    if (result.status === "NEEDS_INPUT" && answer) {
      printResult(result);
      console.log(`\nContinuing with the provided answer: "${answer}"`);
      result = await runtime.continue(result.runId, answer);
    }
    printResult(result);
    // pnpm runs this from backend/; resolve a relative --json against the directory the user invoked pnpm from.
    const jsonFlag = flag("--json");
    const json = (jsonFlag && resolve(process.env.INIT_CWD ?? process.cwd(), jsonFlag)) ?? (provider.mode === "live" ? join(backendRoot, "feasibility-output", `agent-run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`) : undefined);
    if (json) {
      const text = JSON.stringify(result, null, 1);
      if (scrubSecrets(text) !== text) {
        console.error("ABORTED writing JSON: credential material detected.");
        return 1;
      }
      mkdirSync(dirname(json), { recursive: true });
      writeFileSync(json, `${text}\n`, { mode: 0o600 });
      console.log(`\nFull result (with trace) written to ${json}`);
    }
    return result.status === "NEEDS_INPUT" ? 2 : result.status === "FAILED" ? 1 : 0;
  } finally {
    provider.close?.();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(scrubSecrets(error instanceof Error ? (error.stack ?? error.message) : String(error)));
    process.exit(1);
  },
);
