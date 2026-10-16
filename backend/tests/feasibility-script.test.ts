/**
 * Runs the real feasibility script with no credential. It uses the real pinned harness for the
 * readiness check, against an empty QLOO_HOME, and must report LIVE_QLOO_VALIDATION_NOT_RUN
 * without contacting Qloo or substituting mocked data.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const backendRoot = fileURLToPath(new URL("..", import.meta.url));
/** A placeholder, never a real key. Runs using it must stop at configuration validation. */
const PLACEHOLDER_KEY = "placeholder-not-a-real-key";

describe("qloo-feasibility script without a credential", () => {
  it("exits 3 with LIVE_QLOO_VALIDATION_NOT_RUN and lists what remains unverified", () => {
    const qlooHome = mkdtempSync(join(tmpdir(), "ce-qloo-home-"));
    const outputDir = join(backendRoot, "feasibility-output");
    const before = (() => {
      try {
        return readdirSync(outputDir).length;
      } catch {
        return 0;
      }
    })();
    try {
      const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/qloo-feasibility.ts"], {
        cwd: backendRoot,
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, QLOO_API_KEY: "", QLOO_HOME: qlooHome },
      });
      expect(result.status).toBe(3);
      expect(result.stdout).toContain("LIVE_QLOO_VALIDATION_NOT_RUN");
      expect(result.stdout).toContain("UNVERIFIED");
      expect(result.stdout).toContain("compare_audiences");
      expect(result.stdout).toContain("no graph-distance");
      // No packet may be written when nothing was validated.
      const after = (() => {
        try {
          return readdirSync(outputDir).length;
        } catch {
          return 0;
        }
      })();
      expect(after).toBe(before);
    } finally {
      rmSync(qlooHome, { recursive: true, force: true });
    }
  }, 90_000);

  it.each([
    ["production", "https://api.qloo.com", "QLOO_WRONG_ENVIRONMENT"],
    ["staging", "https://staging.api.qloo.com", "QLOO_WRONG_ENVIRONMENT"],
    ["unset", "", "QLOO_HACKATHON_BASE_URL_REQUIRED"],
  ])("with a key but a %s base URL, exits 4 (LIVE_QLOO_HOST_NOT_VERIFIED) before any Qloo call", (_label, baseUrl, code) => {
    const qlooHome = mkdtempSync(join(tmpdir(), "ce-qloo-home-"));
    try {
      const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/qloo-feasibility.ts"], {
        cwd: backendRoot,
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, QLOO_API_KEY: PLACEHOLDER_KEY, QLOO_API_BASE_URL: baseUrl, QLOO_HOME: qlooHome },
      });
      expect(result.status).toBe(4);
      expect(result.stdout).toContain("LIVE_QLOO_HOST_NOT_VERIFIED");
      expect(result.stdout).toContain(code);
      expect(result.stdout).toContain("Nothing was sent to Qloo");
      expect(result.stdout + result.stderr).not.toContain(PLACEHOLDER_KEY);
    } finally {
      rmSync(qlooHome, { recursive: true, force: true });
    }
  }, 90_000);
});
