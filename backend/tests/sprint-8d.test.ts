/**
 * Sprint 8D: research-competence decision rules.
 * SYNTHETIC world (fictional names, SYN- ids). Not live Qloo. Not live Haiku.
 *
 * Failure classes taken from the Sprint 8C live Jacquemus parent (metrics only; the full turn trace
 * was not persisted): 4 proposed / 1 resolved, 12 empty probes, 4× NO_VALUE_ACTION, 0 FULL / 1 PARTIAL.
 */
import { describe, expect, it } from "vitest";
import { buildDecisionContext } from "../src/agent/context.js";
import { nextActionValues } from "../src/agent/evidence-sufficiency.js";
import {
  frontierEvidenceBaseGap,
  ungroundedFrontierProbeReason,
  unusedFrontierPoolEntries,
  viableFrontierCandidates,
} from "../src/agent/frontier.js";
import { SkillRegistry } from "../src/agent/skills/registry.js";
import { exploreCandidatesSkill, FRONTIER_TARGET } from "../src/agent/skills/definitions.js";
import { addTerritory, transition, type AgentRunState } from "../src/agent/state.js";
import { executeToolCall } from "../src/agent/tool-executor.js";
import { ToolRegistry } from "../src/agent/tool-registry.js";
import { freshState, scripted } from "./fixtures/synthetic/agent.js";

const registry = new ToolRegistry();
const skills = new SkillRegistry();
const BRAND = "Brindlewood Oat";
const BRAND_ID = "SYN-BR-5201";
const RELATED = ["SYN-BR-5202", "SYN-BR-5203", "SYN-BR-5204", "SYN-BR-5205", "SYN-BR-5206", "SYN-BR-5207"];
const HC = "urn:tag:genre:synmedia:hearth_cooking";
const PF = "urn:tag:genre:synmusic:porch_folk";
const CAFE = "urn:tag:product_category:syn:cafe_culture";

function gate(state: AgentRunState) {
  const active = skills.select(state);
  return { skills, active, exposed: new Set(skills.exposure(state, registry, active).tools), actions: skills.exposure(state, registry, active).actions };
}

async function resolveBrand(intent: "explore_frontier" | "analyze_move", brand = BRAND, territories: string[] = []) {
  const state = freshState({ brand, ...(territories.length ? { territories } : {}) });
  const provider = scripted();
  const exec = (tool: string, args: unknown, withGate = false) =>
    executeToolCall(state, registry, provider, tool, args, undefined, withGate ? gate(state) : undefined);
  await exec("interpret_request", { intent, brand, territories });
  transition(state, "RESOLVING", "test");
  await exec("qloo_resolve_entity", { name: brand, type: "brand", role: "brand" });
  transition(state, "INVESTIGATING", "test");
  return { state, exec, provider };
}

async function evidenceBase(state: AgentRunState, exec: (tool: string, args: unknown, withGate?: boolean) => ReturnType<typeof executeToolCall>) {
  await exec("qloo_get_entity_tags", { entityId: BRAND_ID });
  await exec("qloo_related_entities", { entityId: BRAND_ID, targetType: "brand", limit: 5 });
  for (const id of RELATED) await exec("qloo_get_entity_tags", { entityId: id });
  return state;
}

