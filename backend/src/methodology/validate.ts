/**
 * CulturalElasticityResult invariants, checked before any result leaves the methodology:
 *   - no NaN/±Infinity; percentiles and ratios in [0, 1];
 *   - no field that names confidence, probability, likelihood, a score, a distance, a path, a strength,
 *     novelty or momentum; no text presenting the proxy as a distance or the result as a success chance;
 *   - a Relative Elasticity Index exists only with an APPROVED decision and a PASSING gate, is an integer
 *     0–100 equal to round(100 × median percentile), and needs robustness ≥ MEDIUM and quality above LOW;
 *   - robustness and classification agree with their documented rules;
 *   - filtered coherence never shares more than raw coherence; every excluded tag stays inspectable;
 *   - every panel observation and every evidenced territory keeps provenance with a correlation id.
 */
import type { CulturalElasticityResult } from "@cultural-elasticity/shared";
import { hasCorrelation } from "../evidence/provenance.js";
import { ROBUSTNESS_POLICY } from "./config.js";
import { robustnessAtLeast } from "./robustness.js";

export type ElasticityViolation = { path: string; message: string };

export class ElasticityInvariantError extends Error {
  readonly violations: ElasticityViolation[];
  constructor(violations: ElasticityViolation[]) {
    super(`CulturalElasticityResult violates methodology invariants: ${violations.map((v) => `${v.path}: ${v.message}`).join("; ")}`);
    this.name = "ElasticityInvariantError";
    this.violations = violations;
  }
}

export const FORBIDDEN_RESULT_KEY = /confidence|probab|likelihood|score|distance|path|strength|novelty|momentum|audienceAdjacency/i;
const ALLOWED_KEYS = new Set(["NOT_A_PROBABILITY"]);
/** Text that would misstate what the methodology measures. */
export const FORBIDDEN_RESULT_TEXT: readonly RegExp[] = [
  /graph[\s-]distance/i,
  /cultural distance(?! proxy)/i,
  /\b\d{1,3}\s?%\s*(\w+\s+){0,2}(likely|chance|compatib|probab|fit\b|match)/i,
  /(probability|likelihood|chance) of (success|adoption|purchase)/i,
  /(will|would) (succeed|fail)\b/i,
];

