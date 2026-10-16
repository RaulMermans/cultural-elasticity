/**
 * Explicit agent run state and its deterministic transitions.
 *
 * The model never mutates state. It proposes actions; the tool executor validates them and the code
 * in this module applies their effects. Status changes go through `transition`, which enforces the
 * allowed-transition table and records every change in the trace.
 */
import { randomUUID } from "node:crypto";
import type { AgentAnalysisResult, AgentIntent, AgentModelInfo, AgentRunStatus, AgentTerritoryResult, AgentTrace, RepresentationFailureCode, TerritoryOrigin, TerritoryRole } from "@cultural-elasticity/shared";
import type { Limitation } from "../evidence/schema.js";
import type { LiveCall } from "../qloo/live-adapter.js";
import type { ConceptRef } from "../contracts/qloo.js";
import { defaultLimits, type AgentRequest, type Interpretation, type InvestigationLimits, type RankableType } from "./contracts.js";
import type { QlooCallResult } from "./tool-provider.js";
import type { CulturalElasticityResult } from "@cultural-elasticity/shared";

export type EntitySourceKind = "resolved" | "tag_member" | "conditioned" | "related" | "ranked";

export type EntitySource = { kind: EntitySourceKind; tagIds: string[]; conditionedOn: string | null; correlationId: string; popularity: number | null };

export type EntityRecord = { id: string; label: string; type: RankableType | undefined; sources: EntitySource[] };

export type TagRecord = { id: string; label: string; type: string; sources: { kind: "find_tags" | "profile"; query: string | null; subjectId: string | null; correlationId: string }[] };

export type ProfileRecord = { subjectId: string; call: LiveCall; tagIds: string[]; take: number };

/** Result of one tag-scoped recommend call (brand-independent pool or brand-conditioned list). */
export type PoolRecord = { tagIds: string[]; targetType: RankableType; conditionedOn: string | null; call: LiveCall; memberIds: string[] };

export type ExemplarChoice = {
  id: string;
  label: string;
  type: RankableType;
  popularity: number | null;
  selectionReason: string;
  conceptSupport: "tag_member" | "profile_tag";
  supportCorrelationId: string;
};

export type AcceptedRepresentation = {
  entityType: RankableType;
  exemplars: ExemplarChoice[];
  diversity: "adequate" | "low" | "unknown";
  diversityDetail: string;
  warnings: string[];
};

export type RejectedExemplar = { id: string | null; label: string; code: RepresentationFailureCode; reason: string };

export type TerritoryStatus = "open" | "anchored" | "represented" | "analyzed" | "dropped";

export type TerritoryState = {
  key: string;
  label: string;
  role: TerritoryRole;
  origin: TerritoryOrigin;
  rationale: string;
  status: TerritoryStatus;
  concept: { id: string; label: string; type: string } | null;
  representation: AcceptedRepresentation | null;
  attempts: number;
  rejectedExemplars: RejectedExemplar[];
  dropReason: { code: RepresentationFailureCode; detail: string } | null;
};

export type BrandState = {
  query: string | null;
  entity: { id: string; label: string; type: string; match: string | null; resolution: "confirmed" | "unconfirmed"; call: LiveCall } | null;
  ambiguity: { input: string; candidates: ConceptRef[]; correlationId: string } | null;
  notFound: boolean;
  attempts: number;
};

export type MethodologyRun = { id: string; territoryKeys: string[]; result: CulturalElasticityResult };

