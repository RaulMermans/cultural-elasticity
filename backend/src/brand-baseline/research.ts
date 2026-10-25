import { createHash } from "node:crypto";
import {
  BRAND_BASELINE_SCHEMA_VERSION,
  BRAND_BASELINE_TEMPLATE_VERSION,
  type BaselineEvidenceRef,
  type BaselineExclusion,
  type BaselineHypothesis,
  type BaselineScopeBasis,
  type BaselineSignal,
  type BaselineTagRole,
  type BaselineTemplateVersion,
  type BaselineTheme,
  type BaselineTypeEvidence,
  type BrandBaselineResult,
} from "@cultural-elasticity/shared";
import type { CulturalSignal, ProvenanceRef, ResolvedConcept } from "../contracts/qloo.js";
import { matchOperationalRule, tagNamespace } from "../methodology/operational-tags.js";
import type { QlooClient, QlooOutcome, EntityTagsData, RecommendData } from "../qloo/client.js";
import type { QlooInsightsType } from "../qloo/types.js";
import type { StoredBaselineObservation } from "./schema.js";

export const BASELINE_DOMAINS: readonly QlooInsightsType[] = ["artist", "place", "movie", "book"];
export const BASELINE_MAX_CALLS = 7;
/**
 * v2 reads 20 tags (the harness maximum) in the same single call. Evidence: in all seven recorded live brand
 * profiles, 5–6 of the first 10 tags were venue-listing attributes, and curated concepts mostly ranked 11–20.
 */
export const BASELINE_TAG_TAKE = 20;
export const BASELINE_LEGACY_TAG_TAKE = 10;
export const BASELINE_ENTITY_TAKE = 10;
export const BASELINE_MAX_TERRITORIES = 5;
export const BASELINE_DISCOVERY_RULE = "observed-cultural-tag/v2";
export const BASELINE_THEME_RULE = "tag-facet-group/v1";

export type BrandResolution =
  | { status: "RESOLVED"; entity: ResolvedConcept; capturedAt: string }
  | { status: "AMBIGUOUS"; candidates: { qlooId: string; label: string; type?: string }[] }
  | { status: "NOT_FOUND" }
  | { status: "TEMPORARILY_UNAVAILABLE"; code: string };

export function isBrandType(type: string | undefined): boolean {
  return type === "brand" || type === "urn:entity:brand";
}

/** Never silently pick from multiple Qloo candidates. A selected ID must resolve back to that exact ID. */
export async function resolveBrand(client: Pick<QlooClient, "describe">, input: string, selectedQlooId?: string): Promise<BrandResolution> {
  const name = input.trim().replace(/\s+/gu, " ");
  if (name.length < 2 || name.length > 200 || [...name].some((character) => character.charCodeAt(0) < 32)) throw new RangeError("INVALID_BRAND_NAME");
  if (selectedQlooId !== undefined && (!/^[A-Za-z0-9:_-]{2,200}$/u.test(selectedQlooId))) throw new RangeError("INVALID_BRAND_REFERENCE");
  const capturedAt = new Date().toISOString();
  try {
    const outcome = await client.describe({ entity: selectedQlooId ?? name, type: "brand" });
    if (outcome.kind === "empty") return { status: "NOT_FOUND" };
    if (outcome.kind === "needs_input") {
      const candidates = outcome.issues.flatMap((issue) => issue.candidates).filter((candidate) => isBrandType(candidate.type));
      const unique = [...new Map(candidates.map((candidate) => [candidate.qlooId, candidate])).values()];
      return unique.length ? { status: "AMBIGUOUS", candidates: unique } : { status: "NOT_FOUND" };
    }
    const entity = outcome.data.entity;
    if (outcome.provenance.status !== "ok") return { status: "TEMPORARILY_UNAVAILABLE", code: "IDENTITY_EVIDENCE_PARTIAL" };
    if (!isBrandType(entity.type)) return { status: "NOT_FOUND" };
    if (selectedQlooId && entity.qlooId !== selectedQlooId) return { status: "NOT_FOUND" };
    if (entity.confirmation !== "unambiguous" || entity.alternatives.length > 0) {
      const candidates = [{ qlooId: entity.qlooId, label: entity.label, type: entity.type }, ...entity.alternatives.filter((candidate) => isBrandType(candidate.type))];
      return { status: "AMBIGUOUS", candidates };
    }
    return { status: "RESOLVED", entity, capturedAt };
  } catch {
    return { status: "TEMPORARILY_UNAVAILABLE", code: "QLOO_UNAVAILABLE" };
  }
}

