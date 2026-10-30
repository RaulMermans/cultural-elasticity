/**
 * Sprint 4: skills, just-in-time context, decision validation, representation quality, concept dedup,
 * sufficiency v2, reference strategy, frontier stability, context security, claims v2, result layers.
 * SYNTHETIC world only (fictional names, SYN- ids); no network, no model.
 */
import type { AgentAnalysisResult } from "@cultural-elasticity/shared";
import { describe, expect, it } from "vitest";
import { validateClaims } from "../src/agent/claim-validator.js";
import { canonicalTagName, conceptDuplicates, deterministicDuplicate } from "../src/agent/concept-dedup.js";
import { buildDecisionContext } from "../src/agent/context.js";
import { nextActionValues } from "../src/agent/evidence-sufficiency.js";
import { modelCostUsd } from "../src/agent/finalizer.js";
import { frontierStability } from "../src/agent/frontier.js";
import { AnthropicAgentModel } from "../src/agent/model/anthropic.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { BaselinePolicyModel } from "../src/agent/model/baseline.js";
import type { AgentDecisionContext, AgentModel } from "../src/agent/model/provider.js";
import { ScriptedAgentModel } from "../src/agent/model/scripted.js";
import { referenceCandidates } from "../src/agent/reference-strategy.js";
import { evaluateExemplarQuality } from "../src/agent/representation-quality.js";
import { exemplarCandidates } from "../src/agent/candidate-discovery.js";
import { SKILLS } from "../src/agent/skills/definitions.js";
import { SkillRegistry } from "../src/agent/skills/registry.js";
import { addTerritory, transition } from "../src/agent/state.js";
import { executeToolCall } from "../src/agent/tool-executor.js";
import { AGENT_TOOLS, ToolRegistry } from "../src/agent/tool-registry.js";
import { call, freshState, runtime, scripted } from "./fixtures/synthetic/agent.js";

const registry = new ToolRegistry();
const skills = new SkillRegistry();
const asResult = (r: unknown) => r as AgentAnalysisResult;

/** A state with the brand resolved (synthetic world) and the given territories named. */
async function resolved(intent: "analyze_move" | "compare_territories" | "explore_frontier", territories: string[], brand = "Velvet Tide") {
  const state = freshState({ brand, ...(territories.length && { territories }) });
  const provider = scripted();
  await executeToolCall(state, registry, provider, "interpret_request", { intent, brand, territories });
  transition(state, "RESOLVING", "test");
  await executeToolCall(state, registry, provider, "qloo_resolve_entity", { name: brand, type: "brand", role: "brand" });
  transition(state, "INVESTIGATING", "test");
  return { state, provider };
}
const exec = (s: Awaited<ReturnType<typeof resolved>>, tool: string, args: unknown) => executeToolCall(s.state, registry, s.provider, tool, args);
const CAFE = "urn:tag:product_category:syn:cafe_culture";

async function cafeWithProfiles() {
  const s = await resolved("analyze_move", ["Cafe Culture"]);
  await exec(s, "qloo_find_tags", { query: "Cafe Culture", limit: 5 });
  await exec(s, "qloo_recommend", { targetType: "brand", tagIds: [CAFE], conditionOnBrand: false, limit: 20 });
  await exec(s, "anchor_territory", { territoryKey: "cafe_culture", tagId: CAFE });
  for (const id of ["SYN-BR-1401", "SYN-BR-1402", "SYN-BR-1403", "SYN-BR-1404"]) await exec(s, "qloo_get_entity_tags", { entityId: id });
  return s;
}

