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
import { exemplarCandidates } from "./candidate-discovery.js";
import { frontierCandidatePool, frontierEvidenceBaseGap } from "./frontier.js";
import { comparisonRepresentationPlan, preferredTypeFor } from "./representation-alignment.js";
import { namespaceProbeEvidence, probeRecommendations, territoryQueryTags, type ProbeRecommendation } from "./probe-policy.js";
import { conceptDuplicates } from "./concept-dedup.js";
import { RANKABLE_TYPES } from "./contracts.js";
import { assessEvidenceSufficiency, investigationStage, type SufficiencyAssessment } from "./evidence-sufficiency.js";
import type { AgentDecisionContext, DecisionFocus } from "./model/provider.js";
import { probeLedger, recoverable, recoveryGuidance, recoveryOptions, territoryReadiness } from "./readiness.js";
import { referenceCandidates, referencePlan } from "./reference-strategy.js";
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
  /** Reuse the loop's sufficiency assessment instead of recomputing it during context assembly. */
  sufficiency?: SufficiencyAssessment;
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
  // Sprint 5A.2: the evidence-ranked next probe per territory without Qloo members (diversified across a namespace).
  const next = new Map(probeRecommendations(state, activeTerritories(state), (t) => preferredTypeFor(state, t)).map((r) => [r.territoryKey, nextProbeView(state, r)]));
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
    // Sprint 5A: a territory still being resolved sees which probes were made and what is untried.
    if (readiness.state === "needs_concept" && (territoryQueryTags(state, t) || t.sourceTagId)) return { ...base, probes: probeLedger(state, t), recoveryGuidance: recoveryGuidance(state, t), ...(next.has(t.key) && { nextProbe: next.get(t.key) }) };
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
      ...(needs.has("representationRecovery") && { recovery: recoveryOptions(state, t), recoveryGuidance: recoveryGuidance(state, t) }),
      ...(next.has(t.key) && { nextProbe: next.get(t.key) }),
    };
  });

  const evidence: AgentDecisionContext["evidence"] = {};
  if (needs.has("observedTags")) {
    const queries = activeTerritories(state)
      .filter((t) => !t.concept)
      .flatMap((t) => territoryQueryTags(state, t) ?? []);
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
  // Sprint 5A.1: the stage-A candidate pool (fixed evidence base, canonical dedup, stable order) replaces the raw list.
  if (needs.has("frontierConcepts")) evidence.frontierConcepts = frontierCandidatePool(state).slice(0, MAX_FRONTIER_CONCEPTS).map(({ tagId, label, canonicalConceptKey, support, probes }) => ({ tagId, label, canonicalKey: canonicalConceptKey, support, ...(probes.length > 0 && { probes }) }));
  if (needs.has("referenceCandidates")) {
    evidence.referenceCandidates = referenceCandidates(state)
      .slice(0, MAX_REFERENCE_CANDIDATES)
      // Only meaningful candidates, and none from a namespace that already came back empty twice for this type.
      .filter((c) => c.semantic.status === "MEANINGFUL" && c.namespaceYield !== "unproductive" && c.usable !== false)
      .map(({ tagId, label, namespace, namespaceYield, probe, usable, justification, semantic }) => ({ tagId, label, namespace, namespaceYield, probe, usable, semantic: semantic.status, justification }));
    const plan = referencePlan(state);
    evidence.referencePlan = { entityType: plan.entityType, required: plan.required, valid: plan.valid, needed: plan.needed, pending: plan.pending, feasible: plan.feasible, reason: plan.reason, rejectedCandidates: plan.rejectedCandidates.map(({ label, status, reasonCode }) => ({ label, status, reasonCode })), ...(plan.completion && { turnsNeeded: plan.completion.turnsNeeded, turnsLeft: plan.completion.remainingTurns }) };
  }
  // Sprint 5A.1: which entity type the comparison can share (planned before the remaining territories are anchored).
  const alignment = comparisonRepresentationPlan(state);
  if (alignment && activeTerritories(state).some((t) => t.status !== "analyzed")) {
    evidence.representationPlan = { preferredCommonType: alignment.preferredCommonType, feasibility: alignment.feasibility, supportedTerritoriesByType: alignment.supportedTerritoriesByType, missingRequirements: alignment.missingRequirements };
  }
  if (needs.has("conceptDedup")) {
    evidence.conceptDedup = conceptDuplicates(state, activeTerritories(state)).map((d) => `${d.b.key} vs ${d.a.key}: ${d.verdict} (${d.layer}: ${d.basis})${d.action === "dropped" ? ` → ${d.dropped} will be dropped before analysis` : ""}`);
  }
  if (needs.has("analysisResults")) {
    evidence.analysisResults = [...state.results.values()].map((r) => ({ key: r.key, route: r.analysisRoute, classification: r.classification?.label ?? null, robustness: r.robustness?.level ?? null }));
  }
  if (needs.has("brandProfile") || needs.has("relatedEntities") || needs.has("observedTags")) {
    const profiledEntityIds = [...state.profiles.keys()].slice(0, 20);
    const searchedQueries = [...state.searchedQueries.keys()].slice(0, 12);
    if (profiledEntityIds.length > 0 || searchedQueries.length > 0) {
      evidence.alreadyCollected = { profiledEntityIds, searchedQueries };
    }
  }

  const sufficiency = options.sufficiency ?? assessEvidenceSufficiency(state);
  return {
    focus: decisionFocus(state, active, exposure, sufficiency, lastTurn),
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
    sufficiency: { verdict: sufficiency.verdict, reasons: sufficiency.reasons, nextActions: sufficiency.nextActions.slice(0, 14), materialGap: sufficiency.materialGap },
    budget: {
      iterationsLeft: Math.max(0, state.limits.maxAgentIterations - state.usage.iterations),
      qlooCallsLeft: remainingQlooCalls(state),
      maxActionsPerTurn: state.limits.maxActionsPerTurn,
      maxExemplarsPerTerritory: state.limits.maxExemplarsPerTerritory,
      maxCandidateTerritories: state.limits.maxCandidateTerritories,
      skillQlooCallsLeft: Object.fromEntries(active.filter((s) => s.budget.maxQlooCalls > 0).map((s) => [s.id, Math.max(0, s.budget.maxQlooCalls - (state.skillUsage.get(s.id)?.qlooCalls ?? 0))])),
    },
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

/** Sprint 5A.2: what the model sees of a probe recommendation (with the namespace evidence behind it). */
function nextProbeView(state: AgentRunState, r: ProbeRecommendation): NonNullable<AgentDecisionContext["territories"][number]["nextProbe"]> {
  const ns = namespaceProbeEvidence(state, r.namespace, r.conceptKey).observedEntityTypes.map((e) => `${e.type} ${e.successfulProbes} with members / ${e.emptyProbes} empty`);
  return {
    tagId: r.conceptKey,
    entityType: r.type,
    priority: r.priority,
    reason: r.reason,
    namespace: r.namespace,
    namespaceEvidence: ns,
    tested: r.tested.map((x) => `${x.type}:${x.members}`),
    emptyProbesLeft: r.emptySlotsLeft,
    call: `qloo_recommend {targetType: "${r.type}", tagIds: ["${r.conceptKey}"], conditionOnBrand: false}`,
  };
}

const OBJECTIVE: Record<string, string> = {
  analyze_move: "Place the brand's move into the target territory with Qloo evidence: a meaningful comparison set of ≥ 3 territories gives a relative position; otherwise an honest partial result.",
  compare_territories: "Compare the named territories for the brand with Qloo evidence, in one meaningful comparison set where Qloo supports it.",
  explore_frontier: "Find distinct, Qloo-supported cultural territories the brand could stretch into, and analyze them as one set.",
};

/**
 * Sprint 5A: the critical next step, stated first. Every line is derived from deterministic state (sufficiency,
 * readiness, the reference plan, recovery guidance, refusals) so the model need not remember earlier turns.
 */
function decisionFocus(state: AgentRunState, active: readonly SkillDefinition[], exposure: { tools: readonly string[]; actions: readonly TerminalAction[] }, sufficiency: ReturnType<typeof assessEvidenceSufficiency>, lastTurn: AgentDecisionContext["lastTurn"]): DecisionFocus {
  const stage = investigationStage(state);
  const blockerAction = sufficiency.nextActions.find((a) => a.value === "HIGH" && a.action !== "finish");
  const outstanding: string[] = [];
  for (const t of activeTerritories(state).filter((x) => x.status !== "analyzed")) {
    const r = territoryReadiness(state, t);
    if (r.state === "needs_concept" || r.state === "needs_representation" || recoverable(state, t)) outstanding.push(`${t.key}: ${r.state === "ready" ? "recoverable" : r.state} — ${recoveryGuidance(state, t)[0] ?? ("reason" in r ? r.reason : "")}`);
  }
  // Sprint 5A.1: type alignment comes before further probing (a shared type is what makes a comparison possible).
  const alignment = comparisonRepresentationPlan(state);
  if (alignment && alignment.feasibility !== "SUPPORTED" && alignment.preferredCommonType) for (const m of alignment.missingRequirements.slice(0, 3)) outstanding.push(`type alignment (${alignment.preferredCommonType}): ${m}`);
  const plan = referencePlan(state);
  if (plan.feasible && plan.outstanding) outstanding.push(plan.outstanding);
  else if (plan.applicable && plan.reason && plan.valid < plan.required) outstanding.push(`references: ${plan.reason}`);
  const evidenceGap = frontierEvidenceBaseGap(state);
  if (evidenceGap) outstanding.unshift(`${evidenceGap.action} (${evidenceGap.target}): ${evidenceGap.reason}`);
  if (sufficiency.verdict === "SUFFICIENT") outstanding.push("evidence is sufficient: finish");
  const rejected = [
    ...(lastTurn?.rejections ?? []).map((r) => `${r.action}: ${r.code} — ${r.reason}`.slice(0, 220)),
    ...state.trace.earlyStops.slice(-4).map((e) => `${e.tool}: ${e.code} — ${e.reason}`.slice(0, 220)),
    ...state.candidateRejections.slice(-4).map((c) => `${c.key}: ${c.code} — ${c.reason}`.slice(0, 220)),
  ];
  return {
    objective: OBJECTIVE[state.interpretation?.intent ?? ""] ?? "Interpret the request, then gather the Qloo evidence the deterministic methodology needs, then stop.",
    stage,
    activeSkills: active.map((s) => `${s.id} v${s.version}`),
    blocker: blockerAction ? `${blockerAction.action}${blockerAction.target ? ` (${blockerAction.target})` : ""}: ${blockerAction.reason}` : null,
    outstanding: outstanding.slice(0, 8),
    nextAllowed: [...exposure.tools, ...exposure.actions],
    budget: { turnsLeft: Math.max(0, state.limits.maxAgentIterations - state.usage.iterations), qlooCallsLeft: remainingQlooCalls(state) },
    rejectedApproaches: [...new Set(rejected)].slice(0, 8),
  };
}

/** Serialized size of a decision context (characters, and a chars/4 token estimate). */
export function contextSize(context: AgentDecisionContext): { chars: number; tokensEstimate: number } {
  const chars = JSON.stringify(context).length;
  return { chars, tokensEstimate: Math.ceil(chars / 4) };
}
