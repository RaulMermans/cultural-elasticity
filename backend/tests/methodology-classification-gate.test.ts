/** Classification rules and the Relative Elasticity Index gate. SYNTHETIC inputs. */
import { afterEach, describe, expect, it } from "vitest";
import { classifyTerritory } from "../src/methodology/classification.js";
import { RELATIVE_INDEX_DECISION } from "../src/methodology/config.js";
import { analyzeElasticity } from "../src/methodology/elasticity.js";
import { indexTransform } from "../src/methodology/relative-index.js";
import { findElasticityViolations } from "../src/methodology/validate.js";
import { clone, synInput } from "./fixtures/synthetic/methodology.js";

const position = (m: number | null) => ({ status: m === null ? ("insufficient_evidence" as const) : ("available" as const), position: m === null ? null : 1, of: 4, medianPercentile: m, medianRank: null, tiedWith: [], semantics: "relative_candidate_position" as const });
const robustness = (level: "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT") => ({ level, rule: "r", declaredExemplars: 2, panelledExemplars: level === "INSUFFICIENT" ? 1 : 2, validObservations: 2, bestRank: 1, worstRank: 2, rankSpread: 1, percentileSpread: 0.2, directionConsistent: true, reasons: [] });
const quality = (level: "HIGH" | "MEDIUM" | "LOW") => ({ level, rule: "q", perExemplar: [], drivers: [] });

describe("classification (PROVISIONAL, relative)", () => {
  const cases: [number | null, "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT", "HIGH" | "MEDIUM" | "LOW", string][] = [
    [null, "HIGH", "HIGH", "INSUFFICIENT_EVIDENCE"],
    [1, "HIGH", "LOW", "INSUFFICIENT_EVIDENCE"],
    [1, "LOW", "MEDIUM", "UNCERTAIN_REPRESENTATION_SENSITIVE"],
    [0, "INSUFFICIENT", "MEDIUM", "UNCERTAIN_REPRESENTATION_SENSITIVE"],
    [0.8, "MEDIUM", "MEDIUM", "NATURAL_ADJACENCY"],
    [0.7, "HIGH", "MEDIUM", "CREDIBLE_STRETCH"],
    [0.3, "HIGH", "MEDIUM", "CREDIBLE_STRETCH"],
    [0.2, "HIGH", "MEDIUM", "CULTURAL_BREAK"],
  ];
  it.each(cases)("median %s, robustness %s, quality %s → %s", (m, r, q, expected) => {
    expect(classifyTerritory({ position: position(m), robustness: robustness(r), evidenceQuality: quality(q) }).label).toBe(expected);
  });

  it("does not use coherence: changing tag profiles never changes the class", () => {
    const a = analyzeElasticity(synInput());
    const b = analyzeElasticity(synInput({ brandTags: [{ ns: "keyword:qloo", name: "nothing-shared" }] }));
    expect(b.territories.map((t) => t.classification.label)).toEqual(a.territories.map((t) => t.classification.label));
    expect(b.territories.map((t) => t.coherenceRaw.summary?.sharedCountMedian)).not.toEqual(a.territories.map((t) => t.coherenceRaw.summary?.sharedCountMedian));
  });

  it("respects explicit thresholds (used only by calibration)", () => {
    const input = synInput({ panels: [{ id: "A", order: ["t1", "t2", "t3", "t4"] }, { id: "B", exemplarIndex: 1, order: ["t2", "t1", "t3", "t4"] }] });
    const strict = analyzeElasticity(input).territories.find((t) => t.territory.id === "t1")!.classification.label;
    const loose = analyzeElasticity(input, { thresholds: { naturalAdjacencyMin: 0.9, culturalBreakMax: 0.1 } }).territories.find((t) => t.territory.id === "t1")!.classification.label;
    expect([strict, loose]).toEqual(["NATURAL_ADJACENCY", "CREDIBLE_STRETCH"]);
  });
});

