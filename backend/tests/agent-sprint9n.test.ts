/**
 * Sprint 9N: comparison-feasibility/v1, type-evidence reference ordering, bounded reference probing, thin-panel
 * discovery, reference co-occurrence dedup, the agent-facing feasibility view and the rollback switch.
 * SYNTHETIC world (fictional SYN- entities); not Qloo evidence.
 */
import { describe, expect, it } from "vitest";
import { feasibilityPolicyFromEnv } from "../src/api/agent.js";
import { structuralDuplicate } from "../src/agent/concept-dedup.js";
import { buildDecisionContext } from "../src/agent/context.js";
import { assessComparisonFeasibility, DEFERRAL_TURN_SLACK, referenceProbeRefusal } from "../src/agent/feasibility.js";
import { BaselinePolicyModel } from "../src/agent/model/baseline.js";
import { referenceCandidates, referencePlan, referenceProbeLedger, REFERENCE_EMPTY_PROBE_LIMIT, validTargetExemplars } from "../src/agent/reference-strategy.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { findTerritory, transition, type AgentRunState } from "../src/agent/state.js";
import { assessEvidenceSufficiency } from "../src/agent/evidence-sufficiency.js";
import { executeToolCall, valueOfToolCall } from "../src/agent/tool-executor.js";
import { ToolRegistry } from "../src/agent/tool-registry.js";
import { freshState, scripted } from "./fixtures/synthetic/agent.js";
import type { AgentAnalysisResult } from "@cultural-elasticity/shared";

const registry = new ToolRegistry();
const COFFEE = "urn:tag:cuisine:syn:coffee_houses";
const BAKERY = "urn:tag:category:synplace:bakery_culture";
const LANTERN = "urn:tag:category:synplace:lantern_markets";
const BRAND_GENRES_HALDEN = ["urn:tag:genre:synbrand:apothecary_fashion", "urn:tag:genre:synmedia:kitchen_tv", "urn:tag:genre:synmusic:bedroom_indie", "urn:tag:keyword:synmedia:slow_drama", "urn:tag:genre:synmedia:cookbook_shelf"];
const BRAND_GENRES_CORVID = ["urn:tag:genre:synbrand:capsule_wardrobe", "urn:tag:keyword:synmedia:city_life", "urn:tag:genre:synfilm:design_docs", "urn:tag:genre:synmusic:lofi_beats", "urn:tag:genre:synmedia:street_photo"];
const probe = (tag: string, type = "place") => ["qloo_recommend", { targetType: type, tagIds: [tag], conditionOnBrand: false, limit: 20 }] as const;

async function move(brand: string, territory: string, policy: "enforce" | "observe" = "enforce", iterations?: number) {
  const state = freshState({ brand, territories: [territory] }, iterations ? { maxAgentIterations: iterations } : undefined);
  state.feasibilityPolicy = policy;
  const provider = scripted();
  const exec = (tool: string, args: unknown) => executeToolCall(state, registry, provider, tool, args);
  await exec("interpret_request", { intent: "analyze_move", brand, territories: [territory] });
  transition(state, "RESOLVING", "test");
  await exec("qloo_resolve_entity", { name: brand, type: "brand", role: "brand" });
  transition(state, "INVESTIGATING", "test");
  await exec("qloo_find_tags", { query: territory, limit: 8 });
  return { state, exec };
}

/** Halden Apothecary → Coffee Houses with three validated place exemplars and the brand profile collected. */
async function coffeeRepresented(policy: "enforce" | "observe" = "enforce", iterations?: number) {
  const ctx = await move("Halden Apothecary", "Coffee Houses", policy, iterations);
  await ctx.exec(...probe(COFFEE));
  await ctx.exec("anchor_territory", { territoryKey: "coffee_houses", tagId: COFFEE });
  await ctx.exec("validate_territory_representation", { territoryKey: "coffee_houses", entityType: "place", exemplars: ["SYN-PL-9N01", "SYN-PL-9N02", "SYN-PL-9N03"].map((id) => ({ id, reason: "Qloo tag member" })) });
  await ctx.exec("qloo_get_entity_tags", { entityId: "SYN-BR-9N01" });
  return ctx;
}

