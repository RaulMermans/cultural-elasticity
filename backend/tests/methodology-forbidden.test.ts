/**
 * Regression tests for every forbidden Sprint 2 behaviour. Each test fails if the methodology starts
 * doing the forbidden thing. SYNTHETIC inputs only.
 */
import type { CulturalElasticityResult } from "@cultural-elasticity/shared";
import { describe, expect, it } from "vitest";
import { analyzeElasticity } from "../src/methodology/elasticity.js";
import { findElasticityViolations } from "../src/methodology/validate.js";
import { clone, synInput } from "./fixtures/synthetic/methodology.js";

const T = ["t1", "t2", "t3", "t4"];
const twoPanels = { panels: [{ id: "A", order: T }, { id: "A-repeat", purpose: "repeat" as const, repeatOf: "A", order: T }, { id: "B", exemplarIndex: 1, order: ["t2", "t1", "t4", "t3"] }] };

/** Everything except raw within-call values, which are shown per panel and may legitimately differ. */
function withoutValues(result: CulturalElasticityResult): unknown {
  return JSON.parse(JSON.stringify(result, (key, value) => (key === "withinCallValue" ? null : value)));
}
const tamper = (result: CulturalElasticityResult, mutate: (r: CulturalElasticityResult) => void) => {
  const copy = structuredClone(result);
  mutate(copy);
  return findElasticityViolations(copy).map((v) => v.message).join(" | ");
};

