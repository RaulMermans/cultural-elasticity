/**
 * Sprint 9O: the bounded reference-probe heuristic (REFERENCE_EMPTY_PROBE_LIMIT) is an efficiency bound, not proof that
 * Qloo holds no further reference. Counterexample: the target's validated exemplars carry four tags that no other place
 * carries (their brand-independent pools return only the exemplars), plus two genuine references with their own members.
 * After four empty probes, a candidate with observed type evidence must still be probeable while capacity remains.
 * SYNTHETIC world (fictional SYN- entities); not Qloo evidence.
 */
import { describe, expect, it } from "vitest";
import { assessComparisonFeasibility } from "../src/agent/feasibility.js";
import { assessEvidenceSufficiency } from "../src/agent/evidence-sufficiency.js";
import { comparisonSetSize, referenceCandidates, referencePlan, referenceProbeLedger, REFERENCE_EMPTY_PROBE_LIMIT } from "../src/agent/reference-strategy.js";
import { executeToolCall, valueOfToolCall } from "../src/agent/tool-executor.js";
import { ToolRegistry } from "../src/agent/tool-registry.js";
import { transition, type AgentRunState } from "../src/agent/state.js";
import { freshState, scripted } from "./fixtures/synthetic/agent.js";

const registry = new ToolRegistry();
const READING = "urn:tag:category:synplace:reading_rooms";
const PRINT = "urn:tag:category:synplace:print_studios";
const LISTEN = "urn:tag:category:synplace:listening_bars";
const EXEMPLAR_ONLY = ["urn:tag:keyword:synplace:oak_panelling", "urn:tag:style:synplace:brass_lamps", "urn:tag:setting:synplace:hushed_hours", "urn:tag:theme:synplace:map_archives"];
const EXEMPLARS = ["SYN-PL-9O01", "SYN-PL-9O02", "SYN-PL-9O03"];
const probe = (tag: string) => ["qloo_recommend", { targetType: "place", tagIds: [tag], conditionOnBrand: false, limit: 20 }] as const;
const probeValue = (state: AgentRunState, tag: string) => valueOfToolCall(state, "qloo_recommend", probe(tag)[1], assessEvidenceSufficiency(state));

/** Osterley Field Supply → Reading Rooms: three validated place exemplars, brand and exemplar profiles collected. */
async function readingRoomsRepresented(policy: "enforce" | "observe" = "enforce") {
  const brand = "Osterley Field Supply";
  const state = freshState({ brand, territories: ["Reading Rooms"] });
  state.feasibilityPolicy = policy;
  const provider = scripted();
  const exec = (tool: string, args: unknown) => executeToolCall(state, registry, provider, tool, args);
  await exec("interpret_request", { intent: "analyze_move", brand, territories: ["Reading Rooms"] });
  transition(state, "RESOLVING", "test");
  await exec("qloo_resolve_entity", { name: brand, type: "brand", role: "brand" });
  transition(state, "INVESTIGATING", "test");
  await exec("qloo_find_tags", { query: "Reading Rooms", limit: 8 });
  await exec(...probe(READING));
  await exec("anchor_territory", { territoryKey: "reading_rooms", tagId: READING });
  await exec("validate_territory_representation", { territoryKey: "reading_rooms", entityType: "place", exemplars: EXEMPLARS.map((id) => ({ id, reason: "Qloo tag member" })) });
  await exec("qloo_get_entity_tags", { entityId: "SYN-BR-9O01" });
  for (const id of EXEMPLARS) await exec("qloo_get_entity_tags", { entityId: id });
  return { state, exec };
}