describe("index gate", () => {
  const stable = { panels: [{ id: "A", order: ["t1", "t2", "t3", "t4"] }, { id: "A-repeat", purpose: "repeat" as const, repeatOf: "A", order: ["t1", "t2", "t3", "t4"] }, { id: "B", exemplarIndex: 1, order: ["t1", "t2", "t3", "t4"] }] };
  const check = (input: ReturnType<typeof synInput>, id: string) => analyzeElasticity(input).indexGate.checks.find((c) => c.id === id)!.status;

  it("passes every check on identical, repeated panels", () => {
    expect(analyzeElasticity(synInput(stable)).indexGate.status).toBe("PASS");
  });

  it("A fails on a changed repeat and is NOT_TESTED without a repeat", () => {
    expect(check(synInput({ panels: [stable.panels[0]!, { ...stable.panels[1]!, order: ["t2", "t1", "t3", "t4"] }, stable.panels[2]!] }), "A")).toBe("FAIL");
    expect(check(synInput({ panels: [stable.panels[0]!, stable.panels[2]!] }), "A")).toBe("NOT_TESTED");
  });

  it("B fails when alternate panels disagree on order", () => {
    expect(check(synInput({ panels: [stable.panels[0]!, stable.panels[1]!, { ...stable.panels[2]!, order: ["t4", "t3", "t2", "t1"] }] }), "B")).toBe("FAIL");
  });

  it("C fails when dropping one panel moves a median by more than one rank step", () => {
    const input = synInput({ exemplars: { t1: 3, t2: 3, t3: 3, t4: 3 }, panels: [{ id: "A", order: ["t1", "t2", "t3", "t4"] }, { id: "B", exemplarIndex: 1, order: ["t4", "t2", "t3", "t1"] }, { id: "C", exemplarIndex: 2, order: ["t1", "t2", "t3", "t4"] }] });
    expect(check(input, "C")).toBe("FAIL");
  });

  it("any failing check fails the gate", () => {
    expect(analyzeElasticity(synInput({ panels: [stable.panels[0]!, stable.panels[2]!] })).indexGate.status).toBe("FAIL");
  });

  it("the transform is monotonic and bounded", () => {
    let previous = -1;
    for (let i = 0; i <= 1000; i += 1) {
      const v = indexTransform(i / 1000);
      expect(v).toBeGreaterThanOrEqual(previous);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
      previous = v;
    }
  });
});

describe("index emission", () => {
  const original = RELATIVE_INDEX_DECISION.decision;
  afterEach(() => {
    RELATIVE_INDEX_DECISION.decision = original;
  });

  it("is REJECTED_FOR_NOW: no index anywhere, even when an analysis passes its own gate", () => {
    const result = analyzeElasticity(synInput({ panels: [{ id: "A", order: ["t1", "t2", "t3", "t4"] }, { id: "A-repeat", purpose: "repeat", repeatOf: "A", order: ["t1", "t2", "t3", "t4"] }, { id: "B", exemplarIndex: 1, order: ["t1", "t2", "t3", "t4"] }] }));
    expect(result.indexGate.status).toBe("PASS");
    expect(result.indexDecision.decision).toBe("REJECTED_FOR_NOW");
    expect(JSON.stringify(result)).not.toContain("relativeElasticityIndex");
  });

  it("if APPROVED, emits the index only behind a passing gate, with relative semantics", () => {
    RELATIVE_INDEX_DECISION.decision = "APPROVED";
    const passing = analyzeElasticity(synInput({ panels: [{ id: "A", order: ["t1", "t2", "t3", "t4"] }, { id: "A-repeat", purpose: "repeat", repeatOf: "A", order: ["t1", "t2", "t3", "t4"] }, { id: "B", exemplarIndex: 1, order: ["t1", "t2", "t3", "t4"] }] }));
    const t1 = passing.territories.find((t) => t.territory.id === "t1")!;
    expect(t1.relativeElasticityIndex).toMatchObject({ value: 100, semantics: "relative_candidate_position", NOT_A_PROBABILITY: true, comparisonSet: ["t1", "t2", "t3", "t4"] });
    const failing = analyzeElasticity(synInput({ panels: [{ id: "A", order: ["t1", "t2", "t3", "t4"] }, { id: "B", exemplarIndex: 1, order: ["t4", "t3", "t2", "t1"] }] }));
    expect(failing.indexGate.status).toBe("FAIL");
    expect(JSON.stringify(failing)).not.toContain("relativeElasticityIndex");
  });

  it("the validator rejects an index that appears while the gate fails", () => {
    const result = analyzeElasticity(synInput());
    const tampered = clone(result as never) as unknown as typeof result;
    tampered.territories[0]!.relativeElasticityIndex = { value: 82, semantics: "relative_candidate_position", formula: "f", comparisonSet: ["t1", "t2", "t3", "t4"], methodologyVersion: "x", NOT_A_PROBABILITY: true };
    expect(findElasticityViolations(tampered).map((v) => v.message).join(" ")).toMatch(/without an APPROVED decision/);
  });
});
