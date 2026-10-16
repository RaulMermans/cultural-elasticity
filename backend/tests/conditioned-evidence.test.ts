/**
 * Brand-conditioned territory evidence (EvidencePacket 0.2 `conditionedEntities`): schema, single-call
 * verification, normalization, quality, the core's descriptive view, and the live adapter mapping.
 * All data is SYNTHETIC (placeholder ids, source "synthetic-test" / SYNTHETIC envelopes).
 */
import { describe, expect, it } from "vitest";
import { describeConditionedEvidence } from "../src/analysis/conditioned.js";
import { analyzeEvidencePacket } from "../src/analysis/ingredients.js";
import { verifyConditionedScope } from "../src/evidence/comparability.js";
import { normalizeEvidencePacket } from "../src/evidence/normalize.js";
import { assessEvidenceQuality } from "../src/evidence/quality.js";
import { parseEvidencePacket, type ConditionedEntityEvidence, type EvidencePacket } from "../src/evidence/schema.js";
import { assembleLivePacket, brandProfileFromEntityTags, conditionedEntitiesFromRecommend, emptyConditionedEvidence, liveCall, pinnedSubject, QLOO_LIVE_SOURCE } from "../src/qloo/live-adapter.js";
import { compactEntity, envelope, syntheticId } from "./fixtures/synthetic/envelopes.js";
import { packet, ref } from "./fixtures/synthetic/evidence.js";

const conditioned = (overrides: Partial<ConditionedEntityEvidence> = {}): ConditionedEntityEvidence => ({
  conditionedOn: { id: "syn-brand", label: "Synthetic Brand" },
  territory: { id: "syn-concept", label: "Synthetic concept" },
  entityType: "syn-entity",
  requestedLimit: 20,
  truncated: false,
  entities: [3, 1, 2].map((rank) => ({ id: `syn-cond-${rank}`, label: `Synthetic ${rank}`, rank, numeric: { value: 1 - rank / 10, comparisonScope: "within_call" as const }, provenance: [ref("syn-corr-cond")] })),
  comparisonScope: "single_call",
  provenance: [ref("syn-corr-cond", "recommend")],
  ...overrides,
});

const v02 = (items: ConditionedEntityEvidence[]): EvidencePacket => ({ ...packet(), schemaVersion: "ce-evidence/0.2", conditionedEntities: items });

describe("schema", () => {
  it("accepts a 0.2 packet with conditioned evidence and keeps 0.1 packets valid", () => {
    expect(parseEvidencePacket(v02([conditioned()])).ok).toBe(true);
    expect(parseEvidencePacket(packet()).ok).toBe(true);
  });

  it("rejects conditioned evidence in a 0.1 packet", () => {
    const result = parseEvidencePacket({ ...packet(), conditionedEntities: [conditioned()] });
    expect(result.ok).toBe(false);
  });

  it("requires within_call values, unique ranks and ids, and provenance on an empty result", () => {
    const bad = [
      conditioned({ entities: [{ id: "a", label: "A", rank: 1, numeric: { value: 1, scale: "x", comparisonScope: "cross_call_verified" }, provenance: [] }] }),
      conditioned({ entities: [{ id: "a", label: "A", rank: 1, provenance: [] }, { id: "b", label: "B", rank: 1, provenance: [] }] }),
      conditioned({ entities: [{ id: "a", label: "A", rank: 1, provenance: [] }, { id: "a", label: "A", rank: 2, provenance: [] }] }),
      conditioned({ entities: [], provenance: [] }),
      conditioned({ requestedLimit: 1 }),
    ];
    for (const item of bad) expect(parseEvidencePacket(v02([item])).ok).toBe(false);
  });
});

describe("single-call scope", () => {
  it("verifies a list whose entities trace to one correlation id", () => {
    expect(verifyConditionedScope(conditioned())).toEqual({ verified: true, correlationId: "syn-corr-cond" });
  });

  it("refuses a list that mixes calls", () => {
    const mixed = conditioned();
    mixed.entities[0] = { ...mixed.entities[0]!, provenance: [ref("syn-corr-other")] };
    expect(verifyConditionedScope(mixed).verified).toBe(false);
    const view = describeConditionedEvidence(mixed);
    expect(view.status).toBe("not_comparable");
    expect(view.topEntities).toEqual([]);
    expect(view.withinCallValueRange).toBeNull();
  });
});

