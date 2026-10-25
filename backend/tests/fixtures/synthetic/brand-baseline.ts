/** SYNTHETIC baseline evidence. Placeholder IDs and correlations; never live Qloo output. */
import type { ProvenanceRef, ResolvedConcept, CulturalSignal } from "../../../src/contracts/qloo.js";
import type { BaselineObservation } from "../../../src/brand-baseline/research.js";

export const syntheticProvenance = (operation: ProvenanceRef["operation"], correlationId: string, status: ProvenanceRef["status"] = "ok"): ProvenanceRef => ({
  operation,
  correlationId,
  status,
  warnings: [],
  degraded: status === "degraded",
  partial: status === "partial",
});

export const syntheticBrand = (label: string, qlooId: string): ResolvedConcept => ({
  kind: "entity",
  input: label,
  label,
  qlooId,
  type: "urn:entity:brand",
  match: "exact",
  confirmation: "unambiguous",
  alternatives: [],
  provenance: [syntheticProvenance("describe", "syn-describe")],
});

export const syntheticTag = (id: string, label: string, correlationId = "syn-tags"): CulturalSignal => ({
  kind: "tag",
  qlooId: id,
  label,
  type: "urn:tag:interests:qloo",
  sourceCorrelationId: correlationId,
});

export const syntheticTagObservation = (tags: CulturalSignal[], status: "ok" | "partial" | "degraded" = "ok"): BaselineObservation => ({
  domain: "tags",
  capturedAt: "2026-10-25T00:00:00.000Z",
  outcome: { kind: "ok", data: { subjects: [syntheticBrand("Northwind Atelier", "syn-brand-1")], tags }, provenance: syntheticProvenance("entity_tags", "syn-tags", status) },
});
