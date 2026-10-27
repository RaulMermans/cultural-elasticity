/**
 * Sprint 9I comparative research: browser-side shape checks and wording. The server builds every reference,
 * eligibility verdict, report and relationship; this module only guards the boundary and labels what it shows.
 */
import type { ComparativeOutcome, ComparativeReferenceCandidate, ComparativeStrategicReport, ComparisonEligibility, CulturalConnectionMap, CulturalRelationshipKind } from "@cultural-elasticity/shared";

export type ComparisonLimits = { maxQlooCalls: number; maxAgentTurns: number; maxRunMinutes: number; maxPanelOptions: number; model: string; reservedUsd: number; unknownOutcomes: string };

export type ComparativeOptions = {
  version: "ce-comparative-options/0.1";
  brand: { name: string; qlooId: string };
  target: { label: string; conceptId: string | null; entityType: string | null; exemplars: { label: string; type: string }[]; correlationIds: string[]; singleHypothesisOutcome: string | null; canAnchor: boolean; problem: string | null };
  references: ComparativeReferenceCandidate[];
  limits: ComparisonLimits;
  admission: { accepting: boolean };
  connections: CulturalConnectionMap;
};

export type ComparativePreview = { version: "ce-comparative-preview/0.1"; eligibility: ComparisonEligibility; territories: string[] | null; limits: ComparisonLimits; admission: { accepting: boolean } };

export type ComparativeReportEnvelope = {
  version: "ce-comparative-report-envelope/0.1";
  status: string;
  error: { code: string; message: string } | null;
  report: ComparativeStrategicReport | null;
  connections: CulturalConnectionMap | null;
};

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function isConnectionMap(value: unknown): value is CulturalConnectionMap {
  return record(value) && value.schemaVersion === "ce-cultural-connections/0.1" && Array.isArray(value.relationships) && Array.isArray(value.notes) && value.relationships.every((item) => record(item) && item.rankable === false);
}

export function parseOptions(value: unknown): ComparativeOptions | null {
  if (!record(value) || value.version !== "ce-comparative-options/0.1" || !record(value.target) || !Array.isArray(value.references) || !record(value.limits) || !record(value.admission) || !isConnectionMap(value.connections)) return null;
  return value as unknown as ComparativeOptions;
}

export function parsePreview(value: unknown): ComparativePreview | null {
  if (!record(value) || value.version !== "ce-comparative-preview/0.1" || !record(value.eligibility) || typeof value.eligibility.eligible !== "boolean") return null;
  return value as unknown as ComparativePreview;
}

export function parseReportEnvelope(value: unknown): ComparativeReportEnvelope | null {
  if (!record(value) || value.version !== "ce-comparative-report-envelope/0.1" || typeof value.status !== "string") return null;
  if (value.report !== null && !(record(value.report) && value.report.schemaVersion === "ce-comparative-report/0.2")) return null;
  if (value.connections !== null && !isConnectionMap(value.connections)) return null;
  return value as unknown as ComparativeReportEnvelope;
}

export const outcomeCopy: Record<ComparativeOutcome, { headline: string; detail: string }> = {
  RELATIVE_POSITION_ESTABLISHED: { headline: "Relative position established", detail: "The proposed territory holds a position inside one validated Qloo rank panel. It is relative to this candidate set only." },
  NO_RELATIVE_POSITION: { headline: "No relative position", detail: "The comparison finished, but no valid single-call panel included the proposed territory. The evidence below is qualitative." },
  INTEGRITY_FAILED: { headline: "Ranking withheld", detail: "A consistency check failed, so no position or classification from this run is shown." },
  NOT_COMPLETED: { headline: "Comparison not completed", detail: "The comparison did not finish. That is not evidence against the territory." },
};

export const relationshipKindCopy: Record<CulturalRelationshipKind, { label: string; note: string }> = {
  DIRECT_QLOO_OBSERVATION: { label: "Observed by Qloo", note: "One Qloo call returned this for a request that named the source." },
  DERIVED_PROFILE_OVERLAP: { label: "Computed overlap", note: "Calculated from separately observed profiles. Qloo did not return it as a relationship." },
  AGENT_INTERPRETATION: { label: "Agent interpretation", note: "Validated model wording about the evidence. Not a Qloo observation." },
};

export const referenceSourceCopy: Record<ComparativeReferenceCandidate["source"], string> = {
  completed_investigation: "Investigated in this session",
  target_exemplar_profile: "Seen in the target's exemplar profiles",
  baseline_direction: "Baseline research direction",
};

export function typeEvidenceCopy(reference: ComparativeReferenceCandidate): string {
  const evidence = reference.typeEvidence;
  if (!evidence) return "No Qloo evidence yet shows which entity type represents it.";
  return evidence.basis === "VALIDATED_REPRESENTATION"
    ? `Validated ${evidence.entityType} representation (${evidence.memberIds.length} exemplars).`
    : `Carried by ${evidence.memberIds.length} ${evidence.entityType} exemplar${evidence.memberIds.length === 1 ? "" : "s"} of the target.`;
}

export const percent = (value: number | null) => (value === null ? "n/a" : `${Math.round(value * 100)}%`);