export type AgentRunState = {
  runId: string;
  status: AgentRunStatus;
  request: AgentRequest;
  limits: InvestigationLimits;
  model: AgentModelInfo;
  toolProvider: { name: string; mode: "live" | "scripted"; evidenceSource: string };
  interpretation: Interpretation | null;
  brand: BrandState;
  territories: TerritoryState[];
  entities: Map<string, EntityRecord>;
  tags: Map<string, TagRecord>;
  profiles: Map<string, ProfileRecord>;
  pools: PoolRecord[];
  related: { subjectId: string; targetType: RankableType; call: LiveCall; memberIds: string[] }[];
  /** Identical Qloo requests are answered from here (no second upstream call, no budget use). */
  callCache: Map<string, QlooCallResult>;
  results: Map<string, AgentTerritoryResult>;
  methodologyRuns: MethodologyRun[];
  /** partial / degraded flags and other run-level limitations. */
  flags: Limitation[];
  usage: { iterations: number; qlooCalls: number; invalidTurnsInRow: number; inputTokens: number; outputTokens: number; retries: number };
  pendingQuestion: { question: string; ambiguity: string; options: { id: string; label: string; type?: string }[] } | null;
  clarifications: string[];
  finishRequested: boolean;
  /** True when the caller fixed maxQlooCalls; otherwise the interpreted intent sets the default budget. */
  qlooBudgetExplicit: boolean;
  final: AgentAnalysisResult | null;
  startedAt: number;
  trace: AgentTrace;
  toolCallCounter: number;
};

export function createRunState(request: AgentRequest, model: AgentModelInfo, toolProvider: AgentRunState["toolProvider"], limits?: InvestigationLimits): AgentRunState {
  const runId = randomUUID();
  const resolvedLimits = limits ?? { ...defaultLimits(request.intent), ...(request.limits ?? {}) };
  return {
    runId,
    status: "INTAKE",
    request,
    limits: resolvedLimits,
    model,
    toolProvider,
    interpretation: null,
    brand: { query: null, entity: null, ambiguity: null, notFound: false, attempts: 0 },
    territories: [],
    entities: new Map(),
    tags: new Map(),
    profiles: new Map(),
    pools: [],
    related: [],
    callCache: new Map(),
    results: new Map(),
    methodologyRuns: [],
    flags: [],
    usage: { iterations: 0, qlooCalls: 0, invalidTurnsInRow: 0, inputTokens: 0, outputTokens: 0, retries: 0 },
    pendingQuestion: null,
    clarifications: [],
    finishRequested: false,
    qlooBudgetExplicit: limits?.maxQlooCalls !== undefined || request.limits?.maxQlooCalls !== undefined,
    final: null,
    startedAt: Date.now(),
    toolCallCounter: 0,
    trace: {
      runId,
      intent: request.intent ?? null,
      userQuery: request.userQuery,
      interpretedRequest: null,
      model,
      toolProvider: { name: toolProvider.name, mode: toolProvider.mode },
      limits: { ...resolvedLimits },
      statusTransitions: [],
      planRevisions: [],
      turns: [],
      toolCalls: [],
      resolvedEntities: [],
      territoryHypotheses: [],
      representations: [],
      sufficiency: [],
      methodologyInvocations: [],
      synthesis: null,
      errors: [],
      userClarifications: [],
    },
  };
}

// ---- Status machine ----

const ALLOWED: Record<AgentRunStatus, readonly AgentRunStatus[]> = {
  INTAKE: ["PLANNING", "FAILED"],
  PLANNING: ["RESOLVING", "INVESTIGATING", "ANALYZING", "NEEDS_INPUT", "COMPLETE", "FAILED", "BUDGET_EXHAUSTED"],
  RESOLVING: ["PLANNING", "INVESTIGATING", "ANALYZING", "NEEDS_INPUT", "COMPLETE", "FAILED", "BUDGET_EXHAUSTED"],
  INVESTIGATING: ["RESOLVING", "ANALYZING", "NEEDS_INPUT", "COMPLETE", "FAILED", "BUDGET_EXHAUSTED"],
  ANALYZING: ["INVESTIGATING", "COMPLETE", "FAILED", "BUDGET_EXHAUSTED"],
  NEEDS_INPUT: ["PLANNING", "FAILED"],
  COMPLETE: [],
  FAILED: [],
  BUDGET_EXHAUSTED: [],
};

