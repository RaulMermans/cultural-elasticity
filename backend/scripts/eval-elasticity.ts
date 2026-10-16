/**
 * `pnpm eval:elasticity`: offline evaluation of the methodology on the live benchmark fixtures.
 * Exit 0 when every structural check passes (accuracy is reported, not gated). No network request.
 *   -- --json <file>   also writes the report (without full results) as JSON
 */
import { writeFileSync } from "node:fs";
import { formatElasticityEval, runElasticityEval } from "./elasticity-harness.js";

const report = runElasticityEval();
console.log(formatElasticityEval(report));
const jsonIndex = process.argv.indexOf("--json");
if (jsonIndex >= 0 && process.argv[jsonIndex + 1]) {
  const { results, ...rest } = report;
  writeFileSync(process.argv[jsonIndex + 1] as string, `${JSON.stringify({ ...rest, results: Object.fromEntries(results) }, null, 2)}\n`);
}
process.exit(report.passed ? 0 : 1);
