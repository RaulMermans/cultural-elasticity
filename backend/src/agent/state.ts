/**
 * Explicit agent run state and its deterministic transitions.
 *
 * The model never mutates state. It proposes actions; the tool executor validates them and the code
 * in this module applies their effects. Status changes go through `transition`, which enforces the
 * allowed-transition table and records every change in the trace.
 */
import { randomUUID } from "node:crypto";
import type { AgentAnalysisResult, AgentIntent, DiscoverySeed, AgentModelInfo, NeedsInputOption, InvestigationLink, AgentRunStatus, AgentTerritoryResult, AgentTrace, CandidateSource, ConceptDedupVerdict, RepresentationFailureCode, SemanticRelevance, SkillRef, TerritoryOrigin, TerritoryRole } from "@cultural-elasticity/shared";
import type { Limitation } from "../evidence/schema.js";
import type { LiveCall } from "../qloo/live-adapter.js";
import type { ConceptRef } from "../contracts/qloo.js";
import type { ResolutionCandidate } from "../qloo/normalize.js";
import { defaultLimits, type AgentRequest, type Interpretation, type InvestigationLimits, type RankableType } from "./contracts.js";
import type { QlooCallResult } from "./tool-provider.js";
import type { CulturalElasticityResult } from "@cultural-elasticity/shared";

export type EntitySourceKind = "resolved" | "tag_member" | "conditioned" | "related" | "ranked";

export type EntitySource = { kind: EntitySourceKind; tagIds: string[]; conditionedOn: string | null; correlationId: string; popularity: number | null };

export type EntityRecord = { id: string; label: string; type: RankableType | undefined; sources: EntitySource[] };

/**
 * Sprint 9O: a baseline direction's own Qloo tag, observed on the brand's tag profile in the authorized scan. It is a
 * starting point for the investigation (the territory's sourceTagId), not support: members must still come from Qloo.
 */
export type TerritoryGrounding = { territory: string; tagId: string; label: string; type: string; subjectId: string; correlationId: string };

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
  /** Representation-quality outcome (VALID primary first; WEAK only as an alternate). */
  quality: "VALID" | "WEAK";
  /** The model's advisory semantic judgment, if it gave one. Never Qloo evidence. */
  semantic: { relevance: SemanticRelevance; reason: string } | null;
};

export type AcceptedRepresentation = {
  entityType: RankableType;
  exemplars: ExemplarChoice[];
  diversity: "adequate" | "low" | "unknown";
  diversityDetail: string;
  warnings: string[];
};

export type RejectedExemplar = { id: string | null; label: string; code: RepresentationFailureCode; reason: string };

/** One representation attempt: which (concept, entity type) strategy was tried and how it ended. */
export type StrategyAttempt = { conceptId: string; entityType: RankableType; attempt: number; outcome: "accepted" | "rejected" | "weak" };

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
  /** Where the hypothesis came from (comparison-set construction). */
  source: CandidateSource;
  sourceEvidence: string;
  strategyLog: StrategyAttempt[];
  /** Set when the agent deliberately chose concept-level evidence instead of an exemplar panel. */
  conceptOnly: string | null;
  /** Sprint 5A: the agent's advisory semantic judgment of a reference or frontier concept (can only remove). */
  semanticJudgment: { relevance: SemanticRelevance; reason: string } | null;
  /** Sprint 5A.1: the Qloo tag that grounded a generated candidate (its first evidence tag), if any. */
  sourceTagId: string | null;
  /** Sprint 5A.2: every Qloo evidence tag given at proposal (sourceTagId is the first); anchoring any of them keeps provenance. */
  evidenceTagIds: string[];
  /**
   * Sprint 10A: ids of observed signals (tags or entities seen in this run, or seeds from the authorized scan) that the
   * proposer cited as motivation. Explains why a candidate surfaced; never support.
   */
  motivatedBy: string[];
};

export type BrandState = {
  query: string | null;
  entity: { id: string; label: string; type: string; match: string | null; resolution: "confirmed" | "unconfirmed"; call: LiveCall } | null;
  ambiguity: { input: string; candidates: ResolutionCandidate[]; correlationId: string } | null;
  notFound: boolean;
  attempts: number;
};

