/**
 * Per-run memo of pure derived views. A traced live Sprint 8B parent investigation spent 354 s exclusive
 * in CONTEXT_ASSEMBLY because comparisonRepresentationPlan / probeRecommendations / referencePlan were
 * recomputed many times per turn (preferredTypeFor calls the alignment plan for every concept).
 * The cache key is evidence identity, not wall time: a Qloo result or territory mutation misses.
 */
import type { AgentRunState, TerritoryState } from "./state.js";

type Slot = { fp: string; value: unknown };

const slots = new WeakMap<AgentRunState, Map<string, Slot>>();

export function evidenceFingerprint(state: AgentRunState): string {
  const territories = state.territories
    .map((t) => `${t.key}:${t.status}:${t.role}:${t.concept?.id ?? ""}:${t.representation?.entityType ?? ""}:${t.sourceTagId ?? ""}:${t.attempts}:${t.rejectedExemplars.length}`)
    .join(";");
  const pools = state.pools.map((p) => `${p.targetType}:${p.tagIds.join(",")}:${p.memberIds.length}:${p.conditionedOn ?? ""}`).join(";");
  return [
    state.interpretation?.intent ?? "",
    state.brand.entity?.id ?? "",
    String(state.usage.qlooCalls),
    String(state.usage.iterations),
    territories,
    pools,
    `${state.profiles.size}:${state.tags.size}:${state.related.length}:${state.results.size}:${state.entities.size}:${state.candidateRejections.length}`,
  ].join("|");
}

/** Return a cached derived value for this evidence fingerprint, or compute and store it. */
export function memoRun<T>(state: AgentRunState, slot: string, compute: () => T): T {
  const fp = evidenceFingerprint(state);
  let table = slots.get(state);
  if (!table) {
    table = new Map();
    slots.set(state, table);
  }
  const hit = table.get(slot);
  if (hit && hit.fp === fp) return hit.value as T;
  const value = compute();
  table.set(slot, { fp, value });
  return value;
}

export function probeSlot(territories: readonly TerritoryState[]): string {
  return `probes:${territories.map((t) => t.key).join(",")}`;
}
