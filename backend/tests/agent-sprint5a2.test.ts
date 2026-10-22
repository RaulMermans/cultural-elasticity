/**
 * Sprint 5A.2 regression tests (SYNTHETIC world, offline). Each test pins a frontier-reliability contract or reproduces a
 * failure class observed in the Sprint 5A.1 live traces (L-E1 / L-E2): blind entity-type order for media-namespace tags,
 * unanchored support, discovery co-occurrence taken for duplication, anchor drift, `popularity: null`, and stability
 * scoring of unsupported runs. Fictional names, SYN- ids. None of this is live Qloo or live model validation.
 */
import type { AgentAnalysisResult } from "@cultural-elasticity/shared";
import { describe, expect, it } from "vitest";
import { exemplarCandidates } from "../src/agent/candidate-discovery.js";
import { structuralDuplicate } from "../src/agent/concept-dedup.js";
import { assessEvidenceSufficiency } from "../src/agent/evidence-sufficiency.js";
import { alternateAnchorRefusal, candidateCanonicalization, frontierCompletionReserve, frontierStability } from "../src/agent/frontier.js";
import { ScriptedAgentModel } from "../src/agent/model/scripted.js";
import { conceptProbeState, namespaceProbeEvidence, namespaceTypeBarren, probeRecommendations, rankProbeTypes, tagNamespace, territoryConcepts } from "../src/agent/probe-policy.js";
import { comparisonRepresentationPlan } from "../src/agent/representation-alignment.js";
import { findTerritory, transition } from "../src/agent/state.js";
import { executeToolCall, valueOfToolCall } from "../src/agent/tool-executor.js";
import { ToolRegistry } from "../src/agent/tool-registry.js";
import { toEntitySignals, toTagSignals, type QlooEnvelope } from "../src/qloo/normalize.js";
import { evaluateStability, loadStabilityCriteria } from "../scripts/agent-live-harness.js";
import { evaluateRun, unjustifiedProbes } from "../scripts/run-evaluators.js";
import { call, freshState, runtime, scripted } from "./fixtures/synthetic/agent.js";

const registry = new ToolRegistry();
const BRAND = "Brindlewood Oat";
const HC = "urn:tag:genre:synmedia:hearth_cooking";
const QA = "urn:tag:genre:synmedia:quiet_activism";
const SM = "urn:tag:genre:synmedia:slow_mornings";
const FF = "urn:tag:keyword:synmedia:found_family";
const PF = "urn:tag:genre:synmusic:porch_folk";
const PF_ALT = "urn:tag:music:syn:porch_folk";
const PLANT = "urn:tag:lifestyle:syn:plant_forward";
const RELATED = ["SYN-BR-5202", "SYN-BR-5203", "SYN-BR-5204", "SYN-BR-5205", "SYN-BR-5206", "SYN-BR-5207"];
const probe = (targetType: string, tag: string) => ["qloo_recommend", { targetType, tagIds: [tag], conditionOnBrand: false, limit: 20 }] as const;

/** A frontier run past discovery: brand profile, related brands, the six evidence-base profiles, proposed candidates. */
async function frontier(candidates: [string, string][], faults: Parameters<typeof scripted>[0] = []) {
  const state = freshState({ brand: BRAND });
  const provider = scripted(faults);
  const exec = (tool: string, args: unknown) => executeToolCall(state, registry, provider, tool, args);
  await exec("interpret_request", { intent: "explore_frontier", brand: BRAND, territories: [] });
  transition(state, "RESOLVING", "test");
  await exec("qloo_resolve_entity", { name: BRAND, type: "brand", role: "brand" });
  transition(state, "INVESTIGATING", "test");
  await exec("qloo_get_entity_tags", { entityId: "SYN-BR-5201" });
  await exec("qloo_related_entities", { entityId: "SYN-BR-5201", targetType: "brand", limit: 5 });
  for (const id of RELATED) await exec("qloo_get_entity_tags", { entityId: id });
  for (const [label, tag] of candidates) await exec("propose_territory", { label, role: "frontier_candidate", origin: "qloo_evidence", evidenceTagIds: [tag], rationale: "carried by related brands" });
  return { state, exec };
}