export type MethodologyRun = { id: string; territoryKeys: string[]; result: CulturalElasticityResult };

export type AgentRunState = {
  runId: string;
  /** A canonical baseline identity to recheck before using the newly resolved brand. */
  expectedBrandId?: string | null;
  /** Sprint 9O: the Qloo tag the authorized baseline observed for the investigated direction (server-held, never from text). */
  territoryGrounding?: TerritoryGrounding | null;
  /**
   * Sprint 10A: entities the authorized baseline scan observed in brand-conditioned lists, for an explore run to start
   * from (server-held, never from text). They motivate hypotheses and may be profiled; they are never support.
   */
  discoverySeeds?: DiscoverySeed[];
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
  usage: { iterations: number; qlooCalls: number; invalidTurnsInRow: number; inputTokens: number; outputTokens: number; retries: number; cacheReadTokens: number; cacheCreationTokens: number; uncachedInputTokens: number; synthesisAttempts: number; qlooLatencyMs: number; qlooSpacingMs: number };
  pendingQuestion: { question: string; ambiguity: string; options: NeedsInputOption[] } | null;
  clarifications: string[];
  finishRequested: boolean;
  /** True when the caller fixed maxQlooCalls; otherwise the interpreted intent sets the default budget. */
  qlooBudgetExplicit: boolean;
  final: AgentAnalysisResult | null;
  /** Lower-cased find_tags queries → tag ids returned (resolution and alternate-concept recovery). */
  searchedQueries: Map<string, string[]>;
  /** `${tool}:${stable args}` of every executed tool call (repeated useless actions are refused). */
  executedCalls: Set<string>;
  /** Model layer-3 concept-dedup judgments (advisory; applied by explicit rules). */
  dedupJudgments: { aKey: string; bKey: string; verdict: ConceptDedupVerdict; reason: string }[];
  /** Skills active in the current turn (set by the runtime before the model is called). */
  activeSkills: SkillRef[];
  skillUsage: Map<string, { skill: SkillRef; turns: number; qlooCalls: number; toolCalls: number; exhausted: boolean; qlooSpent?: boolean }>;
  /** Comparison-set candidates removed by deterministic checks (stage + code), for the construction trace. */
  candidateRejections: { key: string; stage: "resolution" | "qloo_support" | "representation" | "evidence" | "dedup" | "diversity" | "budget" | "agent" | "semantic"; code: string; reason: string }[];
  /** Sprint 5A: comparison sets considered for FULL (semantic comparison validator). */
  semanticAssessments: import("@cultural-elasticity/shared").SemanticComparisonAssessment[];
  /** Sprint 5A: analyze decisions deferred because a meaningful comparison set was still constructible. */
  referenceDeferrals: number;
  /** Sprint 5A: wall-clock spent in deterministic analysis and in synthesis. */
  timing: { analysisMs: number; synthesisMs: number };
  /**
   * Sprint 5A.1: true while a model turn is open. `usage.iterations` already counts the open turn, so the turns the
   * run can still act in are `max - iterations + 1` inside a turn and `max - iterations` between turns.
   */
  turnOpen: boolean;
  /** Sprint 5A.1: targets whose off-type anchoring was deferred once for entity-type alignment. */
  alignmentDeferrals: Set<string>;
  /**
   * Sprint 9N: "enforce" (default) applies the comparison-feasibility rules (type-evidence ordering, bounded reference
   * probing, thin-panel discovery); "observe" only records the assessment and keeps the Sprint 9M control flow (the
   * before/after evaluation arm and the rollback path, CE_FEASIBILITY_POLICY=observe).
   */
  feasibilityPolicy: "enforce" | "observe";
  /** Sprint 9N: the comparison-feasibility assessment taken just before a target was first analyzed. */
  feasibilityAtAnalysis: import("@cultural-elasticity/shared").ComparisonFeasibility | null;
  /** Sprint 9O: the runtime ran its reference search (once per run). */
  referenceDiscoveryDone?: boolean;
  /** Sprint 5B.1: parent-child link of a query-layer run (server-recorded; null for a run started outside it). */
  link: InvestigationLink | null;
  startedAt: number;
  trace: AgentTrace;
  toolCallCounter: number;
  /**
   * Sprint 8B: true after finish/cancel so a provider callback cannot mutate a published result.
   * Late settlements still record observed cost on `lateSettlements` without rewriting evidence.
   */
  finalized: boolean;
  /** Operation ids whose budget settlement already ran (prevents double-counting one provider call). */
  settledOperationIds: Set<string>;
  /** In-flight Qloo reservations not yet settled (included in usage.qlooCalls). */
  qlooInFlight: number;
  lateSettlements: { operationId: string; observedAttempts: number; charged: number; discarded: boolean; afterFinalization: boolean }[];
};

