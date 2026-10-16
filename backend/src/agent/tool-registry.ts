/**
 * Typed tool registry. Every tool declares: typed input (zod), typed output (ToolResult), permission
 * class, timeout, an upper bound on Qloo calls, a state precondition and its provenance (the trace entry
 * collects the correlation ids of every Qloo call it makes).
 *
 * Permission classes: read_only_external (Qloo reads) and local_computation (deterministic code). No
 * tool can write files, run shell commands, touch git, deploy, send messages or mutate anything outside
 * the run's in-memory state. Only capabilities verified against the live hackathon API are exposed:
 * describe, find_tags, entity_tags and recommend. `rank` runs only inside deterministic panel
 * construction (comparison scope is code-owned); compare_audiences has no documented metric and is not
 * exposed (see docs/sprint-3/AGENTIC_INVESTIGATION_RUNTIME.md).
 */
import type { AgentRunStatus, AgentToolCallTrace } from "@cultural-elasticity/shared";
import { z } from "zod";
import { similarLabels } from "./candidate-discovery.js";
import { AGENT_INTENTS, DEFAULT_QLOO_CALLS, RANKABLE_TYPES, shortEntityType, type RankableType } from "./contracts.js";
import { assessEvidenceSufficiency } from "./evidence-sufficiency.js";
import { callQloo, describedEntity, PROFILE_TAKE, recordFindTags, recordPool, recordProfile, recordRelated, recordResolved } from "./qloo-gateway.js";
import { validateTerritoryRepresentation } from "./representation-planner.js";
import { resolveInterpretation } from "./router.js";
import { activeTerritories, addTerritory, derivePhase, findTerritory, recordEntity, type AgentRunState } from "./state.js";
import type { AgentToolProvider } from "./tool-provider.js";

export type ToolPermission = "read_only_external" | "local_computation" | "side_effect";

export type ToolContext = { state: AgentRunState; provider: AgentToolProvider; trace: AgentToolCallTrace };

/** What the model sees after a tool runs: a status, one line, and compact data (ids, labels, counts). */
export type ToolResult = { status: "ok" | "empty" | "needs_input" | "failed"; summary: string; data?: unknown; errorCode?: string };

export type AgentTool<I = unknown> = {
  name: string;
  description: string;
  permission: ToolPermission;
  inputSchema: z.ZodType<I>;
  timeoutMs?: number;
  /** Upper bound of Qloo calls (before retries are capped by the budget). */
  maxQlooCalls: number;
  /** Phases in which the tool may run (derived from state, never chosen by the model). */
  phases: readonly AgentRunStatus[];
  /** Further state precondition; returns the refusal reason. */
  precondition?: (state: AgentRunState, input: I) => string | undefined;
  execute: (context: ToolContext, input: I) => Promise<ToolResult>;
};

const text = z.string().trim().min(1);
const rankableType = z.enum(RANKABLE_TYPES);
const AFTER_INTERPRETATION: readonly AgentRunStatus[] = ["RESOLVING", "INVESTIGATING"];
const AFTER_BRAND: readonly AgentRunStatus[] = ["INVESTIGATING"];

function needBrand(state: AgentRunState): string | undefined {
  return state.brand.entity ? undefined : "resolve the brand first";
}

function observedTag(state: AgentRunState, tagId: string): string | undefined {
  return state.tags.has(tagId) ? undefined : `tag ${tagId} has not been returned by Qloo in this run (use qloo_find_tags first)`;
}

const failed = (code: string, detail: string): ToolResult => ({ status: "failed", summary: `${code}: ${detail}`, errorCode: code });

// ---- Local deterministic tools ----

