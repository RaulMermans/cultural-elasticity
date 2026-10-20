/**
 * Just-in-time decision context: the smallest high-signal view of state the model needs for THIS turn.
 *
 * Always present: goal, request fields, interpretation, phase, brand status, active skills (id, version,
 * procedure), compact territory list, deterministic sufficiency with next-action values, budgets, open plan
 * items, last-turn results, the exposed tools and terminal actions.
 * Present only when an active skill requires it (SkillDefinition.contextRequirements): observed tags,
 * brand profile, exemplar candidates and recovery options for territories being represented, reference
 * candidates, related entities, frontier concepts, concept-dedup findings, analysis results.
 * Never present: raw Qloo payloads, full traces, benchmark data (the runtime has none), secrets or
 * environment values, inactive skills, unexposed tools.
 */
import { exemplarCandidates, frontierConcepts } from "./candidate-discovery.js";
import { conceptDuplicates } from "./concept-dedup.js";
import { RANKABLE_TYPES } from "./contracts.js";
import { assessEvidenceSufficiency } from "./evidence-sufficiency.js";
import type { AgentDecisionContext } from "./model/provider.js";
import { derivePlan } from "./planner.js";
import { recoverable, recoveryOptions, territoryReadiness } from "./readiness.js";
import { referenceCandidates } from "./reference-strategy.js";
import type { ContextSection, SkillDefinition, TerminalAction } from "./skills/contracts.js";
import { SkillRegistry } from "./skills/registry.js";
import { activeTerritories, derivePhase, remainingQlooCalls, type AgentRunState } from "./state.js";
import { toolJsonSchema, type ToolRegistry } from "./tool-registry.js";

const MAX_TAGS = 24;
const MAX_CANDIDATES_PER_TERRITORY = 8;
const MAX_REFERENCE_CANDIDATES = 8;
const MAX_FRONTIER_CONCEPTS = 10;

export type ContextOptions = {
  active?: readonly SkillDefinition[];
  exposure?: { tools: readonly string[]; actions: readonly TerminalAction[] };
  repair?: AgentDecisionContext["repair"];
};

const defaultSkills = new SkillRegistry();

/** Arrays longer than this are cut (Qloo pools return at most 20 members, so a pool stays whole). */
const MAX_LAST_TURN_ARRAY = 20;

/** Structural compaction: long arrays are cut and long strings shortened, but the JSON shape is kept, so
 * a policy or model can still read ids and labels (a string "preview" would make the data unusable). */
function compactValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.length > 300 ? `${value.slice(0, 300)}…` : value;
  if (Array.isArray(value)) {
    const kept = value.slice(0, MAX_LAST_TURN_ARRAY).map((v) => compactValue(v, depth + 1));
    return value.length > MAX_LAST_TURN_ARRAY ? [...kept, { truncated: value.length - MAX_LAST_TURN_ARRAY }] : kept;
  }
  if (value && typeof value === "object" && depth < 6) return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, compactValue(v, depth + 1)]));
  return value;
}

function compactLastTurn(lastTurn: AgentDecisionContext["lastTurn"]): AgentDecisionContext["lastTurn"] {
  if (!lastTurn) return null;
  return { results: lastTurn.results.map((r) => (r.data === undefined ? r : { ...r, data: compactValue(r.data) })), rejections: lastTurn.rejections };
}

