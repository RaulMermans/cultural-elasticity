/**
 * SYNTHETIC Sprint 12 measurement and research-completion regressions: the evidence-assessment/v1 rules, direct
 * evidence facts, compound coverage, research-question-aware next actions and the thin-panel probe bound. Result
 * objects and the scripted world are fictional (SYN-); none of this is Qloo evidence or live model behaviour.
 */
import { describe, expect, it } from "vitest";
import { assessResearch, assessTerritoryEvidence, decisionCard, decisionCardViolations, evidenceAssessmentViolations, type AgentAnalysisResult, type AgentTerritoryResult, type DirectEvidenceFacts } from "@cultural-elasticity/shared";
import { assessComparisonFeasibility } from "../src/agent/feasibility.js";
import { ScriptedAgentModel } from "../src/agent/model/scripted.js";
import { referencePlan, THIN_PANEL_EMPTY_PROBE_LIMIT } from "../src/agent/reference-strategy.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { transition } from "../src/agent/state.js";
import { executeToolCall } from "../src/agent/tool-executor.js";
import { ToolRegistry } from "../src/agent/tool-registry.js";
import { createScriptedToolProvider } from "../scripts/synthetic/synthetic-world.js";
import { call, freshState, loadWorld, scripted } from "./fixtures/synthetic/agent.js";

const CONCEPT = { id: "urn:tag:keyword:syn:target", label: "Synthetic Target", type: "urn:tag:keyword:syn" };

function facts(over: Partial<DirectEvidenceFacts> = {}): DirectEvidenceFacts {
  return {
    version: "direct-evidence/v1",
    brandProfile: { status: "ABSENT", source: "run_profile", correlationId: "SYN-P1" },
    conditionedQuery: { status: "RETURNED", entityCount: 12, correlationId: "SYN-C1" },
    conceptSearch: "FOUND",
    exemplarJudgments: { strong: 1, adequate: 1, weak: 0, mismatch: 0, unjudged: 0 },
    sharedSignals: [],
    tautologicalSignals: [],
    ...over,
  };
}

function territory(over: Partial<AgentTerritoryResult> = {}): AgentTerritoryResult {
  return {
    key: "syn_target", label: "Synthetic Target", role: "target", origin: "user", rationale: "", resolvedConcept: CONCEPT,
    representation: { strategy: "TAG_DERIVED_ENTITY_PANEL", entityType: "place", exemplars: [{ id: "SYN-1", label: "Example One", type: "place", role: "primary", selectionReason: "", conceptSupport: "tag_member", popularity: null, quality: "VALID" }, { id: "SYN-2", label: "Example Two", type: "place", role: "alternate", selectionReason: "", conceptSupport: "tag_member", popularity: null, quality: "VALID" }], rejectedExemplars: [], diversity: "unknown", diversityDetail: "", attempts: 1, summary: "", failure: null },
    analysisRoute: "PARTIAL_CULTURAL_ANALYSIS",
    capabilities: { representation: "SUPPORTED", relativePosition: "INSUFFICIENT", robustness: "INSUFFICIENT", coherence: "AVAILABLE", conditionedEvidence: "AVAILABLE", classification: "INSUFFICIENT" },
    comparisonSet: null, relativePosition: null, robustness: null, coherence: null,
    conditionedEvidence: { support: "SUPPORTED", entityCount: 12, topEntities: [{ label: "Example One", rank: 1 }], correlationId: "SYN-C1" },
    evidenceQuality: null, classification: null, keyEvidence: [], limitations: [], provenance: { correlationIds: ["SYN-C1"], sources: [] },
    ...over,
  } as AgentTerritoryResult;
}

function result(ts: AgentTerritoryResult[], over: Partial<AgentAnalysisResult> = {}): AgentAnalysisResult {
  return { status: "COMPLETE", userQuery: "SYNTHETIC: is the target a direction for the brand?", brand: { id: "SYN-BR", label: "Synthetic Brand", type: "brand", resolution: "confirmed" }, territories: ts, evidenceOrigin: "synthetic", ...over } as unknown as AgentAnalysisResult;
}

const outcome = (t: AgentTerritoryResult, r: Partial<AgentAnalysisResult> = {}) => assessTerritoryEvidence(result([t], r), t).outcome;

