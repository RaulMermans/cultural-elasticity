/**
 * Sprint 8E: brand-scoped frontier evidence base.
 * SYNTHETIC world (fictional names, SYN- ids). Not live Qloo. Not live Haiku.
 *
 * Defect: frontierEvidenceBaseGap() treated ANY related-entity observation as the brand's related evidence, so a
 * related call about another entity (or an earlier canonical brand id) closed the Channel A gap with an empty base.
 */
import { describe, expect, it } from "vitest";
import { nextActionValues } from "../src/agent/evidence-sufficiency.js";
import { frontierEvidenceBase, frontierEvidenceBaseGap, ungroundedFrontierProbeReason, unusedFrontierPoolEntries } from "../src/agent/frontier.js";
import { SkillRegistry } from "../src/agent/skills/registry.js";
import { transition, type AgentRunState } from "../src/agent/state.js";
import { executeToolCall } from "../src/agent/tool-executor.js";
import { ToolRegistry } from "../src/agent/tool-registry.js";
import { freshState, scripted } from "./fixtures/synthetic/agent.js";

const registry = new ToolRegistry();
const skills = new SkillRegistry();
const BRAND = "Brindlewood Oat";
const BRAND_ID = "SYN-BR-5201";
const OTHER_ID = "SYN-BR-5202";
const RELATED = ["SYN-BR-5202", "SYN-BR-5203", "SYN-BR-5204", "SYN-BR-5205", "SYN-BR-5206", "SYN-BR-5207"];
const CAFE = "urn:tag:product_category:syn:cafe_culture";
const PF = "urn:tag:genre:synmusic:porch_folk";

function gate(state: AgentRunState) {
  const active = skills.select(state);
  return { skills, active, exposed: new Set(skills.exposure(state, registry, active).tools), actions: skills.exposure(state, registry, active).actions };
}

async function frontierRun() {
  const state = freshState({ brand: BRAND });
  const provider = scripted();
  const exec = (tool: string, args: unknown, withGate = false) => executeToolCall(state, registry, provider, tool, args, undefined, withGate ? gate(state) : undefined);
  await exec("interpret_request", { intent: "explore_frontier", brand: BRAND, territories: [] });
  transition(state, "RESOLVING", "test");
  await exec("qloo_resolve_entity", { name: BRAND, type: "brand", role: "brand" });
  transition(state, "INVESTIGATING", "test");
  // SYNTHETIC: a second entity observed in this run (e.g. resolved as a reference), so a related call on it is legal.
  await exec("qloo_resolve_entity", { name: "Fallowmere Dairy-Free", type: "brand", role: "other" });
  return { state, exec };
}

const evidenceBaseHigh = (state: AgentRunState) => nextActionValues(state).filter((a) => a.value === "HIGH" && /evidence base/u.test(a.reason));

