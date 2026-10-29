/**
 * Sprint 10A discovery mechanics (evals/discovery/manifest.json, cases s01–s34). SYNTHETIC: placeholder ids, fictional
 * names, offline. These pin the evidence-to-opportunity rules; they are not live Qloo or live model validation, and not
 * evidence that discovery quality improved (see docs/sprint-10a/PREREGISTRATION.md).
 */
import { readFileSync } from "node:fs";
import type { AgentTerritoryResult, BrandBaselineResult } from "@cultural-elasticity/shared";
import { describe, expect, it } from "vitest";
import { buildExploreInvestigationRequest, discoverySeeds, HandoffError, SEEDS_PER_DOMAIN } from "../src/api/baseline-handoff.js";
import { facetLabel as baselineFacetLabel, tagRole as baselineTagRole } from "../src/brand-baseline/research.js";
import { buildDecisionContext } from "../src/agent/context.js";
import { brandIndependentMembers, frontierCandidatePool, frontierPoolSelection, FRONTIER_POOL_SIZE, MAX_SEED_PROFILES, opportunityStatus, profiledSeeds, qlooSupport, seedProfileRefusal } from "../src/agent/frontier.js";
import { exploreCandidatesSkill } from "../src/agent/skills/definitions.js";
import { addTerritory, transition, type AgentRunState, type TerritoryState } from "../src/agent/state.js";
import { executeToolCall } from "../src/agent/tool-executor.js";
import { ToolRegistry } from "../src/agent/tool-registry.js";
import type { LiveCall } from "../src/qloo/live-adapter.js";
import { facetLabel, tagRole } from "../src/methodology/tag-facets.js";
import { freshState, scripted } from "./fixtures/synthetic/agent.js";

const registry = new ToolRegistry();
const BRAND = "SYN-BR-T000";
const liveCall = (correlationId: string) => ({ envelope: { status: "ok", execution: { correlation_id: correlationId } } }) as unknown as LiveCall;
const tag = (facet: string, name: string) => `urn:tag:${facet}:${name}`;

type Profile = { id: string; tags: string[] };

/** A frontier run state built directly from synthetic profiles (no provider), for exact pool-order tests. */
function poolState(brandTags: string[], related: Profile[], seeds: Profile[] = []): AgentRunState {
  const state = freshState({ brand: "SYNTHETIC Brand" });
  state.interpretation = { intent: "explore_frontier", brand: "SYNTHETIC Brand", territories: [] } as unknown as AgentRunState["interpretation"];
  state.brand.entity = { id: BRAND, label: "SYNTHETIC Brand", type: "urn:entity:brand", match: "exact", resolution: "confirmed", call: liveCall("syn-brand") };
  const recordTags = (subjectId: string, ids: string[], correlationId: string) => {
    for (const id of ids) {
      const prev = state.tags.get(id);
      state.tags.set(id, { id, label: id.split(":").pop()!, type: id.split(":").slice(0, 4).join(":"), sources: [...(prev?.sources ?? []), { kind: "profile", query: null, subjectId, correlationId }] });
    }
    state.profiles.set(subjectId, { subjectId, call: liveCall(correlationId), tagIds: ids, take: 20 });
  };
  recordTags(BRAND, brandTags, "syn-brand-tags");
  state.related.push({ subjectId: BRAND, targetType: "brand", call: liveCall("syn-related"), memberIds: related.map((r) => r.id) });
  for (const r of related) {
    state.entities.set(r.id, { id: r.id, label: `SYNTHETIC ${r.id}`, type: "brand", sources: [{ kind: "related", tagIds: [], conditionedOn: BRAND, correlationId: "syn-related", popularity: null }] });
    recordTags(r.id, r.tags, `syn-profile-${r.id}`);
  }
  state.discoverySeeds = seeds.map((s, i) => ({ id: s.id, label: `SYNTHETIC seed ${s.id}`, domain: "artist", relation: "BRAND_CONDITIONED_ENTITY", scanId: "SYN-SCAN", correlationId: "syn-scan-artists", rankWithinCall: i + 1, typeEvidence: "QUERY_SCOPED", partial: false }));
  for (const s of seeds) if (s.tags.length) recordTags(s.id, s.tags, `syn-profile-${s.id}`);
  return state;
}