describe("Sprint 8D frontier evidence-base-first (live Jacquemus: 12 empty probes before a useful type)", () => {
  it("names related-entity collection as the HIGH action before any ungrounded probe", async () => {
    const { state } = await resolveBrand("explore_frontier");
    const gap = frontierEvidenceBaseGap(state);
    expect(gap).toMatchObject({ action: "qloo_related_entities", target: BRAND_ID });
    const high = nextActionValues(state).filter((a) => a.value === "HIGH").map((a) => a.action);
    expect(high).toContain("qloo_related_entities");
    expect(ungroundedFrontierProbeReason(state, [HC])).toMatch(/evidence base/u);
  });

  it("refuses an ungrounded recommend while the evidence base is incomplete", async () => {
    const { exec } = await resolveBrand("explore_frontier");
    await exec("qloo_find_tags", { query: "Hearth cooking", limit: 5 });
    const refused = await exec("qloo_recommend", { targetType: "place", tagIds: [HC], conditionOnBrand: false, limit: 20 }, true);
    expect(refused).toMatchObject({ accepted: false, code: "FRONTIER_EVIDENCE_PENDING" });
  });

  it("allows probing a frontierConcepts tag after a partial related-profile base", async () => {
    const { state, exec } = await resolveBrand("explore_frontier");
    await exec("qloo_get_entity_tags", { entityId: BRAND_ID });
    await exec("qloo_related_entities", { entityId: BRAND_ID, targetType: "brand", limit: 5 });
    for (const id of RELATED.slice(0, 3)) await exec("qloo_get_entity_tags", { entityId: id });
    expect(frontierEvidenceBaseGap(state)?.action).toBe("qloo_get_entity_tags");
    const pool = unusedFrontierPoolEntries(state);
    expect(pool.length).toBeGreaterThan(0);
    expect(ungroundedFrontierProbeReason(state, [pool[0]!.tagId])).toBeNull();
    const probe = await exec("qloo_recommend", { targetType: "brand", tagIds: [pool[0]!.tagId], conditionOnBrand: false, limit: 20 }, true);
    expect(probe.accepted).toBe(true);
  });

  it("still refuses a hypothesized tag that is not in frontierConcepts while related profiles remain", async () => {
    const { state, exec } = await resolveBrand("explore_frontier");
    await exec("qloo_get_entity_tags", { entityId: BRAND_ID });
    await exec("qloo_related_entities", { entityId: BRAND_ID, targetType: "brand", limit: 5 });
    for (const id of RELATED.slice(0, 3)) await exec("qloo_get_entity_tags", { entityId: id });
    const poolIds = new Set(unusedFrontierPoolEntries(state).map((e) => e.tagId));
    expect(poolIds.has(CAFE)).toBe(false);
    await exec("qloo_find_tags", { query: "Cafe Culture", limit: 5 });
    expect(ungroundedFrontierProbeReason(state, [CAFE])).toMatch(/hypothesized/u);
    const refused = await exec("qloo_recommend", { targetType: "brand", tagIds: [CAFE], conditionOnBrand: false, limit: 20 }, true);
    expect(refused).toMatchObject({ accepted: false, code: "FRONTIER_EVIDENCE_PENDING" });
  });

  it("does not treat remaining related profiles as a finish blocker once viable candidates exist", async () => {
    const { state, exec } = await resolveBrand("explore_frontier");
    await exec("qloo_get_entity_tags", { entityId: BRAND_ID });
    await exec("qloo_related_entities", { entityId: BRAND_ID, targetType: "brand", limit: 5 });
    for (const id of RELATED.slice(0, 3)) await exec("qloo_get_entity_tags", { entityId: id });
    const pool = unusedFrontierPoolEntries(state);
    expect(pool.length).toBeGreaterThanOrEqual(4);
    for (const entry of pool.slice(0, 4)) {
      await exec("propose_territory", {
        label: entry.label,
        role: "frontier_candidate",
        origin: "qloo_evidence",
        evidenceTagIds: [entry.tagId],
        rationale: "carried by related brands",
      });
    }
    expect(viableFrontierCandidates(state)).toBeGreaterThanOrEqual(4);
    expect(frontierEvidenceBaseGap(state)?.action).toBe("qloo_get_entity_tags");
    const relatedHigh = nextActionValues(state).find((a) => a.action === "qloo_get_entity_tags" && a.value === "HIGH" && a.target !== null && /evidence base/u.test(a.reason));
    expect(relatedHigh).toBeUndefined();
  });

  it("allows a named-territory recommend without a frontier evidence base", async () => {
    const { state, exec } = await resolveBrand("analyze_move", "Velvet Tide", ["Cafe Culture"]);
    expect(frontierEvidenceBaseGap(state)).toBeNull();
    await exec("qloo_find_tags", { query: "Cafe Culture", limit: 5 });
    const probe = await exec("qloo_recommend", { targetType: "brand", tagIds: [CAFE], conditionOnBrand: false, limit: 20 }, true);
    expect(probe).toMatchObject({ accepted: true });
  });

  it("allows probing an already-proposed candidate while the evidence base is still filling", async () => {
    const { state, exec } = await resolveBrand("explore_frontier");
    await exec("qloo_get_entity_tags", { entityId: BRAND_ID });
    await exec("qloo_related_entities", { entityId: BRAND_ID, targetType: "brand", limit: 5 });
    await exec("qloo_find_tags", { query: "Hearth cooking", limit: 5 });
    await exec("propose_territory", {
      label: "Hearth cooking",
      role: "frontier_candidate",
      origin: "qloo_evidence",
      evidenceTagIds: [HC],
      rationale: "carried by related brands",
    });
    expect(ungroundedFrontierProbeReason(state, [HC])).toBeNull();
    const probe = await exec("qloo_recommend", { targetType: "book", tagIds: [HC], conditionOnBrand: false, limit: 20 }, true);
    expect(probe.accepted).toBe(true);
  });
});

