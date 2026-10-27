/**
 * Sprint 9J: `pnpm eval:live` recognises the live baseline canary record as its own artifact type, without
 * rewriting it, and still fails any fixture type it does not know. Offline; reads committed fixtures only.
 */
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runLiveEval } from "../scripts/live-harness.js";
import { LIVE_FIXTURES_DIR } from "../scripts/live-fixture.js";

describe("live fixture classes", () => {
  it("passes every committed live fixture, canary records included", () => {
    const report = runLiveEval();
    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
    expect(report.checks.map((c) => c.id)).toEqual(expect.arrayContaining(["loewe-baseline-canary-1.live.json.replay", "loewe-baseline-canary-2.live.json.replay"]));
  });

  it("an unknown fixture type still fails the schema check instead of being skipped", () => {
    const dir = mkdtempSync(join(tmpdir(), "ce-live-eval-"));
    writeFileSync(join(dir, "SYNTHETIC-unknown.live.json"), JSON.stringify({ fixtureType: "something_else", notice: "SYNTHETIC" }));
    const report = runLiveEval(dir);
    expect(report.passed).toBe(false);
    expect(report.checks.find((c) => c.id === "SYNTHETIC-unknown.live.json.schema")?.passed).toBe(false);
  });

  it("a canary record that lost its LIVE notice or a correlation id is refused", () => {
    const dir = mkdtempSync(join(tmpdir(), "ce-live-eval-"));
    const original = JSON.parse(readFileSync(join(LIVE_FIXTURES_DIR, "loewe-baseline-canary-2.live.json"), "utf8"));
    const relabelled = { ...original, notice: "SYNTHETIC copy" };
    writeFileSync(join(dir, "a.live.json"), JSON.stringify(relabelled));
    const stripped = structuredClone(original);
    delete stripped.observations[0].payload.signals[0].sourceCorrelationId;
    writeFileSync(join(dir, "b.live.json"), JSON.stringify(stripped));
    copyFileSync(join(LIVE_FIXTURES_DIR, "loewe-baseline-canary-1.live.json"), join(dir, "c.live.json"));
    const report = runLiveEval(dir);
    const failed = report.checks.filter((c) => !c.passed).map((c) => c.id);
    expect(failed).toContain("a.live.json.schema");
    expect(failed.some((id) => id.startsWith("b.live.json."))).toBe(true);
    expect(failed.some((id) => id.startsWith("c.live.json."))).toBe(false);
  });
});
