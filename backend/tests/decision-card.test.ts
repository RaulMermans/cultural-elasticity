/**
 * Sprint 9N Strategic Decision Card (decision-card/v1). SYNTHETIC result objects built in the test; recorded live
 * artefacts (evals/qloo-value/artifacts, stored by earlier sprints) are read as run, never modified.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decisionCard, decisionCardViolations, type AgentAnalysisResult, type AgentTerritoryResult, type ComparisonFeasibility } from "@cultural-elasticity/shared";

const ARTIFACTS = fileURLToPath(new URL("../../evals/qloo-value/artifacts/", import.meta.url));

function territory(over: Partial<AgentTerritoryResult> = {}): AgentTerritoryResult {
  return {
    key: "syn_target",
    label: "Synthetic Target",
    role: "target",
    origin: "user",
    resolvedConcept: { id: "urn:tag:keyword:syn:target", label: "Synthetic Target", type: "urn:tag:keyword:syn" },
    representation: { strategy: "TAG_DERIVED_ENTITY_PANEL", entityType: "place", exemplars: [{ id: "SYN-1", label: "Example One", type: "place" }], rejectedExemplars: [], failure: null, summary: "" },
    analysisRoute: "PARTIAL_CULTURAL_ANALYSIS",
    comparisonSet: null,
    relativePosition: null,
    robustness: null,
    coherence: null,
    conditionedEvidence: null,
    evidenceQuality: null,
    classification: null,
    limitations: [],
    keyEvidence: [],
    ...over,
  } as unknown as AgentTerritoryResult;
}

function result(t: AgentTerritoryResult[], feasibility: ComparisonFeasibility | null = null): AgentAnalysisResult {
  return { status: "COMPLETE", brand: { id: "SYN-BR", label: "Synthetic Brand", type: "brand", resolution: "confirmed" }, territories: t, evidenceOrigin: "synthetic", comparisonFeasibility: feasibility } as unknown as AgentAnalysisResult;
}

function feasibility(code: NonNullable<ComparisonFeasibility["blocker"]>["code"], repeat: ComparisonFeasibility["repeat"]): ComparisonFeasibility {
  return { rulesVersion: "comparison-feasibility/v1", iteration: 5, status: "INFEASIBLE", target: { key: "syn_target", label: "Synthetic Target", anchored: true, represented: true, entityType: "place", validExemplars: 1 }, compatibleEntityType: "place", meaningfulTerritories: 1, requiredTerritories: 3, missingReferences: 2, pendingReferences: [], candidates: { meaningful: 0, probedWithMembers: 0, typeEvidenced: 0, unprobed: 0 }, referenceProbes: { made: 4, empty: 4, limit: 4 }, capacity: { turnsLeft: 3, qlooCallsLeft: 10, turnsNeeded: 3, callsNeeded: 8 }, blocker: { code, detail: "" }, nextAction: null, stopReasons: [], repeat };
}

const measured = (cls: string, level: string) => {
  const a = territory({ analysisRoute: "FULL_RELATIVE_ANALYSIS", classification: { label: cls, status: "PROVISIONAL", reasons: [] }, relativePosition: { position: 1, of: 3, medianPercentile: null, medianRank: null }, robustness: { level, percentileSpread: null, panelledExemplars: 3, declaredExemplars: 3, reasons: [] }, comparisonSet: { territoryKeys: ["syn_target", "syn_b", "syn_c"], labels: ["Synthetic Target", "Ref B", "Ref C"], methodologyVersion: "v" } } as never);
  return result([a, territory({ key: "syn_b", label: "Ref B", role: "reference" }), territory({ key: "syn_c", label: "Ref C", role: "reference" })]);
};

describe("decision card implications", () => {
  it("maps class and robustness to the four interpretations, never to a forecast", () => {
    expect(decisionCard(measured("CREDIBLE_STRETCH", "HIGH"), "syn_target")!.implication.code).toBe("SUPPORTED_FOR_EXPLORATION");
    expect(decisionCard(measured("CULTURAL_BREAK", "MEDIUM"), "syn_target")!.implication.code).toBe("RELATIVE_FIT_NOT_SUPPORTED");
    expect(decisionCard(measured("NATURAL_ADJACENCY", "LOW"), "syn_target")!.implication.code).toBe("PRELIMINARY_HYPOTHESIS");
    expect(decisionCard(measured("INSUFFICIENT_EVIDENCE", "HIGH"), "syn_target")!.implication.code).toBe("INCONCLUSIVE");
    expect(decisionCard(result([territory()]), "syn_target")!.implication.code).toBe("INCONCLUSIVE");
  });

  it("property: across routes, classes and robustness, an unmeasured card never claims support or names a class", () => {
    for (const route of ["FULL_RELATIVE_ANALYSIS", "PARTIAL_CULTURAL_ANALYSIS", "DESCRIPTIVE_ANALYSIS", "INSUFFICIENT_EVIDENCE"])
      for (const cls of [null, "NATURAL_ADJACENCY", "CREDIBLE_STRETCH", "CULTURAL_BREAK", "UNCERTAIN_REPRESENTATION_SENSITIVE"])
        for (const level of [null, "HIGH", "MEDIUM", "LOW", "INSUFFICIENT"])
          for (const position of [null, 2]) {
            const t = territory({ analysisRoute: route, classification: cls ? { label: cls, status: "PROVISIONAL", reasons: [] } : null, robustness: level ? { level, percentileSpread: null, panelledExemplars: 2, declaredExemplars: 2, reasons: [] } : null, relativePosition: position ? { position, of: 3, medianPercentile: null, medianRank: null } : null } as never);
            const r = result([t]);
            const card = decisionCard(r, "syn_target")!;
            expect(card.measured).toBe(route === "FULL_RELATIVE_ANALYSIS" && cls !== null && position !== null);
            if (!card.measured) {
              expect(card.implication.code === "SUPPORTED_FOR_EXPLORATION").toBe(false);
              expect(card.finding).not.toMatch(/natural fit|credible stretch|cultural break/iu);
              expect(card.uncertain.length).toBeGreaterThan(1);
            }
            expect(card.nextActions.length).toBeGreaterThan(0);
            expect(decisionCardViolations(card, r)).toEqual([]);
          }
  });
});

describe("decision card next actions (repeat risk)", () => {
  it("never suggests asking again when Qloo's evidence blocked it, and never names unvalidated directions", () => {
    const r = result([territory()], feasibility("THIN_TARGET_PANEL", "LIKELY_REPEATS"));
    const card = decisionCard(r, "syn_target")!;
    expect(card.nextActions.map((a) => a.kind)).not.toContain("RUN_AGAIN");
    expect(card.nextActions.map((a) => a.kind)).not.toContain("COMPARE_WITH_NAMED");
    expect(card.nextActions.map((a) => a.kind)).not.toContain("MEASURE_WITH_COMPARISON");
    expect(card.comparative.text).toMatch(/Only 1 example passed validation/u);
    expect(card.repeat).toBe("LIKELY_REPEATS");
    expect(decisionCardViolations(card, r)).toEqual([]);
  });

  it("names a comparison only with references a validated source supplied", () => {
    const t = territory({ conditionedEvidence: { support: "SUPPORTED", entityCount: 12, topEntities: [{ label: "Example One", rank: 1 }], correlationId: "SYN-C1" }, coherence: { rawSharedMedian: 2, filteredSharedMedian: 2, filteredBand: "SPARSE", exemplarsCompared: 1, consistentlyShared: [{ id: "urn:tag:keyword:syn:other", label: "Other Signal" }] } } as never);
    const r = result([t], feasibility("NO_MEANINGFUL_REFERENCE_CANDIDATES", "MAY_CHANGE"));
    const card = decisionCard(r, "syn_target", { validatedReferences: ["Ref B", "Ref C"] })!;
    expect(card.conclusion?.outcome).toBe("OBSERVED_ASSOCIATION");
    expect(card.nextActions[0]).toMatchObject({ kind: "COMPARE_WITH_NAMED", question: "Compare Synthetic Target with Ref B and Ref C" });
    expect(decisionCardViolations(card, r, { validatedReferences: ["Ref B", "Ref C"] })).toEqual([]);
    // The same card checked against a context that never validated those names is a violation.
    expect(decisionCardViolations(card, r).join()).toMatch(/no validated source/u);
  });

  it("suggests running again only when the run's own budget blocked it", () => {
    const card = decisionCard(result([territory()], feasibility("QLOO_BUDGET", "MAY_CHANGE")), "syn_target")!;
    expect(card.nextActions[0]?.kind).toBe("RUN_AGAIN");
  });

  it("the violation check catches commercial wording, raw codes and invented numbers", () => {
    const r = measured("CREDIBLE_STRETCH", "HIGH");
    const card = decisionCard(r, "syn_target")!;
    expect(decisionCardViolations({ ...card, supports: ["This will increase sales."] }, r)[0]).toMatch(/sales/u);
    expect(decisionCardViolations({ ...card, supports: ["Status THIN_TARGET_PANEL."] }, r)[0]).toMatch(/THIN_TARGET_PANEL/u);
    expect(decisionCardViolations({ ...card, supports: ["It ranked 7 of 9."] }, r).join()).toMatch(/number 7/u);
  });
});

describe("decision card over recorded live results (as run)", () => {
  it("projects every stored live result without violations", () => {
    const files = readdirSync(ARTIFACTS).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const r = JSON.parse(readFileSync(ARTIFACTS + f, "utf8")) as AgentAnalysisResult;
      for (const t of r.territories) {
        const card = decisionCard(r, t.key)!;
        expect(decisionCardViolations(card, r), `${f} ${t.key}`).toEqual([]);
        if (t.analysisRoute !== "FULL_RELATIVE_ANALYSIS") expect(card.measured).toBe(false);
      }
    }
  });
});
