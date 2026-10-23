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
import { applyConceptDedup, canonicalTagName, deterministicDuplicate } from "./concept-dedup.js";
import { AGENT_INTENTS, RANKABLE_TYPES, shortEntityType, type RankableType } from "./contracts.js";
import { assessEvidenceSufficiency } from "./evidence-sufficiency.js";
import { callQloo, describedEntity, PROFILE_TAKE, recordFindTags, recordPool, recordProfile, recordRelated, recordResolved } from "./qloo-gateway.js";
import { strategyExhausted } from "./readiness.js";
import { referenceCandidates } from "./reference-strategy.js";
import { alternateAnchorRefusal, anchorOnObservedMembers, FRONTIER_EVIDENCE_BASE, FRONTIER_RELATED_TAKE, recordAnchorDecision } from "./frontier.js";
import { alignmentDeferral } from "./representation-alignment.js";
import { validateTerritoryRepresentation } from "./representation-planner.js";
import { applyInterpretation, resolveInterpretation } from "./router.js";
import { assessReferenceConcept, incidentalConcept } from "./semantic-comparison.js";
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
    applyInterpretation(state, check.interpretation, "agent_turn");
    return { status: "ok", summary: `intent ${check.interpretation.intent}; brand "${check.interpretation.brand}"; ${check.interpretation.territories.length} named territory(ies)`, data: { territories: state.territories.map((t) => ({ key: t.key, label: t.label })) } };
  },
};

const semanticSchema = z.strictObject({ relevance: z.enum(["strong", "adequate", "weak", "mismatch"]), reason: text.max(300) });

