/**
 * Live adapter, collector policy and revised gates, exercised against a SYNTHETIC harness world.
 * Envelope shapes follow what the live hackathon API returned on 2026-10-16; all IDs are placeholders.
 */
import { describe, expect, it } from "vitest";
import { analyzeEvidencePacket } from "../src/analysis/ingredients.js";
import { parseEvidencePacket } from "../src/evidence/schema.js";
import { assessProfileSufficiency, decide, evaluateLiveGates, LiveCollector, runLiveInvestigation, type LiveGate } from "../scripts/feasibility/live.js";
import { LIVE_INVESTIGATION, type LiveInvestigationConfig } from "../scripts/feasibility/live-config.js";
import {
  audienceFromCompare,
  brandProfileFromEntityTags,
  jointSignalBridge,
  liveCall,
  mutualRelatedBridge,
  pinnedSubject,
  QLOO_LIVE_SOURCE,
  rankingFromRank,
  recurringSignalProfile,
} from "../src/qloo/live-adapter.js";
import { compactEntity, envelope, failure, FixtureTransport, interpreted, syntheticId } from "./fixtures/synthetic/envelopes.js";

const AT = "2026-10-16T00:00:00.000Z";
const tag = (n: number, ns: string, affinity?: number) => ({ id: `urn:tag:${ns}:synthetic:t${n}`, name: `Synthetic tag ${n}`, type: `urn:tag:${ns}:synthetic`, ...(affinity !== undefined && { affinity }), popularity: 0.5 });
const tagsEnvelope = (tags: object[]) => envelope("entity_tags", "ok", { interpretation: { entities: [] }, results: tags });
const NS = ["keyword", "genre", "aesthetic_property", "customer_segment", "lifestyle", "decor"];
const brandTags = (count: number) => Array.from({ length: count }, (_, i) => tag(i + 1, NS[i % NS.length] as string, 1 - i * 0.002));

const brand = { id: syntheticId(1), label: "Synthetic Brand", type: "urn:entity:brand" };

describe("live adapter: entity_tags → CulturalProfile", () => {
  it("keeps Qloo order as rank, scopes affinity to the call, declares no scale, and keeps provenance", () => {
    const call = liveCall("entity_tags", tagsEnvelope([tag(1, "keyword", 1), tag(2, "genre", 0.99)]), AT);
    const profile = brandProfileFromEntityTags(pinnedSubject(brand, [call]), call, 20);
    expect(profile.signals.map((s) => [s.id, s.rank, s.category])).toEqual([
      ["urn:tag:keyword:synthetic:t1", 1, "urn:tag:keyword:synthetic"],
      ["urn:tag:genre:synthetic:t2", 2, "urn:tag:genre:synthetic"],
    ]);
    expect(profile.signals[0]?.numeric).toEqual({ value: 1, comparisonScope: "within_call" });
    expect(profile.signals[0]?.provenance).toEqual([{ source: QLOO_LIVE_SOURCE, operation: "entity_tags", correlationId: call.envelope.execution.correlation_id, capturedAt: AT }]);
    expect(profile.truncated).toBeUndefined();
    expect(profile.subject.resolution).toBe("confirmed");
  });

  it("marks the profile truncated when Qloo returned exactly the requested limit", () => {
    const call = liveCall("entity_tags", tagsEnvelope(brandTags(5)), AT);
    expect(brandProfileFromEntityTags(pinnedSubject(brand, [call]), call, 5).truncated).toBe(true);
  });

  it("refuses to map a needs_input envelope", () => {
    const call = liveCall("entity_tags", envelope("entity_tags", "needs_input", { interpretation: {} }), AT);
    expect(() => brandProfileFromEntityTags(pinnedSubject(brand, [call]), call, 20)).toThrow(/needs_input/);
  });
});

