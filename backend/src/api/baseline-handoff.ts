import type { AnyBrandBaselineResult, BaselineEvidenceRef, DiscoverySeed } from "@cultural-elasticity/shared";
import { agentRequestSchema, type AgentRequest } from "../agent/contracts.js";
import type { TerritoryGrounding } from "../agent/state.js";

/** Server-only adapter. The caller supplies identifiers; evidence is read from the authorized scan. */
export type DeepInvestigationRequest = {
  version: "ce-deep-investigation/0.1" | "ce-deep-investigation/0.2";
  baselineScanId: string;
  brand: { name: string; qlooId: string };
  territory: { id: string; name: string; canonicalConcept: string };
  objective: string;
  evidence: BaselineEvidenceRef[];
  limitations: string[];
  authorization: "BASELINE_TOKEN_AND_AGENT_ADMISSION";
  agentRequest: AgentRequest;
};

export class HandoffError extends Error {
  constructor(readonly code: "SCAN_NOT_COMPLETE" | "TERRITORY_NOT_FOUND" | "TERRITORY_UNSUPPORTED") { super(code); }
}

/**
 * The question the query interpreter reads. The displayed objective names Qloo evidence, and live Haiku reports that
 * wording (and any run or correlation id) as a system directive, which refuses the run. The scan id and source
 * references travel as structured fields (baselineScanId, evidence), never in the query text.
 */
const agentQuery = (brand: string, direction: string) => `How far can ${brand} extend into ${direction}?`;

export function buildDeepInvestigationRequest(result: AnyBrandBaselineResult, territoryId: string): DeepInvestigationRequest {
  if (!["COMPLETE", "PARTIAL", "INSUFFICIENT_EVIDENCE"].includes(result.scanStatus)) throw new HandoffError("SCAN_NOT_COMPLETE");
  const territory = result.territories.find((item) => item.id === territoryId);
  if (!territory) throw new HandoffError("TERRITORY_NOT_FOUND");
  if (!territory.supportingReferences.length || territory.supportingReferences.some((ref) => !result.fingerprint.provenance.some((source) => source.correlationId === ref.correlationId && source.sourceId === ref.sourceId))) {
    throw new HandoffError("TERRITORY_UNSUPPORTED");
  }
  const objective = `Investigate whether Qloo evidence supports ${territory.name} as a cultural research direction for ${result.brand.name}.`;
  const agentRequest = agentRequestSchema.parse({ userQuery: agentQuery(result.brand.name, territory.name), intent: "analyze_move", brand: result.brand.name, territories: [territory.name] });
  return {
    version: "ce-deep-investigation/0.1",
    baselineScanId: result.scanId,
    brand: { name: result.brand.name, qlooId: result.brand.qlooId },
    territory: { id: territory.id, name: territory.name, canonicalConcept: territory.canonicalConcept },
    objective,
    evidence: territory.supportingReferences,
    limitations: [...result.fingerprint.limitations, ...territory.limitations],
    authorization: "BASELINE_TOKEN_AND_AGENT_ADMISSION",
    agentRequest,
  };
}

/** User context is a new hypothesis, never a Qloo observation or an inherited baseline direction. */
export function buildProposedInvestigationRequest(result: AnyBrandBaselineResult, direction: string): DeepInvestigationRequest {
  if (!["COMPLETE", "PARTIAL", "INSUFFICIENT_EVIDENCE"].includes(result.scanStatus)) throw new HandoffError("SCAN_NOT_COMPLETE");
  const name = direction.trim();
  if (!name || name.length > 120 || !result.brand.qlooId) throw new HandoffError("TERRITORY_UNSUPPORTED");
  const objective = `Investigate whether Qloo evidence supports ${name} as a cultural research direction for ${result.brand.name}.`;
  return {
    version: "ce-deep-investigation/0.2",
    baselineScanId: result.scanId,
    brand: { name: result.brand.name, qlooId: result.brand.qlooId },
    territory: { id: `user:${name.toLocaleLowerCase()}`, name, canonicalConcept: "UNVERIFIED" },
    objective,
    evidence: [],
    limitations: ["This direction was proposed by the user. The baseline contains no Qloo evidence for it; the agent must resolve and investigate it afresh."],
    authorization: "BASELINE_TOKEN_AND_AGENT_ADMISSION",
    agentRequest: agentRequestSchema.parse({ userQuery: agentQuery(result.brand.name, name), intent: "analyze_move", brand: result.brand.name, territories: [name] }),
  };
}

/**
 * Sprint 9O: the Qloo tag the authorized scan observed for a direction, for the agent to probe first. Only a tag read
 * from the brand's own tag profile (an ok entity_tags call) qualifies; anything else hands over the name alone.
 */
