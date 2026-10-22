/**
 * `pnpm eval:agent:replay -- <dir> [<dir> …] [--out <dir>]`: OFFLINE replay of the CURRENT runtime evaluators
 * (run-evaluators.ts) and frontier stability metrics/criteria over STORED live agent results (Sprint 5A.2, phase 2).
 *
 * It reads `live_model-*.json` and `baseline-*.json` result files as they were written by `pnpm eval:agent:live`, and
 * writes one new `replay-<name>.json` per input directory into --out (default
 * backend/feasibility-output/sprint5a2-live/replay). The stored results and their as-run reports are never modified, so
 * as-run and replayed scores stay separately recorded. No Qloo or model call is made: this is not live validation.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRunResponse } from "@cultural-elasticity/shared";
import { FRONTIER_STABILITY_METRICS_VERSION } from "../src/agent/frontier.js";
import { evaluateStability, loadStabilityCriteria, stabilityReport } from "./agent-live-harness.js";
import { evaluateRun, RUN_EVALUATORS_VERSION } from "./run-evaluators.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
const outIndex = args.indexOf("--out");
const backendRoot = fileURLToPath(new URL("..", import.meta.url));
const out = resolve(process.env.INIT_CWD ?? process.cwd(), outIndex >= 0 ? args[outIndex + 1]! : join(backendRoot, "feasibility-output", "sprint5a2-live", "replay"));
const dirs = args.filter((_, i) => outIndex < 0 || (i !== outIndex && i !== outIndex + 1)).map((d) => resolve(process.env.INIT_CWD ?? process.cwd(), d));

if (dirs.length === 0) {
  console.error("usage: pnpm eval:agent:replay -- <results dir> [<results dir> …] [--out <dir>]");
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const criteria = loadStabilityCriteria();

for (const dir of dirs) {
  const files = readdirSync(dir).filter((f) => /^(live_model|baseline)-.+\.json$/u.test(f)).sort();
  const runs = files.map((f) => ({ file: f, arm: f.startsWith("baseline") ? "BASELINE" : "LIVE_MODEL", caseId: f.replace(/^(live_model|baseline)-/u, "").replace(/-stability-\d+\.json$|\.json$/u, ""), response: JSON.parse(readFileSync(join(dir, f), "utf8")) as AgentRunResponse }));
  const perRun = runs.map((r) => ({ file: r.file, arm: r.arm, caseId: r.caseId, evaluators: evaluateRun(r.response).filter((e) => e.applicable).map((e) => ({ id: e.id, passed: e.passed, detail: e.detail })) }));
  const frontier = [...new Set(runs.filter((r) => r.arm === "LIVE_MODEL" && /^L-E\d/u.test(r.caseId)).map((r) => r.caseId))];
  const stability = Object.fromEntries(
    frontier.map((caseId) => {
      const report = stabilityReport(runs.filter((r) => r.arm === "LIVE_MODEL" && r.caseId === caseId).map((r) => r.response));
      return [caseId, { report, evaluation: evaluateStability(caseId, report, criteria) }];
    }),
  );
  const replay = { notice: "OFFLINE REPLAY of stored live results with the current evaluators and metrics; not a live run. As-run reports are unchanged.", source: dir, runEvaluatorsVersion: RUN_EVALUATORS_VERSION, stabilityMetricsVersion: FRONTIER_STABILITY_METRICS_VERSION, stabilityCriteriaVersion: criteria.version, perRun, stability };
  const name = `replay-${basename(resolve(dir, ".."))}-${basename(dir)}.json`;
  writeFileSync(join(out, name), `${JSON.stringify(replay, null, 1)}\n`);
  console.log(`\n${dir} (${files.length} results) → ${join(out, name)}`);
  for (const r of perRun) {
    const failed = r.evaluators.filter((e) => !e.passed);
    console.log(`  ${r.arm.padEnd(10)} ${r.file.padEnd(36)} ${failed.length === 0 ? "all evaluators pass" : failed.map((e) => `${e.id} ✗ ${e.detail}`).join(" | ")}`);
  }
  for (const [caseId, s] of Object.entries(stability)) console.log(`  stability ${caseId}: ${s.evaluation.status} ${s.evaluation.checks.map((c) => `${c.name.split(" ")[0]}=${JSON.stringify(c.value)}${c.passed ? "" : "✗"}`).join(" · ")}`);
}
