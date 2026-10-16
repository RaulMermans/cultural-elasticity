/**
 * Deterministic regression over the LIVE benchmark fixtures (captured 2026-10-16 from the Qloo
 * hackathon API, replayed offline; no network). Locks the methodology's output for elasticity-v0.1.
 * A change here means the methodology's output meaning changed: bump METHODOLOGY_VERSION and explain.
 */
import { describe, expect, it } from "vitest";
import { runElasticityEval } from "../scripts/elasticity-harness.js";
import { METHODOLOGY_VERSION } from "../src/methodology/config.js";

const report = runElasticityEval();
const jacquemus = report.results.get("jacquemus")!;

describe(`live benchmark regression (${METHODOLOGY_VERSION})`, () => {
  it("every structural check passes", () => {
    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
    expect(report.brands).toEqual(["alienware", "jacquemus", "lululemon", "muji", "nintendo", "patagonia"]);
  });

  it("results are live and deterministic", () => {
    for (const result of report.results.values()) expect(result.evidenceOrigin).toBe("live");
    expect(report.repeatDeterminism).toEqual({ identical: 6, total: 6 });
  });

  it("Jacquemus: order, positions, robustness and classes", () => {
    expect(jacquemus.territories.map((t) => [t.territory.id, t.relativePosition.position, t.relativePosition.medianPercentile, t.robustness.level, t.classification.label])).toEqual([
      ["boutique_hospitality", 1, 0.8, "HIGH", "NATURAL_ADJACENCY"],
      ["wellness", 1, 0.8, "LOW", "UNCERTAIN_REPRESENTATION_SENSITIVE"],
      ["furniture", 3, 0.6, "LOW", "UNCERTAIN_REPRESENTATION_SENSITIVE"],
      ["ceramics", 3, 0.6, "MEDIUM", "CREDIBLE_STRETCH"],
      ["sailing_marine", 5, 0.2, "MEDIUM", "CULTURAL_BREAK"],
      ["gaming_hardware", 6, 0, "HIGH", "CULTURAL_BREAK"],
    ]);
  });

  it("Jacquemus: Boutique Hospitality evidence matches the product model", () => {
    const h = jacquemus.territories[0]!;
    expect(h.panelEvidence.map((o) => [o.exemplarLabel, o.rank, o.panelSize])).toEqual([["Ace Hotel", 2, 6], ["The Hoxton", 2, 6], ["Soho House", 1, 6]]);
    expect([h.coherenceRaw.summary?.sharedCountMedian, h.coherenceFiltered.summary?.sharedCountMedian]).toEqual([5, 2]);
    expect(h.conditionedEvidence?.support).toBe("SUPPORTED");
    expect(h.relativeElasticityIndex).toBeUndefined();
  });

  it("the index gate fails on exemplar sensitivity (B for all brands), so no index is emitted", () => {
    expect(report.gate.overall).toBe("FAIL");
    expect(report.gate.checkPassCounts).toEqual({ A: 6, B: 0, C: 1, D: 6, E: 6, F: 6, G: 6 });
    expect([...report.results.values()].every((r) => r.territories.every((t) => t.relativeElasticityIndex === undefined))).toBe(true);
  });

  it("benchmark metrics", () => {
    expect(report.pairwise.all).toMatchObject({ total: 57, correct: 51, ties: 3, unresolved: 0 });
    expect(report.pairwise.heldOut).toMatchObject({ total: 29, correct: 24 });
    expect(report.pairwise.strongVsWeak).toMatchObject({ total: 22, correct: 22 });
    expect(report.robustness).toMatchObject({ stable: 26, total: 36 });
    expect(report.insufficientEvidence).toBe(0);
    expect(report.calibration.chosen).toEqual({ naturalAdjacencyMin: 0.8, culturalBreakMax: 0.2 });
  });
});
