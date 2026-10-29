/**
 * Sprint 10A: evidence-to-opportunity contracts. Four levels are kept apart and never inherit each other's status:
 *   observed signal     something Qloo returned (a tag on a profile, an entity in a list), with its call
 *   agent interpretation the model's reading of why signals might connect (advisory text, never evidence)
 *   proposed territory  a frontier candidate (Qloo-grounded concept or agent hypothesis)
 *   opportunity status  what the run's Qloo evidence established about the territory (deterministic)
 */

/**
 * How an observed signal relates to the brand. Only BRAND_PROFILE_TAG is a direct observation about the brand; every
 * other relation is indirect and never proves a brand-to-territory affinity.
 *   BRAND_PROFILE_TAG         a tag on the brand's own Qloo tag profile
 *   RELATED_ENTITY_TAG        a tag on the profile of an entity Qloo related to the brand
 *   BRAND_CONDITIONED_ENTITY  an entity a brand-conditioned query returned (e.g. related artists in the baseline scan)
 *   SEED_ENTITY_TAG           a tag on the profile of such an entity, fetched in this run
 */
export type SignalRelation = "BRAND_PROFILE_TAG" | "RELATED_ENTITY_TAG" | "BRAND_CONDITIONED_ENTITY" | "SEED_ENTITY_TAG";

/**
 * An entity the authorized baseline scan observed in a brand-conditioned list, handed to an explore run as a starting
 * point. It motivates hypotheses; it is never support. Re-read from the scan on the server, never from client text.
 */
export type DiscoverySeed = {
  id: string;
  label: string;
  /** The scan's query domain (artist, place, movie, book), not a confirmed entity type. */
  domain: string;
  relation: "BRAND_CONDITIONED_ENTITY";
  scanId: string;
  correlationId: string;
  rankWithinCall: number;
  /** The scan's type evidence for the entity, verbatim. */
  typeEvidence: string;
  partial: boolean;
};

/**
 * Whether a concept's tag namespace appears on the brand's own profile. A structural observation about Qloo tags,
 * not a judgment of novelty or of core versus adjacent position (research-position/v1 forbids inferring those).
 */
export type DomainRelation = "WITHIN_BRAND_PROFILE_FACETS" | "OUTSIDE_BRAND_PROFILE_FACETS" | "BRAND_PROFILE_UNKNOWN";

/** How a tag facet is used. Mirrors BaselineTagRole; none of these is an opportunity on its own. */
export type FacetRole = "AUDIENCE_TASTE" | "BRAND_CLASSIFICATION" | "DESCRIPTIVE_KEYWORD";

/**
 * The five opportunity states. Definitions are exact and deterministic:
 *   OBSERVED_ASSOCIATION    Qloo returned it for the brand (baseline tag, or seed entity); not proposed or tested
 *   UNVALIDATED_HYPOTHESIS  proposed in this run; Qloo support not yet decided
 *   QLOO_SUPPORTED          anchored concept with ≥ 1 brand-independent Qloo member in this run (a recommend pool, not a
 *                           profile carrying the tag); no relative position
 *   RELATIVELY_MEASURED     FULL relative analysis with a numeric position (holds only within its comparison set)
 *   NOT_ESTABLISHED         unsupported, duplicate, unmeasurable or inconclusive; `blocker` says which
 */
export type OpportunityStatus = "OBSERVED_ASSOCIATION" | "UNVALIDATED_HYPOTHESIS" | "QLOO_SUPPORTED" | "RELATIVELY_MEASURED" | "NOT_ESTABLISHED";
export type OpportunityBlocker = "UNSUPPORTED" | "DUPLICATE" | "UNMEASURABLE" | "INCONCLUSIVE";

export type OpportunitySignal = { id: string; label: string; relation: SignalRelation; correlationIds: string[] };

/** One proposed frontier territory, explained. Every field but `interpretation` is derived from evidence by code. */
export type OpportunityView = {
  territoryKey: string;
  direction: string;
  source: "qloo_grounded" | "agent_hypothesis";
  status: OpportunityStatus;
  blocker: OpportunityBlocker | null;
  /** The observed signals that motivated it (ids observed in this run or in the authorized scan). */
  surfacedBy: OpportunitySignal[];
  facet: string | null;
  domainRelation: DomainRelation;
  /** The agent's own reading (rationale or semantic reason). Advisory; labelled as interpretation everywhere. */
  interpretation: string | null;
  unknowns: string[];
  nextInvestigation: string | null;
};

export const OPPORTUNITY_RULES_VERSION = "opportunity-status/v1" as const;