const keys = (state: AgentRunState) => frontierCandidatePool(state).map((e) => e.canonicalConceptKey);
const MUSIC_A = tag("genre:music", "alpha_folk");
const MUSIC_B = tag("genre:music", "beta_drone");
const MEDIA_C = tag("genre:media", "gamma_cooking");
const KEYWORD_D = tag("keyword:media", "delta_friendship");
const BRAND_TAG = tag("keyword:qloo", "own_identity");

describe("Sprint 10A frontier-pool/v2 (s01–s10)", () => {
  it("s01: a tag on the brand's own profile never enters the pool", () => {
    const state = poolState([BRAND_TAG], [{ id: "SYN-BR-T001", tags: [BRAND_TAG, MUSIC_A] }, { id: "SYN-BR-T002", tags: [BRAND_TAG, MUSIC_A] }]);
    expect(keys(state)).toEqual(["alpha_folk"]);
  });

  it("s02/s03: domainRelation says whether the brand's own profile carries the concept's facet", () => {
    const state = poolState([tag("genre:music", "own_genre")], [{ id: "SYN-BR-T001", tags: [MUSIC_A, MEDIA_C] }]);
    const byKey = new Map(frontierCandidatePool(state).map((e) => [e.canonicalConceptKey, e]));
    expect(byKey.get("alpha_folk")?.domainRelation).toBe("WITHIN_BRAND_PROFILE_FACETS");
    expect(byKey.get("gamma_cooking")?.domainRelation).toBe("OUTSIDE_BRAND_PROFILE_FACETS");
    expect(byKey.get("gamma_cooking")?.facet).toBe("genre:media");
  });

  it("s04/s05: a free keyword with more support follows taxonomy concepts with support ≥ 2; the best-supported taxonomy concept is first", () => {
    const related = ["T001", "T002", "T003", "T004", "T005"].map((n, i) => ({ id: `SYN-BR-${n}`, tags: [KEYWORD_D, ...(i < 3 ? [MUSIC_A] : []), ...(i < 2 ? [MEDIA_C] : [])] }));
    const pool = frontierCandidatePool(poolState([], related));
    expect(pool.map((e) => `${e.canonicalConceptKey}:${e.support}`)).toEqual(["alpha_folk:3", "gamma_cooking:2", "delta_friendship:5"]);
    expect(pool[2]!.facetRole).toBe("DESCRIPTIVE_KEYWORD");
  });

  it("s06: taxonomy concepts from two namespaces alternate (round-robin by facet)", () => {
    const related = ["T001", "T002", "T003"].map((n, i) => ({ id: `SYN-BR-${n}`, tags: [MUSIC_A, ...(i < 2 ? [MUSIC_B, MEDIA_C] : [])] }));
    expect(keys(poolState([], related))).toEqual(["alpha_folk", "gamma_cooking", "beta_drone"]);
  });

  it("s07: the pool is identical whatever order the evidence-base profiles arrive in", () => {
    const related = ["T001", "T002", "T003"].map((n, i) => ({ id: `SYN-BR-${n}`, tags: i === 0 ? [MUSIC_A, KEYWORD_D] : [MEDIA_C, MUSIC_A, KEYWORD_D] }));
    const forward = poolState([], related);
    const reverse = poolState([], related);
    const shuffled = new Map([...reverse.profiles.entries()].reverse());
    reverse.profiles.clear();
    for (const [k, v] of shuffled) reverse.profiles.set(k, v);
    expect(frontierCandidatePool(reverse)).toEqual(frontierCandidatePool(forward));
  });

  it("s08: concepts the pool size cuts are recorded as deferred, with a reason", () => {
    const many = Array.from({ length: FRONTIER_POOL_SIZE + 3 }, (_, i) => tag("genre:music", `concept_${String(i).padStart(2, "0")}`));
    const { pool, deferred } = frontierPoolSelection(poolState([], [{ id: "SYN-BR-T001", tags: many }, { id: "SYN-BR-T002", tags: many }]));
    expect(pool).toHaveLength(FRONTIER_POOL_SIZE);
    expect(deferred).toHaveLength(3);
    for (const d of deferred) expect(d.reason).toMatch(/frontier-pool\/v2/u);
  });

  it("s09: a support-1 taxonomy concept is never ordered above a support-2 taxonomy concept", () => {
    const related = [{ id: "SYN-BR-T001", tags: [MUSIC_A, MUSIC_B, MEDIA_C] }, { id: "SYN-BR-T002", tags: [MUSIC_A] }];
    const order = keys(poolState([], related));
    expect(order.indexOf("alpha_folk")).toBeLessThan(order.indexOf("beta_drone"));
    expect(order.indexOf("alpha_folk")).toBeLessThan(order.indexOf("gamma_cooking"));
  });

  it("s10: with no related or seed profiles the pool is empty", () => {
    expect(frontierCandidatePool(poolState([BRAND_TAG], []))).toEqual([]);
  });
});