describe("runtime skills", () => {
  it("every skill is versioned, declares bounds, and only allows registered tools", () => {
    const tools = new Set(AGENT_TOOLS.map((t) => t.name));
    for (const s of SKILLS) {
      expect(Number.isInteger(s.version) && s.version >= 1, s.id).toBe(true);
      expect(s.budget.maxTurns, s.id).toBeGreaterThan(0);
      for (const t of s.allowedTools) expect(tools.has(t), `${s.id}: ${t}`).toBe(true);
      expect(s.evalIds.length, s.id).toBeGreaterThan(0);
      expect(s.failureModes.length, s.id).toBeGreaterThan(0);
    }
  });

  it("pins skill versions (a change to procedure, tools, stopping or output semantics must bump them)", () => {
    expect(Object.fromEntries(SKILLS.map((s) => [s.id, s.version]))).toEqual({
      interpret_request: 1,
      resolve_brand: 1,
      // Sprint 5A bumps (see docs/sprint-5a/HAIKU_AGENT_RELIABILITY.md, Runtime Skills); Sprint 5A.1 bumps
      // (docs/sprint-5a1/INVESTIGATION_RELIABILITY.md): probing, alignment, completion, frontier discovery. Sprint 5A.2
      // bumps (docs/sprint-5a2/FRONTIER_RELIABILITY.md): evidence-ranked probe types, source-evidence anchoring.
      // Sprint 8D: Channel A evidence-base-first and hypotheses that do not fill the viable quota.
      // Sprint 9N bump (docs/sprint-9n/DISCOVERY_TO_DECISION_OPTIMIZATION.md): comparison feasibility, type evidence,
      // bounded reference probing; eval evidence in `pnpm eval:d2d`.
      // Sprint 11 bump (docs/sprint-11/RESEARCH_INTELLIGENCE_UPGRADE.md): research policy v1 — concept alignment at
      // anchoring, intent-judged exemplars, reframe_research; eval evidence in tests/agent-sprint11.test.ts.
      resolve_territory: 6,
      build_territory_representation: 5,
      build_comparison_set: 6,
      explore_candidate_territories: 6,
      analyze_territories: 4,
    });
  });

  it("selects skills just in time from state, and exposes only their tools", async () => {
    const planning = freshState({ brand: "Velvet Tide", territories: ["Cafe Culture"] });
    expect(skills.select(planning).map((s) => s.id)).toEqual(["interpret_request"]);
    expect(skills.exposure(planning, registry).tools).toEqual(["interpret_request"]);
    const s = await resolved("analyze_move", ["Cafe Culture"]);
    expect(skills.select(s.state).map((x) => x.id)).toEqual(["resolve_territory"]);
    const exposed = skills.exposure(s.state, registry);
    expect(exposed.tools.sort()).toEqual(["anchor_territory", "drop_territory", "qloo_find_tags", "qloo_recommend"]);
    expect(exposed.actions).toEqual(["ask_user"]);
    await exec(s, "qloo_find_tags", { query: "Cafe Culture", limit: 5 });
    await exec(s, "qloo_recommend", { targetType: "brand", tagIds: [CAFE], conditionOnBrand: false, limit: 20 });
    await exec(s, "anchor_territory", { territoryKey: "cafe_culture", tagId: CAFE });
    expect(skills.select(s.state).map((x) => x.id)).toEqual(["build_territory_representation"]);
    expect(skills.exposure(s.state, registry).actions).toEqual([]);
  });

  it("refuses a tool the active skills do not expose (runtime controls availability)", async () => {
    const s = await resolved("analyze_move", ["Cafe Culture"]);
    const active = skills.select(s.state);
    const gate = { skills, active, exposed: new Set(skills.exposure(s.state, registry, active).tools), actions: [] };
    const out = await executeToolCall(s.state, registry, s.provider, "validate_territory_representation", { territoryKey: "cafe_culture", entityType: "brand", exemplars: [{ id: "SYN-BR-1401", reason: "r" }] }, undefined, gate);
    expect(out).toMatchObject({ accepted: false, code: "NOT_EXPOSED" });
  });

  it("traces skill ids and versions per turn and per tool call, with context size and exposed tools", async () => {
    const r = asResult(await runtime().runtime.run({ userQuery: "q", brand: "Velvet Tide", territories: ["Cafe Culture"] }));
    expect(r.skillsUsed.map((s) => s.id)).toEqual(expect.arrayContaining(["interpret_request", "resolve_brand", "resolve_territory", "build_territory_representation", "analyze_territories"]));
    for (const t of r.trace.turns) {
      expect(t.skills!.length).toBeGreaterThan(0);
      expect(t.contextChars).toBeGreaterThan(0);
      expect(t.toolsExposed!.length).toBeGreaterThan(0);
    }
    const qlooCalls = r.trace.toolCalls.filter((c) => c.permission === "read_only_external" && c.status !== "rejected" && c.iteration > 0 && !["analyze_evidence", "build_candidate_panel"].includes(c.tool));
    for (const c of qlooCalls) expect(c.skill, c.tool).toMatchObject({ id: expect.any(String), version: expect.any(Number) });
    expect(r.trace.skillUsage.length).toBe(r.skillsUsed.length);
  });
});

