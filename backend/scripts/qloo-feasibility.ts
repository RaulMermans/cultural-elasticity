/**
 * Sprint 0 live Qloo feasibility run.
 *
 *   pnpm feasibility:qloo            (from the repo root)
 *   pnpm --filter backend feasibility:qloo
 *
 * Exit codes:
 *   0  investigation completed (gates may pass or fail; both are findings)
 *   1  unrecoverable integration failure, or blocked on the brand resolution
 *   3  LIVE_QLOO_VALIDATION_NOT_RUN: no credential, so nothing was sent to Qloo
 *
 * This script never substitutes fixtures or mocks for live data.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnvFile } from "../src/config/env.js";
import { DEFAULT_INVESTIGATION } from "../src/feasibility/config.js";
import { CONTRACT_LIMITATIONS, runFeasibility, type FeasibilityRunResult } from "../src/feasibility/run.js";
import { HarnessQlooClient } from "../src/qloo/client.js";
import { QlooNotConfiguredError, QlooTransportError } from "../src/qloo/errors.js";
import { defaultHarnessBinPath, HarnessExecTransport, scrubSecrets } from "../src/qloo/transport.js";
import { QLOO_HARNESS_MIN_VERSION } from "../src/qloo/types.js";

export const NOT_RUN = "LIVE_QLOO_VALIDATION_NOT_RUN";

/** What only a live run can establish. Printed whenever the run does not happen. */
export const UNVERIFIED_WITHOUT_LIVE: readonly string[] = [
  "Whether Jacquemus resolves to a single Qloo brand entity, and its ID, type and metadata.",
  "Which Qloo tags exist for Boutique Hospitality, Boutique Hotel, Luxury Hospitality, Hospitality and Hotels, and whether any is scoped to places.",
  "Whether recommend returns hospitality place entities for that tag (exemplars).",
  "Whether entity_tags returns tags with numeric affinity for Jacquemus and for the exemplars.",
  "The actual output schema of compare_audiences (/v2/analysis/compare), and whether it contains quantitative fields.",
  "The output shapes of audience_demographics and trends.",
  "Whether the six ranking exemplars resolve unambiguously as brands, and whether rank returns affinity for each.",
  "Whether joint entity_tags for Jacquemus plus exemplars yields meaningful shared or intermediate tags.",
  "Real values, ranges and stability of affinity and popularity.",
];

const backendRoot = fileURLToPath(new URL("..", import.meta.url));

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

type Readiness = { harnessVersion: string; credentialSource: "env" | "harness-config" | "missing"; problems: string[] };

function checkReadiness(): Readiness {
  const problems: string[] = [];
  if (compareVersions(process.versions.node, "22.19.0") < 0) problems.push(`Node ${process.versions.node} is below the required 22.19.0.`);

  const binPath = defaultHarnessBinPath();
  const harnessVersion = (JSON.parse(readFileSync(join(dirname(binPath), "..", "package.json"), "utf8")) as { version: string }).version;
  if (compareVersions(harnessVersion, QLOO_HARNESS_MIN_VERSION) < 0) {
    problems.push(`@qloo/qloo-harness ${harnessVersion} is below the required ${QLOO_HARNESS_MIN_VERSION}.`);
  }

  if (process.env.QLOO_API_KEY?.trim()) return { harnessVersion, credentialSource: "env", problems };

  // The harness can also hold a credential saved by `qloo setup`. Ask it; it never prints the key.
  const status = spawnSync(process.execPath, [binPath, "setup", "--status", "--json"], { encoding: "utf8", timeout: 30_000 });
  try {
    const parsed = JSON.parse(status.stdout) as { qloo?: { ready?: boolean } };
    if (parsed.qloo?.ready) return { harnessVersion, credentialSource: "harness-config", problems };
  } catch {
    problems.push("Could not read `qloo setup --status --json` output.");
  }
  return { harnessVersion, credentialSource: "missing", problems };
}

function printResult(result: FeasibilityRunResult): void {
  console.log("\nSteps");
  for (const step of result.steps) {
    const flags = [step.degraded ? "DEGRADED" : "", step.partial ? "PARTIAL" : ""].filter(Boolean).join(",");
    console.log(`  [${step.outcome.toUpperCase().padEnd(11)}] ${step.id}${flags ? ` (${flags})` : ""}\n      ${step.title}\n      ${step.detail}`);
  }
  console.log("\nFeasibility gates (evidence availability, not scores)");
  for (const gate of result.gates) {
    const mark = gate.passed === null ? "N/A " : gate.passed ? "PASS" : "FAIL";
    console.log(`  ${mark} ${gate.id} ${gate.description} — ${gate.observed}`);
  }
}

async function main(): Promise<number> {
  loadLocalEnvFile();
  console.log("Cultural Elasticity — Sprint 0 Qloo feasibility");

  const readiness = checkReadiness();
  console.log(`  node ${process.versions.node}, @qloo/qloo-harness ${readiness.harnessVersion}, credential: ${readiness.credentialSource}`);
  if (readiness.problems.length > 0) {
    for (const problem of readiness.problems) console.error(`  ✗ ${problem}`);
    return 1;
  }

  if (readiness.credentialSource === "missing") {
    console.log(`\n${NOT_RUN}`);
    console.log("No Qloo credential found (QLOO_API_KEY unset and no harness-stored key). Nothing was sent to Qloo,");
    console.log("and no mock or fixture data was substituted. The following remains UNVERIFIED:");
    for (const item of UNVERIFIED_WITHOUT_LIVE) console.log(`  - ${item}`);
    console.log("\nEstablished without live access (from the harness contract):");
    for (const item of CONTRACT_LIMITATIONS) console.log(`  - ${item}`);
    console.log("\nTo run: add QLOO_API_KEY to backend/.env (gitignored) or run `qloo setup`, then re-run.");
    return 3;
  }

  const client = new HarnessQlooClient(new HarnessExecTransport());
  let result: FeasibilityRunResult;
  try {
    result = await runFeasibility(client, DEFAULT_INVESTIGATION, { evidenceSource: "live", harnessVersion: readiness.harnessVersion });
  } catch (error) {
    if (error instanceof QlooNotConfiguredError) {
      console.error("\nFAILED: Qloo rejected the credential (QLOO_AUTH). Check the key with `qloo doctor --network`.");
      return 1;
    }
    if (error instanceof QlooTransportError) {
      console.error(`\nFAILED: integration failure — ${error.message}`);
      return 1;
    }
    throw error;
  }

  printResult(result);

  const serialized = JSON.stringify(
    { runStatus: result.status, recordedAt: new Date().toISOString(), steps: result.steps, gates: result.gates, packet: result.packet },
    null,
    2,
  );
  if (scrubSecrets(serialized) !== serialized) {
    console.error("\nABORTED: the credential appeared in the output. Nothing was written.");
    return 1;
  }
  const outDir = join(backendRoot, "feasibility-output");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `qloo-feasibility-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(outPath, `${serialized}\n`, { mode: 0o600 });
  console.log(`\nSanitized report written to ${relative(process.cwd(), outPath)} (gitignored).`);
  console.log("Review it, then copy the packet to evals/fixtures/live/ if it should become a recorded fixture.");

  return result.status === "COMPLETED" ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(scrubSecrets(error instanceof Error ? (error.stack ?? error.message) : String(error)));
    process.exit(1);
  },
);
