/**
 * Internal evidence contracts (Sprint 0, preliminary).
 *
 * Derived from what the Qloo harness 0.1.26 verifiably emits (see backend/src/qloo/types.ts for the
 * [contract]/[harness]/[live] levels). Shapes Qloo does not type, such as compare_audiences results,
 * demographics and trends, are held as `OpaqueEvidence` rather than invented.
 *
 * Deliberately absent:
 *   - any Elasticity score, weight, or composite metric (no evidence-backed formula exists yet);
 *   - `confidence` on resolved concepts: the harness does not return calibrated confidence, and it
 *     explicitly refuses to relabel rank/popularity as confidence.
 * All schemas are strict, so an unsupported field is rejected rather than silently carried.
 */
import { z } from "zod";
import { QLOO_OPERATIONS, QLOO_STATUSES } from "../qloo/types.js";

export const provenanceRefSchema = z.strictObject({
  operation: z.enum(QLOO_OPERATIONS),
  correlationId: z.string().min(1),
  status: z.enum(QLOO_STATUSES),
  endpoint: z.string().optional(),
  documentation: z.string().optional(),
  /** Upstream GET requests as reported by the harness (entity IDs / tag URNs only; no credentials). */
  requests: z.array(z.strictObject({ method: z.literal("GET"), path: z.string(), query: z.unknown() })).optional(),
  warnings: z.array(z.string()),
  degraded: z.boolean(),
  partial: z.boolean(),
});
export type ProvenanceRef = z.infer<typeof provenanceRefSchema>;

export const conceptRefSchema = z.strictObject({
  qlooId: z.string().min(1),
  label: z.string(),
  type: z.string().optional(),
});
export type ConceptRef = z.infer<typeof conceptRefSchema>;

export const resolvedConceptSchema = z.strictObject({
  kind: z.enum(["entity", "tag"]),
  /** What we asked for. */
  input: z.string(),
  /** What Qloo calls it. */
  label: z.string(),
  qlooId: z.string().min(1),
  type: z.string().optional(),
  /** Harness resolution match kind, e.g. "exact" or "identifier" (verbatim, not interpreted). */
  match: z.string().optional(),
  /**
   * unambiguous: the harness resolved it without asking.
   * auto_selected_unconfirmed: we picked among candidates by a documented rule; a human must confirm.
   * pinned: a human pinned the Qloo ID in configuration.
   */
  confirmation: z.enum(["unambiguous", "auto_selected_unconfirmed", "pinned"]),
  alternatives: z.array(conceptRefSchema),
  /** Qloo calls that produced or used this concept. Empty only for a pinned ID not yet observed in any call. */
  provenance: z.array(provenanceRefSchema),
});
export type ResolvedConcept = z.infer<typeof resolvedConceptSchema>;

/** One Qloo-returned tag or entity with its query-relative scores. */
export const culturalSignalSchema = z.strictObject({
  kind: z.enum(["entity", "tag"]),
  qlooId: z.string().min(1),
  label: z.string(),
  type: z.string().optional(),
  /** Query-relative. Comparable ONLY with other signals carrying the same `sourceCorrelationId`. */
  affinity: z.number().optional(),
  popularity: z.number().optional(),
  sourceCorrelationId: z.string().min(1),
});
export type CulturalSignal = z.infer<typeof culturalSignalSchema>;

/** Qloo output whose structure is not typed by the harness contract. Sanitized and bounded; never interpreted. */
export const opaqueEvidenceSchema = z.strictObject({
  operation: z.enum(QLOO_OPERATIONS),
  shape: z.literal("unverified"),
  topLevelKeys: z.array(z.string()),
  /** Dotted paths whose values are numbers. Helps identify candidate metrics; NOT a claim of meaning. */
  numericFieldPaths: z.array(z.string()),
  data: z.unknown(),
  provenance: provenanceRefSchema,
});
export type OpaqueEvidence = z.infer<typeof opaqueEvidenceSchema>;

export const culturalProfileSchema = z.strictObject({
  subjects: z.array(resolvedConceptSchema).min(1),
  /** Tags jointly characterizing `subjects` (entity_tags, i.e. Insights filter.type=urn:tag). */
  tags: z.array(culturalSignalSchema),
  /** Entities with affinity to `subjects` (recommend), when collected. */
  relatedEntities: z.array(culturalSignalSchema).optional(),
  demographics: opaqueEvidenceSchema.optional(),
  momentum: opaqueEvidenceSchema.optional(),
  provenance: z.array(provenanceRefSchema),
});
export type CulturalProfile = z.infer<typeof culturalProfileSchema>;