/** Corvid Basics → Lantern Markets: Qloo has one place for the concept, so the panel has one validated exemplar. */
async function lanternRepresented(policy: "enforce" | "observe" = "enforce", brandProfile = true) {
  const ctx = await move("Corvid Basics", "Lantern Markets", policy);
  await ctx.exec(...probe(LANTERN));
  await ctx.exec("anchor_territory", { territoryKey: "lantern_markets", tagId: LANTERN });
  await ctx.exec("validate_territory_representation", { territoryKey: "lantern_markets", entityType: "place", exemplars: [{ id: "SYN-PL-9N31", reason: "only Qloo member" }] });
  if (brandProfile) await ctx.exec("qloo_get_entity_tags", { entityId: "SYN-BR-9N02" });
  return ctx;
}

/** The executor's value check for a reference probe (what a gated agent turn would get). */
const probeValue = (state: AgentRunState, tag: string, type = "place") => valueOfToolCall(state, "qloo_recommend", probe(tag, type)[1], assessEvidenceSufficiency(state));

describe("Sprint 9N comparison feasibility", () => {
  it("is not applicable to frontier exploration or a single hypothesis", async () => {
    const state = freshState({ brand: "Halden Apothecary" });
    await executeToolCall(state, registry, scripted(), "interpret_request", { intent: "explore_frontier", brand: "Halden Apothecary", territories: [] });
    expect(assessComparisonFeasibility(state)).toBeNull();
    const single = freshState({ brand: "Halden Apothecary", territories: ["Coffee Houses"], researchMode: "single_hypothesis_v1" });
    await executeToolCall(single, registry, scripted(), "interpret_request", { intent: "analyze_move", brand: "Halden Apothecary", territories: ["Coffee Houses"] });
    expect(assessComparisonFeasibility(single)).toBeNull();
  });

  it("is UNCERTAIN (not INFEASIBLE) while the target is only anchored", async () => {
    const { state, exec } = await move("Halden Apothecary", "Coffee Houses");
    await exec(...probe(COFFEE));
    await exec("anchor_territory", { territoryKey: "coffee_houses", tagId: COFFEE });
    const f = assessComparisonFeasibility(state)!;
    expect(f.status).toBe("UNCERTAIN");
    expect(f.blocker?.code).toBe("TARGET_NOT_REPRESENTED");
    expect(f.nextAction?.action).toBe("validate_territory_representation");
    expect(f.repeat).toBe("MAY_CHANGE");
  });

  it("names a thin target panel and does not spend calls on the lone exemplar's profile", async () => {
    const enforce = await lanternRepresented("enforce");
    expect(validTargetExemplars(enforce.state)).toBe(1);
    const f = assessComparisonFeasibility(enforce.state)!;
    expect(f.status).toBe("UNCERTAIN");
    expect(f.blocker?.code).toBe("THIN_TARGET_PANEL");
    // Before the brand profile is collected, discovery lists the profiles that could reveal candidates. With one validated
    // exemplar its profile cannot (its tags can be at most WEAK), so enforce lists only the brand; observe (9M) lists both.
    const early = await lanternRepresented("enforce", false);
    expect(referencePlan(early.state).outstanding ?? "").toMatch(/Corvid Basics/u);
    expect(referencePlan(early.state).outstanding ?? "").not.toMatch(/Kestle Night Market/u);
    const observe = await lanternRepresented("observe", false);
    expect(referencePlan(observe.state).outstanding ?? "").toMatch(/Kestle Night Market/u);
  });

  it(`becomes INFEASIBLE / NO_REFERENCE_YIELD after ${REFERENCE_EMPTY_PROBE_LIMIT} empty reference probes, repeats, and refuses the next probe`, async () => {
    const { state, exec } = await lanternRepresented("enforce");
    for (const tag of BRAND_GENRES_CORVID.slice(0, REFERENCE_EMPTY_PROBE_LIMIT)) await exec(...probe(tag));
    expect(referenceProbeLedger(state)).toMatchObject({ empty: REFERENCE_EMPTY_PROBE_LIMIT, productive: 0 });
    const f = assessComparisonFeasibility(state)!;
    expect(f.status).toBe("INFEASIBLE");
    expect(f.blocker?.code).toBe("NO_REFERENCE_YIELD");
    expect(f.repeat).toBe("LIKELY_REPEATS");
    expect(f.nextAction?.action).toBe("analyze");
    expect(probeValue(state, BRAND_GENRES_CORVID[REFERENCE_EMPTY_PROBE_LIMIT]!)).toMatchObject({ value: "NONE", code: "COMPARISON_INFEASIBLE" });
  });

  it("the observe arm keeps the Sprint 9M flow (no probe limit, no refusal)", async () => {
    const { state, exec } = await lanternRepresented("observe");
    for (const tag of BRAND_GENRES_CORVID.slice(0, REFERENCE_EMPTY_PROBE_LIMIT)) await exec(...probe(tag));
    expect(referencePlan(state).blockedBy).not.toBe("NO_REFERENCE_YIELD");
    expect(referenceProbeRefusal(state, BRAND_GENRES_CORVID[4]!, "place")).toBeNull();
  });
});

