/**
 * Brand-conditioned territory evidence: "does the provider find entities inside this territory when
 * the request is conditioned on the brand?"
 *
 * Descriptive only. Each list is one call: its order is usable, and its values may be compared with
 * each other (raw spread, top-five gap) only after the single-call scope is verified. Nothing is
 * compared across lists, territories or calls, and nothing here is a closeness measure.
 */
import type { ConditionedEvidenceView, ConditionedIngredients } from "@cultural-elasticity/shared";
import { allComparable, verifyConditionedScope } from "../evidence/comparability.js";
import { mergeProvenance } from "../evidence/provenance.js";
import type { ConditionedEntityEvidence, Limitation } from "../evidence/schema.js";

/** Coverage thresholds for the descriptive support label. Not calibrated; not a closeness signal. */
export const CONDITIONED_SUPPORT_MIN_ENTITIES = 5;
const TOP_ENTITIES = 5;

export function describeConditionedEvidence(evidence: ConditionedEntityEvidence): ConditionedEvidenceView {
  const provenance = mergeProvenance(evidence.provenance, ...evidence.entities.map((entity) => entity.provenance));
  const scope = verifyConditionedScope(evidence);
  const ordered = [...evidence.entities].sort((a, b) => a.rank - b.rank);
  const count = ordered.length;
  const limitations: Limitation[] = [];
  const support = count === 0 ? "EMPTY" : count < CONDITIONED_SUPPORT_MIN_ENTITIES ? "SPARSE" : "SUPPORTED";

  let range: number | null = null;
  let topGap: number | null = null;
  if (!scope.verified) {
    limitations.push({ code: "CONDITIONED_SCOPE_UNVERIFIED", detail: `${evidence.territory.id}: ${scope.reason}; order and values are not interpreted` });
  } else if (count > 0 && ordered.every((entity) => entity.numeric !== undefined)) {
    const check = allComparable(ordered.map((entity) => ({ numeric: entity.numeric!, provenance: entity.provenance })), "same_ranking");
    if (check.comparable) {
      const values = ordered.map((entity) => entity.numeric!.value);
      range = Math.max(...values) - Math.min(...values);
      topGap = values[0]! - values[Math.min(TOP_ENTITIES, count) - 1]!;
    } else {
      limitations.push({ code: "CONDITIONED_VALUES_NOT_COMPARABLE", detail: `${evidence.territory.id}: ${check.reason}` });
    }
  } else if (count > 0) {
    limitations.push({ code: "CONDITIONED_VALUES_INCOMPLETE", detail: `${evidence.territory.id}: not every entity carries a value; no spread is computed` });
  }
  if (evidence.truncated === true) limitations.push({ code: "CONDITIONED_LIST_TRUNCATED", detail: `${evidence.territory.id}: the list reached the requested limit; more entities may exist` });
  if (count === 0) limitations.push({ code: "CONDITIONED_EMPTY", detail: `${evidence.territory.id}: the call returned no entities (observed empty, not missing)` });

  return {
    territoryId: evidence.territory.id,
    territoryLabel: evidence.territory.label,
    conditionedOn: evidence.conditionedOn.id,
    status: !scope.verified ? "not_comparable" : count === 0 ? "empty" : "available",
    support,
    entityCount: count,
    requestedLimit: evidence.requestedLimit ?? null,
    truncated: evidence.truncated ?? null,
    scope: scope.verified ? { declared: "single_call", verified: true, correlationId: scope.correlationId } : { declared: "single_call", verified: false, reason: scope.reason },
    // Order is shown only when the single-call scope holds.
    topEntities: scope.verified ? ordered.slice(0, TOP_ENTITIES).map((entity) => ({ id: entity.id, label: entity.label, rank: entity.rank, value: entity.numeric?.value ?? null })) : [],
    withinCallValueRange: range,
    withinCallTopFiveGap: topGap,
    provenance,
    limitations,
  };
}

export function analyzeConditioned(items: readonly ConditionedEntityEvidence[] | undefined, brandId: string): ConditionedIngredients {
  if (items === undefined || items.length === 0) {
    return { status: "unavailable", items: [], provenance: [], limitations: [{ code: "NO_CONDITIONED_EVIDENCE", detail: "no brand-conditioned territory evidence was provided" }] };
  }
  const views = items.map(describeConditionedEvidence);
  const limitations = views.flatMap((view) => view.limitations);
  for (const evidence of items) {
    if (evidence.conditionedOn.id !== brandId) {
      limitations.push({ code: "CONDITIONED_NOT_ON_BRAND", detail: `${evidence.territory.id}: conditioned on "${evidence.conditionedOn.id}", not on the brand subject` });
    }
  }
  limitations.push({ code: "CONDITIONED_VALUES_WITHIN_CALL", detail: "conditioned values are compared only inside their own call; never across territories or calls" });
  return { status: "available", items: views, provenance: mergeProvenance(...views.map((view) => view.provenance)), limitations };
}
