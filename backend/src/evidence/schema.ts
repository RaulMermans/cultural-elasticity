/**
 * Canonical, provider-independent evidence contracts.
 *
 * The Cultural Evidence Core consumes only these shapes. Provider adapters (e.g. the Qloo adapter
 * in ../qloo and ../contracts/qloo.ts) map raw responses into an EvidencePacket; nothing upstream of
 * that mapping leaks in here.
 *
 * Rules encoded in the schemas:
 *   - every number is finite (zod 4 `z.number()` rejects NaN and ±Infinity);
 *   - ranks are positive integers and unique among distinct signals/candidates;
 *   - ids and labels are non-empty after trimming;
 *   - provenance refs are compact and well-formed;
 *   - numeric ranges are enforced ONLY where the range is declared (InterpretableMetric.scale).
 *     Provider values of unknown scale are preserved as-is, never assumed to be 0–1.
 */
import type {
  ComparisonScope,
  ConditionedEntityEvidence as SharedConditionedEntityEvidence,
  CulturalSignal as SharedCulturalSignal,
  InterpretableMetric as SharedInterpretableMetric,
  Limitation as SharedLimitation,
  NumericEvidence as SharedNumericEvidence,
  ProvenanceRef as SharedProvenanceRef,
  ResolvedEntity as SharedResolvedEntity,
} from "@cultural-elasticity/shared";
import { z } from "zod";

/** 0.2 adds the optional `conditionedEntities` slot. 0.1 packets remain valid and cannot carry it. */
export const EVIDENCE_PACKET_SCHEMA_VERSION = "ce-evidence/0.2";
export const SUPPORTED_EVIDENCE_PACKET_VERSIONS = ["ce-evidence/0.1", EVIDENCE_PACKET_SCHEMA_VERSION] as const;

const identifier = z.string().trim().min(1, "must be a non-empty identifier");
const text = z.string().trim().min(1, "must be non-empty");

export const provenanceRefSchema = z.strictObject({
  source: text,
  operation: text,
  correlationId: identifier.optional(),
  capturedAt: z.iso.datetime({ offset: true }).optional(),
});
export type ProvenanceRef = z.output<typeof provenanceRefSchema>;

const provenanceList = z.array(provenanceRefSchema);

export const COMPARISON_SCOPES = ["within_call", "within_profile", "cross_call_verified", "unknown"] as const satisfies readonly ComparisonScope[];

export const numericEvidenceSchema = z.strictObject({
  value: z.number(),
  scale: text.optional(),
  comparisonScope: z.enum(COMPARISON_SCOPES),
});
export type NumericEvidence = z.output<typeof numericEvidenceSchema>;

const rank = z.number().int().min(1, "ranks are 1-based positive integers");

export const culturalSignalSchema = z.strictObject({
  id: identifier,
  label: text,
  category: text.optional(),
  rank: rank.optional(),
  numeric: numericEvidenceSchema.optional(),
  provenance: provenanceList,
});
export type CulturalSignal = z.output<typeof culturalSignalSchema>;

export const resolvedEntitySchema = z.strictObject({
  id: identifier,
  label: text,
  type: text,
  resolution: z.enum(["confirmed", "unconfirmed", "unknown"]),
  provenance: provenanceList,
});
export type ResolvedEntity = z.output<typeof resolvedEntitySchema>;

/** Ranks must identify one position: two different signal ids may not share a rank. */
function refineUniqueRanks(items: { id: string; rank?: number | undefined }[], ctx: z.RefinementCtx, path: (string | number)[]): void {
  const idByRank = new Map<number, string>();
  items.forEach((item, index) => {
    if (item.rank === undefined) return;
    const existing = idByRank.get(item.rank);
    if (existing !== undefined && existing !== item.id) {
      ctx.addIssue({ code: "custom", path: [...path, index, "rank"], message: `rank ${item.rank} is used by both "${existing}" and "${item.id}"` });
    } else {
      idByRank.set(item.rank, item.id);
    }
  });
}

export const culturalProfileSchema = z
  .strictObject({
    subject: resolvedEntitySchema,
    /** May contain the same signal id more than once; normalization merges duplicates deterministically. */
    signals: z.array(culturalSignalSchema),
    /** Undefined means truncation is unknown, which is not the same as "complete". */
    truncated: z.boolean().optional(),
    provenance: provenanceList,
  })
  .superRefine((profile, ctx) => refineUniqueRanks(profile.signals, ctx, ["signals"]));
export type CulturalProfile = z.output<typeof culturalProfileSchema>;

