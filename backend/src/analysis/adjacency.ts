/**
 * Audience adjacency evidence.
 *
 * No adjacency formula exists yet, and no aggregate is computed. This module only separates:
 *   - interpretable metrics: semantics declared by the adapter (direction + comparison scope). A metric
 *     is usable as an ingredient only when its direction is not `neutral`;
 *   - opaque fields: upstream data of unverified meaning. Their numeric leaves are listed so a human
 *     can investigate them, but they are never promoted into calculations.
 */
import type { AudienceIngredients, AudienceMetricAssessment } from "@cultural-elasticity/shared";
import { mergeProvenance } from "../evidence/provenance.js";
import type { AudienceEvidence, JsonValue, Limitation } from "../evidence/schema.js";

const MAX_LISTED_PATHS = 200;

export function analyzeAudienceEvidence(audience: AudienceEvidence | undefined): AudienceIngredients {
  if (audience === undefined) {
    return {
      status: "unavailable",
      metrics: [],
      opaqueFields: { paths: [], numericPaths: [] },
      provenance: [],
      limitations: [{ code: "NO_AUDIENCE_EVIDENCE", detail: "no audience evidence was provided; this is unknown, not zero adjacency" }],
    };
  }

  const metrics: AudienceMetricAssessment[] = audience.interpretableMetrics.map((metric) => ({
    ...metric,
    usableAsIngredient: metric.direction !== "neutral",
    crossCallComparable: metric.comparisonScope === "cross_call_verified",
    ...(metric.direction === "neutral" && { exclusionReason: "direction is neutral: the metric carries no closer/farther semantics" }),
  }));

  const paths: string[] = [];
  const numericPaths: string[] = [];
  collectPaths(audience.fields, "", paths, numericPaths);

  const limitations: Limitation[] = [];
  if (numericPaths.length > 0) {
    limitations.push({ code: "OPAQUE_NUMERIC_FIELDS", detail: `${numericPaths.length} numeric audience field(s) have unverified semantics and are excluded from calculations` });
  }
  if (paths.length > MAX_LISTED_PATHS) {
    limitations.push({ code: "OPAQUE_FIELD_LIST_TRUNCATED", detail: `only the first ${MAX_LISTED_PATHS} of ${paths.length} opaque field paths are listed` });
  }
  const usable = metrics.filter((metric) => metric.usableAsIngredient);
  if (usable.length === 0) {
    limitations.push({ code: "NO_INTERPRETABLE_AUDIENCE_METRIC", detail: "audience evidence has no metric with declared direction" });
  }

  return {
    status: usable.length > 0 ? "available" : "insufficient_evidence",
    metrics,
    opaqueFields: { paths: paths.slice(0, MAX_LISTED_PATHS), numericPaths: numericPaths.slice(0, MAX_LISTED_PATHS) },
    provenance: mergeProvenance(audience.provenance, ...audience.interpretableMetrics.map((metric) => metric.provenance)),
    limitations,
  };
}

function collectPaths(value: JsonValue, path: string, paths: string[], numericPaths: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectPaths(item, `${path}[${index}]`, paths, numericPaths));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value).sort()) collectPaths(value[key] as JsonValue, path === "" ? key : `${path}.${key}`, paths, numericPaths);
    return;
  }
  paths.push(path);
  if (typeof value === "number") numericPaths.push(path);
}
