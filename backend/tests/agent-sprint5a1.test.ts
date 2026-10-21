/**
 * Sprint 5A.1 regression tests (SYNTHETIC world, offline). Each test pins a reliability contract or reproduces a
 * failure class observed in the Sprint 5A live traces (bounded probing, entity-type alignment, completion arithmetic,
 * frontier canonicalization, readiness gate v3). None of this is a live Qloo or live model validation.
 */
import type { AgentAnalysisResult, AgentRunResponse } from "@cultural-elasticity/shared";
import { describe, expect, it } from "vitest";
import { validateClaims } from "../src/agent/claim-validator.js";
import { canonicalConceptKey, canonicalRelation } from "../src/agent/concept-dedup.js";
import { nextActionValues } from "../src/agent/evidence-sufficiency.js";
import { candidateCanonicalization, frontierCandidatePool, frontierEvidenceBase, FRONTIER_EVIDENCE_BASE, outsideFrontierEvidenceBase } from "../src/agent/frontier.js";
import { ScriptedAgentModel } from "../src/agent/model/scripted.js";
import { conceptProbeState, MAX_EMPTY_TYPE_PROBES_PER_CONCEPT, probeRefusal, territoryProbeState } from "../src/agent/probe-policy.js";
import { recoveryGuidance, territoryReadiness } from "../src/agent/readiness.js";
import { completionCost, referencePlan } from "../src/agent/reference-strategy.js";
import { alignmentDeferral, comparisonRepresentationPlan } from "../src/agent/representation-alignment.js";
import { findTerritory, transition, turnsAvailable } from "../src/agent/state.js";
import { executeToolCall } from "../src/agent/tool-executor.js";
import { ToolRegistry } from "../src/agent/tool-registry.js";
import { toEntitySignals, type QlooEnvelope } from "../src/qloo/normalize.js";
import { acceptedUnsupportedClaims, evaluateStability, loadStabilityCriteria, readinessGate, type LiveRun, type StabilityCriteria } from "../scripts/agent-live-harness.js";
import { evaluateRun } from "../scripts/run-evaluators.js";
import { call, freshState, runtime, scripted } from "./fixtures/synthetic/agent.js";

const registry = new ToolRegistry();
const LANTERN = "urn:tag:culinary_experience:syn:lantern_feasting";
const SUPPER = "urn:tag:keyword:syn:lantern_supper";
const THRASH = "urn:tag:genre:syn:thrash_revival";
const ESPRESSO_BRAND = "urn:tag:product_category:syn:espresso";
const ESPRESSO_PLACE = "urn:tag:cuisine:syn:espresso";
const GRAVEL = "urn:tag:activity_type:syn:gravel_riding";
const ALPINE = "urn:tag:activity_type:syn:alpine_hiking";
const probe = (targetType: string, tag: string) => ["qloo_recommend", { targetType, tagIds: [tag], conditionOnBrand: false, limit: 20 }] as const;

async function resolved(brand: string, territories: string[], intent: "analyze_move" | "compare_territories" | "explore_frontier", faults: Parameters<typeof scripted>[0] = []) {
  const state = freshState({ brand, ...(territories.length && { territories }) });
  const provider = scripted(faults);
  const exec = (tool: string, args: unknown) => executeToolCall(state, registry, provider, tool, args);
  await exec("interpret_request", { intent, brand, territories });
  transition(state, "RESOLVING", "test");
  await exec("qloo_resolve_entity", { name: brand, type: "brand", role: "brand" });
  transition(state, "INVESTIGATING", "test");
  for (const t of territories) await exec("qloo_find_tags", { query: t, limit: 8 });
  return { state, provider, exec };
}

