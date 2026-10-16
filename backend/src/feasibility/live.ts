/**
 * Sprint 0B: pinned live investigation against the Qloo hackathon API, through the official harness.
 *
 * live Qloo → harness envelopes → live adapter → EvidencePacket → Cultural Evidence Core → AnalysisIngredients
 *
 * It computes no Elasticity score, no Cultural Distance score and no recommendation. Every number it
 * reports is either a Qloo value (kept with its correlation id) or a deterministic, documented
 * descriptive measure over Qloo output (set overlap, counts, agreement).
 */
import type { AnalysisIngredients } from "@cultural-elasticity/shared";
import { analyzeEvidencePacket } from "../analysis/ingredients.js";
import { setOverlap } from "../analysis/overlap.js";
import type { EvidencePacketInput, Limitation } from "../evidence/schema.js";
import { MAX_AUTOMATIC_RETRIES } from "../qloo/client.js";
import {
  assembleLivePacket,
  audienceFromCompare,
  brandProfileFromEntityTags,
  jointSignalBridge,
  liveCall,
  mutualRelatedBridge,
  pinnedSubject,
  conditionedEntitiesFromRecommend,
  rankingFromRank,
  recurringSignalProfile,
  type LiveCall,
} from "../qloo/live-adapter.js";
import { numericFieldPaths, toEntitySignals, toTagSignals } from "../qloo/normalize.js";
import type { QlooTransport } from "../qloo/transport.js";
import type { QlooOperation, QlooOperationInput } from "../qloo/types.js";
import type { LiveInvestigationConfig, PinnedEntity } from "./live-config.js";

export type LiveStep = { id: string; operation: QlooOperation; outcome: "ok" | "empty" | "needs_input" | "failed"; correlationId?: string; detail: string; attempts: number };

/**
 * Runs harness operations under the AGENTS.md status policy: needs_input is never continued, partial and
 * degraded are flagged, errors are retried at most once and only when Qloo marks them retryable.
 */
export class LiveCollector {
  readonly steps: LiveStep[] = [];
  readonly flags: Limitation[] = [];
  private lastCall = 0;

  constructor(
    private readonly transport: QlooTransport,
    private readonly options: { spacingMs: number; rateLimitWaitMs?: number; now?: () => Date; sleep?: (ms: number) => Promise<void> },
  ) {}

  private sleep(ms: number) {
    return (this.options.sleep ?? ((t: number) => new Promise<void>((r) => setTimeout(r, t))))(ms);
  }

  /** `acceptEmpty` returns `empty` envelopes too, for evidence where an observed empty result matters. */
  async call<O extends QlooOperation>(id: string, operation: O, input: QlooOperationInput[O], options: { acceptEmpty?: boolean } = {}): Promise<LiveCall | undefined> {
    for (let attempt = 1; ; attempt += 1) {
      const wait = this.lastCall + this.options.spacingMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.lastCall = Date.now();
      const capturedAt = (this.options.now ?? (() => new Date()))().toISOString();
      const result = await this.transport.execute(operation, input);
      const failure = result.kind === "failure" ? result.failure : undefined;
      let parsed: LiveCall | undefined;
      if (!failure) parsed = liveCall(operation, result.kind === "result" ? result.raw : undefined, capturedAt);
      const envelopeError = parsed?.envelope.status === "error" ? parsed.envelope.error : undefined;
      const problem = failure ?? envelopeError;
      if (problem) {
        if (problem.retryable && attempt <= MAX_AUTOMATIC_RETRIES) {
          if (problem.code === "QLOO_RATE_LIMIT") await this.sleep(this.options.rateLimitWaitMs ?? 60_000);
          continue;
        }
        this.steps.push({ id, operation, outcome: "failed", detail: `${problem.code} (retryable=${problem.retryable})`, attempts: attempt, ...(failure?.correlationId && { correlationId: failure.correlationId }) });
        return undefined;
      }
      const call = parsed as LiveCall;
      const { status, execution } = call.envelope;
      if (status === "partial" || status === "degraded") this.flags.push({ code: `QLOO_${status.toUpperCase()}`, detail: `${id}: Qloo marked this result ${status} (${(call.envelope.warnings ?? []).join("; ") || "no detail"})` });
      const outcome = status === "needs_input" ? "needs_input" : status === "empty" ? "empty" : "ok";
      this.steps.push({ id, operation, outcome, correlationId: execution.correlation_id, detail: `${status}; results=${Array.isArray(call.envelope.results) ? call.envelope.results.length : typeof call.envelope.results}`, attempts: attempt });
      return outcome === "ok" || (outcome === "empty" && options.acceptEmpty === true) ? call : undefined;
    }
  }
}

