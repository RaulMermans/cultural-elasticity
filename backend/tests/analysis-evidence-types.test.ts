import { describe, expect, it } from "vitest";
import { analyzeAudienceEvidence } from "../src/analysis/adjacency.js";
import { analyzeBridges } from "../src/analysis/bridges.js";
import { analyzeRanking } from "../src/analysis/ranking.js";
import type { InterpretableMetric, RankedCandidate, RankingEvidence } from "../src/evidence/schema.js";
import { ref, signal, verified } from "./fixtures/synthetic/evidence.js";

describe("analyzeAudienceEvidence", () => {
  const metric = (id: string, direction: InterpretableMetric["direction"], comparisonScope: InterpretableMetric["comparisonScope"] = "within_call"): InterpretableMetric => ({
    id,
    label: id,
    value: 0.3,
    direction,
    comparisonScope,
    provenance: [ref("syn-corr-aud")],
  });

  it("is unavailable, not zero, when audience evidence is absent", () => {
    expect(analyzeAudienceEvidence(undefined)).toMatchObject({ status: "unavailable", metrics: [] });
  });

  it("keeps opaque numeric fields out of the metrics and lists them for investigation", () => {
    const result = analyzeAudienceEvidence({ fields: { b: { depth: [1, "x", { z: 2.5 }] }, a: 7, label: "syn" }, interpretableMetrics: [], provenance: [ref("syn-corr-aud")] });
    expect(result.status).toBe("insufficient_evidence");
    expect(result.metrics).toEqual([]);
    expect(result.opaqueFields.paths).toEqual(["a", "b.depth[0]", "b.depth[1]", "b.depth[2].z", "label"]);
    expect(result.opaqueFields.numericPaths).toEqual(["a", "b.depth[0]", "b.depth[2].z"]);
    expect(result.limitations.map((l) => l.code)).toEqual(["OPAQUE_NUMERIC_FIELDS", "NO_INTERPRETABLE_AUDIENCE_METRIC"]);
  });

  it("makes only directional metrics usable, and marks cross-call comparability explicitly", () => {
    const result = analyzeAudienceEvidence({
      fields: {},
      interpretableMetrics: [metric("m-close", "higher_is_closer"), metric("m-far", "higher_is_farther", "cross_call_verified"), metric("m-neutral", "neutral")],
      provenance: [],
    });
    expect(result.status).toBe("available");
    expect(result.metrics.map((m) => [m.id, m.usableAsIngredient, m.crossCallComparable])).toEqual([
      ["m-close", true, false],
      ["m-far", true, true],
      ["m-neutral", false, false],
    ]);
    expect(result.metrics[2]?.exclusionReason).toMatch(/neutral/);
    expect(result).not.toHaveProperty("aggregate");
  });
});