describe("Sprint 5A.1 bounded entity-type probing (live L-C2: 8 empty types for one concept)", () => {
  it("one empty probe is counted, leaves the remaining type options and does not exhaust the concept", async () => {
    const { state, exec } = await resolved("Gravemoss Water", ["Lantern Feasting"], "analyze_move");
    await exec(...probe("place", LANTERN));
    const p = conceptProbeState(state, LANTERN);
    expect(p).toMatchObject({ attemptedTypes: ["place"], emptyTypes: ["place"], successfulTypes: [], totalEmptyTypeProbes: 1, consecutiveEmptyProbes: 1, probingExhausted: false });
    expect(p.remainingTypeOptions).not.toContain("place");
    expect(p.remainingTypeOptions.length).toBe(MAX_EMPTY_TYPE_PROBES_PER_CONCEPT - 1);
    expect(probeRefusal(state, LANTERN, "brand")).toBeNull();
  });

  it(`after ${MAX_EMPTY_TYPE_PROBES_PER_CONCEPT} empty types the concept is exhausted and a new type is refused`, async () => {
    const { state, exec } = await resolved("Gravemoss Water", ["Lantern Feasting"], "analyze_move");
    for (const type of ["place", "brand", "book"]) await exec(...probe(type, LANTERN));
    const p = conceptProbeState(state, LANTERN);
    expect(p.probingExhausted).toBe(true);
    expect(p.remainingTypeOptions).toEqual([]);
    expect(p.exhaustionReason).toMatch(/3 entity types \(place, brand, book\) returned no members/u);
    expect(probeRefusal(state, LANTERN, "artist")).toMatch(/probing it with further types has no expected value/u);
  });

  it("a type that returned members is never refused, so observed evidence stays usable", async () => {
    const { state, exec } = await resolved("Gravemoss Water", ["Thrash Revival"], "analyze_move");
    await exec(...probe("artist", THRASH));
    for (const type of ["place", "brand", "book"]) await exec(...probe(type, THRASH));
    const p = conceptProbeState(state, THRASH);
    expect(p.successfulTypes).toEqual(["artist"]);
    expect(p.probingExhausted).toBe(true);
    expect(probeRefusal(state, THRASH, "artist")).toBeNull();
    expect(probeRefusal(state, THRASH, "movie")).toMatch(/reuse the type that returned members \(artist\)/u);
  });

  it("a retryable provider error is not an empty probe (no pool, no evidence that the type is unsupported)", async () => {
    const { state, exec } = await resolved("Gravemoss Water", ["Lantern Feasting"], "analyze_move", [{ operation: "recommend", whenInputContains: "lantern_feasting", status: "error", code: "QLOO_UPSTREAM", retryable: true, times: 4 }]);
    const out = await exec(...probe("place", LANTERN));
    expect(out.accepted && out.result.status).toBe("failed");
    expect(conceptProbeState(state, LANTERN)).toMatchObject({ attemptedTypes: [], emptyTypes: [], totalEmptyTypeProbes: 0 });
  });

  it("a degraded empty answer is unreliable, not unsupported", async () => {
    const { state, exec } = await resolved("Gravemoss Water", ["Lantern Feasting"], "analyze_move", [{ operation: "recommend", whenInputContains: "lantern_feasting", status: "degraded", times: 1 }]);
    await exec(...probe("place", LANTERN));
    expect(conceptProbeState(state, LANTERN)).toMatchObject({ attemptedTypes: ["place"], emptyTypes: [], unreliableTypes: ["place"], totalEmptyTypeProbes: 0 });
  });

  it("6 empty probes across a territory's concepts with no member make it unsupported (honest degradation)", async () => {
    const { state, exec } = await resolved("Gravemoss Water", ["Lantern Feasting"], "analyze_move");
    for (const type of ["place", "brand", "book"]) await exec(...probe(type, LANTERN));
    for (const type of ["place", "movie", "podcast"]) await exec(...probe(type, SUPPER));
    const t = findTerritory(state, "lantern_feasting")!;
    expect(territoryProbeState(state, t)).toMatchObject({ totalEmpty: 6, anySuccessful: false, exhausted: true });
    expect(territoryReadiness(state, t)).toMatchObject({ state: "unsupported" });
    expect(recoveryGuidance(state, t).join(" ")).toMatch(/Qloo evidence does not support it in this run/u);
  });

  it("accepts the live `popularity: null` shape as absent instead of rejecting the whole result", () => {
    const envelope = { schema_version: "x", operation: "recommend", status: "ok", results: [{ entity_id: "SYN-PL-9999", name: "Null Pop Place", type: "urn:entity", popularity: null }], execution: { transport: "mcp", correlation_id: "syn-null" } } as unknown as QlooEnvelope;
    const [signal] = toEntitySignals("recommend", envelope);
    expect(signal).toMatchObject({ qlooId: "SYN-PL-9999", label: "Null Pop Place" });
    expect(signal).not.toHaveProperty("popularity");
  });
});

