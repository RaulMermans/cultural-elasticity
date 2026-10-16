/**
 * QlooClient: the only Qloo surface product code (and the future agent) should use.
 *
 * Implemented methods are limited to workflows this sprint needs and whose contracts were verified
 * from the harness. `where_popular` exists in the harness but is not wrapped: no Sprint 0 question needs it.
 *
 * Status policy (sprint spec §12):
 *   ok          → { kind: "ok" }
 *   partial     → { kind: "ok" } with provenance.partial = true and warnings preserved
 *   degraded    → { kind: "ok" } with provenance.degraded = true
 *   empty       → { kind: "empty" } (also when an array-valued result comes back with zero items)
 *   needs_input → { kind: "needs_input" } carrying the candidates; callers must handle it explicitly
 *   error       → retried once only if Qloo marks it retryable, then thrown as QlooWorkflowError
 *   QLOO_AUTH   → QlooNotConfiguredError (never retried)
 */
import type { CulturalSignal, OpaqueEvidence, ProvenanceRef, ResolvedConcept } from "../contracts/qloo.js";
import { QlooNotConfiguredError, QlooWorkflowError } from "./errors.js";
import {
  parseEnvelope,
  toEntitySignals,
  toOpaqueEvidence,
  toProvenance,
  toResolutionIssues,
  toResolvedEntities,
  toTagSignals,
  type QlooEnvelope,
  type ResolutionIssue,
} from "./normalize.js";
import type { QlooTransport } from "./transport.js";
import type {
  AudienceDemographicsInput,
  CompareAudiencesInput,
  DescribeInput,
  EntityTagsInput,
  FindTagsInput,
  QlooOperation,
  QlooOperationInput,
  RankInput,
  RecommendInput,
  TrendsInput,
} from "./types.js";

export const MAX_AUTOMATIC_RETRIES = 1;

export type QlooOutcome<T> =
  | { kind: "ok"; data: T; provenance: ProvenanceRef }
  | { kind: "empty"; summary: string | undefined; provenance: ProvenanceRef }
  | { kind: "needs_input"; summary: string | undefined; issues: ResolutionIssue[]; provenance: ProvenanceRef };

export type DescribeData = { entity: ResolvedConcept; details: CulturalSignal[] };
export type EntityTagsData = { subjects: ResolvedConcept[]; tags: CulturalSignal[] };
export type RecommendData = { signals: ResolvedConcept[]; entities: CulturalSignal[] };
export type RankData = { options: ResolvedConcept[]; signals: ResolvedConcept[]; ranked: CulturalSignal[] };
export type CompareAudiencesData = { groupA: ResolvedConcept[]; groupB: ResolvedConcept[]; result: OpaqueEvidence };
export type DemographicsData = { entity: ResolvedConcept; result: OpaqueEvidence };
export type TrendsData = { result: OpaqueEvidence };

export interface QlooClient {
  describe(input: DescribeInput): Promise<QlooOutcome<DescribeData>>;
  findTags(input: FindTagsInput): Promise<QlooOutcome<CulturalSignal[]>>;
  entityTags(input: EntityTagsInput): Promise<QlooOutcome<EntityTagsData>>;
  recommend(input: RecommendInput): Promise<QlooOutcome<RecommendData>>;
  rank(input: RankInput): Promise<QlooOutcome<RankData>>;
  compareAudiences(input: CompareAudiencesInput): Promise<QlooOutcome<CompareAudiencesData>>;
  audienceDemographics(input: AudienceDemographicsInput): Promise<QlooOutcome<DemographicsData>>;
  trends(input: TrendsInput): Promise<QlooOutcome<TrendsData>>;
}

type Mapper<T> = (envelope: QlooEnvelope, provenance: ProvenanceRef) => T;

export class HarnessQlooClient implements QlooClient {
  constructor(private readonly transport: QlooTransport) {}