describe("decision validation (runtime wins every conflict)", () => {
  const steps = (...turns: unknown[][]) => new ScriptedAgentModel(turns as never);
  const move = [call("interpret_request", { intent: "analyze_move", brand: "Velvet Tide", territories: ["Cafe Culture"] })];
  const brand = [call("qloo_resolve_entity", { name: "Velvet Tide", type: "brand", role: "brand" })];

  it("hallucinated tools are refused as UNKNOWN_TOOL", async () => {
    const r = asResult(await runtime(steps(move, [call("qloo_magic_search", { q: "x" })], [call("qloo_magic_search", { q: "x" })])).runtime.run({ userQuery: "q" }));
    expect(r.metrics.unknown_tool_attempts).toBeGreaterThan(0);
    expect(r.trace.turns[1]!.decisions[0]!.rejection).toMatch(/^UNKNOWN_TOOL/u);
  });

  it("malformed output gets one bounded repair attempt, never a free retry loop", async () => {
    const model = new ScriptedAgentModel([{ invalid: "malformed JSON" }, move, brand]);
    const r = asResult(await runtime(model).runtime.run({ userQuery: "q" }));
    expect(r.trace.turns[0]).toMatchObject({ modelAttempts: 2, firstAttemptValid: false });
    expect(r.trace.turns[0]!.decisions.some((d) => d.accepted)).toBe(true);
    expect(r.trace.turns[0]!.repairReason).toMatch(/INVALID_MODEL_OUTPUT: malformed JSON/u);
    expect(r.metrics.repairs).toBeGreaterThanOrEqual(1);
    expect(r.metrics.model_attempts).toBe(r.metrics.model_turns + r.metrics.repairs);
  });

  it("an invalid territory id is refused", async () => {
    const r = asResult(await runtime(steps(move, brand, [call("anchor_territory", { territoryKey: "nowhere", tagId: CAFE })])).runtime.run({ userQuery: "q" }));
    expect(r.trace.turns[2]!.decisions[0]!.rejection).toMatch(/^PRECONDITION: unknown territory/u);
  });

  it("analysis before a representation exists is refused (NOT_READY)", async () => {
    const HOT = "urn:tag:interests:syn:hot_springs";
    const model = steps(
      [call("interpret_request", { intent: "compare_territories", brand: "Velvet Tide", territories: ["Cafe Culture", "Hot Springs"] })],
      brand,
      [call("qloo_find_tags", { query: "Cafe Culture", limit: 5 }), call("qloo_find_tags", { query: "Hot Springs", limit: 5 })],
      [call("qloo_recommend", { targetType: "brand", tagIds: [CAFE], conditionOnBrand: false, limit: 20 }), call("anchor_territory", { territoryKey: "cafe_culture", tagId: CAFE }), call("anchor_territory", { territoryKey: "hot_springs", tagId: HOT })],
      [call("declare_concept_only", { territoryKey: "hot_springs", reason: "concept-level only" })],
      [{ action: "analyze", targetIds: ["cafe_culture", "hot_springs"], reasonSummary: "too early for cafe culture" }],
    );
    const r = asResult(await runtime(model).runtime.run({ userQuery: "q" }));
    const analyze = r.trace.turns.flatMap((t) => t.decisions).find((d) => d.action === "analyze")!;
    expect(analyze.rejection).toMatch(/^NOT_READY: not ready for analysis: cafe_culture/u);
  });

  it("finish before sufficiency is refused while a territory-level blocker remains", async () => {
    const compare = [call("interpret_request", { intent: "compare_territories", brand: "Velvet Tide", territories: ["Cafe Culture", "Hot Springs"] })];
    const r = asResult(
      await runtime(
        steps(
          compare,
          brand,
          [call("qloo_find_tags", { query: "Cafe Culture", limit: 5 })],
          [call("qloo_recommend", { targetType: "brand", tagIds: [CAFE], conditionOnBrand: false, limit: 20 }), call("anchor_territory", { territoryKey: "cafe_culture", tagId: CAFE }), call("declare_concept_only", { territoryKey: "cafe_culture", reason: "r" })],
          [{ action: "analyze", targetIds: ["cafe_culture"], reasonSummary: "a" }],
          [{ action: "finish", resultIds: ["cafe_culture"], reasonSummary: "stop early" }],
        ),
      ).runtime.run({ userQuery: "q" }),
    );
    // Hot Springs was never searched in Qloo: finishing now would silently skip a named territory.
    const finish = r.trace.turns.flatMap((t) => t.decisions).find((d) => d.action === "finish" && d.reasonSummary === "stop early")!;
    expect(finish.rejection).toMatch(/^FINISH_BEFORE_SUFFICIENCY: .*hot_springs/u);
  });

  it("repeated useless actions are refused and counted as avoided calls", async () => {
    const s = await resolved("analyze_move", ["Cafe Culture"]);
    const active = skills.select(s.state);
    const gate = { skills, active, exposed: new Set(skills.exposure(s.state, registry, active).tools), actions: [] };
    expect(await executeToolCall(s.state, registry, s.provider, "qloo_find_tags", { query: "Cafe Culture", limit: 5 }, undefined, gate)).toMatchObject({ accepted: true });
    expect(await executeToolCall(s.state, registry, s.provider, "qloo_find_tags", { query: "Cafe Culture", limit: 5 }, undefined, gate)).toMatchObject({ accepted: false, code: "DUPLICATE_ACTION" });
    expect(await executeToolCall(s.state, registry, s.provider, "qloo_find_tags", { query: "cafe culture", limit: 3 }, undefined, gate)).toMatchObject({ accepted: false, code: "NO_VALUE_ACTION" });
    expect(s.state.trace.earlyStops.reduce((n, e) => n + e.callsAvoided, 0)).toBe(2);
  });

  it("actions exceeding the Qloo budget or a skill budget are refused", async () => {
    const s = await resolved("analyze_move", ["Cafe Culture"]);
    s.state.limits.maxQlooCalls = s.state.usage.qlooCalls;
    expect(await exec(s, "qloo_find_tags", { query: "Cafe Culture", limit: 5 })).toMatchObject({ accepted: false, code: "BUDGET_EXHAUSTED" });
    s.state.limits.maxQlooCalls = 99;
    const active = skills.select(s.state);
    s.state.skillUsage.set("resolve_territory", { skill: { id: "resolve_territory", version: 2 }, turns: 0, qlooCalls: 8, toolCalls: 8, exhausted: false });
    const gate = { skills, active, exposed: new Set(skills.exposure(s.state, registry, active).tools), actions: [] };
    expect(await executeToolCall(s.state, registry, s.provider, "qloo_find_tags", { query: "Cafe Culture", limit: 5 }, undefined, gate)).toMatchObject({ accepted: false, code: "SKILL_BUDGET_EXHAUSTED" });
  });

  it("the iteration budget still bounds a model that never stops", async () => {
    const forever = () => [call("qloo_find_tags", { query: `x${Math.random()}` })];
    const model = new ScriptedAgentModel([move, brand, ...Array.from({ length: 40 }, () => forever)]);
    const r = asResult(await runtime(model).runtime.run({ userQuery: "q", limits: { maxAgentIterations: 5 } }));
    expect(r.metrics.agent_iterations).toBeLessThanOrEqual(5);
  });
});