describe("Sprint 5A.1 entity-type alignment (live L-C1: brand vs place targets, no common set)", () => {
  async function aligned() {
    const r = await resolved("Larkspur Velo", ["Gravel Riding", "Alpine Hiking", "Espresso"], "compare_territories");
    await r.exec(...probe("place", GRAVEL));
    await r.exec(...probe("place", ALPINE));
    return r;
  }

  it("a type all targets support is SUPPORTED and preferred", async () => {
    const r = await aligned();
    await r.exec(...probe("place", ESPRESSO_PLACE));
    const plan = comparisonRepresentationPlan(r.state)!;
    expect(plan).toMatchObject({ preferredCommonType: "place", feasibility: "SUPPORTED", required: 3 });
    expect(plan.supportedTerritoriesByType.place).toEqual(["gravel_riding", "alpine_hiking", "espresso"]);
  });

  it("a mismatched target with an untested concept is POSSIBLE; its off-type anchor is deferred once with the probe to make", async () => {
    const r = await aligned();
    await r.exec(...probe("place", ESPRESSO_BRAND));
    await r.exec(...probe("brand", ESPRESSO_BRAND));
    const plan = comparisonRepresentationPlan(r.state)!;
    expect(plan.feasibility).toBe("POSSIBLE");
    expect(plan.reasonCodes).toContain("TYPE_PROBE_PATH:espresso");
    expect(plan.missingRequirements.join(" ")).toContain(ESPRESSO_PLACE);
    const espresso = findTerritory(r.state, "espresso")!;
    expect(alignmentDeferral(r.state, espresso, ESPRESSO_BRAND)).toMatch(/Probe place on .*cuisine:syn:espresso/u);
    expect(recoveryGuidance(r.state, espresso).join(" ")).toMatch(/type alignment first/u);
    // Bounded: once deferred, anchoring proceeds (alignment is steered, never forced).
    r.state.alignmentDeferrals.add("espresso");
    expect(alignmentDeferral(r.state, espresso, ESPRESSO_BRAND)).toBeNull();
  });

  it("without any untested concept the common type is UNSUPPORTED for that target and nothing is forced", async () => {
    const r = await aligned();
    for (const tag of [ESPRESSO_BRAND, ESPRESSO_PLACE, "urn:tag:keyword:syn:espresso_ritual"]) for (const type of ["place", "book", "movie"]) await r.exec(...probe(type, tag));
    const plan = comparisonRepresentationPlan(r.state)!;
    const espresso = findTerritory(r.state, "espresso")!;
    expect(plan.reasonCodes.some((c) => c === "TYPE_MISMATCH:espresso" || c === "COMMON_TYPE_SUPPORTED")).toBe(true);
    expect(alignmentDeferral(r.state, espresso, ESPRESSO_BRAND)).toBeNull();
  });
});

