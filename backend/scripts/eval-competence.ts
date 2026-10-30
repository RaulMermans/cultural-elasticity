/**
 * `pnpm eval:competence`: Sprint 9O runtime competence evaluation on REAL Qloo answers.
 *
 *   -- --live --out <dir> [--cases id,…] [--arms before,new]
 *        Production model (Haiku) and live Qloo. Each case is recorded to <dir>/<case>.cassette.json; a call already
 *        recorded for the case is served from the recording, so the arms see identical Qloo answers (a matched
 *        comparison). Live dispatches stop at the manifest's allowance; model spend is checked before each run.
 *        Report label: LIVE (recorded). Needs QLOO_API_KEY, QLOO_API_BASE_URL and ANTHROPIC_API_KEY.
 *   -- --decisions [--policy …] [--arms before,new] [--split dev,holdout] [--repeats N] [--approved-usd X]
 *        Sprint 10B decision-point cases (evals/competence/decisions.json) on the SYNTHETIC world: one turn per case is
 *        taken by the policy under test (scripts/competence/decisions.ts). Offline by default; `--policy haiku` calls
 *        Anthropic only, under an owner-approved ceiling. Report label: SYNTHETIC / LIVE_HAIKU_DECISIONS.
 *   -- --audit <dir> [<dir> …] [--json file]
 *        Sprint 10B decision-quality audit of stored LLM runs (scripts/competence/audit.ts): refusals, empty probes and
 *        stops grouped by taxonomy label and cause. Reads files only.
 *   -- --replay <dir> [--model baseline|haiku] [--arms …]
 *        The same cases on the recorded answers only. No Qloo call; `baseline` makes no provider call at all.
 *        A call never recorded is a FAILED call (never evidence) and is counted as a coverage miss.
 *        Report label: REPLAY of recorded live Qloo answers (results are labelled synthetic, never live).
 * Cases, arms and the pass bar come from evals/competence/cases.json (pre-registered). Exit 0 when the bar is met.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decisionCard, type AgentAnalysisResult, type AgentRunResponse } from "@cultural-elasticity/shared";
import { createAgentModel, createLiveToolProvider } from "../src/agent/factory.js";
import { BaselinePolicyModel } from "../src/agent/model/baseline.js";
import type { AgentModel } from "../src/agent/model/provider.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import type { AgentToolProvider } from "../src/agent/tool-provider.js";
import { HAIKU_CONSERVATIVE, MODEL_PRICES } from "../src/ops/pricing.js";
import { CachingRecorder, CASSETTE_SCHEMA, readCassette, ReplayProvider, writeCassette, type Cassette } from "./competence/cassette.js";
import { runMetrics } from "./d2d/harness.js";

type Arm = "before" | "new";
type Case = { id: string; brand: string; territory: string; kind: string };
type Manifest = { arms: Record<Arm, { feasibilityPolicy: "enforce" | "observe"; referenceDiscovery: boolean }>; budget: { maxLiveQlooDispatches: number; maxModelUsd: number }; cases: Case[] };

const MANIFEST_PATH = new URL("../../evals/competence/cases.json", import.meta.url);
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
if (process.argv.includes("--audit")) {
  const { auditCli } = await import("./competence/audit.js");
  process.exit(auditCli(process.argv));
}
if (process.argv.includes("--decisions")) {
  const { decisionsCli } = await import("./competence/decisions.js");
  const price = MODEL_PRICES["claude-haiku-5-5"] ?? HAIKU_CONSERVATIVE;
  process.exit(await decisionsCli(process.argv, () => createAgentModel("anthropic"), price));
}
const live = process.argv.includes("--live");
const dir = live ? arg("--out") : arg("--replay");
if (!dir) throw new Error("usage: eval:competence -- --live --out <dir> | --replay <dir> [--model baseline|haiku]");
mkdirSync(dir, { recursive: true });
const arms = (arg("--arms")?.split(",") ?? ["before", "new"]) as Arm[];
const only = arg("--cases")?.split(",");
const cases = manifest.cases.filter((c) => !only || only.includes(c.id));
const replayModel = arg("--model") ?? "baseline";
const PER_CASE_RESERVE = 30;

/** Conservative model cost from the run's own token counts (cache reads billed as input). */
function modelUsd(r: AgentRunResponse): number {
  const price = MODEL_PRICES[r.model.id] ?? HAIKU_CONSERVATIVE;
  return (r.metrics.model_input_tokens * price.input + r.metrics.model_output_tokens * price.output) / 1e6;
}

