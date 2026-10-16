/**
 * Sprint 2 live capture for the Cultural Elasticity benchmark (hackathon environment only).
 *
 *   pnpm capture:elasticity                                  all benchmark brands, report only
 *   pnpm capture:elasticity -- --brands jacquemus            one brand
 *   pnpm capture:elasticity -- --write-fixtures              also writes evals/benchmarks/cultural-elasticity-v0/evidence/
 *
 * Exit codes: 0 completed · 1 integration failure · 3 LIVE_QLOO_VALIDATION_NOT_RUN (no credential) ·
 * 4 LIVE_QLOO_HOST_NOT_VERIFIED. Same safety order as feasibility:qloo (see live-gate.ts).
 * Never substitutes fixtures for live data.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { runElasticityCapture } from "../src/capture/elasticity-capture.js";
import { ELASTICITY_CAPTURE } from "../src/capture/elasticity-config.js";
import { parseMethodologyInput } from "../src/methodology/contracts.js";
import { scrubSecrets } from "../src/qloo/transport.js";
import { buildElasticityFixture, EVIDENCE_DIR, fixturePath } from "./elasticity-fixture.js";
import { openLiveSession } from "./live-gate.js";

const backendRoot = fileURLToPath(new URL("..", import.meta.url));

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<number> {
  console.log("Cultural Elasticity — Sprint 2 live benchmark capture (hackathon environment)");
  const session = openLiveSession(ELASTICITY_CAPTURE.callSpacingMs);
  if ("exitCode" in session) return session.exitCode;
  const { collector, origin, harnessVersion } = session;

  const brandKeys = argValue("--brands")?.split(",").map((key) => key.trim());
  const result = await runElasticityCapture(collector, ELASTICITY_CAPTURE, brandKeys);

  console.log("\nLive steps");
  for (const step of collector.steps) console.log(`  [${step.outcome.toUpperCase().padEnd(11)}] ${step.id} (${step.operation}) ${step.correlationId ?? ""} — ${step.detail}`);
  for (const brand of result.brands) console.log(`  ${brand.brandKey}: ${brand.input ? "captured" : `BLOCKED (${brand.blockedReason})`}`);
  if (collector.steps.some((step) => step.detail.startsWith("QLOO_AUTH"))) {
    console.error("\nFAILED: Qloo rejected the credential (QLOO_AUTH).");
    return 1;
  }

  const capturedAt = new Date().toISOString();
  const report = JSON.stringify({ capturedAt, apiEnvironment: origin, harnessVersion, steps: collector.steps, result }, null, 2);
  if (scrubSecrets(report) !== report) {
    console.error("\nABORTED: credential material appeared in the output. Nothing was written.");
    return 1;
  }
  const outDir = join(backendRoot, "feasibility-output");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `elasticity-capture-${capturedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(outPath, `${report}\n`, { mode: 0o600 });
  console.log(`\nFull report written to ${relative(process.cwd(), outPath)} (gitignored).`);

  if (process.argv.includes("--write-fixtures")) {
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    const stepById = new Map(collector.steps.map((step) => [step.id, step]));
    for (const brand of result.brands) {
      if (!brand.input) continue;
      const parsed = parseMethodologyInput(brand.input);
      if (!parsed.ok) {
        console.error(`  ${brand.brandKey}: NOT written, input failed validation: ${parsed.issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join("; ")}`);
        continue;
      }
      const steps = [...result.sharedStepIds, ...brand.stepIds].flatMap((id) => (stepById.has(id) ? [stepById.get(id)!] : []));
      const text = JSON.stringify(buildElasticityFixture({ brandKey: brand.brandKey, capturedAt, apiEnvironment: origin, harnessVersion, steps, input: brand.input }), null, 1);
      if (scrubSecrets(text) !== text) {
        console.error(`  ${brand.brandKey}: ABORTED, credential material detected.`);
        return 1;
      }
      writeFileSync(fixturePath(brand.brandKey), `${text}\n`);
      console.log(`  fixture written: ${relative(process.cwd(), fixturePath(brand.brandKey))}`);
    }
    console.log("Run pnpm check:secrets and pnpm eval:elasticity before committing.");
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
