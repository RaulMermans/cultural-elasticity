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