describe("Sprint 12 evidence assessment rules", () => {
  it("brand category or profile tag + conditioned entities is an established association", () => {
    expect(outcome(territory({ brandCore: { tagId: "urn:tag:genre:brand:syn", label: "Synthetic Target" }, directEvidence: facts() }))).toBe("ESTABLISHED_ASSOCIATION");
    expect(outcome(territory({ directEvidence: facts({ brandProfile: { status: "CONTAINS_CONCEPT", source: "baseline_scan", correlationId: "SYN-S1" } }) }))).toBe("ESTABLISHED_ASSOCIATION");
  });

  it("one direct observation is an observed association; a returned count alone is never one", () => {
    expect(outcome(territory({ directEvidence: facts({ brandProfile: { status: "CONTAINS_CONCEPT", source: "run_profile", correlationId: "SYN-P1" }, conditionedQuery: { status: "NOT_RUN", entityCount: 0, correlationId: null } }) }))).toBe("OBSERVED_ASSOCIATION");
    expect(outcome(territory({ directEvidence: facts({ sharedSignals: [{ id: "urn:tag:keyword:syn:other", label: "Other Signal" }] }) }))).toBe("OBSERVED_ASSOCIATION");
    // Saturation is not affinity: many returned entities without a shared signal stay limited evidence.
    expect(outcome(territory({ directEvidence: facts({ conditionedQuery: { status: "RETURNED", entityCount: 50, correlationId: "SYN-C1" } }) }))).toBe("LIMITED_EVIDENCE");
    // An exemplar the agent judged off-topic removes the support.
    expect(outcome(territory({ directEvidence: facts({ sharedSignals: [{ id: "urn:tag:keyword:syn:other", label: "Other Signal" }], exemplarJudgments: { strong: 1, adequate: 0, weak: 0, mismatch: 1, unjudged: 0 } }) }))).toBe("LIMITED_EVIDENCE");
  });

  it("a clean empty brand-conditioned answer is no support in the tested scope, never a negative fit", () => {
    const t = territory({ directEvidence: facts({ conditionedQuery: { status: "CLEAN_EMPTY", entityCount: 0, correlationId: "SYN-C1" } }) });
    const r = result([t]);
    const a = assessTerritoryEvidence(r, t);
    expect(a.outcome).toBe("NO_SUPPORT_IN_TESTED_SCOPE");
    expect(a.conclusion).toMatch(/not proof that no relationship exists/u);
    const card = decisionCard(r, "syn_target")!;
    expect(card.implication.code).toBe("NO_SUPPORT_FOUND");
    expect(card.implication.code).not.toBe("RELATIVE_FIT_NOT_SUPPORTED");
    expect(card.nextActions.map((x) => x.kind)).not.toContain("RUN_AGAIN");
    // A failed or degraded call is never evidence of absence.
    expect(outcome(territory({ directEvidence: facts({ conditionedQuery: { status: "FAILED", entityCount: 0, correlationId: null } }) }))).toBe("LIMITED_EVIDENCE");
    expect(outcome(territory({ directEvidence: facts({ conditionedQuery: { status: "UNRELIABLE", entityCount: 0, correlationId: "SYN-C1" } }) }))).toBe("LIMITED_EVIDENCE");
  });

  it("an unsupported or substituted concept is not testable as asked, whatever the substitute's evidence", () => {
    expect(outcome(territory({ resolvedConcept: null, directEvidence: facts() }))).toBe("CONCEPT_NOT_REPRESENTED");
    const substitute = territory({
      conceptAlignment: { userConcept: "Synthetic Target", qlooConcept: { id: CONCEPT.id, label: "Neighbour Concept" }, relation: "RELATED_DIFFERENT", reason: "SYNTHETIC", uncovered: [], decidedBy: "agent" },
      directEvidence: facts({ brandProfile: { status: "CONTAINS_CONCEPT", source: "run_profile", correlationId: "SYN-P1" } }),
    });
    const r = result([substitute]);
    const a = assessTerritoryEvidence(r, substitute);
    expect(a.outcome).toBe("CONCEPT_NOT_REPRESENTED");
    expect(evidenceAssessmentViolations(a)).toEqual([]);
    expect(decisionCard(r, "syn_target")!.nextActions[0]?.kind).toBe("REFRAME_CONCEPT");
  });

  it("an unfinished territory is incomplete, not unsupported", () => {
    expect(outcome(territory({ analysisRoute: "INSUFFICIENT_EVIDENCE", limitations: [{ code: "BUDGET_EXHAUSTED", detail: "SYNTHETIC" }] }), { status: "BUDGET_EXHAUSTED" })).toBe("INCOMPLETE");
    expect(decisionCard(result([territory({ analysisRoute: "INSUFFICIENT_EVIDENCE", limitations: [{ code: "BUDGET_EXHAUSTED", detail: "SYNTHETIC" }] })], { status: "BUDGET_EXHAUSTED" }), "syn_target")!.nextActions[0]?.kind).toBe("RUN_AGAIN");
  });

  it("the concept's own tag is never a shared signal; on an older result it shows the concept is on the brand profile", () => {
    // Older stored result (no direct-evidence facts): the shared signals are the brand profile ∩ exemplar profiles.
    const t = territory({ coherence: { rawSharedMedian: 1, filteredSharedMedian: 1, filteredBand: "SPARSE", exemplarsCompared: 2, consistentlyShared: [{ id: CONCEPT.id, label: CONCEPT.label }] } });
    const a = assessTerritoryEvidence(result([t]), t);
    expect(a.basis).toBe("DERIVED_FROM_STORED_RESULT");
    expect(a.observed.find((o) => o.code === "SHARED_SIGNALS")).toBeUndefined();
    expect(a.limitations.join(" ")).toMatch(/only because it is the concept itself/u);
    expect(a.outcome).toBe("ESTABLISHED_ASSOCIATION");
  });

  it("property: every combination of facts yields a rule-checked assessment and a valid, non-'not measured' card", () => {
    const profiles = ["CONTAINS_CONCEPT", "ABSENT", "NOT_OBSERVED"] as const;
    const queries = ["RETURNED", "CLEAN_EMPTY", "UNRELIABLE", "FAILED", "NOT_RUN"] as const;
    for (const profile of profiles) for (const q of queries) for (const shared of [0, 1]) for (const mismatch of [0, 1]) for (const relation of [null, "NARROWER", "RELATED_DIFFERENT"] as const) {
      const t = territory({
        ...(relation && { conceptAlignment: { userConcept: "Synthetic Target", qlooConcept: { id: CONCEPT.id, label: CONCEPT.label }, relation, reason: "SYNTHETIC", uncovered: relation === "NARROWER" ? ["other part"] : [], decidedBy: "agent" } }),
        directEvidence: facts({ brandProfile: { status: profile, source: profile === "NOT_OBSERVED" ? null : "run_profile", correlationId: null }, conditionedQuery: { status: q, entityCount: q === "RETURNED" ? 7 : 0, correlationId: "SYN-C1" }, sharedSignals: shared ? [{ id: "urn:tag:keyword:syn:other", label: "Other Signal" }] : [], exemplarJudgments: { strong: 1, adequate: 0, weak: 0, mismatch, unjudged: 0 } }),
      });
      const r = result([t]);
      const a = assessTerritoryEvidence(r, t);
      expect(evidenceAssessmentViolations(a), JSON.stringify({ profile, q, shared, mismatch, relation })).toEqual([]);
      if (a.outcome === "NO_SUPPORT_IN_TESTED_SCOPE") expect(profile).not.toBe("CONTAINS_CONCEPT");
      if (q !== "CLEAN_EMPTY") expect(a.outcome).not.toBe("NO_SUPPORT_IN_TESTED_SCOPE");
      const card = decisionCard(r, "syn_target")!;
      expect(card.finding).not.toMatch(/^not measured/iu);
      expect(decisionCardViolations(card, r)).toEqual([]);
    }
  });
});

