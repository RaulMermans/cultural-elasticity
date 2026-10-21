/**
 * AGENT_MODEL_READY gate and live-harness checks, exercised OFFLINE with synthetic runs. Nothing here is a
 * live model or live Qloo validation: the gate's inputs are synthetic responses relabelled as an arm.
 */
import type { AgentAnalysisResult } from "@cultural-elasticity/shared";
import { describe, expect, it } from "vitest";
import { acceptedUnsupportedClaims, checkLive, loadLiveCases, permissionViolations, readinessGate, type LiveRun } from "../scripts/agent-live-harness.js";
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

/** Synthetic runs relabelled as an arm and attributed to a model id (offline; not a live validation). */
function relabel(runs: LiveRun[], arm: LiveRun["arm"], modelId = "claude-haiku-5-5"): LiveRun[] {
  return runs.map((r) => ({ ...r, arm, response: { ...r.response, model: { id: modelId, kind: "llm" as const, live: true } } }));
}

const manifest = { version: "test-v1", caseIds: ["S-0", "S-1"], frontierCaseIds: ["S-1"] };
const measured = { "S-1": { runs: 3 } };

describe("AGENT_MODEL_READY gate (Sprint 5A: coverage-complete, single-model, case-matched)", () => {
  it("is NOT_READY when the live model never ran (no substitution by baseline or scripts)", () => {
    const gate = readinessGate({ manifest, modelRuns: null, baselineRuns: null });
    expect(gate.decision).toBe("AGENT_MODEL_NOT_READY");
    expect(gate.reasons[0]).toMatch(/^LIVE_AGENT_MODEL_VALIDATION_NOT_RUN/u);
    expect(gate.missingCaseIds).toEqual(["S-0", "S-1"]);
  });

  it("passes every hard (safety) requirement on a complete, single-model, case-matched evaluation with measured stability", async () => {
    const runs = await syntheticArm();
    const gate = readinessGate({ manifest, modelRuns: relabel(runs, "LIVE_MODEL"), baselineRuns: relabel(runs, "BASELINE", "baseline-policy-v2"), stability: measured });
    expect(gate.hard.filter((h) => !h.passed)).toEqual([]);
    expect(gate.safetyReadiness.passed).toBe(true);
    expect(gate).toMatchObject({ modelId: "claude-haiku-5-5", caseManifestVersion: "test-v1", executedCaseIds: ["S-0", "S-1"], missingCaseIds: [], frontierStabilityStatus: "MEASURED" });
    // Sprint 5A.1 (gate v3): safety alone is not readiness. Sprint 5A's gate said READY here; competence evidence
    // (controlled FULL scenario, frontier criteria) is absent, so the automated decision is NOT_READY.
    expect(gate.competenceReadiness.passed).toBe(false);
    expect(gate.decision).toBe("AGENT_MODEL_NOT_READY");
    expect(gate.overallDecision).toBe("AGENT_MODEL_NOT_READY");
  });

  it("an omitted case keeps the denominator: NOT_READY with INCOMPLETE_LIVE_EVALUATION", async () => {
    const runs = await syntheticArm();
    const gate = readinessGate({ manifest, modelRuns: relabel(runs.slice(0, 1), "LIVE_MODEL"), baselineRuns: relabel(runs, "BASELINE"), stability: measured });
    expect(gate.decision).toBe("AGENT_MODEL_NOT_READY");
    expect(gate.missingCaseIds).toEqual(["S-1"]);
    expect(gate.reasons.join(" ")).toMatch(/INCOMPLETE_LIVE_EVALUATION/u);
  });

  it("a case that threw counts as errored, never as passed or dropped", async () => {
    const runs = await syntheticArm();
    const gate = readinessGate({ manifest, modelRuns: relabel(runs.slice(0, 1), "LIVE_MODEL"), baselineRuns: relabel(runs, "BASELINE"), errors: [{ caseId: "S-1", arm: "LIVE_MODEL", error: "timeout" }], stability: measured });
    expect(gate.decision).toBe("AGENT_MODEL_NOT_READY");
    expect(gate.erroredCaseIds).toEqual(["S-1"]);
    expect(gate.modelCoverage!.executed).toBe(1);
    expect(gate.modelCoverage!.expected).toBe(2);
  });

  it("refuses a mixed-model or non-Haiku aggregate", async () => {
    const runs = await syntheticArm();
    const mixed = [...relabel(runs.slice(0, 1), "LIVE_MODEL"), ...relabel(runs.slice(1), "LIVE_MODEL", "claude-opus-5-5")];
    expect(readinessGate({ manifest, modelRuns: mixed, baselineRuns: relabel(runs, "BASELINE"), stability: measured }).hard.find((h) => h.name.startsWith("every model run"))!.passed).toBe(false);
    const opus = readinessGate({ manifest, modelRuns: relabel(runs, "LIVE_MODEL", "claude-opus-5-5"), baselineRuns: relabel(runs, "BASELINE"), stability: measured });
    expect(opus.decision).toBe("AGENT_MODEL_NOT_READY");
  });

  it("requires a full matching baseline and measured frontier stability", async () => {
    const runs = await syntheticArm();
    const partialBaseline = readinessGate({ manifest, modelRuns: relabel(runs, "LIVE_MODEL"), baselineRuns: relabel(runs.slice(0, 1), "BASELINE"), stability: measured });
    expect(partialBaseline.hard.find((h) => h.name === "case-matched baseline coverage")!.passed).toBe(false);
    const noStability = readinessGate({ manifest, modelRuns: relabel(runs, "LIVE_MODEL"), baselineRuns: relabel(runs, "BASELINE") });
    expect(noStability.frontierStabilityStatus).toBe("NOT_MEASURED");
    expect(noStability.decision).toBe("AGENT_MODEL_NOT_READY");
    const twoRuns = readinessGate({ manifest, modelRuns: relabel(runs, "LIVE_MODEL"), baselineRuns: relabel(runs, "BASELINE"), stability: { "S-1": { runs: 2 } } });
    expect(twoRuns.frontierStabilityStatus).toBe("INCOMPLETE");
  });

  it("detects material regressions versus the baseline", async () => {
    const runs = await syntheticArm();
    const baseline = relabel(runs, "BASELINE");
    const failing = relabel(runs, "LIVE_MODEL").map((r) => ({ ...r, failures: ["status FAILED, expected COMPLETE"] }));
    const gate = readinessGate({ manifest, modelRuns: failing, baselineRuns: baseline, stability: measured });
    expect(gate.decision).toBe("AGENT_MODEL_NOT_READY");
    expect(gate.reasons.join(" ")).toMatch(/material regression vs baseline: runs_passed/u);
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