export function buildDecisionContext(state: AgentRunState, registry: ToolRegistry, lastTurn: AgentDecisionContext["lastTurn"], options: ContextOptions = {}): AgentDecisionContext {
  const active = options.active ?? defaultSkills.select(state);
  const exposure = options.exposure ?? defaultSkills.exposure(state, registry, active);
  const needs = new Set<ContextSection>(active.flatMap((s) => s.contextRequirements));
  const brandEntity = state.brand.entity;
  const brand: AgentDecisionContext["brand"] = brandEntity
    ? { status: "resolved", id: brandEntity.id, label: brandEntity.label, type: brandEntity.type, resolution: brandEntity.resolution }
    : state.brand.ambiguity
      ? { status: "ambiguous", input: state.brand.ambiguity.input, candidates: state.brand.ambiguity.candidates.map((c) => ({ id: c.qlooId, label: c.label, type: c.type ?? null })) }
      : { status: state.brand.notFound ? "not_found" : "unresolved", query: state.brand.query };

  const detail = needs.has("exemplarCandidates") || needs.has("representationRecovery");
  const territories: AgentDecisionContext["territories"] = state.territories.map((t) => {
    const readiness = territoryReadiness(state, t);
    const base: AgentDecisionContext["territories"][number] = {
      key: t.key,
      label: t.label,
      role: t.role,
      origin: t.origin,
      status: t.status,
      readiness: readiness.state,
      concept: t.concept,
      representation: t.representation ? { entityType: t.representation.entityType, exemplars: t.representation.exemplars.map((e) => ({ id: e.id, label: e.label, quality: e.quality })), diversity: t.representation.diversity } : null,
      analysisRoute: state.results.get(t.key)?.analysisRoute ?? null,
    };
    if (t.status === "dropped") return { ...base, dropReason: t.dropReason?.code ?? null };
    // Representation detail only for territories the active skills are working on.
    if (!detail || !t.concept || (readiness.state !== "needs_representation" && !recoverable(state, t))) return base;
    const rejectedIds = new Set(t.rejectedExemplars.flatMap((r) => (r.id ? [r.id] : [])));
    return {
      ...base,
      attemptsLeft: Math.max(0, state.limits.maxRepresentationAttemptsPerTerritory - t.attempts),
      rejectedExemplars: t.rejectedExemplars.map(({ label, code, reason }) => ({ label, code, reason })),
      exemplarCandidates: RANKABLE_TYPES.flatMap((type) =>
        exemplarCandidates(state, t.concept!.id, type)
          .eligible.filter((c) => !rejectedIds.has(c.id))
          .map((c) => ({ type, id: c.id, label: c.label, popularity: c.popularity, support: c.conceptSupport, profiled: state.profiles.has(c.id) })),
      ).slice(0, MAX_CANDIDATES_PER_TERRITORY),
      ...(needs.has("representationRecovery") && { recovery: recoveryOptions(state, t) }),
    };
  });

  const evidence: AgentDecisionContext["evidence"] = {};
  if (needs.has("observedTags")) {
    const queries = activeTerritories(state)
      .filter((t) => !t.concept)
      .flatMap((t) => state.searchedQueries.get(t.label.trim().toLowerCase()) ?? []);
    const ids = [...new Set(queries)].slice(0, MAX_TAGS);
    evidence.observedTags = ids.flatMap((id) => (state.tags.has(id) ? [{ id, label: state.tags.get(id)!.label, type: state.tags.get(id)!.type }] : []));
  }
  if (needs.has("brandProfile") && brandEntity) {
    const profile = state.profiles.get(brandEntity.id);
    evidence.brandProfile = profile ? profile.tagIds.map((id) => ({ id, label: state.tags.get(id)?.label ?? id })) : null;
  }
  if (needs.has("relatedEntities")) {
    const relatedIds = [...new Set(state.related.flatMap((r) => r.memberIds))];
    evidence.relatedEntities = relatedIds.slice(0, 10).map((id) => ({ id, label: state.entities.get(id)?.label ?? id, profiled: state.profiles.has(id) }));
  }
  if (needs.has("frontierConcepts")) evidence.frontierConcepts = frontierConcepts(state, 1).slice(0, MAX_FRONTIER_CONCEPTS).map(({ tagId, label, support }) => ({ tagId, label, support }));
  if (needs.has("referenceCandidates")) {
    evidence.referenceCandidates = referenceCandidates(state)
      .slice(0, MAX_REFERENCE_CANDIDATES)
      .map(({ tagId, label, namespace, namespaceYield, probe, usable, justification }) => ({ tagId, label, namespace, namespaceYield, probe, usable, justification }));
  }
  if (needs.has("conceptDedup")) {
    evidence.conceptDedup = conceptDuplicates(state, activeTerritories(state)).map((d) => `${d.b.key} vs ${d.a.key}: ${d.verdict} (${d.layer}: ${d.basis})${d.action === "dropped" ? ` → ${d.dropped} will be dropped before analysis` : ""}`);
  }
  if (needs.has("analysisResults")) {
    evidence.analysisResults = [...state.results.values()].map((r) => ({ key: r.key, route: r.analysisRoute, classification: r.classification?.label ?? null, robustness: r.robustness?.level ?? null }));
  }

  const sufficiency = assessEvidenceSufficiency(state);
  return {
    runId: state.runId,
    iteration: state.usage.iterations,
    userQuery: state.request.userQuery,
    requestFields: {
      ...(state.request.intent && { intent: state.request.intent }),
      ...(state.request.brand && { brand: state.request.brand }),
      ...(state.request.territories && { territories: state.request.territories }),
    },
    interpretation: state.interpretation,
    phase: derivePhase(state),
    brand,
    skills: active.map((s) => ({ id: s.id, version: s.version, purpose: s.purpose, procedure: s.procedure })),
    territories,
    evidence,
    sufficiency: { verdict: sufficiency.verdict, reasons: sufficiency.reasons, nextSteps: sufficiency.nextSteps, nextActions: sufficiency.nextActions.slice(0, 14), materialGap: sufficiency.materialGap },
    budget: {
      iterationsLeft: Math.max(0, state.limits.maxAgentIterations - state.usage.iterations),
      qlooCallsLeft: remainingQlooCalls(state),
      maxActionsPerTurn: state.limits.maxActionsPerTurn,
      maxExemplarsPerTerritory: state.limits.maxExemplarsPerTerritory,
      maxCandidateTerritories: state.limits.maxCandidateTerritories,
      skillQlooCallsLeft: Object.fromEntries(active.filter((s) => s.budget.maxQlooCalls > 0).map((s) => [s.id, Math.max(0, s.budget.maxQlooCalls - (state.skillUsage.get(s.id)?.qlooCalls ?? 0))])),
    },
    plan: derivePlan(state).filter((item) => item.startsWith("[ ]")),
    lastTurn: compactLastTurn(lastTurn),
    clarifications: state.clarifications,
    tools: exposure.tools.flatMap((name) => {
      const tool = registry.get(name);
      return tool ? [{ name: tool.name, description: tool.description, inputSchema: toolJsonSchema(tool) }] : [];
    }),
    actions: [...exposure.actions],
    repair: options.repair ?? null,
  };
}

/** Serialized size of a decision context (characters, and a chars/4 token estimate). */
export function contextSize(context: AgentDecisionContext): { chars: number; tokensEstimate: number } {
  const chars = JSON.stringify(context).length;
  return { chars, tokensEstimate: Math.ceil(chars / 4) };
}