const interpretRequest: AgentTool<{ intent: (typeof AGENT_INTENTS)[number]; brand: string; territories: string[] }> = {
  name: "interpret_request",
  description:
    "Record your structured interpretation of the user's goal: intent (analyze_move = one brand, one target territory; compare_territories = one brand, 2+ named territories; explore_frontier = one brand, territories to discover), the brand as written, and the territories the user named (none for explore_frontier). Validated against the request. If the goal is materially ambiguous, use ask_user instead.",
  permission: "local_computation",
  inputSchema: z.strictObject({ intent: z.enum(AGENT_INTENTS), brand: text.max(200), territories: z.array(text.max(200)).max(6) }),
  maxQlooCalls: 0,
  phases: ["PLANNING"],
  async execute({ state }, input) {
    const check = resolveInterpretation(state.request, input);
    if (!check.ok) return failed("INVALID_INTERPRETATION", check.reason);
    state.interpretation = check.interpretation;
    state.brand.query = check.interpretation.brand;
    state.trace.intent = check.interpretation.intent;
    state.trace.interpretedRequest = { ...check.interpretation };
    if (!state.qlooBudgetExplicit && !state.request.intent) {
      // Budget defaults are per intent (spec §25); the intent is only known now.
      state.limits.maxQlooCalls = Math.max(state.usage.qlooCalls, DEFAULT_QLOO_CALLS[check.interpretation.intent]);
      state.trace.limits.maxQlooCalls = state.limits.maxQlooCalls;
    }
    for (const label of check.interpretation.territories) addTerritory(state, { label, role: "target", origin: "user", rationale: "named by the user" });
    return { status: "ok", summary: `intent ${check.interpretation.intent}; brand "${check.interpretation.brand}"; ${check.interpretation.territories.length} named territory(ies)`, data: { territories: state.territories.map((t) => ({ key: t.key, label: t.label })) } };
  },
};

const proposeTerritory: AgentTool<{ label: string; role: "reference" | "frontier_candidate"; origin: "agent_hypothesis" | "qloo_evidence"; rationale: string; evidenceTagIds?: string[] | undefined }> = {
  name: "propose_territory",
  description:
    "Add a territory hypothesis. role=frontier_candidate (explore_frontier only) or role=reference (a comparison territory that lets the methodology place targets relative to a set of ≥3 territories). origin=qloo_evidence requires evidenceTagIds already returned by Qloo in this run. A hypothesis is only a hypothesis: it must still be anchored to a Qloo concept and represented before it can be analyzed.",
  permission: "local_computation",
  inputSchema: z.strictObject({ label: text.max(120), role: z.enum(["reference", "frontier_candidate"]), origin: z.enum(["agent_hypothesis", "qloo_evidence"]), rationale: text.max(400), evidenceTagIds: z.array(text).max(5).optional() }),
  maxQlooCalls: 0,
  phases: AFTER_BRAND,
  precondition(state, input) {
    if (state.territories.length >= state.limits.maxCandidateTerritories) return `at most ${state.limits.maxCandidateTerritories} territories per run`;
    if (input.role === "frontier_candidate" && state.interpretation?.intent !== "explore_frontier") return "frontier candidates belong to explore_frontier; use role=reference";
    if (state.territories.some((t) => t.label.toLowerCase() === input.label.trim().toLowerCase())) return `"${input.label}" is already a territory`;
    if (input.origin === "qloo_evidence") {
      if (!input.evidenceTagIds?.length) return "origin qloo_evidence requires evidenceTagIds";
      const missing = input.evidenceTagIds.find((id) => !state.tags.has(id));
      if (missing) return `evidence tag ${missing} was not returned by Qloo in this run`;
    }
    return undefined;
  },
  async execute({ state }, input) {
    const t = addTerritory(state, { label: input.label, role: input.role, origin: input.origin, rationale: input.rationale });
    const similar = state.territories.filter((o) => o.key !== t.key && similarLabels(o.label, t.label)).map((o) => o.label);
    return { status: "ok", summary: `added ${t.key}${similar.length ? ` (label resembles ${similar.join(", ")}; check it is meaningfully distinct)` : ""}`, data: { key: t.key } };
  },
};

