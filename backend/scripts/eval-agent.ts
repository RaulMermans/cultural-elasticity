/**
 * `pnpm eval:agent`: offline agent-runtime evaluation over evals/agent/scenarios.json (SYNTHETIC world).
 * Exit 0 when every acceptance threshold passes.   -- --json <file> also writes the report.
 */
import { writeFileSync } from "node:fs";
import { formatAgentEval, runAgentEval } from "./agent-eval-harness.js";

const report = await runAgentEval();
console.log(formatAgentEval(report));
const jsonIndex = process.argv.indexOf("--json");
if (jsonIndex >= 0 && process.argv[jsonIndex + 1]) {
  const compact = { ...report, scenarios: report.scenarios.map(({ id, category, passed, failures, response }) => ({ id, category, passed, failures, status: response.status, metrics: response.metrics })) };
  writeFileSync(process.argv[jsonIndex + 1] as string, `${JSON.stringify(compact, null, 2)}\n`);
}
process.exit(report.passed ? 0 : 1);
