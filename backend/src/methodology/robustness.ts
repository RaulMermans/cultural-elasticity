/**
 * Representation robustness: does the territory's position survive reasonable changes of exemplar?
 *
 * Rule-based, no probability (ROBUSTNESS_POLICY.rule):
 *   INSUFFICIENT  fewer than 2 distinct exemplars with valid panel evidence: substitution is untestable
 *   LOW (cap)     a declared exemplar, or a declared aggregated panel, has no valid evidence. Missing
 *                 evidence could have placed the territory anywhere, so it is never assumed favourable
 *   otherwise     percentile spread across panels ≤ 0.2 HIGH, ≤ 0.4 MEDIUM, else LOW
 *
 * This is separate from evidence quality: HIGH quality evidence can still be LOW robustness.
 */
import type { PanelObservation, Robustness, RobustnessLevel } from "@cultural-elasticity/shared";
import { ROBUSTNESS_POLICY } from "./config.js";
import type { TerritoryRepresentation } from "./contracts.js";
import { round } from "./stats.js";

export const ROBUSTNESS_ORDER: readonly RobustnessLevel[] = ["INSUFFICIENT", "LOW", "MEDIUM", "HIGH"];

export function robustnessAtLeast(level: RobustnessLevel, minimum: RobustnessLevel): boolean {
  return ROBUSTNESS_ORDER.indexOf(level) >= ROBUSTNESS_ORDER.indexOf(minimum);
}

export function assessRobustness(
  territory: TerritoryRepresentation,
  observations: readonly PanelObservation[],
  panels: { aggregatedPanelIds: readonly string[]; validAggregatedPanelIds: readonly string[] },
): Robustness {
  const reasons: string[] = [];
  const panelled = new Set(observations.map((o) => o.exemplarId));
  const ranks = observations.map((o) => o.rank);
  const percentiles = observations.map((o) => o.percentile);
  const stats = {
    declaredExemplars: territory.exemplars.length,
    panelledExemplars: panelled.size,
    validObservations: observations.length,
    bestRank: ranks.length ? Math.min(...ranks) : null,
    worstRank: ranks.length ? Math.max(...ranks) : null,
    rankSpread: ranks.length ? Math.max(...ranks) - Math.min(...ranks) : null,
    percentileSpread: percentiles.length ? round(Math.max(...percentiles) - Math.min(...percentiles)) : null,
    directionConsistent: percentiles.length ? percentiles.every((p) => p >= 0.5) || percentiles.every((p) => p <= 0.5) : null,
  };
  const result = (level: RobustnessLevel): Robustness => ({ level, rule: ROBUSTNESS_POLICY.rule, ...stats, reasons });

  if (panelled.size < 2) {
    reasons.push(
      territory.exemplars.length < 2
        ? "only one exemplar is declared for this territory, so exemplar substitution cannot be tested"
        : `only ${panelled.size} of ${territory.exemplars.length} declared exemplars have valid panel evidence`,
    );
    return result("INSUFFICIENT");
  }

  let capped = false;
  const unpanelled = territory.exemplars.filter((e) => !panelled.has(e.id));
  if (unpanelled.length > 0) {
    capped = true;
    reasons.push(`declared exemplar(s) without valid panel evidence: ${unpanelled.map((e) => e.label).join(", ")}`);
  }
  const missingPanels = panels.aggregatedPanelIds.filter((id) => !panels.validAggregatedPanelIds.includes(id));
  if (missingPanels.length > 0) {
    capped = true;
    reasons.push(`declared panel(s) without valid evidence: ${missingPanels.join(", ")}`);
  }

  const spread = stats.percentileSpread as number;
  const spreadLevel: RobustnessLevel = spread <= ROBUSTNESS_POLICY.highMaxPercentileSpread ? "HIGH" : spread <= ROBUSTNESS_POLICY.mediumMaxPercentileSpread ? "MEDIUM" : "LOW";
  reasons.push(`${panelled.size} exemplars across ${observations.length} panel(s); ranks ${stats.bestRank}–${stats.worstRank}; percentile spread ${spread}`);
  if (capped && spreadLevel !== "LOW") reasons.push(`spread alone would give ${spreadLevel}; capped at LOW because evidence is missing`);
  return result(capped ? "LOW" : spreadLevel);
}