describe("RepresentationQualityEvaluator", () => {
  it("flags a peer outlier as WEAK (never primary) and keeps peers VALID", async () => {
    const s = await cafeWithProfiles();
    const eligible = exemplarCandidates(s.state, CAFE, "brand").eligible;
    const base = { conceptId: CAFE, conceptLabel: "Cafe Culture", entityType: "brand" as const, eligible, acceptedSoFar: [], usedElsewhere: new Map(), semantic: null };
    const outlier = evaluateExemplarQuality(s.state, { ...base, candidateId: "SYN-BR-1404" });
    expect(outlier.final).toBe("WEAK");
    expect(outlier.deterministic.reasons.join(" ")).toMatch(/PEER_OUTLIER/u);
    expect(evaluateExemplarQuality(s.state, { ...base, candidateId: "SYN-BR-1401" }).final).toBe("VALID");
    const out = await exec(s, "validate_territory_representation", { territoryKey: "cafe_culture", entityType: "brand", exemplars: [{ id: "SYN-BR-1404", reason: "popular" }, { id: "SYN-BR-1401", reason: "r" }] });
    expect(out.accepted && s.state.territories[0]!.representation!.exemplars.map((e) => [e.label, e.quality])).toEqual([
      ["Kettle & Crema", "VALID"],
      ["Voltrush Energy", "WEAK"],
    ]);
  });

  it("combines deterministic signals and the advisory model judgment by explicit rules", async () => {
    const s = await cafeWithProfiles();
    const eligible = exemplarCandidates(s.state, CAFE, "brand").eligible;
    const base = { conceptId: CAFE, conceptLabel: "Cafe Culture", entityType: "brand" as const, eligible, acceptedSoFar: [], usedElsewhere: new Map() };
    expect(evaluateExemplarQuality(s.state, { ...base, candidateId: "SYN-BR-1401", semantic: { relevance: "MISMATCH", reason: "r" } })).toMatchObject({ final: "REJECT", rule: expect.stringMatching(/^R2/u) });
    expect(evaluateExemplarQuality(s.state, { ...base, candidateId: "SYN-BR-1404", semantic: { relevance: "WEAK", reason: "r" } })).toMatchObject({ final: "REJECT", rule: expect.stringMatching(/^R3/u) });
    expect(evaluateExemplarQuality(s.state, { ...base, candidateId: "SYN-BR-1401", semantic: { relevance: "WEAK", reason: "r" } })).toMatchObject({ final: "WEAK", rule: expect.stringMatching(/^R5/u) });
    // A STRONG model judgment cannot rescue a hard failure: the brand itself, or an entity Qloo never returned.
    expect(evaluateExemplarQuality(s.state, { ...base, candidateId: "SYN-BR-0008", semantic: { relevance: "STRONG", reason: "r" } })).toMatchObject({ final: "REJECT", rule: expect.stringMatching(/^R1/u) });
    expect(evaluateExemplarQuality(s.state, { ...base, candidateId: "SYN-BR-7777", semantic: { relevance: "STRONG", reason: "r" } }).deterministic.hardCode).toBe("ENTITY_UNRESOLVED");
  });

  it("stores the model judgment apart from Qloo evidence, and refuses a weak-only panel", async () => {
    const s = await cafeWithProfiles();
    const out = await exec(s, "validate_territory_representation", { territoryKey: "cafe_culture", entityType: "brand", exemplars: [{ id: "SYN-BR-1404", reason: "r", semantic: { relevance: "adequate", reason: "popular" } }] });
    expect(out).toMatchObject({ accepted: true, result: { status: "failed", errorCode: "REPRESENTATION_QUALITY_WEAK" } });
    const d = s.state.trace.representationQuality.at(-1)!;
    expect(d.modelAssessment).toEqual({ relevance: "ADEQUATE", reason: "popular", advisory: true });
    expect(Object.keys(d.deterministic.signals)).not.toContain("relevance");
  });
});