const FOUR: [string, string][] = [
  ["Hearth cooking", HC],
  ["Quiet activism", QA],
  ["Slow mornings", SM],
  ["Porch folk", PF],
];

describe("Sprint 5A.2 evidence-ranked probe types (live L-E1: place/brand/artist exhausted concepts Qloo keeps as books)", () => {
  it("a type that returned members for the concept is ranked first and stays usable after empty probes", async () => {
    const { state, exec } = await frontier(FOUR);
    for (const type of ["place", "brand", "artist"]) await exec(...probe(type, HC));
    await exec(...probe("book", HC));
    expect(rankProbeTypes(state, HC)[0]).toMatchObject({ type: "book", priority: "CONCEPT_MEMBERS" });
    expect(conceptProbeState(state, HC)).toMatchObject({ successfulTypes: ["book"], probingExhausted: true, currentPreferredType: "book" });
  });

  it("members for one concept rank that type first for the other concepts of the same tag namespace (scoped evidence)", async () => {
    const { state, exec } = await frontier(FOUR);
    await exec(...probe("place", HC));
    await exec(...probe("book", HC));
    expect(rankProbeTypes(state, QA)[0]).toMatchObject({ type: "book", priority: "NAMESPACE_MEMBERS" });
    expect(rankProbeTypes(state, QA).findIndex((r) => r.type === "book")).toBeLessThan(rankProbeTypes(state, QA).findIndex((r) => r.type === "place"));
    const ns = namespaceProbeEvidence(state, tagNamespace(QA), QA);
    expect(ns).toMatchObject({ namespace: "genre:synmedia", scope: { concepts: 1, excluded: QA } });
    expect(ns.observedEntityTypes).toEqual([
      { type: "place", successfulProbes: 0, emptyProbes: 1, unreliableProbes: 0, memberCount: 0 },
      { type: "book", successfulProbes: 1, emptyProbes: 0, unreliableProbes: 0, memberCount: 3 },
    ]);
    expect(ns.provenance.length).toBe(2);
  });

  it("evidence is never generalized beyond its namespace: book members in genre:synmedia say nothing about other namespaces", async () => {
    const { state, exec } = await frontier(FOUR);
    await exec(...probe("book", HC));
    for (const other of [FF, PF]) expect(rankProbeTypes(state, other).find((r) => r.type === "book")?.priority).not.toBe("NAMESPACE_MEMBERS");
    // Without any member evidence the ranking is exploration: no type is presented as supported.
    expect(rankProbeTypes(state, PF).some((r) => r.priority === "CONCEPT_MEMBERS" || r.priority === "NAMESPACE_MEMBERS")).toBe(false);
  });

  it("empty probes count as namespace evidence; two of them defer that type for a third concept while it has other options", async () => {
    const { state, exec } = await frontier(FOUR);
    await exec(...probe("place", HC));
    expect(namespaceTypeBarren(state, SM, "place")).toBeNull();
    await exec(...probe("place", QA));
    expect(namespaceProbeEvidence(state, "genre:synmedia", SM).observedEntityTypes).toEqual([{ type: "place", successfulProbes: 0, emptyProbes: 2, unreliableProbes: 0, memberCount: 0 }]);
    expect(namespaceTypeBarren(state, SM, "place")).toMatch(/no members for 2 other concept\(s\) of genre:synmedia/u);
    expect(valueOfToolCall(state, "qloo_recommend", probe("place", SM)[1], assessEvidenceSufficiency(state))).toMatchObject({ value: "NONE", code: "NAMESPACE_TYPE_BARREN" });
    // Another namespace is unaffected.
    expect(namespaceTypeBarren(state, FF, "place")).toBeNull();
  });

  it("a degraded empty answer is unreliable namespace evidence, never an empty probe", async () => {
    const { state, exec } = await frontier(FOUR, [{ operation: "recommend", whenInputContains: "hearth_cooking", status: "degraded", times: 1 }]);
    await exec(...probe("place", HC));
    await exec(...probe("place", QA));
    expect(namespaceProbeEvidence(state, "genre:synmedia", SM).observedEntityTypes).toEqual([{ type: "place", successfulProbes: 0, emptyProbes: 1, unreliableProbes: 1, memberCount: 0 }]);
    expect(namespaceTypeBarren(state, SM, "place")).toBeNull();
  });

  it("the concept limit (3 empty types) and the territory limit still hold under the new ranking", async () => {
    const { state, exec } = await frontier(FOUR);
    for (const type of ["place", "brand", "artist"]) await exec(...probe(type, PF));
    const p = conceptProbeState(state, PF);
    expect(p).toMatchObject({ probingExhausted: true, remainingTypeOptions: [], typeRanking: [] });
    expect(valueOfToolCall(state, "qloo_recommend", probe("movie", PF)[1], assessEvidenceSufficiency(state))).toMatchObject({ value: "NONE", code: "PROBE_LIMIT_REACHED" });
    // A namespace deferral never resurrects an exhausted concept.
    expect(namespaceTypeBarren(state, PF, "movie")).toBeNull();
  });

  it("sibling candidates of one namespace without evidence get different exploration types (one turn tests several)", async () => {
    const { state } = await frontier(FOUR);
    const recs = probeRecommendations(state, state.territories);
    const synmedia = recs.filter((r) => r.namespace === "genre:synmedia");
    expect(synmedia).toHaveLength(3);
    expect(new Set(synmedia.map((r) => r.type)).size).toBe(3);
    // Brand profiles carry the concepts (observed entity_tags): structural evidence, ranked above blind exploration.
    expect(synmedia[0]).toMatchObject({ territoryKey: "hearth_cooking", conceptKey: HC, type: "brand", priority: "STRUCTURAL" });
  });
});

