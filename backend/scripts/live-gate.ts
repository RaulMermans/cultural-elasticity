/**
 * Shared live-run gate for Sprint 2 scripts. Order: credential → configured hackathon origin → the
 * harness itself reports that origin (offline doctor) → only then a transport. Returns an exit code
 * instead of a transport whenever any step fails; nothing is sent to Qloo in that case.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadLocalEnvFile } from "../src/config/env.js";
import { LiveCollector } from "../src/feasibility/live.js";
import { harnessChildEnv, LIVE_QLOO_HOST_NOT_VERIFIED, LIVE_QLOO_HOST_VERIFIED, QlooEnvironmentError, requireHackathonBaseUrl, verifyHarnessHost } from "../src/qloo/environment.js";
import { defaultHarnessBinPath, HarnessExecTransport } from "../src/qloo/transport.js";

export const NOT_RUN = "LIVE_QLOO_VALIDATION_NOT_RUN";

export type LiveSession = { collector: LiveCollector; origin: string; harnessVersion: string };

export function openLiveSession(spacingMs: number): LiveSession | { exitCode: 3 | 4 } {
  loadLocalEnvFile();
  if (!process.env.QLOO_API_KEY?.trim()) {
    console.log(`\n${NOT_RUN}\nNo QLOO_API_KEY. Nothing was sent to Qloo and no fixture was substituted.`);
    return { exitCode: 3 };
  }
  let origin: string;
  try {
    origin = requireHackathonBaseUrl(process.env.QLOO_API_BASE_URL);
  } catch (error) {
    if (!(error instanceof QlooEnvironmentError)) throw error;
    console.log(`\n${LIVE_QLOO_HOST_NOT_VERIFIED}\n  ${error.message}\n  Nothing was sent to Qloo.`);
    return { exitCode: 4 };
  }
  const childEnv = harnessChildEnv(process.env, origin);
  const binPath = defaultHarnessBinPath();
  const gate = verifyHarnessHost(binPath, childEnv, origin);
  if (gate.status !== LIVE_QLOO_HOST_VERIFIED) {
    console.log(`\n${LIVE_QLOO_HOST_NOT_VERIFIED}\n  ${gate.reason}\n  Nothing was sent to Qloo.`);
    return { exitCode: 4 };
  }
  console.log(`  ${LIVE_QLOO_HOST_VERIFIED}: harness upstream ${gate.effectiveOrigin}`);
  const harnessVersion = (JSON.parse(readFileSync(join(dirname(binPath), "..", "package.json"), "utf8")) as { version: string }).version;
  const collector = new LiveCollector(new HarnessExecTransport({ env: childEnv, timeoutMs: 90_000 }), { spacingMs });
  return { collector, origin, harnessVersion };
}