export type BaselineObservation = {
  domain: "tags" | QlooInsightsType;
  outcome: QlooOutcome<EntityTagsData> | QlooOutcome<RecommendData>;
  capturedAt: string;
  /** Replay only: the `filter.type` a stored 0.3 artifact recorded (live captures read it from provenance.requests). */
  recordedRequestType?: string;
  /** Replay only: a 0.2 artifact never captured the provider request, so query scope rests on the stored stage. */
  scopeFromTemplateStage?: boolean;
};

const DOMAIN_WORDS: Record<string, { plural: string; singular: string }> = {
  artist: { plural: "artists", singular: "artist" },
  place: { plural: "places", singular: "place" },
  movie: { plural: "films", singular: "film" },
  book: { plural: "books", singular: "book" },
};
const domainWords = (domain: string) => DOMAIN_WORDS[domain] ?? { plural: `${domain} results`, singular: `${domain} result` };
const humanize = (value: string) => value.replaceAll("_", " ").replace(/^\p{L}/u, (letter) => letter.toUpperCase());

/** Facet label from the URN alone (`urn:tag:<namespace>:<source>`), never from the tag's name. */
export function facetLabel(facet: string): string {
  const [namespace = "", source = ""] = facet.split(":");
  if (source === "qloo") return namespace === "keyword" ? "Curated keywords" : humanize(namespace);
  const noun = namespace === "genre" ? "genres" : namespace === "keyword" ? "keywords" : namespace.replaceAll("_", " ");
  return `${humanize(source)} ${noun}`;
}

/**
 * Role of a non-operational tag, by URN facet. Brand classification: `genre:brand` and the curated `industry` and
 * `product_service` concepts described the brand's own category or products in every recorded live profile.
 * Free media keywords are descriptive and noisy. Everything else is a taxonomy-level taste classification.
 */
export function tagRole(facet: string): BaselineTagRole {
  const [namespace, source] = facet.split(":");
  if ((namespace === "genre" && source === "brand") || (source === "qloo" && (namespace === "industry" || namespace === "product_service"))) return "BRAND_CLASSIFICATION";
  if (namespace === "keyword" && source !== "qloo") return "DESCRIPTIVE_KEYWORD";
  return "AUDIENCE_TASTE";
}

/** Exact equality after case, accent and punctuation folding. Used only to flag possible duplicates, never to merge. */
export const normalizedName = (name: string) => name.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, "");

function recordedRequestType(observation: BaselineObservation): string | undefined {
  if (observation.recordedRequestType) return observation.recordedRequestType;
  const types = new Set((observation.outcome.provenance.requests ?? []).map((request) => {
    const query = request.query as Record<string, unknown> | null;
    return query && typeof query["filter.type"] === "string" ? query["filter.type"] : undefined;
  }));
  return types.size === 1 ? [...types][0] : undefined;
}

/** Type evidence for one returned entity. A query restricted to a type never becomes an entity-level confirmation. */
export function groundEntityType(signal: Pick<CulturalSignal, "type" | "subtype">, requestedType: string, scopeBasis: BaselineScopeBasis | null): BaselineTypeEvidence {
  const specific = [signal.type, signal.subtype]
    .filter((value): value is string => typeof value === "string" && value !== "urn:entity" && value.length > 0)
    .map((value) => (value.startsWith("urn:") ? value : `urn:entity:${value}`));
  if (specific.some((value) => value !== requestedType && !value.startsWith(`${requestedType}:`))) return "CONFLICTING_TYPE";
  if (specific.length) return "PROVIDER_CONFIRMED_TYPE";
  return scopeBasis ? "QUERY_SCOPED" : "GENERIC_TYPE_UNRESOLVED";
}

function evidenceRef(signal: CulturalSignal, observation: BaselineObservation): BaselineEvidenceRef | null {
  if (observation.outcome.kind !== "ok") return null;
  const provenance = observation.outcome.provenance;
  if (provenance.status !== "ok" && provenance.status !== "partial" && provenance.status !== "degraded") return null;
  if (signal.sourceCorrelationId !== provenance.correlationId) return null;
  return {
    operation: observation.domain === "tags" ? "entity_tags" : "recommend",
    correlationId: provenance.correlationId,
    sourceId: signal.qlooId,
    capturedAt: observation.capturedAt,
    sourceStatus: provenance.status,
    scope: observation.domain,
  };
}