describe("Sprint 5A.2 guidance never contradicts a refusal (live L-C2, full run attempt 1)", () => {
  it("after two empty probes of the shared type on a target's concepts, neither nextProbe nor alignment recommends it again", async () => {
    const GRAVEL = "urn:tag:activity_type:syn:gravel_riding";
    const THRASH = "urn:tag:genre:syn:thrash_revival";
    const SECOND = "urn:tag:genre:syn:shoegaze_revival"; // also returned by the "Thrash Revival" tag search
    const state = freshState({ brand: "Gravemoss Water", territories: ["Gravel Riding", "Thrash Revival"] });
    const provider = scripted();
    const exec = (tool: string, args: unknown) => executeToolCall(state, registry, provider, tool, args);
    await exec("interpret_request", { intent: "compare_territories", brand: "Gravemoss Water", territories: ["Gravel Riding", "Thrash Revival"] });
    transition(state, "RESOLVING", "test");
    await exec("qloo_resolve_entity", { name: "Gravemoss Water", type: "brand", role: "brand" });
    transition(state, "INVESTIGATING", "test");
    for (const q of ["Gravel Riding", "Thrash Revival"]) await exec("qloo_find_tags", { query: q, limit: 8 });
    await exec(...probe("place", GRAVEL));
    const thrash = findTerritory(state, "thrash_revival")!;
    expect(probeRecommendations(state, [thrash], () => "place")[0]).toMatchObject({ type: "place", priority: "COMPARISON_TYPE" });
    await exec(...probe("place", THRASH));
    await exec(...probe("place", SECOND));
    // A third concept of the territory is still untested with place: the barren-probe rule refuses it, so must guidance.
    const THIRD = "urn:tag:subgenre:syn:thrash_revival";
    expect(territoryConcepts(state, thrash)).toContain(THIRD);
    const rec = probeRecommendations(state, [thrash], () => "place")[0]!;
    expect(rec.type).not.toBe("place");
    expect(valueOfToolCall(state, "qloo_recommend", probe("place", THIRD)[1], assessEvidenceSufficiency(state)).value).toBe("NONE");
    expect(JSON.stringify(comparisonRepresentationPlan(state)?.missingRequirements ?? [])).not.toMatch(/probe place on/u);
  });
});