const proposeTerritory: AgentTool<{ label: string; role: "reference" | "frontier_candidate"; origin: "agent_hypothesis" | "qloo_evidence"; rationale: string; evidenceTagIds?: string[] | undefined; semantic?: { relevance: "strong" | "adequate" | "weak" | "mismatch"; reason: string } | undefined }> = {
  name: "propose_territory",
  description:
    "Add a territory hypothesis (no Qloo call). role=reference: a comparison territory so a single move can be placed in a set of ≥3 territories of one entity type — pick it from referenceCandidates with semantic MEANINGFUL, pass its tag in evidenceTagIds, and give your semantic judgment (is it a meaningful cultural alternative to the target, at the same analytical level? strong|adequate|weak|mismatch + reason; weak/mismatch removes it). Venue amenities, decor and operational tags are refused. A reference with one evidence tag that the semantic validator accepts is anchored to it at once (validate it in the same turn). role=frontier_candidate: explore_frontier only. origin=qloo_evidence requires evidenceTagIds returned by Qloo in this run; origin=agent_hypothesis must later be found in Qloo, anchored and shown to have members, or it is dropped. Exact duplicates are refused. Next step: anchor_territory.",
  permission: "local_computation",
  inputSchema: z.strictObject({ label: text.max(120), role: z.enum(["reference", "frontier_candidate"]), origin: z.enum(["agent_hypothesis", "qloo_evidence"]), rationale: text.max(400), evidenceTagIds: z.array(text).max(5).optional(), semantic: semanticSchema.optional() }),
  maxQlooCalls: 0,
  phases: AFTER_BRAND,
  precondition(state, input) {
    if (state.territories.length >= state.limits.maxCandidateTerritories) return `at most ${state.limits.maxCandidateTerritories} territories per run`;
    if (input.role === "frontier_candidate" && state.interpretation?.intent !== "explore_frontier") return "frontier candidates belong to explore_frontier; use role=reference";
    const proposed = { label: input.label, conceptId: input.evidenceTagIds?.length === 1 ? input.evidenceTagIds[0]! : null };
    const dup = state.territories.find((o) => o.status !== "dropped" && deterministicDuplicate({ label: o.label, conceptId: o.concept?.id ?? null }, proposed)?.verdict === "DUPLICATE");
    if (dup) return `"${input.label}" duplicates the territory ${dup.key} (${deterministicDuplicate({ label: dup.label, conceptId: dup.concept?.id ?? null }, proposed)!.basis})`;
    if (input.origin === "qloo_evidence") {
      if (!input.evidenceTagIds?.length) return "origin qloo_evidence requires evidenceTagIds";
      const missing = input.evidenceTagIds.find((id) => !state.tags.has(id));
      if (missing) return `evidence tag ${missing} was not returned by Qloo in this run`;
      const incidental = input.evidenceTagIds.map((id) => [id, incidentalConcept(id)] as const).find(([, x]) => x);
      if (incidental) return `${incidental[0]} is a ${incidental[1]!.explanation}; choose a cultural concept`;
    }
    return undefined;
  },
  async execute({ state }, input) {
    const reference = input.role === "reference" ? referenceCandidates(state).find((c) => input.evidenceTagIds?.includes(c.tagId)) : undefined;
    const evidence = input.origin === "qloo_evidence" ? `Qloo tag(s) ${(input.evidenceTagIds ?? []).join(", ")}${reference ? `; ${reference.justification}` : ""}` : `agent hypothesis: ${input.rationale}`;
    const t = addTerritory(state, { label: input.label, role: input.role, origin: input.origin, rationale: input.rationale, source: input.role === "reference" ? "reference_strategy" : input.origin === "agent_hypothesis" ? "agent_hypothesis" : "qloo_grounded", sourceEvidence: evidence.slice(0, 400), sourceTagId: input.origin === "qloo_evidence" ? (input.evidenceTagIds?.[0] ?? null) : null, evidenceTagIds: input.origin === "qloo_evidence" ? (input.evidenceTagIds ?? []) : [] });
    if (input.semantic) t.semanticJudgment = { relevance: input.semantic.relevance.toUpperCase() as "STRONG" | "ADEQUATE" | "WEAK" | "MISMATCH", reason: input.semantic.reason.trim() };
    // Sprint 5A.1 (live L-C2: propose, anchor and validate spread over three turns, so usable references were never
    // validated): a reference proposed with exactly one Qloo evidence tag IS that concept. When the semantic validator
    // accepts it and no territory uses it, it is anchored now; a rejected one still goes through anchor_territory's checks.
    const tagId = input.role === "reference" && input.evidenceTagIds?.length === 1 ? input.evidenceTagIds[0]! : null;
    const tag = tagId ? state.tags.get(tagId) : undefined;
    if (tag && !activeTerritories(state).some((o) => o.key !== t.key && o.concept?.id === tag.id) && assessReferenceConcept(state, tag.id, t.semanticJudgment).status === "MEANINGFUL") {
      t.concept = { id: tag.id, label: tag.label, type: tag.type };
      t.status = "anchored";
    }
    const near = state.territories.filter((o) => o.key !== t.key && o.status !== "dropped" && deterministicDuplicate({ label: o.label, conceptId: o.concept?.id ?? null }, { label: t.label, conceptId: null })?.verdict === "NEAR_DUPLICATE").map((o) => o.label);
    return { status: "ok", summary: `added ${t.key}${t.concept ? ` (anchored to ${t.concept.label}; next: validate_territory_representation)` : ""}${near.length ? ` (word-family match with ${near.join(", ")}: it will be dropped as a near-duplicate unless assess_concept_duplicates judges it distinct)` : ""}`, data: { key: t.key } };
  },
};