describe("Sprint 5A.1 completion feasibility (live L-C2: references in hand, plan said 'only 2 turns left')", () => {
  it("credits already-probed usable references: no probe turn and no probe calls for them", () => {
    expect(completionCost({ needed: 2, usableProbed: 2, pending: 0, discovery: 0, reserve: 1 })).toEqual({ turns: 2, calls: 5 });
    expect(completionCost({ needed: 2, usableProbed: 0, pending: 0, discovery: 2, reserve: 1 })).toEqual({ turns: 4, calls: 9 });
    expect(completionCost({ needed: 0, usableProbed: 0, pending: 0, discovery: 0, reserve: 0 })).toEqual({ turns: 1, calls: 0 });
  });

  it("counts the open turn: the same number of turns is available inside a turn and between turns", () => {
    const state = freshState();
    state.limits.maxAgentIterations = 12;
    state.usage.iterations = 9;
    const between = turnsAvailable(state);
    state.usage.iterations = 10;
    state.turnOpen = true;
    expect(turnsAvailable(state)).toBe(between);
    expect(between).toBe(3);
  });

  it("downgrades to an honest PARTIAL when the remaining turns cannot finish the references", async () => {
    const { state, exec } = await resolved("Larkspur Velo", ["Gravel Riding"], "analyze_move");
    await exec(...probe("place", GRAVEL));
    await exec("anchor_territory", { territoryKey: "gravel_riding", tagId: GRAVEL });
    await exec("validate_territory_representation", { territoryKey: "gravel_riding", entityType: "place", exemplars: ["SYN-PL-3001", "SYN-PL-3002", "SYN-PL-3003"].map((id) => ({ id, reason: "Qloo tag member" })) });
    await exec("qloo_get_entity_tags", { entityId: "SYN-BR-3001" });
    state.usage.iterations = state.limits.maxAgentIterations - 1;
    const plan = referencePlan(state);
    expect(plan.feasible).toBe(false);
    expect(plan.completion).toMatchObject({ fullAnalysisFeasible: false, remainingTurns: 1, missingReferenceCount: 2 });
    expect(plan.reason).toMatch(/only 1 turn\(s\) left; references and analysis need [3-9]/u);
  });

  it("anchors a reference at proposal when its single evidence tag is accepted (one step fewer); a vetoed one is not", async () => {
    const { state, exec } = await resolved("Larkspur Velo", ["Gravel Riding"], "analyze_move");
    await exec(...probe("place", GRAVEL));
    await exec("anchor_territory", { territoryKey: "gravel_riding", tagId: GRAVEL });
    await exec("validate_territory_representation", { territoryKey: "gravel_riding", entityType: "place", exemplars: [{ id: "SYN-PL-3001", reason: "Qloo tag member" }] });
    await exec("qloo_get_entity_tags", { entityId: "SYN-BR-3001" });
    const ref = (label: string, tag: string, relevance: string) => exec("propose_territory", { label, role: "reference", origin: "qloo_evidence", rationale: "on the brand profile", evidenceTagIds: [tag], semantic: { relevance, reason: "test" } });
    await ref("Mountain Town", "urn:tag:keyword:syn:mountain_town", "adequate");
    await ref("Coastal Road", "urn:tag:keyword:syn:coastal_road", "weak");
    expect(findTerritory(state, "mountain_town")).toMatchObject({ status: "anchored", concept: { id: "urn:tag:keyword:syn:mountain_town" } });
    expect(findTerritory(state, "coastal_road")).toMatchObject({ status: "open", concept: null });
  });

  it("reserves the last turn for analysis: investigation actions are worth NONE (COMPLETION_RESERVE)", async () => {
    const { state, exec } = await resolved("Larkspur Velo", ["Gravel Riding", "Alpine Hiking"], "compare_territories");
    await exec(...probe("place", GRAVEL));
    await exec("anchor_territory", { territoryKey: "gravel_riding", tagId: GRAVEL });
    await exec("validate_territory_representation", { territoryKey: "gravel_riding", entityType: "place", exemplars: [{ id: "SYN-PL-3001", reason: "Qloo tag member" }] });
    state.usage.iterations = state.limits.maxAgentIterations;
    state.turnOpen = true;
    const investigation = nextActionValues(state).filter((a) => !["analyze", "finish", "ask_user"].includes(a.action));
    expect(investigation.length).toBeGreaterThan(0);
    for (const a of investigation) expect(a.value).toBe("NONE");
    expect(investigation.some((a) => a.reason.startsWith("COMPLETION_RESERVE"))).toBe(true);
  });
});