describe("live adapter: derived target profile (recurring signals)", () => {
  const ex = (ids: number[]) => liveCall("entity_tags", tagsEnvelope(ids.map((n) => tag(n, "keyword", 0.9))), AT);
  const subject = pinnedSubject({ id: "urn:tag:interests:synthetic:territory", label: "Synthetic Territory", type: "territory" }, []);

  it("keeps tags recurring in ≥ minSupport exemplars, ranks by support, never averages values", () => {
    const calls = [ex([1, 2, 3]), ex([2, 3]), ex([3, 4])];
    const profile = recurringSignalProfile(subject, calls, { minSupport: 2, requestedLimit: 20 });
    expect(profile.signals.map((s) => [s.id.split(":").pop(), s.rank])).toEqual([["t3", 1], ["t2", 2]]);
    expect(profile.signals.every((s) => s.numeric === undefined)).toBe(true);
    expect(profile.signals[0]?.provenance).toHaveLength(3);
    expect(profile.provenance).toHaveLength(3);
  });

  it("is order-independent across exemplar calls", () => {
    const a = [ex([1, 2]), ex([2, 3]), ex([3, 1])];
    const ids = (calls: typeof a) => recurringSignalProfile(subject, calls, { minSupport: 2, requestedLimit: 20 }).signals.map((s) => s.id);
    expect(ids(a)).toEqual(ids([...a].reverse()));
  });
});

describe("live adapter: comparison scope and opaque audience", () => {
  it("maps one rank call to a single_call ranking the engine can verify", () => {
    const rank = liveCall("rank", envelope("rank", "ok", { interpretation: {}, results: [compactEntity(syntheticId(2), "Cand A", "urn:entity:brand", 0.8), compactEntity(syntheticId(3), "Cand B", "urn:entity:brand", 0.6)] }), AT);
    const ranking = rankingFromRank(rank, brand.id, syntheticId(2));
    expect(ranking.comparisonScope).toBe("single_call");
    expect(ranking.targetCandidateId).toBe(syntheticId(2));
    expect(new Set(ranking.candidates.map((c) => c.provenance[0]?.correlationId)).size).toBe(1);
  });

  it("keeps compare_audiences opaque: no interpretable metric is promoted", () => {
    const compare = liveCall("compare_audiences", envelope("compare_audiences", "ok", { interpretation: {}, results: { a: [{ tag_id: "urn:tag:x", popularity: 0.9, query: { count: "1" } }], b: [] } }), AT);
    const audience = audienceFromCompare(compare);
    expect(audience.interpretableMetrics).toEqual([]);
    expect(Object.keys(audience.fields)).toEqual(["compare_results"]);
  });

  it("joint and mutual-related bridges carry no strength and no path semantics", () => {
    const joint = jointSignalBridge(liveCall("entity_tags", tagsEnvelope([tag(1, "keyword", 1)]), AT));
    expect(joint.semantics).toBe("joint_signal");
    expect(joint.signals[0]?.rank).toBeUndefined();
    const rec = (ids: number[]) => liveCall("recommend", envelope("recommend", "ok", { interpretation: {}, results: ids.map((n) => compactEntity(syntheticId(n), `E${n}`)) }), AT);
    const mutual = mutualRelatedBridge(rec([10, 11, 12]), rec([11, 12, 13]), [syntheticId(12)]);
    expect(mutual.semantics).toBe("intermediate_signal");
    expect(mutual.signals.map((s) => s.label)).toEqual(["E11"]);
    expect(mutual.signals[0]?.numeric).toBeUndefined();
  });
});

describe("LiveCollector status policy", () => {
  const noSleep = { spacingMs: 0, rateLimitWaitMs: 0, sleep: async () => {} };

  it("never continues needs_input", async () => {
    const collector = new LiveCollector(new FixtureTransport(() => envelope("describe", "needs_input", { interpretation: {} })), noSleep);
    expect(await collector.call("x", "describe", { entity: "y" })).toBeUndefined();
    expect(collector.steps[0]?.outcome).toBe("needs_input");
  });

  it("retries a retryable failure once, and a non-retryable failure never", async () => {
    const retryable = new FixtureTransport(() => failure("QLOO_RATE_LIMIT", true));
    const c1 = new LiveCollector(retryable, noSleep);
    await c1.call("x", "describe", { entity: "y" });
    expect(retryable.calls).toHaveLength(2);
    expect(c1.steps[0]).toMatchObject({ outcome: "failed", attempts: 2 });
    const fatal = new FixtureTransport(() => failure("QLOO_UPSTREAM", false));
    await new LiveCollector(fatal, noSleep).call("x", "describe", { entity: "y" });
    expect(fatal.calls).toHaveLength(1);
  });

  it("flags partial and degraded results", async () => {
    const collector = new LiveCollector(new FixtureTransport(() => envelope("entity_tags", "degraded", { interpretation: {}, results: [] })), noSleep);
    await collector.call("x", "entity_tags", { entities: ["a"] });
    expect(collector.flags[0]?.code).toBe("QLOO_DEGRADED");
  });
});