describe("Sprint 5A.2 a territory's own concept with members is never lost to a budget (live L-C2, full run attempt 3)", () => {
  async function compare(territories: string[]) {
    const state = freshState({ brand: "Gravemoss Water", territories });
    const provider = scripted();
    const exec = (tool: string, args: unknown) => executeToolCall(state, registry, provider, tool, args);
    await exec("interpret_request", { intent: territories.length > 1 ? "compare_territories" : "analyze_move", brand: "Gravemoss Water", territories });
    transition(state, "RESOLVING", "test");
    await exec("qloo_resolve_entity", { name: "Gravemoss Water", type: "brand", role: "brand" });
    transition(state, "INVESTIGATING", "test");
    for (const q of territories) await exec("qloo_find_tags", { query: q, limit: 8 });
    return { state, exec };
  }
  const THRASH = "urn:tag:genre:syn:thrash_revival";

  it("members on a searched tag whose canonical name is the territory's name anchor it (recorded LABEL_TAG_MEMBERS)", async () => {
    const { state, exec } = await compare(["Thrash Revival"]);
    const out = await exec(...probe("artist", THRASH));
    expect(out.accepted && out.result.summary).toMatch(/thrash_revival anchored to this tag/u);
    expect(findTerritory(state, "thrash_revival")!.concept?.id).toBe(THRASH);
    expect(state.trace.anchorDecisions?.at(-1)).toMatchObject({ territoryKey: "thrash_revival", basis: "LABEL_TAG_MEMBERS", decidedBy: "runtime", relation: "NO_SOURCE_TAG" });
  });

  it("in a comparison, members of a type other than the planned shared type do not anchor (alignment is respected)", async () => {
    const { state, exec } = await compare(["Gravel Riding", "Thrash Revival"]);
    await exec(...probe("place", "urn:tag:activity_type:syn:gravel_riding"));
    await exec(...probe("artist", THRASH));
    expect(findTerritory(state, "thrash_revival")!.concept).toBeNull();
    // A differently named tag with members never anchors on its own.
    await exec(...probe("place", "urn:tag:genre:syn:shoegaze_revival"));
    expect(findTerritory(state, "thrash_revival")!.concept).toBeNull();
  });
});

describe("Sprint 5A.2 frontier support is kept (live L-E1 Cooking/Feminism, L-E2 Found-family/NYC)", () => {
  it("Oatly-style regression: a grounding tag whose first types were unsuitable is anchored as soon as it returns members", async () => {
    const { state, exec } = await frontier(FOUR);
    await exec(...probe("place", HC));
    const out = await exec(...probe("book", HC));
    const t = findTerritory(state, "hearth_cooking")!;
    expect(out.accepted && out.result.summary).toMatch(/hearth_cooking anchored to this tag/u);
    expect(t.concept?.id).toBe(HC);
    expect(candidateCanonicalization(state, t)).toMatchObject({ sourceTagId: HC, resolvedId: HC, anchorRelation: "SAME_CONCEPT", canonicalConceptKey: "hearth_cooking" });
    expect(state.trace.anchorDecisions).toEqual([expect.objectContaining({ territoryKey: "hearth_cooking", basis: "SOURCE_TAG_MEMBERS", decidedBy: "runtime", anchoredTagId: HC })]);
  });

  it("find_tags results named after the grounding tag stay attached to the candidate (no duplicate search)", async () => {
    const { state, exec } = await frontier([["Porch folk music and storytelling", PF]]);
    await exec("qloo_find_tags", { query: "Porch Folk", limit: 8 });
    const t = findTerritory(state, "porch_folk_music_and_storytelling")!;
    expect(territoryConcepts(state, t)).toEqual(expect.arrayContaining([PF, PF_ALT]));
  });

  it("concepts that co-occur only in the profiles they were discovered from are not merged as duplicates", async () => {
    const { state, exec } = await frontier(FOUR);
    await exec(...probe("book", HC));
    await exec(...probe("book", QA));
    const [a, b] = ["hearth_cooking", "quiet_activism"].map((k) => findTerritory(state, k)!);
    expect(structuralDuplicate(state, a!, b!)).toBeNull();
    // Co-occurrence observed OUTSIDE the discovery source still counts (the rule itself is unchanged).
    const brandId = state.brand.entity!.id;
    state.related = state.related.filter((r) => r.subjectId !== brandId);
    expect(structuralDuplicate(state, a!, b!)?.basis).toMatch(/co-occur/u);
  });

  it("in the last two turns, probing a candidate without members is refused while a supported one awaits analysis", async () => {
    const { state, exec } = await frontier(FOUR);
    await exec(...probe("book", HC));
    state.usage.iterations = state.limits.maxAgentIterations - 1;
    expect(frontierCompletionReserve(state, "qloo_recommend", PF)).toMatch(/hearth_cooking has Qloo members/u);
    expect(frontierCompletionReserve(state, "qloo_find_tags", null)).toMatch(/instead of searching new concepts/u);
    expect(frontierCompletionReserve(state, "qloo_recommend", HC)).toBeNull();
    state.usage.iterations = 4;
    expect(frontierCompletionReserve(state, "qloo_recommend", PF)).toBeNull();
  });
});

