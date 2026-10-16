/**
 * Observed cultural overlap between two profiles.
 *
 * Set measures (Jaccard, overlap coefficient) describe the observed, possibly truncated, signal
 * lists. They are not a distance and not a probability. Both need non-empty profiles. An empty
 * profile gives `insufficient_evidence`, never an overlap of 0.
 *
 * The weighted measure compares values only where the comparability model allows it, and only for
 * signals present on BOTH sides. A signal missing from one profile is unknown on that side, not zero.
 */
import type { OverlapReport, SharedSignal, WeightedSharedOverlap } from "@cultural-elasticity/shared";
import { compareNumeric } from "../evidence/comparability.js";
import { mergeProvenance } from "../evidence/provenance.js";
import type { CulturalProfile, CulturalSignal, Limitation } from "../evidence/schema.js";
import { available, withheld } from "./ingredient.js";

export type SetOverlap = {
  sharedIds: string[];
  sharedCount: number;
  unionCount: number;
  jaccard: number | null;
  overlapCoefficient: number | null;
};

/** Pure set arithmetic on ids. Ratios are null when either side is empty. */
export function setOverlap(brandIds: Iterable<string>, targetIds: Iterable<string>): SetOverlap {
  const a = new Set(brandIds);
  const b = new Set(targetIds);
  const sharedIds = [...a].filter((id) => b.has(id)).sort();
  const unionCount = new Set([...a, ...b]).size;
  const bothNonEmpty = a.size > 0 && b.size > 0;
  return {
    sharedIds,
    sharedCount: sharedIds.length,
    unionCount,
    jaccard: bothNonEmpty ? sharedIds.length / unionCount : null,
    overlapCoefficient: bothNonEmpty ? sharedIds.length / Math.min(a.size, b.size) : null,
  };
}

export function profileProvenance(profile: CulturalProfile) {
  return mergeProvenance(profile.provenance, profile.subject.provenance, ...profile.signals.map((signal) => signal.provenance));
}

/** Expects normalized profiles (unique signal ids). */
export function computeOverlap(brand: CulturalProfile, target: CulturalProfile): OverlapReport {
  const brandById = new Map(brand.signals.map((signal) => [signal.id, signal]));
  const targetById = new Map(target.signals.map((signal) => [signal.id, signal]));
  const sets = setOverlap(brandById.keys(), targetById.keys());
  const provenance = mergeProvenance(profileProvenance(brand), profileProvenance(target));

  const pairs = sets.sharedIds.map((id) => [brandById.get(id), targetById.get(id)] as [CulturalSignal, CulturalSignal]);
  const shared: SharedSignal[] = pairs.map(([b, t]) => ({
    id: b.id,
    label: b.label,
    ...((b.category ?? t.category) !== undefined && { category: (b.category ?? t.category) as string }),
    ...(b.rank !== undefined && { brandRank: b.rank }),
    ...(t.rank !== undefined && { targetRank: t.rank }),
    provenance: mergeProvenance(b.provenance, t.provenance),
  }));

  const limitations: Limitation[] = [];
  if (brand.signals.length === 0) limitations.push({ code: "BRAND_PROFILE_EMPTY", detail: "brand profile has no signals; overlap ratios are not computed" });
  if (target.signals.length === 0) limitations.push({ code: "TARGET_PROFILE_EMPTY", detail: "target profile has no signals; overlap ratios are not computed" });
  limitations.push(...truncationLimitations(brand, target));

  return {
    status: sets.jaccard === null ? "insufficient_evidence" : "available",
    brandSignalCount: brand.signals.length,
    targetSignalCount: target.signals.length,
    sharedSignalCount: sets.sharedCount,
    unionCount: sets.unionCount,
    jaccard: sets.jaccard,
    overlapCoefficient: sets.overlapCoefficient,
    shared,
    uniqueToBrand: brand.signals.filter((signal) => !targetById.has(signal.id)),
    uniqueToTarget: target.signals.filter((signal) => !brandById.has(signal.id)),
    weightedSharedOverlap: weightedSharedOverlap(pairs),
    provenance,
    limitations,
  };
}

export function truncationLimitations(brand: CulturalProfile, target: CulturalProfile): Limitation[] {
  return [["brand", brand], ["target", target]].flatMap(([role, profile]) =>
    (profile as CulturalProfile).truncated === true
      ? [{ code: `${(role as string).toUpperCase()}_PROFILE_TRUNCATED`, detail: `computed on a truncated ${role} profile (observed top-N representation only)` }]
      : [],
  );
}

/** Σ min(a, b) / Σ max(a, b) over shared signals whose brand and target values are comparable. */
export function weightedSharedOverlap(pairs: readonly (readonly [CulturalSignal, CulturalSignal])[]) {
  if (pairs.length === 0) return withheld<WeightedSharedOverlap>("insufficient_evidence", [{ code: "NO_SHARED_SIGNALS", detail: "no shared signals to weight" }]);

  const valued = pairs.filter(([b, t]) => b.numeric !== undefined && t.numeric !== undefined);
  if (valued.length === 0) {
    return withheld<WeightedSharedOverlap>("insufficient_evidence", [{ code: "NO_SHARED_NUMERIC_VALUES", detail: "no shared signal carries a value on both sides" }]);
  }
  for (const [b, t] of valued) {
    const check = compareNumeric({ numeric: b.numeric!, provenance: b.provenance }, { numeric: t.numeric!, provenance: t.provenance }, "cross_profile");
    if (!check.comparable) {
      return withheld<WeightedSharedOverlap>("not_comparable", [{ code: "VALUES_NOT_COMPARABLE", detail: `signal "${b.id}": ${check.reason}` }]);
    }
    if (b.numeric!.value < 0 || t.numeric!.value < 0) {
      return withheld<WeightedSharedOverlap>("not_comparable", [{ code: "NEGATIVE_VALUES", detail: `signal "${b.id}" has a negative value; a min/max ratio is undefined` }]);
    }
  }

  let sumMin = 0;
  let sumMax = 0;
  for (const [b, t] of valued) {
    sumMin += Math.min(b.numeric!.value, t.numeric!.value);
    sumMax += Math.max(b.numeric!.value, t.numeric!.value);
  }
  if (sumMax === 0) return withheld<WeightedSharedOverlap>("insufficient_evidence", [{ code: "ALL_VALUES_ZERO", detail: "all compared values are zero; the ratio is undefined" }]);

  const limitations: Limitation[] = [];
  if (valued.length < pairs.length) {
    limitations.push({ code: "PARTIAL_NUMERIC_COVERAGE", detail: `computed on ${valued.length} of ${pairs.length} shared signals that carry values on both sides` });
  }
  return available<WeightedSharedOverlap>(
    { ratio: sumMin / sumMax, comparedSignalCount: valued.length, basis: "shared_signals_only" },
    mergeProvenance(...valued.flatMap(([b, t]) => [b.provenance, t.provenance])),
    limitations,
  );
}
