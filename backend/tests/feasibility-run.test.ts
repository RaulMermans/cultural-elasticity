/**
 * Fixture-driven test of the feasibility pipeline. The "world" below is SYNTHETIC: it checks that
 * the pipeline handles Qloo outcomes correctly, not that Qloo returns any of this.
 */
import { describe, expect, it } from "vitest";
import { evidencePacketSchema } from "../src/contracts/qloo.js";
import type { InvestigationConfig } from "../scripts/feasibility/config.js";
import { runFeasibility } from "../scripts/feasibility/run.js";
import { HarnessQlooClient } from "../src/qloo/client.js";
import { QlooNotConfiguredError, QlooTransportError } from "../src/qloo/errors.js";
import type { QlooOperation, QlooStatus } from "../src/qloo/types.js";
import { compactEntity, compactTag, envelope, failure, FixtureTransport, interpreted, syntheticId } from "./fixtures/synthetic/envelopes.js";

const BRAND = syntheticId(1);
const OPTIONS: Record<string, string> = {
  "Option One": syntheticId(11),
  "Option Two": syntheticId(12),
  "Option Three": syntheticId(13),
  "Option Four": syntheticId(14),
};
const PLACES = [101, 102, 103, 104, 105, 106].map(syntheticId);
const TAG_SELECTED = "urn:tag:synthetic:selected";
const tag = (n: number) => `urn:tag:synthetic:t${n}`;

const config: InvestigationConfig = {
  brand: { query: "Example Maison", type: "brand" },
  target: { label: "Example Territory", tagQueries: ["Empty Phrase", "Territory Phrase"], pinnedTagId: undefined, exemplarType: "place", exemplarLimit: 10 },
  ranking: {
    optionType: "brand",
    candidates: [
      { territory: "T1", exemplar: "Option One" },
      { territory: "T2", exemplar: "Option Two" },
      { territory: "T3", exemplar: "Option Three" },
      { territory: "T4", exemplar: "Option Four" },
      { territory: "T5", exemplar: "Twin Name" },
      { territory: "T6", exemplar: "Missing Name" },
    ],
  },
  bridges: [
    { label: "Example Territory", exemplars: "target" },
    { label: "Far Territory", exemplars: { names: ["Option Four"], type: "brand" } },
  ],
  jointTagExemplarCap: 3,
  tagTopN: 20,
  momentumWindowDays: 30,
};

type Overrides = Partial<Record<QlooOperation, QlooStatus>>;

function world(overrides: Overrides = {}) {
  return (operation: QlooOperation, input: Record<string, unknown>) => {
    const status = overrides[operation] ?? "ok";
    switch (operation) {
      case "describe": {
        const name = input.entity as string;
        if (name === "Example Maison") {
          return envelope("describe", status, { interpretation: { entity: interpreted(name, BRAND, name) }, results: [compactEntity(BRAND, name, "urn:entity:brand", undefined, 0.8)] });
        }
        const id = OPTIONS[name];
        if (id) return envelope("describe", "ok", { interpretation: { entity: interpreted(name, id, name) }, results: [compactEntity(id, name)] });
        if (name === "Twin Name") {
          return envelope("describe", "needs_input", {
            resolution: { issues: [{ input: name, kind: "ambiguous", candidates: [{ id: syntheticId(91), name: "Twin Name" }, { id: syntheticId(92), name: "Twin Name" }] }] },
          });
        }
        return envelope("describe", "needs_input", { resolution: { issues: [{ input: name, kind: "not_found" }] } });
      }
      case "find_tags":
        return envelope("find_tags", "ok", {
          results: input.query === "Empty Phrase" ? [] : [compactTag(TAG_SELECTED, "Synthetic Selected"), compactTag("urn:tag:synthetic:alt", "Synthetic Alt")],
        });
      case "recommend": {
        if (input.signal_tags) {
          return envelope("recommend", "ok", { interpretation: { signals: [] }, results: PLACES.map((id, i) => compactEntity(id, `Place ${i + 1}`, "urn:entity:place")) });
        }
        const signals = [interpreted(BRAND, BRAND, "Example Maison", "urn:entity:brand", "identifier")];
        if (input.target_type === "place") {
          return envelope("recommend", "ok", { interpretation: { signals }, results: PLACES.slice(0, 3).map((id, i) => compactEntity(id, `Place ${i + 1}`, "urn:entity:place", 0.9 - i / 10)) });
        }
        return envelope("recommend", "ok", { interpretation: { signals }, results: [compactEntity(syntheticId(201), "Neighbour Brand", "urn:entity:brand", 0.7)] });
      }
      case "entity_tags": {
        const entities = input.entities as string[];
        const subjects = entities.map((id) => interpreted(id, id, id, "urn:entity:x", "identifier"));
        let results;
        if (entities.length === 1 && entities[0] === BRAND) results = Array.from({ length: 12 }, (_, i) => compactTag(tag(i + 1), `Brand Tag ${i + 1}`, 1 - i / 20));
        else if (entities.length === 1 && entities[0] === OPTIONS["Option Four"]) results = [50, 51, 52].map((n) => compactTag(tag(n), `Far Tag ${n}`, 0.5));
        else if (entities[0] === BRAND) results = [compactTag(tag(10), "Joint Tag", 0.6)];
        else results = [10, 11, 12, 13, 14, 15].map((n) => compactTag(tag(n), `Target Tag ${n}`, 0.5));
        return envelope("entity_tags", status, { interpretation: { entities: subjects }, results });
      }
      case "audience_demographics":
        return envelope("audience_demographics", "ok", {
          interpretation: { entity: interpreted(BRAND, BRAND, "Example Maison", "urn:entity:brand", "identifier") },
          results: [{ age: { "25_to_29": 0.3 }, gender: { female: 0.6 } }],
        });
      case "trends":
        return envelope("trends", "ok", { interpretation: {}, series: [{ entity: { entityId: BRAND }, points: [{ date: "2026-10-01", popularity: 0.5 }] }] });
      case "compare_audiences":
        return envelope("compare_audiences", "ok", {
          interpretation: { group_a: [interpreted(BRAND, BRAND, "Example Maison", "urn:entity:brand", "identifier")], group_b: [] },
          results: { entities: [{ name: "Shared Thing", affinity_delta: 0.12 }] },
        });
      case "rank": {
        const ids = (input.options as string[]).slice().reverse();
        return envelope("rank", "ok", {
          interpretation: { options: [], signals: [] },
          results: ids.map((id, i) => compactEntity(id, Object.keys(OPTIONS).find((k) => OPTIONS[k] === id) ?? id, "urn:entity:brand", 0.95 - i / 10, 0.4)),
        });
      }
      default:
        throw new Error(`synthetic world does not handle ${operation}`);
    }
  };
}