describe("G3 profile sufficiency criteria", () => {
  const ids = brandTags(20).map((t) => t.id);
  it("passes a diverse, repeatable, discriminating profile", () => {
    const values = brandTags(20).map((t) => t.affinity);
    expect(assessProfileSufficiency({ role: "brand", ids, values, repeatIds: ids, crossTake: { 10: ids.slice(0, 10) } }).verdict).toBe("SUFFICIENT_STABLE_CULTURAL_PROFILE");
  });
  it("is SET_ONLY when affinities do not discriminate", () => {
    expect(assessProfileSufficiency({ role: "brand", ids, values: ids.map(() => 1), repeatIds: ids }).verdict).toBe("SUFFICIENT_SET_ONLY");
  });
  it("is INSUFFICIENT when operational tags dominate", () => {
    const operational = Array.from({ length: 20 }, (_, i) => `urn:tag:${["specialty_dish", "credit_card", "hotel_rating", "cost_description", "inclusivity"][i % 5]}:place:x${i}`);
    const result = assessProfileSufficiency({ role: "target", ids: operational, values: operational.map(() => undefined) });
    expect(result.verdict).toBe("INSUFFICIENT");
    expect(result.failed.join(" ")).toContain("C4");
  });
  it("a derived set is judged on set criteria only (no C2), and is at best SET_ONLY", () => {
    const result = assessProfileSufficiency({ role: "target", ids, values: ids.map(() => undefined), derivedSetOnly: true });
    expect(result.verdict).toBe("SUFFICIENT_SET_ONLY");
    expect(result.failed.join(" ")).not.toContain("C2");
  });
});

describe("decision rule", () => {
  const g = (id: string, tier: LiveGate["tier"], status: LiveGate["status"]): LiveGate => ({ id, name: id, tier, status, observed: "" });
  it("any CORE FAIL → NO-GO; all PASS → GO; otherwise CONDITIONAL GO", () => {
    expect(decide([g("G1", "CORE", "FAIL"), g("G4", "ENHANCEMENT", "PASS")])).toBe("NO-GO");
    expect(decide([g("G1", "CORE", "PASS"), g("G4", "ENHANCEMENT", "NOT_REQUIRED")])).toBe("GO");
    expect(decide([g("G1", "CORE", "PASS"), g("G4", "ENHANCEMENT", "FAIL")])).toBe("CONDITIONAL GO");
  });
  it("no observations → G1 FAIL", () => {
    expect(evaluateLiveGates(undefined)[0]).toMatchObject({ id: "G1", status: "FAIL" });
  });
});

