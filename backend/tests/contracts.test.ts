import { describe, expect, it } from "vitest";
import { bridgeEvidenceSchema, evidencePacketSchema, resolvedConceptSchema, type ProvenanceRef } from "../src/contracts/qloo.js";

const provenance: ProvenanceRef = { operation: "describe", correlationId: "c-1", status: "ok", warnings: [], degraded: false, partial: false };
const concept = {
  kind: "entity",
  input: "Example",
  label: "Example",
  qlooId: "00000000-0000-4000-8000-000000000001",
  confirmation: "unambiguous",
  alternatives: [],
  provenance: [provenance],
} as const;

const minimalPacket = {
  schemaVersion: "0.1",
  generatedAt: "2026-10-16T00:00:00.000Z",
  evidenceSource: "fixture",
  harness: { version: "0.1.26", contractChecksum: "sha256:x" },
  brand: { subjects: [concept], tags: [], provenance: [provenance] },
  target: { representation: { label: "T", tagCandidates: [], exemplars: [], exemplarMethod: "none" } },
  limitations: [],
  provenance: [provenance],
};

describe("evidence contracts", () => {
  it("accepts a minimal valid packet", () => {
    expect(evidencePacketSchema.safeParse(minimalPacket).success).toBe(true);
  });

  it("rejects an invented Elasticity score (strict schema)", () => {
    expect(evidencePacketSchema.safeParse({ ...minimalPacket, elasticityScore: 0.82 }).success).toBe(false);
  });

  it("rejects a calibrated-looking confidence on a resolved concept", () => {
    expect(resolvedConceptSchema.safeParse({ ...concept, confidence: 0.97 }).success).toBe(false);
  });

  it("requires an explicit evidence source", () => {
    const { evidenceSource: _omitted, ...rest } = minimalPacket;
    expect(evidencePacketSchema.safeParse(rest).success).toBe(false);
    expect(evidencePacketSchema.safeParse({ ...minimalPacket, evidenceSource: "mocked-but-looks-live" }).success).toBe(false);
  });

  it("requires provenance on a resolved concept", () => {
    const { provenance: _omitted, ...rest } = concept;
    expect(resolvedConceptSchema.safeParse(rest).success).toBe(false);
  });

  it("only allows the non-path bridge semantics and bounded overlap", () => {
    const bridge = {
      semantics: "qloo_supported_intermediate_cultural_signals",
      from: concept,
      toLabel: "T",
      toExemplars: [concept],
      sharedTags: [],
      jointTags: [],
      overlap: { brandTopN: 0, targetTopN: 0, sharedCount: 0, jaccard: null },
      provenance: [],
    };
    expect(bridgeEvidenceSchema.safeParse(bridge).success).toBe(true);
    expect(bridgeEvidenceSchema.safeParse({ ...bridge, semantics: "graph_path" }).success).toBe(false);
    expect(bridgeEvidenceSchema.safeParse({ ...bridge, overlap: { ...bridge.overlap, jaccard: 1.4 } }).success).toBe(false);
  });
});
