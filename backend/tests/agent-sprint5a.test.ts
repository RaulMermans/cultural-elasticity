/**
 * Sprint 5A adversarial evals (SYNTHETIC world, offline): each test reproduces a failure class observed in Sprint 4
 * live traces, or guards a new runtime contract. None of this is a live Qloo or live model validation.
 */
import type { AgentAnalysisResult, AgentTerritoryResult } from "@cultural-elasticity/shared";
import { describe, expect, it } from "vitest";
import { categorize, classifyViolation, validateClaims, validateFindings } from "../src/agent/claim-validator.js";
import { buildDecisionContext } from "../src/agent/context.js";
import { barrenProbe } from "../src/agent/evidence-sufficiency.js";
import { createAgentModel } from "../src/agent/factory.js";
import { AnthropicAgentModel } from "../src/agent/model/anthropic.js";
import { frontierConcepts } from "../src/agent/candidate-discovery.js";
import { RANKABLE_TYPES } from "../src/agent/contracts.js";
import { recoveryGuidance } from "../src/agent/readiness.js";
import { referenceCandidates, referencePlan } from "../src/agent/reference-strategy.js";
import { assessComparisonGroup, assessReferenceConcept, descriptorConcept, incidentalConcept } from "../src/agent/semantic-comparison.js";
import { ScriptedAgentModel } from "../src/agent/model/scripted.js";
import { transition } from "../src/agent/state.js";
import { executeToolCall } from "../src/agent/tool-executor.js";
import { ToolRegistry } from "../src/agent/tool-registry.js";
import { semanticGrade, stabilityReport } from "../scripts/agent-live-harness.js";
import { call, freshState, runtime, scripted } from "./fixtures/synthetic/agent.js";

const registry = new ToolRegistry();
const AS = "urn:tag:activity_type:syn:stream_angling";
const AMENITY = "urn:tag:amenity:syn:breakfast_buffet";
const asResult = (r: unknown) => r as AgentAnalysisResult;

async function resolved(brand: string, territories: string[], intent: "analyze_move" | "explore_frontier" = "analyze_move", limits?: Parameters<typeof freshState>[1]) {
  const state = freshState({ brand, ...(territories.length && { territories }) }, limits);
  const provider = scripted();
  await executeToolCall(state, registry, provider, "interpret_request", { intent, brand, territories });
  transition(state, "RESOLVING", "test");
  await executeToolCall(state, registry, provider, "qloo_resolve_entity", { name: brand, type: "brand", role: "brand" });
  transition(state, "INVESTIGATING", "test");
  return { state, provider, exec: (tool: string, args: unknown) => executeToolCall(state, registry, provider, tool, args) };
}

/** Stream Angling represented by three places, with exemplar and brand profiles collected. */
async function angling(brand = "Granite Hollow", limits?: Parameters<typeof freshState>[1]) {
  const s = await resolved(brand, ["Stream Angling"], "analyze_move", limits);
  await s.exec("qloo_find_tags", { query: "Stream Angling", limit: 8 });
  await s.exec("qloo_recommend", { targetType: "place", tagIds: [AS], conditionOnBrand: false, limit: 20 });
  await s.exec("anchor_territory", { territoryKey: "stream_angling", tagId: AS });
  for (const id of ["SYN-PL-2001", "SYN-PL-2002", "SYN-PL-2003", s.state.brand.entity!.id]) await s.exec("qloo_get_entity_tags", { entityId: id });
  const v = await s.exec("validate_territory_representation", { territoryKey: "stream_angling", entityType: "place", exemplars: ["SYN-PL-2001", "SYN-PL-2002", "SYN-PL-2003"].map((id) => ({ id, reason: "angling venue" })) });
  expect(v.accepted && v.result.status).toBe("ok");
  return s;
}

