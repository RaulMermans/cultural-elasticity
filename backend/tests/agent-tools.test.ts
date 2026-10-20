/**
 * Tool registry, argument validation, permissions, budgets, representation validation, candidate
 * discovery and deduplication, and evidence sufficiency. Runs against the SYNTHETIC world.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { exemplarCandidates, frontierConcepts, labelFamily } from "../src/agent/candidate-discovery.js";
import { conceptDuplicates } from "../src/agent/concept-dedup.js";
import { assessEvidenceSufficiency } from "../src/agent/evidence-sufficiency.js";
import { planRepresentation } from "../src/agent/representation-planner.js";
import { activeTerritories, findTerritory, type AgentRunState } from "../src/agent/state.js";
import { AGENT_ALLOWED_PERMISSIONS, executeToolCall } from "../src/agent/tool-executor.js";
import { AGENT_TOOLS, ToolRegistry, toolJsonSchema, type AgentTool } from "../src/agent/tool-registry.js";
import type { AgentToolProvider } from "../src/agent/tool-provider.js";
import { freshState, scripted } from "./fixtures/synthetic/agent.js";

const registry = new ToolRegistry();
const BRAND = "SYN-BR-0001";

async function exec(state: AgentRunState, provider: AgentToolProvider, tool: string, args: unknown) {
  return executeToolCall(state, registry, provider, tool, args);
}

/** A state with interpretation, resolved brand and the brand profile. */
async function resolved(intent: "analyze_move" | "compare_territories" | "explore_frontier" = "compare_territories", territories = ["Boutique Hospitality", "Tableware", "Furniture"], brand = "Northwind Atelier") {
  const state = freshState({}, { maxQlooCalls: 60 });
  const provider = scripted();
  await exec(state, provider, "interpret_request", { intent, brand, territories: intent === "explore_frontier" ? [] : territories });
  await exec(state, provider, "qloo_resolve_entity", { name: brand, type: "brand", role: "brand" });
  return { state, provider };
}

async function anchorWithPool(state: AgentRunState, provider: AgentToolProvider, key: string, tagId: string, type: "brand" | "place" = "brand") {
  await exec(state, provider, "qloo_find_tags", { query: findTerritory(state, key)!.label, limit: 8 });
  await exec(state, provider, "qloo_recommend", { targetType: type, tagIds: [tagId], conditionOnBrand: false, limit: 20 });
  return exec(state, provider, "anchor_territory", { territoryKey: key, tagId });
}

describe("tool registry", () => {
  it("exposes only typed, read-only or local tools with schemas and bounds", () => {
    expect(AGENT_TOOLS.length).toBeGreaterThanOrEqual(10);
    for (const tool of AGENT_TOOLS) {
      expect(["read_only_external", "local_computation"]).toContain(tool.permission);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(toolJsonSchema(tool)).toMatchObject({ type: "object" });
      expect(tool.maxQlooCalls).toBe(tool.permission === "read_only_external" ? 1 : 0);
      expect(tool.phases.length).toBeGreaterThan(0);
    }
    expect(new Set(AGENT_TOOLS.map((t) => t.name)).size).toBe(AGENT_TOOLS.length);
  });

  it("exposes Qloo tools only for verified operations (no raw rank, no compare_audiences)", () => {
    const names = AGENT_TOOLS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["qloo_resolve_entity", "qloo_find_tags", "qloo_get_entity_tags", "qloo_recommend", "qloo_related_entities"]));
    expect(names).not.toContain("qloo_rank");
    expect(names).not.toContain("qloo_compare_audiences");
    expect(names.some((n) => /shell|exec|write|file|git|deploy|send|delete|publish/u.test(n))).toBe(false);
  });

  it("allows only read-only and local permission classes", () => {
    expect(AGENT_ALLOWED_PERMISSIONS).toEqual(["read_only_external", "local_computation"]);
  });
});

