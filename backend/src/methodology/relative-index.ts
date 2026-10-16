/**
 * Relative Elasticity Index: a CANDIDATE 0–100 transform of the central ordinal position,
 *
 *   index = round(100 × median panel percentile)
 *
 * meaning "relative candidate position inside THIS comparison set": 100 = top of every panel,
 * 0 = bottom of every panel. It is not a probability, a compatibility percentage or a prediction.
 *
 * The index may be emitted only if (1) the methodology-level decision is APPROVED, (2) this analysis
 * passes every index-gate check, and (3) the territory has robustness ≥ MEDIUM and evidence quality
 * above LOW. Gate details never contain index values, so no 0–100 number appears when the gate fails.
 */
import type { IndexGateCheck, IndexGateReport, PanelObservation, PanelReport, RelativeElasticityIndex, RepeatCheck, Robustness, TerritoryEvidenceQuality } from "@cultural-elasticity/shared";
import { INDEX_GATE_POLICY, METHODOLOGY_VERSION, RELATIVE_INDEX_DECISION, RELATIVE_INDEX_FORMULA } from "./config.js";
import type { TerritoryRepresentation } from "./contracts.js";
import { assessRobustness, robustnessAtLeast } from "./robustness.js";
import { kendallTau, median, rankPercentile, round } from "./stats.js";

/** Monotonic non-decreasing in the median percentile by construction. */
export function indexTransform(medianPercentile: number): number {
  return Math.round(100 * medianPercentile);
}

/** The index a territory WOULD have; null unless robustness ≥ MEDIUM and quality is not LOW. */
export function eligibleIndex(medianPercentile: number | null, robustness: Robustness, quality: TerritoryEvidenceQuality): number | null {
  if (medianPercentile === null || !robustnessAtLeast(robustness.level, "MEDIUM") || quality.level === "LOW") return null;
  return indexTransform(medianPercentile);
}

export type GateTerritory = {
  territory: TerritoryRepresentation;
  observations: PanelObservation[];
  medianPercentile: number | null;
  robustness: Robustness;
  evidenceQuality: TerritoryEvidenceQuality;
};

export type GateContext = {
  territories: GateTerritory[];
  panelReports: PanelReport[];
  repeatChecks: RepeatCheck[];
  aggregatedPanelIds: string[];
  validAggregatedPanelIds: string[];
};

const check = (id: IndexGateCheck["id"], name: string, status: IndexGateCheck["status"], detail: string): IndexGateCheck => ({ id, name, status, detail });

