/**
 * `pnpm eval:query`: Sprint 5B.1 query-interpretation evaluation over evals/query/manifest.json (SYNTHETIC labels).
 *   (default)          offline gate/handoff replay of gold-derived proposals against the synthetic world
 *   -- --live          real Claude Haiku 5.5 interpretation, dry run (no Qloo call): LIVE_HAIKU_INTERPRETATION
 *   -- --json <file>   also write the report;  -- --cases D01,H03   run a subset;  -- --freeze   freeze held-out splits
 * Exit 0 offline when every acceptance check passes; live, exit 0 only for QUERY_LAYER_READY.
 */
import { writeFileSync } from "node:fs";
import { loadLocalEnvFile } from "../src/config/env.js";
import { createQueryInterpreter, hasModelCredential } from "../src/agent/factory.js";
import { formatQueryEval, freezeManifest, runQueryEval } from "./query-eval-harness.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

if (process.argv.includes("--freeze")) {
  console.log(`held-out splits frozen: ${freezeManifest()}`);
  process.exit(0);
}

const live = process.argv.includes("--live");
if (live) {
  loadLocalEnvFile();
  if (!hasModelCredential()) {
    console.log("LIVE_HAIKU_QUERY_VALIDATION_NOT_RUN: no ANTHROPIC_API_KEY is configured. The offline replay is not a substitute.");
    process.exit(2);
  }
}
const cases = arg("--cases")?.split(",");
const report = await runQueryEval({ ...(live && { interpreter: createQueryInterpreter("auto") }), ...(cases && { cases }) });
console.log(formatQueryEval(report));
const out = arg("--json");
if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
const offlinePassed = report.acceptance.every((a) => a.passed);
process.exit(live ? (report.verdict === "QUERY_LAYER_READY" ? 0 : 1) : offlinePassed ? 0 : 1);
