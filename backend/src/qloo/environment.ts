/**
 * Qloo API environment selection and the live host-safety gate.
 *
 * Hackathon credentials are valid ONLY against https://hackathon.api.qloo.com and do not work against
 * production (api.qloo.com) or staging (staging.api.qloo.com). Source: Qloo LLM Hackathon developer
 * guide, https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide.
 *
 * [harness 0.1.26] The harness client chooses its upstream as:
 *   QLOO_BASE_URL (env) → `base_url` in $QLOO_HOME/config → https://api.qloo.com (production default).
 * A non-production URL is refused unless QLOO_TRUSTED_BASE_URL (env) or `trusted_base_url` (config)
 * names the exact same endpoint. So an unset QLOO_BASE_URL would silently send the key to production.
 *
 * This module makes that impossible for our runs:
 *   1. QLOO_API_BASE_URL (backend config) must be exactly the hackathon origin; there is no default.
 *   2. The harness child receives an explicit environment: QLOO_BASE_URL and QLOO_TRUSTED_BASE_URL set
 *      to that origin, an isolated QLOO_HOME (so no stored config can interfere), the native resolver.
 *   3. Before any credentialed call, the harness itself is asked, offline (`qloo doctor` without
 *      --network sends nothing), which endpoint it will use. Only an exact match yields
 *      LIVE_QLOO_HOST_VERIFIED.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const QLOO_HACKATHON_ORIGIN = "https://hackathon.api.qloo.com";
export const QLOO_HACKATHON_HOST = "hackathon.api.qloo.com";
/** Hosts a hackathon credential must never be sent to. */
export const QLOO_FORBIDDEN_HOSTS: readonly string[] = ["api.qloo.com", "staging.api.qloo.com"];

export const LIVE_QLOO_HOST_VERIFIED = "LIVE_QLOO_HOST_VERIFIED";
export const LIVE_QLOO_HOST_NOT_VERIFIED = "LIVE_QLOO_HOST_NOT_VERIFIED";

export type QlooEnvironmentErrorCode =
  | "QLOO_HACKATHON_BASE_URL_REQUIRED"
  | "QLOO_BASE_URL_INVALID"
  | "QLOO_WRONG_ENVIRONMENT";

export class QlooEnvironmentError extends Error {
  constructor(
    public readonly code: QlooEnvironmentErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "QlooEnvironmentError";
  }
}

/**
 * Validates QLOO_API_BASE_URL for a live hackathon run and returns the canonical origin.
 * Fails closed: missing, malformed, production, staging or any other host is an error. Never defaults.
 */
export function requireHackathonBaseUrl(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw) {
    throw new QlooEnvironmentError(
      "QLOO_HACKATHON_BASE_URL_REQUIRED",
      `QLOO_API_BASE_URL is not set. Set QLOO_API_BASE_URL=${QLOO_HACKATHON_ORIGIN} in backend/.env. There is no default, so a hackathon key can never reach production.`,
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new QlooEnvironmentError("QLOO_BASE_URL_INVALID", "QLOO_API_BASE_URL is not a valid URL.");
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new QlooEnvironmentError("QLOO_BASE_URL_INVALID", "QLOO_API_BASE_URL must be a bare origin (no credentials, path, query or fragment).");
  }
  const host = url.hostname.toLowerCase();
  if (QLOO_FORBIDDEN_HOSTS.includes(host)) {
    throw new QlooEnvironmentError(
      "QLOO_WRONG_ENVIRONMENT",
      `${host} is not the hackathon environment. Hackathon keys must only be sent to ${QLOO_HACKATHON_HOST}.`,
    );
  }
  if (url.protocol !== "https:" || host !== QLOO_HACKATHON_HOST || (url.port !== "" && url.port !== "443")) {
    throw new QlooEnvironmentError("QLOO_WRONG_ENVIRONMENT", `Live hackathon runs only target ${QLOO_HACKATHON_ORIGIN}.`);
  }
  return QLOO_HACKATHON_ORIGIN;
}