const stableId = (...parts: string[]) => createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 24);

/**
 * Pure projection of frozen Qloo outcomes, in three levels that are never conflated:
 * observed associations (the fingerprint), themes (facet groupings), and territory hypotheses.
 * No cross-call numerical comparison, no score, no model.
 */
export function buildBaselineResult(input: {
  scanId: string;
  brandId: string;
  brand: ResolvedConcept;
  brandCapturedAt: string;
  observations: BaselineObservation[];
  startedAt: string;
  finishedAt: string;
  providerCallCount: number;
  recordedOrLive: "recorded" | "live";
  incompleteStages?: string[];
  budgetStatus?: "WITHIN_LIMIT" | "EXHAUSTED" | "UNCERTAIN";
  templateVersion?: BaselineTemplateVersion;
  derivedFrom?: { scanId: string; schemaVersion: string; note: string };
}): BrandBaselineResult {
  const identity = input.brand.provenance.find((item) => item.operation === "describe" && item.correlationId);
  if (!identity || (identity.status !== "ok" && identity.status !== "partial" && identity.status !== "degraded")) throw new Error("BRAND_PROVENANCE_MISSING");
  const templateVersion = input.templateVersion ?? BRAND_BASELINE_TEMPLATE_VERSION;
  const tagTake = templateVersion === BRAND_BASELINE_TEMPLATE_VERSION ? BASELINE_TAG_TAKE : BASELINE_LEGACY_TAG_TAKE;
  const brandName = input.brand.label;
  const identitySource: BaselineEvidenceRef = { operation: "describe", correlationId: identity.correlationId, sourceId: input.brand.qlooId, capturedAt: input.brandCapturedAt, sourceStatus: identity.status, scope: "identity" };
  const signals: BaselineSignal[] = [];
  const excluded: BaselineExclusion[] = [];
  const coverage: BrandBaselineResult["fingerprint"]["domainCoverage"] = [];
  const limitations = new Set<string>();
  const provenance: BaselineEvidenceRef[] = [];
  const audit: BrandBaselineResult["audit"] = {
    returnedTags: 0, operationalTags: 0, culturalTags: 0, possibleDuplicateTags: 0, returnedEntities: 0,
    typeEvidence: { PROVIDER_CONFIRMED_TYPE: 0, QUERY_SCOPED: 0, GENERIC_TYPE_UNRESOLVED: 0, CONFLICTING_TYPE: 0 },
    retainedAssociations: 0, excludedEntities: 0, themes: 0, hypotheses: 0,
  };
  const tagCountByCall = new Map<string, number>();
  const processedCalls = new Set<string>();
  const scopedLists = new Set<string>();
  const unresolvedLists = new Set<string>();

  for (const observation of input.observations) {
    const outcome = observation.outcome;
    // A second copy of the same Qloo call is the same observation, never extra support.
    if (processedCalls.has(outcome.provenance.correlationId)) continue;
    processedCalls.add(outcome.provenance.correlationId);
    const words = domainWords(observation.domain);
    if (outcome.kind !== "ok") {
      coverage.push({ domain: observation.domain, status: outcome.kind === "empty" ? "EMPTY" : "UNAVAILABLE", entityCount: 0 });
      if (outcome.kind === "needs_input") limitations.add(`${observation.domain === "tags" ? "Tags" : humanize(words.plural)}: Qloo asked for clarification, so this part of the profile is unavailable.`);
      continue;
    }
    const status = outcome.provenance.degraded ? "DEGRADED" : outcome.provenance.partial ? "PARTIAL" : "OBSERVED";
    const isTags = observation.domain === "tags";
    const raw = isTags ? (outcome.data as EntityTagsData).tags : (outcome.data as RecommendData).entities;
    coverage.push({ domain: observation.domain, status, entityCount: raw.length });
    if (status !== "OBSERVED") limitations.add(`${isTags ? "Tags" : humanize(words.plural)}: Qloo marked this response ${status.toLowerCase()}, so findings from it are partial.`);
    const requestedType = `urn:entity:${observation.domain}`;
    const recordedType = isTags ? undefined : recordedRequestType(observation);
    const scopeBasis: BaselineScopeBasis | null = recordedType === requestedType ? "RECORDED_PROVIDER_REQUEST" : recordedType === undefined && observation.scopeFromTemplateStage ? "BASELINE_TEMPLATE_STAGE" : null;
    if (!isTags && recordedType !== undefined && recordedType !== requestedType) limitations.add(`${humanize(words.plural)}: Qloo recorded a different query type than the one requested, so these results were set aside.`);
    if (scopeBasis === "BASELINE_TEMPLATE_STAGE") limitations.add("This stored scan did not keep Qloo's own record of each request; what each related list was searched for comes from the stored research step.");
    if (isTags) {
      audit.returnedTags += raw.length;
      if (raw.length > tagTake) limitations.add(`Tags: only the first ${tagTake} tags returned by Qloo were read.`);
    } else audit.returnedEntities += raw.length;
    const seen = new Set<string>();
    const names = new Map<string, string>();
    raw.slice(0, isTags ? tagTake : BASELINE_ENTITY_TAKE).forEach((signal, index) => {
      if (seen.has(signal.qlooId)) return;
      seen.add(signal.qlooId);
      const source = evidenceRef(signal, observation);
      if (!source) {
        limitations.add(`${isTags ? "Tags" : humanize(words.plural)}: a result without matching call provenance was set aside.`);
        return;
      }
      const base = { id: signal.qlooId, name: signal.label, kind: signal.kind, domain: observation.domain, source, rankWithinCall: index + 1 };
      if (isTags) {
        // The tag URN is authoritative; a returned type label never overrides it.
        const ns = signal.kind === "tag" ? tagNamespace({ id: signal.qlooId, category: undefined }) : undefined;
        if (!ns) {
          excluded.push({ id: signal.qlooId, name: signal.label, domain: "tags", rule: "unrecognized_tag_reference", reason: "Not a recognizable Qloo tag reference, so it cannot be classified.", source });
          return;
        }
        const operational = matchOperationalRule({ id: signal.qlooId, category: undefined });
        if (operational) {
          audit.operationalTags += 1;
          excluded.push({ id: signal.qlooId, name: signal.label, domain: "tags", rule: operational.id, reason: operational.reason, source });
          limitations.add("Some returned tags describe store or venue listings (payment, price, rating, menu or venue category). They were set aside as operational metadata, not culture.");
          return;
        }
        const facet = `${ns.namespace}:${ns.source}`;
        const key = normalizedName(signal.label);
        const duplicateOf = key ? names.get(key) : undefined;
        if (key && !duplicateOf) names.set(key, signal.qlooId);
        if (duplicateOf) audit.possibleDuplicateTags += 1;
        audit.culturalTags += 1;
        signals.push({ ...base, facet, role: tagRole(facet), ...(duplicateOf ? { possibleDuplicateOf: duplicateOf } : {}) });
      } else {
        if (signal.kind !== "entity") {
          excluded.push({ id: signal.qlooId, name: signal.label, domain: observation.domain, rule: "not_an_entity", reason: "A related-entity query returned a non-entity result.", source });
          audit.excludedEntities += 1;
          return;
        }
        const typeEvidence = recordedType !== undefined && recordedType !== requestedType ? "CONFLICTING_TYPE" : groundEntityType(signal, requestedType, scopeBasis);
        audit.typeEvidence[typeEvidence] += 1;
        if (typeEvidence === "CONFLICTING_TYPE") {
          audit.excludedEntities += 1;
          excluded.push({ id: signal.qlooId, name: signal.label, domain: observation.domain, rule: "conflicting_type", reason: `Qloo's type for this result conflicts with the requested ${words.singular} query.`, source });
          return;
        }
        if (typeEvidence === "GENERIC_TYPE_UNRESOLVED") unresolvedLists.add(words.plural);
        if (typeEvidence === "QUERY_SCOPED") scopedLists.add(words.plural);
        audit.retainedAssociations += 1;
        signals.push({ ...base, grounding: { typeEvidence, providerType: signal.type ?? null, providerSubtype: signal.subtype ?? null, requestedType, scopeBasis } });
      }
      provenance.push(source);
    });
    if (isTags) tagCountByCall.set(outcome.provenance.correlationId, Math.min(raw.length, tagTake));
  }

  const list = (items: Set<string>) => [...items].join(", ").replace(/, ([^,]*)$/u, " and $1");
  if (scopedLists.size) limitations.add(`Qloo did not label each related result with its own type. The ${list(scopedLists)} are shown as results of a search for that kind of result, not as individually confirmed.`);
  if (unresolvedLists.size) limitations.add(`Qloo did not label the related ${list(unresolvedLists)} with a type, and what was searched for could not be verified, so they are unclassified.`);
  const tags = signals.filter((signal) => signal.kind === "tag" && signal.facet);
  const themes: BaselineTheme[] = [];
  for (const facet of [...new Set(tags.map((tag) => tag.facet!))]) {
    const members = [...new Map(tags.filter((tag) => tag.facet === facet).map((tag) => [tag.id, tag])).values()];
    const distinct = members.filter((tag) => !tag.possibleDuplicateOf);
    if (new Set(distinct.map((tag) => normalizedName(tag.name))).size < 2) continue;
    themes.push({ id: stableId(input.brand.qlooId, BASELINE_THEME_RULE, facet), label: facetLabel(facet), rule: BASELINE_THEME_RULE, facet, memberIds: distinct.map((tag) => tag.id), possibleDuplicateIds: members.filter((tag) => tag.possibleDuplicateOf).map((tag) => tag.id) });
  }

  // One hypothesis per canonical tag ID. Support is independent only across distinct Qloo calls.
  const byConcept = new Map<string, BaselineSignal[]>();
  for (const tag of tags) if (tag.role === "AUDIENCE_TASTE" && !tag.possibleDuplicateOf && tag.name.trim().length > 1) byConcept.set(tag.id, [...(byConcept.get(tag.id) ?? []), tag]);
  const territories: BaselineHypothesis[] = [...byConcept.values()].slice(0, BASELINE_MAX_TERRITORIES).map((support) => {
    const first = support[0]!;
    const calls = new Set(support.map((item) => item.source.correlationId));
    const partial = support.some((item) => item.source.sourceStatus !== "ok");
    const evidenceStatus = partial ? "PARTIAL_EVIDENCE" as const : calls.size >= 2 ? "MULTI_SIGNAL_SUPPORT" as const : "OBSERVED_ASSOCIATION" as const;
    const returned = tagCountByCall.get(first.source.correlationId) ?? first.rankWithinCall;
    const facetName = facetLabel(first.facet!).toLocaleLowerCase("en");
    return {
      id: stableId(input.brand.qlooId, first.id),
      name: first.name,
      canonicalConcept: first.id,
      level: "TERRITORY_HYPOTHESIS",
      validation: "UNVALIDATED",
      evidenceStatus,
      discoveryBasis: BASELINE_DISCOVERY_RULE,
      facet: first.facet!,
      observedDomains: [...new Set(support.map((item) => item.domain))],
      supportingReferences: support.map((item) => item.source),
      explanation: `Qloo's tag profile for ${brandName} includes “${first.name}” (${facetName}), at position ${first.rankWithinCall} of ${returned} in Qloo's returned order.`,
      nextInvestigation: `Run a deep research comparison to test whether ${brandName}'s audience over-indexes on “${first.name}” against comparable references.`,
      limitations: [
        calls.size >= 2 ? "Supported by more than one Qloo call, but still not a validated relative analysis." : "One Qloo tag observation. Not corroborated by an independent call.",
        "A brand association, not a validated relative analysis or a commercial opportunity.",
        ...(partial ? ["Qloo marked the source response partial or degraded."] : []),
      ],
      availableActions: ["inspect_evidence"],
    };
  });
  audit.themes = themes.length;
  audit.hypotheses = territories.length;

  const reasons: string[] = [];
  const nextSteps: string[] = [];
  const tagCoverage = coverage.filter((item) => item.domain === "tags");
  if (!territories.length) {
    if (!tagCoverage.some((item) => item.status !== "EMPTY" && item.status !== "UNAVAILABLE")) reasons.push("Qloo returned no usable tag profile for this brand, and territory hypotheses come only from tags.");
    else if (audit.culturalTags === 0 && audit.operationalTags > 0 && audit.operationalTags >= Math.min(audit.returnedTags, tagTake)) reasons.push("Every returned tag described store or venue listings rather than culture.");
    else if (audit.culturalTags === 0) reasons.push("The returned tags could not be traced to their Qloo call or classified, so none could be used.");
    else reasons.push("The cultural tags Qloo returned are free descriptive keywords or describe the brand's own category; neither supports a territory hypothesis on its own.");
    if (audit.retainedAssociations > 0) reasons.push("Related artists, places, films or books are shown as observations; this scan has no Qloo evidence that groups them into a shared theme.");
  }
  if (templateVersion !== BRAND_BASELINE_TEMPLATE_VERSION && audit.operationalTags >= BASELINE_LEGACY_TAG_TAKE / 2) nextSteps.push("Re-run with the 20-tag profile: in recorded profiles, curated Qloo concepts often rank below the venue attributes that filled this scan's first 10 tags.");
  if (audit.retainedAssociations > 0 && audit.typeEvidence.PROVIDER_CONFIRMED_TYPE < audit.retainedAssociations) nextSteps.push("Profile the related artists, places, films or books with Qloo tags to see whether they share a genre (one additional call per list).");
  if (territories.length) nextSteps.push("Test the strongest territory hypothesis with a deep research comparison before treating it as a finding.");
  else if (tags.some((tag) => tag.role === "DESCRIPTIVE_KEYWORD")) nextSteps.push("Search Qloo for classification tags matching the descriptive keywords before forming a hypothesis.");
  if (!signals.length) nextSteps.push("Run a new baseline scan: no traceable cultural evidence could be kept from this one.");
  if (!territories.length) limitations.add("No territory hypothesis is supported by this scan's evidence.");

  const incompleteStages = input.incompleteStages ?? [];
  const hasPartial = coverage.some((item) => item.status === "PARTIAL" || item.status === "DEGRADED" || item.status === "UNAVAILABLE");
  const scanStatus = !signals.length ? "INSUFFICIENT_EVIDENCE" : hasPartial || incompleteStages.length || !territories.length ? "PARTIAL" : "COMPLETE";
  return {
    schemaVersion: BRAND_BASELINE_SCHEMA_VERSION,
    scanId: input.scanId,
    scanStatus,
    brand: { id: input.brandId, qlooId: input.brand.qlooId, name: brandName, resolutionStatus: "RESOLVED", source: identitySource },
    fingerprint: { signals, excluded, themes, domainCoverage: coverage, provenance: [identitySource, ...provenance], limitations: [...limitations] },
    territories,
    discovery: { rule: BASELINE_DISCOVERY_RULE, themeRule: BASELINE_THEME_RULE, outcome: territories.length ? "HYPOTHESES_FOUND" : "NO_HYPOTHESIS", reasons, nextSteps },
    audit,
    execution: {
      templateVersion,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      providerCallCount: input.providerCallCount,
      completedStages: ["identity", ...input.observations.map((item) => item.domain), "normalize", "discover", "validate"],
      incompleteStages,
      recordedOrLive: input.recordedOrLive,
      budgetStatus: input.budgetStatus ?? "WITHIN_LIMIT",
      ...(input.derivedFrom ? { derivedFrom: input.derivedFrom } : {}),
    },
  };
}