async function exploreRun() {
  const state = freshState({ brand: "Ashgrove Workwear" });
  const provider = scripted();
  const exec = (tool: string, args: unknown) => executeToolCall(state, registry, provider, tool, args);
  await exec("interpret_request", { intent: "explore_frontier", brand: "Ashgrove Workwear", territories: [] });
  transition(state, "RESOLVING", "test");
  await exec("qloo_resolve_entity", { name: "Ashgrove Workwear", type: "brand", role: "brand" });
  transition(state, "INVESTIGATING", "test");
  await exec("qloo_get_entity_tags", { entityId: "SYN-BR-10A0" });
  return { state, exec };
}
const hypothesis = (motivatedBy: string[]) => ({ label: "SYNTHETIC lateral scene", role: "frontier_candidate", origin: "agent_hypothesis", rationale: "SYNTHETIC: two observed signals may share a scene", motivatedBy });

describe("Sprint 10A motivated proposals (s11–s13)", () => {
  it("s11: a hypothesis citing observed ids is accepted and keeps them as motivation, not support", async () => {
    const { state, exec } = await exploreRun();
    const out = await exec("propose_territory", hypothesis(["urn:tag:keyword:syn:durable_workwear", "SYN-BR-10A0"]));
    expect(out.accepted).toBe(true);
    const t = state.territories.find((x) => x.role === "frontier_candidate")!;
    expect(t.motivatedBy).toEqual(["urn:tag:keyword:syn:durable_workwear", "SYN-BR-10A0"]);
    expect(t.concept).toBeNull();
    expect(qlooSupport(state, t)).toBe(false);
  });

  it("s12: a hypothesis citing an id never observed is refused", async () => {
    const { state, exec } = await exploreRun();
    const out = await exec("propose_territory", hypothesis(["SYN-AR-NEVER-RETURNED"]));
    expect(out.accepted).toBe(false);
    expect(JSON.stringify(out)).toMatch(/was not observed in this run or among the seeds/u);
    expect(state.territories.filter((x) => x.role === "frontier_candidate")).toHaveLength(0);
  });

  it("s13: more than 6 motivating ids are refused by the schema", async () => {
    const { exec } = await exploreRun();
    const out = await exec("propose_territory", hypothesis(Array.from({ length: 7 }, () => "SYN-BR-10A0")));
    expect(out.accepted).toBe(false);
  });
});

/** A frontier candidate anchored to `conceptId`, with optional brand-independent members. */
function candidate(state: AgentRunState, conceptId: string, members: number, patch: Partial<TerritoryState> = {}): TerritoryState {
  const t = addTerritory(state, { label: conceptId.split(":").pop()!, role: "frontier_candidate", origin: "agent_hypothesis", rationale: "SYNTHETIC", source: "agent_hypothesis" });
  state.tags.set(conceptId, { id: conceptId, label: conceptId, type: "urn:tag:genre:music", sources: [{ kind: "find_tags", query: "x", subjectId: null, correlationId: "syn-find" }] });
  t.concept = { id: conceptId, label: conceptId, type: "urn:tag:genre:music" };
  if (members > 0) state.pools.push({ tagIds: [conceptId], targetType: "artist", conditionedOn: null, call: liveCall(`syn-pool-${conceptId}`), memberIds: Array.from({ length: members }, (_, i) => `SYN-AR-M${i}`) });
  Object.assign(t, patch);
  return t;
}
const result = (route: AgentTerritoryResult["analysisRoute"], position: number | null = null, failure: { code: string; detail: string } | null = null) =>
  ({ analysisRoute: route, relativePosition: route === "FULL_RELATIVE_ANALYSIS" ? { position, of: 3, medianPercentile: null, medianRank: null } : null, representation: { failure } }) as unknown as AgentTerritoryResult;