describe("tool executor validation", () => {
  it("rejects unknown tools", async () => {
    const state = freshState();
    expect(await exec(state, scripted(), "run_shell", { cmd: "ls" })).toMatchObject({ accepted: false, code: "UNKNOWN_TOOL" });
    expect(state.trace.toolCalls.at(-1)).toMatchObject({ status: "rejected", error: "UNKNOWN_TOOL" });
  });

  it("rejects unauthorized permission classes even if registered", async () => {
    const sideEffect: AgentTool<Record<string, never>> = { name: "write_file", description: "SYNTHETIC side-effect tool used only to test refusal", permission: "side_effect", inputSchema: z.strictObject({}), maxQlooCalls: 0, phases: ["PLANNING"], execute: async () => ({ status: "ok", summary: "should never run" }) };
    const reg = new ToolRegistry([...AGENT_TOOLS, sideEffect as never]);
    const state = freshState();
    const result = await executeToolCall(state, reg, scripted(), "write_file", {});
    expect(result).toMatchObject({ accepted: false, code: "UNAUTHORIZED_TOOL" });
  });

  it("rejects invalid arguments, wrong phases and unmet preconditions", async () => {
    const state = freshState();
    const provider = scripted();
    expect(await exec(state, provider, "interpret_request", { intent: "nope", brand: "b", territories: [] })).toMatchObject({ code: "INVALID_ARGUMENTS" });
    expect(await exec(state, provider, "qloo_find_tags", { query: "x" })).toMatchObject({ code: "WRONG_PHASE" });
    await exec(state, provider, "interpret_request", { intent: "analyze_move", brand: "Northwind Atelier", territories: ["Tableware"] });
    expect(await exec(state, provider, "anchor_territory", { territoryKey: "tableware", tagId: "urn:tag:invented:syn:x" })).toMatchObject({ code: "PRECONDITION" });
    expect(await exec(state, provider, "qloo_resolve_entity", { name: "Northwind Atelier", type: "brand", role: "brand", extra: true })).toMatchObject({ code: "INVALID_ARGUMENTS" });
  });

  it("rejects a Qloo tool when the budget is spent and never exceeds it", async () => {
    const state = freshState({}, { maxQlooCalls: 1 });
    const provider = scripted();
    await exec(state, provider, "interpret_request", { intent: "analyze_move", brand: "Northwind Atelier", territories: ["Tableware"] });
    expect(await exec(state, provider, "qloo_resolve_entity", { name: "Northwind Atelier", type: "brand", role: "brand" })).toMatchObject({ accepted: true });
    expect(await exec(state, provider, "qloo_find_tags", { query: "Tableware" })).toMatchObject({ accepted: false, code: "BUDGET_EXHAUSTED" });
    expect(state.usage.qlooCalls).toBe(1);
  });

  it("answers identical Qloo requests from the run cache", async () => {
    const { state, provider } = await resolved();
    const before = state.usage.qlooCalls;
    await exec(state, provider, "qloo_find_tags", { query: "Tableware", limit: 8 });
    await exec(state, provider, "qloo_find_tags", { query: "Tableware", limit: 8 });
    expect(state.usage.qlooCalls).toBe(before + 1);
  });

  it("refuses Qloo tools once deterministic sufficiency says SUFFICIENT", async () => {
    const { state, provider } = await resolved("analyze_move", ["Tableware"]);
    state.results.set("tableware", { analysisRoute: "PARTIAL_CULTURAL_ANALYSIS", key: "tableware", role: "target" } as never);
    findTerritory(state, "tableware")!.status = "analyzed";
    expect(assessEvidenceSufficiency(state).verdict).toBe("SUFFICIENT");
    expect(await exec(state, provider, "qloo_find_tags", { query: "more" })).toMatchObject({ code: "EVIDENCE_SUFFICIENT" });
  });
});

