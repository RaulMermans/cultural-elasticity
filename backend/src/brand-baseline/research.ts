import { createHash } from "node:crypto";
import {
  BRAND_BASELINE_SCHEMA_VERSION,
  BRAND_BASELINE_TEMPLATE_VERSION,
  type BaselineEvidenceRef,
  type BaselineSignal,
  type BrandBaselineResult,
} from "@cultural-elasticity/shared";
import type { CulturalSignal, ResolvedConcept } from "../contracts/qloo.js";
import { matchOperationalRule, tagNamespace } from "../methodology/operational-tags.js";
import type { QlooClient, QlooOutcome, EntityTagsData, RecommendData } from "../qloo/client.js";
import type { QlooInsightsType } from "../qloo/types.js";

export const BASELINE_DOMAINS: readonly QlooInsightsType[] = ["artist", "place", "movie", "book"];
export const BASELINE_MAX_CALLS = 7;
export const BASELINE_MAX_ENTITIES = 10;
export const BASELINE_MAX_TERRITORIES = 5;
export const BASELINE_DISCOVERY_RULE = "observed-cultural-tag/v1";

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
};

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

/** Pure projection of frozen Qloo outcomes. No cross-call numerical comparisons. */
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
}): BrandBaselineResult {
  const identity = input.brand.provenance.find((item) => item.operation === "describe" && item.correlationId);
  if (!identity || (identity.status !== "ok" && identity.status !== "partial" && identity.status !== "degraded")) throw new Error("BRAND_PROVENANCE_MISSING");
  const identitySource: BaselineEvidenceRef = { operation: "describe", correlationId: identity.correlationId, sourceId: input.brand.qlooId, capturedAt: input.brandCapturedAt, sourceStatus: identity.status, scope: "identity" };
  const signals: BaselineSignal[] = [];
  const coverage: BrandBaselineResult["fingerprint"]["domainCoverage"] = [];
  const limitations = new Set<string>();
  const provenance: BaselineEvidenceRef[] = [];
  for (const observation of input.observations) {
    const outcome = observation.outcome;
    if (outcome.kind !== "ok") {
      coverage.push({ domain: observation.domain, status: outcome.kind === "empty" ? "EMPTY" : "UNAVAILABLE", entityCount: 0 });
      if (outcome.kind === "needs_input") limitations.add(`${observation.domain}: Qloo requested clarification.`);
      continue;
    }
    const status = outcome.provenance.degraded ? "DEGRADED" : outcome.provenance.partial ? "PARTIAL" : "OBSERVED";
    const raw = observation.domain === "tags" ? (outcome.data as EntityTagsData).tags : (outcome.data as RecommendData).entities;
    coverage.push({ domain: observation.domain, status, entityCount: raw.length });
    if (status !== "OBSERVED") limitations.add(`${observation.domain}: Qloo marked the response ${status.toLowerCase()}.`);
    const seen = new Set<string>();
    raw.slice(0, BASELINE_MAX_ENTITIES).forEach((signal, index) => {
      if (seen.has(signal.qlooId)) return;
      seen.add(signal.qlooId);
      if (observation.domain !== "tags" && (signal.kind !== "entity" || (signal.type !== observation.domain && signal.type !== `urn:entity:${observation.domain}`))) {
        limitations.add(`${observation.domain}: an entity with an unverified target type was excluded.`);
        return;
      }
      if (observation.domain === "tags" && signal.kind !== "tag") {
        limitations.add("tags: a non-tag result was excluded.");
        return;
      }
      if (observation.domain === "tags" && matchOperationalRule({ id: signal.qlooId, category: undefined })) {
        limitations.add("tags: venue or operational metadata was excluded from the cultural fingerprint.");
        return;
      }
      const source = evidenceRef(signal, observation);
      if (!source) {
        limitations.add(`${observation.domain}: a signal lacked matching call provenance and was excluded.`);
        return;
      }
      const normalized: BaselineSignal = {
        id: signal.qlooId,
        name: signal.label,
        kind: signal.kind,
        domain: observation.domain,
        source,
        rankWithinCall: index + 1,
      };
      signals.push(normalized);
      provenance.push(source);
    });
  }
  const tags = signals.filter((signal) => signal.domain === "tags" && signal.kind === "tag" && signal.name.trim().length > 1 && tagNamespace({ id: signal.id, category: undefined })?.source === "qloo" && !matchOperationalRule({ id: signal.id, category: undefined }));
  const territories = tags.slice(0, BASELINE_MAX_TERRITORIES).map((signal) => ({
    id: createHash("sha256").update(`${input.brand.qlooId}\0${signal.id}`).digest("hex").slice(0, 24),
    name: signal.name,
    canonicalConcept: signal.id,
    evidenceStatus: signal.source.sourceStatus === "ok" ? "OBSERVED_ASSOCIATION" as const : "PARTIAL_EVIDENCE" as const,
    discoveryBasis: BASELINE_DISCOVERY_RULE,
    supportingReferences: [signal.source],
    limitations: ["This is an observed brand association, not a validated relative analysis or commercial opportunity."],
    availableActions: ["inspect_evidence"] as ["inspect_evidence"],
  }));
  if (!territories.length) limitations.add("No grounded territory concept was observed in this bounded scan.");
  const incompleteStages = input.incompleteStages ?? [];
  const hasPartial = coverage.some((item) => item.status === "PARTIAL" || item.status === "DEGRADED" || item.status === "UNAVAILABLE");
  const scanStatus = !signals.length ? "INSUFFICIENT_EVIDENCE" : hasPartial || incompleteStages.length || !territories.length ? "PARTIAL" : "COMPLETE";
  return {
    schemaVersion: BRAND_BASELINE_SCHEMA_VERSION,
    scanId: input.scanId,
    scanStatus,
    brand: { id: input.brandId, qlooId: input.brand.qlooId, name: input.brand.label, resolutionStatus: "RESOLVED", source: identitySource },
    fingerprint: { signals, domainCoverage: coverage, provenance: [identitySource, ...provenance], limitations: [...limitations] },
    territories,
    execution: {
      templateVersion: BRAND_BASELINE_TEMPLATE_VERSION,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      providerCallCount: input.providerCallCount,
      completedStages: ["identity", ...input.observations.map((item) => item.domain), "normalize", "discover", "validate"],
      incompleteStages,
      recordedOrLive: input.recordedOrLive,
      budgetStatus: input.budgetStatus ?? "WITHIN_LIMIT",
    },
  };
}