describe("Sprint 9N type evidence and deferrals (live L-M1/L-M2)", () => {
  it("defers a type-less brand-profile probe while the validated exemplars' profiles are uncollected, with turn slack", async () => {
    const { state } = await coffeeRepresented("enforce");
    expect(probeValue(state, BRAND_GENRES_HALDEN[1]!)).toMatchObject({ value: "NONE", code: "REFERENCE_DISCOVERY_PENDING" });
    const observe = await coffeeRepresented("observe");
    expect(probeValue(observe.state, BRAND_GENRES_HALDEN[1]!).code).not.toBe("REFERENCE_DISCOVERY_PENDING");
  });

  it("ranks candidates observed on place profiles first once the exemplar profiles are collected", async () => {
    const { state, exec } = await coffeeRepresented("enforce");
    for (const id of ["SYN-PL-9N01", "SYN-PL-9N02", "SYN-PL-9N03"]) await exec("qloo_get_entity_tags", { entityId: id });
    const ranked = referenceCandidates(state).filter((c) => c.semantic.status === "MEANINGFUL");
    const firstTypeless = ranked.findIndex((c) => c.typeEvidence === 0);
    const lastTyped = ranked.map((c) => c.typeEvidence > 0).lastIndexOf(true);
    expect(lastTyped).toBeGreaterThanOrEqual(0);
    expect(firstTypeless === -1 || lastTyped < firstTypeless).toBe(true);
    expect(ranked.find((c) => c.tagId === BAKERY)?.typeEvidence).toBeGreaterThanOrEqual(2);
    // A type-less brand genre is deferred while enough type-evidenced candidates are unprobed; a typed one is not.
    expect(probeValue(state, BRAND_GENRES_HALDEN[2]!)).toMatchObject({ value: "NONE", code: "REFERENCE_TYPE_EVIDENCE_PENDING" });
    expect(referenceProbeRefusal(state, BAKERY, "place")).toBeNull();
  });

  it(`never defers without ${DEFERRAL_TURN_SLACK} turns of slack (live L-C2: references found late must be built at once)`, async () => {
    const { state } = await coffeeRepresented("enforce", 5);
    state.usage.iterations = 4;
    // With one turn left the plan itself may be infeasible (then COMPARISON_INFEASIBLE is correct); a deferral never applies.
    expect(["REFERENCE_DISCOVERY_PENDING", "REFERENCE_TYPE_EVIDENCE_PENDING"]).not.toContain(referenceProbeRefusal(state, BRAND_GENRES_HALDEN[3]!, "place")?.code);
  });

  it("never applies to the target's own concept or another entity type", async () => {
    const { state } = await coffeeRepresented("enforce");
    expect(referenceProbeRefusal(state, COFFEE, "place")).toBeNull();
    expect(referenceProbeRefusal(state, BRAND_GENRES_HALDEN[0]!, "brand")).toBeNull();
  });
});