describe("Sprint 5A.2 anchor identity (live L-E2: the same concepts anchored to different tags per run)", () => {
  it("an alternate with the same canonical name and observed members is accepted once the grounding tag returned none", async () => {
    const { state, exec } = await frontier(FOUR);
    await exec("qloo_find_tags", { query: "Porch Folk", limit: 8 });
    await exec(...probe("place", PF));
    await exec(...probe("artist", PF_ALT));
    const t = findTerritory(state, "porch_folk")!;
    expect(alternateAnchorRefusal(state, t, PF_ALT)).toBeNull();
    const out = await exec("anchor_territory", { territoryKey: "porch_folk", tagId: PF_ALT });
    expect(out.accepted).toBe(true);
    expect(candidateCanonicalization(state, t)).toMatchObject({ sourceTagId: PF, resolvedId: PF_ALT, anchorRelation: "SAME_CANONICAL_NAME", canonicalConceptKey: "porch_folk" });
    expect(state.trace.anchorDecisions?.at(-1)).toMatchObject({ basis: "ALTERNATE_WITH_MEMBERS", relation: "SAME_CANONICAL_NAME", decidedBy: "agent" });
  });

  it("unsupported, unneeded or unrelated alternate anchors are refused with the reason, and the refusal is recorded", async () => {
    const { state, exec } = await frontier(FOUR);
    await exec("qloo_find_tags", { query: "Porch Folk", limit: 8 });
    const t = findTerritory(state, "porch_folk")!;
    expect(alternateAnchorRefusal(state, t, PF_ALT)?.code).toBe("ALTERNATE_ANCHOR_SOURCE_UNTESTED");
    await exec(...probe("place", PF));
    expect(alternateAnchorRefusal(state, t, PF_ALT)?.code).toBe("ALTERNATE_ANCHOR_UNSUPPORTED");
    expect(alternateAnchorRefusal(state, t, PLANT)?.code).toBe("ALTERNATE_ANCHOR_UNRELATED");
    const hearth = findTerritory(state, "hearth_cooking")!;
    await exec(...probe("book", HC));
    hearth.concept = null;
    hearth.status = "open";
    expect(alternateAnchorRefusal(state, hearth, "urn:tag:genre:synmedia:hearth_cooking_x")?.code).toBe("ALTERNATE_ANCHOR_SOURCE_SUPPORTED");
    const refused = await exec("anchor_territory", { territoryKey: "porch_folk", tagId: PLANT });
    expect(refused).toMatchObject({ accepted: false, code: "ALTERNATE_ANCHOR_REFUSED" });
    expect(state.trace.anchorDecisions?.at(-1)).toMatchObject({ territoryKey: "porch_folk", basis: "REFUSED", reasonCode: "ALTERNATE_ANCHOR_UNRELATED" });
  });

  it("repeated runs of the same evidence anchor the same concepts (source anchoring is deterministic)", async () => {
    const anchors = [];
    for (let i = 0; i < 2; i += 1) {
      const { state, exec } = await frontier(FOUR);
      for (const tag of [HC, QA, SM]) await exec(...probe("book", tag));
      anchors.push(state.territories.map((t) => `${t.key}=${t.concept?.id ?? "-"}`));
    }
    expect(anchors[0]).toEqual(anchors[1]);
    expect(anchors[0]).toEqual(["hearth_cooking=" + HC, "quiet_activism=" + QA, "slow_mornings=" + SM, "porch_folk=-"]);
  });
});

