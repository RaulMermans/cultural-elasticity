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
});
