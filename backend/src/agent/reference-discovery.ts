/**
 * Sprint 9O runtime-owned reference discovery (enforce policy, comparative runs).
 *
 * Live traces (Sprint 5A–9O) failed mostly at one step: a represented target with no comparison set, after the model
 * guessed reference tags one probe at a time (45 of 65 brand-independent probes empty in the failed runs). Finding
 * references Qloo can measure is a search over evidence the run already holds, so the runtime does it once, the way
 * it owns budgets and stopping (AGENTS.md, runtime rule 1):
 *   1. collect the validated target exemplars' tag profiles still missing (only with ≥ MEANINGFUL_EXEMPLAR_SUPPORT
 *      validated exemplars: with fewer, their tags cannot be meaningful references);
 *   2. probe the best MEANINGFUL, unprobed candidates observed on profiles of the comparison type (type evidence), in
 *      referenceCandidates order, as many as references are still needed (≤ DISCOVERY_MAX_PROBES), brand-independent, one type.
 * It never proposes, anchors or validates a reference: the model still makes the semantic choice among candidates
 * whose Qloo yield is now known. It runs only when the calls leave the analysis and the reference build affordable.
 */
import { analysisReserve } from "./analysis-runner.js";
import { assessComparisonFeasibility, comparativeRun } from "./feasibility.js";
import { isReady, territoryReadiness } from "./readiness.js";
import { MIN_REFERENCE_POOL, referenceCandidates, referenceEntityType, referenceMembers, referencePlan, validTargetExemplars } from "./reference-strategy.js";
import { MEANINGFUL_EXEMPLAR_SUPPORT } from "./semantic-comparison.js";
import { activeTerritories, remainingQlooCalls, type AgentRunState } from "./state.js";
import { AGENT_ALLOWED_PERMISSIONS, executeToolCall, type SkillGate } from "./tool-executor.js";
import type { SkillRegistry } from "./skills/registry.js";
import type { AgentToolProvider } from "./tool-provider.js";
import type { ToolRegistry } from "./tool-registry.js";

export const DISCOVERY_MAX_PROBES = 4;
const MAX_PROFILES = 3;

type Plan = { entityType: NonNullable<ReturnType<typeof referenceEntityType>>; profiles: string[]; needed: number; reserve: number };

/** Whether the sweep applies now, and what it would collect first; null when it does not apply (yet). */
export function referenceDiscoveryPlan(state: AgentRunState): Plan | null {
  if (state.feasibilityPolicy !== "enforce" || state.referenceDiscoveryDone || !comparativeRun(state) || !state.brand.entity) return null;
  const entityType = referenceEntityType(state);
  const f = assessComparisonFeasibility(state);
  const plan = referencePlan(state);
  if (!entityType || !f?.target.represented || !plan.applicable || !plan.feasible || plan.needed === 0) return null;
  const profiles = [
    ...(state.profiles.has(state.brand.entity.id) ? [] : [state.brand.entity.id]),
    ...(validTargetExemplars(state) >= MEANINGFUL_EXEMPLAR_SUPPORT
      ? activeTerritories(state).filter((t) => t.role === "target").flatMap((t) => (t.representation?.exemplars ?? []).filter((e) => e.quality === "VALID" && !state.profiles.has(e.id)).map((e) => e.id))
      : []),
  ].slice(0, MAX_PROFILES);
  const ready = activeTerritories(state).filter((t) => t.status !== "analyzed" && isReady(territoryReadiness(state, t)));
  // The reference build after the sweep: a primary-exemplar profile per reference, plus the analysis itself.
  const reserve = analysisReserve(state, ready) + plan.needed * 2;
  return { entityType, profiles, needed: plan.needed, reserve };
}

/** Runs the sweep once when it applies. Returns true when it made Qloo calls (the caller re-assesses before the next turn). */
export async function runReferenceDiscovery(state: AgentRunState, registry: ToolRegistry, provider: AgentToolProvider, skills: SkillRegistry): Promise<boolean> {
  const plan = referenceDiscoveryPlan(state);
  const skill = skills.get("build_comparison_set");
  if (!plan || !skill) return false;
  // The sweep is part of build_comparison_set (v5): its calls are attributed to the skill, count against its Qloo
  // budget and meet the same value refusals as the model's calls.
  const gate: SkillGate = { skills, active: [skill], exposed: new Set(skill.allowedTools), actions: [], seen: [] };
  const exec = (tool: string, args: unknown) => executeToolCall(state, registry, provider, tool, args, AGENT_ALLOWED_PERMISSIONS, gate);
  state.referenceDiscoveryDone = true;
  const record = { iteration: state.usage.iterations, entityType: plan.entityType, profiles: [] as string[], probes: [] as { tagId: string; label: string; typeEvidence: number; eligible: number | null }[], skipped: null as string | null };
  (state.trace.referenceDiscovery ??= []).push(record);
  const maxProbes = Math.min(DISCOVERY_MAX_PROBES, plan.needed);
  if (remainingQlooCalls(state) < plan.profiles.length + Math.min(maxProbes, plan.needed) + plan.reserve) {
    record.skipped = `${remainingQlooCalls(state)} Qloo call(s) left; the sweep and the reference build need about ${plan.profiles.length + plan.needed + plan.reserve}`;
    return false;
  }
  for (const entityId of plan.profiles) {
    const r = await exec("qloo_get_entity_tags", { entityId });
    if (r.accepted) record.profiles.push(entityId);
  }
  const candidates = referenceCandidates(state)
    .filter((c) => c.semantic.status === "MEANINGFUL" && c.usable === null && c.typeEvidence > 0 && c.namespaceYield !== "unproductive")
    .slice(0, maxProbes);
  for (const c of candidates) {
    if (remainingQlooCalls(state) <= plan.reserve) break;
    await exec("qloo_recommend", { targetType: plan.entityType, tagIds: [c.tagId], conditionOnBrand: false, limit: 20 });
    const probed = state.pools.some((p) => p.conditionedOn === null && p.tagIds.length === 1 && p.tagIds[0] === c.tagId && p.targetType === plan.entityType);
    record.probes.push({ tagId: c.tagId, label: c.label, typeEvidence: c.typeEvidence, eligible: probed ? referenceMembers(state, c.tagId, plan.entityType) : null });
  }
  if (candidates.length === 0) record.skipped = `no meaningful unprobed candidate observed on ${plan.entityType} profiles`;
  return record.profiles.length > 0 || record.probes.length > 0;
}

/** Usable references the sweep found (≥ MIN_REFERENCE_POOL eligible members), for tests and evaluators. */
export function discoveredUsable(state: AgentRunState): number {
  return (state.trace.referenceDiscovery ?? []).flatMap((r) => r.probes).filter((p) => (p.eligible ?? 0) >= MIN_REFERENCE_POOL).length;
}