const anchorTerritory: AgentTool<{ territoryKey: string; tagId: string }> = {
  name: "anchor_territory",
  description: "Anchor a territory to a Qloo concept tag returned in this run (by qloo_find_tags or a tag profile). Two territories cannot share a concept (exact duplicates are refused).",
  permission: "local_computation",
  inputSchema: z.strictObject({ territoryKey: text, tagId: text }),
  maxQlooCalls: 0,
  phases: AFTER_INTERPRETATION,
  precondition(state, input) {
    const t = findTerritory(state, input.territoryKey);
    if (!t || t.status === "dropped") return `unknown territory ${input.territoryKey}`;
    if (t.status === "analyzed") return "territory already analyzed";
    const dup = activeTerritories(state).find((o) => o.key !== t.key && o.concept?.id === input.tagId);
    if (dup) return `concept ${input.tagId} already anchors ${dup.key} (duplicate territory)`;
    return observedTag(state, input.tagId);
  },
  async execute({ state }, input) {
    const t = findTerritory(state, input.territoryKey)!;
    const tag = state.tags.get(input.tagId)!;
    const changed = t.concept !== null && t.concept.id !== tag.id;
    t.concept = { id: tag.id, label: tag.label, type: tag.type };
    if (changed) t.representation = null;
    t.status = "anchored";
    return { status: "ok", summary: `${t.key} anchored to ${tag.label} (${tag.id})${changed ? "; previous representation cleared" : ""}` };
  },
};

const validateRepresentation: AgentTool<{ territoryKey: string; entityType: RankableType; exemplars: { id: string; reason: string }[] }> = {
  name: "validate_territory_representation",
  description:
    "Propose exemplar entities (1–3, preferably 3, ids returned by Qloo in this run) that represent an anchored territory, each with a short selection reason. Deterministic validation checks Qloo links each one to the territory concept through brand-independent evidence, one entity type, no duplicates, no name-family duplicates, not the brand. Valid exemplars are accepted; rejections come back with reasons. Limited attempts per territory.",
  permission: "local_computation",
  inputSchema: z.strictObject({ territoryKey: text, entityType: rankableType, exemplars: z.array(z.strictObject({ id: text, reason: text.max(300) })).min(1).max(6) }),
  maxQlooCalls: 0,
  phases: AFTER_BRAND,
  precondition(state, input) {
    const t = findTerritory(state, input.territoryKey);
    if (!t || t.status === "dropped") return `unknown territory ${input.territoryKey}`;
    if (t.status === "analyzed") return "territory already analyzed";
    if (t.attempts >= state.limits.maxRepresentationAttemptsPerTerritory) return `representation attempts exhausted (${state.limits.maxRepresentationAttemptsPerTerritory})`;
    return undefined;
  },
  async execute({ state }, input) {
    const t = findTerritory(state, input.territoryKey)!;
    t.attempts += 1;
    const validation = validateTerritoryRepresentation(state, { territoryKey: t.key, entityType: input.entityType, exemplars: input.exemplars });
    for (const r of validation.rejected) if (!t.rejectedExemplars.some((x) => x.id === r.id && x.code === r.code)) t.rejectedExemplars.push(r);
    state.trace.representations.push({ territoryKey: t.key, attempt: t.attempts, accepted: validation.accepted ? validation.representation.exemplars.map((e) => e.label) : [], rejected: validation.rejected.map(({ label, code, reason }) => ({ label, code, reason })) });
    const rejected = validation.rejected.map((r) => ({ id: r.id, label: r.label, code: r.code, reason: r.reason }));
    if (!validation.accepted) return { status: "failed", summary: `${validation.failure.code}: ${validation.failure.detail}`, errorCode: validation.failure.code, data: { rejected, attemptsLeft: state.limits.maxRepresentationAttemptsPerTerritory - t.attempts } };
    t.representation = validation.representation;
    t.status = "represented";
    return {
      status: "ok",
      summary: `${t.key}: accepted ${validation.representation.exemplars.map((e) => e.label).join(", ")}; diversity ${validation.representation.diversity}${rejected.length ? `; rejected ${rejected.length}` : ""}`,
      data: { accepted: validation.representation.exemplars.map((e) => ({ id: e.id, label: e.label, support: e.conceptSupport })), rejected, diversity: validation.representation.diversityDetail },
    };
  },
};

