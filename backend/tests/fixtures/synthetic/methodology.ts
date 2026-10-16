/**
 * SYNTHETIC MethodologyInput builders for unit tests. Placeholder ids (`syn-…`), fictional labels,
 * provenance source "synthetic-test". Tag ids follow the URN *shape* (`urn:tag:<namespace>:<source>:syn-…`)
 * only so the operational-tag policy can be exercised; none of them is, or imitates, a real Qloo tag.
 */
import type { CulturalProfile, CulturalSignal, ProvenanceRef } from "../../../src/evidence/schema.js";
import { METHODOLOGY_INPUT_SCHEMA_VERSION, type MethodologyInput, type MethodologyInputRaw } from "../../../src/methodology/contracts.js";

export const SYN_BRAND = "syn-brand";

export const sref = (correlationId: string, operation = "profile"): ProvenanceRef => ({ source: "synthetic-test", operation, correlationId });

/** A synthetic tag. `ns` is "<namespace>:<source>", e.g. "keyword:qloo" (kept) or "credit_card:place" (operational). */
export function tag(ns: string, name: string, corr: string, rank?: number, value?: number): CulturalSignal {
  return {
    id: `urn:tag:${ns}:syn-${name}`,
    label: `Synthetic ${name}`,
    category: `urn:tag:${ns}`,
    ...(rank !== undefined && { rank }),
    ...(value !== undefined && { numeric: { value, comparisonScope: "within_call" as const } }),
    provenance: [sref(corr)],
  };
}

export function tagProfile(subjectId: string, label: string, tags: { ns: string; name: string }[]): CulturalProfile {
  const corr = `syn-corr-tags-${subjectId}`;
  return {
    subject: { id: subjectId, label, type: "brand", resolution: "confirmed", provenance: [sref(`syn-corr-resolve-${subjectId}`, "resolve")] },
    signals: tags.map((t, i) => tag(t.ns, t.name, corr, i + 1, 1 - i * 0.0001)),
    truncated: true,
    provenance: [sref(corr)],
  };
}

export type SynPanel = { id: string; purpose?: "primary" | "alternate" | "repeat"; repeatOf?: string; exemplarIndex?: number; order: string[]; values?: number[] };

export type SynSpec = {
  territories?: string[];
  /** Exemplars per territory (default 2). */
  exemplars?: Record<string, number>;
  panels?: SynPanel[];
  brandTags?: { ns: string; name: string }[];
  exemplarTags?: (exemplarId: string, territoryId: string) => { ns: string; name: string }[];
  /** Conditioned entity count per territory; undefined = not collected. */
  conditioned?: Record<string, number | undefined>;
};

export const exemplarId = (territory: string, index: number) => `syn-ex-${territory}-${index}`;

const DEFAULT_TERRITORIES = ["t1", "t2", "t3", "t4"];

