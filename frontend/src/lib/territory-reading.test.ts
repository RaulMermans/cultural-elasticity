/** SYNTHETIC result: the plain reading restates the computed class, ranks and evidence and adds nothing. */
import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRunResponse } from "@cultural-elasticity/shared";
import { territoryReading } from "./territory-reading.ts";

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