describe("Sprint 8D viable frontier quota (live Jacquemus: 4 proposed, 1 resolved, 3 empty hypotheses)", () => {
  it("does not count unsupported agent hypotheses toward the exploration target", async () => {
    const { state, exec } = await resolveBrand("explore_frontier");
    await evidenceBase(state, exec);
    for (const label of ["Lateral One", "Lateral Two", "Lateral Three", "Lateral Four"]) {
      addTerritory(state, {
        label,
        role: "frontier_candidate",
        origin: "agent_hypothesis",
        rationale: "hypothesis",
        source: "agent_hypothesis",
        sourceEvidence: "test",
      });
    }
    expect(viableFrontierCandidates(state)).toBe(0);
    expect(exploreCandidatesSkill.relevant(state)).toBe(true);
    expect(viableFrontierCandidates(state)).toBeLessThan(FRONTIER_TARGET);
  });

  it("counts in-flight Qloo-grounded candidates so exploration can pause while they are probed", async () => {
    const { state, exec } = await resolveBrand("explore_frontier");
    await evidenceBase(state, exec);
    await exec("propose_territory", {
      label: "Hearth cooking",
      role: "frontier_candidate",
      origin: "qloo_evidence",
      evidenceTagIds: [HC],
      rationale: "carried by related brands",
    });
    expect(viableFrontierCandidates(state)).toBe(1);
  });
});

describe("Sprint 8D unproductive hypothesis probes and already-collected context", () => {
  it("refuses a second empty probe of an agent hypothesis while unused pool concepts remain", async () => {
    const { state, exec } = await resolveBrand("explore_frontier");
    await evidenceBase(state, exec);
    expect(unusedFrontierPoolEntries(state).length).toBeGreaterThan(0);
    await exec("qloo_find_tags", { query: "Porch folk", limit: 5 });
    await exec("propose_territory", {
      label: "Porch folk",
      role: "frontier_candidate",
      origin: "agent_hypothesis",
      evidenceTagIds: [PF],
      rationale: "lateral hypothesis",
    });
    const first = await exec("qloo_recommend", { targetType: "place", tagIds: [PF], conditionOnBrand: false, limit: 20 }, true);
    expect(first.accepted).toBe(true);
    const second = await exec("qloo_recommend", { targetType: "brand", tagIds: [PF], conditionOnBrand: false, limit: 20 }, true);
    expect(second).toMatchObject({ accepted: false, code: "NO_VALUE_ACTION" });
  });

  it("lists already-collected profiles and refuses a repeated tag query as NO_VALUE", async () => {
    const { state, exec } = await resolveBrand("explore_frontier");
    await exec("qloo_get_entity_tags", { entityId: BRAND_ID });
    await exec("qloo_find_tags", { query: "Hearth cooking", limit: 5 });
    const context = buildDecisionContext(state, registry, null);
    expect(context.evidence.alreadyCollected?.profiledEntityIds).toContain(BRAND_ID);
    expect(context.evidence.alreadyCollected?.searchedQueries).toContain("hearth cooking");
    const repeat = await exec("qloo_find_tags", { query: "hearth cooking", limit: 3 }, true);
    expect(repeat).toMatchObject({ accepted: false, code: "NO_VALUE_ACTION" });
    expect(context.focus?.outstanding.some((line) => /qloo_related_entities/u.test(line))).toBe(true);
  });

  it("does not rebuild a large context: alreadyCollected is a compact id list", async () => {
    const { state, exec } = await resolveBrand("explore_frontier");
    await evidenceBase(state, exec);
    const context = buildDecisionContext(state, registry, null);
    expect(context.evidence.alreadyCollected?.profiledEntityIds.length).toBeGreaterThan(0);
    expect(JSON.stringify(context.evidence.alreadyCollected).length).toBeLessThan(800);
  });
});