const anchorTerritory: AgentTool<{ territoryKey: string; tagId: string }> = {
  name: "anchor_territory",
  description: "No Qloo call. Anchor a territory to one Qloo concept tag returned in this run (by qloo_find_tags or a tag profile). Use it once a tag clearly names the territory, preferably one Qloo returned members for. Two territories cannot share a concept. A reference anchored to a non-meaningful concept (venue attribute, weak tie) is dropped with the reason. Next: qloo_recommend on the concept, then validate_territory_representation.",
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
    if (t.role !== "target") {
      const canonical = activeTerritories(state).find((o) => o.key !== t.key && o.concept && canonicalTagName(o.concept.id) === canonicalTagName(input.tagId));
      if (canonical) return `concept ${input.tagId} has the same canonical name as ${canonical.concept!.id}, which anchors ${canonical.key} (duplicate concept in another namespace)`;
    }
    const unobserved = observedTag(state, input.tagId);
    if (unobserved) return unobserved;
    // Sprint 5A.2: a grounded frontier candidate keeps its concept identity; an alternate anchor needs Qloo support.
    const alternate = alternateAnchorRefusal(state, t, input.tagId);
    if (alternate) return `ALTERNATE_ANCHOR_REFUSED: ${alternate.code} — ${alternate.reason}`;
    // Sprint 5A.1: bounded entity-type alignment for comparisons (representation-alignment.ts).
    const deferral = alignmentDeferral(state, t, input.tagId);
    return deferral ? `TYPE_ALIGNMENT_PENDING: ${deferral}` : undefined;
  },
  async execute({ state }, input) {
    const t = findTerritory(state, input.territoryKey)!;
    const tag = state.tags.get(input.tagId)!;
    if (t.role === "reference") {
      // Sprint 5A: a reference must be a meaningful comparison territory before any Qloo call is spent on it.
      const verdict = assessReferenceConcept(state, tag.id, t.semanticJudgment);
      if (verdict.status !== "MEANINGFUL") {
        t.status = "dropped";
        const detail = `${tag.label}: ${verdict.status} — ${verdict.explanation}`;
        t.dropReason = { code: "SEMANTIC_REFERENCE_REJECTED", detail };
        state.candidateRejections.push({ key: t.key, stage: "semantic", code: verdict.reasonCode, reason: detail });
        return { status: "failed", summary: `SEMANTIC_REFERENCE_REJECTED: ${t.key} dropped — ${tag.label} is ${verdict.status} as a comparison territory (${verdict.explanation}). Choose another referenceCandidate with semantic MEANINGFUL, or analyze and accept a PARTIAL result.`, errorCode: "SEMANTIC_REFERENCE_REJECTED" };
      }
    }
    const changed = t.concept !== null && t.concept.id !== tag.id;
    t.concept = { id: tag.id, label: tag.label, type: tag.type };
    if (changed) t.representation = null;
    t.status = "anchored";
    if (t.role === "frontier_candidate" && t.sourceTagId) {
      const alternate = tag.id !== t.sourceTagId && !t.evidenceTagIds.includes(tag.id);
      recordAnchorDecision(state, t, tag.id, alternate ? "ALTERNATE_WITH_MEMBERS" : "MODEL_ANCHOR", "agent", null, alternate ? "alternate with observed Qloo members; the grounding tag returned none" : "anchored to its own evidence tag");
    }
    return { status: "ok", summary: `${t.key} anchored to ${tag.label} (${tag.id})${changed ? "; previous representation cleared" : ""}` };
  },
};