describe("representation validation", () => {
  it("accepts exemplars Qloo links to the concept through brand-independent evidence", async () => {
    const { state, provider } = await resolved();
    await anchorWithPool(state, provider, "tableware", "urn:tag:industry:syn:tableware");
    const result = await exec(state, provider, "validate_territory_representation", { territoryKey: "tableware", entityType: "brand", exemplars: [{ id: "SYN-BR-0201", reason: "craft" }, { id: "SYN-BR-0204", reason: "heritage" }, { id: "SYN-BR-0202", reason: "design" }] });
    expect(result).toMatchObject({ accepted: true, result: { status: "ok" } });
    const t = findTerritory(state, "tableware")!;
    expect(t.representation?.exemplars.map((e) => e.id)).toEqual(["SYN-BR-0201", "SYN-BR-0204", "SYN-BR-0202"]);
    expect(t.representation?.exemplars.every((e) => e.conceptSupport === "tag_member")).toBe(true);
    expect(planRepresentation(state, t).strategy).toBe("TAG_DERIVED_ENTITY_PANEL");
  });

  it("rejects each objective violation with its taxonomy code", async () => {
    const { state, provider } = await resolved();
    await anchorWithPool(state, provider, "boutique_hospitality", "urn:tag:industry:syn:boutique_stays");
    // An entity seen only in a brand-conditioned list, an unknown id, the brand, a mismatched entity, a name-family duplicate.
    await exec(state, provider, "qloo_recommend", { targetType: "brand", tagIds: ["urn:tag:industry:syn:boutique_stays"], conditionOnBrand: true, limit: 20 });
    await exec(state, provider, "qloo_resolve_entity", { name: "Voltclaw", type: "brand", role: "other" });
    const result = await exec(state, provider, "validate_territory_representation", {
      territoryKey: "boutique_hospitality",
      entityType: "brand",
      exemplars: [
        { id: "SYN-BR-0101", reason: "ok" },
        { id: "SYN-BR-0105", reason: "same family" },
        { id: "SYN-BR-9999", reason: "invented" },
        { id: BRAND, reason: "brand" },
        { id: "SYN-BR-0501", reason: "unrelated" },
        { id: "SYN-BR-0101", reason: "twice" },
      ],
    });
    // More than maxExemplarsPerTerritory: the tool runs and the validation fails (one attempt used).
    expect(result).toMatchObject({ accepted: true, result: { status: "failed", errorCode: "INSUFFICIENT_EXEMPLARS" } });
    const second = await exec(state, provider, "validate_territory_representation", { territoryKey: "boutique_hospitality", entityType: "brand", exemplars: [{ id: "SYN-BR-0101", reason: "ok" }, { id: "SYN-BR-0105", reason: "family" }, { id: "SYN-BR-9999", reason: "invented" }] });
    const third = await exec(state, provider, "validate_territory_representation", { territoryKey: "boutique_hospitality", entityType: "place", exemplars: [{ id: BRAND, reason: "brand" }, { id: "SYN-BR-0501", reason: "unrelated" }] });
    expect(second).toMatchObject({ accepted: true, result: { status: "ok" } });
    expect(third).toMatchObject({ accepted: true, result: { status: "failed" } });
    const codes = findTerritory(state, "boutique_hospitality")!.rejectedExemplars.map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(["NEAR_DUPLICATE_EXEMPLAR", "ENTITY_UNRESOLVED", "BRAND_AS_EXEMPLAR", "MIXED_ENTITY_TYPES"]));
    // Attempts are bounded.
    expect(await exec(state, provider, "validate_territory_representation", { territoryKey: "boutique_hospitality", entityType: "brand", exemplars: [{ id: "SYN-BR-0102", reason: "x" }] })).toMatchObject({ code: "PRECONDITION" });
  });

  it("rejects exemplars chosen from a brand-conditioned list (the brand would pick its own comparators)", async () => {
    const { state, provider } = await resolved();
    await exec(state, provider, "qloo_find_tags", { query: "Furniture" });
    await exec(state, provider, "anchor_territory", { territoryKey: "furniture", tagId: "urn:tag:industry:syn:furniture" });
    await exec(state, provider, "qloo_recommend", { targetType: "brand", tagIds: ["urn:tag:industry:syn:furniture"], conditionOnBrand: true, limit: 20 });
    const result = await exec(state, provider, "validate_territory_representation", { territoryKey: "furniture", entityType: "brand", exemplars: [{ id: "SYN-BR-0301", reason: "x" }] });
    expect(result).toMatchObject({ accepted: true, result: { status: "failed", errorCode: "BRAND_CONDITIONED_SELECTION" } });
  });

  it("accepts an exemplar whose own tag profile carries the concept (profile support)", async () => {
    const { state, provider } = await resolved();
    await exec(state, provider, "qloo_find_tags", { query: "Furniture" });
    await exec(state, provider, "anchor_territory", { territoryKey: "furniture", tagId: "urn:tag:industry:syn:furniture" });
    await exec(state, provider, "qloo_resolve_entity", { name: "Oakline Studio", type: "brand", role: "other" });
    await exec(state, provider, "qloo_get_entity_tags", { entityId: "SYN-BR-0301" });
    const result = await exec(state, provider, "validate_territory_representation", { territoryKey: "furniture", entityType: "brand", exemplars: [{ id: "SYN-BR-0301", reason: "named design studio" }] });
    expect(result).toMatchObject({ accepted: true, result: { status: "ok" } });
    expect(findTerritory(state, "furniture")!.representation!.exemplars[0]!.conceptSupport).toBe("profile_tag");
    expect(planRepresentation(state, findTerritory(state, "furniture")!).strategy).toBe("ENTITY_PANEL");
  });

  it("chooses strategies from observed structure, not names", async () => {
    const { state, provider } = await resolved("compare_territories", ["Slow Travel", "Moonlight Rituals", "Quantum Gastronomy"]);
    await anchorWithPool(state, provider, "slow_travel", "urn:tag:interests:syn:slow_travel", "brand");
    expect(planRepresentation(state, findTerritory(state, "slow_travel")!).strategy).toBe("DESCRIPTIVE_ONLY");
    await exec(state, provider, "qloo_recommend", { targetType: "place", tagIds: ["urn:tag:interests:syn:slow_travel"], conditionOnBrand: false, limit: 20 });
    expect(planRepresentation(state, findTerritory(state, "slow_travel")!)).toMatchObject({ strategy: "CONDITIONED_ENTITY_EVIDENCE", entityType: "place" });
    await exec(state, provider, "validate_territory_representation", { territoryKey: "slow_travel", entityType: "place", exemplars: [{ id: "SYN-PL-0002", reason: "x" }, { id: "SYN-PL-0003", reason: "y" }] });
    expect(planRepresentation(state, findTerritory(state, "slow_travel")!).strategy).toBe("PLACE_PANEL");
    expect(planRepresentation(state, findTerritory(state, "quantum_gastronomy")!).strategy).toBe("UNSUPPORTED");
  });
});

