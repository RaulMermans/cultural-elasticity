import { describe, expect, it } from "vitest";
import { QlooContractError } from "../src/qloo/errors.js";
import {
  numericFieldPaths,
  parseEnvelope,
  sanitizeForEvidence,
  toEntitySignals,
  toProvenance,
  toResolutionIssues,
  toResolvedEntities,
  toTagSignals,
} from "../src/qloo/normalize.js";
import { compactEntity, compactTag, envelope, interpreted, syntheticId } from "./fixtures/synthetic/envelopes.js";

describe("parseEnvelope (malformed data)", () => {
  it("accepts a contract-valid envelope", () => {
    expect(parseEnvelope("describe", envelope("describe", "ok")).status).toBe("ok");
  });

  it.each([
    ["missing execution", () => ({ ...envelope("describe", "ok"), execution: undefined })],
    ["unknown status", () => ({ ...envelope("describe", "ok"), status: "maybe" })],
    ["unsupported schema_version", () => ({ ...envelope("describe", "ok"), schema_version: "2.0" })],
    ["operation mismatch", () => envelope("rank", "ok")],
    ["error status without error object", () => envelope("describe", "error")],
    ["non-object payload", () => "nope"],
  ])("rejects %s", (_label, build) => {
    expect(() => parseEnvelope("describe", build())).toThrow(QlooContractError);
  });
});

describe("result normalization", () => {
  it("maps compact entities to cultural signals bound to their source call", () => {
    const env = parseEnvelope("recommend", envelope("recommend", "ok", { results: [compactEntity(syntheticId(1), "Example Brand", "urn:entity:brand", 0.91, 0.4)] }));
    const [signal] = toEntitySignals("recommend", env);
    expect(signal).toEqual({
      kind: "entity",
      qlooId: syntheticId(1),
      label: "Example Brand",
      type: "urn:entity:brand",
      affinity: 0.91,
      popularity: 0.4,
      sourceCorrelationId: env.execution.correlation_id,
    });
  });

  it("keeps affinity absent rather than inventing one", () => {
    const env = parseEnvelope("find_tags", envelope("find_tags", "ok", { results: [compactTag("urn:tag:keyword:qloo:a", "A")] }));
    expect(toTagSignals("find_tags", env)[0]).not.toHaveProperty("affinity");
  });

  it("rejects an entity without an id", () => {
    const env = parseEnvelope("recommend", envelope("recommend", "ok", { results: [{ name: "No Id" }] }));
    expect(() => toEntitySignals("recommend", env)).toThrow(QlooContractError);
  });

  it("rejects a non-numeric affinity", () => {
    const env = parseEnvelope("entity_tags", envelope("entity_tags", "ok", { results: [{ id: "t", name: "T", affinity: "high" }] }));
    expect(() => toTagSignals("entity_tags", env)).toThrow(QlooContractError);
  });

  it("rejects results that are not an array", () => {
    const env = parseEnvelope("recommend", envelope("recommend", "ok", { results: { entities: [] } }));
    expect(() => toEntitySignals("recommend", env)).toThrow(QlooContractError);
  });

  it("reads interpreted entities as unambiguous resolved concepts with provenance", () => {
    const env = parseEnvelope("describe", envelope("describe", "ok", { interpretation: { entity: interpreted("Example", syntheticId(2), "Example") } }));
    const provenance = toProvenance("describe", env);
    const [concept] = toResolvedEntities("describe", env, "entity", provenance);
    expect(concept).toMatchObject({ kind: "entity", qlooId: syntheticId(2), confirmation: "unambiguous", match: "exact" });
    expect(concept?.provenance).toEqual([provenance]);
  });

  it("extracts ambiguity candidates from needs_input", () => {
    const env = parseEnvelope(
      "describe",
      envelope("describe", "needs_input", {
        resolution: {
          issues: [{ input: "Twin", kind: "ambiguous", input_kind: "entity", field: "entity", candidates: [{ id: syntheticId(3), name: "Twin A" }, { id: syntheticId(4), name: "Twin B" }] }],
        },
      }),
    );
    const [issue] = toResolutionIssues("describe", env);
    expect(issue?.kind).toBe("ambiguous");
    expect(issue?.candidates.map((c) => c.label)).toEqual(["Twin A", "Twin B"]);
  });

  it("keeps Qloo's popularity and a bounded description for same-named candidates (Sprint 10D)", () => {
    const env = parseEnvelope(
      "describe",
      envelope("describe", "needs_input", {
        resolution: {
          issues: [{
            input: "Twin", kind: "ambiguous", input_kind: "entity", field: "entity",
            candidates: [
              { id: syntheticId(3), name: "Twin", type: "urn:entity:brand", popularity: 0.91, description: "SYNTHETIC first description." },
              { id: syntheticId(4), name: "Twin", type: "urn:entity:brand", description: "d".repeat(500) },
            ],
          }],
        },
      }),
    );
    const [issue] = toResolutionIssues("describe", env);
    expect(issue?.candidates[0]).toEqual({ qlooId: syntheticId(3), label: "Twin", type: "urn:entity:brand", popularity: 0.91, description: "SYNTHETIC first description." });
    expect(issue?.candidates[1]?.popularity).toBeUndefined();
    expect(issue?.candidates[1]?.description?.length).toBeLessThanOrEqual(201);
  });

  it("flags partial and degraded results in provenance and keeps warnings", () => {
    const partial = toProvenance("rank", parseEnvelope("rank", envelope("rank", "partial", { warnings: ["2 of 6 options missing"] })));
    expect(partial).toMatchObject({ partial: true, degraded: false, warnings: ["2 of 6 options missing"] });
    const degraded = toProvenance("rank", parseEnvelope("rank", envelope("rank", "degraded")));
    expect(degraded).toMatchObject({ partial: false, degraded: true });
  });
});

describe("opaque evidence sanitization", () => {
  it("drops bulky/identifying keys, bounds arrays and strings", () => {
    const sanitized = sanitizeForEvidence({
      description: "long text",
      image: { url: "x" },
      address: "1 Street",
      values: Array.from({ length: 50 }, (_, i) => i),
      note: "x".repeat(1000),
    }) as Record<string, unknown>;
    expect(sanitized).not.toHaveProperty("description");
    expect(sanitized).not.toHaveProperty("image");
    expect(sanitized).not.toHaveProperty("address");
    expect((sanitized.values as unknown[]).length).toBe(20);
    expect((sanitized.note as string).length).toBeLessThanOrEqual(301);
  });

  it("lists numeric field paths without interpreting them", () => {
    expect(numericFieldPaths({ a: 1, b: { c: [{ d: 2 }, { e: "x" }] } })).toEqual(["a", "b.c[].d"]);
  });
});