describe("Sprint 12 compound coverage and next actions", () => {
  it("lists every concept of a compound question; an uncovered part gets its own investigation, never the other's evidence", () => {
    const repair = territory({ key: "clothing_repair", label: "Syn Repair", directEvidence: facts({ sharedSignals: [{ id: "urn:tag:keyword:syn:other", label: "Other Signal" }] }) });
    const r = result([repair], { researchScope: { originalTerritory: "Syn Repair and Syn Upcycling", concepts: [{ name: "Syn Repair", territoryKey: "clothing_repair" }, { name: "Syn Upcycling", territoryKey: null }], decidedBy: "runtime", reason: "SYNTHETIC" } });
    const research = assessResearch(r);
    expect(research.coverage.map((c) => [c.concept, c.status])).toEqual([["Syn Repair", "COVERED"], ["Syn Upcycling", "NOT_COVERED"]]);
    expect(research.headline).toMatch(/Not investigated: Syn Upcycling/u);
    const card = decisionCard(r, "clothing_repair")!;
    expect(card.nextActions[0]).toMatchObject({ kind: "INVESTIGATE_UNCOVERED", question: "Is Syn Upcycling a credible cultural territory for Synthetic Brand?" });
    expect(card.conclusion?.text).not.toMatch(/Upcycling/u);
  });

  it("an established association points to what extends it, not to a fit comparison", () => {
    const r = result([territory({ directEvidence: facts({ brandProfile: { status: "CONTAINS_CONCEPT", source: "run_profile", correlationId: "SYN-P1" } }) })]);
    const card = decisionCard(r, "syn_target")!;
    expect(card.conclusion?.outcome).toBe("ESTABLISHED_ASSOCIATION");
    expect(card.implication.code).toBe("ESTABLISHED_POSITIONING");
    expect(card.nextActions[0]?.kind).toBe("EXTEND_ESTABLISHED");
    expect(card.nextActions.map((x) => x.kind)).not.toContain("COMPARE_WITH_NAMED");
  });
});