const run = (transport: FixtureTransport) =>
  runFeasibility(new HarnessQlooClient(transport), config, { evidenceSource: "fixture", harnessVersion: "0.1.26", now: () => new Date("2026-10-16T00:00:00Z") });

describe("runFeasibility (SYNTHETIC fixture world)", () => {
  it("produces a schema-valid packet labelled as fixture evidence", async () => {
    const result = await run(new FixtureTransport(world()));
    expect(result.status).toBe("COMPLETED");
    expect(() => evidencePacketSchema.parse(result.packet)).not.toThrow();
    expect(result.packet?.evidenceSource).toBe("fixture");
  });

  it("auto-selects the first non-empty tag candidate but marks it unconfirmed", async () => {
    const { packet } = await run(new FixtureTransport(world()));
    const representation = packet!.target.representation;
    expect(representation.tagCandidates.map((s) => s.query)).toEqual(["Territory Phrase"]);
    expect(representation.selectedTag).toMatchObject({ qlooId: TAG_SELECTED, confirmation: "auto_selected_unconfirmed" });
    expect(representation.selectedTag?.alternatives.map((a) => a.qlooId)).toEqual(["urn:tag:synthetic:alt"]);
    expect(packet!.limitations.some((l) => l.includes("auto-selected") && l.includes("not been confirmed"))).toBe(true);
  });

  it("uses a pinned tag when configured", async () => {
    const pinnedConfig = { ...config, target: { ...config.target, pinnedTagId: TAG_SELECTED } };
    const result = await runFeasibility(new HarnessQlooClient(new FixtureTransport(world())), pinnedConfig, { evidenceSource: "fixture", harnessVersion: "0.1.26" });
    expect(result.packet!.target.representation.selectedTag?.confirmation).toBe("pinned");
  });

  it("excludes ambiguous and missing ranking exemplars instead of guessing", async () => {
    const transport = new FixtureTransport(world());
    const { packet } = await run(transport);
    const entries = packet!.rankings![0]!.entries;
    expect(entries.map((e) => e.territory)).toEqual(["T1", "T2", "T3", "T4", "T5", "T6"]);
    expect(entries.find((e) => e.territory === "T5")?.unresolvedReason).toMatch(/needs_input: Twin Name: ambiguous/);
    expect(entries.find((e) => e.territory === "T6")?.unresolvedReason).toMatch(/not_found/);
    const rankCall = transport.calls.find((c) => c.operation === "rank");
    expect(rankCall?.input.options).toEqual(Object.values(OPTIONS));
    expect(rankCall?.input.signals).toEqual([BRAND]);
  });

  it("ranks all options in one call and keeps Qloo's order", async () => {
    const transport = new FixtureTransport(world());
    const { packet } = await run(transport);
    const ranking = packet!.rankings![0]!;
    expect(transport.calls.filter((c) => c.operation === "rank")).toHaveLength(1);
    expect(ranking.comparableWithinCorrelationId).toMatch(/^synthetic-rank-/);
    expect(ranking.entries.find((e) => e.territory === "T4")).toMatchObject({ position: 1, affinity: 0.95 });
    expect(ranking.entries.find((e) => e.territory === "T1")?.position).toBe(4);
  });

  it("describes bridges as intermediate signals with descriptive overlap only", async () => {
    const { packet } = await run(new FixtureTransport(world()));
    const [near, far] = packet!.bridgeEvidence!;
    expect(near).toMatchObject({ semantics: "qloo_supported_intermediate_cultural_signals", toLabel: "Example Territory" });
    expect(near!.overlap).toEqual({ brandTopN: 12, targetTopN: 6, sharedCount: 3, jaccard: 3 / 15 });
    expect(near!.sharedTags.map((t) => t.qlooId)).toEqual([tag(10), tag(11), tag(12)]);
    expect(near!.jointTags.map((t) => t.label)).toEqual(["Joint Tag"]);
    expect(far).toMatchObject({ toLabel: "Far Territory", overlap: { sharedCount: 0, jaccard: 0 } });
  });

  it("caps exemplars in joint-tag calls", async () => {
    const transport = new FixtureTransport(world());
    await run(transport);
    const joint = transport.calls.filter((c) => c.operation === "entity_tags" && (c.input.entities as string[])[0] === BRAND && (c.input.entities as string[]).length > 1);
    expect(joint.every((c) => (c.input.entities as string[]).length <= 1 + config.jointTagExemplarCap)).toBe(true);
  });

  it("keeps opaque outputs opaque and invents no score fields", async () => {
    const { packet } = await run(new FixtureTransport(world()));
    expect(packet!.audienceComparison?.result).toMatchObject({ shape: "unverified", numericFieldPaths: ["entities[].affinity_delta"] });
    const json = JSON.stringify(packet);
    expect(json).not.toMatch(/elasticity|"score"|"distance"|"confidence"/i);
  });

  it("passes all gates on a complete synthetic world", async () => {
    const { gates } = await run(new FixtureTransport(world()));
    expect(gates.map((g) => [g.id, g.passed])).toEqual([
      ["G1", true],
      ["G2", true],
      ["G3", true],
      ["G4", true],
      ["G5", true],
      ["G6", true],
    ]);
  });

  it("blocks without guessing when the brand is ambiguous", async () => {
    const transport = new FixtureTransport((operation, input) =>
      operation === "describe"
        ? envelope("describe", "needs_input", { resolution: { issues: [{ input: input.entity, kind: "ambiguous", candidates: [{ id: syntheticId(7), name: "A" }, { id: syntheticId(8), name: "B" }] }] } })
        : world()(operation, input),
    );
    const result = await run(transport);
    expect(result.status).toBe("BLOCKED");
    expect(result.packet).toBeUndefined();
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ outcome: "needs_input" });
    expect(result.gates[0]).toMatchObject({ id: "G1", passed: false });
    expect(transport.calls).toHaveLength(1);
  });

  it("records degraded results as limitations", async () => {
    const result = await run(new FixtureTransport(world({ entity_tags: "degraded" })));
    expect(result.steps.find((s) => s.id === "brand.tags")).toMatchObject({ outcome: "ok", degraded: true });
    expect(result.packet!.provenance.some((p) => p.operation === "entity_tags" && p.degraded)).toBe(true);
    expect(result.packet!.limitations.some((l) => l.startsWith("brand.tags: Qloo marked this result degraded"))).toBe(true);
  });

  it("records a non-retryable step failure and continues with independent steps", async () => {
    const transport = new FixtureTransport((operation, input) => (operation === "compare_audiences" ? failure("QLOO_CONTRACT", false) : world()(operation, input)));
    const result = await run(transport);
    expect(result.status).toBe("COMPLETED");
    expect(result.steps.find((s) => s.id === "audience.compare")?.outcome).toBe("failed");
    expect(result.packet!.audienceComparison).toBeUndefined();
    expect(result.gates.find((g) => g.id === "G4")?.passed).toBe(false);
  });

  it("propagates a missing/rejected credential instead of producing a packet", async () => {
    await expect(run(new FixtureTransport(() => failure("QLOO_AUTH", false)))).rejects.toBeInstanceOf(QlooNotConfiguredError);
  });

  it("propagates transport failures (unrecoverable integration error)", async () => {
    const transport = new FixtureTransport(() => {
      throw new QlooTransportError("describe", "harness missing", null);
    });
    await expect(run(transport)).rejects.toBeInstanceOf(QlooTransportError);
  });
});
