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

export function buildDeepInvestigationRequest(result: AnyBrandBaselineResult, territoryId: string): DeepInvestigationRequest {
  if (!["COMPLETE", "PARTIAL", "INSUFFICIENT_EVIDENCE"].includes(result.scanStatus)) throw new HandoffError("SCAN_NOT_COMPLETE");
  const territory = result.territories.find((item) => item.id === territoryId);
  if (!territory) throw new HandoffError("TERRITORY_NOT_FOUND");
  if (!territory.supportingReferences.length || territory.supportingReferences.some((ref) => !result.fingerprint.provenance.some((source) => source.correlationId === ref.correlationId && source.sourceId === ref.sourceId))) {
    throw new HandoffError("TERRITORY_UNSUPPORTED");
  }
  const objective = `Investigate whether Qloo evidence supports ${territory.name} as a cultural research direction for ${result.brand.name}.`;
  const sourceRefs = territory.supportingReferences.map((ref) => `${ref.operation} ${ref.correlationId}`).join(", ");
  const userQuery = `${objective} Earlier baseline context: unvalidated territory hypothesis from scan ${result.scanId}; Qloo source references ${sourceRefs}.`;
  const agentRequest = agentRequestSchema.parse({ userQuery, intent: "analyze_move", brand: result.brand.name, territories: [territory.name], researchMode: "single_hypothesis_v1" });
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
    agentRequest: agentRequestSchema.parse({ userQuery: objective, intent: "analyze_move", brand: result.brand.name, territories: [name], researchMode: "single_hypothesis_v1" }),
  };
}