const validateRepresentation: AgentTool<{ territoryKey: string; entityType: RankableType; exemplars: { id: string; reason: string; semantic?: { relevance: "strong" | "adequate" | "weak" | "mismatch"; reason: string } | undefined }[] }> = {
  name: "validate_territory_representation",
  description:
    "No Qloo call. Propose exemplar entities (1–3, preferably 3, ids returned by Qloo in this run) that represent an anchored territory, each with a short selection reason and optionally your semantic judgment (relevance strong|adequate|weak|mismatch + reason). The deterministic quality evaluator checks Qloo links each one to the concept through brand-independent evidence, one entity type, no duplicates or name families, not the brand, and — when peer profiles are known — that it is not a cultural outlier among Qloo's members. Your judgment is advisory: it can remove a candidate, never add Qloo support. If only weak exemplars survive, the representation is refused. A (concept, type) strategy that fails twice is exhausted.",
  permission: "local_computation",
  inputSchema: z.strictObject({ territoryKey: text, entityType: rankableType, exemplars: z.array(z.strictObject({ id: text, reason: text.max(300), semantic: semanticSchema.optional() })).min(1).max(6) }),
  maxQlooCalls: 0,
  phases: AFTER_BRAND,
  precondition(state, input) {
    const t = findTerritory(state, input.territoryKey);
    if (!t || t.status === "dropped") return `unknown territory ${input.territoryKey}`;
    if (t.status === "analyzed") return "territory already analyzed";
    if (t.attempts >= state.limits.maxRepresentationAttemptsPerTerritory) return `representation attempts exhausted (${state.limits.maxRepresentationAttemptsPerTerritory})`;
    if (t.concept && strategyExhausted(t, t.concept.id, input.entityType)) return `STRATEGY_EXHAUSTED: ${input.entityType} exemplars for ${t.concept.label} failed twice; try another entity type, an alternate Qloo concept, or declare_concept_only`;
    return undefined;
  },
  async execute({ state }, input) {
    const t = findTerritory(state, input.territoryKey)!;
    t.attempts += 1;
    const proposal = { territoryKey: t.key, entityType: input.entityType, exemplars: input.exemplars.map((e) => ({ id: e.id, reason: e.reason, ...(e.semantic && { semantic: { relevance: e.semantic.relevance.toUpperCase() as "STRONG" | "ADEQUATE" | "WEAK" | "MISMATCH", reason: e.semantic.reason } }) })) };
    const validation = validateTerritoryRepresentation(state, proposal, t.attempts);
    state.trace.representationQuality.push(...validation.decisions);
    for (const r of validation.rejected) if (!t.rejectedExemplars.some((x) => x.id === r.id && x.code === r.code)) t.rejectedExemplars.push(r);
    if (t.concept) t.strategyLog.push({ conceptId: t.concept.id, entityType: input.entityType, attempt: t.attempts, outcome: validation.accepted ? "accepted" : validation.failure.code === "REPRESENTATION_QUALITY_WEAK" ? "weak" : "rejected" });
    state.trace.representations.push({ territoryKey: t.key, attempt: t.attempts, accepted: validation.accepted ? validation.representation.exemplars.map((e) => e.label) : [], rejected: validation.rejected.map(({ label, code, reason }) => ({ label, code, reason })) });
    const rejected = validation.rejected.map((r) => ({ id: r.id, label: r.label, code: r.code, reason: r.reason }));
    const quality = validation.decisions.map((d) => ({ id: d.candidateId, label: d.label, final: d.final, rule: d.rule, weakSignals: d.deterministic.reasons.filter((r) => /^(PEER_OUTLIER|CONCEPT_ABSENT|quality unverified)/u.test(r)) }));
    if (!validation.accepted) return { status: "failed", summary: `${validation.failure.code}: ${validation.failure.detail}`, errorCode: validation.failure.code, data: { rejected, quality, attemptsLeft: state.limits.maxRepresentationAttemptsPerTerritory - t.attempts } };
    t.representation = validation.representation;
    t.status = "represented";
    return {
      status: "ok",
      summary: `${t.key}: accepted ${validation.representation.exemplars.map((e) => `${e.label}${e.quality === "WEAK" ? " (weak alternate)" : ""}`).join(", ")}; diversity ${validation.representation.diversity}${rejected.length ? `; rejected ${rejected.length}` : ""}`,
      data: { accepted: validation.representation.exemplars.map((e) => ({ id: e.id, label: e.label, support: e.conceptSupport, quality: e.quality })), rejected, quality, diversity: validation.representation.diversityDetail },
    };
  },
};

const declareConceptOnly: AgentTool<{ territoryKey: string; reason: string }> = {
  name: "declare_concept_only",
  description:
    "No Qloo call. Recovery step of last resort: represent an anchored territory by concept-level evidence only (brand-conditioned results for the concept) when recoveryGuidance shows no remaining strategy. The territory then gets a partial or descriptive route, never a relative position. Use it instead of forcing a weak panel; not while an available strategy remains.",
  permission: "local_computation",
  inputSchema: z.strictObject({ territoryKey: text, reason: text.max(300) }),
  maxQlooCalls: 0,
  phases: AFTER_BRAND,
  precondition(state, input) {
    const t = findTerritory(state, input.territoryKey);
    if (!t || t.status === "dropped") return `unknown territory ${input.territoryKey}`;
    if (t.status === "analyzed") return "territory already analyzed";
    if (!t.concept) return "anchor the territory to a Qloo concept first";
    if (t.representation) return "the territory already has a validated representation";
    return undefined;
  },
  async execute({ state }, input) {
    const t = findTerritory(state, input.territoryKey)!;
    t.conceptOnly = input.reason.trim();
    return { status: "ok", summary: `${t.key}: concept-only evidence (${t.concept!.label}); no exemplar panel` };
  },
};