describe("Sprint 5A.1 frontier canonicalization and evidence base (live L-E2: same concepts, different anchors)", () => {
  it("normalizes the same concept across namespaces and plural forms", () => {
    expect(canonicalConceptKey("urn:tag:genre:media:self_help")).toBe(canonicalConceptKey("urn:tag:genre:qloo:self_help"));
    expect(canonicalConceptKey("urn:tag:genre:media:cookbooks")).toBe("cookbook");
    expect(canonicalConceptKey("Self Help")).toBe("self_help");
  });

  it("keeps distinct concepts distinct: a token-containment alias is recorded as uncertain, never merged", async () => {
    expect(canonicalRelation("folk", "folk_music")).toBe("ALIAS");
    expect(canonicalRelation("feminism", "feminist")).toBeNull();
    expect(canonicalRelation("self_help", "self_help")).toBe("SAME");
    const { state } = await resolved("Larkspur Velo", ["Gravel Riding"], "analyze_move");
    const t = findTerritory(state, "gravel_riding")!;
    t.sourceTagId = "urn:tag:keyword:syn:gravel";
    t.concept = { id: GRAVEL, label: "Gravel Riding", type: "urn:tag:activity_type:syn" };
    const c = candidateCanonicalization(state, t);
    expect(c).toMatchObject({ canonicalConceptKey: "gravel", normalizationReason: "SOURCE_TAG_CANONICAL_NAME", anchorRelation: "ALIAS_TOKEN_CONTAINMENT" });
    expect(c.uncertainty).toMatch(/plausible alias, not established equivalence/u);
  });

  it("builds the same candidate pool whatever order the evidence-base profiles were fetched in", async () => {
    const pools: string[][] = [];
    for (const order of ["forward", "reverse"] as const) {
      const { state, exec } = await resolved("Granite Hollow", [], "explore_frontier");
      await exec("qloo_get_entity_tags", { entityId: "SYN-BR-2001" });
      await exec("qloo_related_entities", { entityId: "SYN-BR-2001", targetType: "brand", limit: 2 });
      const base = frontierEvidenceBase(state);
      expect(base.length).toBe(FRONTIER_EVIDENCE_BASE);
      for (const id of order === "forward" ? base : [...base].reverse()) await exec("qloo_get_entity_tags", { entityId: id });
      pools.push(frontierCandidatePool(state).map((p) => `${p.canonicalConceptKey}:${p.support}`));
    }
    expect(pools[0]!.length).toBeGreaterThan(0);
    expect(pools[1]).toEqual(pools[0]);
  });

  it("requests the brand's related entities at a fixed take and refuses profiles outside the evidence base", async () => {
    const { state, exec } = await resolved("Granite Hollow", [], "explore_frontier");
    const out = await exec("qloo_related_entities", { entityId: "SYN-BR-2001", targetType: "brand", limit: 2 });
    expect(out.accepted && out.result.summary).toBe("8 related brand entities");
    const seventh = state.related[0]!.memberIds[FRONTIER_EVIDENCE_BASE]!;
    expect(outsideFrontierEvidenceBase(state, seventh)).toMatch(/frontier evidence base is the first 6 related entities/u);
    expect(outsideFrontierEvidenceBase(state, state.related[0]!.memberIds[0]!)).toBeNull();
  });
});

describe("Sprint 5A.1 runtime: malformed actions and cross-scope numbers stay refused", () => {
  it("a malformed model action is refused with a reason, not executed and not a crash", async () => {
    const model = new ScriptedAgentModel([[{ action: "call_tool", tool: "qloo_recommend", arguments: { targetType: "spaceship", tagIds: [] } }], { invalid: "not JSON" }, { invalid: "not JSON" }]);
    const response = await runtime(model).runtime.run({ userQuery: "q", brand: "Larkspur Velo", territories: ["Gravel Riding"] });
    expect(response.status).toBe("FAILED");
    const codes = response.trace.turns.flatMap((t) => t.decisions.map((d) => d.rejection?.split(":")[0]));
    expect(codes.some((c) => c === "INVALID_ARGUMENTS" || c === "WRONG_PHASE" || c === "NOT_EXPOSED")).toBe(true);
    expect(response.trace.toolCalls.some((c) => c.tool === "qloo_recommend" && c.status !== "rejected")).toBe(false);
  });

  it("a number from another territory's result cannot be attached to this territory", async () => {
    const response = (await runtime().runtime.run({ userQuery: "q", brand: "Pine Hollow Supply", territories: ["Stream Angling"] })) as AgentAnalysisResult;
    const a = response.territories.find((t) => t.role === "target" && t.relativePosition)!;
    const own = new Set(JSON.stringify(a).match(/-?\d+(\.\d+)?/gu) ?? []);
    const other = response.territories.find((t) => t.key !== a.key && t.relativePosition?.medianPercentile != null && !own.has(String(t.relativePosition.medianPercentile)))!;
    expect(other).toBeTruthy();
    const text = (n: number) => `Its median percentile is ${n} within its comparison set.`;
    const foreign = validateClaims({ summary: "Qualitative summary.", territoryNotes: [{ territoryKey: a.key, text: text(other.relativePosition!.medianPercentile!) }], followUpOptions: [] }, response.territories, ["Pine Hollow Supply"]);
    expect(foreign.length).toBeGreaterThan(0);
    // The same sentence with the territory's own value is accepted: the rule is scope, not a blanket ban on numbers.
    const ownValue = validateClaims({ summary: "Qualitative summary.", territoryNotes: [{ territoryKey: other.key, text: text(other.relativePosition!.medianPercentile!) }], followUpOptions: [] }, response.territories, ["Pine Hollow Supply"]);
    expect(ownValue).toEqual([]);
  });
});