describe("Sprint 10A opportunity status (s14–s21)", () => {
  const s = () => poolState([], []);
  it("s14: a hypothesis whose probes returned no members is NOT_ESTABLISHED / UNSUPPORTED", () => {
    const state = s();
    const t = candidate(state, tag("genre:music", "empty_scene"), 0, { status: "dropped", dropReason: { code: "HYPOTHESIS_UNSUPPORTED", detail: "no members" } });
    expect(opportunityStatus(state, t, undefined)).toEqual({ status: "NOT_ESTABLISHED", blocker: "UNSUPPORTED" });
  });
  it("s15: members and a PARTIAL route give QLOO_SUPPORTED, never RELATIVELY_MEASURED", () => {
    const state = s();
    const t = candidate(state, tag("genre:music", "real_scene"), 4);
    expect(opportunityStatus(state, t, result("PARTIAL_CULTURAL_ANALYSIS")).status).toBe("QLOO_SUPPORTED");
  });
  it("s16: a FULL route with a numeric position is RELATIVELY_MEASURED", () => {
    const state = s();
    const t = candidate(state, tag("genre:music", "measured"), 4);
    expect(opportunityStatus(state, t, result("FULL_RELATIVE_ANALYSIS", 1)).status).toBe("RELATIVELY_MEASURED");
  });
  it("s17: a FULL route whose rank calls failed (position null) stays QLOO_SUPPORTED", () => {
    const state = s();
    const t = candidate(state, tag("genre:music", "unranked"), 4);
    expect(opportunityStatus(state, t, result("FULL_RELATIVE_ANALYSIS", null)).status).toBe("QLOO_SUPPORTED");
  });
  it("S3: no route promotes a candidate without brand-independent members", () => {
    const state = s();
    const t = candidate(state, tag("genre:music", "no_members"), 0);
    for (const route of ["FULL_RELATIVE_ANALYSIS", "PARTIAL_CULTURAL_ANALYSIS", "DESCRIPTIVE_ANALYSIS"] as const) {
      expect(["QLOO_SUPPORTED", "RELATIVELY_MEASURED"]).not.toContain(opportunityStatus(state, t, result(route, 1)).status);
    }
  });
  it("s18: a dropped duplicate is NOT_ESTABLISHED / DUPLICATE", () => {
    const state = s();
    const t = candidate(state, tag("genre:music", "dupe"), 4, { status: "dropped", dropReason: { code: "DUPLICATE_TERRITORY", detail: "same concept" } });
    expect(opportunityStatus(state, t, undefined)).toEqual({ status: "NOT_ESTABLISHED", blocker: "DUPLICATE" });
  });
  it("s19: an incidental venue attribute is NOT_ESTABLISHED / UNSUPPORTED", () => {
    const state = s();
    const t = candidate(state, tag("amenity:qloo", "free_wifi"), 4, { status: "dropped", dropReason: { code: "INCIDENTAL_CONCEPT", detail: "venue attribute" } });
    expect(opportunityStatus(state, t, undefined)).toEqual({ status: "NOT_ESTABLISHED", blocker: "UNSUPPORTED" });
  });
  it("s20: INSUFFICIENT_EVIDENCE after members were observed is NOT_ESTABLISHED / UNMEASURABLE", () => {
    const state = s();
    const t = candidate(state, tag("genre:music", "thin"), 2);
    expect(opportunityStatus(state, t, result("INSUFFICIENT_EVIDENCE", null, { code: "NO_VALID_REPRESENTATION", detail: "no panel" }))).toEqual({ status: "NOT_ESTABLISHED", blocker: "UNMEASURABLE" });
  });
  it("s21: a candidate the budget left unanalysed is NOT_ESTABLISHED / INCONCLUSIVE", () => {
    const state = s();
    const t = candidate(state, tag("genre:music", "late"), 2);
    expect(opportunityStatus(state, t, result("INSUFFICIENT_EVIDENCE", null, { code: "BUDGET_EXHAUSTED", detail: "budget" }))).toEqual({ status: "NOT_ESTABLISHED", blocker: "INCONCLUSIVE" });
    const dropped = candidate(state, tag("genre:music", "late_two"), 0, { status: "dropped", dropReason: { code: "BUDGET_EXHAUSTED", detail: "budget" } });
    expect(opportunityStatus(state, dropped, undefined).blocker).toBe("INCONCLUSIVE");
  });
});

const fixture = () => structuredClone((JSON.parse(readFileSync(new URL("./fixtures/synthetic/brand-baseline-e2e-v2.json", import.meta.url), "utf8")) as { results: { hypotheses: BrandBaselineResult } }).results.hypotheses);