describe("Sprint 12 runtime", () => {
  const BRAND = "Saffron & Salt";
  const TABLEWARE = "urn:tag:industry:syn:tableware";
  const SEMANTIC = { relevance: "strong", reason: "SYNTHETIC: an instance" } as const;
  const exemplars = ["SYN-BR-0201", "SYN-BR-0202", "SYN-BR-0203"].map((id) => ({ id, reason: "SYNTHETIC observed member", semantic: SEMANTIC }));
  const runtime = (steps: ConstructorParameters<typeof ScriptedAgentModel>[0]) => new AgentRuntime({ model: new ScriptedAgentModel(steps, [], "sprint12-script"), provider: createScriptedToolProvider(loadWorld()), researchPolicy: "v1" });

  it("records direct-evidence facts per target and stores the same assessment the shared function computes", async () => {
    const r = await runtime([
      [call("interpret_request", { intent: "analyze_move", brand: BRAND, territories: ["Tableware"] })],
      [call("qloo_resolve_entity", { name: BRAND, type: "brand", role: "brand" })],
      [call("qloo_get_entity_tags", { entityId: "SYN-BR-0004" }), call("qloo_find_tags", { query: "Tableware", limit: 5 }), call("qloo_recommend", { targetType: "brand", tagIds: [TABLEWARE], conditionOnBrand: false, limit: 20 })],
      [call("anchor_territory", { territoryKey: "tableware", tagId: TABLEWARE }), call("validate_territory_representation", { territoryKey: "tableware", entityType: "brand", exemplars })],
      [{ action: "analyze", targetIds: ["tableware"], reasonSummary: "analyze" }],
      [{ action: "finish", resultIds: ["tableware"], reasonSummary: "done" }],
    ]).run({ userQuery: "SYNTHETIC", intent: "analyze_move", brand: BRAND, territories: ["Tableware"], researchMode: "single_hypothesis_v1" });
    if (r.status === "NEEDS_INPUT") throw new Error("unexpected");
    const t = r.territories.find((x) => x.key === "tableware")!;
    expect(t.directEvidence?.version).toBe("direct-evidence/v1");
    expect(t.directEvidence?.conceptSearch).toBe("FOUND");
    expect(t.directEvidence?.tautologicalSignals.some((s) => s.id === TABLEWARE)).toBe(false);
    expect(r.evidenceAssessment).toEqual(assessResearch({ ...r, evidenceAssessment: undefined }));
    expect(r.evidenceAssessment?.territories[0]?.basis).toBe("DIRECT_FACTS");
    for (const a of r.evidenceAssessment!.territories) expect(evidenceAssessmentViolations(a)).toEqual([]);
  });

  it("splits a compound question into one target per brief concept, investigates without a ranking, budgets unchanged", async () => {
    const brief = {
      centralQuestion: "SYNTHETIC: do both practices fit the brand?",
      concepts: [{ name: "Tableware Repair", meaning: "SYNTHETIC: mending", notThis: [] }, { name: "Tableware Upcycling", meaning: "SYNTHETIC: remaking", notThis: [] }],
      usefulAnswer: "SYNTHETIC", approach: "compare" as const, approachReason: "SYNTHETIC",
    };
    const seen: string[][] = [];
    const r = await runtime([
      [call("interpret_request", { intent: "analyze_move", brand: BRAND, territories: ["Tableware Repair and Upcycling"] })],
      (c) => (seen.push(c.territories.map((t) => t.key)), [{ action: "finish", resultIds: [], reasonSummary: "stop" }]),
    ]).run({ userQuery: "SYNTHETIC", brand: BRAND, territories: ["Tableware Repair and Upcycling"], researchBrief: brief, limits: { maxAgentIterations: 3 } });
    if (r.status === "NEEDS_INPUT") throw new Error("unexpected");
    expect(r.researchScope).toMatchObject({ originalTerritory: "Tableware Repair and Upcycling", concepts: [{ name: "Tableware Repair" }, { name: "Tableware Upcycling" }] });
    expect(r.territories.filter((t) => t.role === "target").map((t) => t.label).sort()).toEqual(["Tableware Repair", "Tableware Upcycling"]);
    expect(r.researchApproach).toMatchObject({ approach: "investigate", decidedBy: "runtime" });
    expect(r.trace.limits.maxQlooCalls).toBe(24);
    expect(r.evidenceAssessment?.coverage.map((c) => c.concept)).toEqual(["Tableware Repair", "Tableware Upcycling"]);
  });

  it("does not split when a brief concept is not part of the user's territory, or under v0", async () => {
    const brief = { centralQuestion: "SYNTHETIC", concepts: [{ name: "Tableware", meaning: "SYNTHETIC", notThis: [] }, { name: "Night Markets", meaning: "SYNTHETIC", notThis: [] }], usefulAnswer: "SYNTHETIC", approach: "compare" as const, approachReason: "SYNTHETIC" };
    const r = await runtime([
      [call("interpret_request", { intent: "analyze_move", brand: BRAND, territories: ["Tableware"] })],
      [{ action: "finish", resultIds: [], reasonSummary: "stop" }],
    ]).run({ userQuery: "SYNTHETIC", brand: BRAND, territories: ["Tableware"], researchBrief: brief, limits: { maxAgentIterations: 3 } });
    if (r.status === "NEEDS_INPUT") throw new Error("unexpected");
    expect(r.researchScope).toBeUndefined();
    expect(r.territories.map((t) => t.label)).toEqual(["Tableware"]);
  });
});