const dropTerritory: AgentTool<{ territoryKey: string; code: "TERRITORY_UNRESOLVED" | "TERRITORY_AMBIGUOUS" | "NO_VALID_REPRESENTATION" | "DUPLICATE_TERRITORY" | "QLOO_EMPTY"; reason: string }> = {
  name: "drop_territory",
  description: "Remove a territory from scope with a taxonomy code and reason (e.g. Qloo has no concept for it, or it duplicates another). It stays in the result as unsupported; it is never silently deleted.",
  permission: "local_computation",
  inputSchema: z.strictObject({ territoryKey: text, code: z.enum(["TERRITORY_UNRESOLVED", "TERRITORY_AMBIGUOUS", "NO_VALID_REPRESENTATION", "DUPLICATE_TERRITORY", "QLOO_EMPTY"]), reason: text.max(300) }),
  maxQlooCalls: 0,
  phases: AFTER_INTERPRETATION,
  precondition(state, input) {
    const t = findTerritory(state, input.territoryKey);
    if (!t || t.status === "dropped") return `unknown territory ${input.territoryKey}`;
    return t.status === "analyzed" ? "territory already analyzed" : undefined;
  },
  async execute({ state }, input) {
    const t = findTerritory(state, input.territoryKey)!;
    t.status = "dropped";
    t.dropReason = { code: input.code, detail: input.reason };
    return { status: "ok", summary: `${t.key} dropped (${input.code})` };
  },
};

const sufficiencyTool: AgentTool<Record<string, never>> = {
  name: "assess_evidence_sufficiency",
  description: "Deterministic check of whether more investigation is useful. The same assessment is already in your context each turn.",
  permission: "local_computation",
  inputSchema: z.strictObject({}),
  maxQlooCalls: 0,
  phases: ["PLANNING", "RESOLVING", "INVESTIGATING"],
  async execute({ state }) {
    const a = assessEvidenceSufficiency(state);
    return { status: "ok", summary: a.verdict, data: a };
  },
};

// ---- Qloo-facing tools (read_only_external) ----

