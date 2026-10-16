/**
 * Builds the model's per-turn view of the run (AgentDecisionContext) from state. Bounded in size; no
 * secrets, no raw upstream payloads, no benchmark data (the runtime has none).
 */
import { exemplarCandidates, frontierConcepts, territoryDuplicates } from "./candidate-discovery.js";
import { RANKABLE_TYPES } from "./contracts.js";
import { assessEvidenceSufficiency } from "./evidence-sufficiency.js";
import type { AgentDecisionContext } from "./model/provider.js";
import { derivePlan } from "./planner.js";
import { activeTerritories, derivePhase, remainingQlooCalls, type AgentRunState } from "./state.js";
import { toolJsonSchema, type ToolRegistry } from "./tool-registry.js";

const MAX_TAGS = 40;
const MAX_CANDIDATES = 12;

export function buildDecisionContext(state: AgentRunState, registry: ToolRegistry, lastTurn: AgentDecisionContext["lastTurn"]): AgentDecisionContext {
  const brandEntity = state.brand.entity;
  const brand: AgentDecisionContext["brand"] = brandEntity
    ? { status: "resolved", id: brandEntity.id, label: brandEntity.label, type: brandEntity.type, resolution: brandEntity.resolution }
    : state.brand.ambiguity
      ? { status: "ambiguous", input: state.brand.ambiguity.input, candidates: state.brand.ambiguity.candidates.map((c) => ({ id: c.qlooId, label: c.label, type: c.type ?? null })) }
      : { status: state.brand.notFound ? "not_found" : "unresolved", query: state.brand.query };

  const territories = state.territories.map((t) => ({
    key: t.key,
    label: t.label,
    role: t.role,
    origin: t.origin,
    status: t.status,
    concept: t.concept,
    representation: t.representation ? { entityType: t.representation.entityType, exemplars: t.representation.exemplars.map((e) => ({ id: e.id, label: e.label })), diversity: t.representation.diversity } : null,
    attemptsLeft: Math.max(0, state.limits.maxRepresentationAttemptsPerTerritory - t.attempts),
    rejectedExemplars: t.rejectedExemplars.map(({ label, code, reason }) => ({ label, code, reason })),
    exemplarCandidates: t.concept
      ? RANKABLE_TYPES.flatMap((type) =>
          exemplarCandidates(state, t.concept!.id, type).eligible.map((c) => ({ type, id: c.id, label: c.label, popularity: c.popularity, support: c.conceptSupport })),
        ).slice(0, MAX_CANDIDATES)
      : [],
    analysisRoute: state.results.get(t.key)?.analysisRoute ?? null,
  }));

  const brandProfile = brandEntity ? state.profiles.get(brandEntity.id) : undefined;
  const relatedIds = [...new Set(state.related.flatMap((r) => r.memberIds))];
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
    territories,
    evidence: {
      observedTags: [...state.tags.values()].slice(-MAX_TAGS).map((t) => ({ id: t.id, label: t.label, type: t.type })),
      brandProfile: brandProfile ? brandProfile.tagIds.map((id) => ({ id, label: state.tags.get(id)?.label ?? id })) : null,
      relatedEntities: relatedIds.slice(0, 10).map((id) => ({ id, label: state.entities.get(id)?.label ?? id, profiled: state.profiles.has(id) })),
      frontierConcepts: frontierConcepts(state, 1).slice(0, 12).map(({ tagId, label, support }) => ({ tagId, label, support })),
      duplicateWarnings: territoryDuplicates(state, activeTerritories(state)).map((d) => `${d.key} duplicates ${d.duplicateOf} (${d.kind}: ${d.detail})`),
    },
    sufficiency,
    budget: {
      iterationsLeft: Math.max(0, state.limits.maxAgentIterations - state.usage.iterations),
      qlooCallsLeft: remainingQlooCalls(state),
      maxActionsPerTurn: state.limits.maxActionsPerTurn,
      maxExemplarsPerTerritory: state.limits.maxExemplarsPerTerritory,
      maxCandidateTerritories: state.limits.maxCandidateTerritories,
    },
    plan: derivePlan(state),
    lastTurn,
    clarifications: state.clarifications,
    tools: registry.available(state).map((t) => ({ name: t.name, description: t.description, inputSchema: toolJsonSchema(t) })),
  };
}