export function findElasticityViolations(result: CulturalElasticityResult): ElasticityViolation[] {
  const violations: ElasticityViolation[] = [];
  walk(result, "", violations);
  const approvedAndPassing = result.indexDecision.decision === "APPROVED" && result.indexGate.status === "PASS";
  const unit = (path: string, value: number | null | undefined) => {
    if (value !== null && value !== undefined && (value < 0 || value > 1)) violations.push({ path, message: `${value} is outside [0, 1]` });
  };

  result.territories.forEach((t, i) => {
    const at = `territories.${i}`;
    const r = t.robustness;
    t.panelEvidence.forEach((o, k) => {
      unit(`${at}.panelEvidence.${k}.percentile`, o.percentile);
      if (!o.correlationId) violations.push({ path: `${at}.panelEvidence.${k}`, message: "panel observation without a correlation id" });
    });
    unit(`${at}.relativePosition.medianPercentile`, t.relativePosition.medianPercentile);
    unit(`${at}.robustness.percentileSpread`, r.percentileSpread);
    for (const view of [t.coherenceRaw, t.coherenceFiltered]) for (const e of view.perExemplar) unit(`${at}.coherence.${view.view}.${e.exemplarId}.jaccard`, e.jaccard);

    // Robustness agrees with its rule.
    if ((r.panelledExemplars < 2) !== (r.level === "INSUFFICIENT")) violations.push({ path: `${at}.robustness`, message: "INSUFFICIENT must hold exactly when fewer than 2 exemplars have panel evidence" });
    if (r.level === "HIGH" && (r.percentileSpread ?? 1) > ROBUSTNESS_POLICY.highMaxPercentileSpread) violations.push({ path: `${at}.robustness`, message: "HIGH with a spread above the HIGH threshold" });
    if (r.level === "MEDIUM" && (r.percentileSpread ?? 1) > ROBUSTNESS_POLICY.mediumMaxPercentileSpread) violations.push({ path: `${at}.robustness`, message: "MEDIUM with a spread above the MEDIUM threshold" });

    // Classification agrees with its inputs.
    const label = t.classification.label;
    const insufficient = t.relativePosition.medianPercentile === null || t.evidenceQuality.level === "LOW";
    if (insufficient !== (label === "INSUFFICIENT_EVIDENCE")) violations.push({ path: `${at}.classification`, message: "INSUFFICIENT_EVIDENCE must hold exactly when there is no position or quality is LOW" });
    if (!insufficient && !robustnessAtLeast(r.level, "MEDIUM") && label !== "UNCERTAIN_REPRESENTATION_SENSITIVE") violations.push({ path: `${at}.classification`, message: "low robustness must classify as UNCERTAIN_REPRESENTATION_SENSITIVE" });
    if (t.relativePosition.medianPercentile === null && t.relativePosition.position !== null) violations.push({ path: `${at}.relativePosition`, message: "a position without evidence" });

    // Index only behind the gate.
    const index = t.relativeElasticityIndex;
    if (index !== undefined) {
      if (!approvedAndPassing) violations.push({ path: `${at}.relativeElasticityIndex`, message: "index emitted without an APPROVED decision and a PASSING gate" });
      if (!Number.isInteger(index.value) || index.value < 0 || index.value > 100) violations.push({ path: `${at}.relativeElasticityIndex.value`, message: "index must be an integer in 0–100" });
      if (t.relativePosition.medianPercentile === null || index.value !== Math.round(100 * t.relativePosition.medianPercentile)) violations.push({ path: `${at}.relativeElasticityIndex.value`, message: "index is not the documented transform of the median percentile" });
      if (!robustnessAtLeast(r.level, "MEDIUM") || t.evidenceQuality.level === "LOW") violations.push({ path: `${at}.relativeElasticityIndex`, message: "index emitted for low robustness or LOW quality" });
      if (index.NOT_A_PROBABILITY !== true || index.comparisonSet.length !== result.comparisonSet.territories.length) violations.push({ path: `${at}.relativeElasticityIndex`, message: "index must carry NOT_A_PROBABILITY and its full comparison set" });
    }

    // Filtering never adds shared signals; missing conditioned evidence is null, not zero.
    const filtered = new Map(t.coherenceFiltered.perExemplar.map((e) => [e.exemplarId, e]));
    for (const raw of t.coherenceRaw.perExemplar) {
      const f = filtered.get(raw.exemplarId);
      if (raw.sharedCount !== null && f?.sharedCount !== null && f?.sharedCount !== undefined && f.sharedCount > raw.sharedCount) violations.push({ path: `${at}.coherenceFiltered`, message: `filtered shared count exceeds raw for ${raw.exemplarId}` });
    }
    if (t.conditionedEvidence === null && !t.limitations.some((l) => l.code === "CONDITIONED_NOT_COLLECTED")) violations.push({ path: `${at}.conditionedEvidence`, message: "absent conditioned evidence must be disclosed" });

    // Provenance.
    if (t.panelEvidence.length > 0 && !hasCorrelation(t.provenance)) violations.push({ path: `${at}.provenance`, message: "evidenced territory lost its provenance" });
  });

  const f = result.brandTagFilter;
  if (f.keptCount + f.excluded.length !== f.rawCount) violations.push({ path: "brandTagFilter", message: "kept + excluded must equal the raw count (nothing silently deleted)" });
  if (result.evidenceOrigin === "live" && !hasCorrelation(result.provenance)) violations.push({ path: "provenance", message: "a live result must carry correlation ids" });
  return violations;
}

export function assertElasticityInvariants(result: CulturalElasticityResult): void {
  const violations = findElasticityViolations(result);
  if (violations.length > 0) throw new ElasticityInvariantError(violations);
}

function walk(value: unknown, path: string, violations: ElasticityViolation[]): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) violations.push({ path, message: `non-finite number (${value})` });
    return;
  }
  if (typeof value === "string") {
    const hit = FORBIDDEN_RESULT_TEXT.find((pattern) => pattern.test(value));
    if (hit) violations.push({ path, message: `text matches a forbidden claim (${hit})` });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}.${index}`, violations));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_RESULT_KEY.test(key) && !ALLOWED_KEYS.has(key)) violations.push({ path: `${path}.${key}`, message: "forbidden field name for this methodology" });
    walk(child, path === "" ? key : `${path}.${key}`, violations);
  }
}