describe("Sprint 9O reference-probe bound counterexample", () => {
  it("the world is the intended counterexample: six meaningful typed candidates, four of them exemplar-only", async () => {
    const { state } = await readingRoomsRepresented();
    const byTag = new Map(referenceCandidates(state).map((c) => [c.tagId, c]));
    for (const tag of [...EXEMPLAR_ONLY, PRINT, LISTEN]) expect(byTag.get(tag)?.semantic.status).toBe("MEANINGFUL");
    for (const tag of EXEMPLAR_ONLY) expect(byTag.get(tag)?.typeEvidence).toBe(3);
    for (const tag of [PRINT, LISTEN]) expect(byTag.get(tag)?.typeEvidence).toBe(2);
  });

  it(`after ${REFERENCE_EMPTY_PROBE_LIMIT} empty probes, an unprobed candidate with type evidence keeps the comparison feasible`, async () => {
    const { state, exec } = await readingRoomsRepresented();
    for (const tag of EXEMPLAR_ONLY) await exec(...probe(tag));
    expect(referenceProbeLedger(state)).toMatchObject({ empty: REFERENCE_EMPTY_PROBE_LIMIT, productive: 0 });
    expect(referencePlan(state).blockedBy).toBeNull();
    expect(assessComparisonFeasibility(state)?.status).not.toBe("INFEASIBLE");
    expect(probeValue(state, PRINT).code).toBeUndefined();

    // The comparison it protects is reachable: both genuine references return members and complete the set.
    await exec(...probe(PRINT));
    await exec(...probe(LISTEN));
    await exec("propose_territory", { label: "Print Studios", role: "reference", origin: "qloo_evidence", rationale: "on two exemplar profiles", evidenceTagIds: [PRINT] });
    await exec("propose_territory", { label: "Listening Bars", role: "reference", origin: "qloo_evidence", rationale: "on two exemplar profiles", evidenceTagIds: [LISTEN] });
    await exec("anchor_territory", { territoryKey: "print_studios", tagId: PRINT });
    await exec("anchor_territory", { territoryKey: "listening_bars", tagId: LISTEN });
    await exec("validate_territory_representation", { territoryKey: "print_studios", entityType: "place", exemplars: ["SYN-PL-9O11", "SYN-PL-9O12", "SYN-PL-9O13"].map((id) => ({ id, reason: "Qloo tag member" })) });
    await exec("validate_territory_representation", { territoryKey: "listening_bars", entityType: "place", exemplars: ["SYN-PL-9O21", "SYN-PL-9O22", "SYN-PL-9O23"].map((id) => ({ id, reason: "Qloo tag member" })) });
    expect(comparisonSetSize(state)).toBe(3);
    expect(assessComparisonFeasibility(state)?.status).toBe("FEASIBLE");
  });

  it("the bound still refuses candidates without type evidence once the typed ones are exhausted", async () => {
    const { state, exec } = await readingRoomsRepresented();
    for (const tag of EXEMPLAR_ONLY) await exec(...probe(tag));
    // The brand-profile genre has no observed place evidence: after the limit it is not worth a call.
    expect(probeValue(state, "urn:tag:genre:synmusic:lofi_beats")).toMatchObject({ value: "NONE" });
  });
});

describe("Sprint 9O baseline grounding (live Carhartt → Blue Collar re-resolved the name and never probed the scan's tag)", () => {
  const COFFEE = "urn:tag:cuisine:syn:coffee_houses";
  const grounding = (territory: string, tagId: string) => ({ territory, tagId, label: territory, type: tagId.split(":").slice(0, 4).join(":"), subjectId: "SYN-BR-9N01", correlationId: "syn-baseline-entity-tags" });

  it("a grounded direction tells the model to probe the baseline's own tag first, and the run anchors to it", async () => {
    const { buildDecisionContext } = await import("../src/agent/context.js");
    const { applyInterpretation } = await import("../src/agent/router.js");
    const state = freshState({ brand: "Halden Apothecary", territories: ["Coffee Houses"] });
    state.territoryGrounding = grounding("Coffee Houses", COFFEE);
    applyInterpretation(state, { intent: "analyze_move", brand: "Halden Apothecary", territories: ["Coffee Houses"] }, "query_layer");
    const t = state.territories[0]!;
    expect(t.sourceTagId).toBe(COFFEE);
    expect(state.tags.get(COFFEE)?.sources).toEqual([{ kind: "profile", query: null, subjectId: "SYN-BR-9N01", correlationId: "syn-baseline-entity-tags" }]);
    transition(state, "RESOLVING", "test");
    await executeToolCall(state, registry, scripted(), "qloo_resolve_entity", { name: "Halden Apothecary", type: "brand", role: "brand" });
    transition(state, "INVESTIGATING", "test");
    const view = buildDecisionContext(state, registry, null).territories.find((x) => x.key === t.key) as { nextProbe?: { tagId?: string } } | undefined;
    expect(JSON.stringify(view?.nextProbe ?? null)).toContain(COFFEE);
    expect(assessEvidenceSufficiency(state).nextActions.find((a) => a.target === t.key && a.value === "HIGH")).toMatchObject({ action: "qloo_recommend" });

    const { AgentRuntime } = await import("../src/agent/runtime.js");
    const { BaselinePolicyModel } = await import("../src/agent/model/baseline.js");
    const r = await new AgentRuntime({ model: new BaselinePolicyModel(), provider: scripted() }).run({ userQuery: "How far can Halden Apothecary extend into Coffee Houses?", brand: "Halden Apothecary", territories: ["Coffee Houses"] }, undefined, { territoryGrounding: grounding("Coffee Houses", COFFEE) });
    expect("territories" in r && r.territories.find((x) => x.label === "Coffee Houses")?.resolvedConcept?.id).toBe(COFFEE);
  });

  it("a grounded tag Qloo returns no members for leaves the direction unclassified, with the honest reason", async () => {
    const { AgentRuntime } = await import("../src/agent/runtime.js");
    const { BaselinePolicyModel } = await import("../src/agent/model/baseline.js");
    const LOFI = "urn:tag:genre:synmusic:lofi_beats";
    const r = await new AgentRuntime({ model: new BaselinePolicyModel(), provider: scripted() }).run({ userQuery: "How far can Corvid Basics extend into Lofi Beats?", brand: "Corvid Basics", territories: ["Lofi Beats"] }, undefined, { territoryGrounding: { ...grounding("Lofi Beats", LOFI), subjectId: "SYN-BR-9N02" } });
    const t = "territories" in r ? r.territories.find((x) => x.label === "Lofi Beats") : undefined;
    expect(r.trace.toolCalls.filter((c) => c.tool === "qloo_recommend").every((c) => c.status === "empty")).toBe(true);
    expect(t?.classification ?? null).toBeNull();
    expect(t?.analysisRoute).toBe("INSUFFICIENT_EVIDENCE");
    expect(t?.limitations.map((l) => l.code)).toContain("NO_VALID_REPRESENTATION");
  });

  it("the handoff grounds a direction only from an ok entity_tags observation on the brand", async () => {
    const { directionGrounding } = await import("../src/api/baseline-handoff.js");
    const ref = { operation: "entity_tags" as const, correlationId: "syn-c1", sourceId: "s", capturedAt: "t", sourceStatus: "ok" as const, scope: "brand" };
    const result = { brand: { name: "Syn", qlooId: "SYN-BR-1" }, territories: [
      { id: "d1", name: "Blue Collar", canonicalConcept: "urn:tag:keyword:qloo:blue_collar", supportingReferences: [ref] },
      { id: "d2", name: "Partial", canonicalConcept: "urn:tag:keyword:qloo:partial", supportingReferences: [{ ...ref, sourceStatus: "partial" as const }] },
    ] } as unknown as Parameters<typeof directionGrounding>[0];
    expect(directionGrounding(result, "d1")).toEqual({ territory: "Blue Collar", tagId: "urn:tag:keyword:qloo:blue_collar", label: "Blue Collar", type: "urn:tag:keyword:qloo", subjectId: "SYN-BR-1", correlationId: "syn-c1" });
    expect(directionGrounding(result, "d2")).toBeNull();
    expect(directionGrounding(result, "missing")).toBeNull();
  });
});

