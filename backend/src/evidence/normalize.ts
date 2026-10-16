/**
 * Deterministic normalization of a validated EvidencePacket.
 *
 * After normalization the packet's content no longer depends on input order:
 *   - duplicate signals (same id within one list) are merged: lowest rank wins, provenance is unioned,
 *     and a conflicting value or category is dropped (unknown) rather than chosen arbitrarily;
 *   - signals are sorted by rank (unranked last), then id;
 *   - ranking candidates are sorted by id. Rank order is applied later, and only if the ranking's
 *     single-call scope is verified;
 *   - provenance lists are deduplicated and sorted.
 *
 * Normalization never invents values. Every change it makes is reported as an engine limitation.
 */
import { mergeProvenance } from "./provenance.js";
import type { CulturalProfile, CulturalSignal, EvidencePacket, Limitation, NumericEvidence } from "./schema.js";

export type NormalizedEvidence = {
  packet: EvidencePacket;
  /** Produced by the engine, kept apart from the packet's own (provider-side) limitations. */
  limitations: Limitation[];
};

export function normalizeEvidencePacket(packet: EvidencePacket): NormalizedEvidence {
  const limitations: Limitation[] = [];
  const brand = normalizeProfile(packet.brand, "brand profile", limitations);
  const target = normalizeProfile(packet.target, "target profile", limitations);

  const normalized: EvidencePacket = {
    schemaVersion: packet.schemaVersion,
    origin: packet.origin,
    brand,
    target,
    limitations: packet.limitations.map((limitation) => ({ ...limitation })),
    provenance: mergeProvenance(packet.provenance),
  };
  if (packet.audience !== undefined) {
    normalized.audience = {
      fields: packet.audience.fields,
      interpretableMetrics: [...packet.audience.interpretableMetrics]
        .sort((a, b) => compareStrings(a.id, b.id))
        .map((metric) => ({ ...metric, provenance: mergeProvenance(metric.provenance) })),
      provenance: mergeProvenance(packet.audience.provenance),
    };
  }
  if (packet.ranking !== undefined) {
    normalized.ranking = {
      ...packet.ranking,
      candidates: [...packet.ranking.candidates]
        .sort((a, b) => compareStrings(a.id, b.id))
        .map((candidate) => ({ ...candidate, provenance: mergeProvenance(candidate.provenance) })),
      provenance: mergeProvenance(packet.ranking.provenance),
    };
  }
  if (packet.bridges !== undefined) {
    normalized.bridges = packet.bridges.map((bridge, index) => ({
      semantics: bridge.semantics,
      signals: normalizeSignals(bridge.signals, `bridge evidence #${index + 1} (${bridge.semantics})`, limitations),
      provenance: mergeProvenance(bridge.provenance),
    }));
  }
  return { packet: normalized, limitations };
}

function normalizeProfile(profile: CulturalProfile, context: string, limitations: Limitation[]): CulturalProfile {
  return {
    subject: { ...profile.subject, provenance: mergeProvenance(profile.subject.provenance) },
    signals: normalizeSignals(profile.signals, context, limitations),
    ...(profile.truncated !== undefined && { truncated: profile.truncated }),
    provenance: mergeProvenance(profile.provenance),
  };
}

export function normalizeSignals(signals: readonly CulturalSignal[], context: string, limitations: Limitation[]): CulturalSignal[] {
  const groups = new Map<string, CulturalSignal[]>();
  for (const signal of signals) {
    const group = groups.get(signal.id);
    if (group) group.push(signal);
    else groups.set(signal.id, [signal]);
  }

  const merged: CulturalSignal[] = [];
  const duplicateIds: string[] = [];
  for (const [id, group] of groups) {
    if (group.length === 1) {
      const [only] = group as [CulturalSignal];
      merged.push({ ...only, provenance: mergeProvenance(only.provenance) });
      continue;
    }
    duplicateIds.push(id);
    merged.push(mergeDuplicates(id, group, context, limitations));
  }
  if (duplicateIds.length > 0) {
    duplicateIds.sort(compareStrings);
    limitations.push({
      code: "DUPLICATE_SIGNALS_MERGED",
      detail: `${context}: duplicate entries merged for ${duplicateIds.length} signal(s): ${duplicateIds.join(", ")}`,
    });
  }
  return merged.sort(compareSignals);
}

function mergeDuplicates(id: string, group: CulturalSignal[], context: string, limitations: Limitation[]): CulturalSignal {
  const ordered = [...group].sort(compareOccurrences);
  const canonical = ordered[0] as CulturalSignal;

  const ranks = group.flatMap((signal) => (signal.rank === undefined ? [] : [signal.rank]));
  const categories = [...new Set(group.flatMap((signal) => (signal.category === undefined ? [] : [signal.category])))];
  const numerics = new Map<string, NumericEvidence>();
  for (const signal of group) if (signal.numeric) numerics.set(numericKey(signal.numeric), signal.numeric);

  if (categories.length > 1) {
    limitations.push({ code: "SIGNAL_CATEGORY_CONFLICT", detail: `${context}: signal "${id}" has conflicting categories; category treated as unknown` });
  }
  if (numerics.size > 1) {
    limitations.push({ code: "SIGNAL_VALUE_CONFLICT", detail: `${context}: signal "${id}" has conflicting numeric values; value treated as unknown` });
  }

  return {
    id,
    label: canonical.label,
    ...(categories.length === 1 && { category: categories[0] }),
    ...(ranks.length > 0 && { rank: Math.min(...ranks) }),
    ...(numerics.size === 1 && { numeric: [...numerics.values()][0] }),
    provenance: mergeProvenance(...group.map((signal) => signal.provenance)),
  };
}

function numericKey(numeric: NumericEvidence): string {
  return JSON.stringify([numeric.value, numeric.scale ?? null, numeric.comparisonScope]);
}

export function compareSignals(a: CulturalSignal, b: CulturalSignal): number {
  return compareRanks(a.rank, b.rank) || compareStrings(a.id, b.id);
}

function compareOccurrences(a: CulturalSignal, b: CulturalSignal): number {
  return compareRanks(a.rank, b.rank) || compareStrings(a.label, b.label) || compareStrings(a.category ?? "", b.category ?? "");
}

function compareRanks(a: number | undefined, b: number | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a - b;
}

export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
