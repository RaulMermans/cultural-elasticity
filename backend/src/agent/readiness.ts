/**
 * Territory readiness and representation recovery (deterministic, generic).
 *
 *   territoryReadiness   what a territory still needs before analysis is meaningful:
 *                          needs_concept         no Qloo concept yet, and resolution is still possible
 *                          unsupported           no concept and resolution is exhausted (analysis → INSUFFICIENT)
 *                          needs_representation  concept anchored; Qloo offered exemplar candidates (or has not
 *                                                been probed) and representation strategies remain
 *                          ready                 a validated panel exists, or concept-only evidence is the
 *                                                remaining option (declared, attempts spent, every strategy failed)
 *   recoveryOptions      what else could represent a weakly represented territory: other entity types with
 *                        Qloo members, alternate Qloo concepts returned for the same query, concept-only evidence
 *
 * A (concept, entity type) strategy that was rejected MAX_STRATEGY_FAILURES times is exhausted: the runtime
 * refuses to retry it. Nothing here depends on a territory's name; only on what Qloo returned in this run.
 */
import { exemplarCandidates } from "./candidate-discovery.js";
import { RANKABLE_TYPES, type RankableType } from "./contracts.js";
import type { AgentRunState, TerritoryState } from "./state.js";

/** A strategy that failed this many times is not retried. */
export const MAX_STRATEGY_FAILURES = 2;

export type TerritoryReadiness =
  | { state: "needs_concept"; reason: string }
  | { state: "unsupported"; reason: string }
  | { state: "needs_representation"; reason: string }
  | { state: "ready"; mode: "panel" | "concept_only"; reason: string }
  | { state: "analyzed" }
  | { state: "dropped" };

export const strategyKey = (conceptId: string, entityType: string) => `${conceptId}|${entityType}`;

export function strategyFailures(t: TerritoryState, conceptId: string, entityType: string): number {
  return t.strategyLog.filter((a) => a.conceptId === conceptId && a.entityType === entityType && a.outcome !== "accepted").length;
}

export function strategyExhausted(t: TerritoryState, conceptId: string, entityType: string): boolean {
  return strategyFailures(t, conceptId, entityType) >= MAX_STRATEGY_FAILURES;
}

/** Tags returned by find_tags for this territory's own label (alternate concepts for recovery). */
export function queryTags(state: AgentRunState, t: TerritoryState): string[] {
  return state.searchedQueries.get(t.label.trim().toLowerCase()) ?? [];
}

/** Brand-independent pools observed for a concept, by entity type. */
function probedTypes(state: AgentRunState, conceptId: string): Map<RankableType, number> {
  const out = new Map<RankableType, number>();
  for (const pool of state.pools) {
    if (pool.conditionedOn !== null || pool.tagIds.length !== 1 || pool.tagIds[0] !== conceptId) continue;
    out.set(pool.targetType, Math.max(out.get(pool.targetType) ?? 0, pool.memberIds.length));
  }
  return out;
}

export type StrategyOption = { entityType: RankableType; status: "available" | "exhausted" | "empty"; eligible: number; failures: number };

export type RecoveryOptions = {
  conceptId: string | null;
  strategies: StrategyOption[];
  unprobedTypes: RankableType[];
  alternateConcepts: { id: string; label: string; type: string }[];
  conceptOnlyAvailable: boolean;
};

