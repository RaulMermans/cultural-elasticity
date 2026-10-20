/**
 * AGENT_MODEL_READY gate and live-harness checks, exercised OFFLINE with synthetic runs. Nothing here is a
 * live model or live Qloo validation: the gate's inputs are synthetic responses relabelled as an arm.
 */
import type { AgentAnalysisResult } from "@cultural-elasticity/shared";
import { describe, expect, it } from "vitest";
import { acceptedUnsupportedClaims, armMetrics, checkLive, loadLiveCases, permissionViolations, readinessGate, type LiveRun } from "../scripts/agent-live-harness.js";
import { runtime } from "./fixtures/synthetic/agent.js";

async function syntheticArm(): Promise<LiveRun[]> {
  const out: LiveRun[] = [];
  for (const [i, req] of [
    { userQuery: "q", brand: "Velvet Tide", territories: ["Cafe Culture"] },
    { userQuery: "q", brand: "Kestrel Outfitters", territories: [] },
  ].entries()) {
    const response = await runtime().runtime.run(req);
    out.push({ id: `S-${i}`, caseId: `S-${i}`, arm: "LIVE_MODEL", response, failures: [], contexts: [], askedUser: false, continued: false });
  }
  return out;
}

describe("AGENT_MODEL_READY gate", () => {
  it("is NOT_READY when the live model never ran (no substitution by baseline or scripts)", () => {
    const gate = readinessGate(null, null, null);
    expect(gate.decision).toBe("AGENT_MODEL_NOT_READY");
    expect(gate.reasons[0]).toMatch(/^LIVE_AGENT_MODEL_VALIDATION_NOT_RUN/u);
  });

  it("passes every hard requirement on clean runs and detects material regressions versus the baseline", async () => {
    const runs = await syntheticArm();
    const metrics = armMetrics(runs);
    const clean = readinessGate(runs, metrics, metrics);
    expect(clean.hard.every((h) => h.passed)).toBe(true);
    expect(clean.decision).toBe("AGENT_MODEL_READY");
    const better = { ...metrics, representationSuccess: 1, fullAnalysisRate: 1, runs_passed: (metrics.runs_passed as number) + 3 };
    const worse = readinessGate(runs, better, metrics);
    expect(worse.decision).toBe("AGENT_MODEL_NOT_READY");
    expect(worse.reasons.join(" ")).toMatch(/material regression vs baseline: runs_passed/u);
  });

  it("counts accepted unsupported claims and permission violations from the result itself", async () => {
    const [run] = await syntheticArm();
    expect(permissionViolations(run!.response)).toBe(0);
    expect(acceptedUnsupportedClaims(run!.response)).toBe(0);
    const tampered = structuredClone(run!.response) as AgentAnalysisResult;
    tampered.summary.text += " Revenue will grow by 40%.";
    expect(acceptedUnsupportedClaims(tampered)).toBeGreaterThan(0);
    const call = tampered.trace.toolCalls.find((c) => c.tool === "qloo_find_tags")!;
    call.skill = null;
    expect(permissionViolations(tampered)).toBe(1);
  });
});

describe("live case set", () => {
  it("covers the required mix (≥ 3 moves, 2 comparisons, 2 frontiers, ambiguity, degradation) and holds no evidence or labels", () => {
    const cases = loadLiveCases();
    const count = (intent: string) => cases.filter((c) => c.intent === intent).length;
    expect(count("analyze_move")).toBeGreaterThanOrEqual(3);
    expect(count("compare_territories")).toBeGreaterThanOrEqual(2);
    expect(count("explore_frontier")).toBeGreaterThanOrEqual(2);
    const tags = cases.flatMap((c) => c.tags);
    for (const t of ["ambiguity", "cannot_reach_full", "degrade_gracefully"]) expect(tags).toContain(t);
    expect(new Set(cases.filter((c) => c.tags.includes("unseen_brand")).map((c) => c.request.brand)).size).toBeGreaterThanOrEqual(2);
    expect(cases.filter((c) => c.tags.includes("unseen_territory")).flatMap((c) => c.request.territories ?? []).length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(cases)).not.toMatch(/expected_(strong|mid|weak)|urn:|correlation/u);
  });

  it("checks structural expectations only after the run", async () => {
    const [run] = await syntheticArm();
    expect(checkLive({ id: "x", intent: "analyze_move", tags: [], request: { userQuery: "q" }, expect: { needsInput: true } }, run!.response, false)).toEqual(["expected the run to ask the user (ambiguity), but it did not"]);
  });
});