describe("ConceptDeduplicator", () => {
  it("layer 1: same id, equal / plural labels and canonical tag names are DUPLICATE; word families NEAR_DUPLICATE", () => {
    expect(deterministicDuplicate({ label: "A", conceptId: "urn:tag:x:qloo:a" }, { label: "B", conceptId: "urn:tag:x:qloo:a" })?.verdict).toBe("DUPLICATE");
    expect(deterministicDuplicate({ label: "Coffee Shops", conceptId: null }, { label: "coffee shop", conceptId: null })?.verdict).toBe("DUPLICATE");
    expect(deterministicDuplicate({ label: "Coffee", conceptId: "urn:tag:keyword:qloo:coffee" }, { label: "Coffee Culture", conceptId: "urn:tag:lifestyle:qloo:coffee" })?.verdict).toBe("DUPLICATE");
    expect(canonicalTagName("urn:tag:keyword:qloo:coffee")).toBe("coffee");
    expect(deterministicDuplicate({ label: "Mountaineering", conceptId: null }, { label: "Mountaineers", conceptId: null })?.verdict).toBe("NEAR_DUPLICATE");
    expect(deterministicDuplicate({ label: "Bouldering", conceptId: null }, { label: "Boulderers", conceptId: null })?.verdict).toBe("NEAR_DUPLICATE");
    expect(deterministicDuplicate({ label: "Running", conceptId: null }, { label: "Rugby", conceptId: null })).toBeNull();
  });

  it("the model cannot override an exact duplicate, but may judge a word-family match distinct", async () => {
    const s = await resolved("explore_frontier", [], "Kestrel Outfitters");
    const a = addTerritory(s.state, { label: "Bouldering", role: "frontier_candidate", origin: "agent_hypothesis", rationale: "r" });
    const b = addTerritory(s.state, { label: "Boulderers", role: "frontier_candidate", origin: "agent_hypothesis", rationale: "r" });
    expect(conceptDuplicates(s.state, [a, b])[0]).toMatchObject({ verdict: "NEAR_DUPLICATE", action: "dropped", dropped: "boulderers" });
    s.state.dedupJudgments.push({ aKey: "bouldering", bKey: "boulderers", verdict: "DISTINCT", reason: "activity vs community" });
    expect(conceptDuplicates(s.state, [a, b])[0]).toMatchObject({ verdict: "DISTINCT", action: "kept", modelJudgment: { applied: true } });
    a.concept = { id: "urn:tag:x:syn:same", label: "x", type: "t" };
    b.concept = { id: "urn:tag:x:syn:same", label: "x", type: "t" };
    s.state.dedupJudgments.push({ aKey: "bouldering", bKey: "boulderers", verdict: "DISTINCT", reason: "insist" });
    expect(conceptDuplicates(s.state, [a, b])[0]).toMatchObject({ verdict: "DUPLICATE", modelJudgment: { applied: false } });
  });

  it("a proposal that exactly duplicates an existing territory is refused", async () => {
    const s = await resolved("explore_frontier", [], "Kestrel Outfitters");
    await exec(s, "propose_territory", { label: "Night Markets", role: "frontier_candidate", origin: "agent_hypothesis", rationale: "r" });
    expect(await exec(s, "propose_territory", { label: "night market", role: "frontier_candidate", origin: "agent_hypothesis", rationale: "r" })).toMatchObject({ accepted: false, code: "PRECONDITION" });
  });
});

describe("evidence sufficiency v2 (next-action value)", () => {
  it("values a fixed-cap tag request NONE, a second exemplar MEDIUM and a fourth LOW/NONE", async () => {
    const s = await cafeWithProfiles();
    await exec(s, "qloo_get_entity_tags", { entityId: "SYN-BR-0008" });
    expect(nextActionValues(s.state).find((a) => a.action === "more_brand_tags")?.value).toBe("NONE");
    await exec(s, "validate_territory_representation", { territoryKey: "cafe_culture", entityType: "brand", exemplars: [{ id: "SYN-BR-1401", reason: "r" }] });
    expect(nextActionValues(s.state).find((a) => a.action === "add_exemplar")?.value).toBe("MEDIUM");
  });

  it("without a material gap Qloo investigation is refused (early stop)", async () => {
    const s = await cafeWithProfiles();
    s.state.territories[0]!.conceptOnly = "test";
    s.state.interpretation = { ...s.state.interpretation!, intent: "compare_territories" };
    s.state.skillUsage.set("build_comparison_set", { skill: { id: "build_comparison_set", version: 1 }, turns: 9, qlooCalls: 0, toolCalls: 0, exhausted: true });
    const gate = { skills, active: SKILLS, exposed: new Set(AGENT_TOOLS.map((t) => t.name)), actions: [] };
    await executeToolCall(s.state, registry, s.provider, "qloo_get_entity_tags", { entityId: "SYN-BR-0008" }, undefined, gate);
    expect(await executeToolCall(s.state, registry, s.provider, "qloo_recommend", { targetType: "place", tagIds: [CAFE], conditionOnBrand: false, limit: 20 }, undefined, gate)).toMatchObject({ accepted: false, code: "EARLY_STOP" });
    expect(s.state.trace.earlyStops.at(-1)!.callsAvoided).toBe(1);
  });
});