export const interpretableMetricSchema = z
  .strictObject({
    id: identifier,
    label: text,
    value: z.number(),
    direction: z.enum(["higher_is_closer", "higher_is_farther", "neutral"]),
    /** Only declare a scale whose bounds are actually known. */
    scale: z.strictObject({ min: z.number().optional(), max: z.number().optional() }).optional(),
    comparisonScope: z.enum(COMPARISON_SCOPES),
    provenance: provenanceList,
  })
  .superRefine((metric, ctx) => {
    const { min, max } = metric.scale ?? {};
    if (min !== undefined && max !== undefined && min > max) {
      ctx.addIssue({ code: "custom", path: ["scale"], message: "scale.min must not exceed scale.max" });
    }
    if (min !== undefined && metric.value < min) ctx.addIssue({ code: "custom", path: ["value"], message: `value is below the declared scale.min (${min})` });
    if (max !== undefined && metric.value > max) ctx.addIssue({ code: "custom", path: ["value"], message: `value is above the declared scale.max (${max})` });
  });
export type InterpretableMetric = z.output<typeof interpretableMetricSchema>;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
/** JSON-safe passthrough. Numbers are finite; nothing else is assumed about the content. */
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
);

export const audienceEvidenceSchema = z
  .strictObject({
    /** Upstream fields of unverified meaning. Kept as evidence, never used in calculations. */
    fields: z.record(z.string(), jsonValueSchema),
    /** Metrics whose semantics (direction and scope) the adapter has verified. */
    interpretableMetrics: z.array(interpretableMetricSchema),
    provenance: provenanceList,
  })
  .superRefine((audience, ctx) => {
    const seen = new Set<string>();
    audience.interpretableMetrics.forEach((metric, index) => {
      if (seen.has(metric.id)) ctx.addIssue({ code: "custom", path: ["interpretableMetrics", index, "id"], message: `duplicate metric id "${metric.id}"` });
      seen.add(metric.id);
    });
  });
export type AudienceEvidence = z.output<typeof audienceEvidenceSchema>;

export const rankedCandidateSchema = z.strictObject({
  id: identifier,
  label: text,
  rank: rank.optional(),
  numeric: numericEvidenceSchema.optional(),
  provenance: provenanceList,
});
export type RankedCandidate = z.output<typeof rankedCandidateSchema>;

export const rankingEvidenceSchema = z
  .strictObject({
    /** Subject id the candidates were ranked for (normally the brand). */
    rankedAgainst: identifier,
    /** Candidate id that represents the target, if the target is among the candidates. */
    targetCandidateId: identifier.optional(),
    candidates: z.array(rankedCandidateSchema).min(1),
    /** "single_call" is a claim; the engine verifies it against candidate provenance. */
    comparisonScope: z.enum(["single_call", "unknown"]),
    provenance: provenanceList,
  })
  .superRefine((ranking, ctx) => {
    const ids = new Set<string>();
    ranking.candidates.forEach((candidate, index) => {
      if (ids.has(candidate.id)) ctx.addIssue({ code: "custom", path: ["candidates", index, "id"], message: `duplicate candidate id "${candidate.id}"` });
      ids.add(candidate.id);
    });
    refineUniqueRanks(ranking.candidates, ctx, ["candidates"]);
    if (ranking.targetCandidateId !== undefined && !ids.has(ranking.targetCandidateId)) {
      ctx.addIssue({ code: "custom", path: ["targetCandidateId"], message: "targetCandidateId does not match any candidate" });
    }
  });
export type RankingEvidence = z.output<typeof rankingEvidenceSchema>;

export const BRIDGE_SEMANTICS = ["shared_signal", "joint_signal", "intermediate_signal"] as const;

export const bridgeEvidenceSchema = z
  .strictObject({
    semantics: z.enum(BRIDGE_SEMANTICS),
    signals: z.array(culturalSignalSchema),
    provenance: provenanceList,
  })
  .superRefine((bridge, ctx) => refineUniqueRanks(bridge.signals, ctx, ["signals"]));
export type BridgeEvidence = z.output<typeof bridgeEvidenceSchema>;

const conditionedEntitySchema = z.strictObject({
  id: identifier,
  label: text,
  rank,
  numeric: numericEvidenceSchema.optional(),
  provenance: provenanceList,
});

/**
 * Brand-conditioned territory evidence: the entities ONE call returns inside a territory scope when
 * conditioned on a subject. Order and values are comparable only inside that call, so values must be
 * declared `within_call` and the list must be `single_call` (verified later against provenance).
 */
