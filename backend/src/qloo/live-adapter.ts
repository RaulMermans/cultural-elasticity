/**
 * Qloo (harness 0.1.26, hackathon API) → canonical EvidencePacket.
 *
 * Written from live-observed output (2026-10-16, https://hackathon.api.qloo.com). Rules:
 *   - provider-specific fields stop here; the core sees only ../evidence/schema.ts shapes;
 *   - only observed fields are typed; compare_audiences / demographics stay opaque `fields`;
 *   - affinity has NO documented scale (Insights docs define neither affinity nor response popularity),
 *     so it is carried with `comparisonScope: "within_call"` and no `scale`;
 *   - rank = Qloo's returned order inside one call. [live] Tied values (e.g. 9 tags at affinity 1) are
 *     returned in a different order on repeated calls, so ranks inside a tie are not meaningful;
 *   - missing evidence stays absent (unavailable), never zero;
 *   - every derived item keeps the correlation id of the call it came from.
 */
import type {
  AudienceEvidence,
  BridgeEvidence,
  ConditionedEntityEvidence,
  CulturalProfile,
  CulturalSignal,
  EvidencePacketInput,
  JsonValue,
  Limitation,
  ProvenanceRef,
  RankingEvidence,
  ResolvedEntity,
} from "../evidence/schema.js";
import { QlooContractError } from "./errors.js";
import { parseEnvelope, sanitizeForEvidence, toEntitySignals, toTagSignals, type QlooEnvelope } from "./normalize.js";
import type { QlooOperation } from "./types.js";

/** Provenance `source` for evidence captured from the hackathon API. Never used by synthetic data. */
export const QLOO_LIVE_SOURCE = "qloo-hackathon-api";

export type LiveCall = { operation: QlooOperation; envelope: QlooEnvelope; capturedAt: string };

/** Validates one raw harness result at the boundary. */
export function liveCall(operation: QlooOperation, raw: unknown, capturedAt: string): LiveCall {
  return { operation, envelope: parseEnvelope(operation, raw), capturedAt };
}

export function callProvenance(call: LiveCall): ProvenanceRef {
  return { source: QLOO_LIVE_SOURCE, operation: call.operation, correlationId: call.envelope.execution.correlation_id, capturedAt: call.capturedAt };
}

function requireOk(call: LiveCall): void {
  if (call.envelope.status === "needs_input") throw new QlooContractError(call.operation, "needs_input must be resolved before mapping");
  if (call.envelope.status === "error") throw new QlooContractError(call.operation, "cannot map an error envelope");
}

/** Qloo tag URN namespace, e.g. `urn:tag:keyword:media`. Used as the signal category. */
export function tagCategory(type: string | undefined): string | undefined {
  return type === undefined || type.trim() === "" ? undefined : type;
}

/** One profile signal per returned tag, ranked by Qloo order, affinity scoped to this call. */
export function signalsFromEntityTags(call: LiveCall): CulturalSignal[] {
  requireOk(call);
  const provenance = [callProvenance(call)];
  return toTagSignals(call.operation, call.envelope).map((tag, index) => ({
    id: tag.qlooId,
    label: tag.label.trim() || tag.qlooId,
    ...(tagCategory(tag.type) !== undefined && { category: tagCategory(tag.type) as string }),
    rank: index + 1,
    ...(tag.affinity !== undefined && { numeric: { value: tag.affinity, comparisonScope: "within_call" as const } }),
    provenance,
  }));
}

export type PinnedSubject = { id: string; label: string; type: string };

/** A subject pinned by a human after reviewing live candidates. `resolution` is "confirmed". */
export function pinnedSubject(subject: PinnedSubject, observedIn: readonly LiveCall[]): ResolvedEntity {
  return { id: subject.id, label: subject.label, type: subject.type, resolution: "confirmed", provenance: observedIn.map(callProvenance) };
}

/**
 * Brand profile: tags Qloo returns for the single brand entity (Insights filter.type=urn:tag).
 * `truncated` is true when Qloo returned exactly the requested limit (the harness caps it at 20).
 */
export function brandProfileFromEntityTags(subject: ResolvedEntity, call: LiveCall, requestedLimit: number): CulturalProfile {
  const signals = signalsFromEntityTags(call);
  return { subject, signals, ...(signals.length >= requestedLimit && { truncated: true }), provenance: [callProvenance(call)] };
}

export type RecurringSignalOptions = { minSupport: number; requestedLimit: number };