export function createRunState(request: AgentRequest, model: AgentModelInfo, toolProvider: AgentRunState["toolProvider"], limits?: InvestigationLimits, runId: string = randomUUID()): AgentRunState {
  const resolvedLimits = limits ?? { ...defaultLimits(request.intent), ...(request.limits ?? {}) };
  if (request.researchMode === "single_hypothesis_v1") {
    resolvedLimits.maxQlooCalls = Math.min(request.limits?.maxQlooCalls ?? limits?.maxQlooCalls ?? 12, 12);
    resolvedLimits.maxAgentIterations = Math.min(resolvedLimits.maxAgentIterations, 8);
    resolvedLimits.maxCandidateTerritories = 1;
  }
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
    usage: { iterations: 0, qlooCalls: 0, invalidTurnsInRow: 0, inputTokens: 0, outputTokens: 0, retries: 0, cacheReadTokens: 0, cacheCreationTokens: 0, uncachedInputTokens: 0, synthesisAttempts: 0, qlooLatencyMs: 0, qlooSpacingMs: 0 },
    pendingQuestion: null,
    clarifications: [],
    finishRequested: false,
    qlooBudgetExplicit: limits?.maxQlooCalls !== undefined || request.limits?.maxQlooCalls !== undefined,
    final: null,
    searchedQueries: new Map(),
    executedCalls: new Set(),
    dedupJudgments: [],
    activeSkills: [],
    skillUsage: new Map(),
    candidateRejections: [],
    semanticAssessments: [],
    referenceDeferrals: 0,
    timing: { analysisMs: 0, synthesisMs: 0 },
    turnOpen: false,
    alignmentDeferrals: new Set(),
    feasibilityPolicy: "enforce",
    feasibilityAtAnalysis: null,
    link: null,
    startedAt: Date.now(),
    toolCallCounter: 0,
    finalized: false,
    settledOperationIds: new Set(),
    qlooInFlight: 0,
    lateSettlements: [],
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
      representationQuality: [],
      conceptDedup: [],
      earlyStops: [],
      skillUsage: [],
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

/** Sprint 5A.1: turns the run can still act in, including the open one (the same value inside and between turns). */
export function turnsAvailable(state: AgentRunState): number {
  return Math.max(0, state.limits.maxAgentIterations - state.usage.iterations + (state.turnOpen ? 1 : 0));
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

export function addTerritory(state: AgentRunState, input: { label: string; role: TerritoryRole; origin: TerritoryOrigin; rationale: string; source?: CandidateSource; sourceEvidence?: string; sourceTagId?: string | null; evidenceTagIds?: string[]; motivatedBy?: string[] }): TerritoryState {
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
    source: input.source ?? (input.origin === "user" ? "user" : input.origin === "agent_hypothesis" ? "agent_hypothesis" : "qloo_grounded"),
    sourceEvidence: input.sourceEvidence ?? input.rationale,
    strategyLog: [],
    conceptOnly: null,
    semanticJudgment: null,
    sourceTagId: input.sourceTagId ?? null,
    evidenceTagIds: input.evidenceTagIds ?? (input.sourceTagId ? [input.sourceTagId] : []),
    motivatedBy: input.motivatedBy ?? [],
  };
  state.territories.push(territory);
  return territory;
}

export function intentOf(state: AgentRunState): AgentIntent | null {
  return state.interpretation?.intent ?? null;
}