export const conditionedEntityEvidenceSchema = z
  .strictObject({
    conditionedOn: z.strictObject({ id: identifier, label: text }),
    territory: z.strictObject({ id: identifier, label: text }),
    entityType: text.optional(),
    requestedLimit: z.number().int().min(1).optional(),
    truncated: z.boolean().optional(),
    /** May be empty: an observed empty result is evidence, provided it carries provenance. */
    entities: z.array(conditionedEntitySchema),
    comparisonScope: z.literal("single_call"),
    provenance: provenanceList,
  })
  .superRefine((evidence, ctx) => {
    const ids = new Set<string>();
    evidence.entities.forEach((entity, index) => {
      if (ids.has(entity.id)) ctx.addIssue({ code: "custom", path: ["entities", index, "id"], message: `duplicate entity id "${entity.id}"` });
      ids.add(entity.id);
      if (entity.numeric !== undefined && entity.numeric.comparisonScope !== "within_call") {
        ctx.addIssue({ code: "custom", path: ["entities", index, "numeric", "comparisonScope"], message: "conditioned entity values come from one call and must be within_call" });
      }
    });
    refineUniqueRanks(evidence.entities, ctx, ["entities"]);
    if (evidence.entities.length === 0 && evidence.provenance.length === 0) {
      ctx.addIssue({ code: "custom", path: ["provenance"], message: "an empty conditioned result needs provenance, or it cannot be told apart from 'not collected'" });
    }
    if (evidence.requestedLimit !== undefined && evidence.entities.length > evidence.requestedLimit) {
      ctx.addIssue({ code: "custom", path: ["entities"], message: "more entities than the requested limit" });
    }
  });
export type ConditionedEntityEvidence = z.output<typeof conditionedEntityEvidenceSchema>;

export const limitationSchema = z.strictObject({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/, "limitation codes are UPPER_SNAKE_CASE"),
  detail: text,
});
export type Limitation = z.output<typeof limitationSchema>;

export const evidencePacketSchema = z
  .strictObject({
    schemaVersion: z.enum(SUPPORTED_EVIDENCE_PACKET_VERSIONS),
    /** Where the evidence came from. Synthetic and recorded packets must never be presented as live. */
    origin: z.enum(["live", "recorded", "synthetic"]),
    brand: culturalProfileSchema,
    target: culturalProfileSchema,
    audience: audienceEvidenceSchema.optional(),
    ranking: rankingEvidenceSchema.optional(),
    bridges: z.array(bridgeEvidenceSchema).optional(),
    /** Brand-conditioned territory evidence (0.2+). Each item is one call. */
    conditionedEntities: z.array(conditionedEntityEvidenceSchema).optional(),
    limitations: z.array(limitationSchema),
    provenance: provenanceList,
  })
  .superRefine((packet, ctx) => {
    if (packet.brand.subject.id === packet.target.subject.id) {
      ctx.addIssue({ code: "custom", path: ["target", "subject", "id"], message: "brand and target must be different subjects" });
    }
    if (packet.conditionedEntities !== undefined && packet.schemaVersion === "ce-evidence/0.1") {
      ctx.addIssue({ code: "custom", path: ["conditionedEntities"], message: "conditionedEntities requires schemaVersion ce-evidence/0.2" });
    }
  });
export type EvidencePacket = z.output<typeof evidencePacketSchema>;
export type EvidencePacketInput = z.input<typeof evidencePacketSchema>;

export type EvidenceIssue = { path: string; message: string };

export type EvidenceParseResult = { ok: true; packet: EvidencePacket } | { ok: false; issues: EvidenceIssue[] };

export function parseEvidencePacket(input: unknown): EvidenceParseResult {
  const result = evidencePacketSchema.safeParse(input);
  if (result.success) return { ok: true, packet: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({ path: issue.path.map(String).join(".") || "(root)", message: issue.message })),
  };
}

export class EvidenceValidationError extends Error {
  readonly issues: EvidenceIssue[];
  constructor(issues: EvidenceIssue[]) {
    super(`Invalid EvidencePacket: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
    this.name = "EvidenceValidationError";
    this.issues = issues;
  }
}

// Compile-time check that these schemas and the shared output types describe the same shapes.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _contractAlignment: [
  Same<ProvenanceRef, SharedProvenanceRef>,
  Same<NumericEvidence, SharedNumericEvidence>,
  Same<CulturalSignal, SharedCulturalSignal>,
  Same<ResolvedEntity, SharedResolvedEntity>,
  Same<InterpretableMetric, SharedInterpretableMetric>,
  Same<Limitation, SharedLimitation>,
  Same<ConditionedEntityEvidence, SharedConditionedEntityEvidence>,
] = [true, true, true, true, true, true, true];
void _contractAlignment;