export const TERMINAL_STATUSES: readonly AgentRunStatus[] = ["COMPLETE", "FAILED", "BUDGET_EXHAUSTED"];

export class InvalidTransitionError extends Error {
  constructor(from: AgentRunStatus, to: AgentRunStatus) {
    super(`invalid agent status transition ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(from: AgentRunStatus, to: AgentRunStatus): boolean {
  return from === to || ALLOWED[from].includes(to);
}

export function transition(state: AgentRunState, to: AgentRunStatus, reason: string): void {
  if (state.status === to) return;
  if (!canTransition(state.status, to)) throw new InvalidTransitionError(state.status, to);
  state.trace.statusTransitions.push({ iteration: state.usage.iterations, from: state.status, to, reason });
  state.status = to;
}

/** The working phase implied by the evidence gathered so far (never a terminal status). */
export function derivePhase(state: AgentRunState): AgentRunStatus {
  if (state.pendingQuestion) return "NEEDS_INPUT";
  if (!state.interpretation) return "PLANNING";
  if (!state.brand.entity) return "RESOLVING";
  return "INVESTIGATING";
}

// ---- Recording evidence ----

export function remainingQlooCalls(state: AgentRunState): number {
  return Math.max(0, state.limits.maxQlooCalls - state.usage.qlooCalls);
}

export function recordEntity(state: AgentRunState, entity: { id: string; label: string; type: RankableType | undefined }, source: EntitySource): EntityRecord {
  const existing = state.entities.get(entity.id);
  if (existing) {
    if (existing.type === undefined && entity.type !== undefined) existing.type = entity.type;
    if (!existing.sources.some((s) => s.correlationId === source.correlationId && s.kind === source.kind)) existing.sources.push(source);
    return existing;
  }
  const record: EntityRecord = { id: entity.id, label: entity.label.trim() || entity.id, type: entity.type, sources: [source] };
  state.entities.set(entity.id, record);
  return record;
}

export function recordTag(state: AgentRunState, tag: { id: string; label: string; type: string }, source: TagRecord["sources"][number]): void {
  const existing = state.tags.get(tag.id);
  if (existing) {
    if (!existing.sources.some((s) => s.correlationId === source.correlationId)) existing.sources.push(source);
    return;
  }
  state.tags.set(tag.id, { id: tag.id, label: tag.label.trim() || tag.id, type: tag.type, sources: [source] });
}

export function findTerritory(state: AgentRunState, key: string): TerritoryState | undefined {
  return state.territories.find((t) => t.key === key);
}

/** Territories still in scope (not dropped). */
export function activeTerritories(state: AgentRunState): TerritoryState[] {
  return state.territories.filter((t) => t.status !== "dropped");
}

/** Lowercase snake-case slug of a label (the base of a territory key). */
export function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/gu, "_")
      .replace(/^_+|_+$/gu, "")
      .slice(0, 40) || "territory"
  );
}

/** Stable territory key from a label: its slug, de-duplicated. */
export function territoryKey(state: AgentRunState, label: string): string {
  const base = slugify(label);
  let key = base;
  for (let i = 2; state.territories.some((t) => t.key === key); i += 1) key = `${base}_${i}`;
  return key;
}

export function addTerritory(state: AgentRunState, input: { label: string; role: TerritoryRole; origin: TerritoryOrigin; rationale: string }): TerritoryState {
  const territory: TerritoryState = {
    key: territoryKey(state, input.label),
    label: input.label.trim(),
    role: input.role,
    origin: input.origin,
    rationale: input.rationale,
    status: "open",
    concept: null,
    representation: null,
    attempts: 0,
    rejectedExemplars: [],
    dropReason: null,
  };
  state.territories.push(territory);
  return territory;
}

export function intentOf(state: AgentRunState): AgentIntent | null {
  return state.interpretation?.intent ?? null;
}