export function evaluateIndexGate(ctx: GateContext): IndexGateReport {
  const checks: IndexGateCheck[] = [];

  // A. repeated identical panels are stable.
  const repeats = ctx.repeatChecks;
  if (repeats.length === 0) checks.push(check("A", "Repeated identical panels are stable", "NOT_TESTED", "no repeat panel in the input"));
  else {
    const bad = repeats.filter((r) => r.status !== "identical");
    checks.push(check("A", "Repeated identical panels are stable", bad.length === 0 ? "PASS" : "FAIL", bad.length === 0 ? `${repeats.length} repeat panel(s) reproduced the same order` : bad.map((r) => `${r.panelId}: ${r.status}`).join("; ")));
  }

  // B. alternate-exemplar panels agree on territory order.
  const valid = ctx.panelReports.filter((p) => p.purpose !== "repeat" && p.status === "valid");
  const taus: { pair: string; tau: number }[] = [];
  for (let i = 0; i < valid.length; i += 1) {
    for (let j = i + 1; j < valid.length; j += 1) {
      const tau = kendallTau(valid[i]!.order.map((o) => o.territoryId), valid[j]!.order.map((o) => o.territoryId));
      if (tau !== null) taus.push({ pair: `${valid[i]!.id}/${valid[j]!.id}`, tau });
    }
  }
  if (taus.length === 0) checks.push(check("B", "Alternate-exemplar panels are ordinally stable", "NOT_TESTED", "fewer than two valid aggregated panels"));
  else {
    const min = Math.min(...taus.map((t) => t.tau));
    checks.push(
      check("B", "Alternate-exemplar panels are ordinally stable", min >= INDEX_GATE_POLICY.minPairwiseKendallTau ? "PASS" : "FAIL", `Kendall τ by panel pair: ${taus.map((t) => `${t.pair} ${t.tau}`).join(", ")}; minimum ${min} (required ≥ ${INDEX_GATE_POLICY.minPairwiseKendallTau})`),
    );
  }

  // C. no single panel (exemplar set) moves a territory's central position by more than one rank step.
  const untestable = ctx.territories.filter((t) => t.observations.length < 2).map((t) => t.territory.id);
  let worst = { territory: "", change: 0 };
  for (const t of ctx.territories) {
    if (t.observations.length < 2 || t.medianPercentile === null) continue;
    for (let k = 0; k < t.observations.length; k += 1) {
      const rest = t.observations.filter((_, i) => i !== k).map((o) => o.percentile);
      const change = round(Math.abs(median(rest) - t.medianPercentile));
      if (change > worst.change) worst = { territory: t.territory.id, change };
    }
  }
  if (untestable.length > 0) checks.push(check("C", "No drastic change from one exemplar", "NOT_TESTED", `fewer than two panel observations for: ${untestable.join(", ")}`));
  else {
    const ok = worst.change <= INDEX_GATE_POLICY.maxLeaveOnePanelOutPercentileChange;
    checks.push(check("C", "No drastic change from one exemplar", ok ? "PASS" : "FAIL", `largest leave-one-panel-out change in median percentile: ${worst.change}${worst.territory ? ` (${worst.territory})` : ""}; allowed ≤ ${INDEX_GATE_POLICY.maxLeaveOnePanelOutPercentileChange}`));
  }

  // D. the transform is monotonic with rank position.
  let monotonic = true;
  for (let i = 0; i < 100; i += 1) if (indexTransform(round((i + 1) / 100)) < indexTransform(round(i / 100))) monotonic = false;
  const sorted = ctx.territories.filter((t) => t.medianPercentile !== null).sort((a, b) => (a.medianPercentile as number) - (b.medianPercentile as number));
  for (let i = 1; i < sorted.length; i += 1) if (indexTransform(sorted[i]!.medianPercentile as number) < indexTransform(sorted[i - 1]!.medianPercentile as number)) monotonic = false;
  checks.push(check("D", "Transform is monotonic with rank", monotonic ? "PASS" : "FAIL", "round(100 × median percentile) is non-decreasing in the median percentile"));

  // E. missing evidence cannot improve the result: drop each exemplar's panels and re-derive.
  let improved = "";
  for (const t of ctx.territories) {
    const before = eligibleIndex(t.medianPercentile, t.robustness, t.evidenceQuality);
    for (const exemplar of t.territory.exemplars) {
      const lost = new Set(t.observations.filter((o) => o.exemplarId === exemplar.id).map((o) => o.panelId));
      if (lost.size === 0) continue;
      const remaining = t.observations.filter((o) => !lost.has(o.panelId));
      const robustness = assessRobustness(t.territory, remaining, { aggregatedPanelIds: ctx.aggregatedPanelIds, validAggregatedPanelIds: ctx.validAggregatedPanelIds.filter((id) => !lost.has(id)) });
      const m = remaining.length === 0 ? null : median(remaining.map((o) => o.percentile));
      const after = eligibleIndex(m, robustness, t.evidenceQuality);
      if (after !== null && (before === null || after > before)) improved = `${t.territory.id} without ${exemplar.label}`;
    }
  }
  checks.push(check("E", "Missing evidence cannot improve the result", improved === "" ? "PASS" : "FAIL", improved === "" ? "removing any exemplar's panel evidence never raises or creates an index" : `index improved for ${improved}`));

  // F. evidence-quality problems remain visible separately.
  const hidden = ctx.territories.filter((t) => t.evidenceQuality.level === "LOW" && eligibleIndex(t.medianPercentile, t.robustness, t.evidenceQuality) !== null);
  checks.push(check("F", "Evidence-quality problems stay visible", hidden.length === 0 ? "PASS" : "FAIL", "evidence quality is reported per territory beside the position and is never folded into it; LOW quality withholds the index"));

  // G. reconstructable from the panel evidence alone.
  const rebuilt = new Map<string, number[]>();
  for (const panel of valid) for (const o of panel.order) rebuilt.set(o.territoryId, [...(rebuilt.get(o.territoryId) ?? []), rankPercentile(o.rank, panel.order.length)]);
  const mismatch = ctx.territories.filter((t) => {
    const ps = rebuilt.get(t.territory.id) ?? [];
    return (ps.length === 0 ? null : median(ps)) !== t.medianPercentile;
  });
  checks.push(check("G", "Reconstructable from panel evidence", mismatch.length === 0 ? "PASS" : "FAIL", mismatch.length === 0 ? "median percentiles recomputed from the panel rank orders match" : `mismatch: ${mismatch.map((t) => t.territory.id).join(", ")}`));

  return { status: checks.every((c) => c.status === "PASS") ? "PASS" : "FAIL", candidateFormula: RELATIVE_INDEX_FORMULA, checks };
}

export function emittedIndex(t: GateTerritory, gate: IndexGateReport, comparisonSet: string[]): RelativeElasticityIndex | undefined {
  if (RELATIVE_INDEX_DECISION.decision !== "APPROVED" || gate.status !== "PASS") return undefined;
  const value = eligibleIndex(t.medianPercentile, t.robustness, t.evidenceQuality);
  if (value === null) return undefined;
  return { value, semantics: "relative_candidate_position", formula: RELATIVE_INDEX_FORMULA, comparisonSet, methodologyVersion: METHODOLOGY_VERSION, NOT_A_PROBABILITY: true };
}
