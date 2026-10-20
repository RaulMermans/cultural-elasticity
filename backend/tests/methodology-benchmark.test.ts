/** Benchmark loader, brand-level calibration split and pairwise derivation. */
import { describe, expect, it } from "vitest";
import { loadBenchmark } from "../scripts/elasticity-harness.js";
import { benchmarkSchema, pairwiseAssertions, subsetOf } from "../scripts/benchmark/benchmark.js";
import { calibrateThresholds, evaluatePairwise, summarizePairwise } from "../scripts/benchmark/calibration.js";
import { parseMethodologyInput } from "../src/methodology/contracts.js";
import { analyzeElasticity } from "../src/methodology/elasticity.js";
import { synInput } from "./fixtures/synthetic/methodology.js";

const benchmark = loadBenchmark();

describe("benchmark loader", () => {
  it("loads the v0 benchmark with human-curated labels", () => {
    expect(benchmark.benchmarkVersion).toBe("cultural-elasticity-benchmark-v0");
    expect(benchmark.notice).toMatch(/^HUMAN-CURATED EVALUATION LABELS, NOT OBJECTIVE TRUTH/);
    expect(benchmark.brands).toHaveLength(6);
    expect(benchmark.brands.every((b) => b.labels.every((l) => l.rationale.length > 20))).toBe(true);
  });

  it("includes strong, mid and weak labels, with weak controls for every brand", () => {
    for (const brand of benchmark.brands) {
      expect(brand.labels.some((l) => l.label === "expected_strong"), brand.key).toBe(true);
      expect(brand.labels.some((l) => l.label === "expected_weak"), brand.key).toBe(true);
    }
  });

  it("never claims historical success in a rationale", () => {
    expect(JSON.stringify(benchmark)).not.toMatch(/historically successful|succeeded|was a success/i);
  });

  it("derives 57 pairwise assertions, strongest label above weaker", () => {
    const assertions = pairwiseAssertions(benchmark);
    expect(assertions).toHaveLength(57);
    expect(assertions.filter((a) => a.basis === "expected_strong>expected_weak")).toHaveLength(22);
    expect(assertions.every((a) => a.higher !== a.lower)).toBe(true);
  });
});

describe("calibration split", () => {
  it("splits by brand: disjoint subsets that cover every brand", () => {
    const { calibration, heldOut } = benchmark.split;
    expect(calibration.filter((k) => heldOut.includes(k))).toEqual([]);
    expect([...calibration, ...heldOut].sort()).toEqual(benchmark.brands.map((b) => b.key).sort());
  });

  it("keeps a brand labelled after seeing its evidence out of the held-out subset", () => {
    expect(subsetOf(benchmark, "jacquemus")).toBe("calibration");
    for (const key of benchmark.split.heldOut) expect(benchmark.brands.find((b) => b.key === key)!.labelsWrittenBlind).toBe(true);
    const leaked = structuredClone(benchmark);
    leaked.split.calibration = leaked.split.calibration.filter((k) => k !== "jacquemus");
    leaked.split.heldOut.push("jacquemus");
    expect(benchmarkSchema.safeParse(leaked).success).toBe(false);
  });

  it("rejects a brand in both subsets", () => {
    const both = structuredClone(benchmark);
    both.split.heldOut.push("muji");
    expect(benchmarkSchema.safeParse(both).success).toBe(false);
  });

  it("calibrates on calibration brands only", () => {
    const parsed = parseMethodologyInput(synInput());
    if (!parsed.ok) throw new Error("synthetic input invalid");
    const inputs = new Map([["muji", parsed.input], ["patagonia", parsed.input]]);
    const outcome = calibrateThresholds(benchmark, inputs);
    expect(outcome.calibrationBrands).toEqual(["muji"]);
    expect(outcome.grid.every((g) => g.cases === 4 || g.cases === 0)).toBe(true);
  });
});

describe("pairwise evaluation", () => {
  it("counts correct, ties and unresolved pairs separately", () => {
    const result = analyzeElasticity(synInput({ panels: [{ id: "A", order: ["t1", "t2", "t3", "t4"] }, { id: "B", exemplarIndex: 1, order: ["t2", "t1", "t3", "t4"] }] }));
    const outcomes = evaluatePairwise(new Map([["syn", result]]), [
      { brandKey: "syn", higher: "t1", lower: "t3", basis: "expected_strong>expected_weak" },
      { brandKey: "syn", higher: "t1", lower: "t2", basis: "expected_strong>expected_mid" },
      { brandKey: "syn", higher: "t4", lower: "t3", basis: "expected_mid>expected_weak" },
      { brandKey: "missing", higher: "t1", lower: "t2", basis: "expected_strong>expected_mid" },
    ]);
    expect(outcomes.map((o) => o.outcome)).toEqual(["correct", "tie", "incorrect", "unresolved"]);
    expect(summarizePairwise(outcomes)).toEqual({ total: 4, correct: 1, incorrect: 1, ties: 1, unresolved: 1, accuracy: 0.333333 });
  });
});