describe("reference strategy", () => {
  it("derives justified references from structure and run evidence, refusing near-duplicates of the target", async () => {
    const r = asResult(await runtime().runtime.run({ userQuery: "q", brand: "Velvet Tide", territories: ["Cafe Culture"] }));
    const refs = r.territories.filter((t) => t.role === "reference");
    expect(refs.length).toBeGreaterThanOrEqual(2);
    for (const t of refs) expect(r.comparisonSetConstruction.proposed.find((p) => p.key === t.key)!.evidence).toMatch(/Qloo tag/u);
    expect(refs.map((t) => t.key)).not.toContain("espresso_ritual");
    // The brand's media-genre profile tags never become references (no members of the target's type).
    expect(refs.some((t) => t.resolvedConcept?.id.includes(":genre:"))).toBe(false);
  });

  it("ranks unproductive namespaces last once probes in them came back empty", async () => {
    const s = await cafeWithProfiles();
    await exec(s, "validate_territory_representation", { territoryKey: "cafe_culture", entityType: "brand", exemplars: [{ id: "SYN-BR-1401", reason: "r" }, { id: "SYN-BR-1402", reason: "r" }] });
    await exec(s, "qloo_get_entity_tags", { entityId: "SYN-BR-0008" });
    for (const tag of ["urn:tag:genre:syn:indie_film", "urn:tag:genre:syn:dream_pop"]) await exec(s, "qloo_recommend", { targetType: "brand", tagIds: [tag], conditionOnBrand: false, limit: 20 });
    const candidates = referenceCandidates(s.state);
    const genre = candidates.find((c) => c.tagId === "urn:tag:genre:syn:coming_of_age")!;
    expect(genre.namespaceYield).toBe("unproductive");
    expect(candidates.indexOf(genre)).toBeGreaterThan(candidates.findIndex((c) => c.namespace === "keyword:syn"));
    for (const c of candidates) expect(c.justification.length).toBeGreaterThan(0);
  });
});

describe("frontier set stability", () => {
  it("measures candidate, concept, top-candidate and classification stability across runs", () => {
    const run = (labels: [string, string, number | null, string | null][]) => ({ candidates: labels.map(([label, conceptId, position, classification]) => ({ key: label.toLowerCase(), label, conceptId, route: "FULL_RELATIVE_ANALYSIS", position, classification })) });
    const s = frontierStability([
      run([["Sailing", "c1", 1, "CREDIBLE_STRETCH"], ["Trail Gear", "c2", 2, "CULTURAL_BREAK"]]),
      run([["Sailing culture", "c1", 1, "CREDIBLE_STRETCH"], ["Cabins", "c3", 2, null]]),
    ]);
    expect(s.exactCandidateOverlap).toBe(0);
    expect(s.resolvedConceptOverlap).toBe(0.333);
    expect(s.topCandidateConsistency).toBe(1);
    expect(s.methodologyStability).toBe(1);
  });
});

describe("model context security", () => {
  it("never places credentials, environment values or benchmark labels in model context", async () => {
    // Sentinel values are built indirectly so no literal credential assignment exists in source.
    const names = ["QLOO", "ANTHROPIC"].map((p) => `${p}_API_KEY`);
    const saved = names.map((n) => process.env[n]);
    names.forEach((n, i) => (process.env[n] = ["sk", i === 0 ? "qloo" : "ant", "SENTINEL", String(123456 + i)].join("-")));
    try {
      const seen: AgentDecisionContext[] = [];
      const inner = new BaselinePolicyModel();
      const model: AgentModel = { info: inner.info, decide: (c) => (seen.push(c), inner.decide(c)) };
      await runtime(model).runtime.run({ userQuery: "Where could Kestrel Outfitters expand?", brand: "Kestrel Outfitters", territories: [] });
      const text = JSON.stringify(seen);
      expect(seen.length).toBeGreaterThan(3);
      expect(text).not.toMatch(/SENTINEL|API_KEY|sk-ant|sk-qloo|process\.env|QLOO_API_BASE_URL/u);
      expect(text).not.toMatch(/expected_(strong|mid|weak)|benchmark/iu);
    } finally {
      names.forEach((n, i) => {
        if (saved[i] === undefined) delete process.env[n];
        else process.env[n] = saved[i];
      });
    }
  });

  it("sends only the exposed tools and actions to the provider, and no prompt text in results", async () => {
    const requests: Record<string, unknown>[] = [];
    const client = { beta: { messages: { create: async (r: Record<string, unknown>) => (requests.push(r), { stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 5, cache_creation_input_tokens: 1 }, content: [] }) } } };
    const state = freshState({ brand: "Velvet Tide", territories: ["Cafe Culture"] });
    const context = buildDecisionContext(state, registry, null);
    const turn = await new AnthropicAgentModel({ client: client as never }).decide(context);
    expect((requests[0]!.tools as { name: string }[]).map((t) => t.name)).toEqual(["interpret_request", "ask_user"]);
    expect(turn.usage).toEqual({ inputTokens: 10, outputTokens: 2, cacheReadTokens: 5, cacheCreationTokens: 1 });
    expect(context.evidence).toEqual({});
  });
});