  private async run<O extends QlooOperation, T>(
    operation: O,
    input: QlooOperationInput[O],
    map: Mapper<T>,
    isEmpty: (data: T) => boolean = () => false,
  ): Promise<QlooOutcome<T>> {
    for (let attempt = 1; ; attempt += 1) {
      const result = await this.transport.execute(operation, input);

      let failure: { code: string; layer: string; retryable: boolean; recovery: string } | undefined;
      let envelope: QlooEnvelope | undefined;
      if (result.kind === "failure") {
        failure = result.failure;
      } else {
        envelope = parseEnvelope(operation, result.raw);
        if (envelope.status === "error") failure = envelope.error;
      }

      if (failure) {
        if (failure.code === "QLOO_AUTH") throw new QlooNotConfiguredError(operation);
        if (failure.retryable && attempt <= MAX_AUTOMATIC_RETRIES) continue;
        throw new QlooWorkflowError(operation, failure.code, failure.layer, failure.retryable, failure.recovery, attempt);
      }
      if (!envelope) throw new Error("unreachable: no envelope and no failure");

      const provenance = toProvenance(operation, envelope);
      if (envelope.status === "needs_input") {
        return { kind: "needs_input", summary: envelope.summary, issues: toResolutionIssues(operation, envelope), provenance };
      }
      if (envelope.status === "empty") return { kind: "empty", summary: envelope.summary, provenance };

      const data = map(envelope, provenance);
      if (isEmpty(data)) return { kind: "empty", summary: envelope.summary ?? "Qloo returned no results.", provenance };
      return { kind: "ok", data, provenance };
    }
  }

  describe(input: DescribeInput) {
    return this.run("describe", input, (envelope, provenance) => {
      const [entity] = toResolvedEntities("describe", envelope, "entity", provenance);
      if (!entity) throw new QlooWorkflowError("describe", "NO_ENTITY", "adapter", false, "Describe returned no resolved entity.", 1);
      return { entity, details: toEntitySignals("describe", envelope) };
    });
  }

  findTags(input: FindTagsInput) {
    return this.run("find_tags", input, (envelope) => toTagSignals("find_tags", envelope), (tags) => tags.length === 0);
  }

  entityTags(input: EntityTagsInput) {
    return this.run(
      "entity_tags",
      input,
      (envelope, provenance) => ({
        subjects: toResolvedEntities("entity_tags", envelope, "entities", provenance),
        tags: toTagSignals("entity_tags", envelope),
      }),
      (data) => data.tags.length === 0,
    );
  }

  recommend(input: RecommendInput) {
    return this.run(
      "recommend",
      input,
      (envelope, provenance) => ({
        signals: toResolvedEntities("recommend", envelope, "signals", provenance),
        entities: toEntitySignals("recommend", envelope),
      }),
      (data) => data.entities.length === 0,
    );
  }

  rank(input: RankInput) {
    return this.run(
      "rank",
      input,
      (envelope, provenance) => ({
        options: toResolvedEntities("rank", envelope, "options", provenance),
        signals: toResolvedEntities("rank", envelope, "signals", provenance),
        ranked: toEntitySignals("rank", envelope),
      }),
      (data) => data.ranked.length === 0,
    );
  }

  compareAudiences(input: CompareAudiencesInput) {
    return this.run("compare_audiences", input, (envelope, provenance) => ({
      groupA: toResolvedEntities("compare_audiences", envelope, "group_a", provenance),
      groupB: toResolvedEntities("compare_audiences", envelope, "group_b", provenance),
      // [harness] results are the upstream /v2/analysis/compare payload, passed through untyped.
      result: toOpaqueEvidence("compare_audiences", envelope.results, provenance),
    }));
  }

  audienceDemographics(input: AudienceDemographicsInput) {
    return this.run(
      "audience_demographics",
      input,
      (envelope, provenance) => {
        const [entity] = toResolvedEntities("audience_demographics", envelope, "entity", provenance);
        if (!entity) throw new QlooWorkflowError("audience_demographics", "NO_ENTITY", "adapter", false, "No resolved entity.", 1);
        return { entity, result: toOpaqueEvidence("audience_demographics", envelope.results, provenance) };
      },
      (data) => Array.isArray(data.result.data) && data.result.data.length === 0,
    );
  }

  trends(input: TrendsInput) {
    // [harness] trends returns `series` (not `results`): [{ entity, points[] }].
    return this.run(
      "trends",
      input,
      (envelope, provenance) => ({ result: toOpaqueEvidence("trends", (envelope as Record<string, unknown>).series, provenance) }),
      (data) => Array.isArray(data.result.data) && data.result.data.length === 0,
    );
  }
}
