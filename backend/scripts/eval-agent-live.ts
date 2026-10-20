/**
 * `pnpm eval:agent:live [-- options]`: LIVE agent evaluation (live Qloo; live model only with a key).
 *
 *   --arms baseline,model   arms to run (default both; the model arm reports LIVE_AGENT_MODEL_VALIDATION_NOT_RUN
 *                           without ANTHROPIC_API_KEY and is never replaced by another policy)
 *   --cases L-M1,L-C2       subset of evals/agent/live-cases.json
 *   --stability N           repeat each frontier case N times in the model arm
 *   --benchmark [keys]      also run benchmark brands through the agent (comma-separated keys; default all)
 *   --baseline-from <file>  reuse the BASELINE metrics of an earlier report.json (compare without re-running it)
 *   --out <dir>             output directory (default backend/feasibility-output/sprint4-live/<timestamp>)
 *
 * Live runs make real Qloo calls (spaced; minutes per case). Results are written per run with traces.
 * Exit codes: 0 completed (whatever the readiness decision) · 3 not configured · 1 failure.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentNotConfiguredError } from "../src/agent/errors.js";
import { createAgentModel, createLiveToolProvider, hasModelCredential, LIVE_AGENT_MODEL_VALIDATION_NOT_RUN } from "../src/agent/factory.js";
import { BaselinePolicyModel } from "../src/agent/model/baseline.js";
import type { AgentModel } from "../src/agent/model/provider.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { loadLocalEnvFile } from "../src/config/env.js";
import { scrubSecrets } from "../src/qloo/transport.js";
import { armMetrics, benchmarkTerritoryLabels, evaluateBenchmarkRun, loadBenchmark, loadLiveCases, readinessGate, runLiveCase, stabilityOf, type Arm, type LiveRun } from "./agent-live-harness.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const backendRoot = fileURLToPath(new URL("..", import.meta.url));

function write(dir: string, name: string, value: unknown): void {
  const text = JSON.stringify(value, null, 1);
  if (scrubSecrets(text) !== text) throw new Error(`credential material detected in ${name}; not written`);
  writeFileSync(join(dir, name), `${text}\n`, { mode: 0o600 });
}

const short = (r: LiveRun) =>
  r.response.status === "NEEDS_INPUT"
    ? `NEEDS_INPUT (${r.response.options.length} options)`
    : `${r.response.status} · ${(r.response as import("@cultural-elasticity/shared").AgentAnalysisResult).territories.map((t) => `${t.label}:${t.analysisRoute.replace("_ANALYSIS", "").replace("_EVIDENCE", "")}`).join(", ")}`;

async function main(): Promise<number> {
  loadLocalEnvFile();
  const arms = (flag("--arms") ?? "baseline,model").split(",").map((a) => (a.trim() === "model" ? "LIVE_MODEL" : "BASELINE")) as Arm[];
  const wanted = flag("--cases")?.split(",").map((c) => c.trim());
  const cases = loadLiveCases().filter((c) => !wanted || wanted.includes(c.id));
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const out = resolve(process.env.INIT_CWD ?? process.cwd(), flag("--out") ?? join(backendRoot, "feasibility-output", "sprint4-live", stamp));
  mkdirSync(out, { recursive: true });

  let provider;
  try {
    provider = createLiveToolProvider();
  } catch (error) {
    if (error instanceof AgentNotConfiguredError) {
      console.log(`${error.message}\nLIVE_QLOO_VALIDATION_NOT_RUN`);
      return 3;
    }
    throw error;
  }
  console.log(`Live agent evaluation · Qloo: ${provider.name} · model: ${hasModelCredential() ? "configured" : LIVE_AGENT_MODEL_VALIDATION_NOT_RUN} · output ${out}`);
  const runs: Record<Arm, LiveRun[] | null> = { BASELINE: null, LIVE_MODEL: null };
  try {
    for (const arm of arms) {
      let model: AgentModel;
      if (arm === "BASELINE") model = new BaselinePolicyModel();
      else if (!hasModelCredential()) {
        console.log(`\n[LIVE_MODEL] ${LIVE_AGENT_MODEL_VALIDATION_NOT_RUN}: no ANTHROPIC_API_KEY; the model arm was not run and nothing was substituted.`);
        continue;
      } else model = createAgentModel("anthropic");
      runs[arm] = [];
      console.log(`\n[${arm}] ${model.info.id}`);
      for (const c of cases) {
        const started = Date.now();
        try {
          const run = await runLiveCase(c, arm, model, provider);
          runs[arm]!.push(run);
          write(out, `${arm.toLowerCase()}-${c.id}.json`, run.response);
          console.log(`  ${c.id} ${short(run)} · ${run.response.metrics.qloo_calls} Qloo · ${run.response.metrics.agent_iterations} it · ${Math.round((Date.now() - started) / 1000)} s${run.failures?.length ? `\n     ✗ ${run.failures.join(" | ")}` : ""}`);
        } catch (error) {
          console.log(`  ${c.id} ERROR ${scrubSecrets(error instanceof Error ? error.message : String(error)).slice(0, 300)}`);
        }
      }
    }

    const baselineFrom = flag("--baseline-from");
    const reused = baselineFrom ? (JSON.parse(readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), baselineFrom), "utf8")) as { metrics?: { BASELINE?: Record<string, number | string | null> | null } }).metrics?.BASELINE ?? null : null;
    if (baselineFrom) console.log(`\nBASELINE metrics reused from ${baselineFrom}${reused ? "" : " (none found)"}`);
    const baselineMetrics = runs.BASELINE ? armMetrics(runs.BASELINE) : reused;
    const modelMetrics = runs.LIVE_MODEL ? armMetrics(runs.LIVE_MODEL) : null;
    const gate = readinessGate(runs.LIVE_MODEL, baselineMetrics, modelMetrics);

    let stability = null;
    const repeats = Number(flag("--stability") ?? 0);
    if (repeats > 1 && runs.LIVE_MODEL) {
      stability = {} as Record<string, unknown>;
      for (const c of cases.filter((x) => x.intent === "explore_frontier")) {
        const responses = [runs.LIVE_MODEL.find((r) => r.caseId === c.id)!.response];
        for (let i = 1; i < repeats; i += 1) responses.push((await runLiveCase(c, "LIVE_MODEL", createAgentModel("anthropic"), provider)).response);
        stability[c.id] = stabilityOf(responses);
      }
    }

    let benchmark = null;
    if (args.includes("--benchmark")) {
      const b = loadBenchmark();
      const keys = (flag("--benchmark") && !flag("--benchmark")!.startsWith("--") ? flag("--benchmark")!.split(",") : b.brands.map((x) => x.key)).map((k) => k.trim());
      const labels = benchmarkTerritoryLabels();
      benchmark = { ownerReviewed: (b as { ownerReview?: { owner_reviewed: boolean } }).ownerReview?.owner_reviewed ?? false, arms: {} as Record<string, unknown[]> };
      for (const arm of arms) {
        if (arm === "LIVE_MODEL" && !hasModelCredential()) continue;
        const model = arm === "BASELINE" ? new BaselinePolicyModel() : createAgentModel("anthropic");
        benchmark.arms[arm] = [];
        for (const key of keys) {
          const brand = b.brands.find((x) => x.key === key);
          if (!brand) continue;
          // The request carries only the brand name and territory WORDS; labels stay in this script.
          const territories = b.territorySet.map((id) => labels[id] ?? id);
          const response = await new AgentRuntime({ model, provider }).run({ userQuery: `For ${brand.label}, compare ${territories.join(", ")}.`, brand: brand.label, territories });
          write(out, `benchmark-${arm.toLowerCase()}-${key}.json`, response);
          const evaluated = evaluateBenchmarkRun(b, key, response);
          benchmark.arms[arm]!.push(evaluated);
          const n = (o: string) => evaluated.assertions.filter((a) => a.outcome === o).length;
          console.log(`  [benchmark ${arm}] ${key}: correct ${n("correct")} · wrong ${n("wrong")} · not comparable ${n("not_comparable")}`);
        }
      }
    }

    const report = { generatedAt: new Date().toISOString(), qlooProvider: provider.name, modelStatus: hasModelCredential() ? "configured" : LIVE_AGENT_MODEL_VALIDATION_NOT_RUN, cases: cases.map((c) => ({ id: c.id, tags: c.tags })), baselineSource: runs.BASELINE ? "this run" : baselineFrom ?? null, metrics: { BASELINE: baselineMetrics, LIVE_MODEL: modelMetrics ?? LIVE_AGENT_MODEL_VALIDATION_NOT_RUN }, readiness: gate, stability: stability ?? (runs.LIVE_MODEL ? "not requested" : LIVE_AGENT_MODEL_VALIDATION_NOT_RUN), benchmark };
    write(out, "report.json", report);
    console.log("\nMetrics (arms are reported separately; never merged)");
    for (const [arm, m] of Object.entries(report.metrics)) {
      console.log(`  ${arm}`);
      if (typeof m === "string" || m === null) console.log(`    ${m ?? "not run"}`);
      else for (const [k, v] of Object.entries(m)) console.log(`    ${k.padEnd(32)} ${v ?? "n/a"}`);
    }
    console.log(`\nReadiness: ${gate.decision}`);
    for (const h of gate.hard) console.log(`  [${h.passed ? "PASS" : "FAIL"}] ${h.name}: ${h.value} (required ${h.required})`);
    for (const reason of gate.reasons) console.log(`  - ${reason}`);
    console.log(`\nWritten: ${out}`);
    return 0;
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