describe("just-in-time context", () => {
  it("includes only the sections the active skills need", async () => {
    const s = await resolved("analyze_move", ["Cafe Culture"]);
    const resolving = buildDecisionContext(s.state, registry, null);
    expect(Object.keys(resolving.evidence)).toEqual(["observedTags"]);
    expect(resolving.skills.map((x) => x.id)).toEqual(["resolve_territory"]);
    expect(resolving.territories[0]!.exemplarCandidates).toBeUndefined();
    await exec(s, "qloo_find_tags", { query: "Cafe Culture", limit: 5 });
    await exec(s, "qloo_recommend", { targetType: "brand", tagIds: [CAFE], conditionOnBrand: false, limit: 20 });
    await exec(s, "anchor_territory", { territoryKey: "cafe_culture", tagId: CAFE });
    const representing = buildDecisionContext(s.state, registry, null);
    expect(representing.territories[0]!.exemplarCandidates!.length).toBeGreaterThan(0);
    expect(representing.territories[0]!.recovery).toBeDefined();
    expect(representing.tools.map((t) => t.name)).not.toContain("qloo_related_entities");
    expect(JSON.stringify(representing)).not.toMatch(/"envelope"|correlation_id/u);
  });
});

describe("last-turn compaction (live regression)", () => {
  it("keeps a full 20-member Qloo pool readable (ids and labels), never a string preview", () => {
    // Live Qloo pools are 20 members with long labels; Sprint 4's first live run showed a string preview
    // made them unreadable, so the policy re-probed forever. Synthetic pools were too small to catch it.
    const state = freshState({ brand: "Velvet Tide", territories: ["Cafe Culture"] });
    const members = Array.from({ length: 20 }, (_, i) => ({ id: `SYN-BR-9${String(i).padStart(3, "0")}`, label: `A long synthetic member label number ${i} `.repeat(4), popularity: 0.5, isBrand: false }));
    const context = buildDecisionContext(state, registry, { results: [{ tool: "qloo_recommend", status: "ok", summary: "20 brand entities", data: { tagIds: [CAFE], targetType: "brand", conditionOnBrand: false, members } }], rejections: [] });
    const data = context.lastTurn!.results[0]!.data as { members: { id: string }[] };
    expect(data.members).toHaveLength(20);
    expect(data.members.map((m) => m.id)).toEqual(members.map((m) => m.id));
  });
});

describe("claim validation v2", () => {
  it("rejects commercial, causal and unknown-name claims and robustness wording that does not match", async () => {
    const r = asResult(await runtime().runtime.run({ userQuery: "q", brand: "Northwind Atelier", territories: ["Boutique Hospitality"] }));
    const synth = (summary: string) => ({ summary, territoryNotes: [], followUpOptions: [] });
    const v = (text: string) => validateClaims(synth(text), r.territories, ["Northwind Atelier"]).join(" ");
    expect(v("Boutique Hospitality would grow sales and market share.")).toMatch(/commercial-success/u);
    expect(v("Design culture drives the fit with Boutique Hospitality.")).toMatch(/causal/u);
    expect(v("Boutique Hospitality sits close to Specialty Coffee Bars.")).toMatch(/"Specialty Coffee Bars" is not a territory/u);
    expect(v("Boutique Hospitality is likely to work.")).toMatch(/probability/u);
    const low = r.territories.find((t) => t.robustness && (t.robustness.level === "LOW" || t.robustness.level === "INSUFFICIENT"));
    if (low) expect(v(`${low.label} holds a robust position.`)).toMatch(/robustness wording/u);
    expect(validateClaims({ summary: r.summary.text, territoryNotes: [], followUpOptions: r.followUpOptions }, r.territories, ["Northwind Atelier"])).toEqual([]);
  });
});

describe("result layers and comparison-set construction", () => {
  it("keeps Qloo evidence, system analysis and agent interpretation separate", async () => {
    const r = asResult(await runtime().runtime.run({ userQuery: "q", brand: "Kestrel Outfitters", territories: [] }));
    expect(r.layers.qlooEvidence.brand?.id).toBe("SYN-BR-0002");
    expect(r.layers.qlooEvidence.exemplars.every((e) => e.supportCorrelationId.length > 0)).toBe(true);
    expect(r.layers.systemAnalysis.routes.length).toBe(r.territories.length);
    expect(r.layers.agentInterpretation.source).toBe("deterministic_template");
    expect(r.comparisonSetConstruction.note).toMatch(/only for this comparison set/u);
    expect(r.comparisonSetConstruction.proposed.length).toBe(r.territories.length);
    expect(r.limitations.map((l) => l.code)).toContain("COMPARISON_SET_DEPENDENT");
  });

  it("prices provider usage only for a live model with a known price", () => {
    const s = freshState();
    s.usage.uncachedInputTokens = 1_000_000;
    s.usage.outputTokens = 100_000;
    expect(modelCostUsd(s)).toBeNull(); // scripted model
    s.model = { id: "claude-opus-5-5", kind: "llm", live: true };
    expect(modelCostUsd(s)).toBe(6);
  });
});