describe("forbidden behaviours", () => {
  it("cross-call affinity values are never compared: rescaling one panel's values changes nothing", () => {
    const base = analyzeElasticity(synInput({ ...twoPanels }));
    const rescaled = analyzeElasticity(synInput({ panels: [{ ...twoPanels.panels[0]!, values: [900, 800, 700, 600] }, { ...twoPanels.panels[1]!, values: [0.004, 0.003, 0.002, 0.001] }, { ...twoPanels.panels[2]!, values: [-5, -6, -7, -8] }] }));
    expect(withoutValues(rescaled)).toEqual(withoutValues(base));
  });

  it("affinities from different calls are never averaged: the central position is the median of rank percentiles", () => {
    const result = analyzeElasticity(synInput({ ...twoPanels }));
    for (const t of result.territories) {
      const percentiles = t.panelEvidence.map((o) => o.percentile).sort((a, b) => a - b);
      expect(t.relativePosition.medianPercentile).toBeCloseTo((percentiles[0]! + percentiles[percentiles.length - 1]!) / 2, 5);
      expect(t.panelEvidence.every((o) => o.percentile === Math.round(((o.panelSize - o.rank) / (o.panelSize - 1)) * 1e6) / 1e6)).toBe(true);
    }
  });

  it("one exemplar never silently represents a territory with known alternates", () => {
    const result = analyzeElasticity(synInput({ exemplars: { t1: 2 }, panels: [{ id: "A", order: T }, { id: "A2", purpose: "alternate", exemplarIndex: 0, order: T }] }));
    const t1 = result.territories.find((t) => t.territory.id === "t1")!;
    expect(t1.robustness.level).toBe("INSUFFICIENT");
    expect(t1.classification.label).toBe("UNCERTAIN_REPRESENTATION_SENSITIVE");
    expect(t1.limitations.some((l) => l.code === "ROBUSTNESS_INSUFFICIENT")).toBe(true);
    expect(t1.robustness.reasons.join(" ")).toMatch(/1 of 2 declared exemplars/);
  });

  it("operational signals are disclosed, never silently deleted", () => {
    const result = analyzeElasticity(synInput());
    expect(result.brandTagFilter.keptCount + result.brandTagFilter.excluded.length).toBe(result.brandTagFilter.rawCount);
    expect(result.brandTagFilter.excluded.map((e) => e.rule)).toEqual(["payment", "price_descriptor"]);
    expect(tamper(result, (r) => r.brandTagFilter.excluded.pop())).toMatch(/nothing silently deleted/);
  });

  it("missing evidence never becomes 0", () => {
    const input = clone(synInput({ conditioned: { t1: undefined } }));
    for (const panel of input.panels) delete panel.ranking;
    input.exemplarProfiles = input.exemplarProfiles.filter((p) => !p.subject.id.startsWith("syn-ex-t2"));
    const result = analyzeElasticity(input);
    for (const t of result.territories) {
      expect(t.relativePosition).toMatchObject({ position: null, medianPercentile: null, status: "insufficient_evidence" });
      expect(t.classification.label).toBe("INSUFFICIENT_EVIDENCE");
    }
    const t1 = result.territories.find((t) => t.territory.id === "t1")!;
    expect(t1.conditionedEvidence).toBeNull();
    expect(t1.limitations.some((l) => l.code === "CONDITIONED_NOT_COLLECTED")).toBe(true);
    const t2 = result.territories.find((t) => t.territory.id === "t2")!;
    expect(t2.coherenceRaw.perExemplar.every((e) => e.status === "unavailable" && e.sharedCount === null && e.jaccard === null)).toBe(true);
    expect(t2.coherenceRaw.summary).toBeNull();
  });

  it("bridge evidence cannot enter the methodology (no slot, so it cannot become a number)", () => {
    expect(() => analyzeElasticity({ ...synInput(), bridges: [{ semantics: "joint_signal", signals: [], provenance: [] }] })).toThrow(/Invalid methodology input/);
  });

  it("audience data cannot enter the methodology", () => {
    expect(() => analyzeElasticity({ ...synInput(), audience: { fields: {}, interpretableMetrics: [], provenance: [] } })).toThrow(/Invalid methodology input/);
  });

  it("novelty and momentum cannot appear as result fields", () => {
    const result = analyzeElasticity(synInput());
    expect(JSON.stringify(result)).not.toMatch(/"(novelty|momentum)[^"]*":/i);
    expect(tamper(result, (r) => Object.assign(r.territories[0]!, { noveltyLevel: 0.4 }))).toMatch(/forbidden field name/);
    expect(tamper(result, (r) => Object.assign(r.territories[0]!, { momentum: 1 }))).toMatch(/forbidden field name/);
    expect(tamper(result, (r) => Object.assign(r.territories[0]!, { bridgeStrength: 1, audienceAdjacency: 1 }))).toMatch(/forbidden field name/);
  });

  it("tag affinity never weights coherence (or anything else)", () => {
    const base = synInput();
    const reweighted = clone(base);
    for (const profile of [reweighted.brand, ...reweighted.exemplarProfiles]) profile.signals.forEach((s, i) => (s.numeric = { value: (i * 37) % 11, comparisonScope: "within_call" }));
    expect(analyzeElasticity(reweighted)).toEqual(analyzeElasticity(base));
  });

  it("graph-distance terminology is rejected", () => {
    const result = analyzeElasticity(synInput());
    expect(JSON.stringify(result)).not.toMatch(/graph[\s-]distance|cultural distance(?! proxy)/i);
    expect(tamper(result, (r) => (r.semantics.relativePosition = "the graph distance between brand and territory"))).toMatch(/forbidden claim/);
    expect(tamper(result, (r) => (r.semantics.relativePosition = "cultural distance is small"))).toMatch(/forbidden claim/);
    expect(tamper(result, (r) => Object.assign(r.territories[0]!, { distance: 2 }))).toMatch(/forbidden field name/);
  });

  it("no 0–100 number appears when the gate fails", () => {
    const result = analyzeElasticity(synInput({ panels: [{ id: "A", order: T }, { id: "B", exemplarIndex: 1, order: ["t4", "t3", "t2", "t1"] }] }));
    expect(result.indexGate.status).toBe("FAIL");
    expect(result.territories.every((t) => t.relativeElasticityIndex === undefined)).toBe(true);
    expect(JSON.stringify(result.indexGate)).not.toMatch(/\b(index|value)\D{0,12}\b([1-9]\d|100)\b(?!\.)/i);
  });

  it("the result never implies a commercial-success probability", () => {
    const result = analyzeElasticity(synInput());
    expect(result.semantics.notMeasured.join(" ")).toMatch(/commercial success/);
    expect(tamper(result, (r) => (r.territories[0]!.classification.reasons = ["82% likely to succeed"]))).toMatch(/forbidden claim/);
    expect(tamper(result, (r) => (r.territories[0]!.classification.reasons = ["82% culturally compatible"]))).toMatch(/forbidden claim/);
    expect(tamper(result, (r) => (r.territories[0]!.classification.reasons = ["probability of success is high"]))).toMatch(/forbidden claim/);
    expect(tamper(result, (r) => Object.assign(r.territories[0]!, { confidence: "HIGH" }))).toMatch(/forbidden field name/);
  });

  it("methodology output never loses provenance", () => {
    const result = analyzeElasticity(synInput());
    expect(tamper(result, (r) => (r.territories[0]!.provenance = []))).toMatch(/lost its provenance/);
    expect(tamper(result, (r) => (r.territories[0]!.panelEvidence[0]!.correlationId = ""))).toMatch(/without a correlation id/);
  });
});