describe("A. semantic comparison validator", () => {
  it("A1 venue-listing attributes and operational tags are INCOMPARABLE references", async () => {
    const s = await angling();
    for (const id of [AMENITY, "urn:tag:dining_option:syn:breakfast_available", "urn:tag:decor:syn:rustic_charm"]) expect(assessReferenceConcept(s.state, id).status, id).toBe("INCOMPARABLE");
    expect(incidentalConcept("urn:tag:credit_card:place:visa")?.code).toBe("OPERATIONAL_TAG");
  });

  it("A2 a concept tied to the question only by one exemplar profile is WEAK, not meaningful", async () => {
    const s = await angling();
    expect(assessReferenceConcept(s.state, "urn:tag:keyword:syn:river_lodge")).toMatchObject({ status: "WEAK", reasonCode: "WEAK_CULTURAL_TIE" });
  });

  it("A3 a descriptor (tone, adjective, audience, ambience) is WEAK at the territory's analytical level", () => {
    expect(descriptorConcept("urn:tag:emotional_tone:qloo:nostalgic")).toBeDefined();
    expect(descriptorConcept("urn:tag:lifestyle:qloo:camping")).toBeUndefined();
  });

  it("A4 a concept on the brand's own Qloo profile is MEANINGFUL, with the profile's correlation id as evidence", async () => {
    const s = await angling("Pine Hollow Supply");
    const v = assessReferenceConcept(s.state, "urn:tag:keyword:syn:backwoods");
    expect(v.status).toBe("MEANINGFUL");
    expect(v.evidenceReferences).toEqual([s.state.profiles.get(s.state.brand.entity!.id)!.call.envelope.execution.correlation_id]);
  });

  it("A5 a model judgment can remove a reference but never add support", async () => {
    const s = await angling("Pine Hollow Supply");
    expect(assessReferenceConcept(s.state, "urn:tag:keyword:syn:backwoods", { relevance: "MISMATCH", reason: "unrelated" }).status).toBe("INCOMPARABLE");
    expect(assessReferenceConcept(s.state, "urn:tag:keyword:syn:river_lodge", { relevance: "STRONG", reason: "the model insists" }).status).toBe("WEAK");
    expect(assessReferenceConcept(s.state, "urn:tag:keyword:syn:unknown_concept", { relevance: "STRONG", reason: "x" }).status).toBe("UNKNOWN");
  });

  it("A6 shared exemplars or duplicate concepts make a set structurally INVALID", async () => {
    const s = await angling();
    const target = s.state.territories[0]!;
    const twin = { ...target, key: "twin", role: "reference" as const };
    const a = assessComparisonGroup(s.state, "place", [target, twin, { ...twin, key: "twin2" }]);
    expect(a.structuralStatus).toBe("INVALID");
    expect(a.structuralIssues.join(" ")).toMatch(/share a Qloo concept|not independent/u);
  });
});

