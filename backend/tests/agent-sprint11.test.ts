/**
 * SYNTHETIC Sprint 11 research-intelligence regressions (research policy v1). Scripted decisions over the synthetic
 * world: these check the runtime's contracts and boundaries, never live Haiku research quality.
 */
import { describe, expect, it } from "vitest";
import { decisionCard, decisionCardViolations, type AgentTerritoryResult } from "@cultural-elasticity/shared";
import { validateConceptFraming, validateInsights } from "../src/agent/claim-validator.js";
import { ScriptedAgentModel } from "../src/agent/model/scripted.js";
import type { AgentDecisionContext } from "../src/agent/model/provider.js";
import { queryProposalSchema } from "../src/agent/query/contracts.js";
import { runGate } from "../src/agent/query/gate.js";
import { brandIntelligenceBrief, researchPolicyFromEnv, sameConceptName } from "../src/agent/research-intelligence.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { AGENT_TOOLS, toolSpecFor } from "../src/agent/tool-registry.js";
import { createScriptedToolProvider, type SyntheticWorld } from "../scripts/synthetic/synthetic-world.js";
import { call, loadWorld } from "./fixtures/synthetic/agent.js";

const BRAND = "Saffron & Salt";
const TABLEWARE = "urn:tag:industry:syn:tableware";
const SEMANTIC = { relevance: "strong", reason: "SYNTHETIC: a maker of the objects the user means" } as const;
const exemplars = (semantic = true) => ["SYN-BR-0201", "SYN-BR-0202", "SYN-BR-0203"].map((id) => ({ id, reason: "SYNTHETIC observed member", ...(semantic && { semantic: SEMANTIC }) }));
const brief = {
  centralQuestion: "SYNTHETIC: what does the direction mean for the brand?",
  concepts: [{ name: "studio pottery", meaning: "SYNTHETIC: handmade ceramics as a craft practice", notThis: ["mass-produced tableware"] }],
  usefulAnswer: "SYNTHETIC: whether the craft connection is grounded",
  approach: "investigate" as const,
  approachReason: "SYNTHETIC: the user asks what the connection means",
};

function world(mutate?: (w: SyntheticWorld) => void): SyntheticWorld {
  const w = loadWorld();
  mutate?.(w);
  return w;
}

function agent(steps: ConstructorParameters<typeof ScriptedAgentModel>[0], options: { policy?: "v0" | "v1"; w?: SyntheticWorld } = {}) {
  const model = new ScriptedAgentModel(steps, [], "sprint11-script");
  return { model, runtime: new AgentRuntime({ model, provider: createScriptedToolProvider(options.w ?? world()), ...(options.policy && { researchPolicy: options.policy }) }) };
}

const opening = (territory: string) => [
  [call("interpret_request", { intent: "analyze_move", brand: BRAND, territories: [territory] })],
  [call("qloo_resolve_entity", { name: BRAND, type: "brand", role: "brand" })],
  [call("qloo_find_tags", { query: "Tableware", limit: 5 }), call("qloo_recommend", { targetType: "brand", tagIds: [TABLEWARE], conditionOnBrand: false, limit: 20 })],
];

const decisions = (r: { trace: { turns: { decisions: { tool?: string; rejection?: string }[] }[] } }) => r.trace.turns.flatMap((t) => t.decisions);

describe("Sprint 11 research policy switch", () => {
  it("defaults to v1 for production and v0 only when asked; the runtime alone defaults to v0", async () => {
    expect(researchPolicyFromEnv({})).toBe("v1");
    expect(researchPolicyFromEnv({ CE_RESEARCH_POLICY: "v0" })).toBe("v0");
    const { runtime } = agent([...opening("Tableware"), [call("anchor_territory", { territoryKey: "tableware", tagId: TABLEWARE })]]);
    const r = await runtime.run({ userQuery: "SYNTHETIC", intent: "analyze_move", brand: BRAND, territories: ["Tableware"], limits: { maxAgentIterations: 4 } });
    expect(r.trace.researchPolicy).toBe("v0");
  });

  it("shows arm A (v0) the Sprint 10 tools: no alignment property and no reframe_research", async () => {
    const anchor = AGENT_TOOLS.find((t) => t.name === "anchor_territory")!;
    const v0 = toolSpecFor(anchor, "v0");
    const v1 = toolSpecFor(anchor, "v1");
    expect(Object.keys((v0.inputSchema as { properties: object }).properties)).not.toContain("alignment");
    expect(Object.keys((v1.inputSchema as { properties: object }).properties)).toContain("alignment");
    expect(v0.description).not.toMatch(/alignment/u);
    const seen: AgentDecisionContext[] = [];
    const steps = [...opening("Tableware"), [call("anchor_territory", { territoryKey: "tableware", tagId: TABLEWARE }), call("validate_territory_representation", { territoryKey: "tableware", entityType: "brand", exemplars: exemplars(false) })], (c: AgentDecisionContext) => (seen.push(c), [{ action: "finish" as const, resultIds: [], reasonSummary: "stop" }])];
    const { runtime } = agent(steps, { policy: "v0" });
    await runtime.run({ userQuery: "SYNTHETIC", intent: "analyze_move", brand: BRAND, territories: ["Tableware"], limits: { maxAgentIterations: 6 } });
    expect(seen[0]!.research).toBeUndefined();
    expect(seen[0]!.tools.map((t) => t.name)).not.toContain("reframe_research");
  });
});

