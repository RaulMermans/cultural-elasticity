/**
 * `pnpm perf:agent`: offline performance diagnostic over the synthetic agent world.
 * Never contacts Qloo or Haiku. Not a live readiness result.
 */
import { writeFileSync } from "node:fs";
import { AgentRuntime } from "../src/agent/runtime.js";
import { BaselinePolicyModel } from "../src/agent/model/baseline.js";
import { buildPerfReport, formatPerfReport } from "../src/ops/perf-report.js";
import { createScriptedToolProvider, syntheticWorldSchema } from "./synthetic/synthetic-world.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WORLD = fileURLToPath(new URL("../../evals/fixtures/synthetic/agent/world.json", import.meta.url));

const CASES = [
  { id: "move", request: { userQuery: "Could Northwind Atelier enter boutique hospitality?", brand: "Northwind Atelier", territories: ["Boutique Hospitality"] } },
  { id: "compare", request: { userQuery: "For Saffron & Salt compare tableware, skincare and slow travel", brand: "Saffron & Salt", territories: ["Tableware", "Skincare", "Slow Travel"] } },
  { id: "frontier", request: { userQuery: "Where else could Brindlewood Oat go?", brand: "Brindlewood Oat" } },
];

const provider = createScriptedToolProvider(syntheticWorldSchema.parse(JSON.parse(readFileSync(WORLD, "utf8"))));
const reports = [];
for (const c of CASES) {
  const runtime = new AgentRuntime({ model: new BaselinePolicyModel(), provider });
  const result = await runtime.run(c.request);
  const report = buildPerfReport(result);
  reports.push({ id: c.id, report, metrics: result.metrics });
  console.log(`\n=== ${c.id} ===`);
  console.log(formatPerfReport(report));
}

const jsonIndex = process.argv.indexOf("--json");
if (jsonIndex >= 0 && process.argv[jsonIndex + 1]) {
  writeFileSync(process.argv[jsonIndex + 1] as string, `${JSON.stringify({ notice: "OFFLINE synthetic perf:agent; LIVE_QLOO_VALIDATION_NOT_RUN; LIVE_AGENT_MODEL_VALIDATION_NOT_RUN", reports }, null, 2)}\n`);
}
