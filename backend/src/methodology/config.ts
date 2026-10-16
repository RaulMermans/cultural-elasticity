/**
 * Methodology version and every policy constant that changes output meaning. Any change here that
 * alters a result (operational filter, aggregation, robustness rules, classification thresholds,
 * index transform or decision) MUST bump METHODOLOGY_VERSION.
 */

export const METHODOLOGY_VERSION = "elasticity-v0.1";

/** Percentiles and medians are rounded to this many decimals so threshold tests are exact. */
export const DECIMALS = 6;

/**
 * Representation robustness (a priori, NOT tuned on the benchmark).
 * In a 6-option panel one rank step is 0.2 of percentile, so HIGH = the position moves by at most one
 * place across exemplar substitutions, MEDIUM = at most two places.
 */
export const ROBUSTNESS_POLICY = {
  highMaxPercentileSpread: 0.2,
  mediumMaxPercentileSpread: 0.4,
  rule:
    "INSUFFICIENT if fewer than 2 distinct exemplars have valid panel evidence (substitution untestable). " +
    "LOW (cap) if any declared exemplar or declared panel lacks valid evidence: missing evidence is never assumed favourable. " +
    "Otherwise by percentile spread across panels: ≤ 0.2 HIGH, ≤ 0.4 MEDIUM, else LOW.",
} as const;

/**
 * Classification thresholds on the median panel percentile. PROVISIONAL: chosen by the calibration
 * grid on the calibration brands only (see calibration.ts and `pnpm eval:elasticity`), which re-derives
 * these values and fails if they drift. Too little data for validated thresholds.
 */
export const CLASSIFICATION_POLICY = {
  status: "PROVISIONAL" as const,
  naturalAdjacencyMinMedianPercentile: 0.8,
  culturalBreakMaxMedianPercentile: 0.2,
  basis: "Grid search on calibration brands (jacquemus, muji, alienware); evaluated on held-out brands (patagonia, lululemon, nintendo). Provisional: 3 + 3 brands is too few to validate thresholds.",
};

/** Calibration grid and the a-priori default used to break ties. */
export const CALIBRATION_GRID = {
  naturalAdjacencyMin: [0.6, 0.7, 0.8],
  culturalBreakMax: [0.2, 0.3, 0.4],
  default: { naturalAdjacencyMin: 0.8, culturalBreakMax: 0.2 },
} as const;

/** Index gate thresholds (a priori). */
export const INDEX_GATE_POLICY = {
  /** B: every pair of aggregated panels must agree on territory order at least this much (Kendall τ). τ ≥ 0.6 ⇔ ≤ 3 of 15 pairs discordant in a 6-panel. */
  minPairwiseKendallTau: 0.6,
  /** C: dropping any single panel may move a territory's median percentile by at most one rank step. */
  maxLeaveOnePanelOutPercentileChange: 0.2,
} as const;

export const RELATIVE_INDEX_FORMULA = "round(100 × median over panels of (panelSize − rank) / (panelSize − 1))";

/**
 * The formal Sprint 2 decision on a 0–100 Relative Elasticity Index. Set from the index-gate result over
 * the live benchmark (`pnpm eval:elasticity` fails if this disagrees with the gate). With REJECTED_FOR_NOW,
 * no analysis emits an index, whatever its own gate says.
 */
export const RELATIVE_INDEX_DECISION = {
  decision: "REJECTED_FOR_NOW" as "APPROVED" | "REJECTED_FOR_NOW",
  basis:
    "Sprint 2 live benchmark (6 brands, captured 2026-10-16): the index gate failed for 6/6 brands. " +
    "Check B (alternate-exemplar panels agree on territory order, Kendall τ ≥ 0.6) failed for every brand (per-brand minimum τ 0.07–0.47); " +
    "check C (no single panel moves a median by more than one rank step) failed for 5/6. Repeats (A), monotonicity (D), missing-evidence (E), " +
    "quality visibility (F) and reconstruction (G) passed for all. A 0–100 number would hide exemplar sensitivity, so the product reports " +
    "relative position + robustness + coherence + classification instead.",
};