/** Rebuilds an in-memory observation from a stored artifact, for offline replay. No provider call. */
export function observationFromArtifact(artifact: StoredBaselineObservation, artifactSchemaVersion: string): BaselineObservation {
  const provenance: ProvenanceRef = {
    operation: artifact.operation,
    correlationId: artifact.correlationId,
    status: artifact.sourceStatus,
    warnings: [],
    degraded: artifact.sourceStatus === "degraded",
    partial: artifact.sourceStatus === "partial",
  };
  const signals: CulturalSignal[] = artifact.signals.map((signal) => ({
    kind: signal.kind,
    qlooId: signal.id,
    label: signal.name,
    ...(signal.type !== undefined ? { type: signal.type } : {}),
    ...(signal.subtype !== undefined ? { subtype: signal.subtype } : {}),
    // A pre-0.2 artifact has no per-signal correlation; it then fails the provenance check instead of being trusted.
    sourceCorrelationId: signal.sourceCorrelationId ?? "unrecorded",
  }));
  const outcome = artifact.kind === "ok"
    ? artifact.operation === "entity_tags"
      ? { kind: "ok" as const, data: { subjects: [], tags: signals }, provenance }
      : { kind: "ok" as const, data: { signals: [], entities: signals }, provenance }
    : artifact.kind === "empty"
      ? { kind: "empty" as const, summary: undefined, provenance }
      : { kind: "needs_input" as const, summary: undefined, issues: [], provenance };
  return {
    domain: artifact.domain as BaselineObservation["domain"],
    outcome,
    capturedAt: artifact.capturedAt,
    ...(artifact.recordedRequestType ? { recordedRequestType: artifact.recordedRequestType } : {}),
    ...(artifact.operation === "recommend" && !artifact.recordedRequestType && artifactSchemaVersion === "ce-brand-baseline-observation/0.2" ? { scopeFromTemplateStage: true } : {}),
  };
}
