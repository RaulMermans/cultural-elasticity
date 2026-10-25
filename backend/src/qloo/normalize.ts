/**
 * Real response → validated envelope → internal contract.
 * Everything here validates at the boundary and throws QlooContractError on mismatch.
 */
import { z } from "zod";
import type { ConceptRef, CulturalSignal, OpaqueEvidence, ProvenanceRef, ResolvedConcept } from "../contracts/qloo.js";
import { QlooContractError } from "./errors.js";
import { QLOO_RESULT_SCHEMA_VERSION, QLOO_STATUSES, type QlooOperation } from "./types.js";

// [contract] result envelope (additionalProperties: true → looseObject).
const envelopeSchema = z.looseObject({
  schema_version: z.string(),
  operation: z.string(),
  status: z.enum(QLOO_STATUSES),
  summary: z.string().optional(),
  interpretation: z.unknown().optional(),
  results: z.unknown().optional(),
  result_count: z.number().int().min(0).optional(),
  warnings: z.array(z.string()).optional(),
  error: z
    .strictObject({ code: z.string(), layer: z.string(), retryable: z.boolean(), recovery: z.string() })
    .optional(),
  execution: z.strictObject({
    transport: z.enum(["direct", "cli", "mcp"]),
    transport_name: z.string(),
    correlation_id: z.string(),
    duration_ms: z.number().min(0),
  }),
  provenance: z
    .strictObject({
      source: z.string(),
      endpoint: z.string(),
      documentation: z.string(),
      transport: z.string().optional(),
      requests: z
        .array(z.strictObject({ method: z.literal("GET"), path: z.string().min(1), query: z.unknown() }))
        .max(20)
        .optional(),
    })
    .optional(),
});
export type QlooEnvelope = z.infer<typeof envelopeSchema>;

// [harness] compactEntity / compactTag output in qloo-tools.js.
const compactEntitySchema = z.looseObject({
  entity_id: z.string().min(1),
  name: z.string(),
  type: z.string().optional(),
  subtype: z.string().optional(),
  // [live 2026-10-21] recommend returns `popularity: null` for some members (7 contract failures in Sprint 5A
  // traces). Null is treated as absent: popularity is shown, never computed with, and is never invented.
  popularity: z.number().nullable().optional(),
  affinity: z.number().optional(),
});
const compactTagSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  type: z.string().optional(),
  // [harness 0.1.26] compactTag passes `tag.popularity` through unchanged, exactly as compactEntity does for entities,
  // whose null was observed live. A tag null was not observed; it is accepted the same way (unknown, never zero) so a
  // nonessential field can never discard a whole tag result.
  popularity: z.number().nullable().optional(),
  affinity: z.number().optional(),
});

// [harness] interpretedEntity / interpretedTags.
const interpretedEntitySchema = z.looseObject({
  input: z.string(),
  entityId: z.string().min(1),
  name: z.string(),
  type: z.string().optional(),
  match: z.string(),
  score: z.number().optional(),
});

// [harness] resolution issue emitted with status "needs_input".
const resolutionCandidateSchema = z.looseObject({ id: z.string(), name: z.string(), type: z.string().optional() });
const resolutionIssueSchema = z.looseObject({
  input: z.string(),
  kind: z.string(),
  input_kind: z.enum(["entity", "tag"]).optional(),
  field: z.string().optional(),
  candidates: z.array(resolutionCandidateSchema).optional(),
});
export type ResolutionIssue = {
  input: string;
  kind: "ambiguous" | "not_found" | string;
  inputKind: "entity" | "tag" | undefined;
  field: string | undefined;
  candidates: ConceptRef[];
};

export function parseEnvelope(operation: QlooOperation, raw: unknown): QlooEnvelope {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) throw new QlooContractError(operation, z.prettifyError(parsed.error));
  const envelope = parsed.data;
  if (envelope.schema_version !== QLOO_RESULT_SCHEMA_VERSION) {
    throw new QlooContractError(operation, `unsupported schema_version ${envelope.schema_version}`);
  }
  if (envelope.operation !== operation) {
    throw new QlooContractError(operation, `envelope operation is ${envelope.operation}`);
  }
  if (envelope.status === "error" && !envelope.error) {
    throw new QlooContractError(operation, "status is error but no error object was provided");
  }
  return envelope;
}

export function toProvenance(operation: QlooOperation, envelope: QlooEnvelope): ProvenanceRef {
  return {
    operation,
    correlationId: envelope.execution.correlation_id,
    status: envelope.status,
    ...(envelope.provenance
      ? {
          endpoint: envelope.provenance.endpoint,
          documentation: envelope.provenance.documentation,
          ...(envelope.provenance.requests ? { requests: envelope.provenance.requests } : {}),
        }
      : {}),
    warnings: envelope.warnings ?? [],
    degraded: envelope.status === "degraded",
    partial: envelope.status === "partial",
  };
}

function resultsArray(operation: QlooOperation, envelope: QlooEnvelope): unknown[] {
  if (envelope.results === undefined) return [];
  if (!Array.isArray(envelope.results)) throw new QlooContractError(operation, "results is not an array");
  return envelope.results;
}

