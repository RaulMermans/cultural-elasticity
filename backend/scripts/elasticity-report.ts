/** Plain-text rendering of a CulturalElasticityResult in the Sprint 2 product-model shape. */
import type { CulturalElasticityResult, TerritoryElasticity } from "@cultural-elasticity/shared";

const pct = (value: number | null) => (value === null ? "n/a" : value.toFixed(2));

export function formatTerritory(t: TerritoryElasticity, result: CulturalElasticityResult): string {
  const p = t.relativePosition;
  const r = t.robustness;
  const raw = t.coherenceRaw.summary;
  const filtered = t.coherenceFiltered.summary;
  const c = t.conditionedEvidence;
  const lines = [
    `${t.territory.label}  [${t.classification.label}]`,
    `  RELATIVE POSITION   ${p.position === null ? "insufficient evidence" : `${p.position} / ${p.of}${p.tiedWith.length ? ` (tied with ${p.tiedWith.join(", ")})` : ""}`}  · median panel percentile ${pct(p.medianPercentile)}`,
    `  ROBUSTNESS          ${r.level}  · ${r.panelledExemplars}/${r.declaredExemplars} exemplars · ranks ${r.bestRank ?? "–"}–${r.worstRank ?? "–"} · percentile spread ${pct(r.percentileSpread)}`,
    `  QLOO EVIDENCE       ${t.panelEvidence.map((o) => `${o.exemplarLabel} ${o.rank}/${o.panelSize} (panel ${o.panelId})`).join(" · ") || "none"}`,
    `  COHERENCE (sets)    raw median shared ${raw?.sharedCountMedian ?? "n/a"} (${t.coherenceRaw.band ?? "n/a"}) → filtered ${filtered?.sharedCountMedian ?? "n/a"} (${t.coherenceFiltered.band ?? "n/a"})${filtered?.consistentlyShared.length ? ` · shared: ${filtered.consistentlyShared.map((s) => s.label).join(", ")}` : ""}`,
    `  CONDITIONED         ${c === null ? "not collected" : `${c.support}, ${c.entityCount} entities${c.topEntities.length ? `: ${c.topEntities.slice(0, 3).map((e) => e.label).join(", ")}` : ""}${c.declaredExemplarsFound.length ? ` · exemplars found: ${c.declaredExemplarsFound.map((e) => `${e.label}#${e.rank}`).join(", ")}` : ""}`}`,
    `  EVIDENCE QUALITY    ${t.evidenceQuality.level}${t.evidenceQuality.drivers.length ? ` (${t.evidenceQuality.drivers.join("; ")})` : ""}`,
  ];
  if (t.relativeElasticityIndex) lines.push(`  RELATIVE ELASTICITY INDEX ${t.relativeElasticityIndex.value} / 100 (relative to ${result.comparisonSet.territories.length} territories; not a probability)`);
  if (t.territory.approximationWarnings.length) lines.push(`  WARNINGS            ${t.territory.approximationWarnings.join(" ")}`);
  return lines.join("\n");
}

export function formatResult(result: CulturalElasticityResult): string {
  const lines = [
    `Cultural Elasticity — ${result.brand.label} (${result.methodologyVersion}, evidence origin: ${result.evidenceOrigin.toUpperCase()})`,
    `Comparison set: ${result.comparisonSet.territories.map((t) => t.label).join(", ")} · panels ${result.comparisonSet.panels.join(", ")}`,
    `Panels: ${result.panels.map((p) => `${p.id} ${p.status}: ${p.order.map((o) => o.exemplarLabel).join(" > ")}`).join("\n        ")}`,
    `Repeat checks: ${result.repeatChecks.map((r) => `${r.panelId} ${r.status}`).join(", ") || "none"}`,
    "",
    ...result.territories.map((t) => formatTerritory(t, result)),
    "",
    `Index decision: ${result.indexDecision.decision} · index gate: ${result.indexGate.status}`,
    ...result.indexGate.checks.map((c) => `  ${c.id} ${c.status.padEnd(10)} ${c.name} — ${c.detail}`),
    `Classification thresholds (${result.classificationPolicy.status}): natural adjacency ≥ ${result.classificationPolicy.naturalAdjacencyMinMedianPercentile}, cultural break ≤ ${result.classificationPolicy.culturalBreakMaxMedianPercentile}`,
    `Not measured: ${result.semantics.notMeasured.join("; ")}`,
  ];
  return lines.join("\n");
}
