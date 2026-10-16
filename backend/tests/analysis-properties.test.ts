/**
 * Property / invariant tests over seeded random SYNTHETIC packets. A small deterministic PRNG keeps
 * runs reproducible without adding a property-testing dependency.
 */
import { describe, expect, it } from "vitest";
import { analyzeEvidencePacket } from "../src/analysis/ingredients.js";
import { computeOverlap } from "../src/analysis/overlap.js";
import { findInvariantViolations } from "../src/analysis/validate.js";
import { normalizeEvidencePacket } from "../src/evidence/normalize.js";
import type { CulturalSignal, EvidencePacket, NumericEvidence } from "../src/evidence/schema.js";
import { packet, profile, ref } from "./fixtures/synthetic/evidence.js";

const RUNS = 200;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = ReturnType<typeof mulberry32>;
const int = (rng: Rng, max: number) => Math.floor(rng() * (max + 1));
const pick = <T,>(rng: Rng, items: readonly T[]) => items[int(rng, items.length - 1)] as T;

function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = int(rng, i);
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

const SCOPES: NumericEvidence["comparisonScope"][] = ["within_call", "within_profile", "cross_call_verified", "unknown"];

/** "consistent": every value is verified cross-call on one scale and non-negative, so weighted overlap can be available. */
type NumericRegime = "mixed" | "consistent";

function randomNumeric(rng: Rng, regime: NumericRegime): NumericEvidence {
  if (regime === "consistent") return { value: Math.round(rng() * 1000) / 1000, scale: "s1", comparisonScope: "cross_call_verified" };
  return { value: Math.round((rng() * 4 - 1) * 1000) / 1000, comparisonScope: pick(rng, SCOPES), ...(rng() < 0.6 && { scale: pick(rng, ["s1", "s2"]) }) };
}

function randomSignals(rng: Rng, role: string, regime: NumericRegime): CulturalSignal[] {
  const pool = Array.from({ length: 30 }, (_, i) => i + 1);
  const ids = shuffle(rng, pool).slice(0, int(rng, 25));
  const withRanks = rng() < 0.8;
  const signals = ids.map((n, i): CulturalSignal => {
    const numeric = rng() < 0.5 ? randomNumeric(rng, regime) : undefined;
    return {
      id: `syn-sig-${n}`,
      label: `Synthetic ${n}`,
      ...(rng() < 0.7 && { category: pick(rng, ["c1", "c2", "c3"]) }),
      ...(withRanks && { rank: i + 1 }),
      ...(numeric && { numeric }),
      provenance: rng() < 0.9 ? [ref(pick(rng, [`syn-corr-${role}`, "syn-corr-joint"]))] : [],
    };
  });
  // Inject exact duplicates (same id, same rank) to exercise normalization.
  const dup = signals[0];
  if (dup && rng() < 0.3) signals.push({ ...dup, provenance: [ref("syn-corr-dup")] });
  return signals;
}

function randomPacket(seed: number): EvidencePacket {
  const rng = mulberry32(seed);
  const regime: NumericRegime = rng() < 0.3 ? "consistent" : "mixed";
  return packet({
    brand: profile("brand", randomSignals(rng, "brand", regime), rng() < 0.5 ? { truncated: rng() < 0.5 } : { truncated: undefined }),
    target: profile("target", randomSignals(rng, "target", regime), rng() < 0.5 ? { truncated: rng() < 0.5 } : { truncated: undefined }),
  });
}

function reorder(p: EvidencePacket, seed: number): EvidencePacket {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const copy = structuredClone(p);
  copy.brand.signals = shuffle(rng, copy.brand.signals);
  copy.target.signals = shuffle(rng, copy.target.signals);
  return copy;
}

const seeds = Array.from({ length: RUNS }, (_, i) => i + 1);

