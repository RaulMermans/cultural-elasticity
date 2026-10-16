/** `pnpm eval:agent` must pass its acceptance thresholds (SYNTHETIC world; offline). */
import { describe, expect, it } from "vitest";
import { runAgentEval } from "../scripts/agent-eval-harness.js";

describe("agent evaluation set", () => {
  it("passes every scenario and acceptance threshold", async () => {
    const report = await runAgentEval();
    const failing = report.scenarios.filter((s) => !s.passed).map((s) => `${s.id}: ${s.failures.join("; ")}`);
    expect(failing).toEqual([]);
    expect(report.thresholds.filter((t) => !t.passed)).toEqual([]);
    expect(report.scenarios.length).toBeGreaterThanOrEqual(20);
    expect(new Set(report.scenarios.map((s) => s.category)).size).toBeGreaterThanOrEqual(12);
  }, 60_000);
});