describe("Sprint 11 concept alignment (v1)", () => {
  const request = { userQuery: "SYNTHETIC: is studio pottery a direction?", intent: "analyze_move" as const, brand: BRAND, territories: ["Studio Pottery"], researchMode: "single_hypothesis_v1" as const, researchBrief: brief };

  it("refuses a differently named concept without a judgment, and refuses the agent's own MISMATCHED verdict", async () => {
    const { runtime } = agent([
      ...opening("Studio Pottery"),
      [call("anchor_territory", { territoryKey: "studio_pottery", tagId: TABLEWARE })],
      [call("anchor_territory", { territoryKey: "studio_pottery", tagId: TABLEWARE, alignment: { relation: "MISMATCHED", reason: "SYNTHETIC: mass-produced objects, not the craft" } })],
      [call("drop_territory", { territoryKey: "studio_pottery", code: "TERRITORY_UNRESOLVED", reason: "SYNTHETIC: no faithful Qloo concept" })],
      [{ action: "finish", resultIds: [], reasonSummary: "nothing faithful to analyze" }],
    ], { policy: "v1" });
    const r = await runtime.run(request);
    const rejections = r.trace.toolCalls.filter((c) => c.tool === "anchor_territory").map((c) => c.summary);
    expect(rejections.join(" ")).toMatch(/CONCEPT_ALIGNMENT_REQUIRED/u);
    expect(rejections.join(" ")).toMatch(/CONCEPT_MISMATCH/u);
    expect(r.status).not.toBe("NEEDS_INPUT");
    if (r.status === "NEEDS_INPUT") return;
    expect(r.territories.every((t) => t.resolvedConcept === null)).toBe(true);
  });

  it("carries a RELATED_DIFFERENT concept into the result as a qualification, never as coverage", async () => {
    const { runtime } = agent([
      ...opening("Studio Pottery"),
      [call("anchor_territory", { territoryKey: "studio_pottery", tagId: TABLEWARE, alignment: { relation: "RELATED_DIFFERENT", reason: "SYNTHETIC: tableware makers, not the craft practice" } }), call("validate_territory_representation", { territoryKey: "studio_pottery", entityType: "brand", exemplars: exemplars() })],
      [{ action: "analyze", targetIds: ["studio_pottery"], reasonSummary: "analyze what was found" }],
      [{ action: "finish", resultIds: ["studio_pottery"], reasonSummary: "done" }],
    ], { policy: "v1" });
    const r = await runtime.run(request);
    expect(r.status).toBe("COMPLETE");
    if (r.status !== "COMPLETE") return;
    const t = r.territories[0]!;
    expect(t.conceptAlignment).toMatchObject({ relation: "RELATED_DIFFERENT", userConcept: "Studio Pottery", qlooConcept: { id: TABLEWARE }, decidedBy: "agent" });
    expect(t.limitations.map((l) => l.code)).toContain("CONCEPT_NOT_EQUIVALENT");
    expect(r.hypothesisAssessment?.outcome).not.toBe("WORTH_FURTHER_INVESTIGATION");
    expect(r.hypothesisAssessment?.limitations.join(" ")).toMatch(/not the same as/u);
    // The deterministic template names the concept actually investigated next to the user's concept.
    expect(r.summary.text).toMatch(/Tableware concept, which the agent judged related to but different from Studio Pottery/u);
    expect(r.researchBrief).toEqual(brief);
    const card = decisionCard(r, "studio_pottery")!;
    expect(card.whyInteresting.join(" ")).toMatch(/about Qloo's concept "Tableware", which is related to, but not the same as, Studio Pottery/u);
    expect(card.uncertain[0]).toMatch(/no exact concept for Studio Pottery/u);
    expect(decisionCardViolations(card, r)).toEqual([]);
  });

  it("requires a semantic judgment of each exemplar of a user-named territory", async () => {
    const { runtime } = agent([
      ...opening("Tableware"),
      [call("anchor_territory", { territoryKey: "tableware", tagId: TABLEWARE }), call("validate_territory_representation", { territoryKey: "tableware", entityType: "brand", exemplars: exemplars(false) })],
      [{ action: "finish", resultIds: [], reasonSummary: "stop" }],
    ], { policy: "v1" });
    const r = await runtime.run({ ...request, userQuery: "SYNTHETIC", territories: ["Tableware"] });
    const validate = r.trace.toolCalls.find((c) => c.tool === "validate_territory_representation");
    expect(validate?.summary ?? "").toMatch(/SEMANTIC_JUDGMENT_REQUIRED/u);
  });

  it("records a same-named anchor as runtime EQUIVALENT without asking the model", async () => {
    const { runtime } = agent([
      ...opening("Tableware"),
      [call("anchor_territory", { territoryKey: "tableware", tagId: TABLEWARE }), call("validate_territory_representation", { territoryKey: "tableware", entityType: "brand", exemplars: exemplars() })],
      [{ action: "analyze", targetIds: ["tableware"], reasonSummary: "analyze" }],
      [{ action: "finish", resultIds: ["tableware"], reasonSummary: "done" }],
    ], { policy: "v1" });
    const r = await runtime.run({ ...request, userQuery: "SYNTHETIC", territories: ["Tableware"] });
    if (r.status === "NEEDS_INPUT") throw new Error("unexpected");
    expect(r.territories[0]!.conceptAlignment).toMatchObject({ relation: "EQUIVALENT", decidedBy: "runtime" });
    expect(r.territories[0]!.limitations.map((l) => l.code)).not.toContain("CONCEPT_NOT_EQUIVALENT");
    expect(sameConceptName("Boutique Hotels", "urn:tag:industry:syn:boutique_hotel", "Boutique Hotel")).toBe(true);
  });
});

describe("Sprint 11 research approach (v1)", () => {
  const request = { userQuery: "SYNTHETIC: could the brand move into tableware?", intent: "analyze_move" as const, brand: BRAND, territories: ["Tableware"] };
  const represent = [call("anchor_territory", { territoryKey: "tableware", tagId: TABLEWARE }), call("validate_territory_representation", { territoryKey: "tableware", entityType: "brand", exemplars: exemplars() })];

  it("lets the agent decline a comparison: no references required, pending ones dropped, the result says so", async () => {
    const seen: AgentDecisionContext[] = [];
    const { runtime } = agent([
      ...opening("Tableware"),
      represent,
      (c) => (seen.push(c), [call("reframe_research", { approach: "investigate", reason: "SYNTHETIC: no reference is a meaningful alternative at the same level" })]),
      (c) => (seen.push(c), [{ action: "analyze", targetIds: ["tableware"], reasonSummary: "investigate the direction" }]),
      [{ action: "finish", resultIds: ["tableware"], reasonSummary: "done" }],
    ], { policy: "v1" });
    const r = await runtime.run(request);
    expect(r.status).toBe("COMPLETE");
    if (r.status !== "COMPLETE") return;
    expect(seen[0]!.research?.approach?.approach).toBe("compare");
    expect(seen[0]!.tools.map((t) => t.name)).toContain("reframe_research");
    expect(seen[1]!.research?.approach).toMatchObject({ approach: "investigate", decidedBy: "agent", reframedFrom: "compare" });
    expect(seen[1]!.sufficiency.nextActions.some((a) => a.action === "add_references" && a.value === "HIGH")).toBe(false);
    expect(decisions(r).some((d) => d.rejection?.startsWith("REFERENCES_PENDING"))).toBe(false);
    expect(r.researchApproach).toMatchObject({ approach: "investigate", decidedBy: "agent" });
    expect(r.territories.find((t) => t.key === "tableware")!.limitations.map((l) => l.code)).toContain("COMPARISON_DECLINED");
    expect(r.hypothesisAssessment?.version).toBe("single-hypothesis/v1");
    // Narrowing only: the run's budgets are unchanged.
    expect(r.trace.limits.maxQlooCalls).toBe(24);
  });

  it("refuses a reframe after the target is analyzed, and a second reframe", async () => {
    const { runtime } = agent([
      ...opening("Tableware"),
      represent,
      [call("reframe_research", { approach: "investigate", reason: "SYNTHETIC first" })],
      [call("reframe_research", { approach: "investigate", reason: "SYNTHETIC second" })],
      [{ action: "analyze", targetIds: ["tableware"], reasonSummary: "analyze" }],
      [{ action: "finish", resultIds: ["tableware"], reasonSummary: "done" }],
    ], { policy: "v1" });
    const r = await runtime.run(request);
    const second = r.trace.toolCalls.filter((c) => c.tool === "reframe_research")[1];
    expect(second?.summary ?? "").toMatch(/already follows the investigate approach/u);
  });

  it("starts from the interpreter's approach when it fits the operation", async () => {
    const seen: AgentDecisionContext[] = [];
    const { runtime } = agent([...opening("Tableware"), (c) => (seen.push(c), [{ action: "finish", resultIds: [], reasonSummary: "stop" }])], { policy: "v1" });
    await runtime.run({ ...request, researchBrief: brief, limits: { maxAgentIterations: 4 } });
    expect(seen[0]!.research?.approach).toMatchObject({ approach: "investigate", decidedBy: "interpreter" });
    expect(seen[0]!.research?.brief?.concepts[0]!.notThis).toEqual(["mass-produced tableware"]);
  });
});

describe("Sprint 11 brand intelligence (v1)", () => {
  const coreWorld = () => world((w) => {
    w.tags.push({ id: "urn:tag:genre:brand:tableware", name: "Tableware", type: "urn:tag:genre:brand" });
    w.entities.find((e) => e.id === "SYN-BR-0004")!.tags.push("urn:tag:genre:brand:tableware");
  });

  it("marks a target that is the brand's own Qloo category as established positioning", async () => {
    const { runtime } = agent([
      ...opening("Tableware").slice(0, 2),
      [call("qloo_get_entity_tags", { entityId: "SYN-BR-0004" }), call("qloo_find_tags", { query: "Tableware", limit: 5 }), call("qloo_recommend", { targetType: "brand", tagIds: [TABLEWARE], conditionOnBrand: false, limit: 20 })],
      [call("anchor_territory", { territoryKey: "tableware", tagId: TABLEWARE }), call("validate_territory_representation", { territoryKey: "tableware", entityType: "brand", exemplars: exemplars() })],
      [{ action: "analyze", targetIds: ["tableware"], reasonSummary: "analyze" }],
      [{ action: "finish", resultIds: ["tableware"], reasonSummary: "done" }],
    ], { policy: "v1", w: coreWorld() });
    const r = await runtime.run({ userQuery: "SYNTHETIC", intent: "analyze_move", brand: BRAND, territories: ["Tableware"], researchMode: "single_hypothesis_v1", brandContext: { facts: [{ statement: "SYNTHETIC: the brand sells tableware", source: { title: "SYNTHETIC packet", url: null, retrievedAt: "2026-10-30" } }], positioning: null } });
    if (r.status === "NEEDS_INPUT") throw new Error("unexpected");
    const t = r.territories[0]!;
    expect(t.brandCore).toEqual({ tagId: "urn:tag:genre:brand:tableware", label: "Tableware" });
    expect(t.limitations.map((l) => l.code)).toContain("BRAND_CORE_CATEGORY");
    expect(r.summary.text).toMatch(/established positioning rather than an extension/u);
    expect(r.brandIntelligence?.facts[0]).toMatchObject({ ref: 1, origin: "requester_supplied" });
    expect(r.brandIntelligence?.qlooObserved?.categoryTags.map((x) => x.id)).toContain("urn:tag:genre:brand:tableware");
    expect(r.insights).toEqual([]);
    const card = decisionCard(r, "tableware")!;
    expect(card.whyInteresting[0]).toMatch(/established positioning, not a new direction/u);
    expect(card.interpretations).toBeUndefined();
    expect(decisionCardViolations(card, r)).toEqual([]);
  });

  it("reports what is unverified when no facts or profile exist, and nothing when neither is known", () => {
    expect(brandIntelligenceBrief({ brand: { entity: null }, request: { userQuery: "x" }, profiles: new Map(), tags: new Map() } as never)).toBeNull();
    const b = brandIntelligenceBrief({ brand: { entity: null }, request: { userQuery: "x", brandContext: { facts: [], positioning: "SYNTHETIC" } }, profiles: new Map(), tags: new Map() } as never)!;
    expect(b.unverified.join(" ")).toMatch(/No cited business facts/u);
    expect(b.qlooObserved).toBeNull();
  });
});

describe("Sprint 11 layer-2 insight validation", () => {
  const result = (over: Partial<AgentTerritoryResult> = {}): AgentTerritoryResult => ({
    key: "tableware", label: "Tableware", role: "target", origin: "user", rationale: "named by the user",
    resolvedConcept: { id: TABLEWARE, label: "Tableware", type: "urn:tag:industry:syn" },
    representation: { strategy: "TAG_DERIVED_ENTITY_PANEL", entityType: "brand", exemplars: [{ id: "SYN-BR-0201", label: "Ashgrove Ceramics", type: "brand", role: "primary", selectionReason: "x", conceptSupport: "tag_member", popularity: null }], rejectedExemplars: [], diversity: "unknown", diversityDetail: "", attempts: 1, summary: "panel", failure: null },
    analysisRoute: "PARTIAL_CULTURAL_ANALYSIS", capabilities: {} as never, comparisonSet: null, relativePosition: null, robustness: null,
    coherence: { rawSharedMedian: 2, filteredSharedMedian: 2, filteredBand: "LOW", exemplarsCompared: 3, consistentlyShared: [{ id: "urn:tag:keyword:syn:craft", label: "Craft" }] },
    conditionedEvidence: { support: "SUPPORTED", entityCount: 7, topEntities: [{ label: "Kilnhouse", rank: 1 }], correlationId: "SYN-corr" },
    evidenceQuality: null, classification: null, keyEvidence: [], limitations: [], provenance: { correlationIds: [], sources: [] }, ...over,
  });
  const insight = {
    territoryKey: "tableware", observation: "The brand-conditioned query for Tableware returned 7 entities, led by Kilnhouse.", observationFields: ["conditionedEvidence.entityCount", "conditionedEvidence.top"],
    interpretation: "The overlap could suggest the brand already sits near a craft-led table culture.", implication: "A tableware direction may read as an extension of the brand's craft positioning.",
    counterpoint: "The association may reflect shared audiences rather than a shared cultural meaning.", validation: "Investigate whether the craft signal holds with other tableware exemplars.",
    horizon: "ADJACENT" as const, basis: ["QLOO_EVIDENCE", "STRATEGIC_HYPOTHESIS"] as ("QLOO_EVIDENCE" | "STRATEGIC_HYPOTHESIS" | "BRAND_FACT")[], brandFactRefs: [] as number[],
  };

  it("accepts a grounded observation with labelled, hedged reasoning", () => {
    expect(validateInsights([insight], [result()], [], [BRAND])).toEqual([]);
  });

  it("rejects numbers, evidence claims, market facts and unknown names in the reasoning", () => {
    const v = validateInsights([{ ...insight, interpretation: "Qloo shows 3 strong links.", implication: "Demand for tableware is growing.", counterpoint: "Unlike Porcelain Palace Group, it may not hold." }], [result()], [], [BRAND]);
    expect(v.join("\n")).toMatch(/interpretation: "3"|interpretation: "Qloo"/u);
    expect(v.join("\n")).toMatch(/implication: "(Demand|growing)"/u);
    expect(v.join("\n")).toMatch(/Porcelain Palace Group/u);
  });

  it("grounds the observation like a finding: an invented number is rejected", () => {
    expect(validateInsights([{ ...insight, observation: "The query returned 12 entities." }], [result()], [], [BRAND]).join(" ")).toMatch(/number 12/u);
  });

  it("checks brand-fact references against the declared basis and allows names from cited facts", () => {
    const facts = [{ ref: 1, statement: "SYNTHETIC: the brand runs Harbour Kitchen Studios" }];
    expect(validateInsights([{ ...insight, brandFactRefs: [1] }], [result()], facts, [BRAND]).join(" ")).toMatch(/without basis BRAND_FACT/u);
    expect(validateInsights([{ ...insight, basis: ["BRAND_FACT"], brandFactRefs: [] }], [result()], facts, [BRAND]).join(" ")).toMatch(/needs brandFactRefs/u);
    expect(validateInsights([{ ...insight, basis: ["BRAND_FACT"], brandFactRefs: [2] }], [result()], facts, [BRAND]).join(" ")).toMatch(/fact 2 does not exist/u);
    expect(validateInsights([{ ...insight, basis: ["BRAND_FACT", "STRATEGIC_HYPOTHESIS"], brandFactRefs: [1], implication: "Harbour Kitchen Studios could host the direction." }], [result()], facts, [BRAND])).toEqual([]);
  });

  it("requires ESTABLISHED for the brand's own category", () => {
    expect(validateInsights([insight], [result({ brandCore: { tagId: "urn:tag:genre:brand:tableware", label: "Tableware" } })], [], [BRAND]).join(" ")).toMatch(/horizon is ESTABLISHED/u);
  });

  it("requires a sentence about the user's concept to name the related concept actually investigated", () => {
    const r = result({ label: "Studio Pottery", key: "studio_pottery", conceptAlignment: { userConcept: "Studio Pottery", qlooConcept: { id: TABLEWARE, label: "Tableware" }, relation: "RELATED_DIFFERENT", reason: "x", uncovered: [], decidedBy: "agent" } });
    expect(validateConceptFraming({ summary: "Studio Pottery is a promising direction.", territoryNotes: [] }, [r])).toHaveLength(1);
    expect(validateConceptFraming({ summary: "Studio Pottery could not be measured directly; the evidence concerns Tableware.", territoryNotes: [] }, [r])).toEqual([]);
  });
});

describe("Sprint 11 query layer", () => {
  const proposal = {
    primaryIntent: "analyze_move", secondaryIntents: [], brandsNamed: [BRAND], territories: [{ name: "Studio Pottery", fromContext: false }], contextRef: null, contextTerritoryKey: null,
    constraints: [], unresolvedReferences: [], systemDirectives: [], confidence: "HIGH", clarificationQuestion: null, refinement: null,
  };

  it("passes a valid research brief to the run request and nothing else", () => {
    const p = queryProposalSchema.parse({ ...proposal, researchBrief: brief });
    const gate = runGate({ query: "SYNTHETIC", explicit: {}, proposal: p, context: null, interpreter: { kind: "scripted" } });
    expect(gate.plan?.request.researchBrief).toEqual(brief);
    expect(gate.plan?.request.limits).toBeUndefined();
  });

  it("accepts a v0 answer without a brief, and a brief cannot smuggle fields", () => {
    expect(queryProposalSchema.safeParse(proposal).success).toBe(true);
    expect(queryProposalSchema.safeParse({ ...proposal, researchBrief: { ...brief, maxQlooCalls: 99 } }).success).toBe(false);
    expect(queryProposalSchema.safeParse({ ...proposal, researchBrief: { ...brief, approach: "spend_more" } }).success).toBe(false);
  });
});

describe("Sprint 11 durable checkpoints", () => {
  it("round-trips the research policy, approach and concept judgment through a checkpoint", async () => {
    const { hydrateRunState, serializeRunState } = await import("../src/agent/durable/checkpoint.js");
    const { freshState } = await import("./fixtures/synthetic/agent.js");
    const state = freshState({ intent: "analyze_move", brand: BRAND, territories: ["Studio Pottery"], researchBrief: brief });
    state.researchPolicy = "v1";
    state.researchApproach = { approach: "investigate", decidedBy: "agent", reason: "SYNTHETIC", reframedFrom: "compare", reframedAtIteration: 3 };
    state.territories.push({ key: "studio_pottery", label: "Studio Pottery", role: "target", origin: "user", rationale: "x", status: "anchored", concept: { id: TABLEWARE, label: "Tableware", type: "t" }, representation: null, attempts: 0, rejectedExemplars: [], dropReason: null, source: "user" as never, sourceEvidence: "", strategyLog: [], conceptOnly: null, semanticJudgment: null, sourceTagId: null, evidenceTagIds: [], motivatedBy: [], conceptAlignment: { userConcept: "Studio Pottery", qlooConcept: { id: TABLEWARE, label: "Tableware" }, relation: "RELATED_DIFFERENT", reason: "SYNTHETIC", uncovered: [], decidedBy: "agent" } });
    const restored = hydrateRunState(serializeRunState(state));
    expect(restored.researchPolicy).toBe("v1");
    expect(restored.researchApproach).toEqual(state.researchApproach);
    expect(restored.request.researchBrief).toEqual(brief);
    expect(restored.territories[0]!.conceptAlignment).toEqual(state.territories[0]!.conceptAlignment);
  });
});
