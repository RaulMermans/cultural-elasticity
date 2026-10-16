/**
 * Sprint 0B live Qloo feasibility run (hackathon environment only).
 *
 *   pnpm feasibility:qloo                    (from the repo root)
 *   pnpm feasibility:qloo -- --write-fixture  also writes evals/fixtures/live/ (after secret checks)
 *
 * Exit codes:
 *   0  investigation completed (the decision may be GO, CONDITIONAL GO or NO-GO; all are findings)
 *   1  unrecoverable integration failure
 *   3  LIVE_QLOO_VALIDATION_NOT_RUN: no credential, so nothing was sent to Qloo
 *   4  LIVE_QLOO_HOST_NOT_VERIFIED: the hackathon host could not be proven, so nothing was sent to Qloo
 *
 * Order of safety checks: credential present → QLOO_API_BASE_URL is exactly the hackathon origin →
 * the harness itself (offline `qloo doctor`) reports that origin → only then any Qloo call.
 * This script never substitutes fixtures or mocks for live data.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnvFile } from "../src/config/env.js";
import { CONTRACT_LIMITATIONS } from "../src/feasibility/run.js";
import { LiveCollector, runLiveInvestigation, type LiveRunResult } from "../src/feasibility/live.js";
import { LIVE_INVESTIGATION } from "../src/feasibility/live-config.js";
import {
  harnessChildEnv,
  LIVE_QLOO_HOST_NOT_VERIFIED,
  LIVE_QLOO_HOST_VERIFIED,
  QlooEnvironmentError,
  requireHackathonBaseUrl,
  verifyHarnessHost,
} from "../src/qloo/environment.js";
import { QlooTransportError } from "../src/qloo/errors.js";
import { defaultHarnessBinPath, HarnessExecTransport, scrubSecrets } from "../src/qloo/transport.js";
import { QLOO_HARNESS_MIN_VERSION } from "../src/qloo/types.js";
import { buildLiveFixture, LIVE_FIXTURE_FILE } from "./live-fixture.js";

export const NOT_RUN = "LIVE_QLOO_VALIDATION_NOT_RUN";

/** What only a live run can establish. Printed whenever the run does not happen. */
export const UNVERIFIED_WITHOUT_LIVE: readonly string[] = [
  "Whether Jacquemus still resolves to the pinned Qloo brand entity.",
  "Whether the pinned Boutique Hospitality tag and exemplars still return tags and brand-conditioned places.",
  "Whether entity_tags still returns tags with numeric affinity for Jacquemus and the exemplars.",
  "The current output of compare_audiences (/v2/analysis/compare), audience_demographics and trends.",
  "Whether single-call rank still returns affinity for the candidate exemplars, and whether it is repeatable.",
  "Whether joint entity_tags and mutually related brands still yield bridge signals.",
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

function printResult(result: LiveRunResult): void {
  console.log("\nLive steps");
  for (const step of result.steps) console.log(`  [${step.outcome.toUpperCase().padEnd(11)}] ${step.id} (${step.operation}) ${step.correlationId ?? ""} — ${step.detail}`);
  console.log("\nRevised gates");
  for (const gate of result.gates) console.log(`  ${gate.status.padEnd(12)} ${gate.id} [${gate.tier}] ${gate.name} — ${gate.observed}`);
  const o = result.observations;
  if (o) {
    console.log("\nKey observations (Qloo values are within-call only)");
    console.log(`  brand-conditioned territory: ${o.brandConditionedTerritory.slice(0, 6).map((e) => e.label).join("; ")}`);
    console.log(`  related brands: ${o.relatedBrands.slice(0, 6).map((e) => e.label).join("; ")}`);
    console.log(`  ranking (primary): ${o.rankings[0]?.order.map((r) => r.label).join(" > ")}`);
    console.log(`  ranking (alternate exemplars): ${o.rankings[1]?.order.map((r) => r.label).join(" > ")}`);
  }
  if (result.ingredients) {
    const i = result.ingredients;
    console.log("\nAnalysisIngredients (no score)");
    console.log(`  overlap: shared=${i.overlap.sharedSignalCount} jaccard=${i.overlap.jaccard?.toFixed(3) ?? "n/a"} status=${i.overlap.status}`);
    console.log(`  stability: ${i.stability.points.map((p) => `N=${p.n}:${p.sharedCount}/${p.jaccard.toFixed(3)}`).join(" ")}`);
    console.log(`  audience: ${i.audience.status}; ranking: ${i.ranking.status}; bridges: ${i.bridges.status} (${i.bridges.signalCount ?? "n/a"} signals)`);
    console.log(`  evidence quality: ${i.evidenceQuality.overall.level} (${i.evidenceQuality.overall.drivers.join("; ")})`);
  }
  console.log(`\nDECISION: ${result.decision}${result.blockedReason ? ` (${result.blockedReason})` : ""}`);
}

async function main(): Promise<number> {
  loadLocalEnvFile();
  console.log("Cultural Elasticity — Sprint 0B live Qloo feasibility (hackathon environment)");

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
    console.log("\nTo run: add QLOO_API_KEY and QLOO_API_BASE_URL to backend/.env (gitignored), then re-run.");
    return 3;
  }

  // Host safety gate. Nothing below this point may run unless LIVE_QLOO_HOST_VERIFIED.
  let origin: string;
  try {
    origin = requireHackathonBaseUrl(process.env.QLOO_API_BASE_URL);
  } catch (error) {
    if (!(error instanceof QlooEnvironmentError)) throw error;
    console.log(`\n${LIVE_QLOO_HOST_NOT_VERIFIED}\n  ${error.message}\n  Nothing was sent to Qloo.`);
    return 4;
  }
  const childEnv = harnessChildEnv(process.env, origin);
  const gate = verifyHarnessHost(defaultHarnessBinPath(), childEnv, origin);
  if (gate.status !== LIVE_QLOO_HOST_VERIFIED) {
    console.log(`\n${LIVE_QLOO_HOST_NOT_VERIFIED}\n  ${gate.reason}\n  harness: ${gate.evidence}\n  Nothing was sent to Qloo.`);
    return 4;
  }
  console.log(`  ${LIVE_QLOO_HOST_VERIFIED}: harness upstream ${gate.effectiveOrigin} (trusted via ${gate.trustSource})`);

  const collector = new LiveCollector(new HarnessExecTransport({ env: childEnv, timeoutMs: 90_000 }), { spacingMs: LIVE_INVESTIGATION.callSpacingMs });
  let result: LiveRunResult;
  try {
    result = await runLiveInvestigation(collector, LIVE_INVESTIGATION, new Date());
  } catch (error) {
    if (error instanceof QlooTransportError) {
      console.error(`\nFAILED: integration failure — ${error.message}`);
      return 1;
    }
    throw error;
  }
  if (result.steps.some((s) => s.detail.startsWith("QLOO_AUTH"))) {
    console.error("\nFAILED: Qloo rejected the credential (QLOO_AUTH).");
    return 1;
  }

  printResult(result);

  const capturedAt = new Date().toISOString();
  const report = JSON.stringify({ capturedAt, apiEnvironment: origin, harnessVersion: readiness.harnessVersion, ...result }, null, 2);
  if (scrubSecrets(report) !== report) {
    console.error("\nABORTED: credential material appeared in the output. Nothing was written.");
    return 1;
  }
  const outDir = join(backendRoot, "feasibility-output");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `qloo-live-${capturedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(outPath, `${report}\n`, { mode: 0o600 });
  console.log(`\nSanitized report written to ${relative(process.cwd(), outPath)} (gitignored).`);

  if (process.argv.includes("--write-fixture") && result.packet && result.observations) {
    const fixture = JSON.stringify(buildLiveFixture({ capturedAt, apiEnvironment: origin, harnessVersion: readiness.harnessVersion, result }), null, 2);
    if (scrubSecrets(fixture) !== fixture) {
      console.error("ABORTED fixture: credential material detected.");
      return 1;
    }
    writeFileSync(LIVE_FIXTURE_FILE, `${fixture}\n`);
    console.log(`Live fixture written to ${relative(process.cwd(), LIVE_FIXTURE_FILE)}. Run pnpm check:secrets before committing.`);
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
