/**
 * Sprint 2 live capture: Qloo (harness) → live adapter → canonical MethodologyInput, one per brand.
 *
 * Calls (hackathon API only; the caller enforces the host gate):
 *   per territory  find_tags(concept label)           confirms the pinned concept still exists
 *   per exemplar   entity_tags(exemplar, take)        exemplar tag profile (shared across brands)
 *   per brand      describe(brand)                    identity gate: must resolve to the pinned id
 *                  entity_tags(brand, take)           brand tag profile
 *                  rank × panels                      one call per panel, one exemplar per territory
 *                  recommend × territories            brand-conditioned territory entities
 *
 * It computes nothing. Every value keeps the correlation id of its call. A failed call leaves its
 * evidence absent (never zero), and the methodology reports the gap.
 */
import type { Limitation, ProvenanceRef } from "../evidence/schema.js";
import type { LiveCollector } from "../feasibility/live.js";
import { METHODOLOGY_INPUT_SCHEMA_VERSION, type MethodologyInputRaw } from "../methodology/contracts.js";
import { toTagSignals } from "../qloo/normalize.js";
import {
  brandProfileFromEntityTags,
  callProvenance,
  conditionedEntitiesFromRecommend,
  pinnedSubject,
  rankingFromRank,
  type LiveCall,
} from "../qloo/live-adapter.js";
import type { CaptureBrand, ElasticityCaptureConfig } from "./elasticity-config.js";

export type BrandCapture = { brandKey: string; input?: MethodologyInputRaw; blockedReason?: string; stepIds: string[] };
export type ElasticityCaptureResult = { brands: BrandCapture[]; sharedStepIds: string[] };

export const CAPTURE_LIMITATIONS: Limitation[] = [
  { code: "AFFINITY_SCALE_UNDOCUMENTED", detail: "Qloo documents no meaning, range or direction for response affinity; values are compared only within one call" },
  { code: "NO_GRAPH_DISTANCE", detail: "Qloo exposes no network hop count or path endpoint; nothing here is a measured network separation" },
  { code: "TERRITORY_EXEMPLARS_HUMAN_REVIEWED", detail: "territory exemplars were pinned by a human from category knowledge after live resolution; see each territory's assumptions and warnings" },
  { code: "TAG_PROFILES_TRUNCATED_AT_TAKE", detail: "tag profiles are the top 20 returned at one fixed take (harness cap); overlap describes this representation only" },
];

export async function runElasticityCapture(collector: LiveCollector, config: ElasticityCaptureConfig, brandKeys?: readonly string[]): Promise<ElasticityCaptureResult> {
  const take = config.tagTake;
  const before = () => collector.steps.length;
  const idsSince = (start: number) => collector.steps.slice(start).map((step) => step.id);

  // Shared evidence: concepts and exemplar profiles do not depend on the brand.
  const sharedStart = before();
  const conceptCalls = new Map<string, LiveCall>();
  for (const territory of config.territories) {
    const call = await collector.call(`concept.${territory.id}`, "find_tags", { query: territory.concept.label, semantic: true, limit: 10 });
    if (call && toTagSignals(call.operation, call.envelope).some((tag) => tag.qlooId === territory.concept.id)) conceptCalls.set(territory.id, call);
  }
  const exemplarTags = new Map<string, LiveCall>();
  for (const territory of config.territories) {
    for (const exemplar of territory.exemplars) {
      const call = await collector.call(`exemplar.tags.${territory.id}.${exemplar.label}`, "entity_tags", { entities: [exemplar.id], limit: take });
      if (call) exemplarTags.set(exemplar.id, call);
    }
  }
  const sharedStepIds = idsSince(sharedStart);

  const brands: BrandCapture[] = [];
  for (const brand of config.brands.filter((b) => brandKeys === undefined || brandKeys.includes(b.key))) {
    const start = before();
    const capture = await captureBrand(collector, config, brand, conceptCalls, exemplarTags);
    brands.push({ ...capture, brandKey: brand.key, stepIds: idsSince(start) });
  }
  return { brands, sharedStepIds };
}