describe("Sprint 5A.2 null popularity (live Sprint 5A: 7 recommend calls failed on `popularity: null`)", () => {
  const envelope = (operation: string, results: unknown[]) => ({ schema_version: "x", operation, status: "ok", results, execution: { transport: "mcp", correlation_id: "syn-null" } }) as unknown as QlooEnvelope;

  it("null entity and tag popularity normalize to unknown (absent), never zero, and keep provenance", () => {
    const [e] = toEntitySignals("recommend", envelope("recommend", [{ entity_id: "SYN-BK-9", name: "N", type: "urn:entity", popularity: null }]));
    const [t] = toTagSignals("find_tags", envelope("find_tags", [{ id: "urn:tag:genre:synmedia:x", name: "X", type: "urn:tag:genre:synmedia", popularity: null }]));
    expect(e).not.toHaveProperty("popularity");
    expect(t).not.toHaveProperty("popularity");
    expect(e!.sourceCorrelationId).toBe("syn-null");
  });

  it("members with unknown popularity stay valid exemplar candidates, ordered after known ones, deterministically", async () => {
    const { state, exec } = await frontier(FOUR);
    await exec(...probe("book", HC));
    const { eligible } = exemplarCandidates(state, HC, "book");
    expect(eligible.map((c) => [c.label, c.popularity])).toEqual([
      ["Embers and Bread", 0.52],
      ["Coals at Dusk", 0.47],
      ["The Long Supper", null],
    ]);
    expect(state.entities.get("SYN-BK-5202")!.sources.at(-1)).toMatchObject({ popularity: null, correlationId: expect.stringMatching(/^syn-/u) });
  });
});

describe("Sprint 5A.2 incomplete optional rank panel (live L-E1 focused run: methodology failed on panel B)", () => {
  it("an optional panel whose Qloo ranking misses an assigned exemplar is excluded; FULL rests on the remaining panels", async () => {
    const GRAVEL = "urn:tag:activity_type:syn:gravel_riding";
    const ALPINE = "urn:tag:activity_type:syn:alpine_hiking";
    const ESPRESSO = "urn:tag:cuisine:syn:espresso";
    const C = (tool: string, args: unknown) => call(tool, args);
    const model = new ScriptedAgentModel([
      [C("interpret_request", { intent: "compare_territories", brand: "Larkspur Velo", territories: ["Gravel Riding", "Alpine Hiking", "Espresso"] })],
      [C("qloo_resolve_entity", { name: "Larkspur Velo", type: "brand", role: "brand" })],
      ["Gravel Riding", "Alpine Hiking", "Espresso"].map((q) => C("qloo_find_tags", { query: q, limit: 8 })),
      [GRAVEL, ALPINE, ESPRESSO].map((tag) => C(...probe("place", tag))),
      [
        C("anchor_territory", { territoryKey: "gravel_riding", tagId: GRAVEL }),
        C("anchor_territory", { territoryKey: "alpine_hiking", tagId: ALPINE }),
        C("anchor_territory", { territoryKey: "espresso", tagId: ESPRESSO }),
        ...[["gravel_riding", 1], ["alpine_hiking", 4], ["espresso", 7]].map(([k, n]) => C("validate_territory_representation", { territoryKey: k, entityType: "place", exemplars: [0, 1, 2].map((i) => ({ id: `SYN-PL-${3000 + (n as number) + i}`, reason: "Qloo tag member" })) })),
      ],
      [{ action: "analyze", targetIds: ["gravel_riding", "alpine_hiking", "espresso"], reasonSummary: "t" }],
      [{ action: "finish", resultIds: [], reasonSummary: "t" }],
    ]);
    const { runtime: rt, provider } = runtime(model);
    const transport = provider.world;
    const execute = transport.execute.bind(transport);
    let ranks = 0;
    transport.execute = async (operation, input) => {
      const out = await execute(operation, input);
      if (operation === "rank" && (ranks += 1) === 2 && out.kind === "result") (out.raw as { results: unknown[] }).results.pop();
      return out;
    };
    const r = (await rt.run({ userQuery: "q", brand: "Larkspur Velo", territories: ["Gravel Riding", "Alpine Hiking", "Espresso"] })) as AgentAnalysisResult;
    expect(r.territories.map((t) => t.analysisRoute)).toEqual(["FULL_RELATIVE_ANALYSIS", "FULL_RELATIVE_ANALYSIS", "FULL_RELATIVE_ANALYSIS"]);
    expect(r.territories[0]!.limitations.some((l) => l.code === "PANEL_RANKING_INCOMPLETE" && /panel B/u.test(l.detail))).toBe(true);
    expect(r.trace.methodologyInvocations[0]!.panelIds).not.toContain("B");
  });
});

