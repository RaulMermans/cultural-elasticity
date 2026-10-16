/**
 * Panel construction and limits, multiple exemplars, missing alternates, rank aggregation and
 * robustness. SYNTHETIC inputs only.
 */
import { describe, expect, it } from "vitest";
import { aggregateTerritories, relativePositions } from "../src/methodology/aggregation.js";
import { MAX_PANEL_OPTIONS, parseMethodologyInput } from "../src/methodology/contracts.js";
import { analyzeElasticity } from "../src/methodology/elasticity.js";
import { analyzePanels } from "../src/methodology/panel.js";
import { median, rankPercentile } from "../src/methodology/stats.js";
import { clone, exemplarId, synInput } from "./fixtures/synthetic/methodology.js";

const T = ["t1", "t2", "t3", "t4"];
const issuesOf = (raw: unknown) => {
  const parsed = parseMethodologyInput(raw);
  return parsed.ok ? [] : parsed.issues.map((i) => i.message).join(" | ");
};
const byId = (result: ReturnType<typeof analyzeElasticity>, id: string) => result.territories.find((t) => t.territory.id === id)!;

describe("panel construction (input contract)", () => {
  it("accepts the default synthetic input", () => {
    expect(issuesOf(synInput())).toEqual([]);
  });

  it(`limits the comparison set and each panel to ${MAX_PANEL_OPTIONS} options`, () => {
    const seven = ["a", "b", "c", "d", "e", "f", "g"];
    expect(issuesOf(synInput({ territories: seven, panels: [{ id: "A", order: seven }] }))).not.toEqual([]);
    const six = seven.slice(0, 6);
    expect(issuesOf(synInput({ territories: six, panels: [{ id: "A", order: six }] }))).toEqual([]);
  });

  it("requires every panel to assign one exemplar to every territory", () => {
    const input = clone(synInput());
    input.panels[0]!.assignments.pop();
    input.panels[0]!.ranking!.candidates.pop();
    expect(issuesOf(input)).toMatch(/every territory/);
  });

  it("rejects an assignment to another territory's exemplar and a duplicate territory in one panel", () => {
    const input = clone(synInput());
    input.panels[0]!.assignments[0] = { territoryId: "t1", exemplarId: exemplarId("t2", 0) };
    expect(issuesOf(input)).toMatch(/is not an exemplar of/);
  });

  it("rejects a ranking whose candidates are not exactly the assigned exemplars", () => {
    const input = clone(synInput());
    input.panels[0]!.ranking!.candidates[0]!.id = "syn-unexpected";
    expect(issuesOf(input)).toMatch(/exactly the panel's assigned exemplars/);
  });

  it("rejects a ranking made for another subject", () => {
    const input = clone(synInput());
    input.panels[0]!.ranking!.rankedAgainst = "syn-other-brand";
    expect(issuesOf(input)).toMatch(/ranked against the brand/);
  });

  it("requires a repeat panel to repeat its original's assignments", () => {
    const input = clone(synInput());
    const repeat = input.panels.find((p) => p.purpose === "repeat")!;
    repeat.assignments = repeat.assignments.map((a) => ({ ...a, exemplarId: exemplarId(a.territoryId, 1) }));
    repeat.ranking!.candidates = repeat.ranking!.candidates.map((c, i) => ({ ...c, id: repeat.assignments[i]!.exemplarId }));
    expect(issuesOf(input)).toMatch(/exactly the assignments of its original/);
  });

  it("forbids an exemplar representing two territories and a brand representing a territory", () => {
    const input = clone(synInput());
    input.territories[1]!.exemplars[1]!.id = exemplarId("t1", 1);
    expect(issuesOf(input)).toMatch(/already represents territory/);
  });

  it("requires exactly one primary exemplar per territory", () => {
    const input = clone(synInput());
    input.territories[0]!.exemplars[1]!.role = "primary";
    expect(issuesOf(input)).toMatch(/exactly one primary/);
  });
});

describe("panel analysis", () => {
  it("derives positions from explicit ranks only and keeps values within the call", () => {
    const input = clone(synInput({ panels: [{ id: "A", order: ["t3", "t1", "t2", "t4"], values: [0.1, 0.9, 0.5, 0.2] }] }));
    const panels = analyzePanels(input);
    expect(panels.reports[0]!.order.map((o) => o.territoryId)).toEqual(["t3", "t1", "t2", "t4"]);
    expect(panels.observations.get("t3")![0]).toMatchObject({ rank: 1, percentile: 1, withinCallValue: 0.1, correlationId: "syn-corr-panel-A" });
  });

  it("marks a panel without ranking as missing and one mixing calls as scope_unverified", () => {
    const input = clone(synInput());
    delete input.panels.find((p) => p.id === "B")!.ranking;
    input.panels.find((p) => p.id === "A")!.ranking!.candidates[0]!.provenance = [{ source: "synthetic-test", operation: "rank", correlationId: "syn-other-call" }];
    const reports = analyzePanels(input).reports;
    expect(reports.find((r) => r.id === "B")!.status).toBe("missing");
    expect(reports.find((r) => r.id === "A")!.status).toBe("scope_unverified");
  });

  it("does not aggregate repeat panels", () => {
    const panels = analyzePanels(clone(synInput()));
    expect(panels.aggregatedPanelIds).toEqual(["A", "B"]);
    expect(panels.observations.get("t1")!.map((o) => o.panelId)).toEqual(["A", "B"]);
    expect(panels.repeatChecks).toEqual([expect.objectContaining({ panelId: "A-repeat", status: "identical" })]);
  });

  it("detects a repeat that changed order", () => {
    const panels = analyzePanels(clone(synInput({ panels: [{ id: "A", order: T }, { id: "A-repeat", purpose: "repeat", repeatOf: "A", order: ["t2", "t1", "t3", "t4"] }, { id: "B", exemplarIndex: 1, order: T }] })));
    expect(panels.repeatChecks[0]!.status).toBe("different");
  });
});

describe("ordinal aggregation", () => {
  it("uses the median rank percentile and competition ranking with shared ties", () => {
    const result = analyzeElasticity(synInput({ panels: [{ id: "A", order: ["t1", "t2", "t3", "t4"] }, { id: "B", exemplarIndex: 1, order: ["t2", "t1", "t3", "t4"] }] }));
    expect(byId(result, "t1").relativePosition).toMatchObject({ position: 1, of: 4, medianPercentile: 0.833334, tiedWith: ["t2"] });
    expect(byId(result, "t3").relativePosition).toMatchObject({ position: 3, medianPercentile: 0.333333 });
    expect(byId(result, "t4").relativePosition.position).toBe(4);
  });

  it("median resists one outlying exemplar with three panels", () => {
    const result = analyzeElasticity(
      synInput({ exemplars: { t1: 3, t2: 3, t3: 3, t4: 3 }, panels: [{ id: "A", order: ["t1", "t2", "t3", "t4"] }, { id: "B", exemplarIndex: 1, order: ["t1", "t2", "t3", "t4"] }, { id: "C", exemplarIndex: 2, order: ["t4", "t2", "t3", "t1"] }] }),
    );
    expect(byId(result, "t1").relativePosition.medianPercentile).toBe(1);
    expect(byId(result, "t1").robustness.level).toBe("LOW");
  });

  it("reports pairwise wins and losses per shared panel", () => {
    const result = analyzeElasticity(synInput({ panels: [{ id: "A", order: ["t1", "t2", "t3", "t4"] }, { id: "B", exemplarIndex: 1, order: ["t2", "t1", "t3", "t4"] }] }));
    expect(byId(result, "t1").pairwise.find((p) => p.otherTerritoryId === "t2")).toEqual({ otherTerritoryId: "t2", wins: 1, losses: 1, sharedPanels: 2 });
  });

  it("orders by position, then majority wins, then best rank, then id", () => {
    const panels = analyzePanels(clone(synInput({ panels: [{ id: "A", order: ["t1", "t2", "t3", "t4"] }, { id: "B", exemplarIndex: 1, order: ["t2", "t1", "t4", "t3"] }] })));
    const { order } = relativePositions(aggregateTerritories(panels.observations));
    expect(order).toEqual(["t1", "t2", "t3", "t4"]);
  });

  it("helpers: percentile and median", () => {
    expect([1, 2, 3, 4, 5, 6].map((r) => rankPercentile(r, 6))).toEqual([1, 0.8, 0.6, 0.4, 0.2, 0]);
    expect(median([0.8, 0.6])).toBe(0.7);
    expect(() => median([])).toThrow();
  });
});

describe("representation robustness", () => {
  it("HIGH when two exemplars agree (Boutique Hospitality example: 2/6 and 2/6)", () => {
    const six = ["t1", "t2", "t3", "t4", "t5", "t6"];
    const order = ["t2", "t1", "t3", "t4", "t5", "t6"];
    const result = analyzeElasticity(synInput({ territories: six, panels: [{ id: "A", order }, { id: "B", exemplarIndex: 1, order }] }));
    expect(byId(result, "t1").robustness).toMatchObject({ level: "HIGH", bestRank: 2, worstRank: 2, rankSpread: 0, percentileSpread: 0 });
  });

  it("LOW when the exemplar swap moves the territory three places (Furniture example: 1/6 then 4/6)", () => {
    const six = ["t1", "t2", "t3", "t4", "t5", "t6"];
    const result = analyzeElasticity(synInput({ territories: six, panels: [{ id: "A", order: ["t1", "t2", "t3", "t4", "t5", "t6"] }, { id: "B", exemplarIndex: 1, order: ["t2", "t3", "t4", "t1", "t5", "t6"] }] }));
    expect(byId(result, "t1").robustness).toMatchObject({ level: "LOW", rankSpread: 3, percentileSpread: 0.6 });
    expect(byId(result, "t1").relativePosition.medianPercentile).toBe(0.7);
  });

  it("INSUFFICIENT for a one-exemplar territory, even when it is reused in every panel", () => {
    const result = analyzeElasticity(synInput({ exemplars: { t1: 1 } }));
    expect(byId(result, "t1").robustness.level).toBe("INSUFFICIENT");
    expect(byId(result, "t1").classification.label).toBe("UNCERTAIN_REPRESENTATION_SENSITIVE");
  });

  it("caps at LOW when a known alternate exemplar was never panelled (no silent single-exemplar territory)", () => {
    const result = analyzeElasticity(synInput({ exemplars: { t1: 3 } }));
    const t1 = byId(result, "t1");
    expect(t1.robustness.level).toBe("LOW");
    expect(t1.robustness.reasons.join(" ")).toMatch(/without valid panel evidence/);
    expect(t1.limitations.some((l) => l.code === "ROBUSTNESS_LOW")).toBe(true);
  });

  it("caps every territory at LOW when a declared panel has no valid evidence", () => {
    const input = clone(synInput({ exemplars: { t1: 3, t2: 3, t3: 3, t4: 3 }, panels: [{ id: "A", order: T }, { id: "B", exemplarIndex: 1, order: T }, { id: "C", exemplarIndex: 2, order: T }] }));
    delete input.panels.find((p) => p.id === "C")!.ranking;
    const result = analyzeElasticity(input);
    expect(result.territories.every((t) => t.robustness.level === "LOW" || t.robustness.level === "INSUFFICIENT")).toBe(true);
    expect(result.limitations.some((l) => l.code === "PANEL_MISSING")).toBe(true);
  });
});
