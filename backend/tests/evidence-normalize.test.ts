import { describe, expect, it } from "vitest";
import { normalizeEvidencePacket } from "../src/evidence/normalize.js";
import { mergeProvenance } from "../src/evidence/provenance.js";
import { packet, profile, ref, signal, verified } from "./fixtures/synthetic/evidence.js";

describe("normalizeEvidencePacket", () => {
  it("merges duplicate signals: lowest rank, unioned provenance, one limitation", () => {
    const input = packet({
      brand: profile("brand", [signal(1, { rank: 3, corr: "call-b" }), signal(2, { rank: 1 }), signal(1, { rank: 2, corr: "call-a" })]),
    });
    const { packet: out, limitations } = normalizeEvidencePacket(input);
    const merged = out.brand.signals.find((s) => s.id === "syn-sig-001");
    expect(merged?.rank).toBe(2);
    expect(merged?.provenance.map((p) => p.correlationId)).toEqual(["call-a", "call-b"]);
    expect(out.brand.signals).toHaveLength(2);
    expect(limitations.map((l) => l.code)).toEqual(["DUPLICATE_SIGNALS_MERGED"]);
  });

  it("drops a conflicting value or category to unknown instead of picking one", () => {
    const input = packet({
      brand: profile("brand", [
        signal(1, { rank: 1, numeric: verified(0.4), category: "syn-a" }),
        signal(1, { rank: 1, numeric: verified(0.9), category: "syn-b" }),
      ]),
    });
    const { packet: out, limitations } = normalizeEvidencePacket(input);
    expect(out.brand.signals[0]?.numeric).toBeUndefined();
    expect(out.brand.signals[0]?.category).toBeUndefined();
    expect(limitations.map((l) => l.code).sort()).toEqual(["DUPLICATE_SIGNALS_MERGED", "SIGNAL_CATEGORY_CONFLICT", "SIGNAL_VALUE_CONFLICT"]);
  });

  it("keeps a value present on only one duplicate", () => {
    const input = packet({ brand: profile("brand", [signal(1, { rank: 1 }), signal(1, { rank: 1, numeric: verified(0.5) })]) });
    expect(normalizeEvidencePacket(input).packet.brand.signals[0]?.numeric?.value).toBe(0.5);
  });

  it("is independent of input order", () => {
    const signals = [signal(3, { rank: 2 }), signal(1, { rank: null }), signal(2, { rank: 1 }), signal(3, { rank: 2, corr: "x" })];
    const forward = normalizeEvidencePacket(packet({ brand: profile("brand", signals) }));
    const backward = normalizeEvidencePacket(packet({ brand: profile("brand", [...signals].reverse()) }));
    expect(backward).toEqual(forward);
    expect(forward.packet.brand.signals.map((s) => s.id)).toEqual(["syn-sig-002", "syn-sig-003", "syn-sig-001"]);
  });

  it("orders ranking candidates by id, never merging rank order before scope is verified", () => {
    const input = packet({
      ranking: {
        rankedAgainst: "syn-brand",
        comparisonScope: "unknown",
        candidates: [
          { id: "c-b", label: "b", rank: 1, provenance: [ref("r1")] },
          { id: "c-a", label: "a", rank: 2, provenance: [ref("r2")] },
        ],
        provenance: [],
      },
    });
    expect(normalizeEvidencePacket(input).packet.ranking?.candidates.map((c) => c.id)).toEqual(["c-a", "c-b"]);
  });
});

describe("mergeProvenance", () => {
  it("dedupes, sorts and strips nothing but duplicates", () => {
    const merged = mergeProvenance([ref("b"), ref("a")], [ref("a"), { source: "synthetic-test", operation: "profile" }]);
    expect(merged).toEqual([{ source: "synthetic-test", operation: "profile" }, ref("a"), ref("b")]);
  });
});