/**
 * Derived target profile: territory concept → exemplar entities → each exemplar's own tags → the tags
 * that recur across at least `minSupport` exemplars. This is a DERIVED representation, not a Qloo profile.
 *
 * Values are not averaged: each exemplar's affinities come from a different call and are not comparable.
 * Signals therefore carry no `numeric`. Rank order (deterministic): support desc, then the best
 * per-exemplar rank asc, then id. Provenance lists every exemplar call the signal appeared in.
 */
export function recurringSignalProfile(subject: ResolvedEntity, exemplarCalls: readonly LiveCall[], options: RecurringSignalOptions): CulturalProfile {
  if (!Number.isInteger(options.minSupport) || options.minSupport < 1) throw new RangeError("minSupport must be a positive integer");
  type Acc = { id: string; label: string; category?: string; support: number; bestRank: number; provenance: ProvenanceRef[] };
  const byId = new Map<string, Acc>();
  let anyTruncated = false;
  for (const call of exemplarCalls) {
    const signals = signalsFromEntityTags(call);
    if (signals.length >= options.requestedLimit) anyTruncated = true;
    const seen = new Set<string>();
    for (const signal of signals) {
      if (seen.has(signal.id)) continue;
      seen.add(signal.id);
      const acc = byId.get(signal.id);
      if (acc) {
        acc.support += 1;
        acc.bestRank = Math.min(acc.bestRank, signal.rank as number);
        acc.provenance.push(...signal.provenance);
      } else {
        byId.set(signal.id, { id: signal.id, label: signal.label, ...(signal.category !== undefined && { category: signal.category }), support: 1, bestRank: signal.rank as number, provenance: [...signal.provenance] });
      }
    }
  }
  const recurring = [...byId.values()]
    .filter((acc) => acc.support >= options.minSupport)
    .sort((a, b) => b.support - a.support || a.bestRank - b.bestRank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    subject,
    signals: recurring.map((acc, index) => ({
      id: acc.id,
      label: acc.label,
      ...(acc.category !== undefined && { category: acc.category }),
      rank: index + 1,
      provenance: acc.provenance,
    })),
    // Built from truncated per-exemplar lists whenever any exemplar hit the cap.
    ...(anyTruncated && { truncated: true }),
    provenance: exemplarCalls.map(callProvenance),
  };
}