describe("B. reference construction v2", () => {
  it("B1 incidental candidates are never usable and rank after meaningful ones", async () => {
    const s = await angling();
    const c = referenceCandidates(s.state);
    expect(c.find((x) => x.tagId === AMENITY)).toMatchObject({ usable: false, semantic: { status: "INCOMPARABLE" } });
    const firstWeak = c.findIndex((x) => x.semantic.status !== "MEANINGFUL");
    expect(c.slice(firstWeak).every((x) => x.semantic.status !== "MEANINGFUL")).toBe(true);
  });

  it("B2 the plan states the exact outstanding requirement while a meaningful set is feasible", async () => {
    const s = await angling("Pine Hollow Supply");
    const plan = referencePlan(s.state);
    expect(plan).toMatchObject({ applicable: true, feasible: true, required: 3, valid: 1, needed: 2, entityType: "place" });
    expect(plan.outstanding).toMatch(/^2 more meaningful place reference territories are required/u);
  });

  it("B3 FULL stops being pursued when the Qloo budget cannot cover references plus analysis", async () => {
    const s = await angling("Pine Hollow Supply", { maxQlooCalls: 12 });
    const plan = referencePlan(s.state);
    expect(plan.feasible).toBe(false);
    expect(plan.reason).toMatch(/Qloo call\(s\) left/u);
  });

  it("B4 with no meaningful candidate the plan is infeasible and names the rejected candidates", async () => {
    const s = await angling();
    for (const tag of ["urn:tag:industry:syn:insulated_coolers", "urn:tag:keyword:syn:overbuilt_hardware"]) await s.exec("qloo_recommend", { targetType: "place", tagIds: [tag], conditionOnBrand: false, limit: 20 });
    const plan = referencePlan(s.state);
    expect(plan.feasible).toBe(false);
    expect(plan.rejectedCandidates.map((r) => r.reasonCode)).toEqual(expect.arrayContaining(["INCIDENTAL_ATTRIBUTE"]));
  });

  it("B5 anchoring a reference to a venue attribute drops it before any Qloo call is spent on it", async () => {
    const s = await angling();
    await s.exec("propose_territory", { label: "River Lodge", role: "reference", origin: "qloo_evidence", rationale: "on an exemplar profile", evidenceTagIds: ["urn:tag:keyword:syn:river_lodge"] });
    const calls = s.state.usage.qlooCalls;
    const anchored = await s.exec("anchor_territory", { territoryKey: "river_lodge", tagId: "urn:tag:keyword:syn:river_lodge" });
    expect(anchored.accepted && anchored.result.errorCode).toBe("SEMANTIC_REFERENCE_REJECTED");
    expect(s.state.territories.find((t) => t.key === "river_lodge")).toMatchObject({ status: "dropped", dropReason: { code: "SEMANTIC_REFERENCE_REJECTED" } });
    expect(s.state.usage.qlooCalls).toBe(calls);
  });

  it("B6 proposing an incidental tag as a reference is refused by precondition", async () => {
    const s = await angling();
    const r = await s.exec("propose_territory", { label: "Breakfast Buffet", role: "reference", origin: "qloo_evidence", rationale: "x", evidenceTagIds: [AMENITY] });
    expect(r).toMatchObject({ accepted: false, code: "PRECONDITION" });
  });

  it("B7 a semantically rejected reference never yields FULL even if represented", async () => {
    const { runtime: rt } = runtime();
    const r = asResult(await rt.run({ userQuery: "q", brand: "Granite Hollow", territories: ["Stream Angling"] }));
    expect(r.territories.find((t) => t.key === "stream_angling")!.analysisRoute).not.toBe("FULL_RELATIVE_ANALYSIS");
    expect(r.territories.some((t) => t.role === "reference" && t.resolvedConcept?.id.includes(":amenity:"))).toBe(false);
  });
});

