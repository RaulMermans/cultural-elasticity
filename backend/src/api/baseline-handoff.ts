import type { AnyBrandBaselineResult, BaselineEvidenceRef } from "@cultural-elasticity/shared";
import { agentRequestSchema, type AgentRequest } from "../agent/contracts.js";

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
