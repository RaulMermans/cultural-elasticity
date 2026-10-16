/**
 * Qloo harness wire types.
 *
 * Verification levels used in comments throughout backend/src/qloo:
 *   [contract]  Read from `qloo_capabilities` of @qloo/qloo-harness 0.1.26
 *               (contract 1.0.0, sha256:762bdcc5…24f5, result schema 1.0-preview.1).
 *   [harness]   Read from the harness 0.1.26 workflow implementation (dist/qloo-tools.js).
 *               Field names are what the harness emits; values are not live-verified.
 *   [live]      Observed in a live Qloo response. NOTHING is at this level yet:
 *               Sprint 0 ran without a credential (LIVE_QLOO_VALIDATION_NOT_RUN).
 */

export const QLOO_HARNESS_MIN_VERSION = "0.1.26";
export const QLOO_RESULT_SCHEMA_VERSION = "1.0-preview.1";
export const QLOO_CONTRACT_CHECKSUM = "sha256:762bdcc5e14ff797b6de739d2658a83f78af35e68d7a5a3449455be6046924f5";

/** [contract] The nine canonical workflow operations. */
export const QLOO_OPERATIONS = [
  "recommend",
  "rank",
  "describe",
  "where_popular",
  "compare_audiences",
  "entity_tags",
  "audience_demographics",
  "trends",
  "find_tags",
] as const;
export type QlooOperation = (typeof QLOO_OPERATIONS)[number];

/** [contract] Result envelope statuses. */
export const QLOO_STATUSES = ["ok", "empty", "needs_input", "partial", "degraded", "error"] as const;
export type QlooStatus = (typeof QLOO_STATUSES)[number];

/** [contract] Insights entity types accepted by recommend/rank/compare_audiences/trends. */
export type QlooInsightsType = "artist" | "book" | "brand" | "movie" | "person" | "place" | "podcast" | "tv_show" | "videogame";

/** [contract] Search entity types accepted by describe/entity_tags/audience_demographics. */
export type QlooSearchType = QlooInsightsType | "locality" | "actor" | "album" | "author" | "director";

// ---- Workflow inputs: [contract] input schemas, restricted to the fields this project uses. ----

export type DescribeInput = { entity: string; type?: QlooSearchType };

export type FindTagsInput = { query: string; semantic?: boolean; limit?: number };

/** `entities` are named entities or Qloo UUIDs (1–10). The harness asks Qloo for tags that jointly characterize them. */
export type EntityTagsInput = { entities: string[]; entity_type?: QlooSearchType; limit?: number };

/** At least one of signals / signal_tags is required by the harness. Tags are concepts or tag URNs, never entities. */
export type RecommendInput = {
  target_type: QlooInsightsType;
  signals?: string[];
  signal_tags?: string[];
  signal_tags_operator?: "union" | "intersection";
  include_tags?: string[];
  include_tags_operator?: "union" | "intersection";
  exclude_tags?: string[];
  explain?: boolean;
  limit?: number;
};

/** All options must be entities of one `option_type` (1–10). Scores from separate calls are NOT comparable [contract]. */
export type RankInput = {
  options: string[];
  option_type: QlooInsightsType;
  signals?: string[];
  include_tags?: string[];
  exclude_tags?: string[];
};

/** Both groups are entity lists (1–10 each). Tags/concepts are not accepted [contract]. */
export type CompareAudiencesInput = {
  group_a: string[];
  group_b: string[];
  target_type?: QlooInsightsType;
  limit?: number;
};

export type AudienceDemographicsInput = { entity: string; entity_type?: QlooSearchType; limit?: number };

export type TrendsInput = {
  entities: string[];
  entity_type: QlooInsightsType;
  start_date: string;
  end_date: string;
  limit?: number;
};

export type QlooOperationInput = {
  recommend: RecommendInput;
  rank: RankInput;
  describe: DescribeInput;
  where_popular: { entity: string; within: string; entity_type?: QlooSearchType; limit?: number };
  compare_audiences: CompareAudiencesInput;
  entity_tags: EntityTagsInput;
  audience_demographics: AudienceDemographicsInput;
  trends: TrendsInput;
  find_tags: FindTagsInput;
};