describe("Sprint 9O drop reasons the reader sees are the runtime's observation (live Carhartt: 'the one probe' after five)", () => {
  it("replaces the model's account of empty probes with the recorded count", async () => {
    const LOFI = "urn:tag:genre:synmusic:lofi_beats";
    const state = freshState({ brand: "Corvid Basics", territories: ["Lofi Beats"] });
    const provider = scripted();
    const exec = (tool: string, args: unknown) => executeToolCall(state, registry, provider, tool, args);
    await exec("interpret_request", { intent: "analyze_move", brand: "Corvid Basics", territories: ["Lofi Beats"] });
    transition(state, "RESOLVING", "test");
    await exec("qloo_resolve_entity", { name: "Corvid Basics", type: "brand", role: "brand" });
    transition(state, "INVESTIGATING", "test");
    await exec("qloo_find_tags", { query: "Lofi Beats", limit: 8 });
    for (const targetType of ["place", "brand", "artist"]) await exec("qloo_recommend", { targetType, tagIds: [LOFI], conditionOnBrand: false, limit: 20 });
    await exec("drop_territory", { territoryKey: "lofi_beats", code: "TERRITORY_UNRESOLVED", reason: "the one probe returned no place entities" });
    const detail = state.territories.find((t) => t.key === "lofi_beats")!.dropReason!.detail;
    expect(detail).toBe("Lofi Beats: 3 brand-independent Qloo probe(s) of 1 tag(s) (place, brand, artist); none returned entities.");
    expect(state.candidateRejections.at(-1)?.reason).toBe("the one probe returned no place entities");
  });
});

describe("Sprint 9O runtime reference discovery (build_comparison_set v5)", () => {
  const run = async (policy: "enforce" | "observe") => {
    const { AgentRuntime } = await import("../src/agent/runtime.js");
    const { BaselinePolicyModel } = await import("../src/agent/model/baseline.js");
    return new AgentRuntime({ model: new BaselinePolicyModel(), provider: scripted(), feasibilityPolicy: policy }).run({ userQuery: "How far can Osterley Field Supply extend into Reading Rooms?", brand: "Osterley Field Supply", territories: ["Reading Rooms"] });
  };

  it("collects the exemplar profiles and probes the needed type-evidenced references once, attributed to the skill", async () => {
    const r = await run("enforce");
    const sweep = r.trace.referenceDiscovery ?? [];
    expect(sweep).toHaveLength(1);
    expect(sweep[0]!.entityType).toBe("place");
    expect(sweep[0]!.probes.map((p) => p.tagId).sort()).toEqual([LISTEN, PRINT]);
    expect(sweep[0]!.probes.every((p) => (p.eligible ?? 0) >= 2)).toBe(true);
    const sweepCalls = r.trace.toolCalls.filter((c) => c.tool === "qloo_recommend" && [PRINT, LISTEN].includes((c.arguments as { tagIds: string[] }).tagIds[0]!));
    expect(sweepCalls.every((c) => c.skill?.id === "build_comparison_set" && c.skill.version === 5)).toBe(true);
    expect("territories" in r && r.territories.find((t) => t.label === "Reading Rooms")?.analysisRoute).toBe("FULL_RELATIVE_ANALYSIS");
  });

  it("does not run under the observe rollback", async () => {
    expect((await run("observe")).trace.referenceDiscovery ?? []).toHaveLength(0);
  });
});
