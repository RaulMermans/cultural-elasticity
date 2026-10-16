/**
 * Benchmark evaluation and threshold calibration (pure; the eval script supplies loaded data).
 *
 * Pairwise accuracy compares median panel percentiles of two territories FOR THE SAME BRAND, i.e.
 * positions inside one brand's comparison set. Ties count as not correct and are reported apart.
 *
 * Calibration chooses the PROVISIONAL classification thresholds by grid search on the calibration
 * brands only, maximising agreement between class and label (strong ↔ NATURAL_ADJACENCY, mid ↔
 * CREDIBLE_STRETCH, weak ↔ CULTURAL_BREAK; UNCERTAIN and INSUFFICIENT never agree). Ties are broken
 * toward the a-priori default, so the grid cannot drift without evidence. Held-out brands are only
 * evaluated with the chosen thresholds.
 */
import type { CulturalElasticityResult, ElasticityClass } from "@cultural-elasticity/shared";
import { expectationOf, subsetOf, type Benchmark, type Expectation, type PairwiseAssertion } from "./benchmark.js";
import type { ClassificationThresholds } from "./classification.js";
import { CALIBRATION_GRID } from "./config.js";
import type { MethodologyInput } from "./contracts.js";
import { computeElasticity } from "./elasticity.js";
import { round } from "./stats.js";

export const EXPECTED_CLASS: Record<Expectation, ElasticityClass> = {
  expected_strong: "NATURAL_ADJACENCY",
  expected_mid: "CREDIBLE_STRETCH",
  expected_weak: "CULTURAL_BREAK",
};

export type PairwiseOutcome = PairwiseAssertion & { outcome: "correct" | "incorrect" | "tie" | "unresolved"; higherPercentile: number | null; lowerPercentile: number | null };

export type PairwiseSummary = { total: number; correct: number; incorrect: number; ties: number; unresolved: number; accuracy: number | null };

function medianOf(result: CulturalElasticityResult, territoryId: string): number | null {
  return result.territories.find((t) => t.territory.id === territoryId)?.relativePosition.medianPercentile ?? null;
}

export function evaluatePairwise(results: ReadonlyMap<string, CulturalElasticityResult>, assertions: readonly PairwiseAssertion[]): PairwiseOutcome[] {
  return assertions.map((assertion) => {
    const result = results.get(assertion.brandKey);
    const hi = result ? medianOf(result, assertion.higher) : null;
    const lo = result ? medianOf(result, assertion.lower) : null;
    const outcome = hi === null || lo === null ? "unresolved" : hi > lo ? "correct" : hi === lo ? "tie" : "incorrect";
    return { ...assertion, outcome, higherPercentile: hi, lowerPercentile: lo };
  });
}

export function summarizePairwise(outcomes: readonly PairwiseOutcome[]): PairwiseSummary {
  const count = (o: PairwiseOutcome["outcome"]) => outcomes.filter((x) => x.outcome === o).length;
  const resolved = outcomes.length - count("unresolved");
  return { total: outcomes.length, correct: count("correct"), incorrect: count("incorrect"), ties: count("tie"), unresolved: count("unresolved"), accuracy: resolved === 0 ? null : round(count("correct") / resolved) };
}

export type ClassCase = { brandKey: string; territoryId: string; expected: Expectation; actual: ElasticityClass; agrees: boolean };

export function classCases(benchmark: Benchmark, results: ReadonlyMap<string, CulturalElasticityResult>): ClassCase[] {
  return [...results.entries()].flatMap(([brandKey, result]) =>
    result.territories.flatMap((t) => {
      const expected = expectationOf(benchmark, brandKey, t.territory.id);
      if (expected === undefined) return [];
      return [{ brandKey, territoryId: t.territory.id, expected, actual: t.classification.label, agrees: EXPECTED_CLASS[expected] === t.classification.label }];
    }),
  );
}

export type GridPoint = ClassificationThresholds & { agreements: number; cases: number };
export type CalibrationOutcome = { chosen: ClassificationThresholds; grid: GridPoint[]; calibrationBrands: string[] };

export function calibrateThresholds(benchmark: Benchmark, inputs: ReadonlyMap<string, MethodologyInput>): CalibrationOutcome {
  const brands = [...inputs.keys()].filter((key) => subsetOf(benchmark, key) === "calibration").sort();
  const grid: GridPoint[] = [];
  for (const naturalAdjacencyMin of CALIBRATION_GRID.naturalAdjacencyMin) {
    for (const culturalBreakMax of CALIBRATION_GRID.culturalBreakMax) {
      if (culturalBreakMax >= naturalAdjacencyMin) continue;
      const thresholds = { naturalAdjacencyMin, culturalBreakMax };
      const results = new Map(brands.map((key) => [key, computeElasticity(inputs.get(key)!, { thresholds })]));
      const cases = classCases(benchmark, results);
      grid.push({ ...thresholds, agreements: cases.filter((c) => c.agrees).length, cases: cases.length });
    }
  }
  const d = CALIBRATION_GRID.default;
  const distance = (p: GridPoint) => round(Math.abs(p.naturalAdjacencyMin - d.naturalAdjacencyMin) + Math.abs(p.culturalBreakMax - d.culturalBreakMax));
  const best = [...grid].sort((a, b) => b.agreements - a.agreements || distance(a) - distance(b) || b.naturalAdjacencyMin - a.naturalAdjacencyMin || a.culturalBreakMax - b.culturalBreakMax)[0]!;
  return { chosen: { naturalAdjacencyMin: best.naturalAdjacencyMin, culturalBreakMax: best.culturalBreakMax }, grid, calibrationBrands: brands };
}