/** Environment variables that could route the harness, or a resolver it calls, somewhere else. */
const ROUTING_VARIABLES = [
  "QLOO_BASE_URL",
  "QLOO_TRUSTED_BASE_URL",
  "QLOO_HOME",
  "QLOO_RESOLUTION_PROVIDER",
  "TASTE_RESOLVER_URL",
  "TASTE_RESOLVER_API_KEY",
  "QLOO_TRUSTED_TASTE_RESOLVER_URL",
];

/**
 * Child-process environment for the harness pinned to `origin`. Inherited routing variables are
 * replaced, never merged. `qlooHome` defaults to a fresh empty temp directory.
 */
export function harnessChildEnv(baseEnv: NodeJS.ProcessEnv, origin: string, qlooHome?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  for (const name of ROUTING_VARIABLES) delete env[name];
  // Least privilege: the Qloo harness never needs model-provider credentials.
  for (const name of Object.keys(env)) if (name.startsWith("ANTHROPIC_")) delete env[name];
  env.QLOO_BASE_URL = origin;
  env.QLOO_TRUSTED_BASE_URL = origin;
  env.QLOO_HOME = qlooHome ?? mkdtempSync(join(tmpdir(), "ce-qloo-home-"));
  env.QLOO_RESOLUTION_PROVIDER = "native";
  return env;
}

export type HostGateResult =
  | { status: typeof LIVE_QLOO_HOST_VERIFIED; effectiveOrigin: string; trustSource: string; evidence: string }
  | { status: typeof LIVE_QLOO_HOST_NOT_VERIFIED; reason: string; evidence: string };

// [harness 0.1.26] doctor.js "qloo-endpoint-trust" check message.
const TRUSTED_ENDPOINT_LINE = /qloo-endpoint-trust\s+—\s+Qloo API endpoint is (?:official|explicitly trusted via (\S+)):\s+(\S+)/u;

/** Pure interpretation of offline `qloo doctor` output. Exported for tests. */
export function interpretDoctorOutput(output: string, expectedOrigin: string): HostGateResult {
  const line = output.split("\n").find((l) => l.includes("qloo-endpoint-trust")) ?? "";
  const match = TRUSTED_ENDPOINT_LINE.exec(line);
  if (!match) return { status: LIVE_QLOO_HOST_NOT_VERIFIED, reason: "The harness did not report a trusted endpoint.", evidence: line.trim() };
  const reported = match[2] ?? "";
  let origin: string;
  try {
    const url = new URL(reported);
    if (url.pathname !== "/") throw new Error("path");
    origin = url.origin;
  } catch {
    return { status: LIVE_QLOO_HOST_NOT_VERIFIED, reason: `Unparseable endpoint ${reported}.`, evidence: line.trim() };
  }
  if (origin !== expectedOrigin) {
    return { status: LIVE_QLOO_HOST_NOT_VERIFIED, reason: `Harness would call ${origin}, not ${expectedOrigin}.`, evidence: line.trim() };
  }
  return { status: LIVE_QLOO_HOST_VERIFIED, effectiveOrigin: origin, trustSource: match[1] ?? "official", evidence: line.trim() };
}

/**
 * Asks the harness, offline, which upstream it will use with `childEnv`. The credential is removed
 * from the doctor process: this check needs no key and sends nothing over the network.
 */
export function verifyHarnessHost(binPath: string, childEnv: NodeJS.ProcessEnv, expectedOrigin: string): HostGateResult {
  const env = { ...childEnv };
  delete env.QLOO_API_KEY;
  const run = spawnSync(process.execPath, [binPath, "doctor"], { env, encoding: "utf8", timeout: 30_000 });
  return interpretDoctorOutput(`${run.stdout ?? ""}\n${run.stderr ?? ""}`, expectedOrigin);
}
