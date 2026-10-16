import { describe, expect, it } from "vitest";
import { profileCoverage, profileCoverageReport, topNSensitivity } from "../src/analysis/coverage.js";
import { computeOverlap, setOverlap } from "../src/analysis/overlap.js";
import { profile, ranked, ref, signal, verified } from "./fixtures/synthetic/evidence.js";

const brandOf = (ids: number[], extra?: Parameters<typeof ranked>[2]) => profile("brand", ranked(ids, "syn-corr-brand-profile", extra));
const targetOf = (ids: number[], extra?: Parameters<typeof ranked>[2]) => profile("target", ranked(ids, "syn-corr-target-profile", extra));

describe("computeOverlap", () => {
  it("computes counts, Jaccard, overlap coefficient and the three signal lists", () => {
    const result = computeOverlap(brandOf([1, 2, 3, 4]), targetOf([3, 4, 5]));
    expect(result).toMatchObject({ status: "available", brandSignalCount: 4, targetSignalCount: 3, sharedSignalCount: 2, unionCount: 5, jaccard: 2 / 5, overlapCoefficient: 2 / 3 });
    expect(result.shared.map((s) => s.id)).toEqual(["syn-sig-003", "syn-sig-004"]);
    expect(result.uniqueToBrand.map((s) => s.id)).toEqual(["syn-sig-001", "syn-sig-002"]);
    expect(result.uniqueToTarget.map((s) => s.id)).toEqual(["syn-sig-005"]);
    expect(result.shared[0]).toMatchObject({ brandRank: 3, targetRank: 1 });
  });

  it("propagates provenance from both source observations into each shared signal", () => {
    const result = computeOverlap(brandOf([1]), targetOf([1]));
    expect(result.shared[0]?.provenance.map((p) => p.correlationId)).toEqual(["syn-corr-brand-profile", "syn-corr-target-profile"]);
    expect(result.provenance.map((p) => p.correlationId)).toEqual(expect.arrayContaining(["syn-corr-brand-profile", "syn-corr-target-profile", "syn-corr-brand-resolve", "syn-corr-target-resolve"]));
  });

  it("returns insufficient_evidence, not zero overlap, when a profile is empty", () => {
    const result = computeOverlap(brandOf([1, 2]), profile("target", []));
    expect(result.status).toBe("insufficient_evidence");
    expect(result.jaccard).toBeNull();
    expect(result.overlapCoefficient).toBeNull();
    expect(result.limitations.map((l) => l.code)).toContain("TARGET_PROFILE_EMPTY");
  });

  it("notes truncation on the overlap", () => {
    const result = computeOverlap(brandOf([1]), profile("target", [signal(1)], { truncated: true }));
    expect(result.limitations.map((l) => l.code)).toContain("TARGET_PROFILE_TRUNCATED");
  });
});

describe("weighted shared overlap", () => {
  it("computes Σmin/Σmax over shared signals with comparable values only", () => {
    const values: Record<number, [number, number]> = { 1: [0.8, 0.4], 2: [0.5, 0.5] };
    const brand = brandOf([1, 2, 3], (n) => (n <= 2 ? { numeric: verified(values[n]![0]) } : { numeric: verified(0.9) }));
    const target = targetOf([1, 2, 4], (n) => (n <= 2 ? { numeric: verified(values[n]![1]) } : { numeric: verified(0.1) }));
    const weighted = computeOverlap(brand, target).weightedSharedOverlap;
    expect(weighted.status).toBe("available");
    // Unshared signals 3 and 4 are NOT counted as zero on the other side.
    expect(weighted.value).toEqual({ ratio: (0.4 + 0.5) / (0.8 + 0.5), comparedSignalCount: 2, basis: "shared_signals_only" });
  });

  it("refuses values from different calls (within_call scope)", () => {
    const withinCall = (value: number) => ({ numeric: { value, comparisonScope: "within_call" as const } });
    const weighted = computeOverlap(brandOf([1], () => withinCall(0.5)), targetOf([1], () => withinCall(0.6))).weightedSharedOverlap;
    expect(weighted).toMatchObject({ status: "not_comparable", value: null });
  });

  it("permits within_call values when both observations come from the same call", () => {
    const sameCall = (value: number) => ({ numeric: { value, comparisonScope: "within_call" as const }, corr: "syn-corr-joint" });
    const brand = profile("brand", ranked([1], "syn-corr-joint", () => sameCall(0.5)));
    const target = profile("target", ranked([1], "syn-corr-joint", () => sameCall(0.25)));
    expect(computeOverlap(brand, target).weightedSharedOverlap.value?.ratio).toBe(0.5);
  });

  it("refuses unknown scopes, mismatched scales and negative values", () => {
    const unknownScope = computeOverlap(brandOf([1], () => ({ numeric: { value: 1, comparisonScope: "unknown" } })), targetOf([1], () => ({ numeric: { value: 1, comparisonScope: "unknown" } })));
    const scales = computeOverlap(brandOf([1], () => ({ numeric: verified(1, "s1") })), targetOf([1], () => ({ numeric: verified(1, "s2") })));
    const negative = computeOverlap(brandOf([1], () => ({ numeric: verified(-1) })), targetOf([1], () => ({ numeric: verified(1) })));
    for (const result of [unknownScope, scales, negative]) expect(result.weightedSharedOverlap).toMatchObject({ status: "not_comparable", value: null });
  });

  it("is insufficient_evidence when nothing shared carries values on both sides", () => {
    expect(computeOverlap(brandOf([1]), targetOf([1])).weightedSharedOverlap).toMatchObject({ status: "insufficient_evidence", value: null });
    expect(computeOverlap(brandOf([1]), targetOf([2])).weightedSharedOverlap.limitations[0]?.code).toBe("NO_SHARED_SIGNALS");
  });

  it("reports partial numeric coverage", () => {
    const brand = brandOf([1, 2], (n) => (n === 1 ? { numeric: verified(1) } : {}));
    const target = targetOf([1, 2], (n) => (n === 1 ? { numeric: verified(1) } : {}));
    expect(computeOverlap(brand, target).weightedSharedOverlap.limitations.map((l) => l.code)).toEqual(["PARTIAL_NUMERIC_COVERAGE"]);
  });
});