export function directionGrounding(result: AnyBrandBaselineResult, territoryId: string): TerritoryGrounding | null {
  const territory = result.territories.find((item) => item.id === territoryId);
  const ref = territory?.supportingReferences.find((item) => item.operation === "entity_tags" && item.sourceStatus === "ok");
  if (!territory || !ref || !territory.canonicalConcept.startsWith("urn:tag:")) return null;
  return { territory: territory.name, tagId: territory.canonicalConcept, label: territory.name, type: territory.canonicalConcept.split(":").slice(0, 4).join(":"), subjectId: result.brand.qlooId, correlationId: ref.correlationId };
}

/** Sprint 10A: seeds per baseline domain (artists, places, films, books), at most 12 in all. */
export const SEEDS_PER_DOMAIN = 3;

/**
 * Sprint 10A: the entities the authorized scan observed in brand-conditioned lists (related artists, places, films,
 * books), as starting points for an explore run. Only signals whose call is in the scan's provenance qualify; set-aside
 * (excluded or type-conflicting) results are not signals and never seeds. Brand-profile tags are not seeds: they are the
 * scan's own directions. Seeds motivate hypotheses; they are never support.
 */
export function discoverySeeds(result: AnyBrandBaselineResult): DiscoverySeed[] {
  const known = new Set(result.fingerprint.provenance.map((ref) => `${ref.correlationId}\0${ref.sourceId}`));
  const perDomain = new Map<string, number>();
  const seeds: DiscoverySeed[] = [];
  for (const signal of result.fingerprint.signals) {
    if (signal.kind !== "entity" || signal.source.operation !== "recommend" || !known.has(`${signal.source.correlationId}\0${signal.source.sourceId}`)) continue;
    const typeEvidence = "grounding" in signal && signal.grounding ? signal.grounding.typeEvidence : "UNRECORDED";
    if (typeEvidence === "CONFLICTING_TYPE") continue;
    const n = perDomain.get(signal.domain) ?? 0;
    if (n >= SEEDS_PER_DOMAIN) continue;
    perDomain.set(signal.domain, n + 1);
    seeds.push({ id: signal.id, label: signal.name, domain: signal.domain, relation: "BRAND_CONDITIONED_ENTITY", scanId: result.scanId, correlationId: signal.source.correlationId, rankWithinCall: signal.rankWithinCall, typeEvidence, partial: signal.source.sourceStatus !== "ok" });
  }
  return seeds;
}

export type ExploreInvestigationRequest = {
  version: "ce-explore-investigation/0.1";
  baselineScanId: string;
  brand: { name: string; qlooId: string };
  objective: string;
  seeds: DiscoverySeed[];
  limitations: string[];
  authorization: "BASELINE_TOKEN_AND_AGENT_ADMISSION";
  agentRequest: AgentRequest;
};

/**
 * Sprint 10A: open discovery from a completed scan. The agent starts from the scan's cross-domain observations (seeds)
 * and must still find, anchor and support every territory with Qloo in its own run. No seed name or id enters the query
 * text the interpreter reads (seeds travel as server-held structured state).
 */
export function buildExploreInvestigationRequest(result: AnyBrandBaselineResult): ExploreInvestigationRequest {
  if (!["COMPLETE", "PARTIAL", "INSUFFICIENT_EVIDENCE"].includes(result.scanStatus)) throw new HandoffError("SCAN_NOT_COMPLETE");
  if (!result.brand.qlooId) throw new HandoffError("TERRITORY_UNSUPPORTED");
  const seeds = discoverySeeds(result);
  const limitations = [
    "Open discovery: every territory must be found, anchored and supported with Qloo in the new run. Nothing from the scan counts as support.",
    ...(seeds.length ? ["The starting points are entities Qloo returned in brand-related lists. They suggest where to look; they do not show that the brand has affinity with any territory."] : ["The scan has no related artists, places, films or books to start from, so discovery uses the brand's related brands only."]),
    ...(seeds.some((seed) => seed.partial) ? ["Some starting points come from a partial or degraded Qloo response."] : []),
  ];
  return {
    version: "ce-explore-investigation/0.1",
    baselineScanId: result.scanId,
    brand: { name: result.brand.name, qlooId: result.brand.qlooId },
    objective: `Find distinct cultural territories Qloo supports for ${result.brand.name}, starting from the signals its scan observed.`,
    seeds,
    limitations,
    authorization: "BASELINE_TOKEN_AND_AGENT_ADMISSION",
    agentRequest: agentRequestSchema.parse({ userQuery: `What cultural territories could ${result.brand.name} stretch into?`, intent: "explore_frontier", brand: result.brand.name, territories: [] }),
  };
}
