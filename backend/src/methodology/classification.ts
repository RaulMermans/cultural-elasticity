/**
 * Strategic classification, relative to the comparison set (PROVISIONAL thresholds).
 *
 * Ordered rules:
 *   1. INSUFFICIENT_EVIDENCE                no valid panel observation, or territory evidence quality LOW
 *   2. UNCERTAIN_REPRESENTATION_SENSITIVE   robustness INSUFFICIENT or LOW: the answer depends on the exemplar
 *   3. NATURAL_ADJACENCY                    median panel percentile ≥ naturalAdjacencyMin
 *   4. CULTURAL_BREAK                       median panel percentile ≤ culturalBreakMax
 *   5. CREDIBLE_STRETCH                     otherwise (consistently mid-set)
 *
 * Inputs are candidate position, robustness and evidence quality only. Cultural coherence is NOT an
 * input, so the rank evidence and the tag overlap are never counted together. Every class is relative:
 * "CULTURAL_BREAK" means "consistently at the bottom of THIS candidate set", not an absolute verdict.
 */
import type { ElasticityClass, ElasticityClassification, RelativePosition, Robustness, TerritoryEvidenceQuality } from "@cultural-elasticity/shared";
import { CLASSIFICATION_POLICY } from "./config.js";
import { robustnessAtLeast } from "./robustness.js";

export type ClassificationThresholds = { naturalAdjacencyMin: number; culturalBreakMax: number };

export const DEFAULT_THRESHOLDS: ClassificationThresholds = {
  naturalAdjacencyMin: CLASSIFICATION_POLICY.naturalAdjacencyMinMedianPercentile,
  culturalBreakMax: CLASSIFICATION_POLICY.culturalBreakMaxMedianPercentile,
};

export function classificationRule(t: ClassificationThresholds): string {
  return (
    "1 INSUFFICIENT_EVIDENCE if no valid panel observation or evidence quality LOW; " +
    "2 UNCERTAIN_REPRESENTATION_SENSITIVE if robustness is INSUFFICIENT or LOW; " +
    `3 NATURAL_ADJACENCY if median panel percentile ≥ ${t.naturalAdjacencyMin}; ` +
    `4 CULTURAL_BREAK if median panel percentile ≤ ${t.culturalBreakMax}; ` +
    "5 CREDIBLE_STRETCH otherwise. All classes are relative to the comparison set (PROVISIONAL thresholds)."
  );
}

export function classifyTerritory(
  inputs: { position: RelativePosition; robustness: Robustness; evidenceQuality: TerritoryEvidenceQuality },
  thresholds: ClassificationThresholds = DEFAULT_THRESHOLDS,
): ElasticityClassification {
  const { position, robustness, evidenceQuality } = inputs;
  const make = (label: ElasticityClass, reasons: string[]): ElasticityClassification => ({ label, status: "PROVISIONAL", rule: classificationRule(thresholds), reasons });
  const m = position.medianPercentile;
  if (m === null) return make("INSUFFICIENT_EVIDENCE", ["no valid panel observation"]);
  if (evidenceQuality.level === "LOW") return make("INSUFFICIENT_EVIDENCE", [`evidence quality LOW (${evidenceQuality.drivers.join("; ")})`]);
  if (!robustnessAtLeast(robustness.level, "MEDIUM")) {
    return make("UNCERTAIN_REPRESENTATION_SENSITIVE", [`robustness ${robustness.level}: the position depends on which exemplar represents the territory`, ...robustness.reasons]);
  }
  const where = `median panel percentile ${m} (ranks ${robustness.bestRank}–${robustness.worstRank}), robustness ${robustness.level}`;
  if (m >= thresholds.naturalAdjacencyMin) return make("NATURAL_ADJACENCY", [`${where}: consistently near the top of this candidate set`]);
  if (m <= thresholds.culturalBreakMax) return make("CULTURAL_BREAK", [`${where}: consistently near the bottom of this candidate set`]);
  return make("CREDIBLE_STRETCH", [`${where}: consistently in the middle of this candidate set`]);
}