type Row = {
  caseId: string; arm: Arm; status: string; measured: boolean; semanticallyValid: boolean | null; honestUnmeasured: boolean | null;
  safetyViolations: number; qlooCalls: number; recommends: number; emptyProbes: number; iterations: number; modelUsd: number; latencyMs: number;
  route: string | null; classification: string | null; position: string | null; comparisonSet: string[]; implication: string | null; sweepUsable: number; misses?: number;
};

function score(caseId: string, arm: Arm, r: AgentRunResponse): Row {
  const m = runMetrics(r);
  const analysis = "territories" in r ? (r as AgentAnalysisResult) : null;
  const target = analysis?.territories.find((t) => t.role === "target") ?? null;
  const measured = Boolean(target && target.analysisRoute === "FULL_RELATIVE_ANALYSIS" && target.classification && target.relativePosition?.position != null);
  const card = analysis && target ? decisionCard(analysis, target.key) : null;
  const recommends = r.trace.toolCalls.filter((c) => c.tool === "qloo_recommend" && c.status !== "rejected" && (c.arguments as { conditionOnBrand?: boolean })?.conditionOnBrand === false).length;
  return {
    caseId, arm, status: r.status, measured,
    semanticallyValid: measured ? (target!.comparisonSet?.semanticStatus ?? "MEANINGFUL") === "MEANINGFUL" : null,
    honestUnmeasured: measured ? null : Boolean(card && card.uncertain.length > 1 && card.nextActions.length > 0),
    safetyViolations: m.unsupportedClassifications + m.crossCallComparisons + m.cards.reduce((n, c) => n + c.violations.length, 0),
    qlooCalls: m.qlooCalls, recommends, emptyProbes: m.emptyProbes, iterations: m.iterations, modelUsd: r.model.kind === "llm" ? modelUsd(r) : 0, latencyMs: r.metrics.latency_ms,
    route: target?.analysisRoute ?? null, classification: target?.classification?.label ?? null,
    position: target?.relativePosition?.position != null ? `${target.relativePosition.position} of ${target.relativePosition.of}` : null,
    comparisonSet: target?.comparisonSet?.labels ?? [], implication: card?.implication.code ?? null,
    sweepUsable: (r.trace.referenceDiscovery ?? []).flatMap((s) => s.probes).filter((p) => (p.eligible ?? 0) >= 2).length,
  };
}

const runtimeFor = (arm: Arm, model: AgentModel, provider: AgentToolProvider) =>
  new AgentRuntime({ model, provider, feasibilityPolicy: manifest.arms[arm].feasibilityPolicy, referenceDiscovery: manifest.arms[arm].referenceDiscovery });
const request = (c: Case) => ({ userQuery: `How far can ${c.brand} extend into ${c.territory}?`, intent: "analyze_move" as const, brand: c.brand, territories: [c.territory] });

const rows: Row[] = [];
const notRun: { caseId: string; reason: string }[] = [];
let dispatches = 0;
let usd = 0;

if (live) {
  const liveProvider = createLiveToolProvider();
  try {
    for (const c of cases) {
      if (manifest.budget.maxLiveQlooDispatches - dispatches < PER_CASE_RESERVE) { notRun.push({ caseId: c.id, reason: `live allowance left (${manifest.budget.maxLiveQlooDispatches - dispatches}) below the ${PER_CASE_RESERVE}-dispatch case reserve` }); continue; }
      if (manifest.budget.maxModelUsd - usd < 0.05) { notRun.push({ caseId: c.id, reason: `model allowance left ($${(manifest.budget.maxModelUsd - usd).toFixed(3)}) below $0.05` }); continue; }
      const path = join(dir, `${c.id}.cassette.json`);
      const cassette: Cassette = existsSync(path) ? readCassette(path) : { schema: CASSETTE_SCHEMA, caseId: c.id, recordedWith: { engineRevision: process.env.CE_ENGINE_REVISION ?? "local", model: "anthropic" }, entries: [] };
      for (const arm of arms) {
        const provider = new CachingRecorder(liveProvider, cassette, { maxLiveCalls: manifest.budget.maxLiveQlooDispatches, used: () => dispatches, onLive: (n) => { dispatches += n; } });
        const started = Date.now();
        let r: AgentRunResponse;
        try {
          r = await runtimeFor(arm, createAgentModel("anthropic"), provider).run(request(c));
        } finally {
          writeCassette(path, cassette);
        }
        writeFileSync(join(dir, `${c.id}.${arm}.json`), `${JSON.stringify(r, null, 2)}\n`);
        const row = score(c.id, arm, r);
        usd += row.modelUsd;
        rows.push(row);
        console.log(`${c.id} ${arm}: ${row.measured ? `MEASURED ${row.classification} ${row.position}` : `not measured (${row.route ?? r.status})`} | ${row.qlooCalls} Qloo (${provider.liveCalls} live, ${provider.cacheHits} cached) | ${row.emptyProbes}/${row.recommends} empty | ${row.iterations} turns | $${row.modelUsd.toFixed(4)} | ${Math.round((Date.now() - started) / 1000)} s`);
      }
    }
  } finally {
    liveProvider.close?.();
  }
} else {
  for (const c of cases) {
    const path = join(dir, `${c.id}.cassette.json`);
    if (!existsSync(path)) { notRun.push({ caseId: c.id, reason: "no recording" }); continue; }
    for (const arm of arms) {
      const provider = new ReplayProvider([readCassette(path)]);
      const model = replayModel === "haiku" ? createAgentModel("anthropic") : new BaselinePolicyModel();
      const r = await runtimeFor(arm, model, provider).run(request(c));
      const row = { ...score(c.id, arm, r), misses: provider.misses.length };
      usd += row.modelUsd;
      rows.push(row);
      console.log(`${c.id} ${arm} [replay, ${replayModel}]: ${row.measured ? `MEASURED ${row.classification} ${row.position}` : `not measured (${row.route ?? r.status})`} | ${row.qlooCalls} calls, ${row.misses} not recorded | ${row.emptyProbes}/${row.recommends} empty | ${row.iterations} turns`);
    }
  }
}

