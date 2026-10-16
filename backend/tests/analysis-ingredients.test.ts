import { describe, expect, it } from "vitest";
import { analyzeEvidencePacket } from "../src/analysis/ingredients.js";
import { AnalysisInvariantError, assertAnalysisInvariants, findInvariantViolations } from "../src/analysis/validate.js";
import { EvidenceValidationError } from "../src/evidence/schema.js";
import { packet, profile, ranked, signal } from "./fixtures/synthetic/evidence.js";

describe("analyzeEvidencePacket (pipeline)", () => {
  it("produces typed AnalysisIngredients with no score and an undefined distance formula", () => {
    const result = analyzeEvidencePacket(packet());
    expect(result.schemaVersion).toBe("ce-ingredients/0.1");
    expect(result.evidenceOrigin).toBe("synthetic");
    expect(result.distanceProxy.formula).toBe("NOT_DEFINED");
    expect(result.distanceProxy.jaccardOverlap).toMatchObject({ status: "available", value: 3 / 8 });
    expect(JSON.stringify(result)).not.toMatch(/"[^"]*(score|elasticity|confidence)[^"]*":/i);
  });

  it("rejects invalid input with structured issues", () => {
    expect(() => analyzeEvidencePacket({ schemaVersion: "nope" })).toThrow(EvidenceValidationError);
    try {
      analyzeEvidencePacket({ ...packet(), origin: "made-up" });
    } catch (error) {
      expect((error as EvidenceValidationError).issues[0]?.path).toBe("origin");
    }
  });

  it("propagates provenance from source observations to derived ingredients", () => {
    const result = analyzeEvidencePacket(
      packet({ brand: profile("brand", ranked([1, 2], "syn-corr-b")), target: profile("target", ranked([2, 3], "syn-corr-t")) }),
    );
    const shared = result.overlap.shared[0]!;
    expect(shared.id).toBe("syn-sig-002");
    expect(shared.provenance.map((p) => p.correlationId)).toEqual(["syn-corr-b", "syn-corr-t"]);
    const ingredientCalls = result.distanceProxy.jaccardOverlap.provenance.map((p) => p.correlationId);
    expect(ingredientCalls).toEqual(expect.arrayContaining(["syn-corr-b", "syn-corr-t"]));
    expect(result.provenance.map((p) => p.correlationId)).toEqual(expect.arrayContaining(["syn-corr-b", "syn-corr-t", "syn-corr-packet"]));
    // Compact references only: no raw payloads ride along.
    for (const p of result.provenance) expect(Object.keys(p).every((key) => ["source", "operation", "correlationId", "capturedAt"].includes(key))).toBe(true);
  });

  it("keeps missing evidence null in every withheld ingredient", () => {
    const result = analyzeEvidencePacket(packet({ target: profile("target", []) }));
    const withheld = Object.entries(result.distanceProxy).filter(([key]) => key !== "formula").map(([, v]) => v as { status: string; value: unknown });
    expect(withheld.every((i) => i.status === "available" || i.value === null)).toBe(true);
    expect(result.distanceProxy.sharedSignalCount).toMatchObject({ status: "insufficient_evidence", value: null });
  });

  it("merges provider, normalization and quality limitations without duplicates", () => {
    const result = analyzeEvidencePacket(
      packet({
        brand: profile("brand", [signal(1), signal(1)], { truncated: true }),
        limitations: [{ code: "SYN_PROVIDER_NOTE", detail: "synthetic provider-side limitation" }],
      }),
    );
    const codes = result.limitations.map((l) => l.code);
    expect(codes).toEqual(expect.arrayContaining(["SYN_PROVIDER_NOTE", "DUPLICATE_SIGNALS_MERGED", "BRAND_PROFILE_TRUNCATED"]));
    const keys = result.limitations.map((l) => `${l.code}|${l.detail}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("output invariants", () => {
  const good = () => analyzeEvidencePacket(packet());

  it("accepts engine output", () => {
    expect(findInvariantViolations(good())).toEqual([]);
  });

  it("catches NaN, out-of-range ratios, inconsistent counts, zeroed missing evidence and forbidden keys", () => {
    const bad = structuredClone(good());
    bad.overlap.jaccard = Number.NaN;
    bad.overlap.overlapCoefficient = 1.5;
    bad.overlap.sharedSignalCount = 99;
    bad.distanceProxy.bridgeSignalCount = { value: 0, status: "unavailable", provenance: [], limitations: [] };
    (bad as unknown as Record<string, unknown>).elasticityScore = 87;
    const messages = findInvariantViolations(bad).map((v) => `${v.path}: ${v.message}`);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/overlap\.jaccard: non-finite/),
        expect.stringMatching(/overlapCoefficient: ratio 1\.5/),
        expect.stringMatching(/sharedSignalCount: shared count exceeds/),
        expect.stringMatching(/bridgeSignalCount: unavailable ingredient carries a value/),
        expect.stringMatching(/elasticityScore: this sprint must not emit/),
      ]),
    );
    expect(() => assertAnalysisInvariants(bad)).toThrow(AnalysisInvariantError);
  });

  it("catches an available ingredient with no value", () => {
    const bad = structuredClone(good());
    bad.distanceProxy.jaccardOverlap.value = null;
    expect(findInvariantViolations(bad).map((v) => v.message)).toContain("available ingredient has a null value");
  });
});

describe("provider independence", () => {
  it("accepts any provider name in provenance; the engine has no Qloo knowledge", () => {
    const other = packet({ provenance: [{ source: "synthetic-other-provider", operation: "anything", correlationId: "x" }] });
    expect(analyzeEvidencePacket(other).provenance.some((p) => p.source === "synthetic-other-provider")).toBe(true);
  });

  it("does not reference Qloo in the engine source", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    for (const dir of ["../src/evidence", "../src/analysis"]) {
      const abs = fileURLToPath(new URL(dir, import.meta.url));
      for (const file of readdirSync(abs)) {
        const source = readFileSync(join(abs, file), "utf8");
        expect(source, `${dir}/${file}`).not.toMatch(/from "\.\.\/qloo|from "\.\.\/contracts|child_process|fastify/);
      }
    }
  });
});

