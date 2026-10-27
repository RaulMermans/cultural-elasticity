/**
 * Sprint 9I: outcome verification, cross-domain separation and evidence labels.
 * Runtime cases use the SYNTHETIC world (SYN- ids). The recorded Loewe cases read real stored live evidence
 * offline and make no provider call.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { projectCulturalConnections, type AgentAnalysisResult, type AnyBrandBaselineResult } from "@cultural-elasticity/shared";
import { projectComparativeStrategicReport, validateComparativeOutcome, type ComparativePlan } from "../src/agent/comparative-bridge.js";
import { runtime } from "./fixtures/synthetic/agent.js";

const PLAN = (target: string, references: string[]): ComparativePlan => ({
  brandId: "SYN-BR-3001",
  brandLabel: "Larkspur Velo",
  target: { label: target, conceptId: null, entityType: "place" },
  references: references.map((label) => ({ id: label, label, conceptId: null, entityType: "place", typeBasis: "VALIDATED_REPRESENTATION" })),
});

async function compareRun(territories: string[], faults: Parameters<typeof runtime>[1] = [], maxQlooCalls?: number) {
  const { runtime: rt } = runtime(undefined, faults);
  const result = await rt.run({ userQuery: "SYNTHETIC comparison", intent: "compare_territories", brand: "Larkspur Velo", territories, ...(maxQlooCalls ? { limits: { maxQlooCalls } } : {}) });
  if (result.status === "NEEDS_INPUT") throw new Error("unexpected NEEDS_INPUT");
  return result;
}

describe("SYNTHETIC Sprint 9I outcome verification", () => {
  it("4: a cross-domain territory informs the result but never receives a cross-type position", async () => {
    const result = await compareRun(["Gravel Riding", "Alpine Hiking", "Espresso"]);
    const espresso = result.territories.find((t) => t.label === "Espresso")!;
    expect(espresso.representation.entityType).toBe("brand");
    expect(espresso.relativePosition).toBeNull();
    const verdict = validateComparativeOutcome(PLAN("Gravel Riding", ["Alpine Hiking", "Espresso"]), result);
    expect(verdict.checks.find((c) => c.code === "SINGLE_RANKING_TYPE")?.passed).toBe(true);
    const report = projectComparativeStrategicReport(result, PLAN("Gravel Riding", ["Alpine Hiking", "Espresso"]), verdict);
    const alt = report.alternativesEvaluated.find((a) => a.name === "Espresso")!;
    expect(alt).toMatchObject({ entityType: "brand", relativePosition: null, classification: null });
    expect(alt.comparisonLimitation).toMatch(/qualitative evidence only/u);
    // Every ranked territory shares the target's type.
    expect(report.alternativesEvaluated.filter((a) => a.relativePosition).every((a) => a.entityType === "place")).toBe(true);
    const connections = projectCulturalConnections({ brand: { id: "SYN-BR-3001", name: "Larkspur Velo" }, evidenceOrigin: result.evidenceOrigin, runs: [result] });
    expect(connections.domains).toEqual(expect.arrayContaining(["place", "brand"]));
    expect(connections.relationships.every((r) => r.rankable === false)).toBe(true);
  });

  it("9: a run that exhausts its Qloo budget before ranking shows no invented position", async () => {
    const result = await compareRun(["Gravel Riding", "Alpine Hiking", "Mountain Town"], [], 6);
    const verdict = validateComparativeOutcome(PLAN("Gravel Riding", ["Alpine Hiking", "Mountain Town"]), result);
    expect(verdict.outcome).not.toBe("RELATIVE_POSITION_ESTABLISHED");
    const report = projectComparativeStrategicReport(result, PLAN("Gravel Riding", ["Alpine Hiking", "Mountain Town"]), verdict);
    expect(report.targetTerritory.relativePosition).toBeNull();
    expect(report.targetTerritory.provisionalClassification).toBeNull();
  });

  it("9: an uncertain rank outcome (non-retryable error) is never evidence", async () => {
    const result = await compareRun(["Gravel Riding", "Alpine Hiking", "Mountain Town"], [{ operation: "rank", status: "error", code: "SYNTHETIC_TIMEOUT", retryable: false, times: 10 }]);
    // The runtime reports an empty panel as { position: null, of: 0 }: no territory holds a numeric position.
    expect(result.territories.every((t) => t.relativePosition?.position == null)).toBe(true);
    const report = projectComparativeStrategicReport(result, PLAN("Gravel Riding", ["Alpine Hiking", "Mountain Town"]), validateComparativeOutcome(PLAN("Gravel Riding", ["Alpine Hiking", "Mountain Town"]), result));
    expect(report.targetTerritory.relativePosition).toBeNull();
    expect(report.alternativesEvaluated.every((a) => a.relativePosition === null)).toBe(true);
    const verdict = validateComparativeOutcome(PLAN("Gravel Riding", ["Alpine Hiking", "Mountain Town"]), result);
    expect(verdict.outcome).toBe("NO_RELATIVE_POSITION");
  });

  it("11: a tampered result (concept drift, brand change, classification without a position) shows no ranking", async () => {
    const result = await compareRun(["Gravel Riding", "Alpine Hiking", "Mountain Town"]);
    const plan: ComparativePlan = { ...PLAN("Gravel Riding", ["Alpine Hiking", "Mountain Town"]), target: { label: "Gravel Riding", conceptId: "urn:tag:activity_type:syn:gravel_riding", entityType: "place" } };
    expect(validateComparativeOutcome(plan, result).outcome).toBe("RELATIVE_POSITION_ESTABLISHED");

    const drifted = structuredClone(result);
    drifted.territories.find((t) => t.label === "Gravel Riding")!.resolvedConcept = { id: "urn:tag:syn:other", label: "Other", type: "tag" };
    const driftVerdict = validateComparativeOutcome(plan, drifted);
    expect(driftVerdict.outcome).toBe("INTEGRITY_FAILED");
    const driftReport = projectComparativeStrategicReport(drifted, plan, driftVerdict);
    expect(driftReport.targetTerritory.relativePosition).toBeNull();
    expect(driftReport.alternativesEvaluated.every((a) => a.relativePosition === null && a.classification === null)).toBe(true);

    const otherBrand = structuredClone(result);
    otherBrand.brand = { ...otherBrand.brand!, id: "SYN-BR-0000" };
    expect(validateComparativeOutcome(plan, otherBrand).outcome).toBe("INTEGRITY_FAILED");

    const classedOnly = structuredClone(result);
    const alpine = classedOnly.territories.find((t) => t.label === "Alpine Hiking")!;
    alpine.relativePosition = { position: null, of: 0, medianPercentile: null, medianRank: null };
    expect(validateComparativeOutcome(plan, classedOnly).checks.find((c) => c.code === "CLASSIFICATION_HAS_POSITION")?.passed).toBe(false);

    expect(validateComparativeOutcome(plan, null).outcome).toBe("NOT_COMPLETED");
    expect(validateComparativeOutcome(plan, { ...result, status: "FAILED" }).outcome).toBe("NOT_COMPLETED");
  });

  it("12/13: labels pass through unchanged and only a validated interpretation is shown", async () => {
    const result = await compareRun(["Gravel Riding", "Alpine Hiking", "Mountain Town"]);
    const plan = PLAN("Gravel Riding", ["Alpine Hiking", "Mountain Town"]);
    expect(projectComparativeStrategicReport(result, plan, validateComparativeOutcome(plan, result)).evidenceOrigin).toBe("synthetic");
    const recorded = { ...structuredClone(result), evidenceOrigin: "recorded" as const };
    expect(projectComparativeStrategicReport(recorded, plan, validateComparativeOutcome(plan, recorded)).evidenceOrigin).toBe("recorded");
    const rejected = structuredClone(result);
    rejected.summary = { ...rejected.summary, claimValidation: { passed: false, violations: ["SYNTHETIC violation"] } };
    expect(projectComparativeStrategicReport(rejected, plan, validateComparativeOutcome(plan, rejected)).interpretation).toBeNull();
  });
});

describe("RECORDED live Loewe evidence: cross-domain relationships (offline, no provider call)", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const baseline = (JSON.parse(fs.readFileSync(path.join(root, "frontend/src/demo/recorded-baselines.json"), "utf8")) as { items: { key: string; result: AnyBrandBaselineResult }[] }).items.find((item) => item.key === "loewe")!.result;
  const investigation = JSON.parse(fs.readFileSync(path.join(root, "docs/sprint-9g/evidence/loewe-boutique-hospitality.live.json"), "utf8")) as AgentAnalysisResult;

  it("keeps direct observations, derived overlaps and interpretations apart, each with its Qloo source", () => {
    expect(investigation.evidenceOrigin).toBe("live");
    const map = projectCulturalConnections({ brand: { id: baseline.brand.qlooId, name: baseline.brand.name }, evidenceOrigin: "recorded", baseline, runs: [investigation] });
    expect(map.domains).toEqual(expect.arrayContaining(["artist", "place", "movie", "book"]));
    const direct = map.relationships.filter((r) => r.kind === "DIRECT_QLOO_OBSERVATION");
    expect(direct.length).toBeGreaterThan(0);
    expect(direct.every((r) => r.correlationIds.every((id) => id.startsWith("mcp-")))).toBe(true);
    // Loewe → Boutique Hospitality (Qloo tag) → member hotels, and Loewe-conditioned places for that tag.
    expect(direct.some((r) => r.from.label === "Boutique Hospitality" && r.to.label === "Casa Art Hotel")).toBe(true);
    expect(direct.some((r) => r.from.kind === "brand" && r.to.label === "J.K. Place Capri")).toBe(true);
    // The recorded investigation found no shared non-operational tag: reported, not hidden or invented.
    expect(map.relationships.some((r) => r.kind === "DERIVED_PROFILE_OVERLAP")).toBe(false);
    expect(map.notes.join(" ")).toMatch(/No cultural tag is shared by the Loewe profile and the Boutique hospitality exemplar profiles/u);
    expect(map.relationships.every((r) => r.rankable === false)).toBe(true);
  });
});