const resolveEntity: AgentTool<{ name: string; type: RankableType; role: "brand" | "other" }> = {
  name: "qloo_resolve_entity",
  description:
    "Resolve a named entity (or a Qloo id) to a Qloo entity with qloo describe. role=brand resolves the analysis subject. Ambiguous names return candidates: the runtime resolves only when exactly one candidate has the requested type; otherwise the user must choose (ask_user).",
  permission: "read_only_external",
  inputSchema: z.strictObject({ name: text.max(200), type: rankableType, role: z.enum(["brand", "other"]) }),
  maxQlooCalls: 1,
  phases: AFTER_INTERPRETATION,
  precondition(state, input) {
    if (input.role === "brand" && state.brand.entity) return "the brand is already resolved";
    if (input.role === "brand" && state.brand.ambiguity && state.clarifications.length === 0) return "the brand is ambiguous; ask the user before resolving it";
    return undefined;
  },
  async execute({ state, provider, trace }, input) {
    if (input.role === "brand") state.brand.attempts += 1;
    const result = await callQloo(state, provider, trace, "describe", { entity: input.name, type: input.type });
    if (result.outcome === "failed") return failed(result.code, result.detail);
    if (result.outcome === "needs_input") {
      const issue = result.issues[0];
      const candidates = issue?.candidates ?? [];
      if (input.role === "brand") {
        const wanted = candidates.filter((c) => shortEntityType(c.type) === input.type);
        if (issue?.kind === "ambiguous" && wanted.length === 1) {
          const chosen = wanted[0]!;
          const correlationId = result.call.envelope.execution.correlation_id;
          recordEntity(state, { id: chosen.qlooId, label: chosen.label, type: input.type }, { kind: "resolved", tagIds: [], conditionedOn: null, correlationId, popularity: null });
          state.brand.entity = { id: chosen.qlooId, label: chosen.label, type: chosen.type ?? `urn:entity:${input.type}`, match: "type_evidence", resolution: "unconfirmed", call: result.call };
          state.brand.ambiguity = null;
          state.flags.push({ code: "BRAND_RESOLVED_BY_TYPE_EVIDENCE", detail: `"${input.name}" was ambiguous; resolved to ${chosen.label} because it is the only ${input.type} candidate` });
          state.trace.resolvedEntities.push({ role: "brand", id: chosen.qlooId, label: chosen.label, type: state.brand.entity.type, match: "type_evidence", resolution: "unconfirmed" });
          return { status: "ok", summary: `brand resolved by type evidence to ${chosen.label} (${chosen.qlooId})` };
        }
        if (issue?.kind === "ambiguous" && candidates.length > 0) state.brand.ambiguity = { input: input.name, candidates, correlationId: result.call.envelope.execution.correlation_id };
        else state.brand.notFound = true;
      }
      return { status: "needs_input", summary: `${issue?.kind ?? "unresolved"}: ${candidates.length} candidate(s)`, data: { kind: issue?.kind ?? null, candidates: candidates.map((c) => ({ id: c.qlooId, label: c.label, type: c.type ?? null })) } };
    }
    if (result.outcome === "empty" || !describedEntity(result.call)) {
      if (input.role === "brand") state.brand.notFound = true;
      return { status: "empty", summary: `no Qloo entity for "${input.name}"` };
    }
    const entity = recordResolved(state, result.call)!;
    state.trace.resolvedEntities.push({ role: input.role, id: entity.id, label: entity.label, type: entity.type, match: entity.match, resolution: entity.match === "exact" || entity.match === "identifier" ? "confirmed" : "unconfirmed" });
    if (input.role === "brand") {
      if (state.brand.ambiguity && !state.brand.ambiguity.candidates.some((c) => c.qlooId === entity.id)) {
        state.flags.push({ code: "BRAND_CLARIFIED_OUTSIDE_CANDIDATES", detail: `resolved ${entity.label}, which was not among the ambiguous candidates` });
      }
      state.brand.entity = { ...entity, resolution: entity.match === "exact" || entity.match === "identifier" ? "confirmed" : "unconfirmed", call: result.call };
      state.brand.ambiguity = null;
    }
    return { status: "ok", summary: `${entity.label} (${entity.id}, ${entity.type}, match ${entity.match ?? "n/a"})`, data: { id: entity.id, label: entity.label, type: entity.type } };
  },
};

const findTags: AgentTool<{ query: string; limit: number }> = {
  name: "qloo_find_tags",
  description: "Search Qloo's tag vocabulary for a cultural concept (semantic). Returns tag ids, names and namespaces. A territory needs one of these as its anchor.",
  permission: "read_only_external",
  inputSchema: z.strictObject({ query: text.max(120), limit: z.number().int().min(1).max(10).default(8) }),
  maxQlooCalls: 1,
  phases: AFTER_INTERPRETATION,
  async execute({ state, provider, trace }, input) {
    const result = await callQloo(state, provider, trace, "find_tags", { query: input.query, semantic: true, limit: input.limit });
    if (result.outcome === "failed") return failed(result.code, result.detail);
    if (result.outcome !== "ok") return { status: "empty", summary: `no Qloo tags for "${input.query}"`, data: { query: input.query, tags: [] } };
    const tags = recordFindTags(state, result.call, input.query);
    return { status: "ok", summary: `${tags.length} tag(s)`, data: { query: input.query, tags: tags.map((t) => ({ id: t.qlooId, label: t.label, namespace: t.type ?? null })) } };
  },
};