describe("normalization and quality", () => {
  it("sorts entities by explicit rank", () => {
    const normalized = normalizeEvidencePacket(v02([conditioned()])).packet;
    expect(normalized.conditionedEntities?.[0]?.entities.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it("is unavailable when absent (never lowers quality) and good when verified", () => {
    expect(assessEvidenceQuality(packet()).indicators.conditionedEvidence.level).toBe("unavailable");
    expect(assessEvidenceQuality(v02([conditioned()])).indicators.conditionedEvidence.level).toBe("good");
    expect(assessEvidenceQuality(packet()).overall.level).toBe(assessEvidenceQuality(v02([conditioned()])).overall.level);
  });

  it("counts conditioned entities in provenance coverage", () => {
    const noProv = conditioned();
    noProv.entities[0] = { ...noProv.entities[0]!, provenance: [] };
    expect(assessEvidenceQuality(v02([noProv])).indicators.provenance.level).toBe("insufficient");
  });
});

describe("core view (descriptive only)", () => {
  it("reports count, support, order and within-call spread", () => {
    const result = analyzeEvidencePacket(v02([conditioned()]));
    const item = result.conditioned.items[0]!;
    expect(result.conditioned.status).toBe("available");
    expect(item.entityCount).toBe(3);
    expect(item.support).toBe("SPARSE");
    expect(item.topEntities.map((e) => e.rank)).toEqual([1, 2, 3]);
    expect(item.withinCallValueRange).toBeCloseTo(0.2, 10);
    expect(result.limitations.some((l) => l.code === "CONDITIONED_VALUES_WITHIN_CALL")).toBe(true);
  });

  it("keeps an observed empty list as EMPTY, never as zero closeness", () => {
    const view = describeConditionedEvidence(conditioned({ entities: [] }));
    expect(view).toMatchObject({ status: "empty", support: "EMPTY", entityCount: 0, withinCallValueRange: null, withinCallTopFiveGap: null });
  });

  it("does not compute a spread when a value is missing", () => {
    const partial = conditioned();
    const { numeric: _n, ...withoutValue } = partial.entities[0]!;
    partial.entities[0] = withoutValue;
    expect(describeConditionedEvidence(partial).withinCallValueRange).toBeNull();
  });

  it("is unavailable when no conditioned evidence was provided", () => {
    expect(analyzeEvidencePacket(packet()).conditioned.status).toBe("unavailable");
  });
});

describe("live adapter mapping (SYNTHETIC envelope)", () => {
  const AT = "2026-10-16T00:00:00.000Z";
  const scope = { conditionedOn: { id: syntheticId(1), label: "Synthetic Brand" }, territory: { id: "urn:tag:interests:synthetic:territory", label: "Synthetic Territory" }, entityType: "urn:entity:place", requestedLimit: 3 };

  it("keeps Qloo order as rank, scopes affinity to the call, and records truncation", () => {
    const call = liveCall("recommend", envelope("recommend", "ok", { results: [compactEntity(syntheticId(10), "Place A", "urn:entity:place", 0.9), compactEntity(syntheticId(11), "Place B", "urn:entity:place", 0.8), compactEntity(syntheticId(12), "Place C", "urn:entity:place", 0.7)] }), AT);
    const evidence = conditionedEntitiesFromRecommend(call, scope);
    expect(evidence.entities.map((e) => [e.id, e.rank, e.numeric])).toEqual([
      [syntheticId(10), 1, { value: 0.9, comparisonScope: "within_call" }],
      [syntheticId(11), 2, { value: 0.8, comparisonScope: "within_call" }],
      [syntheticId(12), 3, { value: 0.7, comparisonScope: "within_call" }],
    ]);
    expect(evidence.truncated).toBe(true);
    expect(evidence.comparisonScope).toBe("single_call");
    expect(evidence.provenance[0]).toMatchObject({ source: QLOO_LIVE_SOURCE, operation: "recommend", correlationId: call.envelope.execution.correlation_id });
    expect(verifyConditionedScope(evidence).verified).toBe(true);
  });

  it("maps an ok-but-empty result and an `empty` envelope to an observed empty list with provenance", () => {
    const okEmpty = conditionedEntitiesFromRecommend(liveCall("recommend", envelope("recommend", "ok", { results: [] }), AT), scope);
    const empty = emptyConditionedEvidence(liveCall("recommend", envelope("recommend", "empty", { results: [] }), AT), scope);
    for (const item of [okEmpty, empty]) {
      expect(item.entities).toEqual([]);
      expect(item.provenance[0]?.correlationId).toBeDefined();
    }
  });

  it("assembles a valid 0.2 packet carrying the conditioned slot", () => {
    const tags = liveCall("entity_tags", envelope("entity_tags", "ok", { results: [{ id: "urn:tag:keyword:synthetic:a", name: "A", type: "urn:tag:keyword:synthetic", affinity: 1 }] }), AT);
    const subject = pinnedSubject({ id: syntheticId(1), label: "Synthetic Brand", type: "urn:entity:brand" }, [tags]);
    const target = pinnedSubject({ id: syntheticId(2), label: "Synthetic Target", type: "urn:entity:brand" }, [tags]);
    const call = liveCall("recommend", envelope("recommend", "ok", { results: [compactEntity(syntheticId(10), "Place A", "urn:entity:place", 0.9)] }), AT);
    const assembled = assembleLivePacket({ brand: brandProfileFromEntityTags(subject, tags, 20), target: brandProfileFromEntityTags(target, tags, 20), conditionedEntities: [conditionedEntitiesFromRecommend(call, scope)], limitations: [] });
    const parsed = parseEvidencePacket(assembled);
    expect(parsed.ok && parsed.packet.schemaVersion).toBe("ce-evidence/0.2");
    expect(parsed.ok && parsed.packet.conditionedEntities?.length).toBe(1);
  });
});
