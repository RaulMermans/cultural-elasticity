import { describe, expect, it } from "vitest";
import { assessEvidenceQuality } from "../src/evidence/quality.js";
import { packet, profile, ranked, ref, signal, verified } from "./fixtures/synthetic/evidence.js";

const codes = (q: ReturnType<typeof assessEvidenceQuality>) => q.limitations.map((l) => l.code);

describe("assessEvidenceQuality", () => {
  it("rates complete, confirmed, fully traced evidence HIGH without any percentage", () => {
    const q = assessEvidenceQuality(packet());
    expect(q.overall.level).toBe("HIGH");
    expect(q.indicators.resolution.level).toBe("good");
    expect(q.indicators.profileCoverage.level).toBe("good");
    expect(q.indicators.provenance.level).toBe("good");
    expect(JSON.stringify(q)).not.toMatch(/%|confidence/i);
  });

  it("does not lower the level for absent optional evidence", () => {
    const q = assessEvidenceQuality(packet());
    expect(q.indicators.audienceSemantics.level).toBe("unavailable");
    expect(q.indicators.bridgeEvidence.level).toBe("unavailable");
    expect(q.indicators.comparisonValidity.level).toBe("not_applicable");
    expect(q.overall.level).toBe("HIGH");
  });

  it("surfaces truncation and unknown truncation as limited coverage (MEDIUM)", () => {
    const q = assessEvidenceQuality(packet({ target: profile("target", ranked([1], "c"), { truncated: true }), brand: profile("brand", ranked([1], "c"), { truncated: undefined }) }));
    expect(q.indicators.profileCoverage.level).toBe("limited");
    expect(codes(q)).toEqual(expect.arrayContaining(["TARGET_PROFILE_TRUNCATED", "BRAND_TRUNCATION_UNKNOWN"]));
    expect(q.overall.level).toBe("MEDIUM");
    expect(q.overall.drivers).toEqual(["profileCoverage: limited"]);
  });

  it("rates an empty profile insufficient and the overall LOW", () => {
    const q = assessEvidenceQuality(packet({ target: profile("target", []) }));
    expect(q.indicators.profileCoverage.level).toBe("insufficient");
    expect(q.overall.level).toBe("LOW");
    expect(q.indicators.numericEvidence.level).toBe("unavailable");
  });

  it("distinguishes missing provenance (insufficient) from missing correlation ids (limited)", () => {
    const missing = assessEvidenceQuality(packet({ brand: profile("brand", [signal(1, { provenance: [] })]) }));
    expect(missing.indicators.provenance.level).toBe("insufficient");
    expect(codes(missing)).toContain("MISSING_PROVENANCE");
    const uncorrelated = assessEvidenceQuality(packet({ brand: profile("brand", [signal(1, { provenance: [ref()] })]) }));
    expect(uncorrelated.indicators.provenance.level).toBe("limited");
    expect(codes(uncorrelated)).toContain("MISSING_CORRELATION_ID");
  });

  it("flags unconfirmed resolution", () => {
    const base = packet();
    const q = assessEvidenceQuality({ ...base, target: { ...base.target, subject: { ...base.target.subject, resolution: "unconfirmed" } } });
    expect(q.indicators.resolution.level).toBe("limited");
    expect(codes(q)).toContain("TARGET_RESOLUTION_UNCONFIRMED");
  });

  it("reports refused comparisons and unverified ranking scope", () => {
    const q = assessEvidenceQuality(
      packet({
        brand: profile("brand", ranked([1], "c", () => ({ numeric: verified(1, "s1") }))),
        target: profile("target", ranked([1], "c", () => ({ numeric: verified(1, "s2") }))),
        ranking: { rankedAgainst: "syn-brand", comparisonScope: "unknown", candidates: [{ id: "x", label: "x", rank: 1, provenance: [ref("r")] }], provenance: [] },
      }),
    );
    expect(q.indicators.comparisonValidity.level).toBe("limited");
    expect(codes(q)).toEqual(expect.arrayContaining(["CROSS_PROFILE_VALUES_NOT_COMPARABLE", "RANKING_SCOPE_UNVERIFIED"]));
    // Present-but-refused evidence caps the level, even though every core indicator is good.
    expect(q.overall).toMatchObject({ level: "MEDIUM", drivers: ["comparisonValidity: limited"] });
  });

  it("rates audience with only opaque fields as limited semantics", () => {
    const q = assessEvidenceQuality(packet({ audience: { fields: { x: 1 }, interpretableMetrics: [], provenance: [ref("a")] } }));
    expect(q.indicators.audienceSemantics.level).toBe("limited");
  });
});