const getEntityTags: AgentTool<{ entityId: string }> = {
  name: "qloo_get_entity_tags",
  description: `Fetch an entity's Qloo tag profile (top ${PROFILE_TAKE}, fixed take). Use it to understand the brand, to check an exemplar's link to a concept, or to find concepts carried by related entities.`,
  permission: "read_only_external",
  inputSchema: z.strictObject({ entityId: text }),
  maxQlooCalls: 1,
  phases: AFTER_BRAND,
  precondition: (state, input) => (state.entities.has(input.entityId) ? undefined : `entity ${input.entityId} has not been returned by Qloo in this run`),
  async execute({ state, provider, trace }, input) {
    if (state.profiles.has(input.entityId)) return { status: "ok", summary: "profile already collected", data: profileView(state, input.entityId) };
    const result = await callQloo(state, provider, trace, "entity_tags", { entities: [input.entityId], limit: PROFILE_TAKE });
    if (result.outcome === "failed") return failed(result.code, result.detail);
    if (result.outcome === "needs_input") return { status: "needs_input", summary: "Qloo could not resolve the entity" };
    recordProfile(state, input.entityId, result.call);
    return { status: result.outcome, summary: `${state.profiles.get(input.entityId)!.tagIds.length} tag(s)`, data: profileView(state, input.entityId) };
  },
};

function profileView(state: AgentRunState, id: string) {
  return (state.profiles.get(id)?.tagIds ?? []).map((tagId) => ({ id: tagId, label: state.tags.get(tagId)?.label ?? tagId }));
}

const recommend: AgentTool<{ targetType: RankableType; tagIds: string[]; conditionOnBrand: boolean; limit: number }> = {
  name: "qloo_recommend",
  description:
    "Entities of one type that Qloo associates with concept tag(s). conditionOnBrand=false gives a brand-independent tag-member pool (use it to discover exemplar candidates; Qloo's order here is not meaningful, popularity is shown). conditionOnBrand=true gives the brand-conditioned list for the concept (evidence about the brand; NOT a source of exemplars). Tags must have been returned by Qloo in this run.",
  permission: "read_only_external",
  inputSchema: z.strictObject({ targetType: rankableType, tagIds: z.array(text).min(1).max(3), conditionOnBrand: z.boolean(), limit: z.number().int().min(1).max(20).default(20) }),
  maxQlooCalls: 1,
  phases: AFTER_BRAND,
  precondition: (state, input) => needBrand(state) ?? input.tagIds.map((id) => observedTag(state, id)).find((r) => r !== undefined),
  async execute({ state, provider, trace }, input) {
    const brandId = state.brand.entity!.id;
    const qlooInput = input.conditionOnBrand
      ? { target_type: input.targetType, signals: [brandId], include_tags: input.tagIds, limit: input.limit, explain: false }
      : { target_type: input.targetType, signal_tags: input.tagIds, include_tags: input.tagIds, include_tags_operator: "intersection" as const, limit: input.limit, explain: false };
    const result = await callQloo(state, provider, trace, "recommend", qlooInput);
    if (result.outcome === "failed") return failed(result.code, result.detail);
    if (result.outcome === "needs_input") return { status: "needs_input", summary: "Qloo could not resolve a signal or tag" };
    const already = state.pools.some((p) => p.call.envelope.execution.correlation_id === result.call.envelope.execution.correlation_id);
    const ids = already ? state.pools.find((p) => p.call.envelope.execution.correlation_id === result.call.envelope.execution.correlation_id)!.memberIds : recordPool(state, result.call, { tagIds: input.tagIds, targetType: input.targetType, conditionedOn: input.conditionOnBrand ? brandId : null });
    const scope = { tagIds: input.tagIds, targetType: input.targetType, conditionOnBrand: input.conditionOnBrand };
    if (ids.length === 0) return { status: "empty", summary: `Qloo returned no ${input.targetType} entities for ${input.tagIds.join(" + ")}`, data: { ...scope, members: [] } };
    const members = ids.map((id) => {
      const e = state.entities.get(id)!;
      return { id, label: e.label, popularity: e.sources.find((s) => s.correlationId === result.call.envelope.execution.correlation_id)?.popularity ?? null, isBrand: id === brandId };
    });
    return { status: "ok", summary: `${ids.length} ${input.targetType} entities${input.conditionOnBrand ? " (brand-conditioned: evidence only, not exemplar candidates)" : " (brand-independent pool)"}`, data: { ...scope, members } };
  },
};