const assessConceptDuplicates: AgentTool<{ judgments: { a: string; b: string; verdict: "DUPLICATE" | "NEAR_DUPLICATE" | "DISTINCT"; reason: string }[] }> = {
  name: "assess_concept_duplicates",
  description:
    "Give your semantic judgment on whether pairs of territory hypotheses are the same cultural concept (DUPLICATE / NEAR_DUPLICATE / DISTINCT, with a concise reason). Advisory layer 3 of the concept deduplicator: it cannot override an exact deterministic duplicate or Qloo structural overlap; it may mark a word-family match as distinct, or flag a pair the deterministic layers missed. Duplicated generated candidates are dropped; user targets are only flagged.",
  permission: "local_computation",
  inputSchema: z.strictObject({ judgments: z.array(z.strictObject({ a: text, b: text, verdict: z.enum(["DUPLICATE", "NEAR_DUPLICATE", "DISTINCT"]), reason: text.max(300) })).min(1).max(10) }),
  maxQlooCalls: 0,
  phases: AFTER_BRAND,
  precondition(state, input) {
    for (const j of input.judgments) {
      for (const key of [j.a, j.b]) if (!state.territories.some((t) => t.key === key && t.status !== "dropped")) return `unknown territory ${key}`;
      if (j.a === j.b) return "a pair needs two different territories";
    }
    return undefined;
  },
  async execute({ state }, input) {
    for (const j of input.judgments) state.dedupJudgments.push({ aKey: j.a, bKey: j.b, verdict: j.verdict, reason: j.reason.trim() });
    const dropped = applyConceptDedup(state, activeTerritories(state));
    return { status: "ok", summary: `${input.judgments.length} judgment(s) recorded${dropped.length ? `; dropped ${dropped.join(", ")}` : ""}`, data: { dropped, decisions: state.trace.conceptDedup.slice(-10).map((d) => ({ a: d.a.key, b: d.b.key, verdict: d.verdict, layer: d.layer, action: d.action })) } };
  },
};

const dropTerritory: AgentTool<{ territoryKey: string; code: "TERRITORY_UNRESOLVED" | "TERRITORY_AMBIGUOUS" | "NO_VALID_REPRESENTATION" | "DUPLICATE_TERRITORY" | "QLOO_EMPTY"; reason: string }> = {
  name: "drop_territory",
  description: "No Qloo call. Remove a territory from scope with a taxonomy code and reason (Qloo has no concept for it, or it duplicates another). It stays in the result as unsupported; never silently deleted. Do not drop a user-named territory that still has a recovery option.",
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
    state.candidateRejections.push({ key: t.key, stage: input.code === "DUPLICATE_TERRITORY" ? "dedup" : input.code === "NO_VALID_REPRESENTATION" ? "representation" : input.code === "QLOO_EMPTY" ? "qloo_support" : "resolution", code: input.code, reason: input.reason });
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
    "1 Qloo call. Resolve a named entity (or a Qloo id) with qloo describe. role=brand resolves the analysis subject (once). Ambiguous names return candidates: the runtime resolves only when exactly one candidate has the requested type; otherwise ask_user. After the user answers, resolve the chosen candidate id.",
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
  description: "1 Qloo call. Search Qloo's tag vocabulary for a territory's concept (semantic). Returns tag ids, names and namespaces; a territory needs one as its anchor. Use once per territory label; a repeated query is refused. Not for exemplars.",
  permission: "read_only_external",
  inputSchema: z.strictObject({ query: text.max(120), limit: z.number().int().min(1).max(10).default(8) }),
  maxQlooCalls: 1,
  phases: AFTER_INTERPRETATION,
  async execute({ state, provider, trace }, input) {
    const result = await callQloo(state, provider, trace, "find_tags", { query: input.query, semantic: true, limit: input.limit });
    if (result.outcome === "failed") return failed(result.code, result.detail);
    const key = input.query.trim().toLowerCase();
    if (result.outcome !== "ok") {
      if (!state.searchedQueries.has(key)) state.searchedQueries.set(key, []);
      return { status: "empty", summary: `no Qloo tags for "${input.query}"`, data: { query: input.query, tags: [] } };
    }
    const tags = recordFindTags(state, result.call, input.query);
    state.searchedQueries.set(key, [...new Set([...(state.searchedQueries.get(key) ?? []), ...tags.map((t) => t.qlooId)])]);
    return { status: "ok", summary: `${tags.length} tag(s)`, data: { query: input.query, tags: tags.map((t) => ({ id: t.qlooId, label: t.label, namespace: t.type ?? null })) } };
  },
};