describe("reference eligibility (live regression)", () => {
  it("does not count the target's own exemplars (profile-tag support) as reference members", async () => {
    // Live Sprint 4 run: a media tag carried by two of the target's exemplar profiles was reported usable
    // although Qloo's brand-independent pool for it was empty.
    const s = await cafeWithProfiles();
    await exec(s, "validate_territory_representation", { territoryKey: "cafe_culture", entityType: "brand", exemplars: [{ id: "SYN-BR-1401", reason: "r" }, { id: "SYN-BR-1402", reason: "r" }] });
    await exec(s, "qloo_get_entity_tags", { entityId: "SYN-BR-0008" });
    // Espresso Ritual is carried by the exemplars' profiles; its pool is never probed here.
    const before = referenceCandidates(s.state).find((c) => c.tagId === "urn:tag:keyword:syn:espresso_ritual")!;
    expect(before.usable).toBeNull();
    await exec(s, "qloo_recommend", { targetType: "brand", tagIds: ["urn:tag:keyword:syn:espresso_ritual"], conditionOnBrand: false, limit: 20 });
    const after = referenceCandidates(s.state).find((c) => c.tagId === "urn:tag:keyword:syn:espresso_ritual")!;
    // Its pool holds the two exemplars plus one other cafe brand: one usable member is below the minimum.
    expect(after.probe?.eligible).toBe(1);
    expect(after.usable).toBe(false);
  });
});

describe("skill budgets (live regression)", () => {
  it("scale per territory, and a spent Qloo budget keeps local tools usable on gathered evidence", async () => {
    // Live Sprint 4 run: a fixed 14-call budget was spent probing three territories, the skill was deactivated,
    // and a territory Qloo had just returned 20 places for was never anchored.
    const s = await resolved("compare_territories", ["Cafe Culture", "Hot Springs", "Bouldering"]);
    const skill = skills.get("resolve_territory")!;
    expect(skills.qlooLimit(s.state, skill)).toBe(24);
    s.state.skillUsage.set("resolve_territory", { skill: { id: "resolve_territory", version: 2 }, turns: 1, qlooCalls: 24, toolCalls: 24, exhausted: false });
    await exec(s, "qloo_find_tags", { query: "Cafe Culture", limit: 5 });
    const active = skills.select(s.state);
    expect(active.map((x) => x.id)).toContain("resolve_territory");
    const gate = { skills, active, exposed: new Set(skills.exposure(s.state, registry, active).tools), actions: [] };
    expect(await executeToolCall(s.state, registry, s.provider, "qloo_find_tags", { query: "Hot Springs", limit: 5 }, undefined, gate)).toMatchObject({ accepted: false, code: "SKILL_BUDGET_EXHAUSTED" });
    expect(await executeToolCall(s.state, registry, s.provider, "anchor_territory", { territoryKey: "cafe_culture", tagId: CAFE }, undefined, gate)).toMatchObject({ accepted: true });
  });
});

describe("baseline under a tight skill budget (live regression)", () => {
  it("never re-proposes a probe the runtime refused, and still completes", async () => {
    // Live Sprint 4 final run: a place probe refused with SKILL_BUDGET_EXHAUSTED was re-proposed every turn
    // until two turns had no accepted action and the run FAILED.
    const tight = SKILLS.map((sk) => (sk.id === "resolve_territory" ? { ...sk, budget: { ...sk.budget, maxQlooCalls: 2 } } : sk));
    const rt = new AgentRuntime({ model: new BaselinePolicyModel(), provider: scripted(), skills: new SkillRegistry(tight) });
    const r = asResult(await rt.run({ userQuery: "q", brand: "Saffron & Salt", territories: ["Slow Travel"] }));
    const refused = r.trace.turns.flatMap((t) => t.decisions).filter((d) => d.rejection?.startsWith("SKILL_BUDGET_EXHAUSTED"));
    expect(refused.length).toBeGreaterThan(0); // the budget really bit
    const keys = refused.map((d) => JSON.stringify(d.arguments));
    expect(new Set(keys).size).toBe(keys.length); // and no refused probe was proposed twice
    expect(r.status).toBe("COMPLETE");
  });
});

describe("analysis reserve (live regression)", () => {
  it("keeps the Qloo calls analysis needs: investigation cannot starve the analysis of ready territories", async () => {
    // Live Sprint 4 run: investigation spent 32/32 calls, so three territories (two validly represented) all
    // ended INSUFFICIENT for lack of a brand profile and rank panels.
    const r = asResult(await runtime().runtime.run({ userQuery: "q", brand: "Velvet Tide", territories: ["Cafe Culture", "Hot Springs", "Bouldering"], limits: { maxQlooCalls: 16 } }));
    expect(r.metrics.qloo_calls).toBeLessThanOrEqual(16);
    const represented = r.territories.filter((t) => t.representation.exemplars.length > 0);
    expect(represented.length).toBeGreaterThan(0);
    for (const t of represented) expect(t.analysisRoute, t.key).not.toBe("INSUFFICIENT_EVIDENCE");
    // Refused by sufficiency (value NONE once only the reserve is left) or by the executor's reserve check.
    expect(r.trace.earlyStops.some((e) => e.code === "ANALYSIS_RESERVE" || /reserved for the analysis/u.test(e.reason))).toBe(true);
  });
});