/** Tag URN namespace: `urn:tag:<namespace>:…`. */
export const tagNamespace = (id: string) => id.split(":")[2] ?? "unknown";

/**
 * Namespaces describing a venue's operations (menu, payment, rating, price, facilities, inclusivity
 * badges) rather than taste. A human classification made after inspecting live output; documented in the
 * feasibility report. Signals in these namespaces are kept as evidence, but counted separately.
 */
export const OPERATIONAL_TAG_NAMESPACES: readonly string[] = ["credit_card", "cost_description", "specialty_dish", "hotel_rating", "inclusivity", "amenity", "offerings", "service_option"];

export type ProfileSufficiency = {
  role: "brand" | "target";
  signals: number;
  numericCoverage: number;
  namespaces: number;
  culturalShare: number;
  affinityRange: number | null;
  tiesAtMax: number | null;
  repeatJaccard: number | null;
  crossTakeJaccard: Record<string, number>;
  verdict: "SUFFICIENT_STABLE_CULTURAL_PROFILE" | "SUFFICIENT_SET_ONLY" | "INSUFFICIENT";
  failed: string[];
};

/**
 * G3 criteria, fixed after inspecting live data (see feasibility doc §Revised G1–G6):
 *   C1 ≥ 10 signals            C2 numeric coverage = 1 (within one call)   C3 ≥ 5 tag namespaces
 *   C4 cultural share ≥ 0.5    C5 repeat-call Jaccard = 1 (when measured)  C6 cross-take Jaccard ≥ 0.6 at N ≥ 10
 *   C7 value discrimination: affinity range across the list ≥ 0.01
 * All of C1–C7 → SUFFICIENT_STABLE_CULTURAL_PROFILE; C1–C6 only → SUFFICIENT_SET_ONLY; else INSUFFICIENT.
 */
export function assessProfileSufficiency(input: {
  role: "brand" | "target";
  ids: string[];
  values: (number | undefined)[];
  repeatIds?: string[];
  crossTake?: Record<number, string[]>;
  /** A derived profile built from several calls carries no comparable values by design: C2/C7 do not apply and it is at best SET_ONLY. */
  derivedSetOnly?: boolean;
}): ProfileSufficiency {
  const { ids, values } = input;
  const numeric = values.filter((v): v is number => v !== undefined);
  const namespaces = new Set(ids.map(tagNamespace)).size;
  const cultural = ids.filter((id) => !OPERATIONAL_TAG_NAMESPACES.includes(tagNamespace(id))).length;
  const max = numeric.length ? Math.max(...numeric) : null;
  const range = numeric.length ? (max as number) - Math.min(...numeric) : null;
  const repeat = input.repeatIds ? (setOverlap(ids, input.repeatIds).jaccard ?? 0) : null;
  const crossTake: Record<string, number> = {};
  for (const [n, list] of Object.entries(input.crossTake ?? {})) crossTake[n] = setOverlap(ids.slice(0, Number(n)), list).jaccard ?? 0;

  const failed: string[] = [];
  if (ids.length < 10) failed.push("C1 fewer than 10 signals");
  if (!input.derivedSetOnly && (ids.length === 0 || numeric.length !== ids.length)) failed.push("C2 numeric coverage below 1");
  if (namespaces < 5) failed.push("C3 fewer than 5 tag namespaces");
  if (ids.length === 0 || cultural / ids.length < 0.5) failed.push("C4 cultural share below 0.5");
  if (repeat !== null && repeat < 1) failed.push("C5 repeat call returned a different set");
  for (const [n, j] of Object.entries(crossTake)) if (Number(n) >= 10 && j < 0.6) failed.push(`C6 cross-take Jaccard ${j.toFixed(2)} at N=${n}`);
  const setOnly = failed.length === 0 && (input.derivedSetOnly === true || range === null || range < 0.01);
  if (setOnly) failed.push(input.derivedSetOnly ? "C7 not applicable: derived set without comparable values" : "C7 affinity range below 0.01 (values do not discriminate)");
  return {
    role: input.role,
    signals: ids.length,
    numericCoverage: ids.length ? numeric.length / ids.length : 0,
    namespaces,
    culturalShare: ids.length ? cultural / ids.length : 0,
    affinityRange: range,
    tiesAtMax: max === null ? null : numeric.filter((v) => v === max).length,
    repeatJaccard: repeat,
    crossTakeJaccard: crossTake,
    verdict: failed.length === 0 ? "SUFFICIENT_STABLE_CULTURAL_PROFILE" : setOnly ? "SUFFICIENT_SET_ONLY" : "INSUFFICIENT",
    failed,
  };
}

