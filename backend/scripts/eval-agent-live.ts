/**
 * `pnpm eval:agent:live [-- options]`: LIVE agent evaluation (live Qloo; live model only with a key).
 *
 *   --arms baseline,model   arms to run (default both; the model arm reports LIVE_AGENT_MODEL_VALIDATION_NOT_RUN
 *                           without ANTHROPIC_API_KEY and is never replaced by another policy)
 *   --cases L-M1,L-C2       subset of evals/agent/live-cases.json
 *   --stability N           run each frontier case N times in total in the model arm (Sprint 5A readiness needs 3)
 *   --benchmark [keys]      also run benchmark brands through the agent (comma-separated keys; default all)
 *   --baseline-from <file>  reuse the BASELINE runs' metrics of an earlier report.json (only with the case ids it covered)
 *   --out <dir>             output directory (default backend/feasibility-output/sprint5a1-live/<timestamp>)
 *
 * Sprint 5A.1: the controlled positive scenario(s) of evals/agent/controlled-cases.json run too (in both arms, after a live
 * preflight of their preconditions) whenever --cases is absent or names them; they are reported separately and never
 * enter the seven-case denominator. The readiness gate (v3) separates SAFETY and COMPETENCE.
 *
 * Sprint 5A: the model arm is Claude Haiku 5.5 (AGENT_MODEL may override it for development; readiness is judged on
 * claude-haiku-5-5 only). A case that throws counts as errored and stays in the denominator; nothing is dropped.
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
import { armMetrics, benchmarkTerritoryLabels, efficiency, evaluateBenchmarkRun, loadBenchmark, loadControlledCases, loadLiveManifest, preflightControlledCase, readinessGate, runLiveCase, stabilityReport, stageTiming, type Arm, type CaseError, type LiveRun, type PreflightResult, type StabilityReport } from "./agent-live-harness.js";
import { evaluateRun } from "./run-evaluators.js";

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
  const manifest = loadLiveManifest();
  const cases = manifest.cases.filter((c) => !wanted || wanted.includes(c.id));
  const controlledDoc = loadControlledCases();
  const controlledCases = controlledDoc.cases.filter((c) => !wanted || wanted.includes(c.id));
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const out = resolve(process.env.INIT_CWD ?? process.cwd(), flag("--out") ?? join(backendRoot, "feasibility-output", "sprint5a1-live", stamp));
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
  const controlledRuns: Record<Arm, LiveRun[] | null> = { BASELINE: null, LIVE_MODEL: null };
  const preflight: PreflightResult[] = [];
  const errors: CaseError[] = [];
  try {
    // Sprint 5A.1: verify the controlled scenarios' Qloo preconditions first (live); a changed precondition is reported.
    for (const c of controlledCases) {
      const result = await preflightControlledCase(c, provider);
      preflight.push(result);
      console.log(`[controlled preflight] ${c.id}: ${result.status}${result.checks.filter((x) => !x.passed).map((x) => `\n     ✗ ${x.name}: ${x.detail}`).join("")}`);
    }
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
          const m = run.response.metrics;
          console.log(`  ${c.id} ${short(run)} · ${m.qloo_calls} Qloo · ${m.agent_iterations} it · ${Math.round((Date.now() - started) / 1000)} s (model ${Math.round(m.model_latency_ms / 1000)} s, Qloo ${Math.round(m.qloo_latency_ms / 1000)} s of which spacing ${Math.round((m.qloo_spacing_ms ?? 0) / 1000)} s) · $${m.model_cost_usd ?? "n/a"}${run.failures?.length ? `\n     ✗ ${run.failures.join(" | ")}` : ""}`);
        } catch (error) {
          const message = scrubSecrets(error instanceof Error ? error.message : String(error)).slice(0, 300);
          errors.push({ caseId: c.id, arm, error: message });
          console.log(`  ${c.id} ERROR ${message} (counted as errored; stays in the denominator)`);
        }
      }
      // Controlled scenarios run in the same arm (case-matched), only when their preflight passed.
      controlledRuns[arm] = [];
      for (const c of controlledCases.filter((x) => preflight.find((p) => p.caseId === x.id)?.status === "PASS")) {
        try {
          const run = await runLiveCase(c, arm, arm === "BASELINE" ? new BaselinePolicyModel() : createAgentModel("anthropic"), provider);
          controlledRuns[arm]!.push(run);
          write(out, `${arm.toLowerCase()}-${c.id}.json`, run.response);
          console.log(`  [controlled] ${c.id} ${short(run)} · ${run.response.metrics.qloo_calls} Qloo · ${run.response.metrics.agent_iterations} it`);
        } catch (error) {
          errors.push({ caseId: c.id, arm, error: scrubSecrets(error instanceof Error ? error.message : String(error)).slice(0, 300) });
          console.log(`  [controlled] ${c.id} ERROR (counted as errored)`);
        }
      }
    }

    const baselineFrom = flag("--baseline-from");
    const reusedReport = baselineFrom ? (JSON.parse(readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), baselineFrom), "utf8")) as { metrics?: { BASELINE?: Record<string, number | string | null> | null }; baselineCaseIds?: string[] }) : null;
    const reused = reusedReport?.metrics?.BASELINE && reusedReport.baselineCaseIds ? { metrics: reusedReport.metrics.BASELINE, caseIds: reusedReport.baselineCaseIds } : null;
    if (baselineFrom) console.log(`\nBASELINE metrics reused from ${baselineFrom}${reused ? ` (${reused.caseIds.length} cases)` : " (none usable: the report records no baseline case ids)"}`);

    let stability: Record<string, StabilityReport> | null = null;
    const repeats = Number(flag("--stability") ?? 0);
    if (repeats > 1 && runs.LIVE_MODEL) {
      stability = {};
      for (const c of cases.filter((x) => x.intent === "explore_frontier")) {
        const first = runs.LIVE_MODEL.find((r) => r.caseId === c.id);
        const responses = first ? [first.response] : [];
        for (let i = responses.length; i < repeats; i += 1) {
          try {
            const run = await runLiveCase(c, "LIVE_MODEL", createAgentModel("anthropic"), provider);
            write(out, `live_model-${c.id}-stability-${i + 1}.json`, run.response);
            responses.push(run.response);
            console.log(`  [stability] ${c.id} run ${i + 1}: ${short(run)}`);
          } catch (error) {
            errors.push({ caseId: `${c.id}#stability-${i + 1}`, arm: "LIVE_MODEL", error: scrubSecrets(error instanceof Error ? error.message : String(error)).slice(0, 300) });
          }
        }
        stability[c.id] = stabilityReport(responses);
      }
    }

    const frontierCaseIds = manifest.cases.filter((c) => c.intent === "explore_frontier").map((c) => c.id);
    const gate = readinessGate({
      manifest: { version: manifest.version, caseIds: manifest.cases.map((c) => c.id), frontierCaseIds },
      modelRuns: runs.LIVE_MODEL,
      baselineRuns: runs.BASELINE,
      baselineReused: runs.BASELINE ? null : reused,
      errors,
      stability,
      controlled: controlledCases.length > 0 ? { preflight, modelRuns: controlledRuns.LIVE_MODEL, baselineRuns: controlledRuns.BASELINE } : null,
    });
    const baselineMetrics = runs.BASELINE ? armMetrics(runs.BASELINE) : (reused?.metrics ?? null);
    const modelMetrics = runs.LIVE_MODEL ? armMetrics(runs.LIVE_MODEL) : null;
    const perCase = (arm: Arm) =>
      (runs[arm] ?? []).map((r) => {
        const m = r.response.metrics;
        return { caseId: r.caseId, evaluators: evaluateRun(r.response).filter((e) => e.applicable).map((e) => `${e.id}:${e.passed ? "pass" : "FAIL"}`), timing: stageTiming(r.response), emptyTypeProbes: m.empty_type_probes ?? null, probeLimitRefusals: m.probe_limit_refusals ?? null, typeAlignmentDeferrals: m.type_alignment_deferrals ?? null, status: r.response.status, model: r.response.model.id, routes: r.response.status === "NEEDS_INPUT" ? [] : (r.response as import("@cultural-elasticity/shared").AgentAnalysisResult).territories.map((t) => `${t.key}:${t.role}:${t.analysisRoute}`), qlooCalls: m.qloo_calls, iterations: m.agent_iterations, latencyMs: m.latency_ms, modelLatencyMs: m.model_latency_ms, qlooLatencyMs: m.qloo_latency_ms, qlooSpacingMs: m.qloo_spacing_ms ?? null, analysisLatencyMs: m.analysis_latency_ms ?? null, synthesisLatencyMs: m.synthesis_latency_ms ?? null, inputTokens: m.model_input_tokens, outputTokens: m.model_output_tokens, costUsd: m.model_cost_usd, synthesisSource: r.response.status === "NEEDS_INPUT" ? null : (r.response as import("@cultural-elasticity/shared").AgentAnalysisResult).summary.source, failures: r.failures ?? [] };
      });

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

    const report = {
      generatedAt: new Date().toISOString(),
      qlooProvider: provider.name,
      modelStatus: hasModelCredential() ? "configured" : LIVE_AGENT_MODEL_VALIDATION_NOT_RUN,
      caseManifestVersion: manifest.version,
      cases: cases.map((c) => ({ id: c.id, tags: c.tags })),
      baselineSource: runs.BASELINE ? "this run" : (baselineFrom ?? null),
      baselineCaseIds: runs.BASELINE ? runs.BASELINE.map((r) => r.caseId) : (reused?.caseIds ?? []),
      metrics: { BASELINE: baselineMetrics, LIVE_MODEL: modelMetrics ?? LIVE_AGENT_MODEL_VALIDATION_NOT_RUN },
      perCase: { BASELINE: perCase("BASELINE"), LIVE_MODEL: perCase("LIVE_MODEL") },
      errors,
      readiness: gate,
      controlled: { manifestVersion: controlledDoc.version, preflight, arms: { BASELINE: (controlledRuns.BASELINE ?? []).map((r) => ({ caseId: r.caseId, status: r.response.status, failures: r.failures ?? [], routes: r.response.status === "NEEDS_INPUT" ? [] : (r.response as import("@cultural-elasticity/shared").AgentAnalysisResult).territories.map((t) => `${t.key}:${t.analysisRoute}`) })), LIVE_MODEL: (controlledRuns.LIVE_MODEL ?? []).map((r) => ({ caseId: r.caseId, status: r.response.status, failures: r.failures ?? [], routes: r.response.status === "NEEDS_INPUT" ? [] : (r.response as import("@cultural-elasticity/shared").AgentAnalysisResult).territories.map((t) => `${t.key}:${t.analysisRoute}`) })) } },
      efficiency: { BASELINE: runs.BASELINE ? efficiency(runs.BASELINE) : null, LIVE_MODEL: runs.LIVE_MODEL ? efficiency(runs.LIVE_MODEL) : null },
      stability: stability ?? (runs.LIVE_MODEL ? "not requested" : LIVE_AGENT_MODEL_VALIDATION_NOT_RUN),
      benchmark,
    };
    write(out, "report.json", report);
    console.log("\nMetrics (arms are reported separately; never merged)");
    for (const [arm, m] of Object.entries(report.metrics)) {
      console.log(`  ${arm}`);
      if (typeof m === "string" || m === null) console.log(`    ${m ?? "not run"}`);
      else for (const [k, v] of Object.entries(m)) console.log(`    ${k.padEnd(32)} ${v ?? "n/a"}`);
    }
    if (stability) for (const [id, st] of Object.entries(stability)) console.log(`\nStability ${id} (${st.runs} runs): exact concept overlap ${st.resolvedConceptOverlap ?? "n/a"} · supported overlap ${st.supportedConceptOverlap ?? "n/a"} · canonical ${st.canonicalConceptOverlap ?? "n/a"} · supported canonical ${st.supportedCanonicalOverlap ?? "n/a"} · recurring ${(st.recurringSupportedCanonical ?? []).join("/") || "none"} · anchor consistency ${st.anchorConsistency ?? "n/a"} · theme proxy ${st.themeOverlapProxy ?? "n/a"} · route stability ${st.routeStability ?? "n/a"} · comparable sets ${st.comparisonSetCompatibility?.comparablePairs ?? 0}/${st.comparisonSetCompatibility?.pairsWithFull ?? 0} · comparable class pairs ${st.comparableClassPairs}\n  ${st.candidateSets.map((c) => c.join(", ")).join("\n  ")}`);
    console.log(`\nReadiness (${gate.gateVersion}): ${gate.decision} (model ${gate.modelIds.join(", ") || "none"} · manifest ${gate.caseManifestVersion} · executed ${gate.executedCaseIds.length}/${gate.expectedCaseIds.length} · stability ${gate.frontierStabilityStatus})`);
    console.log(`  SAFETY ${gate.safetyReadiness.passed ? "PASS" : "FAIL"}`);
    for (const h of gate.hard) console.log(`  [${h.passed ? "PASS" : "FAIL"}] ${h.name}: ${h.value} (required ${h.required})`);
    console.log(`  COMPETENCE ${gate.competenceReadiness.passed ? "PASS" : "FAIL"}`);
    for (const h of gate.competenceReadiness.checks) console.log(`  [${h.passed ? "PASS" : "FAIL"}] ${h.name}: ${h.value} (required ${h.required})`);
    for (const f of gate.frontierStability) console.log(`  frontier ${f.caseId}: ${f.status} ${f.checks.map((c) => `${c.name.split(" ")[0]}=${c.value}${c.passed ? "" : "✗"}`).join(" · ")}`);
    for (const reason of gate.reasons) console.log(`  - ${reason}`);
    for (const w of gate.warnings) console.log(`  ! ${w}`);
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