export function toEntitySignals(operation: QlooOperation, envelope: QlooEnvelope): CulturalSignal[] {
  return resultsArray(operation, envelope).map((item, index) => {
    const parsed = compactEntitySchema.safeParse(item);
    if (!parsed.success) throw new QlooContractError(operation, `results[${index}] is not an entity: ${z.prettifyError(parsed.error)}`);
    const entity = parsed.data;
    return {
      kind: "entity",
      qlooId: entity.entity_id,
      label: entity.name,
      ...(entity.type !== undefined ? { type: entity.type } : {}),
      ...(entity.subtype !== undefined ? { subtype: entity.subtype } : {}),
      ...(entity.affinity !== undefined ? { affinity: entity.affinity } : {}),
      ...(entity.popularity !== undefined && entity.popularity !== null ? { popularity: entity.popularity } : {}),
      sourceCorrelationId: envelope.execution.correlation_id,
    };
  });
}

export function toTagSignals(operation: QlooOperation, envelope: QlooEnvelope): CulturalSignal[] {
  return resultsArray(operation, envelope).map((item, index) => {
    const parsed = compactTagSchema.safeParse(item);
    if (!parsed.success) throw new QlooContractError(operation, `results[${index}] is not a tag: ${z.prettifyError(parsed.error)}`);
    const tag = parsed.data;
    return {
      kind: "tag",
      qlooId: tag.id,
      label: tag.name,
      ...(tag.type !== undefined ? { type: tag.type } : {}),
      ...(tag.affinity !== undefined ? { affinity: tag.affinity } : {}),
      ...(tag.popularity !== undefined && tag.popularity !== null ? { popularity: tag.popularity } : {}),
      sourceCorrelationId: envelope.execution.correlation_id,
    };
  });
}

export function toConceptRefs(signals: CulturalSignal[]): ConceptRef[] {
  return signals.map(({ qlooId, label, type }) => ({ qlooId, label, ...(type !== undefined ? { type } : {}) }));
}

/** Reads `interpretation[field]` (one interpreted entity or an array of them) into ResolvedConcepts. */
export function toResolvedEntities(
  operation: QlooOperation,
  envelope: QlooEnvelope,
  field: string,
  provenance: ProvenanceRef,
): ResolvedConcept[] {
  const interpretation = envelope.interpretation;
  if (typeof interpretation !== "object" || interpretation === null) {
    throw new QlooContractError(operation, "missing interpretation");
  }
  const value = (interpretation as Record<string, unknown>)[field];
  if (value === undefined) return [];
  const items = Array.isArray(value) ? value : [value];
  return items.map((item, index) => {
    const parsed = interpretedEntitySchema.safeParse(item);
    if (!parsed.success) {
      throw new QlooContractError(operation, `interpretation.${field}[${index}]: ${z.prettifyError(parsed.error)}`);
    }
    const entity = parsed.data;
    return {
      kind: "entity",
      input: entity.input,
      label: entity.name,
      qlooId: entity.entityId,
      ...(entity.type !== undefined ? { type: entity.type } : {}),
      match: entity.match,
      confirmation: "unambiguous",
      alternatives: [],
      provenance: [provenance],
    };
  });
}

export function toResolutionIssues(operation: QlooOperation, envelope: QlooEnvelope): ResolutionIssue[] {
  const resolution = (envelope as Record<string, unknown>).resolution;
  const issues = typeof resolution === "object" && resolution !== null ? (resolution as Record<string, unknown>).issues : undefined;
  if (issues === undefined) return [];
  const parsed = z.array(resolutionIssueSchema).safeParse(issues);
  if (!parsed.success) throw new QlooContractError(operation, `resolution.issues: ${z.prettifyError(parsed.error)}`);
  return parsed.data.map((issue) => ({
    input: issue.input,
    kind: issue.kind,
    inputKind: issue.input_kind,
    field: issue.field,
    candidates: (issue.candidates ?? []).map((candidate) => ({
      qlooId: candidate.id,
      label: candidate.name,
      ...(candidate.type !== undefined ? { type: candidate.type } : {}),
    })),
  }));
}

// ---- Opaque evidence: bounded, sanitized, never interpreted. ----

const MAX_ARRAY = 20;
const MAX_STRING = 300;
const MAX_DEPTH = 6;
/** Keys that are unnecessary for evidence and may carry bulky or location-identifying detail. */
const DROPPED_KEYS = new Set(["image", "images", "address", "geocode", "description", "short_description", "website", "phone"]);

export function sanitizeForEvidence(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (depth >= MAX_DEPTH) return "[omitted: depth]";
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map((item) => sanitizeForEvidence(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !DROPPED_KEYS.has(key))
        .map(([key, item]) => [key, sanitizeForEvidence(item, depth + 1)]),
    );
  }
  return undefined;
}

export function numericFieldPaths(value: unknown, prefix = "", out = new Set<string>()): string[] {
  if (typeof value === "number") out.add(prefix || "(root)");
  else if (Array.isArray(value)) value.forEach((item) => numericFieldPaths(item, `${prefix}[]`, out));
  else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) numericFieldPaths(item, prefix ? `${prefix}.${key}` : key, out);
  }
  return [...out].sort();
}

export function toOpaqueEvidence(operation: QlooOperation, data: unknown, provenance: ProvenanceRef): OpaqueEvidence {
  const sanitized = sanitizeForEvidence(data);
  return {
    operation,
    shape: "unverified",
    topLevelKeys: typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized) ? Object.keys(sanitized).sort() : [],
    numericFieldPaths: numericFieldPaths(sanitized),
    data: sanitized,
    provenance,
  };
}