export type GateStatus = "PASS" | "PARTIAL" | "FAIL" | "NOT_REQUIRED";
export type LiveGate = { id: string; name: string; tier: "CORE" | "ENHANCEMENT"; status: GateStatus; observed: string };

export type LiveObservations = {
  brandResolution: { resolvedId?: string; match?: string; pinnedMatches: boolean };
  pinnedTagSeenInSearch: boolean;
  exemplarsWithTags: number;
  brandConditionedTerritory: { label: string; affinity?: number }[];
  relatedBrands: { label: string; affinity?: number }[];
  sufficiency: { brand: ProfileSufficiency; target: ProfileSufficiency };
  audience: { returned: boolean; numericFieldPaths: string[]; documentedSemantics: false };
  demographics: { returned: boolean; numericFieldPaths: string[] };
  rankings: { label: string; correlationId?: string; order: { label: string; affinity?: number }[] }[];
  rankingRepeatIdentical: boolean | null;
  exemplarSensitivity: { hospitalityJointTagJaccard: Record<string, number>; rankPositionChanges: { territory: string; primary: number | null; alternate: number | null }[] };
  bridges: { label: string; jointTags: string[]; mutualRelated: string[] }[];
  trends: { returned: boolean; numericFieldPaths: string[] };
};

export type LiveRunResult = {
  steps: LiveStep[];
  packet: EvidencePacketInput | undefined;
  ingredients: AnalysisIngredients | undefined;
  observations: LiveObservations | undefined;
  gates: LiveGate[];
  decision: "GO" | "CONDITIONAL GO" | "NO-GO";
  blockedReason?: string;
};

const labelOf = (call: LiveCall | undefined) => (call ? toEntitySignals(call.operation, call.envelope).map((e) => ({ label: e.label, ...(e.affinity !== undefined && { affinity: e.affinity }) })) : []);
const tagIds = (call: LiveCall | undefined) => (call ? toTagSignals(call.operation, call.envelope).map((t) => t.qlooId) : []);
const tagValues = (call: LiveCall | undefined) => (call ? toTagSignals(call.operation, call.envelope).map((t) => t.affinity) : []);
const resultsOf = (call: LiveCall | undefined) => call?.envelope.results;