export function recoveryOptions(state: AgentRunState, t: TerritoryState): RecoveryOptions {
  const conceptId = t.concept?.id ?? null;
  const used = new Set(state.territories.filter((o) => o.status !== "dropped").flatMap((o) => (o.concept ? [o.concept.id] : [])));
  const alternateConcepts = queryTags(state, t)
    .filter((id) => id !== conceptId && !used.has(id))
    .flatMap((id) => {
      const tag = state.tags.get(id);
      return tag ? [{ id, label: tag.label, type: tag.type }] : [];
    });
  if (!conceptId) return { conceptId, strategies: [], unprobedTypes: [], alternateConcepts, conceptOnlyAvailable: false };
  const rejectedIds = new Set(t.rejectedExemplars.flatMap((r) => (r.id ? [r.id] : [])));
  const probed = probedTypes(state, conceptId);
  const strategies: StrategyOption[] = [...probed.entries()].map(([entityType, members]) => {
    const eligible = exemplarCandidates(state, conceptId, entityType).eligible.filter((c) => !rejectedIds.has(c.id)).length;
    const failures = strategyFailures(t, conceptId, entityType);
    const status: StrategyOption["status"] = members === 0 || eligible === 0 ? "empty" : failures >= MAX_STRATEGY_FAILURES ? "exhausted" : "available";
    return { entityType, status, eligible, failures };
  });
  // Profile-tag support can make a type available without a pool.
  for (const type of RANKABLE_TYPES) {
    if (probed.has(type)) continue;
    const eligible = exemplarCandidates(state, conceptId, type).eligible.filter((c) => !rejectedIds.has(c.id)).length;
    if (eligible > 0) strategies.push({ entityType: type, status: strategyExhausted(t, conceptId, type) ? "exhausted" : "available", eligible, failures: strategyFailures(t, conceptId, type) });
  }
  const unprobedTypes = RANKABLE_TYPES.filter((type) => !probed.has(type) && !strategies.some((s) => s.entityType === type));
  return { conceptId, strategies, unprobedTypes, alternateConcepts, conceptOnlyAvailable: true };
}

const skillSpent = (state: AgentRunState, id: string) => state.skillUsage.get(id)?.exhausted === true;

export function territoryReadiness(state: AgentRunState, t: TerritoryState): TerritoryReadiness {
  // A skill whose budget is spent can no longer pursue the gap: the territory is analyzed with what exists.
  const resolutionExhausted = skillSpent(state, "resolve_territory");
  if (t.status === "dropped") return { state: "dropped" };
  if (t.status === "analyzed") return { state: "analyzed" };
  if (!t.concept) {
    const searched = state.searchedQueries.get(t.label.trim().toLowerCase());
    if (searched && searched.length === 0) return { state: "unsupported", reason: "Qloo tag search returned no concept for this territory" };
    if (resolutionExhausted) return { state: "unsupported", reason: "territory resolution budget spent without a Qloo concept" };
    return { state: "needs_concept", reason: searched ? "Qloo returned candidate concepts; anchor one or drop the territory" : "search Qloo's tag vocabulary for a concept" };
  }
  if (t.representation) return { state: "ready", mode: "panel", reason: `${t.representation.exemplars.length} validated exemplar(s)` };
  if (t.conceptOnly) return { state: "ready", mode: "concept_only", reason: `concept-only evidence chosen: ${t.conceptOnly}` };
  if (t.attempts >= state.limits.maxRepresentationAttemptsPerTerritory) return { state: "ready", mode: "concept_only", reason: "representation attempts exhausted" };
  if (skillSpent(state, "build_territory_representation")) return { state: "ready", mode: "concept_only", reason: "representation skill budget spent" };
  const options = recoveryOptions(state, t);
  if (options.strategies.some((s) => s.status === "available")) return { state: "needs_representation", reason: "Qloo returned exemplar candidates for an untried or unexhausted strategy" };
  if (options.strategies.length === 0) return { state: "needs_representation", reason: "no Qloo member pool has been requested for this concept yet" };
  return { state: "ready", mode: "concept_only", reason: "every observed representation strategy is empty or exhausted" };
}

export const isReady = (r: TerritoryReadiness) => r.state === "ready" || r.state === "unsupported";

/**
 * A territory that is analyzable with concept-only evidence because every OBSERVED strategy failed, but that
 * still has untried options (an unprobed entity type, an alternate Qloo concept) and attempts left: the
 * representation skill stays available so the agent can recover instead of settling for concept-only.
 */
export function recoverable(state: AgentRunState, t: TerritoryState): boolean {
  if (!t.concept || t.representation || t.conceptOnly || t.status === "dropped" || t.status === "analyzed") return false;
  if (t.attempts >= state.limits.maxRepresentationAttemptsPerTerritory || skillSpent(state, "build_territory_representation")) return false;
  const r = territoryReadiness(state, t);
  if (r.state !== "ready") return false;
  const options = recoveryOptions(state, t);
  return options.strategies.length > 0 && (options.unprobedTypes.length > 0 || options.alternateConcepts.length > 0);
}
