import { describe, expect, it } from "vitest";
import { ASSIGNMENTS, selectAssignments, worstCase } from "../scripts/durable/live-acceptance.js";

// Sprint 10D: the live harness's worst case must describe the runs that will actually be dispatched.
describe("durable live acceptance plan", () => {
  it("computes the worst case of the selected assignments only", () => {
    const all = worstCase(ASSIGNMENTS);
    const l4 = worstCase(selectAssignments(["L4"]));
    expect(all.runs).toBe(4);
    expect(l4.runs).toBe(1);
    expect(l4.qloo).toBeLessThan(all.qloo);
    expect(worstCase(selectAssignments(["L1", "L2"])).qlooWithAuthorizedRedispatch).toBe(worstCase(selectAssignments(["L1", "L2"])).qloo);
  });

  it("needs one open reservation plus one per interrupted run, not one per run", () => {
    const all = worstCase(ASSIGNMENTS);
    expect(all.modelMinimumApprovalUsd).toBeCloseTo(all.modelReservePerRunUsd * 2, 5);
    expect(all.modelReservedIfNoneSettlesUsd).toBeGreaterThan(all.modelMinimumApprovalUsd);
    expect(worstCase(selectAssignments(["L1"])).modelMinimumApprovalUsd).toBeCloseTo(all.modelReservePerRunUsd, 5);
    expect(worstCase(selectAssignments(["L4"])).modelMinimumApprovalUsd).toBeCloseTo(all.modelReservePerRunUsd, 5);
  });

  it("selects nothing for an unknown id", () => {
    expect(selectAssignments(["L9"])).toHaveLength(0);
  });
});