describe("overlap invariants (property)", () => {
  it("Jaccard and overlap coefficient stay in [0,1]; intersection ≤ min; union ≥ max", () => {
    for (const seed of seeds) {
      const { packet: p } = normalizeEvidencePacket(randomPacket(seed));
      const o = computeOverlap(p.brand, p.target);
      const ctx = `seed ${seed}`;
      if (o.jaccard !== null) {
        expect(o.jaccard, ctx).toBeGreaterThanOrEqual(0);
        expect(o.jaccard, ctx).toBeLessThanOrEqual(1);
      }
      if (o.overlapCoefficient !== null) expect(o.overlapCoefficient, ctx).toBeLessThanOrEqual(1);
      expect(o.sharedSignalCount, ctx).toBeLessThanOrEqual(Math.min(o.brandSignalCount, o.targetSignalCount));
      expect(o.unionCount, ctx).toBeGreaterThanOrEqual(Math.max(o.brandSignalCount, o.targetSignalCount));
      const w = o.weightedSharedOverlap;
      if (w.value) expect(w.value.ratio, ctx).toBeLessThanOrEqual(1);
    }
  });

  it("reordering signals never changes the result", () => {
    for (const seed of seeds) {
      const p = randomPacket(seed);
      expect(JSON.stringify(analyzeEvidencePacket(reorder(p, seed))), `seed ${seed}`).toBe(JSON.stringify(analyzeEvidencePacket(p)));
    }
  });

  it("duplicate input signals normalize to the same result as deduplicated input", () => {
    for (const seed of seeds) {
      const p = randomPacket(seed);
      const doubled = structuredClone(p);
      doubled.brand.signals = [...p.brand.signals, ...p.brand.signals];
      doubled.target.signals = [...p.target.signals, ...p.target.signals];
      const a = analyzeEvidencePacket(p);
      const b = analyzeEvidencePacket(doubled);
      expect(b.overlap.sharedSignalCount, `seed ${seed}`).toBe(a.overlap.sharedSignalCount);
      expect(b.overlap.jaccard, `seed ${seed}`).toBe(a.overlap.jaccard);
      expect(b.distanceProxy, `seed ${seed}`).toEqual(a.distanceProxy);
    }
  });

  it("adding the same new signal to both profiles never reduces the shared count", () => {
    for (const seed of seeds) {
      const p = randomPacket(seed);
      const before = analyzeEvidencePacket(p).overlap.sharedSignalCount;
      const extra = (signals: CulturalSignal[]): CulturalSignal => ({
        id: "syn-sig-added",
        label: "Synthetic added",
        ...(signals.every((s) => s.rank !== undefined) && { rank: Math.max(0, ...signals.map((s) => s.rank ?? 0)) + 1 }),
        provenance: [ref("syn-corr-added")],
      });
      const grown = structuredClone(p);
      grown.brand.signals.push(extra(p.brand.signals));
      grown.target.signals.push(extra(p.target.signals));
      expect(analyzeEvidencePacket(grown).overlap.sharedSignalCount, `seed ${seed}`).toBe(before + 1);
    }
  });
});

describe("generator reach", () => {
  it("exercises every interesting branch, so the properties are not vacuous", () => {
    const seen = new Set<string>();
    for (const seed of seeds) {
      const p = randomPacket(seed);
      const r = analyzeEvidencePacket(p);
      seen.add(`weighted:${r.overlap.weightedSharedOverlap.status}`);
      seen.add(`overlap:${r.overlap.status}`);
      seen.add(`stability:${r.stability.status}`);
      seen.add(`quality:${r.evidenceQuality.overall.level}`);
      if (r.limitations.some((l) => l.code === "DUPLICATE_SIGNALS_MERGED")) seen.add("duplicates");
    }
    expect([...seen].sort()).toEqual(
      expect.arrayContaining([
        "duplicates",
        "overlap:available",
        "overlap:insufficient_evidence",
        "quality:LOW",
        "quality:MEDIUM",
        "stability:available",
        "stability:insufficient_evidence",
        "weighted:available",
        "weighted:insufficient_evidence",
        "weighted:not_comparable",
      ]),
    );
  });
});

describe("engine-wide invariants (property)", () => {
  it("no NaN/Infinity leaves the engine and every withheld ingredient stays null", () => {
    for (const seed of seeds) {
      const result = analyzeEvidencePacket(randomPacket(seed));
      expect(findInvariantViolations(result), `seed ${seed}`).toEqual([]);
      expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
    }
  });

  it("missing evidence never becomes zero", () => {
    for (const seed of seeds) {
      const p = randomPacket(seed);
      const result = analyzeEvidencePacket(p);
      // Absent optional evidence is unavailable/null, never a zero.
      expect(result.distanceProxy.audienceMetrics.value).toBeNull();
      expect(result.distanceProxy.bridgeSignalCount.value).toBeNull();
      expect(result.distanceProxy.relativeRankPercentile.value).toBeNull();
      if (p.brand.signals.length === 0 || p.target.signals.length === 0) {
        expect(result.distanceProxy.jaccardOverlap.value, `seed ${seed}`).toBeNull();
        expect(result.distanceProxy.sharedSignalCount.value, `seed ${seed}`).toBeNull();
      }
    }
  });

  it("weighted overlap is only available when every compared pair is comparable", () => {
    for (const seed of seeds) {
      const { packet: p } = normalizeEvidencePacket(randomPacket(seed));
      const o = computeOverlap(p.brand, p.target);
      if (o.weightedSharedOverlap.status !== "available") continue;
      const targetById = new Map(p.target.signals.map((s) => [s.id, s]));
      for (const b of p.brand.signals) {
        const t = targetById.get(b.id);
        if (!b.numeric || !t?.numeric) continue;
        // Never "unknown", never mixed scope, never mixed scale, never within_profile across profiles.
        expect(b.numeric.comparisonScope, `seed ${seed}`).not.toBe("unknown");
        expect(b.numeric.comparisonScope, `seed ${seed}`).not.toBe("within_profile");
        expect(b.numeric.comparisonScope).toBe(t.numeric.comparisonScope);
        expect(b.numeric.scale).toBe(t.numeric.scale);
      }
    }
  });
});
