/**
 * SYNTHETIC EvidencePacket builders for unit tests. Placeholder ids, fictional labels, and
 * provenance source "synthetic-test". Nothing here is, or imitates, Qloo output.
 */
import type { CulturalProfile, CulturalSignal, EvidencePacket, NumericEvidence, ProvenanceRef } from "../../../src/evidence/schema.js";

export const ref = (correlationId?: string, operation = "profile"): ProvenanceRef => ({
  source: "synthetic-test",
  operation,
  ...(correlationId !== undefined && { correlationId }),
});

export function signal(n: number, options: { rank?: number | null; corr?: string; numeric?: NumericEvidence; category?: string; provenance?: ProvenanceRef[] } = {}): CulturalSignal {
  const rank = options.rank === undefined ? n : options.rank;
  return {
    id: `syn-sig-${String(n).padStart(3, "0")}`,
    label: `Synthetic signal ${n}`,
    ...(options.category !== undefined && { category: options.category }),
    ...(rank !== null && { rank }),
    ...(options.numeric !== undefined && { numeric: options.numeric }),
    provenance: options.provenance ?? [ref(options.corr ?? "syn-corr-profile")],
  };
}

/** Signals ranked 1..k in the order given. */
export function ranked(ids: number[], corr: string, extra: (n: number, i: number) => Partial<Parameters<typeof signal>[1]> = () => ({})): CulturalSignal[] {
  return ids.map((n, i) => signal(n, { rank: i + 1, corr, ...extra(n, i) }));
}

export function profile(role: "brand" | "target", signals: CulturalSignal[], overrides: Partial<CulturalProfile> = {}): CulturalProfile {
  return {
    subject: {
      id: role === "brand" ? "syn-brand" : "syn-target",
      label: role === "brand" ? "Synthetic Brand" : "Synthetic Target",
      type: role === "brand" ? "brand" : "territory_exemplar",
      resolution: "confirmed",
      provenance: [ref(`syn-corr-${role}-resolve`, "resolve")],
    },
    signals,
    truncated: false,
    provenance: [ref(`syn-corr-${role}-profile`)],
    ...overrides,
  };
}

export function packet(overrides: Partial<EvidencePacket> = {}): EvidencePacket {
  return {
    schemaVersion: "ce-evidence/0.1",
    origin: "synthetic",
    brand: profile("brand", ranked([1, 2, 3, 4, 5, 6], "syn-corr-brand-profile")),
    target: profile("target", ranked([4, 5, 6, 7, 8], "syn-corr-target-profile")),
    limitations: [],
    provenance: [ref("syn-corr-packet", "assemble")],
    ...overrides,
  };
}

export const verified = (value: number, scale = "syn-scale"): NumericEvidence => ({ value, scale, comparisonScope: "cross_call_verified" });