describe("Sprint 12 thin-panel reference bound (trace evidence: live 10D L2)", () => {
  const registry = new ToolRegistry();
  const LANTERN = "urn:tag:category:synplace:lantern_markets";
  const BRAND_GENRES = ["urn:tag:genre:synbrand:capsule_wardrobe", "urn:tag:keyword:synmedia:city_life", "urn:tag:genre:synfilm:design_docs"];
  const probe = (tag: string) => ["qloo_recommend", { targetType: "place", tagIds: [tag], conditionOnBrand: false, limit: 20 }] as const;

  it(`stops reference probing after ${THIN_PANEL_EMPTY_PROBE_LIMIT} empty probes when one exemplar and no typed candidate remain`, async () => {
    const state = freshState({ brand: "Corvid Basics", territories: ["Lantern Markets"] });
    state.feasibilityPolicy = "enforce";
    const provider = scripted();
    const exec = (tool: string, args: unknown) => executeToolCall(state, registry, provider, tool, args);
    await exec("interpret_request", { intent: "analyze_move", brand: "Corvid Basics", territories: ["Lantern Markets"] });
    transition(state, "RESOLVING", "test");
    await exec("qloo_resolve_entity", { name: "Corvid Basics", type: "brand", role: "brand" });
    transition(state, "INVESTIGATING", "test");
    await exec("qloo_find_tags", { query: "Lantern Markets", limit: 8 });
    await exec(...probe(LANTERN));
    await exec("anchor_territory", { territoryKey: "lantern_markets", tagId: LANTERN });
    await exec("validate_territory_representation", { territoryKey: "lantern_markets", entityType: "place", exemplars: [{ id: "SYN-PL-9N31", reason: "only Qloo member" }] });
    await exec("qloo_get_entity_tags", { entityId: "SYN-BR-9N02" });
    await exec(...probe(BRAND_GENRES[0]!));
    expect(referencePlan(state).feasible).toBe(true);
    await exec(...probe(BRAND_GENRES[1]!));
    const plan = referencePlan(state);
    expect(plan.feasible).toBe(false);
    expect(plan.blockedBy).toBe("NO_REFERENCE_YIELD");
    const f = assessComparisonFeasibility(state)!;
    expect(f).toMatchObject({ status: "INFEASIBLE", repeat: "LIKELY_REPEATS" });
    expect(f.nextAction?.action).toBe("analyze");
  });
});
