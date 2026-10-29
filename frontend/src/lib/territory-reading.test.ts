/** SYNTHETIC result: the plain reading restates the computed class, ranks and evidence and adds nothing. */
import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRunResponse } from "@cultural-elasticity/shared";
import { readableClassCodes, territoryReading } from "./territory-reading.ts";

const territory = (key: string, position: number | null, extra: Record<string, unknown> = {}) => ({
  key, label: `SYN ${key}`, role: "candidate", representation: { exemplars: [{ id: "e", label: `SYN example ${key}`, type: "t", role: "primary" }] },
  comparisonSet: position == null ? null : { territoryKeys: ["a", "b", "c"], labels: [], methodologyVersion: "v" },
  relativePosition: position == null ? null : { position, of: 3, medianPercentile: null, medianRank: null },
  robustness: null, coherence: null, conditionedEvidence: null, classification: null, resolvedConcept: null, keyEvidence: [], limitations: [], ...extra,
});

const result = (territories: unknown[]) => ({ status: "COMPLETE", territories, layers: undefined }) as unknown as AgentRunResponse;

test("a compared territory reads its class, its rank among the set and the evidence behind it", () => {
  const reading = territoryReading(result([
    territory("a", 2, { classification: { label: "CREDIBLE_STRETCH" }, robustness: { level: "HIGH" }, coherence: { consistentlyShared: [{ id: "s", label: "SYN shared" }] }, conditionedEvidence: { topEntities: [{ label: "SYN match", rank: 1 }] } }),
    territory("b", 1), territory("c", 3),
  ]), "a", "SYN BRAND")!;
  assert.equal(reading.fit!.label, "Credible stretch");
  assert.equal(reading.fit!.onScale, "CREDIBLE_STRETCH");
  assert.deepEqual(reading.compared.map((item) => [item.position, item.name, item.current]), [[1, "SYN b", false], [2, "SYN a", true], [3, "SYN c", false]]);
  assert.equal(reading.steadiness!.steady, true);
  assert.deepEqual([reading.sharedTastes, reading.closestMatches, reading.examples], [["SYN shared"], ["SYN match"], ["SYN example a"]]);
});

test("an unranked territory has no fit, says it was not compared, and keeps unknown codes technical only", () => {
  const reading = territoryReading(result([territory("a", null, { limitations: [{ code: "SYN_UNKNOWN_CODE", detail: "SYN raw detail" }] })]), null, "B")!;
  assert.equal(reading.fit, null);
  assert.equal(reading.steadiness, null);
  assert.match(reading.unknowns[0]!, /wasn't ranked/u);
  assert.ok(!reading.unknowns.includes("SYN raw detail"));
  assert.ok(reading.technical.includes("SYN raw detail"));
});

test("a representation-sensitive class is named but not placed on the fit scale", () => {
  const reading = territoryReading(result([territory("a", 3, { classification: { label: "UNCERTAIN_REPRESENTATION_SENSITIVE" }, robustness: { level: "LOW" } })]), "a", "B")!;
  assert.equal(reading.fit!.label, "Not settled");
  assert.equal(reading.fit!.onScale, null);
  assert.equal(reading.steadiness!.steady, false);
});

test("Sprint 9M: class codes in the agent's write-up read as their plain labels, and nothing else changes", () => {
  assert.equal(readableClassCodes("Provisionally classed as CREDIBLE_STRETCH relative to this set."), "Provisionally classed as “credible stretch” relative to this set.");
  assert.equal(readableClassCodes("UNCERTAIN_REPRESENTATION_SENSITIVE and CULTURAL_BREAK"), "“not settled” and “cultural break”");
  assert.equal(readableClassCodes("No code here, 3 of 4."), "No code here, 3 of 4.");
});

test("Sprint 10A: a discovered direction says why it surfaced, labels the agent's interpretation, and shows no raw codes", () => {
  const opportunity = {
    territoryKey: "a", direction: "SYN a", source: "agent_hypothesis", status: "QLOO_SUPPORTED", blocker: null,
    surfacedBy: [{ id: "SYN-AR-1", label: "SYN artist", relation: "SEED_ENTITY_TAG", correlationIds: ["syn-1"] }, { id: "SYN-BR-1", label: "SYN brand", relation: "RELATED_ENTITY_TAG", correlationIds: ["syn-2"] }],
    facet: "genre:music", domainRelation: "OUTSIDE_BRAND_PROFILE_FACETS", interpretation: "SYN the artists may share a scene",
    unknowns: ["SYN unknown"], nextInvestigation: "SYN next step",
  };
  const done = { status: "COMPLETE", territories: [territory("a", null)], layers: undefined, comparisonSetConstruction: { opportunities: [opportunity] } } as unknown as AgentRunResponse;
  const surfaced = territoryReading(done, "a", "SYN BRAND")!.surfaced!;
  assert.equal(surfaced.status, "Supported by Qloo, not measured");
  assert.deepEqual(surfaced.signals, ["SYN artist (returned for SYN BRAND in the brand scan)", "SYN brand (a brand Qloo relates to SYN BRAND)"]);
  assert.match(surfaced.domain!, /different kind of Qloo tag/u);
  assert.equal(surfaced.interpretation, "SYN the artists may share a scene");
  assert.equal(surfaced.next, "SYN next step");
  assert.doesNotMatch(JSON.stringify({ ...surfaced, interpretation: null }), /QLOO_SUPPORTED|SEED_ENTITY_TAG|OUTSIDE_BRAND/u);
  const blocked = territoryReading({ ...done, comparisonSetConstruction: { opportunities: [{ ...opportunity, status: "NOT_ESTABLISHED", blocker: "INCONCLUSIVE" }] } } as unknown as AgentRunResponse, "a", "B")!.surfaced!;
  assert.equal(blocked.status, "Not settled");
  assert.equal(territoryReading(result([territory("a", null)]), "a", "B")!.surfaced, null);
});