export function synInput(spec: SynSpec = {}): MethodologyInputRaw {
  const territories = spec.territories ?? DEFAULT_TERRITORIES;
  const count = (t: string) => spec.exemplars?.[t] ?? 2;
  const panels: SynPanel[] = spec.panels ?? [
    { id: "A", purpose: "primary", exemplarIndex: 0, order: territories },
    { id: "A-repeat", purpose: "repeat", repeatOf: "A", exemplarIndex: 0, order: territories },
    { id: "B", purpose: "alternate", exemplarIndex: 1, order: territories },
  ];
  const brandTags = spec.brandTags ?? [
    { ns: "keyword:qloo", name: "shared-a" },
    { ns: "keyword:qloo", name: "shared-b" },
    { ns: "lifestyle:qloo", name: "brand-only" },
    { ns: "credit_card:place", name: "payment" },
    { ns: "cost_description:place", name: "price" },
  ];
  const exemplarTags =
    spec.exemplarTags ??
    ((id: string) => [
      { ns: "keyword:qloo", name: "shared-a" },
      { ns: id.endsWith("-0") ? "keyword:qloo" : "aesthetic_property:qloo", name: id.endsWith("-0") ? "shared-b" : `own-${id}` },
      { ns: "credit_card:place", name: "payment" },
      { ns: "specialty_dish:place", name: `dish-${id}` },
    ]);

  return {
    schemaVersion: METHODOLOGY_INPUT_SCHEMA_VERSION,
    origin: "synthetic",
    brand: tagProfile(SYN_BRAND, "Synthetic Brand", brandTags),
    tagTake: 20,
    territories: territories.map((t) => ({
      id: t,
      label: `Synthetic territory ${t}`,
      concept: { id: `syn-concept-${t}`, label: `Synthetic concept ${t}`, type: "syn-concept" },
      exemplars: Array.from({ length: count(t) }, (_, i) => ({
        id: exemplarId(t, i),
        label: `Synthetic exemplar ${t}/${i}`,
        type: "brand",
        role: i === 0 ? ("primary" as const) : ("alternate" as const),
        provenance: [sref(`syn-corr-tags-${exemplarId(t, i)}`)],
      })),
      assumptions: ["SYNTHETIC territory for tests"],
      approximationWarnings: [],
      provenance: [sref(`syn-corr-concept-${t}`, "find_tags")],
    })),
    exemplarProfiles: territories.flatMap((t) => Array.from({ length: count(t) }, (_, i) => tagProfile(exemplarId(t, i), `Synthetic exemplar ${t}/${i}`, exemplarTags(exemplarId(t, i), t)))),
    panels: panels.map((panel) => {
      const corr = `syn-corr-panel-${panel.id}`;
      const index = panel.exemplarIndex ?? 0;
      const assignments = territories.map((t) => ({ territoryId: t, exemplarId: exemplarId(t, Math.min(index, count(t) - 1)) }));
      return {
        id: panel.id,
        purpose: panel.purpose ?? (index === 0 ? "primary" : "alternate"),
        ...(panel.repeatOf !== undefined && { repeatOf: panel.repeatOf }),
        assignments,
        ranking: {
          rankedAgainst: SYN_BRAND,
          candidates: panel.order.map((t, rank) => ({
            id: assignments.find((a) => a.territoryId === t)!.exemplarId,
            label: `Synthetic exemplar ${t}`,
            rank: rank + 1,
            numeric: { value: panel.values?.[rank] ?? 0.9 - rank * 0.05, comparisonScope: "within_call" as const },
            provenance: [sref(corr, "rank")],
          })),
          comparisonScope: "single_call" as const,
          provenance: [sref(corr, "rank")],
        },
      };
    }),
    conditioned: territories.flatMap((t) => {
      const n = spec.conditioned === undefined ? 6 : spec.conditioned[t];
      if (n === undefined) return [];
      const corr = `syn-corr-conditioned-${t}`;
      return [
        {
          conditionedOn: { id: SYN_BRAND, label: "Synthetic Brand" },
          territory: { id: `syn-concept-${t}`, label: `Synthetic concept ${t}` },
          entityType: "syn-entity",
          requestedLimit: 20,
          truncated: false,
          entities: Array.from({ length: n }, (_, i) => ({ id: `syn-cond-${t}-${i}`, label: `Synthetic conditioned ${t}/${i}`, rank: i + 1, numeric: { value: 0.9 - i * 0.01, comparisonScope: "within_call" as const }, provenance: [sref(corr, "recommend")] })),
          comparisonScope: "single_call" as const,
          provenance: [sref(corr, "recommend")],
        },
      ];
    }),
    limitations: [{ code: "SYNTHETIC_FIXTURE", detail: "SYNTHETIC test input; not Qloo evidence" }],
    provenance: [sref("syn-corr-brand-resolve", "resolve")],
  };
}

/** Deep copy, for mutation in tests. */
export function clone(input: MethodologyInputRaw): MethodologyInput {
  return structuredClone(input) as MethodologyInput;
}