describe("Sprint 10A seeds from the authorized scan (s22–s27)", () => {
  it("s22: seeds are the scan's retained entity observations with their own call; brand-profile tags are not seeds", () => {
    const scan = fixture();
    const seeds = discoverySeeds(scan);
    expect(seeds.length).toBeGreaterThan(0);
    const provenance = new Set(scan.fingerprint.provenance.map((ref) => ref.correlationId));
    for (const seed of seeds) {
      const signal = scan.fingerprint.signals.find((x) => x.id === seed.id)!;
      expect(signal.kind).toBe("entity");
      expect(seed.correlationId).toBe(signal.source.correlationId);
      expect(provenance.has(seed.correlationId)).toBe(true);
      expect(seed.scanId).toBe(scan.scanId);
    }
    for (const domain of new Set(seeds.map((x) => x.domain))) expect(seeds.filter((x) => x.domain === domain).length).toBeLessThanOrEqual(SEEDS_PER_DOMAIN);
    expect(seeds.some((x) => scan.territories.some((t) => t.canonicalConcept === x.id))).toBe(false);
  });

  it("s23: set-aside and type-conflicting entities never become seeds", () => {
    const scan = fixture();
    const first = scan.fingerprint.signals.find((x) => x.kind === "entity")!;
    first.grounding = { ...first.grounding!, typeEvidence: "CONFLICTING_TYPE" };
    const seeds = discoverySeeds(scan);
    expect(seeds.some((x) => x.id === first.id)).toBe(false);
    for (const excluded of scan.fingerprint.excluded) expect(seeds.some((x) => x.id === excluded.id)).toBe(false);
  });

  it("s24: a seed from a partial response is flagged partial", () => {
    const scan = fixture();
    const first = scan.fingerprint.signals.find((x) => x.kind === "entity")!;
    first.source = { ...first.source, sourceStatus: "partial" };
    scan.fingerprint.provenance = scan.fingerprint.provenance.map((ref) => (ref.correlationId === first.source.correlationId && ref.sourceId === first.id ? { ...ref, sourceStatus: "partial" } : ref));
    expect(discoverySeeds(scan).find((x) => x.id === first.id)?.partial).toBe(true);
  });

  it("s25: a signal whose call is not in the scan's provenance is not a seed", () => {
    const scan = fixture();
    const first = scan.fingerprint.signals.find((x) => x.kind === "entity")!;
    first.source = { ...first.source, correlationId: "syn-not-in-provenance" };
    expect(discoverySeeds(scan).some((x) => x.id === first.id)).toBe(false);
  });

  it("s26: the explore handoff refuses a scan that is not complete", () => {
    const scan = { ...fixture(), scanStatus: "RUNNING" as const };
    expect(() => buildExploreInvestigationRequest(scan)).toThrow(HandoffError);
  });

  it("s27: the explore handoff asks explore_frontier with no named territory, and no seed in the query text", () => {
    const scan = fixture();
    const prepared = buildExploreInvestigationRequest(scan);
    expect(prepared.agentRequest).toMatchObject({ intent: "explore_frontier", territories: [] });
    for (const seed of prepared.seeds) {
      expect(prepared.agentRequest.userQuery).not.toContain(seed.id);
      expect(prepared.agentRequest.userQuery).not.toContain(seed.label);
    }
    expect(prepared.limitations.join(" ")).toMatch(/Nothing from the scan counts as support/u);
  });
});

