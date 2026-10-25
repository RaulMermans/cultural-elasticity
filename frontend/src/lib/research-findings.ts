import type { AgentAnalysisResult } from "@cultural-elasticity/shared";

/** A presentation contract over one already validated agent result; it never computes a score. */
export type ResearchFinding = {
  schemaVersion: "ce-research-finding/0.1";
  researchQuestion: string;
  brand: { id: string; name: string };
  territory: { key: string; name: string };
  observation: string | null;
  interpretations: { text: string; supportingFields: string[] }[];
  evidenceReferences: string[];
  evidenceScope: { route: string; comparisonSet: string[] | null };
  limitations: string[];
  unresolvedQuestions: string[];
  status: "EVIDENCE_SUPPORTED" | "PARTIAL" | "INSUFFICIENT";
  suggestedNextResearchAction: string;
  origin: "live" | "synthetic";
};

export function buildResearchFinding(result: AgentAnalysisResult, territoryKey: string): ResearchFinding | null {
  const territory = result.territories.find((item) => item.key === territoryKey);
  if (!result.brand || !territory || result.status !== "COMPLETE") return null;
  const refs = [...new Set(territory.provenance.correlationIds)];
  const supported = territory.analysisRoute !== "INSUFFICIENT_EVIDENCE" && refs.length > 0;
  const interpretations = supported && result.layers?.agentInterpretation?.claimValidationPassed
    ? (result.layers.agentInterpretation.findings ?? []).filter((item) => item.territoryKey === territoryKey && item.supportingFields.length > 0).map((item) => ({ text: item.interpretation, supportingFields: item.supportingFields }))
    : [];
  return {
    schemaVersion: "ce-research-finding/0.1",
    researchQuestion: result.userQuery,
    brand: { id: result.brand.id, name: result.brand.label },
    territory: { key: territory.key, name: territory.label },
    observation: supported ? territory.keyEvidence[0] ?? null : null,
    interpretations,
    evidenceReferences: refs,
    evidenceScope: { route: territory.analysisRoute, comparisonSet: territory.comparisonSet?.labels ?? null },
    limitations: territory.limitations.map((item) => item.detail),
    unresolvedQuestions: territory.analysisRoute === "INSUFFICIENT_EVIDENCE" ? [`What eligible Qloo evidence could establish ${territory.label} as a cultural territory for ${result.brand.label}?`] : [],
    status: supported ? territory.analysisRoute === "FULL_RELATIVE_ANALYSIS" ? "EVIDENCE_SUPPORTED" : "PARTIAL" : "INSUFFICIENT",
    suggestedNextResearchAction: result.followUpOptions?.[0] ?? `Validate ${territory.label} with an explicitly authorized follow-up investigation.`,
    origin: result.evidenceOrigin,
  };
}
