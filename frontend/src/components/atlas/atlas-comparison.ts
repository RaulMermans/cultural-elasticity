// Whether selected territories may be sent into a new comparison.
// Display names and stored positions are not enough: the runs and brand identities have to agree.

import type { QueryResponse } from "@cultural-elasticity/shared";
import type { AtlasDraft } from "./atlas-model";

export type ComparisonSource = { runId: string; territoryKey: string; label: string };

export type ComparisonPlan =
  | { ok: true; brandId: string; brandLabel: string; sources: ComparisonSource[] }
  | { ok: false; reason: string | null };

export function assessComparison(nodes: readonly AtlasDraft[], responses: readonly QueryResponse[], compareIds: readonly string[]): ComparisonPlan {
  const selected = nodes.filter((node) => compareIds.includes(node.id) && node.kind === "territory");
  if (selected.length < 2) return { ok: false, reason: null };
  const sources: ComparisonSource[] = [];
  let brand: { id: string; label: string } | null = null;
  for (const node of selected) {
    const response = responses.find((item) => item.queryId === node.queryId);
    const result = response?.investigation?.result;
    if (!node.runId || !node.territoryKey || !result || result.status === "NEEDS_INPUT" || !result.brand) {
      return { ok: false, reason: "One of these territories has no investigation to compare from." };
    }
    if (brand && brand.id !== result.brand.id) {
      return { ok: false, reason: "These territories come from different brands. Comparing brands is not available, and their earlier results are not one ranking." };
    }
    brand = { id: result.brand.id, label: result.brand.label };
    sources.push({ runId: node.runId, territoryKey: node.territoryKey, label: node.label });
  }
  const names = new Set(sources.map((source) => source.label.normalize("NFKC").trim().toLowerCase()));
  if (!brand || names.size < sources.length) {
    return { ok: false, reason: "Those territories are not distinct enough to compare as separate cultural concepts." };
  }
  return { ok: true, brandId: brand.id, brandLabel: brand.label, sources };
}