describe("setOverlap", () => {
  it("ignores duplicates within one side", () => {
    expect(setOverlap(["a", "a", "b"], ["b", "b"])).toMatchObject({ sharedCount: 1, unionCount: 2, jaccard: 0.5 });
  });
});

describe("profile coverage", () => {
  it("describes evidence richness", () => {
    const p = profile("brand", [
      signal(1, { numeric: verified(1), category: "syn-a" }),
      signal(2, { category: "syn-b" }),
      signal(3, { rank: null, provenance: [] }),
      signal(4, { provenance: [ref()] }),
    ], { truncated: undefined });
    expect(profileCoverage(p)).toEqual({
      totalSignals: 4,
      rankedSignalCount: 3,
      numericSignalCount: 1,
      numericCoverage: 0.25,
      missingNumericRatio: 0.75,
      numericComparability: "comparable_within_profile",
      truncation: "unknown",
      provenance: { items: 4, withProvenance: 3, withCorrelationId: 2, completeness: 0.5 },
      categoryCount: 2,
      uncategorizedSignalCount: 2,
    });
  });

  it("flags non-comparable values inside one profile and uses null for empty profiles", () => {
    const mixed = profile("brand", [signal(1, { numeric: verified(1, "s1") }), signal(2, { numeric: verified(1, "s2") })]);
    expect(profileCoverage(mixed).numericComparability).toBe("not_comparable");
    const empty = profileCoverage(profile("target", []));
    expect(empty).toMatchObject({ numericCoverage: null, missingNumericRatio: null, categoryCount: null, numericComparability: "no_numeric_values" });
    expect(profileCoverageReport(brandOf([1]), profile("target", []), 0)).toMatchObject({ sharedOfBrand: 0, sharedOfTarget: null });
  });
});

describe("top-N sensitivity", () => {
  const ids = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);

  it("reports Jaccard, shared count and shared identity at each N", () => {
    // Brand ranks 1..20; target shares 1..5 at the top, then diverges, then shares 16..20 at the bottom.
    const brand = brandOf(ids(1, 20));
    const target = targetOf([...ids(1, 5), ...ids(101, 10), ...ids(16, 5)]);
    const report = topNSensitivity(brand, target);
    expect(report.status).toBe("available");
    expect(report.points.map((p) => [p.n, p.sharedCount])).toEqual([[5, 5], [10, 5], [15, 5], [20, 10]]);
    expect(report.points[0]?.jaccard).toBe(1);
    expect(report.points[1]?.jaccard).toBe(5 / 15);
    expect(report.summary).toMatchObject({ jaccardMax: 1, persistentSharedIds: ids(1, 5).map((n) => `syn-sig-${String(n).padStart(3, "0")}`), sharedSetChanges: 1 });
    expect(report.summary?.jaccardRange).toBeCloseTo(1 - 5 / 25);
  });

  it("marks saturated cut-offs", () => {
    const report = topNSensitivity(brandOf(ids(1, 7)), targetOf(ids(1, 7)));
    expect(report.points.map((p) => p.saturated)).toEqual([false, true, true, true]);
    expect(report.limitations.map((l) => l.code)).toContain("TOP_N_SATURATED");
  });

  it("refuses to cut unranked profiles (values are never used as an order)", () => {
    const unranked = profile("target", [signal(1, { rank: null, numeric: verified(0.9) })]);
    const report = topNSensitivity(brandOf([1]), unranked);
    expect(report).toMatchObject({ status: "insufficient_evidence", points: [], summary: null });
    expect(report.limitations[0]?.code).toBe("UNRANKED_SIGNALS");
  });

  it("is insufficient for empty profiles and rejects invalid sizes", () => {
    expect(topNSensitivity(brandOf([1]), profile("target", [])).status).toBe("insufficient_evidence");
    expect(() => topNSensitivity(brandOf([1]), targetOf([1]), [0])).toThrow(RangeError);
    expect(topNSensitivity(brandOf([1, 2]), targetOf([1, 2]), [2, 1, 2]).points.map((p) => p.n)).toEqual([1, 2]);
  });
});