/** Support counts for a recurring profile, for reporting (not part of the canonical packet). */
export function recurringSupport(exemplarCalls: readonly LiveCall[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const call of exemplarCalls) for (const id of new Set(signalsFromEntityTags(call).map((s) => s.id))) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

/**
 * One `rank` call → RankingEvidence. All candidates share the call's correlation id, so the engine
 * can verify the single-call scope. Affinity is within_call (cross-call comparability is undocumented).
 */
export function rankingFromRank(call: LiveCall, rankedAgainst: string, targetCandidateId: string | undefined): RankingEvidence {
  requireOk(call);
  const provenance = [callProvenance(call)];
  const ranked = toEntitySignals(call.operation, call.envelope);
  if (ranked.length === 0) throw new QlooContractError(call.operation, "rank returned no candidates");
  return {
    rankedAgainst,
    ...(targetCandidateId !== undefined && ranked.some((r) => r.qlooId === targetCandidateId) && { targetCandidateId }),
    candidates: ranked.map((entity, index) => ({
      id: entity.qlooId,
      label: entity.label.trim() || entity.qlooId,
      rank: index + 1,
      ...(entity.affinity !== undefined && { numeric: { value: entity.affinity, comparisonScope: "within_call" as const } }),
      provenance,
    })),
    comparisonScope: "single_call",
    provenance,
  };
}

export type ConditionedScope = {
  /** The subject the request was conditioned on (signal), normally the brand. */
  conditionedOn: { id: string; label: string };
  /** The territory scope the results were filtered to (a pinned Qloo tag). */
  territory: { id: string; label: string };
  entityType: string;
  requestedLimit: number;
};

/**
 * One `recommend` call with signal = brand and a territory tag filter → ConditionedEntityEvidence.
 * [live 2026-10-16] Validated for Jacquemus × urn:tag:interests:qloo:boutique_hospitality (places) and,
 * in Sprint 2, for brand-type results filtered by industry/segment tags. Rank = Qloo's returned order;
 * affinity is within_call with no scale. An empty `ok` result is kept as an observed empty list.
 */
export function conditionedEntitiesFromRecommend(call: LiveCall, scope: ConditionedScope): ConditionedEntityEvidence {
  requireOk(call);
  const provenance = [callProvenance(call)];
  const entities = toEntitySignals(call.operation, call.envelope);
  return {
    conditionedOn: scope.conditionedOn,
    territory: scope.territory,
    entityType: scope.entityType,
    requestedLimit: scope.requestedLimit,
    truncated: entities.length >= scope.requestedLimit,
    entities: entities.map((entity, index) => ({
      id: entity.qlooId,
      label: entity.label.trim() || entity.qlooId,
      rank: index + 1,
      ...(entity.affinity !== undefined && { numeric: { value: entity.affinity, comparisonScope: "within_call" as const } }),
      provenance,
    })),
    comparisonScope: "single_call",
    provenance,
  };
}

/** An `empty` envelope is an observed result with no entities, not a failure. */
export function emptyConditionedEvidence(call: LiveCall, scope: ConditionedScope): ConditionedEntityEvidence {
  return { conditionedOn: scope.conditionedOn, territory: scope.territory, entityType: scope.entityType, requestedLimit: scope.requestedLimit, truncated: false, entities: [], comparisonScope: "single_call", provenance: [callProvenance(call)] };
}

function toJson(value: unknown): JsonValue {
  const sanitized = sanitizeForEvidence(value);
  return JSON.parse(JSON.stringify(sanitized ?? null)) as JsonValue;
}

/**
 * compare_audiences → AudienceEvidence. The /v2/analysis/compare documentation describes no result
 * field's meaning, direction or scale, so NOTHING is promoted to an InterpretableMetric. The sanitized
 * payload is kept as opaque `fields` for human investigation only.
 */
export function audienceFromCompare(call: LiveCall): AudienceEvidence {
  requireOk(call);
  return { fields: { compare_results: toJson(call.envelope.results) }, interpretableMetrics: [], provenance: [callProvenance(call)] };
}

/** Tags Qloo returns for brand + exemplars in ONE entity_tags call. Not a path; not a strength. */
export function jointSignalBridge(call: LiveCall): BridgeEvidence {
  const signals = signalsFromEntityTags(call).map(({ rank: _rank, ...signal }) => signal);
  return { semantics: "joint_signal", signals, provenance: [callProvenance(call)] };
}

/**
 * Entities that appear in BOTH the brand's and the target exemplar's related-entity lists (two
 * separate recommend calls). Membership only: affinities from the two calls are not compared.
 */
export function mutualRelatedBridge(brandRelated: LiveCall, targetRelated: LiveCall, excludeIds: readonly string[]): BridgeEvidence {
  requireOk(brandRelated);
  requireOk(targetRelated);
  const exclude = new Set(excludeIds);
  const brandSide = toEntitySignals(brandRelated.operation, brandRelated.envelope);
  const targetIds = new Set(toEntitySignals(targetRelated.operation, targetRelated.envelope).map((e) => e.qlooId));
  const provenance = [callProvenance(brandRelated), callProvenance(targetRelated)];
  const signals = brandSide
    .filter((e) => targetIds.has(e.qlooId) && !exclude.has(e.qlooId))
    .map((e) => ({ id: e.qlooId, label: e.label.trim() || e.qlooId, category: e.type ?? "urn:entity", provenance }));
  return { semantics: "intermediate_signal", signals, provenance };
}

export type LivePacketParts = {
  brand: CulturalProfile;
  target: CulturalProfile;
  audience?: AudienceEvidence;
  ranking?: RankingEvidence;
  bridges?: BridgeEvidence[];
  conditionedEntities?: ConditionedEntityEvidence[];
  limitations: Limitation[];
};

export function assembleLivePacket(parts: LivePacketParts): EvidencePacketInput {
  const all = [
    parts.brand.provenance,
    parts.target.provenance,
    parts.audience?.provenance ?? [],
    parts.ranking?.provenance ?? [],
    ...(parts.bridges ?? []).map((b) => b.provenance),
    ...(parts.conditionedEntities ?? []).map((c) => c.provenance),
  ].flat();
  return {
    schemaVersion: "ce-evidence/0.2",
    origin: "live",
    brand: parts.brand,
    target: parts.target,
    ...(parts.audience && { audience: parts.audience }),
    ...(parts.ranking && { ranking: parts.ranking }),
    ...(parts.bridges && { bridges: parts.bridges }),
    ...(parts.conditionedEntities && { conditionedEntities: parts.conditionedEntities }),
    limitations: parts.limitations,
    provenance: all,
  };
}