describe("candidate discovery and deduplication", () => {
  it("lists eligible exemplar candidates by popularity, excluding the brand", async () => {
    const { state, provider } = await resolved("analyze_move", ["Fashion"]);
    await anchorWithPool(state, provider, "fashion", "urn:tag:industry:syn:fashion");
    const { eligible } = exemplarCandidates(state, "urn:tag:industry:syn:fashion", "brand");
    expect(eligible.map((c) => c.id)).not.toContain(BRAND);
    expect(eligible.map((c) => c.label)).toEqual(["Calder & Finch", "Rue Solenne", "Ostra Label"]);
  });

  it("detects name families without false positives on shared first words", () => {
    expect(labelFamily("Larkspur Hotels", "Larkspur Hotels Collection")).toBe(true);
    expect(labelFamily("Brand", "brand")).toBe(true);
    expect(labelFamily("Royal Alpha", "Royal Beta")).toBe(false);
  });

  it("refuses two territories on one concept and flags near-duplicate pools", async () => {
    const { state, provider } = await resolved("compare_territories", ["Boutique Hospitality", "Design Hotels", "Furniture"]);
    await anchorWithPool(state, provider, "boutique_hospitality", "urn:tag:industry:syn:boutique_stays");
    await exec(state, provider, "qloo_find_tags", { query: "Design Stays" });
    expect(await exec(state, provider, "anchor_territory", { territoryKey: "design_hotels", tagId: "urn:tag:industry:syn:boutique_stays" })).toMatchObject({ code: "PRECONDITION" });
    await anchorWithPool(state, provider, "design_hotels", "urn:tag:industry:syn:design_stays");
    const findings = conceptDuplicates(state, activeTerritories(state));
    // Both are user targets: the near-duplicate is reported (structural layer), never silently dropped.
    expect(findings).toEqual([expect.objectContaining({ a: expect.objectContaining({ key: "boutique_hospitality" }), b: expect.objectContaining({ key: "design_hotels" }), verdict: "NEAR_DUPLICATE", layer: "structural", action: "warned" })]);
  });

  it("derives frontier concepts only from observed related-entity profiles", async () => {
    const { state, provider } = await resolved("explore_frontier", [], "Kestrel Outfitters");
    expect(frontierConcepts(state)).toEqual([]);
    await exec(state, provider, "qloo_get_entity_tags", { entityId: "SYN-BR-0002" });
    await exec(state, provider, "qloo_related_entities", { entityId: "SYN-BR-0002", targetType: "brand", limit: 5 });
    for (const id of state.related[0]!.memberIds.slice(0, 3)) await exec(state, provider, "qloo_get_entity_tags", { entityId: id });
    const concepts = frontierConcepts(state).map((c) => c.label);
    expect(concepts).toEqual(["Cabin Culture", "Sailing", "Trail Gear"]);
    const brandTags = new Set(state.profiles.get("SYN-BR-0002")!.tagIds);
    for (const c of frontierConcepts(state)) expect(brandTags.has(c.tagId)).toBe(false);
  });

  it("rejects frontier hypotheses outside explore_frontier and evidence tags not observed", async () => {
    const { state, provider } = await resolved("analyze_move", ["Tableware"]);
    expect(await exec(state, provider, "propose_territory", { label: "X", role: "frontier_candidate", origin: "agent_hypothesis", rationale: "r" })).toMatchObject({ code: "PRECONDITION" });
    expect(await exec(state, provider, "propose_territory", { label: "X", role: "reference", origin: "qloo_evidence", rationale: "r", evidenceTagIds: ["urn:tag:keyword:syn:invented"] })).toMatchObject({ code: "PRECONDITION" });
    expect(await exec(state, provider, "propose_territory", { label: "tableware", role: "reference", origin: "agent_hypothesis", rationale: "r" })).toMatchObject({ code: "PRECONDITION" });
  });
});

