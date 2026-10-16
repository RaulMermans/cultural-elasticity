/**
 * Cultural Coherence: which cultural signals appear on both sides?
 *
 * Set membership ONLY. Tag affinities are saturated [live: range 0.001 across Jacquemus's top 20] and
 * come from separate calls, so they never weight anything here; only signal ids are read. Computed
 * per exemplar (brand profile vs that exemplar's profile, both at the same fixed take), in a RAW view
 * and a CULTURAL_FILTERED view. Coherence is explanatory and diagnostic: it is NOT the candidate
 * position and is not used to classify a territory, so rank evidence is never counted twice.
 */
import type { CoherenceBand, CoherenceExemplar, CoherenceView } from "@cultural-elasticity/shared";
import { mergeProvenance } from "../evidence/provenance.js";
import type { CulturalProfile } from "../evidence/schema.js";
import { setOverlap } from "../analysis/overlap.js";
import { compareStrings, median, round } from "./stats.js";

export const COHERENCE_BAND_RULE =
  "Descriptive band of the median shared-signal count across exemplars: 0 NONE, 1–2 SPARSE, 3–5 SOME, ≥ 6 SUBSTANTIAL. Not calibrated; never used in classification.";

export type ExemplarRef = { id: string; label: string };

const view = (signal: { id: string; label: string }) => ({ id: signal.id, label: signal.label });

export function exemplarCoherence(brand: CulturalProfile, exemplar: ExemplarRef, profile: CulturalProfile | undefined): CoherenceExemplar {
  if (profile === undefined) {
    return {
      exemplarId: exemplar.id,
      exemplarLabel: exemplar.label,
      status: "unavailable",
      brandSignalCount: null,
      targetSignalCount: null,
      sharedCount: null,
      unionCount: null,
      jaccard: null,
      overlapCoefficient: null,
      shared: [],
      brandOnly: [],
      targetOnly: [],
      provenance: [],
    };
  }
  const brandIds = new Set(brand.signals.map((s) => s.id));
  const targetIds = new Set(profile.signals.map((s) => s.id));
  const sets = setOverlap(brandIds, targetIds);
  const bothNonEmpty = sets.jaccard !== null;
  const byId = (a: { id: string }, b: { id: string }) => compareStrings(a.id, b.id);
  return {
    exemplarId: exemplar.id,
    exemplarLabel: exemplar.label,
    status: bothNonEmpty ? "available" : "insufficient_evidence",
    brandSignalCount: brandIds.size,
    targetSignalCount: targetIds.size,
    sharedCount: sets.sharedCount,
    unionCount: sets.unionCount,
    jaccard: sets.jaccard === null ? null : round(sets.jaccard),
    overlapCoefficient: sets.overlapCoefficient === null ? null : round(sets.overlapCoefficient),
    shared: brand.signals.filter((s) => targetIds.has(s.id)).map(view).sort(byId),
    brandOnly: brand.signals.filter((s) => !targetIds.has(s.id)).map(view).sort(byId),
    targetOnly: profile.signals.filter((s) => !brandIds.has(s.id)).map(view).sort(byId),
    provenance: mergeProvenance(...brand.signals.map((s) => s.provenance), ...profile.signals.map((s) => s.provenance), profile.provenance),
  };
}

export function coherenceBand(medianShared: number): CoherenceBand {
  if (medianShared === 0) return "NONE";
  if (medianShared <= 2) return "SPARSE";
  if (medianShared <= 5) return "SOME";
  return "SUBSTANTIAL";
}

export function coherenceView(
  kind: CoherenceView["view"],
  brand: CulturalProfile,
  exemplars: readonly { exemplar: ExemplarRef; profile: CulturalProfile | undefined }[],
  policyVersion: string | null,
): CoherenceView {
  const perExemplar = exemplars.map(({ exemplar, profile }) => exemplarCoherence(brand, exemplar, profile)).sort((a, b) => compareStrings(a.exemplarId, b.exemplarId));
  const compared = perExemplar.filter((e) => e.status === "available");
  if (compared.length === 0) {
    return { view: kind, policyVersion, status: "insufficient_evidence", perExemplar, summary: null, band: null, bandRule: COHERENCE_BAND_RULE };
  }
  const shared = compared.map((e) => e.sharedCount as number);
  const counts = new Map<string, { id: string; label: string; exemplarCount: number }>();
  for (const e of compared) for (const s of e.shared) counts.set(s.id, { ...s, exemplarCount: (counts.get(s.id)?.exemplarCount ?? 0) + 1 });
  const half = Math.ceil(compared.length / 2);
  const sharedMedian = median(shared);
  return {
    view: kind,
    policyVersion,
    status: "available",
    perExemplar,
    summary: {
      exemplarsCompared: compared.length,
      sharedCountMin: Math.min(...shared),
      sharedCountMedian: sharedMedian,
      sharedCountMax: Math.max(...shared),
      jaccardMedian: median(compared.map((e) => e.jaccard as number)),
      consistentlyShared: [...counts.values()].filter((c) => c.exemplarCount >= half).sort((a, b) => b.exemplarCount - a.exemplarCount || compareStrings(a.id, b.id)),
    },
    band: coherenceBand(sharedMedian),
    bandRule: COHERENCE_BAND_RULE,
  };
}