describe("Sprint 10A seed handling in the run (s28–s34)", () => {
  const seedProfiles = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `SYN-AR-S${String(i).padStart(2, "0")}`, tags: [] as string[] }));

  it("s28: seeds reach the model only while the explore skill is active, at most 12", () => {
    const state = poolState([BRAND_TAG], [{ id: "SYN-BR-T001", tags: [MUSIC_A] }], seedProfiles(15));
    const context = buildDecisionContext(state, registry, null, { active: [exploreCandidatesSkill as never] });
    expect(context.evidence.seeds).toHaveLength(12);
    expect(context.evidence.brandProfileFacets).toEqual(["keyword:qloo"]);
    const other = buildDecisionContext(state, registry, null, { active: [] });
    expect(other.evidence.seeds).toBeUndefined();
  });

  it("s29: a seed is never Qloo support, and a seed's profile never makes a candidate QLOO_SUPPORTED", () => {
    const seedTag = tag("genre:music", "seed_only_scene");
    const listed = poolState([], [], [{ id: "SYN-AR-S00", tags: [] }]);
    const a = candidate(listed, seedTag, 0);
    expect(qlooSupport(listed, a)).toBe(false);
    // A profiled seed carrying the tag passes the unchanged candidate gate (like a related brand's profile), but it is
    // not a brand-independent member: the opportunity stays an unvalidated hypothesis until Qloo returns members.
    const profiled = poolState([], [], [{ id: "SYN-AR-S00", tags: [seedTag] }]);
    const b = candidate(profiled, seedTag, 0);
    expect(qlooSupport(profiled, b)).toBe(true);
    expect(brandIndependentMembers(profiled, b)).toBe(false);
    expect(opportunityStatus(profiled, b, undefined).status).toBe("UNVALIDATED_HYPOTHESIS");
    expect(opportunityStatus(profiled, b, result("PARTIAL_CULTURAL_ANALYSIS")).status).toBe("NOT_ESTABLISHED");
  });

  it(`s30: at most ${MAX_SEED_PROFILES} seeds are profiled per run`, () => {
    const state = poolState([], [], [...seedProfiles(MAX_SEED_PROFILES).map((s) => ({ ...s, tags: [MUSIC_A] })), { id: "SYN-AR-S99", tags: [] }]);
    expect(seedProfileRefusal(state, "SYN-AR-S99")).toMatch(/at most 3 seed entities/u);
    expect(seedProfileRefusal(state, "SYN-BR-NOT-A-SEED")).toBeNull();
  });

  it("s31: a tag shared by profiled seeds enters the pool with the seeds named as supporters", () => {
    const scene = tag("genre:music", "basement_scene");
    const state = poolState([BRAND_TAG], [], [{ id: "SYN-AR-S00", tags: [scene] }, { id: "SYN-AR-S01", tags: [scene] }]);
    const entry = frontierCandidatePool(state).find((e) => e.tagId === scene)!;
    expect(entry.support).toBe(2);
    expect(entry.supporters.map((x) => [x.id, x.relation])).toEqual([["SYN-AR-S00", "SEED_ENTITY_TAG"], ["SYN-AR-S01", "SEED_ENTITY_TAG"]]);
    expect(entry.domainRelation).toBe("OUTSIDE_BRAND_PROFILE_FACETS");
  });

  it("s32: the free baseline keeps its rule, its facet semantics and its model-free imports", () => {
    expect(baselineTagRole).toBe(tagRole);
    expect(baselineFacetLabel).toBe(facetLabel);
    expect(fixture().discovery.rule).toBe("observed-cultural-tag/v2");
    const source = readFileSync(new URL("../src/brand-baseline/research.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from "\.\.\/agent\//u);
  });

  it("s33: the explore skill's tool allowlist is unchanged", () => {
    expect(exploreCandidatesSkill.allowedTools).toEqual(["qloo_get_entity_tags", "qloo_related_entities", "qloo_find_tags", "qloo_recommend", "propose_territory", "anchor_territory", "assess_concept_duplicates", "drop_territory"]);
  });

  it("s34: a failed seed profile is not evidence", async () => {
    const state = freshState({ brand: "Ashgrove Workwear" });
    const provider = scripted([{ operation: "entity_tags", whenInputContains: "SYN-AR-10A1", status: "error", code: "SYN_FAULT", retryable: false, times: 2 }]);
    const exec = (tool: string, args: unknown) => executeToolCall(state, registry, provider, tool, args);
    await exec("interpret_request", { intent: "explore_frontier", brand: "Ashgrove Workwear", territories: [] });
    transition(state, "RESOLVING", "test");
    await exec("qloo_resolve_entity", { name: "Ashgrove Workwear", type: "brand", role: "brand" });
    transition(state, "INVESTIGATING", "test");
    state.discoverySeeds = [{ id: "SYN-AR-10A1", label: "Cinder Choir", domain: "artist", relation: "BRAND_CONDITIONED_ENTITY", scanId: "SYN-SCAN", correlationId: "syn-scan", rankWithinCall: 1, typeEvidence: "QUERY_SCOPED", partial: false }];
    await exec("qloo_get_entity_tags", { entityId: "SYN-BR-10A0" });
    await exec("qloo_related_entities", { entityId: "SYN-BR-10A0", targetType: "brand", limit: 8 });
    await exec("qloo_get_entity_tags", { entityId: "SYN-AR-10A1" });
    expect(state.profiles.has("SYN-AR-10A1")).toBe(false);
    expect(profiledSeeds(state)).toEqual([]);
    expect(frontierCandidatePool(state).some((e) => e.supporters.some((x) => x.id === "SYN-AR-10A1"))).toBe(false);
  });
});