describe("analyzeRanking", () => {
  const candidate = (id: string, rank: number | undefined, corr: string | undefined, value?: number): RankedCandidate => ({
    id,
    label: id,
    ...(rank !== undefined && { rank }),
    ...(value !== undefined && { numeric: { value, scale: "syn-rank-scale", comparisonScope: "within_call" } }),
    provenance: corr === undefined ? [] : [ref(corr, "rank")],
  });
  const ranking = (candidates: RankedCandidate[], overrides: Partial<RankingEvidence> = {}): RankingEvidence => ({
    rankedAgainst: "syn-brand",
    targetCandidateId: "t",
    comparisonScope: "single_call",
    candidates,
    provenance: [],
    ...overrides,
  });

  it("computes position, percentile and raw value gaps within one verified call", () => {
    const result = analyzeRanking(ranking([candidate("a", 1, "r", 0.9), candidate("t", 2, "r", 0.6), candidate("b", 3, "r", 0.5), candidate("c", 5, "r", 0.1)]), "syn-brand");
    expect(result.status).toBe("available");
    expect(result.scope).toEqual({ declared: "single_call", verified: true, correlationId: "r" });
    expect(result.candidates.map((c) => c.id)).toEqual(["a", "t", "b", "c"]);
    const t = result.target!;
    expect([t.rankPosition.value, t.positionsFromTop.value, t.positionsFromBottom.value]).toEqual([2, 1, 2]);
    expect(t.relativeRankPercentile.value).toBeCloseTo(2 / 3);
    expect(t.valueGapFromTop.value).toBeCloseTo(0.3);
    expect(t.valueGapFromBottom.value).toBeCloseTo(0.5);
    expect(t.rankPosition.provenance.map((p) => p.correlationId)).toEqual(["r"]);
  });

  it("refuses every relative calculation for candidates from different calls, without rank-merging them", () => {
    const result = analyzeRanking(ranking([candidate("t", 1, "r1", 0.9), candidate("a", 2, "r2", 0.5)]), "syn-brand");
    expect(result.status).toBe("not_comparable");
    expect(result.scope?.verified).toBe(false);
    expect(result.candidates.map((c) => c.id)).toEqual(["a", "t"]);
    for (const ingredient of Object.values(result.target!).filter((v) => typeof v === "object")) expect(ingredient).toMatchObject({ status: "not_comparable", value: null });
  });

  it("refuses an undeclared scope even when correlation ids agree", () => {
    expect(analyzeRanking(ranking([candidate("t", 1, "r"), candidate("a", 2, "r")], { comparisonScope: "unknown" }), "syn-brand").status).toBe("not_comparable");
  });

  it("needs ranks for positions and two candidates for a percentile", () => {
    expect(analyzeRanking(ranking([candidate("t", undefined, "r"), candidate("a", 1, "r")]), "syn-brand").status).toBe("insufficient_evidence");
    const single = analyzeRanking(ranking([candidate("t", 1, "r")]), "syn-brand");
    expect(single.target?.relativeRankPercentile).toMatchObject({ status: "insufficient_evidence", value: null });
    expect(single.target?.rankPosition.value).toBe(1);
  });

  it("refuses value gaps when candidate values are missing or not comparable", () => {
    const missing = analyzeRanking(ranking([candidate("t", 1, "r", 0.5), candidate("a", 2, "r")]), "syn-brand");
    expect(missing.target?.valueGapFromTop).toMatchObject({ status: "insufficient_evidence", value: null });
    const mixed = analyzeRanking(ranking([candidate("t", 1, "r", 0.5), { ...candidate("a", 2, "r"), numeric: verified(0.4) }]), "syn-brand");
    expect(mixed.target?.valueGapFromTop).toMatchObject({ status: "not_comparable", value: null });
  });

  it("flags a ranking that was not made against the brand", () => {
    const result = analyzeRanking(ranking([candidate("t", 1, "r"), candidate("a", 2, "r")], { rankedAgainst: "syn-other" }), "syn-brand");
    expect(result.limitations.map((l) => l.code)).toContain("RANKING_NOT_AGAINST_BRAND");
  });

  it("is unavailable without ranking evidence", () => {
    expect(analyzeRanking(undefined, "syn-brand")).toMatchObject({ status: "unavailable", candidateCount: null, target: null });
  });
});

describe("analyzeBridges", () => {
  it("is unavailable (null count, not 0) without bridge evidence", () => {
    for (const input of [undefined, []]) expect(analyzeBridges(input)).toMatchObject({ status: "unavailable", signalCount: null });
  });

  it("treats an empty, provenance-free bridge as not collected", () => {
    expect(analyzeBridges([{ semantics: "joint_signal", signals: [], provenance: [] }]).status).toBe("unavailable");
  });

  it("reports an observed empty result that traces to a call as zero signals", () => {
    expect(analyzeBridges([{ semantics: "joint_signal", signals: [], provenance: [ref("syn-corr-bridge")] }])).toMatchObject({ status: "available", signalCount: 0, numericCoverage: null });
  });

  it("dedupes signals across bridge items and reports ingredients without a score", () => {
    const result = analyzeBridges([
      { semantics: "shared_signal", signals: [signal(1, { category: "syn-a", corr: "b1" }), signal(2, { category: "syn-b", corr: "b1", numeric: verified(1) })], provenance: [ref("b1")] },
      { semantics: "intermediate_signal", signals: [signal(2, { category: "syn-b", corr: "b2", rank: 1 })], provenance: [ref("b2")] },
    ]);
    expect(result).toMatchObject({ status: "available", signalCount: 2, bySemantics: { shared_signal: 2, intermediate_signal: 1 }, categoryCount: 2, numericCoverage: 0.5 });
    expect(result.signals.find((s) => s.id === "syn-sig-002")?.provenance.map((p) => p.correlationId)).toEqual(["b1", "b2"]);
    expect(result.provenanceCoverage).toEqual({ items: 2, withProvenance: 2, withCorrelationId: 2, completeness: 1 });
    expect(Object.keys(result).some((key) => /score|strength/i.test(key))).toBe(false);
  });
});