describe("Sprint 5A.1 gate claim re-validation keeps per-territory scope (live L-C2 evaluator false positive)", () => {
  it("accepts a territory's own evidence-quality statement in its note; the same claim in the summary is still rejected", async () => {
    const r = structuredClone((await runtime().runtime.run({ userQuery: "q", brand: "Pine Hollow Supply", territories: ["Stream Angling"] })) as AgentAnalysisResult);
    expect(r.territories.length).toBeGreaterThan(1);
    const t = r.territories.find((x) => x.role === "target" && x.evidenceQuality)!;
    expect(t).toBeTruthy();
    const level = t.evidenceQuality!.level.toLowerCase();
    r.summary.text = `The evidence is partial for this brand.\n${t.label}: The route is partial and evidence quality is ${level}.`;
    expect(acceptedUnsupportedClaims(r)).toBe(0);
    r.summary.text = `The evidence is partial and evidence quality is ${level}.`;
    expect(acceptedUnsupportedClaims(r)).toBeGreaterThan(0);
  });
});

// ---- Readiness gate v3 (safety vs competence) ----

const manifest = { version: "test-v1", caseIds: ["S-0", "S-1"], frontierCaseIds: ["S-1"] };
const criteria: StabilityCriteria = { version: "test-criteria", requiredRuns: 3, baseline: { cases: { "S-1": { supportedCanonicalOverlap: 0.5 } } }, criteria: { S1_supportedCanonicalOverlap: { floor: 0.25, tolerance: 0.1 }, S2_recurringSupportedCanonical: { minimum: 1 }, S3_anchorConsistency: { minimum: 0.5 } } };
const stableReport = { "S-1": { runs: 3, supportedCanonicalOverlap: 0.6, recurringSupportedCanonical: ["syn_concept"], anchorConsistency: 1 } };

/** Marks a synthetic result as if a model synthesis had been accepted (offline instrument for the gate only). */
function withModelSynthesis(r: AgentRunResponse): AgentRunResponse {
  if (r.status === "NEEDS_INPUT") return r;
  const a = structuredClone(r) as AgentAnalysisResult;
  a.trace.synthesis = { source: "model", attempts: 1, violations: [], attemptDetails: [{ attempt: 1, accepted: true, categories: {}, violations: [] }] };
  a.summary.source = "model";
  a.layers.agentInterpretation.findings = a.territories.filter((t) => t.role !== "reference").map((t) => ({ territoryKey: t.key, claimType: "route_limitation", supportingFields: ["analysisRoute"], interpretation: "route", limitationCodes: [] }));
  a.followUpOptions = a.followUpOptions.length ? a.followUpOptions : ["probe another entity type"];
  return a;
}

/** Renames territory keys of a FULL compare result to the controlled case's keys (offline instrument for the gate). */
function asControlled(r: AgentRunResponse, keys: Record<string, string>): AgentRunResponse {
  const a = structuredClone(r) as AgentAnalysisResult;
  const k = (key: string) => keys[key] ?? key;
  for (const t of a.territories) {
    t.key = k(t.key);
    if (t.comparisonSet) t.comparisonSet.territoryKeys = t.comparisonSet.territoryKeys.map(k);
  }
  for (const s of a.comparisonSetConstruction.semanticAssessments ?? []) Object.assign(s, { targetTerritoryKey: k(s.targetTerritoryKey), memberTerritoryKeys: s.memberTerritoryKeys.map(k), acceptedReferences: s.acceptedReferences.map(k), referenceTerritoryKeys: s.referenceTerritoryKeys.map(k) });
  return a;
}

async function arm(): Promise<LiveRun[]> {
  const requests = [
    { userQuery: "q", brand: "Pine Hollow Supply", territories: ["Stream Angling"] },
    { userQuery: "q", brand: "Kestrel Outfitters", territories: [] },
  ];
  const out: LiveRun[] = [];
  for (const [i, req] of requests.entries()) {
    const response = withModelSynthesis(await runtime().runtime.run(req));
    out.push({ id: `S-${i}`, caseId: `S-${i}`, arm: "LIVE_MODEL", response: { ...response, model: { id: "claude-haiku-5-5", kind: "llm", live: true } }, failures: [], contexts: [], askedUser: false, continued: false });
  }
  return out;
}