describe("Sprint 9N reference co-occurrence (AGENTS 5A.2 rule 4 applied to references)", () => {
  it("co-occurrence only in the target's exemplar profiles is not duplication; pool overlap still is", async () => {
    const enforce = await coffeeRepresented("enforce");
    for (const id of ["SYN-PL-9N01", "SYN-PL-9N02", "SYN-PL-9N03"]) await enforce.exec("qloo_get_entity_tags", { entityId: id });
    const target = findTerritory(enforce.state, "coffee_houses")!;
    const pseudo = { key: `ref:${BAKERY}`, label: "Bakery Culture", role: "reference", concept: { id: BAKERY, label: "Bakery Culture", type: "urn:tag:category:synplace" }, representation: null } as unknown as Parameters<typeof structuralDuplicate>[2];
    expect(structuralDuplicate(enforce.state, target, pseudo)).toBeNull();
    const observe = await coffeeRepresented("observe");
    for (const id of ["SYN-PL-9N01", "SYN-PL-9N02", "SYN-PL-9N03"]) await observe.exec("qloo_get_entity_tags", { entityId: id });
    expect(structuralDuplicate(observe.state, findTerritory(observe.state, "coffee_houses")!, pseudo)?.verdict).toBe("NEAR_DUPLICATE");
    // A reference whose Qloo pool is the target's own pool stays a duplicate in both arms.
    const same = { ...pseudo, key: `ref:${COFFEE}`, concept: { id: COFFEE, label: "Coffee", type: "urn:tag:cuisine:syn" } } as unknown as Parameters<typeof structuralDuplicate>[2];
    expect(structuralDuplicate(enforce.state, target, same)?.verdict).toBe("NEAR_DUPLICATE");
  });
});

describe("Sprint 9N agent-facing feasibility and results", () => {
  it("shows focus.feasibility under enforce only, and lists meaningful candidates before the cut", async () => {
    const enforce = await coffeeRepresented("enforce");
    const context = buildDecisionContext(enforce.state, registry, null);
    expect(context.focus?.feasibility?.status).toBe("UNCERTAIN");
    expect(context.focus?.feasibility?.target).toMatch(/3 validated place exemplar/u);
    for (const c of context.evidence.referenceCandidates ?? []) expect(c.semantic).toBe("MEANINGFUL");
    const observe = await coffeeRepresented("observe");
    expect(buildDecisionContext(observe.state, registry, null).focus?.feasibility).toBeUndefined();
  });

  it("no tool or action lets the model write feasibility", () => {
    expect(registry.list().map((t) => t.name).filter((n) => /feasib/iu.test(n))).toEqual([]);
  });

  it("a completed comparative run records the assessment taken before the target was analyzed", async () => {
    const runtime = new AgentRuntime({ model: new BaselinePolicyModel(), provider: scripted() });
    const r = (await runtime.run({ userQuery: "Could Corvid Basics move into lantern markets?", brand: "Corvid Basics", territories: ["Lantern Markets"] })) as AgentAnalysisResult;
    expect(r.comparisonFeasibility?.status).toBe("INFEASIBLE");
    expect(r.comparisonFeasibility?.rulesVersion).toBe("comparison-feasibility/v1");
    expect(r.comparisonFeasibility?.stopReasons.join(" ")).not.toMatch(/already analyzed/u);
    expect(r.territories.find((t) => t.key === "lantern_markets")?.classification).toBeNull();
    expect((r.trace.feasibility ?? []).length).toBeGreaterThan(0);
  });

  it("CE_FEASIBILITY_POLICY defaults to enforce; only 'observe' rolls back", () => {
    expect(feasibilityPolicyFromEnv({})).toBe("enforce");
    expect(feasibilityPolicyFromEnv({ CE_FEASIBILITY_POLICY: "observe" })).toBe("observe");
    expect(feasibilityPolicyFromEnv({ CE_FEASIBILITY_POLICY: "off" })).toBe("enforce");
  });
});