describe("Sprint 5A.2 evaluators and stability (grader fix: no support twice is not stability)", () => {
  it("two runs without a single supported candidate score 0 supported overlap (v3), so the criteria fail", () => {
    const unsupported = { candidates: [{ key: "a", label: "A", conceptId: null, route: "INSUFFICIENT_EVIDENCE", position: null, classification: null, canonicalKey: "a" }] };
    const stability = frontierStability([unsupported, unsupported, unsupported]);
    expect(stability.canonicalConceptOverlap).toBe(1);
    expect(stability.supportedCanonicalOverlap).toBe(0);
    const evaluation = evaluateStability("L-E1", { ...stability, runs: 3 }, loadStabilityCriteria());
    expect(evaluation.status).toBe("FAIL");
  });

  it("a scripted run that ignores namespace evidence, and one that loses a supported candidate, are flagged", async () => {
    const C = (tool: string, args: unknown) => call(tool, args);
    const model = new ScriptedAgentModel([
      [C("interpret_request", { intent: "explore_frontier", brand: BRAND, territories: [] })],
      [C("qloo_resolve_entity", { name: BRAND, type: "brand", role: "brand" })],
      [C("qloo_get_entity_tags", { entityId: "SYN-BR-5201" }), C("qloo_related_entities", { entityId: "SYN-BR-5201", targetType: "brand", limit: 5 })],
      RELATED.map((id) => C("qloo_get_entity_tags", { entityId: id })),
      FOUR.map(([label, tag]) => C("propose_territory", { label, role: "frontier_candidate", origin: "qloo_evidence", evidenceTagIds: [tag], rationale: "r" })),
      [C(...probe("book", HC))],
      [C(...probe("artist", QA))],
      [C("drop_territory", { territoryKey: "hearth_cooking", code: "NO_VALID_REPRESENTATION", reason: "dropped" })],
      [{ action: "finish", resultIds: [], reasonSummary: "t" }],
    ]);
    const response = (await runtime(model).runtime.run({ userQuery: "Where could Brindlewood Oat expand culturally?" })) as AgentAnalysisResult;
    expect(unjustifiedProbes(response)).toEqual([expect.stringMatching(/artist on urn:tag:genre:synmedia:quiet_activism although book had returned members in genre:synmedia/u)]);
    const failed = evaluateRun(response).filter((e) => e.applicable && !e.passed).map((e) => e.id);
    expect(failed).toEqual(expect.arrayContaining(["PROBE_PRIORITY_JUSTIFIED", "SUPPORTED_CONCEPT_NOT_LOST"]));
    expect(failed).not.toContain("NULL_POPULARITY_HANDLED");
  });
});