describe("evidence sufficiency", () => {
  it("walks MORE_EVIDENCE_USEFUL → NEEDS_USER_INPUT / INSUFFICIENT / BUDGET_EXHAUSTED deterministically", async () => {
    const state = freshState();
    const provider = scripted();
    expect(assessEvidenceSufficiency(state).verdict).toBe("MORE_EVIDENCE_USEFUL");
    await exec(state, provider, "interpret_request", { intent: "analyze_move", brand: "Meridian", territories: ["Tableware"] });
    await exec(state, provider, "qloo_resolve_entity", { name: "Meridian", type: "brand", role: "brand" });
    expect(assessEvidenceSufficiency(state).verdict).toBe("NEEDS_USER_INPUT");

    const missing = freshState();
    await exec(missing, provider, "interpret_request", { intent: "analyze_move", brand: "Nobody Brand", territories: ["Tableware"] });
    await exec(missing, provider, "qloo_resolve_entity", { name: "Nobody Brand", type: "brand", role: "brand" });
    expect(assessEvidenceSufficiency(missing).verdict).toBe("MORE_EVIDENCE_USEFUL");
    await exec(missing, provider, "qloo_resolve_entity", { name: "Nobody Brand Inc", type: "brand", role: "brand" });
    expect(assessEvidenceSufficiency(missing).verdict).toBe("INSUFFICIENT");

    const spent = freshState({}, { maxAgentIterations: 1 });
    spent.usage.iterations = 1;
    expect(assessEvidenceSufficiency(spent).verdict).toBe("BUDGET_EXHAUSTED");
  });

  it("resolves an ambiguity only through clear type evidence", async () => {
    const state = freshState();
    const provider = scripted();
    await exec(state, provider, "interpret_request", { intent: "analyze_move", brand: "Harbor", territories: ["Tableware"] });
    const result = await exec(state, provider, "qloo_resolve_entity", { name: "Harbor", type: "brand", role: "brand" });
    expect(result).toMatchObject({ accepted: true, result: { status: "ok" } });
    expect(state.brand.entity).toMatchObject({ id: "SYN-BR-0007", resolution: "unconfirmed", match: "type_evidence" });
    expect(state.flags.map((f) => f.code)).toContain("BRAND_RESOLVED_BY_TYPE_EVIDENCE");
  });
});