export const tagCandidateSetSchema = z.strictObject({
  query: z.string(),
  /** In the order Qloo returned them. Order is a semantic-search rank, not a confidence. */
  candidates: z.array(conceptRefSchema),
  provenance: provenanceRefSchema,
});
export type TagCandidateSet = z.infer<typeof tagCandidateSetSchema>;

export const targetRepresentationSchema = z.strictObject({
  label: z.string(),
  tagCandidates: z.array(tagCandidateSetSchema),
  selectedTag: resolvedConceptSchema.optional(),
  /** Entities standing in for the territory (Qloo has no "territory" object; see feasibility doc §5). */
  exemplars: z.array(resolvedConceptSchema),
  exemplarMethod: z.string(),
});
export type TargetRepresentation = z.infer<typeof targetRepresentationSchema>;

export const audienceComparisonSchema = z.strictObject({
  groupA: z.array(resolvedConceptSchema).min(1),
  groupB: z.array(resolvedConceptSchema).min(1),
  result: opaqueEvidenceSchema,
});
export type AudienceComparison = z.infer<typeof audienceComparisonSchema>;

export const rankedCandidateSchema = z.strictObject({
  territory: z.string(),
  /** Human-chosen stand-in entity for the territory. This choice is an assumption. */
  exemplarInput: z.string(),
  exemplar: resolvedConceptSchema.optional(),
  /** 1-based position in Qloo's returned order; absent if unresolved or not returned. */
  position: z.number().int().min(1).optional(),
  affinity: z.number().optional(),
  popularity: z.number().optional(),
  unresolvedReason: z.string().optional(),
});
export type RankedCandidate = z.infer<typeof rankedCandidateSchema>;

export const candidateRankingSchema = z.strictObject({
  signal: resolvedConceptSchema,
  optionType: z.string(),
  entries: z.array(rankedCandidateSchema),
  /** All affinities in `entries` come from this one call and are comparable only with each other. */
  comparableWithinCorrelationId: z.string().optional(),
  assumptions: z.array(z.string()),
  provenance: z.array(provenanceRefSchema),
});
export type CandidateRanking = z.infer<typeof candidateRankingSchema>;

export const bridgeEvidenceSchema = z.strictObject({
  /** Fixed wording: Qloo exposes no graph paths, so these are not paths. */
  semantics: z.literal("qloo_supported_intermediate_cultural_signals"),
  from: resolvedConceptSchema,
  toLabel: z.string(),
  toExemplars: z.array(resolvedConceptSchema).min(1),
  /** Tag IDs present in both the brand's and the target's top-N entity_tags lists. */
  sharedTags: z.array(conceptRefSchema),
  /** Tags Qloo returns as jointly characterizing brand + target exemplars in a single call. */
  jointTags: z.array(culturalSignalSchema),
  /** Descriptive set overlap on truncated top-N lists. Not a distance, not a probability. */
  overlap: z.strictObject({
    brandTopN: z.number().int().min(0),
    targetTopN: z.number().int().min(0),
    sharedCount: z.number().int().min(0),
    jaccard: z.number().min(0).max(1).nullable(),
  }),
  provenance: z.array(provenanceRefSchema),
});
export type BridgeEvidence = z.infer<typeof bridgeEvidenceSchema>;

/** Target-territory entities ranked by affinity to the brand (recommend: signal=brand, filter=territory tag). */
export const brandConditionedTargetSchema = z.strictObject({
  signal: resolvedConceptSchema,
  filterTag: resolvedConceptSchema,
  entities: z.array(culturalSignalSchema),
  provenance: z.array(provenanceRefSchema),
});
export type BrandConditionedTarget = z.infer<typeof brandConditionedTargetSchema>;

export const evidencePacketSchema = z.strictObject({
  schemaVersion: z.literal("0.1"),
  generatedAt: z.string(),
  /** "live" only when every call went to real Qloo. Fixture-driven packets must say "fixture". */
  evidenceSource: z.enum(["live", "fixture"]),
  harness: z.strictObject({ version: z.string(), contractChecksum: z.string() }),
  brand: culturalProfileSchema,
  target: z.strictObject({ representation: targetRepresentationSchema, profile: culturalProfileSchema.optional() }),
  targetAffinityToBrand: brandConditionedTargetSchema.optional(),
  audienceComparison: audienceComparisonSchema.optional(),
  rankings: z.array(candidateRankingSchema).optional(),
  bridgeEvidence: z.array(bridgeEvidenceSchema).optional(),
  limitations: z.array(z.string()),
  provenance: z.array(provenanceRefSchema),
});
export type EvidencePacket = z.infer<typeof evidencePacketSchema>;
