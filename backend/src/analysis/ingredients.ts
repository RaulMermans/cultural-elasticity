/**
 * The Cultural Evidence Core pipeline:
 *
 *   unknown input → schema validation → normalization → deterministic calculators
 *     → evidence quality → AnalysisIngredients → invariant validation
 *
 * The engine knows nothing about Qloo, transports, MCP, LLMs or rendering. It produces no score.
 */
import { ANALYSIS_INGREDIENTS_SCHEMA_VERSION, type AnalysisIngredients } from "@cultural-elasticity/shared";
import { normalizeEvidencePacket, type NormalizedEvidence } from "../evidence/normalize.js";
import { mergeProvenance } from "../evidence/provenance.js";
import { assessEvidenceQuality } from "../evidence/quality.js";
import { EvidenceValidationError, parseEvidencePacket, type EvidencePacket, type Limitation } from "../evidence/schema.js";
import { analyzeAudienceEvidence } from "./adjacency.js";
import { analyzeBridges } from "./bridges.js";
import { profileCoverageReport, topNSensitivity } from "./coverage.js";
import { buildDistanceProxyIngredients } from "./distance.js";
import { computeOverlap } from "./overlap.js";
import { analyzeRanking } from "./ranking.js";
import { assertAnalysisInvariants } from "./validate.js";

/** Validates, normalizes and analyzes. Throws EvidenceValidationError for invalid input. */
export function analyzeEvidencePacket(input: unknown): AnalysisIngredients {
  const parsed = parseEvidencePacket(input);
  if (!parsed.ok) throw new EvidenceValidationError(parsed.issues);
  return computeAnalysisIngredients(normalizeEvidencePacket(parsed.packet));
}

export function computeAnalysisIngredients({ packet, limitations: normalizationLimitations }: NormalizedEvidence): AnalysisIngredients {
  const { brand, target } = packet;
  const overlap = computeOverlap(brand, target);
  const profileCoverage = profileCoverageReport(brand, target, overlap.sharedSignalCount);
  const stability = topNSensitivity(brand, target);
  const audience = analyzeAudienceEvidence(packet.audience);
  const ranking = analyzeRanking(packet.ranking, brand.subject.id);
  const bridges = analyzeBridges(packet.bridges);
  const distanceProxy = buildDistanceProxyIngredients({ overlap, coverage: profileCoverage, stability, audience, ranking, bridges, brandId: brand.subject.id });
  const evidenceQuality = assessEvidenceQuality(packet);

  const result: AnalysisIngredients = {
    schemaVersion: ANALYSIS_INGREDIENTS_SCHEMA_VERSION,
    evidenceOrigin: packet.origin,
    subjects: { brand: brand.subject, target: target.subject },
    overlap,
    profileCoverage,
    stability,
    audience,
    ranking,
    bridges,
    distanceProxy,
    evidenceQuality,
    limitations: dedupeLimitations([
      ...packet.limitations,
      ...normalizationLimitations,
      ...evidenceQuality.limitations,
      ...overlap.limitations,
      ...stability.limitations,
      ...audience.limitations,
      ...ranking.limitations,
      ...bridges.limitations,
    ]),
    provenance: allProvenance(packet),
  };
  assertAnalysisInvariants(result);
  return result;
}

function dedupeLimitations(limitations: Limitation[]): Limitation[] {
  const seen = new Set<string>();
  return limitations.filter((limitation) => {
    const key = `${limitation.code}\u0000${limitation.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function allProvenance(packet: EvidencePacket) {
  const profile = (p: EvidencePacket["brand"]) => [p.provenance, p.subject.provenance, ...p.signals.map((s) => s.provenance)];
  return mergeProvenance(
    packet.provenance,
    ...profile(packet.brand),
    ...profile(packet.target),
    ...(packet.audience ? [packet.audience.provenance, ...packet.audience.interpretableMetrics.map((m) => m.provenance)] : []),
    ...(packet.ranking ? [packet.ranking.provenance, ...packet.ranking.candidates.map((c) => c.provenance)] : []),
    ...(packet.bridges ?? []).flatMap((bridge) => [bridge.provenance, ...bridge.signals.map((s) => s.provenance)]),
  );
}
