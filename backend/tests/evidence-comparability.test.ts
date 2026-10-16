import { describe, expect, it } from "vitest";
import { compareNumeric, verifyRankingScope } from "../src/evidence/comparability.js";
import type { NumericEvidence, RankingEvidence } from "../src/evidence/schema.js";
import { ref } from "./fixtures/synthetic/evidence.js";

const obs = (numeric: NumericEvidence, ...corrs: string[]) => ({ numeric, provenance: corrs.map((c) => ref(c)) });

describe("compareNumeric", () => {
  it("permits within_call values from the same single call", () => {
    expect(compareNumeric(obs({ value: 1, comparisonScope: "within_call" }, "c1"), obs({ value: 2, comparisonScope: "within_call" }, "c1"), "cross_profile").comparable).toBe(true);
  });

  it.each([
    ["different calls", obs({ value: 1, comparisonScope: "within_call" }, "c1"), obs({ value: 2, comparisonScope: "within_call" }, "c2"), "cross_profile", /different calls/],
    ["no correlation id", obs({ value: 1, comparisonScope: "within_call" }), obs({ value: 2, comparisonScope: "within_call" }, "c1"), "cross_profile", /exactly one identifiable call/],
    ["several calls behind one value", obs({ value: 1, comparisonScope: "within_call" }, "c1", "c2"), obs({ value: 2, comparisonScope: "within_call" }, "c1"), "cross_profile", /exactly one/],
    ["unknown scope", obs({ value: 1, comparisonScope: "unknown" }, "c1"), obs({ value: 2, comparisonScope: "unknown" }, "c1"), "same_profile", /unknown comparison scope/],
    ["mixed scopes", obs({ value: 1, scale: "s", comparisonScope: "cross_call_verified" }, "c1"), obs({ value: 2, scale: "s", comparisonScope: "within_call" }, "c1"), "cross_profile", /different comparison scopes/],
    ["different scales", obs({ value: 1, scale: "s1", comparisonScope: "cross_call_verified" }), obs({ value: 2, scale: "s2", comparisonScope: "cross_call_verified" }), "cross_profile", /scales/],
    ["one scale undeclared", obs({ value: 1, scale: "s1", comparisonScope: "within_call" }, "c"), obs({ value: 2, comparisonScope: "within_call" }, "c"), "cross_profile", /scales/],
    ["within_profile across profiles", obs({ value: 1, comparisonScope: "within_profile" }), obs({ value: 2, comparisonScope: "within_profile" }), "cross_profile", /inside one profile/],
    ["cross_call_verified with no scale", obs({ value: 1, comparisonScope: "cross_call_verified" }), obs({ value: 2, comparisonScope: "cross_call_verified" }), "cross_profile", /requires a declared scale/],
  ] as const)("refuses %s", (_name, a, b, context, reason) => {
    const result = compareNumeric(a, b, context);
    expect(result.comparable).toBe(false);
    expect(!result.comparable && result.reason).toMatch(reason);
  });

  it("permits within_profile inside one profile and verified cross-call values on one scale", () => {
    expect(compareNumeric(obs({ value: 1, comparisonScope: "within_profile" }), obs({ value: 2, comparisonScope: "within_profile" }), "same_profile").comparable).toBe(true);
    expect(compareNumeric(obs({ value: 1, scale: "s", comparisonScope: "cross_call_verified" }), obs({ value: 2, scale: "s", comparisonScope: "cross_call_verified" }), "cross_profile").comparable).toBe(true);
  });
});

describe("verifyRankingScope", () => {
  const ranking = (scope: "single_call" | "unknown", corrs: (string | undefined)[], rankingCorr?: string): RankingEvidence => ({
    rankedAgainst: "syn-brand",
    comparisonScope: scope,
    candidates: corrs.map((c, i) => ({ id: `c${i}`, label: `c${i}`, rank: i + 1, provenance: c === undefined ? [] : [ref(c)] })),
    provenance: rankingCorr ? [ref(rankingCorr)] : [],
  });

  it("verifies one declared and observed call", () => {
    expect(verifyRankingScope(ranking("single_call", ["r", "r", "r"], "r"))).toEqual({ verified: true, correlationId: "r" });
  });

  it.each([
    ["undeclared scope", ranking("unknown", ["r", "r"])],
    ["candidates from two calls", ranking("single_call", ["r1", "r2"])],
    ["a candidate without a call", ranking("single_call", ["r", undefined])],
    ["ranking-level provenance from another call", ranking("single_call", ["r", "r"], "other")],
  ])("refuses %s", (_name, input) => {
    expect(verifyRankingScope(input).verified).toBe(false);
  });
});