async function controlledFull(): Promise<LiveRun> {
  const C = (tool: string, args: unknown) => call(tool, args);
  const model = new ScriptedAgentModel([
    [C("interpret_request", { intent: "compare_territories", brand: "Larkspur Velo", territories: ["Gravel Riding", "Alpine Hiking", "Espresso"] })],
    [C("qloo_resolve_entity", { name: "Larkspur Velo", type: "brand", role: "brand" })],
    ["Gravel Riding", "Alpine Hiking", "Espresso"].map((q) => C("qloo_find_tags", { query: q, limit: 8 })),
    [GRAVEL, ALPINE, ESPRESSO_PLACE].map((tag) => C("qloo_recommend", { targetType: "place", tagIds: [tag], conditionOnBrand: false, limit: 20 })),
    [
      C("anchor_territory", { territoryKey: "gravel_riding", tagId: GRAVEL }),
      C("anchor_territory", { territoryKey: "alpine_hiking", tagId: ALPINE }),
      C("anchor_territory", { territoryKey: "espresso", tagId: ESPRESSO_PLACE }),
      ...[["gravel_riding", 1], ["alpine_hiking", 4], ["espresso", 7]].map(([k, n]) => C("validate_territory_representation", { territoryKey: k, entityType: "place", exemplars: [0, 1, 2].map((i) => ({ id: `SYN-PL-${3000 + (n as number) + i}`, reason: "Qloo tag member" })) })),
    ],
    [{ action: "analyze", targetIds: ["gravel_riding", "alpine_hiking", "espresso"], reasonSummary: "t" }],
    [{ action: "finish", resultIds: [], reasonSummary: "t" }],
  ]);
  const response = await runtime(model).runtime.run({ userQuery: "q", brand: "Larkspur Velo", territories: ["Gravel Riding", "Alpine Hiking", "Espresso"] });
  const relabelled = withModelSynthesis(asControlled(response, { gravel_riding: "fly_fishing", alpine_hiking: "mountaineering", espresso: "cycling" }));
  return { id: "C-FULL-1", caseId: "C-FULL-1", arm: "LIVE_MODEL", response: { ...relabelled, model: { id: "claude-haiku-5-5", kind: "llm", live: true } }, failures: [], contexts: [], askedUser: false, continued: false };
}

const preflightPass = [{ caseId: "C-FULL-1", status: "PASS" as const, checks: [] }];

