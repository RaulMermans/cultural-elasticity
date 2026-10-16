/**
 * Provenance propagation. Refs are compact pointers (source, operation, correlation id, time).
 * Merging dedupes and sorts them, so a derived value's provenance is independent of input order.
 */
import type { ProvenanceCoverage } from "@cultural-elasticity/shared";
import type { ProvenanceRef } from "./schema.js";

export function provenanceKey(ref: ProvenanceRef): string {
  return JSON.stringify([ref.source, ref.operation, ref.correlationId ?? "", ref.capturedAt ?? ""]);
}

/** Union of provenance lists, deduplicated and sorted deterministically. */
export function mergeProvenance(...lists: readonly (readonly ProvenanceRef[])[]): ProvenanceRef[] {
  const byKey = new Map<string, ProvenanceRef>();
  for (const list of lists) {
    for (const ref of list) {
      const key = provenanceKey(ref);
      if (!byKey.has(key)) byKey.set(key, compact(ref));
    }
  }
  return [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, ref]) => ref);
}

function compact(ref: ProvenanceRef): ProvenanceRef {
  return {
    source: ref.source,
    operation: ref.operation,
    ...(ref.correlationId !== undefined && { correlationId: ref.correlationId }),
    ...(ref.capturedAt !== undefined && { capturedAt: ref.capturedAt }),
  };
}

/** Distinct correlation ids referenced by a provenance list. */
export function correlationIds(provenance: readonly ProvenanceRef[]): string[] {
  return [...new Set(provenance.flatMap((ref) => (ref.correlationId === undefined ? [] : [ref.correlationId])))].sort();
}

/** The one call a value came from, or undefined when that is not identifiable (zero or several calls). */
export function singleCorrelationId(provenance: readonly ProvenanceRef[]): string | undefined {
  const ids = correlationIds(provenance);
  return ids.length === 1 ? ids[0] : undefined;
}

export function hasCorrelation(provenance: readonly ProvenanceRef[]): boolean {
  return provenance.some((ref) => ref.correlationId !== undefined);
}

export function provenanceCoverage(items: readonly { provenance: readonly ProvenanceRef[] }[]): ProvenanceCoverage {
  const withProvenance = items.filter((item) => item.provenance.length > 0).length;
  const withCorrelationId = items.filter((item) => hasCorrelation(item.provenance)).length;
  return {
    items: items.length,
    withProvenance,
    withCorrelationId,
    completeness: items.length === 0 ? null : withCorrelationId / items.length,
  };
}
