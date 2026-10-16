/**
 * `pnpm methodology:jacquemus`: Jacquemus × the six candidate territories through the methodology.
 *
 *   (default)          OFFLINE replay of the sanitized live fixture evals/benchmarks/cultural-elasticity-v0/evidence/jacquemus.live.json
 *   -- --live          refreshes the evidence from the Qloo hackathon API first (about 40 calls), then analyzes it
 *   -- --live --write-fixture   also overwrites the Jacquemus fixture
 *   -- --json          prints the full CulturalElasticityResult as JSON
 *
 * The offline replay is NOT a new live validation; it says so in its output.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { runElasticityCapture } from "../src/capture/elasticity-capture.js";
import { ELASTICITY_CAPTURE } from "../src/capture/elasticity-config.js";
import { analyzeElasticity } from "../src/methodology/elasticity.js";
import { scrubSecrets } from "../src/qloo/transport.js";
import { buildElasticityFixture, elasticityFixtureSchema, fixturePath } from "./elasticity-fixture.js";
import { formatResult } from "./elasticity-report.js";
import { openLiveSession } from "./live-gate.js";

async function main(): Promise<number> {
  let input: unknown;
  let provenanceNote: string;
  if (process.argv.includes("--live")) {
    const session = openLiveSession(ELASTICITY_CAPTURE.callSpacingMs);
    if ("exitCode" in session) return session.exitCode;
    const capture = await runElasticityCapture(session.collector, ELASTICITY_CAPTURE, ["jacquemus"]);
    const brand = capture.brands[0];
    if (!brand?.input) {
      console.error(`LIVE capture blocked: ${brand?.blockedReason ?? "no result"}`);
      return 1;
    }
    input = brand.input;
    const capturedAt = new Date().toISOString();
    provenanceNote = `LIVE capture ${capturedAt} (${session.collector.steps.length} calls)`;
    if (process.argv.includes("--write-fixture")) {
      const byId = new Map(session.collector.steps.map((s) => [s.id, s]));
      const steps = [...capture.sharedStepIds, ...brand.stepIds].flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
      const text = JSON.stringify(buildElasticityFixture({ brandKey: "jacquemus", capturedAt, apiEnvironment: session.origin, harnessVersion: session.harnessVersion, steps, input }), null, 1);
      if (scrubSecrets(text) !== text) return 1;
      writeFileSync(fixturePath("jacquemus"), `${text}\n`);
    }
  } else {
    const fixture = elasticityFixtureSchema.parse(JSON.parse(readFileSync(fixturePath("jacquemus"), "utf8")));
    input = fixture.input;
    provenanceNote = `OFFLINE replay of live evidence captured ${fixture.captureDate} from ${fixture.apiEnvironment} (not a new live validation)`;
  }

  const result = analyzeElasticity(input);
  if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(provenanceNote);
    console.log(formatResult(result));
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(scrubSecrets(error instanceof Error ? (error.stack ?? error.message) : String(error)));
    process.exit(1);
  },
);
