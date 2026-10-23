/**
 * Per-run memo of pure derived views. A traced live Sprint 8B parent investigation spent 354 s exclusive
 * in CONTEXT_ASSEMBLY because comparisonRepresentationPlan / probeRecommendations / referencePlan were
 * recomputed many times per turn (preferredTypeFor calls the alignment plan for every concept).
 *
 * The cache key is evidence identity, not collection cardinality: replacing a member, exemplar, tag,
 * profile, or rejection while keeping the same counts must miss. Cached values never authorize Qloo
 * calls, never skip sufficiency, and never cross run objects.
 */
import type { AgentRunState, TerritoryState } from "./state.js";

type Slot = { fp: string; value: unknown };

const slots = new WeakMap<AgentRunState, Map<string, Slot>>();

function join(parts: readonly string[]): string {
  return parts.join("\u001f");
}

function territoryIdentity(t: TerritoryState): string {
  const exemplars = (t.representation?.exemplars ?? []).map((e) => `${e.id}:${e.type}:${e.quality}`);
  const rejected = t.rejectedExemplars.map((r) => `${r.id ?? ""}:${r.code}:${r.label}`);
  return join([
    t.key,
    t.status,
    t.role,
    t.concept?.id ?? "",
    t.representation?.entityType ?? "",
    exemplars.join(","),
    rejected.join(","),
    t.sourceTagId ?? "",
    t.evidenceTagIds.join(","),
    String(t.attempts),
    t.semanticJudgment?.relevance ?? "",
  ]);
}

/**
 * Identity of the evidence a derived plan may read. Cardinality-only keys are not sufficient:
 * same-size replacement of a representation, entity, pool member, tag, profile, or rejection
 * must produce a different fingerprint.
 */
export function evidenceFingerprint(state: AgentRunState): string {
  const territories = state.territories.map(territoryIdentity);
  const pools = state.pools.map((p) =>
    join([p.targetType, p.tagIds.join(","), p.memberIds.join(","), p.conditionedOn ?? "", p.call?.envelope?.status ?? ""]),
  );
  const entities = [...state.entities.entries()].map(([id, e]) => `${id}:${e.type ?? ""}`);
  const tags = [...state.tags.entries()].map(([id, t]) => `${id}:${t.type}:${t.label}`);
  const profiles = [...state.profiles.entries()].map(([id, p]) => `${id}:${p.tagIds.join(",")}`);
  const related = state.related.map((r) => `${r.subjectId}:${r.targetType}:${r.memberIds.join(",")}`);
  const results = [...state.results.entries()].map(([k, r]) => `${k}:${r.analysisRoute}:${r.evidenceStatus ?? ""}`);
  const rejections = state.candidateRejections.map((c) => `${c.key}:${c.code}:${c.stage}`);
  const assessments = state.semanticAssessments.map((a) => `${a.targetTerritoryKey}:${a.semanticStatus}`);
  return join([
    state.runId,
    state.finalized ? "1" : "0",
    state.interpretation?.intent ?? "",
    state.brand.entity?.id ?? "",
    String(state.usage.qlooCalls),
    String(state.usage.iterations),
    territories.join(";"),
    pools.join(";"),
    entities.join(";"),
    tags.join(";"),
    profiles.join(";"),
    related.join(";"),
    results.join(";"),
    rejections.join(";"),
    assessments.join(";"),
  ]);
}

/** Drop memoized views. Finish() calls this so a sealed run does not keep a mutable decision table. */
export function clearDerivedCache(state: AgentRunState): void {
  slots.delete(state);
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