// ---- Pass bar (evals/competence/cases.json) ----
const byArm = (arm: Arm) => rows.filter((r) => r.arm === arm);
const measuredCount = (arm: Arm) => byArm(arm).filter((r) => r.measured).length;
const newRows = byArm("new");
const checks = [
  { name: "safety: no unsupported class, cross-call comparison or card violation in any run", pass: rows.every((r) => r.safetyViolations === 0), value: rows.reduce((n, r) => n + r.safetyViolations, 0) },
  { name: "competence: the new arm measures the target in at least half of its cases, every measured set valid", pass: newRows.length > 0 && measuredCount("new") * 2 >= newRows.length && newRows.every((r) => r.semanticallyValid !== false), value: `${measuredCount("new")}/${newRows.length}` },
  { name: "improvement: new measures at least as many cases as before on identical answers", pass: !arms.includes("before") || measuredCount("new") >= measuredCount("before"), value: `${measuredCount("before")} → ${measuredCount("new")}` },
  { name: "honesty: every unmeasured new-arm run explains why and what next", pass: newRows.every((r) => r.measured || r.honestUnmeasured), value: `${newRows.filter((r) => !r.measured && r.honestUnmeasured).length}/${newRows.filter((r) => !r.measured).length}` },
];
const sum = (arm: Arm, k: "qlooCalls" | "emptyProbes" | "recommends" | "iterations" | "modelUsd") => byArm(arm).reduce((n, r) => n + r[k], 0);
const label = live ? "LIVE (recorded; Haiku + live Qloo, shared answers per case)" : `REPLAY of recorded live Qloo answers (${replayModel}; results labelled synthetic)`;
const report = { schema: "ce-competence-report/1", label, generatedAt: new Date().toISOString(), liveDispatches: dispatches, modelUsd: Number(usd.toFixed(4)), rows, notRun, checks, passed: checks.every((c) => c.pass) && rows.length > 0 };
writeFileSync(join(dir, live ? "report.live.json" : `report.replay-${replayModel}.json`), `${JSON.stringify(report, null, 2)}\n`);

console.log(`\n${label}`);
for (const arm of arms) {
  const n = byArm(arm).length;
  if (!n) continue;
  console.log(`  ${arm.padEnd(6)} measured ${measuredCount(arm)}/${n} | Qloo calls ${sum(arm, "qlooCalls")} | empty probes ${sum(arm, "emptyProbes")}/${sum(arm, "recommends")} | turns ${sum(arm, "iterations")} | model $${sum(arm, "modelUsd").toFixed(4)}`);
}
for (const n of notRun) console.log(`  NOT_RUN ${n.caseId}: ${n.reason}`);
for (const c of checks) console.log(`  [${c.pass ? "PASS" : "FAIL"}] ${c.name}: ${c.value}`);
console.log(`live Qloo dispatches ${dispatches}; model $${usd.toFixed(4)}`);
console.log(report.passed ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(report.passed ? 0 : 1);