describe("Sprint 8E brand-scoped Channel A evidence base", () => {
  it("does not treat a related call about another entity as the brand's related evidence", async () => {
    const { state, exec } = await frontierRun();
    await exec("qloo_related_entities", { entityId: OTHER_ID, targetType: "brand", limit: 5 });
    expect(state.related.some((r) => r.subjectId === OTHER_ID)).toBe(true);
    expect(frontierEvidenceBaseGap(state)).toMatchObject({ action: "qloo_related_entities", target: BRAND_ID });
    expect(frontierEvidenceBase(state)).toEqual([]);
    expect(ungroundedFrontierProbeReason(state, [CAFE])).toMatch(/related entities/u);
  });

  it("closes the related-entity gap only once the current brand's related call is recorded", async () => {
    const { state, exec } = await frontierRun();
    await exec("qloo_related_entities", { entityId: OTHER_ID, targetType: "brand", limit: 5 });
    await exec("qloo_related_entities", { entityId: BRAND_ID, targetType: "brand", limit: 5 });
    const gap = frontierEvidenceBaseGap(state);
    expect(gap?.action).toBe("qloo_get_entity_tags");
    expect(frontierEvidenceBase(state).length).toBeGreaterThan(0);
  });

  it("re-opens the gap when the brand resolves to a different canonical id", async () => {
    const { state, exec } = await frontierRun();
    await exec("qloo_related_entities", { entityId: BRAND_ID, targetType: "brand", limit: 5 });
    for (const id of RELATED) await exec("qloo_get_entity_tags", { entityId: id });
    expect(frontierEvidenceBaseGap(state)).toBeNull();
    // A different canonical brand id: the earlier related call is about another entity now.
    state.brand.entity = { ...state.brand.entity!, id: "SYN-BR-5299" };
    expect(frontierEvidenceBaseGap(state)).toMatchObject({ action: "qloo_related_entities", target: "SYN-BR-5299" });
  });

  it("treats an empty related answer for the brand as collected, with no phantom blocker", async () => {
    const { state, exec } = await frontierRun();
    await exec("qloo_related_entities", { entityId: BRAND_ID, targetType: "brand", limit: 5 });
    // SYNTHETIC: Qloo answered the brand's related call with no members.
    for (const r of state.related) if (r.subjectId === BRAND_ID) r.memberIds = [];
    expect(frontierEvidenceBase(state)).toEqual([]);
    expect(frontierEvidenceBaseGap(state)).toBeNull();
    expect(evidenceBaseHigh(state)).toEqual([]);
    expect(ungroundedFrontierProbeReason(state, [CAFE])).toBeNull();
  });

  it("keeps the related-entity HIGH action targeted at the brand while only unrelated related calls exist", async () => {
    const { state, exec } = await frontierRun();
    await exec("qloo_related_entities", { entityId: OTHER_ID, targetType: "brand", limit: 5 });
    const high = nextActionValues(state).filter((a) => a.value === "HIGH" && a.action === "qloo_related_entities");
    expect(high.length).toBeGreaterThan(0);
  });

  it("allows pool probes on an incomplete Channel A but refuses hypothesized tags outside the pool", async () => {
    const { state, exec } = await frontierRun();
    await exec("qloo_get_entity_tags", { entityId: BRAND_ID });
    await exec("qloo_related_entities", { entityId: BRAND_ID, targetType: "brand", limit: 5 });
    for (const id of RELATED.slice(0, 2)) await exec("qloo_get_entity_tags", { entityId: id });
    expect(frontierEvidenceBaseGap(state)?.action).toBe("qloo_get_entity_tags");
    const pool = unusedFrontierPoolEntries(state);
    expect(pool.length).toBeGreaterThan(0);
    expect(ungroundedFrontierProbeReason(state, [pool[0]!.tagId])).toBeNull();
    await exec("qloo_find_tags", { query: "Cafe Culture", limit: 5 });
    const refused = await exec("qloo_recommend", { targetType: "brand", tagIds: [CAFE], conditionOnBrand: false, limit: 20 }, true);
    expect(refused).toMatchObject({ accepted: false, code: "FRONTIER_EVIDENCE_PENDING" });
  });

  it("lets an in-flight proposed hypothesis be probed once, then refuses a repeated empty probe", async () => {
    const { exec } = await frontierRun();
    await exec("qloo_get_entity_tags", { entityId: BRAND_ID });
    await exec("qloo_related_entities", { entityId: BRAND_ID, targetType: "brand", limit: 5 });
    for (const id of RELATED) await exec("qloo_get_entity_tags", { entityId: id });
    await exec("qloo_find_tags", { query: "Porch folk", limit: 5 });
    await exec("propose_territory", { label: "Porch folk", role: "frontier_candidate", origin: "agent_hypothesis", evidenceTagIds: [PF], rationale: "lateral hypothesis" });
    const first = await exec("qloo_recommend", { targetType: "place", tagIds: [PF], conditionOnBrand: false, limit: 20 }, true);
    expect(first.accepted).toBe(true);
    const second = await exec("qloo_recommend", { targetType: "brand", tagIds: [PF], conditionOnBrand: false, limit: 20 }, true);
    expect(second).toMatchObject({ accepted: false, code: "NO_VALUE_ACTION" });
  });

  it("has no evidence-base blocker once the brand's fixed base is profiled", async () => {
    const { state, exec } = await frontierRun();
    await exec("qloo_get_entity_tags", { entityId: BRAND_ID });
    await exec("qloo_related_entities", { entityId: OTHER_ID, targetType: "brand", limit: 5 });
    await exec("qloo_related_entities", { entityId: BRAND_ID, targetType: "brand", limit: 5 });
    for (const id of frontierEvidenceBase(state)) await exec("qloo_get_entity_tags", { entityId: id });
    expect(frontierEvidenceBaseGap(state)).toBeNull();
    expect(evidenceBaseHigh(state)).toEqual([]);
  });
});