const relatedEntities: AgentTool<{ entityId: string; targetType: RankableType; limit: number }> = {
  name: "qloo_related_entities",
  description: "Entities of a type that Qloo associates with one entity (recommend with that entity as the only signal). Use for frontier discovery: concepts carried by entities related to the brand but not by the brand itself.",
  permission: "read_only_external",
  inputSchema: z.strictObject({ entityId: text, targetType: rankableType, limit: z.number().int().min(1).max(10).default(5) }),
  maxQlooCalls: 1,
  phases: AFTER_BRAND,
  precondition: (state, input) => (state.entities.has(input.entityId) ? undefined : `entity ${input.entityId} has not been returned by Qloo in this run`),
  async execute({ state, provider, trace }, input) {
    const result = await callQloo(state, provider, trace, "recommend", { target_type: input.targetType, signals: [input.entityId], limit: input.limit, explain: false });
    if (result.outcome === "failed") return failed(result.code, result.detail);
    if (result.outcome !== "ok") return { status: "empty", summary: "no related entities" };
    const ids = state.related.some((r) => r.call.envelope.execution.correlation_id === result.call.envelope.execution.correlation_id) ? [] : recordRelated(state, result.call, input.entityId, input.targetType);
    return { status: "ok", summary: `${ids.length} related ${input.targetType} entities`, data: ids.map((id) => ({ id, label: state.entities.get(id)!.label })) };
  },
};

export const AGENT_TOOLS: readonly AgentTool<never>[] = [
  interpretRequest,
  resolveEntity,
  findTags,
  getEntityTags,
  recommend,
  relatedEntities,
  proposeTerritory,
  anchorTerritory,
  validateRepresentation,
  dropTerritory,
  sufficiencyTool,
] as unknown as readonly AgentTool<never>[];

/** Internal deterministic tools invoked by the `analyze` decision (traced, never model-callable). */
export const INTERNAL_TOOL_NAMES = ["analyze_evidence", "build_candidate_panel", "run_elasticity_methodology", "assess_representation_robustness"] as const;

export class ToolRegistry {
  private readonly tools: Map<string, AgentTool<never>>;
  constructor(tools: readonly AgentTool<never>[] = AGENT_TOOLS) {
    this.tools = new Map(tools.map((t) => [t.name, t]));
  }
  get(name: string): AgentTool<never> | undefined {
    return this.tools.get(name);
  }
  list(): AgentTool<never>[] {
    return [...this.tools.values()];
  }
  /** Tools whose phase allows them now (what the model is offered this turn). */
  available(state: AgentRunState): AgentTool<never>[] {
    const phase = derivePhase(state);
    return this.list().filter((t) => t.phases.includes(phase));
  }
}

/** JSON schema of a tool input, for model providers. */
export function toolJsonSchema(tool: AgentTool<never>): Record<string, unknown> {
  return z.toJSONSchema(tool.inputSchema as z.ZodType, { io: "input" }) as Record<string, unknown>;
}