async function captureBrand(
  collector: LiveCollector,
  config: ElasticityCaptureConfig,
  brand: CaptureBrand,
  conceptCalls: Map<string, LiveCall>,
  exemplarTags: Map<string, LiveCall>,
): Promise<{ input?: MethodologyInputRaw; blockedReason?: string }> {
  const key = brand.key;
  const take = config.tagTake;
  const resolve = await collector.call(`${key}.resolve`, "describe", { entity: brand.query, type: "brand" });
  const resolvedId = (resolve?.envelope.interpretation as { entity?: { entityId?: string } } | undefined)?.entity?.entityId;
  if (!resolve || resolvedId !== brand.id) return { blockedReason: `brand did not resolve to the pinned id (resolved ${resolvedId ?? "nothing"})` };
  const tags = await collector.call(`${key}.tags`, "entity_tags", { entities: [brand.id], limit: take });
  if (!tags) return { blockedReason: "brand tag profile unavailable" };

  const limitations: Limitation[] = [...CAPTURE_LIMITATIONS];
  const panels: NonNullable<MethodologyInputRaw["panels"]> = [];
  for (const panel of config.panels) {
    const assignments = config.territories.map((territory) => ({ territoryId: territory.id, exemplarId: (territory.exemplars[panel.exemplarIndex] ?? territory.exemplars[0]!).id }));
    const call = await collector.call(`${key}.panel.${panel.id}`, "rank", { options: assignments.map((a) => a.exemplarId), option_type: "brand", signals: [brand.id] });
    if (!call) limitations.push({ code: "PANEL_CALL_FAILED", detail: `panel ${panel.id}: the rank call did not return a usable result` });
    panels.push({
      id: panel.id,
      purpose: panel.purpose,
      ...(panel.repeatOf !== undefined && { repeatOf: panel.repeatOf }),
      assignments,
      ...(call && { ranking: rankingFromRank(call, brand.id, undefined) }),
    });
  }

  const conditioned: NonNullable<MethodologyInputRaw["conditioned"]> = [];
  for (const territory of config.territories) {
    const call = await collector.call(
      `${key}.conditioned.${territory.id}`,
      "recommend",
      { target_type: territory.conditionedTargetType, signals: [brand.id], include_tags: [territory.concept.id], limit: config.conditionedLimit, explain: false },
      { acceptEmpty: true },
    );
    if (!call) {
      limitations.push({ code: "CONDITIONED_CALL_FAILED", detail: `${territory.id}: the brand-conditioned call did not return a usable result` });
      continue;
    }
    conditioned.push(
      conditionedEntitiesFromRecommend(call, {
        conditionedOn: { id: brand.id, label: brand.label },
        territory: { id: territory.concept.id, label: territory.concept.label },
        entityType: `urn:entity:${territory.conditionedTargetType}`,
        requestedLimit: config.conditionedLimit,
      }),
    );
  }

  const territories = config.territories.map((territory) => {
    const conceptCall = conceptCalls.get(territory.id);
    if (!conceptCall) limitations.push({ code: "CONCEPT_NOT_CONFIRMED", detail: `${territory.id}: the pinned concept ${territory.concept.id} was not returned by tag search in this capture` });
    return {
      id: territory.id,
      label: territory.label,
      concept: { id: territory.concept.id, label: territory.concept.label, type: territory.concept.type },
      exemplars: territory.exemplars.map((exemplar, index) => {
        const call = exemplarTags.get(exemplar.id);
        return {
          id: exemplar.id,
          label: exemplar.label,
          type: exemplar.type,
          role: index === 0 ? ("primary" as const) : ("alternate" as const),
          ...(exemplar.note !== undefined && { note: exemplar.note }),
          provenance: call ? [callProvenance(call)] : [],
        };
      }),
      rejectedExemplars: territory.rejectedExemplars,
      assumptions: territory.assumptions,
      approximationWarnings: territory.approximationWarnings,
      provenance: conceptCall ? [callProvenance(conceptCall)] : [],
    };
  });

  const exemplarProfiles = config.territories.flatMap((territory) =>
    territory.exemplars.flatMap((exemplar) => {
      const call = exemplarTags.get(exemplar.id);
      if (!call) {
        limitations.push({ code: "EXEMPLAR_PROFILE_MISSING", detail: `${territory.id}: no tag profile for ${exemplar.label}` });
        return [];
      }
      return [brandProfileFromEntityTags(pinnedSubject(exemplar, [call]), call, take)];
    }),
  );

  limitations.push(...collector.flags);
  const brandSubject = pinnedSubject(brand, [resolve]);
  const provenance: ProvenanceRef[] = [callProvenance(resolve), callProvenance(tags)];
  return {
    input: {
      schemaVersion: METHODOLOGY_INPUT_SCHEMA_VERSION,
      origin: "live",
      brand: brandProfileFromEntityTags(brandSubject, tags, take),
      tagTake: take,
      territories,
      exemplarProfiles,
      panels,
      conditioned,
      limitations,
      provenance,
    },
  };
}
