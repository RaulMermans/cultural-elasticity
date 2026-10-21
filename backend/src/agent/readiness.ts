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

/**
 * Sprint 5A: entity types in recovery order — types that already returned eligible members for some concept in this
 * run first (most productive first), then place and brand (the two types live evidence most often supports), then
 * the remaining rankable Insights types. Every type listed is accepted by qloo_recommend; none is invented.
 */
export function typePreference(state: AgentRunState): RankableType[] {
  const yieldByType = new Map<RankableType, number>();
  for (const pool of state.pools) if (pool.conditionedOn === null && pool.memberIds.length > 0) yieldByType.set(pool.targetType, (yieldByType.get(pool.targetType) ?? 0) + 1);
  const fixed: RankableType[] = ["place", "brand"];
  return [...RANKABLE_TYPES].sort((a, b) => (yieldByType.get(b) ?? 0) - (yieldByType.get(a) ?? 0) || (fixed.includes(a) ? fixed.indexOf(a) : 9) - (fixed.includes(b) ? fixed.indexOf(b) : 9));
}

/** Brand-independent probes already made for a territory's candidate concepts (its query tags and its anchor). */
export function probeLedger(state: AgentRunState, t: TerritoryState): { tagId: string; label: string; probes: { type: RankableType; members: number }[] }[] {
  const tags = [...new Set([...(t.concept ? [t.concept.id] : []), ...queryTags(state, t)])];
  return tags.flatMap((tagId) => {
    const probes = [...probedTypes(state, tagId).entries()].map(([type, members]) => ({ type, members }));
    return probes.length > 0 || tagId === t.concept?.id ? [{ tagId, label: state.tags.get(tagId)?.label ?? tagId, probes }] : [];
  });
}

/** Entity types that returned no members for ≥ `min` of the territory's candidate concepts, and none that returned members. */
export function barrenTypes(state: AgentRunState, t: TerritoryState, min = 2): RankableType[] {
  const ledger = probeLedger(state, t);
  return RANKABLE_TYPES.filter((type) => {
    const probes = ledger.flatMap((l) => l.probes.filter((p) => p.type === type));
    return probes.length >= min && probes.every((p) => p.members === 0);
  });
}

/**
 * Sprint 5A recovery contract: state-grounded next steps for a territory still being resolved or represented —
 * what was tried, why it failed, which strategies remain, which supported entity types are untried, which
 * alternate Qloo concepts exist, attempts left and the tools that perform each step. No vague "try another type".
 */
export function recoveryGuidance(state: AgentRunState, t: TerritoryState): string[] {
  const out: string[] = [];
  const ledger = probeLedger(state, t);
  const tried = new Set(ledger.flatMap((l) => l.probes.map((p) => p.type)));
  const barren = barrenTypes(state, t);
  const untried = typePreference(state).filter((type) => !tried.has(type)).slice(0, 3);
  if (!t.concept) {
    const tags = queryTags(state, t);
    if (tags.length === 0) return ["search Qloo's tag vocabulary for this territory (qloo_find_tags)"];
    const withMembers = ledger.filter((l) => l.probes.some((p) => p.members > 0));
    if (withMembers.length > 0) out.push(`anchor a concept Qloo returned members for (anchor_territory): ${withMembers.map((l) => `${l.label} [${l.tagId}] ${l.probes.filter((p) => p.members > 0).map((p) => `${p.type}:${p.members}`).join(",")}`).join("; ")}`);
    if (barren.length > 0) out.push(`${barren.join(", ")} probes of ${ledger.filter((l) => l.probes.some((p) => barren.includes(p.type))).length} of this territory's Qloo concepts returned no members: ${tried.size > barren.length ? `yield differs by tag namespace, so ${barren.join("/")} may still be probed on concepts not yet tried with it` : `probe another supported entity type before ${barren.join("/")} again`}`);
    if (untried.length > 0) out.push(`untried supported entity types for its concepts: ${untried.join(", ")} (qloo_recommend, conditionOnBrand=false, on the concept named most like the territory)`);
    if (withMembers.length === 0 && untried.length === 0) out.push("no probe found members: anchor the concept named most like the territory and declare_concept_only, or drop it");
    return out;
  }
  const options = recoveryOptions(state, t);
  const attemptsLeft = Math.max(0, state.limits.maxRepresentationAttemptsPerTerritory - t.attempts);
  for (const s of options.strategies) {
    if (s.status === "available") out.push(`available: ${s.entityType} exemplars for ${t.concept.label} (${s.eligible} eligible candidate(s)${s.failures ? `, ${s.failures} failed attempt(s)` : ""}) → validate_territory_representation with entityType ${s.entityType}`);
    else out.push(`${s.status}: ${s.entityType} for ${t.concept.label}${s.status === "empty" ? " (Qloo returned no eligible member)" : ` (failed ${s.failures} times; refused)`}`);
  }
  if (t.rejectedExemplars.length > 0) out.push(`rejected exemplars (do not propose again): ${t.rejectedExemplars.slice(-6).map((r) => `${r.label} (${r.code})`).join(", ")}`);
  if (untried.length > 0 && !options.strategies.some((s) => s.status === "available")) out.push(`not yet probed with the supported entity type(s) ${untried.join(", ")} → qloo_recommend on ${t.concept.id}, conditionOnBrand=false`);
  if (options.alternateConcepts.length > 0 && !options.strategies.some((s) => s.status === "available")) out.push(`alternate Qloo concepts for the same territory → anchor_territory: ${options.alternateConcepts.slice(0, 4).map((c) => `${c.label} [${c.id}]`).join("; ")}`);
  out.push(`${attemptsLeft} representation attempt(s) left; when no strategy remains, declare_concept_only (an honest partial result, never a forced weak panel)`);
  return out;
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
