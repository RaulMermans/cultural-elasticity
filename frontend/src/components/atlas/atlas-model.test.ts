import assert from "node:assert/strict";
import test from "node:test";
import { buildAtlas, decorativeRadii, layoutAtlas, reasonCopy } from "./atlas-model.ts";
import type { QueryResponse } from "@cultural-elasticity/shared";

const id = "00000000-0000-4000-8000-0000000000aa";

function response(overrides: Partial<QueryResponse>): QueryResponse {
  return {
    schemaVersion: "ce-query/0.1",
    queryId: id,
    state: "INVESTIGATION_COMPLETED",
    interpretation: null,
    reasons: [],
    handoff: null,
    supportedAlternative: null,
    context: null,
    investigation: null,
    territories: [],
    nextOperations: [],
    telemetry: {
      queryId: id,
      schemaVersion: "ce-query/0.1",
      intent: null,
      secondaryIntents: [],
      explicitFields: [],
      inheritedFieldNames: [],
      clarificationRequired: false,
      validationOutcome: null,
      selectedCapability: null,
      routingOutcome: "INVESTIGATION_COMPLETED",
      parentRunId: null,
      childRunId: null,
      interpretationLatencyMs: 0,
      interpretationTokens: { input: 0, output: 0 },
      interpretationCostUsd: null,
      repairAttempts: 0,
      executionHandOffStatus: "NOT_ATTEMPTED",
      errorCodes: [],
      queryChars: 1,
      queryHash: "abc",
    },
    ...overrides,
  };
}

test("a named territory that was not investigated is not shown as unsupported", () => {
  const nodes = buildAtlas([
    response({
      state: "UNSUPPORTED_OPERATION",
      territories: [{ name: "Hospitality", investigationState: "NOT_INVESTIGATED", territoryKey: null, evidenceStatus: null, analysisRoute: null }],
    }),
  ]);
  const territory = nodes.find((node) => node.kind === "territory");
  assert.equal(territory?.statusLabel, "Not yet investigated");
  assert.notEqual(territory?.tone, "unsupported");
});

test("an investigated territory with no usable evidence stays visible and is not a recommendation", () => {
  const nodes = buildAtlas([
    response({
      investigation: { runId: id, reused: false, link: null, result: null },
      territories: [{ name: "Ceramics", investigationState: "INVESTIGATED", territoryKey: "ceramics", evidenceStatus: "UNSUPPORTED", analysisRoute: "INSUFFICIENT_EVIDENCE" }],
    }),
  ]);
  const territory = nodes.find((node) => node.label === "Ceramics");
  assert.equal(territory?.statusLabel, "No usable evidence");
  assert.match(territory?.detail ?? "", /not a recommendation|no usable evidence/iu);
});

test("a cancelled investigation is interrupted rather than a finding", () => {
  const nodes = buildAtlas([
    response({
      state: "INVESTIGATION_FAILED",
      reasons: [{ code: "INVESTIGATION_CANCELLED", detail: "cancelled" }],
      territories: [{ name: "Ceramics", investigationState: "INVESTIGATED", territoryKey: "ceramics", evidenceStatus: "PARTIAL_EVIDENCE", analysisRoute: "DESCRIPTIVE_ANALYSIS" }],
    }),
  ]);
  assert.equal(nodes.find((node) => node.kind === "territory")?.tone, "interrupted");
});

test("a child hangs from the selected territory and a brand mismatch does not", () => {
  const parent = response({
    queryId: "00000000-0000-4000-8000-000000000001",
    investigation: {
      runId: "00000000-0000-4000-8000-000000000010",
      reused: false,
      link: { queryId: "00000000-0000-4000-8000-000000000001", operation: "NEW_INVESTIGATION", parentRunId: null, selectedTerritoryKey: null, inheritedBrand: null, constraints: [], reason: "new" },
      result: null,
    },
    territories: [{ name: "Hospitality", investigationState: "INVESTIGATED", territoryKey: "hospitality", evidenceStatus: "PARTIAL_EVIDENCE", analysisRoute: "DESCRIPTIVE_ANALYSIS" }],
  });
  const child = response({
    queryId: "00000000-0000-4000-8000-000000000002",
    handoff: { intent: "analyze_move", brand: "Brand", territories: ["Retreats"], operation: "REFINE_TERRITORY" },
    investigation: {
      runId: "00000000-0000-4000-8000-000000000011",
      reused: false,
      link: { queryId: "00000000-0000-4000-8000-000000000002", operation: "REFINE_TERRITORY", parentRunId: "00000000-0000-4000-8000-000000000010", selectedTerritoryKey: "hospitality", inheritedBrand: { id: "b", label: "Brand" }, constraints: [], reason: "refine" },
      result: null,
    },
    territories: [{ name: "Retreats", investigationState: "INVESTIGATED", territoryKey: "retreats", evidenceStatus: "PARTIAL_EVIDENCE", analysisRoute: "DESCRIPTIVE_ANALYSIS" }],
  });
  const nodes = buildAtlas([parent, child]);
  const retreats = nodes.find((node) => node.label === "Retreats");
  const hospitality = nodes.find((node) => node.label === "Hospitality");
  assert.equal(retreats?.parentId, hospitality?.id);
  const mismatch = response({
    ...child,
    queryId: "00000000-0000-4000-8000-000000000003",
    interpretation: {
      schemaVersion: "ce-query/0.1",
      rawQuery: "narrower",
      primaryIntent: "refine_territory",
      secondaryIntents: [],
      brand: { name: "Other", source: "INHERITED" },
      brandsNamed: [],
      territories: [],
      references: {},
      constraints: [],
      unresolvedReferences: [],
      systemDirectives: [],
      confidence: "HIGH",
      disposition: "EXECUTABLE",
      unsupportedCapabilities: [],
      interpretationWarnings: ["INHERITED_BRAND_MISMATCH: different brand"],
      reasonCodes: [],
      interpreter: { kind: "scripted" },
    },
  });
  const detached = buildAtlas([parent, mismatch]).find((node) => node.label === "Retreats");
  assert.equal(detached?.parentId?.startsWith("brand:"), true);
});

test("completed nodes keep their place when a branch is added", () => {
  const first = [{ id: "a", parentId: null }, { id: "b", parentId: "a" }];
  const placed = layoutAtlas(first, new Map());
  const next = layoutAtlas([...first, { id: "c", parentId: "a" }], placed);
  assert.deepEqual(next.get("a"), placed.get("a"));
  assert.deepEqual(next.get("b"), placed.get("b"));
  assert.ok((next.get("c")?.y ?? 0) > (next.get("b")?.y ?? 0));
});

test("silhouettes are stable decoration and competitor copy stays non-equivalent", () => {
  assert.equal(decorativeRadii("ceramics"), decorativeRadii("ceramics"));
  assert.notEqual(decorativeRadii("ceramics"), decorativeRadii("hospitality"));
  assert.match(reasonCopy("UNSUPPORTED_OPERATION", "compare_brands"), /not available yet/iu);
  assert.match(reasonCopy("UNSUPPORTED_OPERATION", "compare_brands"), /different question/iu);
});