describe("C. representation recovery v2 and budget", () => {
  it("C1 after two empty probes of one type, a third is refused, naming untried supported types", async () => {
    const s = await resolved("Granite Hollow", ["Stream Angling"]);
    await s.exec("qloo_find_tags", { query: "Stream Angling", limit: 8 });
    const tags = s.state.searchedQueries.get("stream angling")!;
    await s.exec("qloo_recommend", { targetType: "brand", tagIds: [tags[0]!], conditionOnBrand: false, limit: 20 });
    await s.exec("qloo_recommend", { targetType: "brand", tagIds: [tags[1]!], conditionOnBrand: false, limit: 20 });
    expect(barrenProbe(s.state, tags[2]!, "brand")?.untried).toContain("place");
    const third = await executeToolCall(s.state, registry, s.provider, "qloo_recommend", { targetType: "brand", tagIds: [tags[2]!], conditionOnBrand: false, limit: 20 }, undefined, { skills: new (await import("../src/agent/skills/registry.js")).SkillRegistry(), active: (await import("../src/agent/skills/definitions.js")).SKILLS, exposed: new Set(registry.list().map((t) => t.name)), actions: [] });
    expect(third).toMatchObject({ accepted: false, code: "NO_VALUE_ACTION" });
    expect((third as { reason: string }).reason).toMatch(/untried supported entity type instead \(place/u);
  });

  it("C1b the rule forces diversification, never a ban: once another type was tried, the empty type may be probed again (live: a third tag had members)", async () => {
    const s = await resolved("Granite Hollow", ["Stream Angling"]);
    await s.exec("qloo_find_tags", { query: "Stream Angling", limit: 8 });
    const tags = s.state.searchedQueries.get("stream angling")!;
    for (const tag of tags.slice(0, 2)) await s.exec("qloo_recommend", { targetType: "brand", tagIds: [tag], conditionOnBrand: false, limit: 20 });
    expect(barrenProbe(s.state, tags[2]!, "brand")).not.toBeNull();
    await s.exec("qloo_recommend", { targetType: "place", tagIds: [tags[0]!], conditionOnBrand: false, limit: 20 });
    expect(barrenProbe(s.state, tags[2]!, "brand")).toBeNull();
  });

  it("C2 recovery guidance names only supported entity types and never repeats an empty strategy as available", async () => {
    const s = await resolved("Granite Hollow", ["Stream Angling"]);
    await s.exec("qloo_find_tags", { query: "Stream Angling", limit: 8 });
    await s.exec("anchor_territory", { territoryKey: "stream_angling", tagId: AS });
    await s.exec("qloo_recommend", { targetType: "brand", tagIds: [AS], conditionOnBrand: false, limit: 20 });
    const guidance = recoveryGuidance(s.state, s.state.territories[0]!).join(" | ");
    expect(guidance).toMatch(/empty: brand/u);
    expect(guidance).toMatch(/not yet probed with the supported entity type\(s\) place/u);
    const named = [...guidance.matchAll(/type\(s\) ([a-z_, ]+) →/gu)].flatMap((m) => m[1]!.split(", "));
    for (const type of named) expect(RANKABLE_TYPES as readonly string[]).toContain(type);
  });

  it("C3 a deferral-only turn is a steering step, not an invalid model turn", async () => {
    const steps = [
      [call("interpret_request", { intent: "analyze_move", brand: "Pine Hollow Supply", territories: ["Stream Angling"] })],
      [call("qloo_resolve_entity", { name: "Pine Hollow Supply", type: "brand", role: "brand" })],
      [call("qloo_find_tags", { query: "Stream Angling", limit: 8 }), call("qloo_recommend", { targetType: "place", tagIds: [AS], conditionOnBrand: false, limit: 20 })],
      [call("anchor_territory", { territoryKey: "stream_angling", tagId: AS }), call("validate_territory_representation", { territoryKey: "stream_angling", entityType: "place", exemplars: [{ id: "SYN-PL-2001", reason: "r" }, { id: "SYN-PL-2002", reason: "r" }] })],
      [{ action: "analyze", targetIds: ["stream_angling"], reasonSummary: "early" }],
      [{ action: "analyze", targetIds: ["stream_angling"], reasonSummary: "insist" }],
      [{ action: "finish", resultIds: ["stream_angling"], reasonSummary: "done" }],
    ];
    const r = asResult(await runtime(new ScriptedAgentModel(steps)).runtime.run({ userQuery: "q" }));
    expect(r.status).toBe("COMPLETE");
    expect(r.metrics.reference_deferrals).toBe(1);
    expect(r.trace.turns.flatMap((t) => t.decisions).map((d) => d.rejection?.split(":")[0])).toContain("REFERENCES_PENDING");
    expect(r.territories[0]!.analysisRoute).toBe("PARTIAL_CULTURAL_ANALYSIS");
  });

  it("C4 the decision context leads with focus: stage, outstanding requirement and allowed actions", async () => {
    const s = await angling("Pine Hollow Supply");
    const context = buildDecisionContext(s.state, registry, null);
    expect(Object.keys(context)[0]).toBe("focus");
    expect(context.focus).toMatchObject({ stage: "REFERENCE_CONSTRUCTION" });
    expect(context.focus!.outstanding.join(" ")).toMatch(/2 more meaningful place reference/u);
    expect(context.evidence.referenceCandidates?.every((c) => c.semantic === "MEANINGFUL")).toBe(true);
  });
});

describe("D. frontier quality", () => {
  it("D1 venue attributes carried by related brands are not frontier concepts", async () => {
    const s = await resolved("Granite Hollow", [], "explore_frontier");
    await s.exec("qloo_get_entity_tags", { entityId: s.state.brand.entity!.id });
    await s.exec("qloo_related_entities", { entityId: s.state.brand.entity!.id, targetType: "brand", limit: 5 });
    for (const r of s.state.related.flatMap((x) => x.memberIds)) await s.exec("qloo_get_entity_tags", { entityId: r });
    const concepts = frontierConcepts(s.state, 1).map((c) => c.tagId);
    expect(concepts).not.toContain(AMENITY);
    expect(concepts).toContain("urn:tag:keyword:syn:ridge_walking");
  });

  it("D2 stability compares classes only between runs with the same comparison set", () => {
    const run = (concepts: string[], cls: string) =>
      ({ status: "COMPLETE", metrics: { qloo_calls: 1, latency_ms: 1, model_cost_usd: 0.01 }, territories: concepts.map((c, i) => ({ key: c, label: c, role: "frontier_candidate", analysisRoute: "FULL_RELATIVE_ANALYSIS", resolvedConcept: { id: c }, relativePosition: { position: i + 1 }, classification: { label: cls }, comparisonSet: { territoryKeys: concepts } })) }) as unknown as AgentAnalysisResult;
    const sameSet = stabilityReport([run(["a", "b", "c"], "CREDIBLE_STRETCH"), run(["a", "b", "c"], "CULTURAL_BREAK")]);
    expect(sameSet).toMatchObject({ comparableClassPairs: 3, classAgreementOnComparableSets: 0 });
    const otherSet = stabilityReport([run(["a", "b", "c"], "CREDIBLE_STRETCH"), run(["a", "d", "e"], "CULTURAL_BREAK")]);
    expect(otherSet.comparableClassPairs).toBe(0);
    expect(otherSet.classAgreementOnComparableSets).toBeNull();
  });
});

describe("E. synthesis validation (valid language accepted, unsupported claims rejected)", () => {
  async function partialResult() {
    const { runtime: rt } = runtime();
    return asResult(await rt.run({ userQuery: "q", brand: "Granite Hollow", territories: ["Stream Angling"] }));
  }
  const synth = (summary: string, notes: { territoryKey: string; text: string }[] = []) => ({ summary, territoryNotes: notes, followUpOptions: [] });

  it("E1 'consistently shared signals' is coherence language, not a robustness claim (Sprint 4 false positive)", async () => {
    const r = await partialResult();
    expect(validateClaims(synth("Stream Angling shows consistently shared signals across its exemplars."), r.territories)).toEqual([]);
    expect(validateClaims(synth("Stream Angling is a robust and stable territory."), r.territories).join(" ")).toMatch(/robustness wording/u);
  });

  it("E1b negated or contrasted robustness wording next to a stated LOW level is valid (Sprint 5A live false positive); an affirmative claim is not", async () => {
    const r = await partialResult();
    const t = { ...r.territories[0]!, key: "m", label: "Mountaineering", robustness: { level: "LOW", percentileSpread: 0.4, panelledExemplars: 2, declaredExemplars: 2, reasons: [] } } as AgentTerritoryResult;
    const notes = (text: string) => validateClaims({ summary: "ok.", territoryNotes: [{ territoryKey: "m", text }], followUpOptions: [] }, [t]);
    expect(notes("Mountaineering's robustness is LOW, so its placement should be treated as tentative rather than stable.")).toEqual([]);
    expect(notes("The placement is not robust.")).toEqual([]);
    expect(notes("Without a relative position, these findings cannot be read as a stable association.")).toEqual([]);
    expect(notes("It cannot be ranked against a comparison set or described as stable.")).toEqual([]);
    expect(notes("It is not the leader but is robust.").join(" ")).toMatch(/robustness wording/u);
    expect(notes("It is not the leader, yet stable.").join(" ")).toMatch(/robustness wording/u);
    expect(notes("Mountaineering is a robust, stable placement.").join(" ")).toMatch(/robustness wording does not match Mountaineering \(LOW\)/u);
    expect(notes("Robustness is high.").join(" ")).toMatch(/robustness HIGH does not match/u);
  });

  it("E1c in a single-territory run an unnamed level claim attaches to that territory and must still match it", async () => {
    const r = await partialResult();
    const level = r.territories[0]!.evidenceQuality?.level;
    if (level) expect(validateClaims(synth(`Evidence quality is ${level.toLowerCase()} and the exemplar set is small.`), r.territories)).toEqual([]);
    const wrong = level === "HIGH" ? "low" : "high";
    expect(validateClaims(synth(`Evidence quality is ${wrong}.`), r.territories).join(" ")).toMatch(/evidence quality .* does not match/u);
  });

  it("E2 a directly negated disclaimer is accepted; an affirmative prediction, score or confidence is not", async () => {
    const r = await partialResult();
    expect(validateClaims(synth("This is not a prediction and no score is computed."), r.territories)).toEqual([]);
    for (const text of ["Qloo predicts strong uptake.", "We have high confidence in Stream Angling.", "Stream Angling scores well.", "The model forecasts growth."]) expect(validateClaims(synth(text), r.territories).length, text).toBeGreaterThan(0);
  });

  it("E3 a number from another territory's result is rejected in a territory note (misattribution)", async () => {
    const r = await partialResult();
    const t = r.territories[0]!;
    const other = { ...t, key: "other", label: "Other Place", coherence: t.coherence ? { ...t.coherence, filteredSharedMedian: 17 } : null, keyEvidence: ["17 shared"] } as AgentTerritoryResult;
    const results = [t, other];
    expect(validateClaims(synth("ok.", [{ territoryKey: t.key, text: "It shares 17 signals." }]), results).join(" ")).toMatch(/number 17 does not appear in the deterministic results of Stream Angling/u);
    expect(validateClaims(synth("ok.", [{ territoryKey: "other", text: "It shares 17 signals." }]), results)).toEqual([]);
  });

  it("E4 grounded findings: supported fields pass; an unsupported claim type, an empty field, a foreign limitation and an uncited number fail", async () => {
    const r = await partialResult();
    const key = r.territories[0]!.key;
    const own = r.territories[0]!.limitations[0]!.code;
    expect(validateFindings([{ territoryKey: key, claimType: "route_limitation", supportingFields: ["route"], interpretation: "No relative position is available.", limitationCodes: [own] }], r.territories)).toEqual([]);
    const bad = validateFindings(
      [
        { territoryKey: key, claimType: "relative_position", supportingFields: ["relativePosition.position"], interpretation: "It ranks 1.", limitationCodes: ["NOT_ITS_CODE"] },
        { territoryKey: key, claimType: "representation", supportingFields: ["representation"], interpretation: "It has 42 exemplars.", limitationCodes: [] },
        { territoryKey: "nope", claimType: "representation", supportingFields: [], interpretation: "x", limitationCodes: [] },
      ],
      r.territories,
    ).join(" | ");
    expect(bad).toMatch(/claimType relative_position is not supported/u);
    expect(bad).toMatch(/supporting field "relativePosition.position" has no value/u);
    expect(bad).toMatch(/limitation NOT_ITS_CODE/u);
    expect(bad).toMatch(/number 42 is not a value of its supporting fields/u);
    expect(bad).toMatch(/unknown territory "nope"/u);
  });

  it("E5 rejection categories distinguish invented numbers, classes, causal and commercial language", () => {
    expect(classifyViolation("summary: number 7 does not appear in the deterministic results of x")).toBe("INVENTED_NUMBER");
    expect(classifyViolation('summary: "CREDIBLE_STRETCH" does not match the deterministic class of A (no class)')).toBe("UNSUPPORTED_CLASSIFICATION");
    expect(classifyViolation('summary: forbidden language "because of" (unsupported causal language: the evidence is associative)')).toBe("UNSUPPORTED_CAUSAL");
    expect(classifyViolation('summary: forbidden language "sales" (commercial-success language: x)')).toBe("PROHIBITED_COMMERCIAL_OR_PREDICTION");
    expect(categorize(["synthesis schema: findings: required", "summary: \"Big Name\" is not a territory, concept, brand or entity in this run's state"])).toEqual({ SCHEMA: 1, INVALID_NAMED_ENTITY: 1 });
  });

  it("E6 a model synthesis with valid grounded findings is accepted on the first attempt and exposed separately from Qloo evidence", async () => {
    const steps = [
      [call("interpret_request", { intent: "analyze_move", brand: "Granite Hollow", territories: ["Stream Angling"] })],
      [call("qloo_resolve_entity", { name: "Granite Hollow", type: "brand", role: "brand" })],
      [call("qloo_find_tags", { query: "Stream Angling", limit: 8 }), call("qloo_recommend", { targetType: "place", tagIds: [AS], conditionOnBrand: false, limit: 20 })],
      [call("anchor_territory", { territoryKey: "stream_angling", tagId: AS }), call("validate_territory_representation", { territoryKey: "stream_angling", entityType: "place", exemplars: [{ id: "SYN-PL-2001", reason: "r" }, { id: "SYN-PL-2002", reason: "r" }] })],
      [{ action: "analyze", targetIds: ["stream_angling"], reasonSummary: "a" }],
      [{ action: "analyze", targetIds: ["stream_angling"], reasonSummary: "a" }],
      [{ action: "finish", resultIds: ["stream_angling"], reasonSummary: "done" }],
    ];
    const synthesis = { summary: "Qloo supports a partial reading of this move without a comparison set.", findings: [{ territoryKey: "stream_angling", claimType: "representation", supportingFields: ["representation"], interpretation: "Stream Angling is represented by angling venues Qloo links to the concept.", limitationCodes: [] }], followUpOptions: ["Probe reference concepts on the brand's own Qloo profile."] };
    const r = asResult(await runtime(new ScriptedAgentModel(steps, [synthesis])).runtime.run({ userQuery: "q" }));
    expect(r.summary.source).toBe("model");
    expect(r.metrics.synthesis_first_attempt_valid).toBe(true);
    expect(r.layers.agentInterpretation.findings).toHaveLength(1);
    expect(r.layers.qlooEvidence.exemplars.length).toBeGreaterThan(0);
  });
});

describe("F. evaluation honesty", () => {
  it("F1 the semantic grade flags a FULL result whose references are venue attributes (the Sprint 4 failure class)", () => {
    const target = { key: "fly", label: "Target", role: "target", analysisRoute: "FULL_RELATIVE_ANALYSIS", comparisonSet: { territoryKeys: ["fly", "bb", "ba"] }, resolvedConcept: { id: "urn:tag:activity_type:qloo:x" }, representation: { exemplars: [] }, capabilities: {} };
    const ref = (key: string, id: string) => ({ key, label: key, role: "reference", analysisRoute: "FULL_RELATIVE_ANALYSIS", comparisonSet: { territoryKeys: ["fly", "bb", "ba"] }, resolvedConcept: { id }, representation: { exemplars: [] }, capabilities: {} });
    const result = { brand: { label: "B" }, territories: [target, ref("bb", "urn:tag:amenity:qloo:breakfast_buffet"), ref("ba", "urn:tag:dining_option:qloo:breakfast_available")], comparisonSetConstruction: { proposed: [] } } as unknown as AgentAnalysisResult;
    const g = semanticGrade([result]);
    expect(g).toMatchObject({ full: 1, invalidFull: 1, validFull: 0 });
    expect(g.invalidExamples[0]).toMatch(/facility of a venue listing/u);
  });

  it("F2 Haiku is the default production model; without a credential nothing is substituted", () => {
    const model = new AnthropicAgentModel({ client: { beta: { messages: { create: async () => ({}) } } } as never });
    expect(model.info).toMatchObject({ id: "claude-haiku-5-5", kind: "llm", effort: "high" });
    expect(() => createAgentModel("auto", {} as NodeJS.ProcessEnv)).toThrow(/LIVE_AGENT_MODEL_VALIDATION_NOT_RUN/u);
  });
});
