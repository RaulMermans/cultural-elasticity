import { describe, expect, it } from "vitest";
import { buildBaselineResult, resolveBrand } from "../src/brand-baseline/research.js";
import { brandBaselineResultSchema } from "../src/brand-baseline/schema.js";
import type { QlooClient } from "../src/qloo/client.js";
import { syntheticBrand, syntheticProvenance, syntheticTag, syntheticTagObservation } from "./fixtures/synthetic/brand-baseline.js";

const brand = syntheticBrand("Northwind Atelier", "syn-brand-1");
const secondBrand = syntheticBrand("Harbor Studio", "syn-brand-2");
const input = (observations: Parameters<typeof buildBaselineResult>[0]["observations"], selected = brand) => ({
  scanId: "syn-scan-1",
  brandId: "syn-internal-brand-1",
  brand: selected,
  brandCapturedAt: "2026-10-25T00:00:00.000Z",
  observations,
  startedAt: "2026-10-25T00:00:00.000Z",
  finishedAt: "2026-10-25T00:01:00.000Z",
  providerCallCount: 2,
  recordedOrLive: "recorded" as const,
});

describe("SYNTHETIC brand baseline research", () => {
  it("resolves only a verified brand and checks a selected identity", async () => {
    const describe = async () => ({ kind: "ok" as const, data: { entity: brand, details: [] }, provenance: syntheticProvenance("describe", "syn-describe") });
    expect((await resolveBrand({ describe }, "  northwind   atelier ")).status).toBe("RESOLVED");
    expect((await resolveBrand({ describe }, "Northwind Atelier", "syn-different")).status).toBe("NOT_FOUND");
  });

  it("requires confirmation when Qloo requests input", async () => {
    const describe: Pick<QlooClient, "describe">["describe"] = async () => ({
      kind: "needs_input", summary: "synthetic ambiguity", provenance: syntheticProvenance("describe", "syn-ambiguous"),
      issues: [{ input: "Harbor", kind: "ambiguous", inputKind: "entity", field: "entity", candidates: [
        { qlooId: "syn-brand-1", label: "Harbor Studio", type: "brand" },
        { qlooId: "syn-brand-2", label: "Harbor Works", type: "brand" },
      ] }],
    });
    expect(await resolveBrand({ describe }, "Harbor")).toMatchObject({ status: "AMBIGUOUS", candidates: [{ qlooId: "syn-brand-1" }, { qlooId: "syn-brand-2" }] });
  });

  it("does not accept a non-brand or a missing name", async () => {
    const nonBrand = { ...brand, type: "urn:entity:place" };
    const describe = async () => ({ kind: "ok" as const, data: { entity: nonBrand, details: [] }, provenance: syntheticProvenance("describe", "syn-describe") });
    expect((await resolveBrand({ describe }, "Northwind Atelier")).status).toBe("NOT_FOUND");
    await expect(resolveBrand({ describe }, " ")).rejects.toThrow("INVALID_BRAND_NAME");
  });

  it("is deterministic, grounded, and excludes operational tags", () => {
    const observations = [syntheticTagObservation([
      syntheticTag("urn:tag:interests:qloo:maker_culture", "Maker culture"),
      syntheticTag("urn:tag:credit_card:place:visa", "Visa"),
      syntheticTag("urn:tag:interests:qloo:maker_culture", "Maker culture"),
    ])];
    const first = buildBaselineResult(input(observations));
    const second = buildBaselineResult(input(observations));
    expect(first).toEqual(second);
    expect(first.territories).toHaveLength(1);
    expect(first.territories[0]?.canonicalConcept).toBe("urn:tag:interests:qloo:maker_culture");
    expect(first.territories[0]?.supportingReferences[0]?.correlationId).toBe("syn-tags");
    expect(first.fingerprint.signals).toHaveLength(1);
    expect(first.fingerprint.limitations).toContain("tags: venue or operational metadata was excluded from the cultural fingerprint.");
    expect(JSON.stringify(first)).not.toMatch(/elasticityScore|opportunityScore|distanceScore/u);
  });

  it("never treats cross-call affinity as a comparable global score", () => {
    const a = syntheticTagObservation([syntheticTag("urn:tag:interests:qloo:craft", "Craft")]);
    const b = { ...a, domain: "artist" as const, outcome: { kind: "ok" as const, data: { signals: [secondBrand], entities: [{ kind: "entity" as const, qlooId: "syn-artist-1", label: "Synthetic Artist", type: "urn:entity:artist", affinity: 0.8, sourceCorrelationId: "syn-artists" }] }, provenance: syntheticProvenance("recommend", "syn-artists") } };
    const result = buildBaselineResult(input([a, b]));
    expect(result.fingerprint.signals.map((signal) => signal.source.correlationId)).toEqual(["syn-tags", "syn-artists"]);
    expect(result.territories).toHaveLength(1);
  });

  it("does not turn missing or degraded evidence into a supported finding", () => {
    const result = buildBaselineResult(input([
      syntheticTagObservation([], "degraded"),
      { domain: "artist", capturedAt: "2026-10-25T00:00:00.000Z", outcome: { kind: "empty", summary: "synthetic empty", provenance: syntheticProvenance("recommend", "syn-empty", "empty") } },
    ]));
    expect(result.scanStatus).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.territories).toEqual([]);
  });

  it("coalesces repeated exclusion reasons in a full five-domain response", () => {
    const domains = ["artist", "place", "movie", "book"] as const;
    const observations = [syntheticTagObservation([syntheticTag("urn:tag:interests:qloo:craft", "Craft")]), ...domains.map((domain) => ({
      domain,
      capturedAt: "2026-10-25T00:00:00.000Z",
      outcome: {
        kind: "ok" as const,
        data: { signals: [brand], entities: Array.from({ length: 10 }, (_, index) => ({ kind: "entity" as const, qlooId: `syn-${domain}-${index}`, label: `SYNTHETIC ${domain} ${index}`, type: "urn:entity:brand", sourceCorrelationId: `syn-${domain}` })) },
        provenance: syntheticProvenance("recommend", `syn-${domain}`),
      },
    }))];
    const result = buildBaselineResult({ ...input(observations), scanId: "00000000-0000-4000-8000-000000000001", brandId: "00000000-0000-4000-8000-000000000002" });
    const parsed = brandBaselineResultSchema.safeParse(result);
    expect(parsed.success, parsed.error?.issues.map((issue) => issue.path.join(".")).join(", ")).toBe(true);
    expect(result.fingerprint.limitations).toHaveLength(4);
    expect(result.fingerprint.signals).toHaveLength(1);
  });

  it("marks a SYNTHETIC live-shaped response partial when only generic entity types and no grounded territory are available", () => {
    const tags = syntheticTagObservation([
      syntheticTag("urn:tag:genre:media:fashion", "Fashion"),
      syntheticTag("urn:tag:credit_card:place:jcb", "JCB"),
    ]);
    const artist = {
      domain: "artist" as const,
      capturedAt: "2026-10-25T00:00:00.000Z",
      outcome: {
        kind: "ok" as const,
        data: { signals: [brand], entities: [{ kind: "entity" as const, qlooId: "syn-generic-artist", label: "SYNTHETIC Artist", type: "urn:entity", sourceCorrelationId: "syn-generic" }] },
        provenance: syntheticProvenance("recommend", "syn-generic"),
      },
    };
    const result = buildBaselineResult(input([tags, artist]));
    expect(result.scanStatus).toBe("PARTIAL");
    expect(result.fingerprint.signals.map((signal) => signal.name)).toEqual(["Fashion"]);
    expect(result.territories).toEqual([]);
    expect(result.fingerprint.limitations).toContain("artist: an entity with an unverified target type was excluded.");
  });
});
