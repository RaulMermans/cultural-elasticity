/**
 * Output invariants. Every AnalysisIngredients is checked before it leaves the engine:
 *   - no NaN or ±Infinity anywhere;
 *   - every Ingredient has `value !== null` exactly when `status === "available"`, so unknown never becomes 0;
 *   - ratios lie in [0, 1], and set counts are arithmetically consistent;
 *   - no key names a score, elasticity or confidence, which this sprint must not produce.
 */
import type { AnalysisIngredients } from "@cultural-elasticity/shared";

export type InvariantViolation = { path: string; message: string };

export class AnalysisInvariantError extends Error {
  readonly violations: InvariantViolation[];
  constructor(violations: InvariantViolation[]) {
    super(`AnalysisIngredients violates engine invariants: ${violations.map((v) => `${v.path}: ${v.message}`).join("; ")}`);
    this.name = "AnalysisInvariantError";
    this.violations = violations;
  }
}

const FORBIDDEN_KEY = /score|elasticity|confidence/i;
const INGREDIENT_KEYS = ["value", "status", "provenance", "limitations"] as const;

export function findInvariantViolations(result: AnalysisIngredients): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  walk(result, "", violations);

  const ratio = (path: string, value: number | null | undefined) => {
    if (value === null || value === undefined) return;
    if (value < 0 || value > 1) violations.push({ path, message: `ratio ${value} is outside [0, 1]` });
  };
  const { overlap, profileCoverage, stability, ranking, bridges, distanceProxy } = result;
  ratio("overlap.jaccard", overlap.jaccard);
  ratio("overlap.overlapCoefficient", overlap.overlapCoefficient);
  ratio("overlap.weightedSharedOverlap.value.ratio", overlap.weightedSharedOverlap.value?.ratio);
  ratio("profileCoverage.sharedOfBrand", profileCoverage.sharedOfBrand);
  ratio("profileCoverage.sharedOfTarget", profileCoverage.sharedOfTarget);
  for (const role of ["brand", "target"] as const) {
    const coverage = profileCoverage[role];
    ratio(`profileCoverage.${role}.numericCoverage`, coverage.numericCoverage);
    ratio(`profileCoverage.${role}.missingNumericRatio`, coverage.missingNumericRatio);
    ratio(`profileCoverage.${role}.provenance.completeness`, coverage.provenance.completeness);
  }
  stability.points.forEach((point, index) => ratio(`stability.points.${index}.jaccard`, point.jaccard));
  ratio("ranking.target.relativeRankPercentile.value", ranking.target?.relativeRankPercentile.value);
  ratio("bridges.numericCoverage", bridges.numericCoverage);
  result.conditioned.items.forEach((item, index) => {
    const expectedTop = item.scope.verified ? Math.min(5, item.entityCount) : 0;
    if (item.topEntities.length !== expectedTop) {
      violations.push({ path: `conditioned.items.${index}.topEntities`, message: "top entities must be shown exactly when the single-call scope is verified" });
    }
    if (item.withinCallValueRange !== null && item.withinCallValueRange < 0) violations.push({ path: `conditioned.items.${index}.withinCallValueRange`, message: "negative range" });
  });
  ratio("distanceProxy.jaccardOverlap.value", distanceProxy.jaccardOverlap.value);
  ratio("distanceProxy.overlapCoefficient.value", distanceProxy.overlapCoefficient.value);

  const { brandSignalCount: b, targetSignalCount: t, sharedSignalCount: s, unionCount: u } = overlap;
  if (s > Math.min(b, t)) violations.push({ path: "overlap.sharedSignalCount", message: "shared count exceeds the smaller profile" });
  if (u < Math.max(b, t)) violations.push({ path: "overlap.unionCount", message: "union count is below the larger profile" });
  if (u !== b + t - s) violations.push({ path: "overlap.unionCount", message: "union ≠ brand + target − shared" });
  if (overlap.shared.length !== s) violations.push({ path: "overlap.shared", message: "shared list length differs from sharedSignalCount" });

  return violations;
}

export function assertAnalysisInvariants(result: AnalysisIngredients): void {
  const violations = findInvariantViolations(result);
  if (violations.length > 0) throw new AnalysisInvariantError(violations);
}

function walk(value: unknown, path: string, violations: InvariantViolation[]): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) violations.push({ path, message: `non-finite number (${value})` });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}.${index}`, violations));
    return;
  }
  if (value === null || typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  if (INGREDIENT_KEYS.every((key) => key in record) && typeof record.status === "string") {
    const isAvailable = record.status === "available";
    if (isAvailable && record.value === null) violations.push({ path, message: "available ingredient has a null value" });
    if (!isAvailable && record.value !== null) violations.push({ path, message: `${record.status} ingredient carries a value; missing evidence must stay null` });
  }
  for (const [key, child] of Object.entries(record)) {
    if (FORBIDDEN_KEY.test(key)) violations.push({ path: `${path}.${key}`, message: "this sprint must not emit scores, elasticity or confidence values" });
    walk(child, path === "" ? key : `${path}.${key}`, violations);
  }
}