describe("runLiveInvestigation over a SYNTHETIC world", () => {
  const territoryTag = "urn:tag:interests:synthetic:boutique";
  const exemplarIds = [21, 22, 23, 24, 25, 26].map(syntheticId);
  const config: LiveInvestigationConfig = {
    ...LIVE_INVESTIGATION,
    brand: { query: "Synthetic Brand", ...brand },
    territory: {
      ...LIVE_INVESTIGATION.territory,
      tagQueries: ["Synthetic Boutique"],
      pinnedTag: { id: territoryTag, label: "Synthetic Boutique", type: "urn:tag:interests:synthetic" },
      exemplars: exemplarIds.map((id, i) => ({ id, label: `Synthetic Hotel ${i}`, type: "urn:entity:place" })),
    },
    ranking: { optionType: "brand", candidates: [0, 1, 2, 3].map((i) => ({ territory: i === 0 ? "Boutique Hospitality" : `T${i}`, primary: { id: syntheticId(40 + i), label: `P${i}`, type: "urn:entity:brand" }, alternate: { id: syntheticId(50 + i), label: `A${i}`, type: "urn:entity:brand" } })) },
    bridges: [{ label: "Boutique Hospitality", exemplar: { id: syntheticId(40), label: "P0", type: "urn:entity:brand" } }],
    callSpacingMs: 0,
  };

  function world(resolvedBrandId: string) {
    return new FixtureTransport((operation, input) => {
      switch (operation) {
        case "describe":
          return envelope("describe", "ok", { interpretation: { entity: interpreted("Synthetic Brand", resolvedBrandId, "Synthetic Brand") }, results: [compactEntity(resolvedBrandId, "Synthetic Brand")] });
        case "find_tags":
          return envelope("find_tags", "ok", { results: [{ id: territoryTag, name: "Synthetic Boutique", type: "urn:tag:interests:synthetic" }] });
        case "entity_tags": {
          const entities = input.entities as string[];
          const limit = (input.limit as number) ?? 20;
          return tagsEnvelope(entities.includes(brand.id) ? brandTags(limit) : brandTags(limit).slice(2));
        }
        case "recommend":
          return envelope("recommend", "ok", { interpretation: {}, results: [60, 61, 62, 63, 64].map((n) => compactEntity(syntheticId(n), `R${n}`, "urn:entity:place", 0.9)) });
        case "rank":
          return envelope("rank", "ok", { interpretation: {}, results: (input.options as string[]).map((id, i) => compactEntity(id, `O${i}`, "urn:entity:brand", 0.9 - i * 0.1)) });
        case "compare_audiences":
          return envelope("compare_audiences", "ok", { interpretation: {}, results: { a: [{ tag_id: "urn:tag:x", popularity: 0.9 }], b: [] } });
        case "audience_demographics":
          return envelope("audience_demographics", "ok", { interpretation: { entity: interpreted(brand.id, brand.id, "Synthetic Brand") }, results: [{ query: { age: { "25_to_29": 0.1 } } }] });
        case "trends":
          return envelope("trends", "ok", { interpretation: {}, series: [{ points: [{ date: "2026-01-01", population_percentile: 0.5 }] }] });
        default:
          return failure("UNEXPECTED", false);
      }
    });
  }
  const collector = (transport: FixtureTransport) => new LiveCollector(transport, { spacingMs: 0, sleep: async () => {} });

  it("maps verified evidence into a valid live packet and produces ingredients but no score", async () => {
    const result = await runLiveInvestigation(collector(world(brand.id)), config, new Date(AT));
    expect(result.packet).toBeDefined();
    expect(parseEvidencePacket(result.packet).ok).toBe(true);
    const ingredients = analyzeEvidencePacket(result.packet);
    expect(ingredients.evidenceOrigin).toBe("live");
    expect(ingredients.ranking.scope?.verified).toBe(true);
    expect(ingredients.audience.status).toBe("insufficient_evidence");
    expect(JSON.stringify(ingredients)).not.toMatch(/elasticityScore|distanceScore|"score"/i);
    expect(result.gates.find((g) => g.id === "G1")?.status).toBe("PASS");
    expect(result.gates.find((g) => g.id === "G2")?.status).toBe("PASS");
  });

  it("blocks with G1 FAIL when the brand no longer resolves to the pinned entity", async () => {
    const result = await runLiveInvestigation(collector(world(syntheticId(99))), config, new Date(AT));
    expect(result.packet).toBeUndefined();
    expect(result.decision).toBe("NO-GO");
    expect(result.gates[0]?.status).toBe("FAIL");
  });

  it("G2 is not PASS when the pinned territory tag is absent from tag search", async () => {
    const result = await runLiveInvestigation(collector(world(brand.id)), { ...config, territory: { ...config.territory, pinnedTag: { ...config.territory.pinnedTag, id: "urn:tag:interests:synthetic:other" } } }, new Date(AT));
    expect(result.gates.find((g) => g.id === "G2")?.status).toBe("FAIL");
  });
});