describe("Sprint 5A.1 readiness gate v3: safety and competence are separate, both are required", () => {
  it("is READY only with complete safety AND competence evidence (controlled FULL, frontier criteria, synthesis)", async () => {
    const runs = await arm();
    const controlled = await controlledFull();
    expect((controlled.response as AgentAnalysisResult).territories.every((t) => t.analysisRoute === "FULL_RELATIVE_ANALYSIS")).toBe(true);
    const gate = readinessGate({ manifest, modelRuns: runs, baselineRuns: runs.map((r) => ({ ...r, arm: "BASELINE" })), stability: stableReport, criteria, controlled: { preflight: preflightPass, modelRuns: [controlled], baselineRuns: null } });
    expect(gate.safetyReadiness.blockingReasons).toEqual([]);
    expect(gate.competenceReadiness.blockingReasons, JSON.stringify(gate.competenceReadiness.blockingReasons)).toEqual([]);
    expect(gate.overallDecision).toBe("AGENT_MODEL_READY");
    expect(gate.controlledFullScenarioResult[0]).toMatchObject({ caseId: "C-FULL-1", preflight: "PASS", model: { reachedFull: true } });
    expect(gate.warnings.join(" ")).toMatch(/CONTROLLED_SCENARIO_NOT_OWNER_REVIEWED/u);
  });

  it("a missing live case blocks readiness as LIVE_VALIDATION_INCOMPLETE even when competence evidence exists", async () => {
    const runs = await arm();
    const gate = readinessGate({ manifest, modelRuns: runs.slice(0, 1), baselineRuns: runs, stability: stableReport, criteria, controlled: { preflight: preflightPass, modelRuns: [await controlledFull()], baselineRuns: null } });
    expect(gate.safetyReadiness.passed).toBe(false);
    expect(gate.overallDecision).toBe("AGENT_MODEL_NOT_READY");
    expect(gate.blockingReasons.join(" ")).toMatch(/LIVE_VALIDATION_INCOMPLETE/u);
  });

  it("incomplete stability repeats fail the frontier criterion (INCOMPLETE), never pass it", async () => {
    const runs = await arm();
    const gate = readinessGate({ manifest, modelRuns: runs, baselineRuns: runs, stability: { "S-1": { runs: 2, supportedCanonicalOverlap: 1, recurringSupportedCanonical: ["x"], anchorConsistency: 1 } }, criteria, controlled: { preflight: preflightPass, modelRuns: [await controlledFull()], baselineRuns: null } });
    expect(gate.frontierStability[0]).toMatchObject({ caseId: "S-1", status: "INCOMPLETE" });
    expect(gate.competenceReadiness.checks.find((c) => c.name.startsWith("C5"))!.passed).toBe(false);
    expect(gate.overallDecision).toBe("AGENT_MODEL_NOT_READY");
  });

  it("zero FULL on the controlled scenario despite verified evidence fails competence", async () => {
    const runs = await arm();
    const partial = await controlledFull();
    const a = structuredClone(partial.response) as AgentAnalysisResult;
    for (const t of a.territories) t.analysisRoute = "PARTIAL_CULTURAL_ANALYSIS";
    const gate = readinessGate({ manifest, modelRuns: runs, baselineRuns: runs, stability: stableReport, criteria, controlled: { preflight: preflightPass, modelRuns: [{ ...partial, response: a }], baselineRuns: null } });
    expect(gate.competenceReadiness.checks.find((c) => c.name.startsWith("C4"))!.passed).toBe(false);
    expect(gate.overallDecision).toBe("AGENT_MODEL_NOT_READY");
  });

  it("a changed provider precondition is reported, and competence on the scenario is not claimed", async () => {
    const runs = await arm();
    const gate = readinessGate({ manifest, modelRuns: runs, baselineRuns: runs, stability: stableReport, criteria, controlled: { preflight: [{ caseId: "C-FULL-1", status: "PRECONDITION_CHANGED", checks: [] }], modelRuns: [], baselineRuns: null } });
    expect(gate.blockingReasons.join(" ")).toMatch(/CONTROLLED_PRECONDITION_CHANGED: C-FULL-1/u);
    expect(gate.overallDecision).toBe("AGENT_MODEL_NOT_READY");
  });

  it("the prospective criteria fail on the Sprint 5A baseline values, as the 5A manual decision did", () => {
    const v1 = loadStabilityCriteria();
    expect(v1.version).toBe("frontier-stability-criteria-v1");
    const e1 = evaluateStability("L-E1", { runs: 3, supportedCanonicalOverlap: 0.111, recurringSupportedCanonical: ["folk"], anchorConsistency: 0.5 }, v1);
    const e2 = evaluateStability("L-E2", { runs: 3, supportedCanonicalOverlap: 0.667, recurringSupportedCanonical: ["folk", "self_help"], anchorConsistency: 0 }, v1);
    expect(e1.status).toBe("FAIL");
    expect(e1.checks.find((c) => c.name.startsWith("S1"))!.passed).toBe(false);
    expect(e2.status).toBe("FAIL");
    expect(e2.checks.find((c) => c.name.startsWith("S3"))!.passed).toBe(false);
    expect(e2.checks.find((c) => c.name.startsWith("S1"))!.required).toBe("≥ 0.567");
  });

  it("targeted runtime evaluators pass on a bounded, aligned synthetic run and flag an over-probed one", async () => {
    const good = (await controlledFull()).response;
    expect(evaluateRun(good).filter((e) => e.applicable && !e.passed)).toEqual([]);
    const tampered = structuredClone(good) as AgentAnalysisResult;
    for (const type of ["place", "brand", "book", "movie"]) tampered.trace.toolCalls.push({ id: `x-${type}`, iteration: 1, tool: "qloo_recommend", permission: "read_only_external", arguments: { targetType: type, tagIds: [LANTERN], conditionOnBrand: false }, status: "empty", summary: "", qlooOperations: ["recommend"], correlationIds: [], attempts: 1, latencyMs: 0 });
    expect(evaluateRun(tampered).find((e) => e.id === "PROBE_BUDGET_VALID")).toMatchObject({ passed: false });
  });
});
