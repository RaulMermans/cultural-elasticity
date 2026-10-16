/**
 * Profile coverage and top-N stability. Both measure the evidence representation (how rich it is,
 * how sensitive overlap is to the list cut-off). Neither measures brand elasticity or cultural truth.
 */
import type { ProfileCoverage, ProfileCoverageReport, StabilityReport, TopNPoint } from "@cultural-elasticity/shared";
import { allComparable } from "../evidence/comparability.js";
import { provenanceCoverage } from "../evidence/provenance.js";
import type { CulturalProfile, Limitation } from "../evidence/schema.js";
import { setOverlap } from "./overlap.js";

/** Probe sizes for sensitivity analysis. They are not methodology weights or thresholds. */
export const DEFAULT_TOP_N = [5, 10, 15, 20] as const;

export function profileCoverage(profile: CulturalProfile): ProfileCoverage {
  const total = profile.signals.length;
  const numeric = profile.signals.filter((signal) => signal.numeric !== undefined);
  const categories = new Set(profile.signals.flatMap((signal) => (signal.category === undefined ? [] : [signal.category])));
  const comparability = numeric.length === 0 ? null : allComparable(numeric.map((signal) => ({ numeric: signal.numeric!, provenance: signal.provenance })), "same_profile");

  return {
    totalSignals: total,
    rankedSignalCount: profile.signals.filter((signal) => signal.rank !== undefined).length,
    numericSignalCount: numeric.length,
    numericCoverage: total === 0 ? null : numeric.length / total,
    missingNumericRatio: total === 0 ? null : (total - numeric.length) / total,
    numericComparability: comparability === null ? "no_numeric_values" : comparability.comparable ? "comparable_within_profile" : "not_comparable",
    truncation: profile.truncated === undefined ? "unknown" : profile.truncated ? "truncated" : "not_truncated",
    provenance: provenanceCoverage(profile.signals),
    categoryCount: categories.size === 0 ? null : categories.size,
    uncategorizedSignalCount: profile.signals.filter((signal) => signal.category === undefined).length,
  };
}

export function profileCoverageReport(brand: CulturalProfile, target: CulturalProfile, sharedSignalCount: number): ProfileCoverageReport {
  return {
    brand: profileCoverage(brand),
    target: profileCoverage(target),
    sharedOfBrand: brand.signals.length === 0 ? null : sharedSignalCount / brand.signals.length,
    sharedOfTarget: target.signals.length === 0 ? null : sharedSignalCount / target.signals.length,
  };
}

/**
 * Overlap at several top-N cut-offs. A cut needs an order, and the only order trusted here is an
 * explicit rank. Numeric values are NOT used to order signals, because their direction is unknown.
 */
export function topNSensitivity(brand: CulturalProfile, target: CulturalProfile, ns: readonly number[] = DEFAULT_TOP_N): StabilityReport {
  if (ns.some((n) => !Number.isInteger(n) || n < 1)) throw new RangeError("top-N sizes must be positive integers");
  const sizes = [...new Set(ns)].sort((a, b) => a - b);

  const insufficient = (code: string, detail: string): StabilityReport => ({ status: "insufficient_evidence", points: [], summary: null, limitations: [{ code, detail }] });
  if (brand.signals.length === 0 || target.signals.length === 0) return insufficient("EMPTY_PROFILE", "top-N sensitivity needs two non-empty profiles");
  if (sizes.length === 0) return insufficient("NO_TOP_N_SIZES", "no top-N sizes were requested");
  for (const [role, profile] of [["brand", brand], ["target", target]] as const) {
    const unranked = profile.signals.filter((signal) => signal.rank === undefined).length;
    if (unranked > 0) return insufficient("UNRANKED_SIGNALS", `${unranked} ${role} signal(s) have no rank, so a top-N cut is undefined`);
  }

  const brandOrdered = ranked(brand);
  const targetOrdered = ranked(target);
  const points: TopNPoint[] = sizes.map((n) => {
    const b = brandOrdered.slice(0, n);
    const t = targetOrdered.slice(0, n);
    const sets = setOverlap(b, t);
    return {
      n,
      brandSignalsUsed: b.length,
      targetSignalsUsed: t.length,
      saturated: b.length < n || t.length < n,
      sharedCount: sets.sharedCount,
      jaccard: sets.jaccard as number,
      sharedIds: sets.sharedIds,
    };
  });

  const jaccards = points.map((point) => point.jaccard);
  const persistent = points.reduce<string[]>((acc, point) => acc.filter((id) => point.sharedIds.includes(id)), points[0]?.sharedIds ?? []);
  let changes = 0;
  for (let i = 1; i < points.length; i += 1) {
    if (points[i]!.sharedIds.join("\u0000") !== points[i - 1]!.sharedIds.join("\u0000")) changes += 1;
  }

  const limitations: Limitation[] = [];
  const saturatedAt = points.filter((point) => point.saturated).map((point) => point.n);
  if (saturatedAt.length > 0) limitations.push({ code: "TOP_N_SATURATED", detail: `a profile has fewer signals than N at N = ${saturatedAt.join(", ")}` });
  if (brand.truncated !== false || target.truncated !== false) {
    limitations.push({ code: "STABILITY_ON_PARTIAL_REPRESENTATION", detail: "stability describes sensitivity of the observed lists, which may be truncated" });
  }

  return {
    status: "available",
    points,
    summary: {
      jaccardMin: Math.min(...jaccards),
      jaccardMax: Math.max(...jaccards),
      jaccardRange: Math.max(...jaccards) - Math.min(...jaccards),
      persistentSharedIds: persistent,
      sharedSetChanges: changes,
    },
    limitations,
  };
}

function ranked(profile: CulturalProfile): string[] {
  return [...profile.signals].sort((a, b) => (a.rank as number) - (b.rank as number)).map((signal) => signal.id);
}
