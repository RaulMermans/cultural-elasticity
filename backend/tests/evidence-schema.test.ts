import { describe, expect, it } from "vitest";
import { evidencePacketSchema, parseEvidencePacket } from "../src/evidence/schema.js";
import { packet, profile, ranked, ref, signal } from "./fixtures/synthetic/evidence.js";

const issuesFor = (input: unknown) => {
  const result = parseEvidencePacket(input);
  if (result.ok) throw new Error("expected the packet to be rejected");
  return result.issues;
};

describe("EvidencePacket schema", () => {
  it("accepts a well-formed packet", () => {
    expect(parseEvidencePacket(packet()).ok).toBe(true);
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("rejects %s numeric values", (_label, value) => {
    const bad = packet({ brand: profile("brand", [signal(1, { numeric: { value, comparisonScope: "unknown" } })]) });
    expect(issuesFor(bad)[0]?.path).toContain("numeric.value");
  });

  it.each([0, -1, 1.5])("rejects invalid rank %s", (rank) => {
    const bad = packet({ brand: profile("brand", [signal(1, { rank })]) });
    expect(issuesFor(bad)[0]?.path).toMatch(/signals\.0\.rank/);
  });

  it("rejects two different signals sharing a rank", () => {
    const bad = packet({ brand: profile("brand", [signal(1, { rank: 1 }), signal(2, { rank: 1 })]) });
    expect(issuesFor(bad)[0]?.message).toMatch(/rank 1 is used by both/);
  });

  it("allows the same signal id more than once (normalization merges it)", () => {
    const dup = packet({ brand: profile("brand", [signal(1, { rank: 1 }), signal(1, { rank: 1 })]) });
    expect(parseEvidencePacket(dup).ok).toBe(true);
  });

  it.each(["", "   "])("rejects empty identifier %j", (id) => {
    const bad = packet({ brand: profile("brand", [{ ...signal(1), id }]) });
    expect(issuesFor(bad)[0]?.path).toBe("brand.signals.0.id");
  });

  it("rejects malformed provenance", () => {
    const missingOperation = packet({ provenance: [{ source: "synthetic-test" } as never] });
    const badTimestamp = packet({ provenance: [{ ...ref("c"), capturedAt: "yesterday" }] });
    const extraKey = packet({ provenance: [{ ...ref("c"), payload: { raw: true } } as never] });
    const emptyCorrelation = packet({ provenance: [{ ...ref(), correlationId: "" }] });
    for (const bad of [missingOperation, badTimestamp, extraKey, emptyCorrelation]) expect(issuesFor(bad)[0]?.path).toMatch(/^provenance\.0/);
  });

  it("rejects brand and target being the same subject", () => {
    const base = packet();
    const bad = { ...base, target: { ...base.target, subject: { ...base.target.subject, id: base.brand.subject.id } } };
    expect(issuesFor(bad)[0]?.message).toMatch(/different subjects/);
  });

  it("rejects unknown fields instead of carrying them", () => {
    expect(issuesFor({ ...packet(), elasticityScore: 87 })[0]?.message).toMatch(/Unrecognized key/);
  });

  it("preserves numbers of unknown scale without range enforcement", () => {
    const odd = packet({ brand: profile("brand", [signal(1, { numeric: { value: -340.5, comparisonScope: "unknown" } }), signal(2, { numeric: { value: 9001, scale: "syn-opaque", comparisonScope: "within_call" } })]) });
    const result = parseEvidencePacket(odd);
    expect(result.ok && result.packet.brand.signals.map((s) => s.numeric?.value)).toEqual([-340.5, 9001]);
  });

  describe("audience evidence", () => {
    const metric = { id: "syn-m", label: "Synthetic metric", value: 0.4, direction: "higher_is_closer" as const, comparisonScope: "within_call" as const, provenance: [ref("a")] };

    it("enforces a declared scale, and only a declared one", () => {
      expect(issuesFor(packet({ audience: { fields: {}, interpretableMetrics: [{ ...metric, value: 1.2, scale: { min: 0, max: 1 } }], provenance: [] } }))[0]?.message).toMatch(/above the declared scale.max/);
      expect(issuesFor(packet({ audience: { fields: {}, interpretableMetrics: [{ ...metric, scale: { min: 2, max: 1 } }], provenance: [] } }))[0]?.message).toMatch(/min must not exceed/);
      expect(parseEvidencePacket(packet({ audience: { fields: {}, interpretableMetrics: [{ ...metric, value: 42 }], provenance: [] } })).ok).toBe(true);
    });

    it("rejects duplicate metric ids and non-finite opaque fields", () => {
      expect(issuesFor(packet({ audience: { fields: {}, interpretableMetrics: [metric, metric], provenance: [] } }))[0]?.message).toMatch(/duplicate metric id/);
      expect(issuesFor(packet({ audience: { fields: { nested: { x: Number.NaN } }, interpretableMetrics: [], provenance: [] } })).length).toBeGreaterThan(0);
    });
  });

  describe("ranking evidence", () => {
    const candidate = (id: string, rank?: number) => ({ id, label: id, ...(rank !== undefined && { rank }), provenance: [ref("r")] });

    it("rejects duplicate candidates, shared ranks and an unknown target", () => {
      const base = { rankedAgainst: "syn-brand", comparisonScope: "single_call" as const, provenance: [] };
      expect(issuesFor(packet({ ranking: { ...base, candidates: [candidate("x", 1), candidate("x", 2)] } }))[0]?.message).toMatch(/duplicate candidate/);
      expect(issuesFor(packet({ ranking: { ...base, candidates: [candidate("x", 1), candidate("y", 1)] } }))[0]?.message).toMatch(/rank 1/);
      expect(issuesFor(packet({ ranking: { ...base, targetCandidateId: "z", candidates: [candidate("x", 1)] } }))[0]?.path).toBe("ranking.targetCandidateId");
      expect(issuesFor(packet({ ranking: { ...base, candidates: [] } }))[0]?.path).toBe("ranking.candidates");
    });
  });

  it("rejects malformed limitation codes", () => {
    expect(issuesFor(packet({ limitations: [{ code: "not upper", detail: "x" }] }))[0]?.path).toBe("limitations.0.code");
  });

  it("trims identifiers deterministically", () => {
    const parsed = evidencePacketSchema.parse(packet({ brand: profile("brand", [{ ...signal(1), id: "  syn-sig-001  " }]) }));
    expect(parsed.brand.signals[0]?.id).toBe("syn-sig-001");
  });

  it("requires origin so synthetic packets cannot pass as live by omission", () => {
    const { origin: _origin, ...withoutOrigin } = packet();
    expect(issuesFor(withoutOrigin)[0]?.path).toBe("origin");
  });

  it("builds a reference packet for other tests", () => {
    expect(ranked([1, 2], "c").map((s) => s.rank)).toEqual([1, 2]);
  });
});
