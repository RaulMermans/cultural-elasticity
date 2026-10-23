/**
 * A comparison across earlier investigations is a new investigation of one brand.
 * Stored positions from separate Qloo panels are not treated as one ranking.
 */
import type { RunStore } from "../run-store.js";

export type ComparisonSource = { runId: string; territoryKey: string };

export type ComparisonVerdict =
  | { ok: true; brandId: string; brandLabel: string; labels: string[] }
  | { ok: false; state: "CONTEXT_UNAVAILABLE" | "UNSUPPORTED_OPERATION"; code: string; detail: string };

export function comparisonFromSources(store: RunStore, sources: readonly ComparisonSource[]): ComparisonVerdict {
  const labels: string[] = [];
  let brand: { id: string; label: string } | null = null;
  for (const source of sources) {
    const run = store.get(source.runId);
    if (!run?.final) {
      return { ok: false, state: "CONTEXT_UNAVAILABLE", code: "PARENT_NOT_FOUND", detail: `run ${source.runId} is not held by this process, so its territories cannot be compared` };
    }
    const entity = run.brand.entity;
    if (!entity) {
      return { ok: false, state: "UNSUPPORTED_OPERATION", code: "BRAND_MISSING", detail: `run ${source.runId} has no resolved brand to compare` };
    }
    if (brand && brand.id !== entity.id) {
      return {
        ok: false,
        state: "UNSUPPORTED_OPERATION",
        code: "CROSS_RUN_BRAND",
        detail: "These territories come from different brands. Comparing brands is not available, and results from separate investigations are not one ranking.",
      };
    }
    brand = { id: entity.id, label: entity.label };
    const territory = run.final.territories.find((item) => item.key === source.territoryKey);
    if (!territory) {
      return { ok: false, state: "CONTEXT_UNAVAILABLE", code: "SELECTED_TERRITORY_UNKNOWN", detail: `run ${source.runId} has no territory ${source.territoryKey}` };
    }
    labels.push(territory.label);
  }
  if (!brand || labels.length < 2) {
    return { ok: false, state: "UNSUPPORTED_OPERATION", code: "TERRITORY_CARDINALITY", detail: "A comparison needs two territories from the same brand." };
  }
  if (new Set(labels.map((label) => label.normalize("NFKC").trim().toLowerCase())).size < labels.length) {
    return { ok: false, state: "UNSUPPORTED_OPERATION", code: "TERRITORY_LABELS_NOT_DISTINCT", detail: "Those territories share a display name, so a new comparison cannot tell them apart. Choose territories with distinct names." };
  }
  return { ok: true, brandId: brand.id, brandLabel: brand.label, labels };
}