export async function runLiveInvestigation(collector: LiveCollector, config: LiveInvestigationConfig, today: Date): Promise<LiveRunResult> {
  const L = config.tagLimit;
  const limitations: Limitation[] = [];

  // G1: brand identity.
  const brandCall = await collector.call("brand.resolve", "describe", { entity: config.brand.query, type: "brand" });
  const resolved = brandCall ? (brandCall.envelope.interpretation as { entity?: { entityId?: string; match?: string } } | undefined)?.entity : undefined;
  const brandResolution = { ...(resolved?.entityId && { resolvedId: resolved.entityId }), ...(resolved?.match && { match: resolved.match }), pinnedMatches: resolved?.entityId === config.brand.id };
  if (!brandCall || !brandResolution.pinnedMatches) {
    const gates = evaluateLiveGates(undefined);
    return { steps: collector.steps, packet: undefined, ingredients: undefined, observations: undefined, gates, decision: "NO-GO", blockedReason: "Pinned brand did not resolve; nothing downstream is meaningful." };
  }

  // G2: territory concept and exemplars.
  let pinnedTagSeenInSearch = false;
  for (const query of config.territory.tagQueries) {
    const call = await collector.call(`territory.find_tags.${query}`, "find_tags", { query, semantic: true, limit: 10 });
    if (tagIds(call).includes(config.territory.pinnedTag.id)) pinnedTagSeenInSearch = true;
  }

  // Brand profile, with repeat and cross-take probes for G3 stability.
  const brandTags = await collector.call("brand.tags", "entity_tags", { entities: [config.brand.id], limit: L });
  const brandRepeat = await collector.call("brand.tags.repeat", "entity_tags", { entities: [config.brand.id], limit: L });
  const crossTake: Record<number, string[]> = {};
  for (const n of config.topN.filter((n) => n < L)) {
    const call = await collector.call(`brand.tags.take_${n}`, "entity_tags", { entities: [config.brand.id], limit: n });
    if (call) crossTake[n] = tagIds(call);
  }
  if (!brandTags) return blocked(collector, "Brand tags unavailable.");

  // Target: each pinned exemplar's own tags → recurring signals (derived representation).
  const exemplarCalls: LiveCall[] = [];
  for (const exemplar of config.territory.exemplars) {
    const call = await collector.call(`target.exemplar_tags.${exemplar.label}`, "entity_tags", { entities: [exemplar.id], limit: L });
    if (call) exemplarCalls.push(call);
  }
  const jointTarget = await collector.call("target.joint_tags", "entity_tags", { entities: config.territory.exemplars.map((e) => e.id), limit: L });

  const brandRelated = await collector.call("brand.related", "recommend", { target_type: "brand", signals: [config.brand.id], limit: L, explain: false });
  const conditioned = await collector.call("target.brand_conditioned", "recommend", { target_type: "place", signals: [config.brand.id], include_tags: [config.territory.pinnedTag.id], limit: L, explain: false }, { acceptEmpty: true });

  // Audience + demographics (opaque).
  const compare = await collector.call("audience.compare", "compare_audiences", { group_a: [config.brand.id], group_b: config.territory.exemplars.slice(0, config.audienceExemplarCap).map((e) => e.id), limit: 10 });
  const demographics = await collector.call("audience.demographics", "audience_demographics", { entity: config.brand.id });

  // Candidate ranking: primary exemplars, a repeat, and alternates (exemplar sensitivity).
  const primaries = config.ranking.candidates.map((c) => c.primary);
  const alternates = config.ranking.candidates.map((c) => c.alternate ?? c.primary);
  const rankPrimary = await collector.call("ranking.primary", "rank", { options: primaries.map((p) => p.id), option_type: config.ranking.optionType, signals: [config.brand.id] });
  const rankRepeat = await collector.call("ranking.primary.repeat", "rank", { options: primaries.map((p) => p.id), option_type: config.ranking.optionType, signals: [config.brand.id] });
  const rankAlternate = await collector.call("ranking.alternate", "rank", { options: alternates.map((p) => p.id), option_type: config.ranking.optionType, signals: [config.brand.id] });

  // Bridges: joint tags (one call) and mutually related brands (membership only).
  const bridgeObs: LiveObservations["bridges"] = [];
  const bridgeEvidence = [];
  for (const bridge of config.bridges) {
    const joint = await collector.call(`bridge.joint.${bridge.label}`, "entity_tags", { entities: [config.brand.id, bridge.exemplar.id], limit: L });
    const related = await collector.call(`bridge.related.${bridge.label}`, "recommend", { target_type: "brand", signals: [bridge.exemplar.id], limit: L, explain: false });
    const mutual = brandRelated && related ? mutualRelatedBridge(brandRelated, related, [config.brand.id, bridge.exemplar.id]) : undefined;
    if (bridge.label === config.territory.label) {
      if (joint) bridgeEvidence.push(jointSignalBridge(joint));
      if (mutual) bridgeEvidence.push(mutual);
    }
    bridgeObs.push({ label: bridge.label, jointTags: joint ? toTagSignals(joint.operation, joint.envelope).map((t) => t.label.trim()) : [], mutualRelated: mutual?.signals.map((s) => s.label) ?? [] });
  }

  // Momentum (exploratory only).
  const end = today;
  const start = new Date(end.getTime() - config.momentumWindowDays * 86_400_000);
  const trends = await collector.call("momentum.trends", "trends", { entities: [config.brand.id], entity_type: "brand", start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10) });

  // ---- Map verified evidence into the canonical packet. ----
  const brandSubject = pinnedSubject(config.brand, [brandCall]);
  const targetSubject = pinnedSubject({ id: config.territory.pinnedTag.id, label: config.territory.label, type: "territory:qloo_tag+exemplars" }, exemplarCalls);
  const brandProfile = brandProfileFromEntityTags(brandSubject, brandTags, L);
  const targetProfile = recurringSignalProfile(targetSubject, exemplarCalls, { minSupport: config.territory.recurringMinSupport, requestedLimit: L });
  const targetCandidate = config.ranking.candidates.find((c) => c.territory === config.territory.label)?.primary.id;

  limitations.push(
    { code: "AFFINITY_SCALE_UNDOCUMENTED", detail: "Qloo documents no meaning, range or direction for response affinity; values are compared only within one call" },
    { code: "TARGET_IS_DERIVED_REPRESENTATION", detail: `target = tags recurring in ≥${config.territory.recurringMinSupport} of ${exemplarCalls.length} pinned exemplars of ${config.territory.pinnedTag.id}; not a Qloo profile` },
    { code: "TERRITORY_EXEMPLARS_HUMAN_REVIEWED", detail: "exemplars came from a Qloo query (pinned tag ∩ hotel category, popularity ≥ 0.95) and were then human-reviewed" },
    { code: "RANKING_EXEMPLAR_APPROXIMATION", detail: "each candidate territory is represented by one brand exemplar; see config approximations" },
    { code: "OPERATIONAL_TAGS_PRESENT", detail: `tags in operational namespaces (${OPERATIONAL_TAG_NAMESPACES.join(", ")}) are kept but are not taste signals` },
    { code: "NO_GRAPH_DISTANCE", detail: "Qloo exposes no graph distance, path or hop count" },
    ...collector.flags,
  );
  for (const c of config.ranking.candidates) if (c.approximation) limitations.push({ code: "EXEMPLAR_SUBSTITUTED", detail: `${c.territory}: ${c.approximation}` });
  if (!compare) limitations.push({ code: "AUDIENCE_COMPARE_NOT_OBSERVED", detail: "compare_audiences did not return in this run" });

  const packet = assembleLivePacket({
    brand: brandProfile,
    target: targetProfile,
    ...(compare && { audience: audienceFromCompare(compare) }),
    ...(rankPrimary && { ranking: rankingFromRank(rankPrimary, config.brand.id, targetCandidate) }),
    bridges: bridgeEvidence,
    // Sprint 2: the brand-conditioned territory query now has a canonical packet slot.
    ...(conditioned && {
      conditionedEntities: [
        conditionedEntitiesFromRecommend(conditioned, {
          conditionedOn: { id: config.brand.id, label: config.brand.label },
          territory: { id: config.territory.pinnedTag.id, label: config.territory.pinnedTag.label },
          entityType: "urn:entity:place",
          requestedLimit: L,
        }),
      ],
    }),
    limitations,
  });
  const ingredients = analyzeEvidencePacket(packet);

  const rankOrder = (call: LiveCall | undefined) => labelOf(call);
  const position = (call: LiveCall | undefined, id: string) => {
    const index = call ? toEntitySignals(call.operation, call.envelope).findIndex((e) => e.qlooId === id) : -1;
    return index < 0 ? null : index + 1;
  };
  const observations: LiveObservations = {
    brandResolution,
    pinnedTagSeenInSearch,
    exemplarsWithTags: exemplarCalls.filter((c) => tagIds(c).length > 0).length,
    brandConditionedTerritory: labelOf(conditioned),
    relatedBrands: labelOf(brandRelated),
    sufficiency: {
      brand: assessProfileSufficiency({ role: "brand", ids: tagIds(brandTags), values: tagValues(brandTags), ...(brandRepeat && { repeatIds: tagIds(brandRepeat) }), crossTake }),
      target: assessProfileSufficiency({ role: "target", ids: targetProfile.signals.map((s) => s.id), values: targetProfile.signals.map(() => undefined), derivedSetOnly: true }),
    },
    audience: { returned: Boolean(compare), numericFieldPaths: numericFieldPaths(resultsOf(compare)), documentedSemantics: false },
    demographics: { returned: Boolean(demographics), numericFieldPaths: numericFieldPaths(resultsOf(demographics)) },
    rankings: [
      { label: "primary", ...(rankPrimary && { correlationId: rankPrimary.envelope.execution.correlation_id }), order: rankOrder(rankPrimary) },
      { label: "alternate", ...(rankAlternate && { correlationId: rankAlternate.envelope.execution.correlation_id }), order: rankOrder(rankAlternate) },
    ],
    rankingRepeatIdentical: rankPrimary && rankRepeat ? JSON.stringify(rankOrder(rankPrimary)) === JSON.stringify(rankOrder(rankRepeat)) : null,
    exemplarSensitivity: {
      hospitalityJointTagJaccard: { recurring_vs_joint: setOverlap(targetProfile.signals.map((s) => s.id), tagIds(jointTarget)).jaccard ?? 0 },
      rankPositionChanges: config.ranking.candidates.filter((c) => c.alternate).map((c) => ({ territory: c.territory, primary: position(rankPrimary, c.primary.id), alternate: position(rankAlternate, (c.alternate as PinnedEntity).id) })),
    },
    bridges: bridgeObs,
    trends: { returned: Boolean(trends), numericFieldPaths: numericFieldPaths((trends?.envelope as Record<string, unknown> | undefined)?.series) },
  };

  const gates = evaluateLiveGates(observations, config.territory.exemplars.length);
  return { steps: collector.steps, packet, ingredients, observations, gates, decision: decide(gates) };
}

