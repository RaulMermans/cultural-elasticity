/**
 * `pnpm eval:d2d`: Sprint 9N Discovery-to-Decision evaluation (synthetic world in two feasibility arms + recorded live
 * artefacts as run). No provider call. Exit 0 when every case and quality target passes. -- --json <file> writes the report.
 *
 * `pnpm eval:d2d -- --score <dir> [<dir> ...]` scores stored agent results (*.json) with the same per-run metrics, one
 * table per directory: the offline half of a controlled model comparison (identical cases, tools, budgets, methodology).
 * It reads files only; it never calls a provider and never relabels what it reads.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isAgentRunResponse } from "@cultural-elasticity/shared";
import { formatD2D, runD2DEval, runMetrics } from "./d2d/harness.js";

const scoreIndex = process.argv.indexOf("--score");
if (scoreIndex >= 0) {
  const dirs = process.argv.slice(scoreIndex + 1).filter((arg) => !arg.startsWith("--"));
  if (dirs.length === 0) throw new Error("--score needs at least one directory of stored agent results");
  for (const dir of dirs) {
    const runs = readdirSync(dir).filter((f) => f.endsWith(".json")).flatMap((f) => {
      const value: unknown = JSON.parse(readFileSync(join(dir, f), "utf8"));
      return isAgentRunResponse(value) ? [{ file: f, origin: (value as { evidenceOrigin?: string }).evidenceOrigin ?? "unknown", model: value.model.id, metrics: runMetrics(value) }] : [];
    });
    console.log(`\n${dir}: ${runs.length} stored result(s)`);
    for (const r of runs) console.log(`  ${r.file} [${r.origin}, ${r.model}] ${r.metrics.status} ${r.metrics.qlooCalls}q ${r.metrics.emptyProbes} empty ${r.metrics.fullTerritories} FULL feasibility=${r.metrics.feasibility ?? "n/a"} cards=${r.metrics.cards.map((c) => c.implication).join(",")} violations=${r.metrics.cards.reduce((n, c) => n + c.violations.length, 0)} unsupported=${r.metrics.unsupportedClassifications}`);
    const sum = (k: "qlooCalls" | "emptyProbes" | "fullTerritories" | "unsupportedClassifications") => runs.reduce((n, r) => n + r.metrics[k], 0);
    console.log(`  totals: ${sum("qlooCalls")} Qloo calls, ${sum("emptyProbes")} empty probes, ${sum("fullTerritories")} FULL territories, ${sum("unsupportedClassifications")} unsupported classifications`);
  }
  process.exit(0);
}

const report = await runD2DEval();
console.log(formatD2D(report));
const jsonIndex = process.argv.indexOf("--json");
if (jsonIndex >= 0 && process.argv[jsonIndex + 1]) writeFileSync(process.argv[jsonIndex + 1] as string, `${JSON.stringify(report, null, 2)}\n`);
process.exit(report.passed ? 0 : 1);
