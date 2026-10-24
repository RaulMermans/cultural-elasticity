/**
 * Sprint 8E: live readiness-gate budget preflight. Pure arithmetic over the frozen manifest; no provider call.
 */
import { describe, expect, it } from "vitest";
import { computeGateExposure, loadGateManifest, SuiteSpendGuard, validateGateBudget } from "../scripts/live-gate-budget.js";
import { decisionCeilingUsd, estimateCallCeilingUsd } from "../src/ops/pricing.js";

const manifest = () => loadGateManifest();

describe("Sprint 8E live gate budget preflight", () => {
  it("plans exactly the frozen runs: 7 prescribed + controlled + extra stability repeats", () => {
    const e = computeGateExposure(manifest());
    expect(e.plan.baselineRuns).toBe(8);
    expect(e.plan.modelRuns).toBe(12);
    expect(e.plan.modelRunCases.filter((c) => c === "L-E1")).toHaveLength(3);
    expect(e.plan.modelRunCases.filter((c) => c === "L-E2")).toHaveLength(3);
  });

  it("prices every model call at the conservative ceiling, including repairs and synthesis attempts", () => {
    const e = computeGateExposure(manifest());
    expect(e.perCall.ceilingUsd).toBe(estimateCallCeilingUsd(100_000, 16_000));
    expect(e.perRun.maxModelCalls).toBe(12 * 2 + 2);
    expect(e.RESERVED_BUDGET_USD).toBeCloseTo(e.perRun.ceilingUsd * 12, 6);
    expect(e.MAX_THEORETICAL_EXPOSURE_USD).toBeCloseTo(e.RESERVED_BUDGET_USD * 3, 6);
    expect(e.EXPECTED_COST_USD).toBeLessThan(e.RESERVED_BUDGET_USD);
    expect(e.maxOutputTokens).toBe(312 * 16_000);
  });

  it("refuses the Sprint 8D $2.50 reserve: it cannot cover the conservative exposure", () => {
    const v = validateGateBudget(computeGateExposure(manifest()), 2.5);
    expect(v).toMatchObject({ allowed: false, code: "CEILING_BELOW_RESERVED_EXPOSURE" });
  });

  it("blocks without an owner-approved ceiling", () => {
    expect(validateGateBudget(computeGateExposure(manifest()), null).code).toBe("LIVE_GATE_BLOCKED_BY_APPROVAL");
    expect(validateGateBudget(computeGateExposure(manifest()), 0).code).toBe("LIVE_GATE_BLOCKED_BY_APPROVAL");
  });

  it("passes a ceiling that covers the reserved exposure, with unverified provider limits flagged", () => {
    const e = computeGateExposure(manifest());
    const v = validateGateBudget(e, e.RESERVED_BUDGET_USD);
    expect(v.allowed).toBe(true);
    expect(v.warnings.join(" ")).toMatch(/PROVIDER_WORKSPACE_LIMIT_UNVERIFIED/u);
    expect(v.warnings.join(" ")).toMatch(/QLOO_QUOTA_UNVERIFIED/u);
  });

  it("refuses when the Anthropic workspace limit would stop the suite mid-gate, or the Qloo quota is too small", () => {
    const m = manifest();
    m.approval.providerWorkspaceLimitUsd = 5;
    const e = computeGateExposure(m);
    expect(validateGateBudget(e, 40).code).toBe("WORKSPACE_LIMIT_BELOW_CEILING");
    const q = manifest();
    q.approval.qlooQuotaCalls = 100;
    expect(validateGateBudget(computeGateExposure(q), 40).code).toBe("QLOO_QUOTA_EXCEEDED");
  });

  it("never treats Qloo as zero-cost: it reports a call count with no published USD rate", () => {
    const e = computeGateExposure(manifest());
    expect(e.qloo.maxCalls).toBeGreaterThan(0);
    expect(e.qloo.usdRate).toBe("NOT_PUBLISHED");
  });
});

describe("Sprint 8E suite spend guard", () => {
  it("issues a per-run bound that never refuses a call the run's own limits allow", () => {
    const e = computeGateExposure(manifest());
    const guard = new SuiteSpendGuard(e.RESERVED_BUDGET_USD, e.perRun.ceilingUsd);
    const bound = guard.nextRun()!;
    for (let i = 0; i < e.perRun.maxModelCalls; i += 1) {
      expect(bound.authorizeNextCall(e.perCall.ceilingUsd)).toBe(true);
      bound.markUnknownCall(e.perCall.ceilingUsd);
    }
    expect(bound.authorizeNextCall(decisionCeilingUsd())).toBe(false);
  });

  it("stops starting runs before the approved ceiling could be exceeded", () => {
    const guard = new SuiteSpendGuard(5, 2);
    const a = guard.nextRun()!;
    a.addObserved(1.5);
    const b = guard.nextRun()!;
    b.addObserved(1.6);
    expect(guard.spent()).toBeCloseTo(3.1, 6);
    expect(guard.nextRun()).toBeNull();
  });

  it("charges an errored run its full ceiling (unknown spend fails closed)", () => {
    const guard = new SuiteSpendGuard(10, 2);
    const a = guard.nextRun()!;
    a.addObserved(0.25);
    guard.chargeErroredRun(a);
    expect(guard.spent()).toBeCloseTo(2, 6);
  });
});