function blocked(collector: LiveCollector, reason: string): LiveRunResult {
  return { steps: collector.steps, packet: undefined, ingredients: undefined, observations: undefined, gates: evaluateLiveGates(undefined), decision: "NO-GO", blockedReason: reason };
}

const worst = (a: ProfileSufficiency["verdict"], b: ProfileSufficiency["verdict"]) => {
  const order = ["INSUFFICIENT", "SUFFICIENT_SET_ONLY", "SUFFICIENT_STABLE_CULTURAL_PROFILE"] as const;
  return order[Math.min(order.indexOf(a), order.indexOf(b))] as ProfileSufficiency["verdict"];
};

/** Revised G1–G6. Deterministic over observations; definitions documented in the feasibility report. */
export function evaluateLiveGates(o: LiveObservations | undefined, pinnedExemplarCount = 0): LiveGate[] {
  if (!o) {
    return [
      { id: "G1", name: "Confirmed brand identity", tier: "CORE", status: "FAIL", observed: "brand did not resolve to the pinned entity" },
      ...["G2", "G3", "G4", "G5", "G6"].map((id) => ({ id, name: "not evaluated", tier: (["G2", "G3"].includes(id) ? "CORE" : "ENHANCEMENT") as LiveGate["tier"], status: "FAIL" as GateStatus, observed: "blocked by G1" })),
    ];
  }
  const g3 = worst(o.sufficiency.brand.verdict, o.sufficiency.target.verdict);
  const ranked = o.rankings[0]?.order ?? [];
  const sensitivityChanged = o.exemplarSensitivity.rankPositionChanges.filter((c) => c.primary !== c.alternate).length;
  const bridgeHasContent = o.bridges.some((b) => b.jointTags.length > 0 || b.mutualRelated.length > 0);
  return [
    {
      id: "G1",
      name: "Confirmed brand identity",
      tier: "CORE",
      status: o.brandResolution.pinnedMatches && o.brandResolution.match === "exact" ? "PASS" : o.brandResolution.pinnedMatches ? "PARTIAL" : "FAIL",
      observed: `resolved ${o.brandResolution.resolvedId ?? "none"} (match=${o.brandResolution.match ?? "n/a"}); pinned matches=${o.brandResolution.pinnedMatches}`,
    },
    {
      id: "G2",
      name: "Confirmed target territory representation",
      tier: "CORE",
      status: o.pinnedTagSeenInSearch && o.exemplarsWithTags >= 5 && o.brandConditionedTerritory.length >= 5 ? "PASS" : o.pinnedTagSeenInSearch ? "PARTIAL" : "FAIL",
      observed: `pinned tag in tag search=${o.pinnedTagSeenInSearch}; ${o.exemplarsWithTags}/${pinnedExemplarCount} pinned exemplars returned tags; ${o.brandConditionedTerritory.length} brand-conditioned territory entities`,
    },
    {
      id: "G3",
      name: "Sufficient stable cultural profile evidence",
      tier: "CORE",
      status: g3 === "SUFFICIENT_STABLE_CULTURAL_PROFILE" ? "PASS" : g3 === "SUFFICIENT_SET_ONLY" ? "PARTIAL" : o.sufficiency.brand.verdict !== "INSUFFICIENT" ? "PARTIAL" : "FAIL",
      observed: `brand ${o.sufficiency.brand.verdict} [${o.sufficiency.brand.failed.join("; ") || "all criteria met"}]; target ${o.sufficiency.target.verdict} [${o.sufficiency.target.failed.join("; ") || "all criteria met"}]`,
    },
    {
      id: "G4",
      name: "Interpretable audience evidence",
      tier: "ENHANCEMENT",
      // Demographics: direction documented ("positive = stronger-than-average alignment"), but no scale,
      // baseline or cross-entity comparability, so it cannot compare brand and territory audiences.
      status: o.demographics.returned ? "PARTIAL" : "FAIL",
      observed: `${o.audience.returned ? `compare_audiences returned ${o.audience.numericFieldPaths.length} numeric field path(s), none documented` : "compare_audiences did not return"}; demographics ${o.demographics.returned ? "returned (single-entity skew, direction documented, not comparable across calls)" : "not returned"}`,
    },
    {
      id: "G5",
      name: "Valid candidate-relative evidence",
      tier: "ENHANCEMENT",
      status: ranked.filter((r) => r.affinity !== undefined).length >= 4 && o.rankingRepeatIdentical === true ? (sensitivityChanged > 0 ? "PARTIAL" : "PASS") : "FAIL",
      observed: `${ranked.filter((r) => r.affinity !== undefined).length} candidates with within-call affinity; repeat identical=${o.rankingRepeatIdentical}; ${sensitivityChanged}/${o.exemplarSensitivity.rankPositionChanges.length} territories change position when the exemplar changes`,
    },
    {
      id: "G6",
      name: "Useful intermediate cultural bridge evidence",
      tier: "ENHANCEMENT",
      status: bridgeHasContent ? "PARTIAL" : "FAIL",
      observed: bridgeHasContent ? "qualitative only (B): joint tags and mutually related brands exist, but no documented strength or path semantics" : "no bridge content (C)",
    },
  ];
}

/** GO needs every gate PASS. Any CORE FAIL → NO-GO. Otherwise CONDITIONAL GO. */
export function decide(gates: LiveGate[]): LiveRunResult["decision"] {
  if (gates.some((g) => g.tier === "CORE" && g.status === "FAIL")) return "NO-GO";
  if (gates.every((g) => g.status === "PASS" || g.status === "NOT_REQUIRED")) return "GO";
  return "CONDITIONAL GO";
}
