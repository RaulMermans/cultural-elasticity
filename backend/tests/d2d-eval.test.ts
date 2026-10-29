/**
 * Sprint 9N: `pnpm eval:d2d` passes (synthetic world in two arms + recorded live artefacts as run; no provider call).
 */
import { describe, expect, it } from "vitest";
import { runD2DEval } from "../scripts/d2d/harness.js";

describe("Discovery-to-Decision evaluation", () => {
  it("passes every case and quality target, with honest live/model status", async () => {
    const report = await runD2DEval();
    const failing = report.cases.filter((c) => c.status === "FAIL").map((c) => `${c.id}: ${[...c.failures, ...c.regression].join("; ")}`);
    expect(failing).toEqual([]);
    expect(report.targets.filter((t) => !t.pass)).toEqual([]);
    expect(report.liveStatus).toBe("LIVE_QLOO_VALIDATION_NOT_RUN");
    expect(report.cases.filter((c) => c.kind === "live-target").every((c) => c.status === "NOT_RUN")).toBe(true);
    expect(report.cases.length).toBeGreaterThanOrEqual(20);
  }, 120_000);
});