const getEntityTags: AgentTool<{ entityId: string }> = {
  name: "qloo_get_entity_tags",
  description: `1 Qloo call. Fetch an entity's Qloo tag profile (top ${PROFILE_TAKE}, fixed take). Use it for the brand profile, for candidate exemplars before validating them (the quality check compares peers), or for related entities (frontier concepts). A profile already collected is refused (it cannot grow). The entity id must have been returned by Qloo in this run.`,
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
    "1 Qloo call. Entities of one type that Qloo associates with concept tag(s). conditionOnBrand=false: a brand-independent member pool — use it to test whether a concept has members of an entity type and to discover exemplar candidates (order not meaningful; popularity shown). conditionOnBrand=true: the brand-conditioned list (evidence about the brand, never exemplars; analysis collects it itself). Several tagIds are an INTERSECTION (members must carry every tag), so probe one tag per call. Choose the entity type from the territory's nextProbe (ranked by Qloo evidence: members for this concept, then for its tag namespace, then the comparison's shared type); after 3 empty types a concept is not probed further, and a type that returned nothing for 2 other concepts of the namespace is deferred. A frontier candidate whose own grounding tag returns members is anchored to it automatically. Tags must have been returned by Qloo in this run.",
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
    // Sprint 5A.2: a territory whose own concept (grounding tag, or same-named searched tag) returned members is anchored.
    const anchored = !input.conditionOnBrand && input.tagIds.length === 1 && !already ? anchorOnObservedMembers(state, input.tagIds[0]!, input.targetType, ids.filter((id) => id !== brandId).length) : [];
    const members = ids.map((id) => {
      const e = state.entities.get(id)!;
      return { id, label: e.label, popularity: e.sources.find((s) => s.correlationId === result.call.envelope.execution.correlation_id)?.popularity ?? null, isBrand: id === brandId };
    });
    return { status: "ok", summary: `${ids.length} ${input.targetType} entities${input.conditionOnBrand ? " (brand-conditioned: evidence only, not exemplar candidates)" : " (brand-independent pool)"}${anchored.length ? `; ${anchored.join(", ")} anchored to this tag (its own concept; next: validate_territory_representation with ${input.targetType})` : ""}`, data: { ...scope, members, ...(anchored.length && { anchored }) } };
  },
};

const relatedEntities: AgentTool<{ entityId: string; targetType: RankableType; limit: number }> = {
  name: "qloo_related_entities",
  description: `1 Qloo call. Entities of a type that Qloo associates with one entity (that entity as the only signal). Use for frontier discovery (then fetch the tag profiles of the first ${FRONTIER_EVIDENCE_BASE} in Qloo's order — the evidence base: frontierConcepts lists concepts they carry that the brand does not). For the brand, the take is fixed at ${FRONTIER_RELATED_TAKE} (Qloo's order depends on it). Not for exemplars.`,
  permission: "read_only_external",
  inputSchema: z.strictObject({ entityId: text, targetType: rankableType, limit: z.number().int().min(1).max(10).default(5) }),
  maxQlooCalls: 1,
  phases: AFTER_BRAND,
  precondition: (state, input) => (state.entities.has(input.entityId) ? undefined : `entity ${input.entityId} has not been returned by Qloo in this run`),
  async execute({ state, provider, trace }, input) {
    // Sprint 5A.1: a fixed take for the brand's related entities, so repeated runs share the frontier evidence base.
    const limit = input.entityId === state.brand.entity?.id ? FRONTIER_RELATED_TAKE : input.limit;
    const result = await callQloo(state, provider, trace, "recommend", { target_type: input.targetType, signals: [input.entityId], limit, explain: false });
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
  declareConceptOnly,
  assessConceptDuplicates,
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

const jsonSchemaCache = new WeakMap<AgentTool<never>, Record<string, unknown>>();

/** JSON schema of a tool input, for model providers. Cached: tool objects in the registry are immutable. */
export function toolJsonSchema(tool: AgentTool<never>): Record<string, unknown> {
  const cached = jsonSchemaCache.get(tool);
  if (cached) return cached;
  const schema = z.toJSONSchema(tool.inputSchema as z.ZodType, { io: "input" }) as Record<string, unknown>;
  jsonSchemaCache.set(tool, schema);
  return schema;
}
