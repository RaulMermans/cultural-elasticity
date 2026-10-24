import assert from "node:assert/strict";
import test from "node:test";
import { atlasExtent, boxOf, buildAtlas, layoutAtlas, overlappingPairs, reasonCopy, shortStatus } from "./atlas-model.ts";
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

test("duplicate display names stay separate nodes", () => {
  const nodes = buildAtlas([
    response({
      investigation: { runId: id, reused: false, link: null, result: null },
      territories: [
        { name: "Coast", investigationState: "INVESTIGATED", territoryKey: "coast", evidenceStatus: "PARTIAL_EVIDENCE", analysisRoute: "PARTIAL_CULTURAL_ANALYSIS" },
        { name: "Coast", investigationState: "INVESTIGATED", territoryKey: "coast_other", evidenceStatus: "UNSUPPORTED", analysisRoute: "INSUFFICIENT_EVIDENCE" },
      ],
    }),
  ]);
  const coasts = nodes.filter((node) => node.label === "Coast");
  assert.equal(coasts.length, 2);
  assert.notEqual(coasts[0]?.id, coasts[1]?.id);
});

test("evidence follows the territory key and fails closed", async () => {
  const { evidenceSections } = await import("./atlas-model.ts");
  const packet = response({
    investigation: {
      runId: id,
      reused: false,
      link: null,
      result: {
        status: "COMPLETE",
        evidenceOrigin: "synthetic",
        summary: { text: "The whole investigation.", source: "deterministic_template" },
        limitations: [{ code: "AGG", detail: "This limitation belongs to the investigation." }],
        layers: {
          qlooEvidence: {
            concepts: [
              { territoryKey: "coast", label: "Sea", correlationIds: ["coast-call"] },
              { territoryKey: "other", label: "Other concept", correlationIds: ["other-call"] },
            ],
            exemplars: [],
          },
          systemAnalysis: { routes: [{ territoryKey: "coast", route: "PARTIAL_CULTURAL_ANALYSIS", classification: null, robustness: null, position: null }] },
        },
        territories: [
          { key: "coast", label: "Coast", keyEvidence: ["Coast was observed."], limitations: [{ code: "THIN", detail: "The coast panel is thin." }], provenance: { correlationIds: ["coast-call"] } },
          { key: "other", label: "Coast", keyEvidence: ["A different coast."], limitations: [], provenance: { correlationIds: ["other-call"] } },
        ],
      } as never,
    },
  });
  const coast = evidenceSections(packet, { territoryKey: "coast", territoryName: "Coast", runId: id });
  assert.match(coast.observed.join(" "), /Sea/u);
  assert.doesNotMatch(coast.observed.join(" "), /Other concept/u);
  assert.match(coast.calculated.join(" "), /Coast was observed/u);
  assert.doesNotMatch(coast.calculated.join(" "), /different coast/u);
  assert.equal(coast.territorySpecific, true);
  const missing = evidenceSections(packet, { territoryKey: "missing", territoryName: "Coast", runId: id });
  assert.match(missing.observed.join(" "), /Territory-specific evidence is unavailable/u);
  assert.doesNotMatch(missing.observed.join(" "), /Sea|Other concept/u);
  assert.match(missing.aggregate.join(" "), /investigation/u);
  const duplicateName = evidenceSections(packet, { territoryKey: null, territoryName: "Coast", runId: id });
  assert.equal(duplicateName.territorySpecific, false);
  assert.match(duplicateName.observed.join(" "), /Territory-specific evidence is unavailable/u);
  const wrongRun = evidenceSections(packet, { territoryKey: "coast", territoryName: "Coast", runId: "00000000-0000-4000-8000-000000000099" });
  assert.equal(wrongRun.territorySpecific, false);
  assert.doesNotMatch(wrongRun.observed.join(" "), /Sea/u);
});

test("the recorded example is labelled, live-origin, and parseable without a provider", async () => {
  const { readFileSync } = await import("node:fs");
  const { parseQueryResponse } = await import("@cultural-elasticity/shared");
  const artifact = JSON.parse(readFileSync(new URL("../../demo/recorded-example.json", import.meta.url), "utf8")) as {
    kind: string;
    recordedAt: string;
    note: string;
    responses: QueryResponse[];
  };
  assert.equal(artifact.kind, "RECORDED_EXAMPLE");
  assert.match(artifact.recordedAt, /^\d{4}-\d{2}-\d{2}T/u);
  assert.match(artifact.note, /does not call a provider/iu);
  assert.equal(artifact.responses[0]?.state, "INVESTIGATION_INCOMPLETE");
  assert.ok(artifact.responses.length >= 1);
  for (const item of artifact.responses) {
    const parsed = parseQueryResponse(item);
    assert.equal(parsed.ok, true, parsed.ok ? "" : JSON.stringify(parsed.issues));
    assert.ok(item.interpretation?.interpretationWarnings.includes("RECORDED_EXAMPLE"));
    const result = item.investigation?.result;
    assert.ok(result && result.status !== "NEEDS_INPUT");
    assert.equal(result.evidenceOrigin, "live");
  }
});

test("competitor copy stays non-equivalent", () => {
  assert.match(reasonCopy("UNSUPPORTED_OPERATION", "compare_brands"), /not available yet/iu);
  assert.match(reasonCopy("UNSUPPORTED_OPERATION", "compare_brands"), /different question/iu);
});

test("layout keeps long labels inside collision-free boxes", () => {
  const first = [
    { id: "brand", parentId: null, label: "Jacquemus", kind: "brand" as const },
    { id: "a", parentId: "brand", label: "Art and culture", kind: "territory" as const },
    { id: "b", parentId: "brand", label: "Bohemian lifestyle", kind: "territory" as const },
    { id: "c", parentId: "brand", label: "Avant-garde experimental fashion", kind: "territory" as const },
    { id: "d", parentId: "brand", label: "Japanese drama", kind: "territory" as const },
    { id: "e", parentId: "a", label: "design-led boutique hospitality", kind: "territory" as const },
  ];
  const placed = layoutAtlas(first, new Map());
  const boxes = first.map((node) => boxOf(node, placed.get(node.id)!));
  assert.equal(overlappingPairs(boxes).length, 0);
  assert.ok((placed.get("c")?.y ?? 0) > (placed.get("b")?.y ?? 0));
  const long = first.find((node) => node.id === "c")!;
  assert.ok(boxOf(long, placed.get("c")!).height >= 76);
  assert.equal(shortStatus("unsupported", "No usable evidence"), "No evidence");
  const extent = atlasExtent(first.map((node) => ({ ...node, ...(placed.get(node.id) ?? { x: 0, y: 0 }) })));
  for (const box of boxes) {
    assert.ok(box.x + box.width <= extent.width, "panel must sit inside the atlas extent");
    assert.ok(box.y + box.height <= extent.height, "panel must sit inside the atlas extent");
  }
});

test("the recorded example lays out without overlapping panels", async () => {
  const { readFileSync } = await import("node:fs");
  const artifact = JSON.parse(readFileSync(new URL("../../demo/recorded-example.json", import.meta.url), "utf8")) as { responses: QueryResponse[] };
  const nodes = buildAtlas(artifact.responses);
  const placed = layoutAtlas(nodes, new Map());
  const boxes = nodes.map((node) => boxOf(node, placed.get(node.id)!));
  assert.ok(boxes.length >= 5);
  assert.equal(overlappingPairs(boxes).length, 0);
});
