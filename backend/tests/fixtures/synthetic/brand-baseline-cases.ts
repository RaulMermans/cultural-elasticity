/**
 * SYNTHETIC cross-brand baseline cases. Placeholder Qloo IDs (`syn-…`) and correlations; never live output.
 * Tag URNs reuse real Qloo facet shapes (`urn:tag:<namespace>:<source>:…`) so the facet rules are exercised,
 * but every concept slug ends in `syn_…` and no case encodes a benchmark brand.
 */
import type { BaselineObservation } from "../../../src/brand-baseline/research.js";
import type { CulturalSignal, ProvenanceRef } from "../../../src/contracts/qloo.js";
import { syntheticBrand, syntheticProvenance } from "./brand-baseline.js";

const at = "2026-10-25T00:00:00.000Z";
export const tag = (facet: string, slug: string, label: string, correlationId = "syn-tags"): CulturalSignal => ({ kind: "tag", qlooId: `urn:tag:${facet}:syn_${slug}`, label, type: `urn:tag:${facet}`, sourceCorrelationId: correlationId });
export const op = (facet: string, slug: string, label: string, correlationId = "syn-tags") => tag(facet, slug, label, correlationId);
export const entity = (id: string, label: string, correlationId: string, type = "urn:entity", subtype?: string): CulturalSignal => ({ kind: "entity", qlooId: id, label, type, ...(subtype ? { subtype } : {}), sourceCorrelationId: correlationId });

export function tagsObservation(tags: CulturalSignal[], options: { correlationId?: string; status?: ProvenanceRef["status"] } = {}): BaselineObservation {
  const correlationId = options.correlationId ?? "syn-tags";
  return { domain: "tags", capturedAt: at, outcome: { kind: "ok", data: { subjects: [], tags }, provenance: syntheticProvenance("entity_tags", correlationId, options.status ?? "ok") } };
}

/** A recommend observation whose provenance records the request the harness sent, as live envelopes do. */
export function relatedObservation(domain: "artist" | "place" | "movie" | "book", entities: CulturalSignal[], options: { correlationId?: string; recordedType?: string | null; status?: ProvenanceRef["status"] } = {}): BaselineObservation {
  const correlationId = options.correlationId ?? `syn-${domain}`;
  const recordedType = options.recordedType === undefined ? `urn:entity:${domain}` : options.recordedType;
  const provenance: ProvenanceRef = { ...syntheticProvenance("recommend", correlationId, options.status ?? "ok"), ...(recordedType ? { requests: [{ method: "GET", path: "/v2/insights", query: { "filter.type": recordedType, take: 10 } }] } : {}) };
  return { domain, capturedAt: at, outcome: { kind: "ok", data: { signals: [], entities }, provenance } };
}
export const emptyObservation = (domain: BaselineObservation["domain"], correlationId = `syn-empty-${domain}`): BaselineObservation => ({ domain, capturedAt: at, outcome: { kind: "empty", summary: "SYNTHETIC empty", provenance: syntheticProvenance(domain === "tags" ? "entity_tags" : "recommend", correlationId, "empty") } });
export const needsInputObservation = (domain: BaselineObservation["domain"]): BaselineObservation => ({ domain, capturedAt: at, outcome: { kind: "needs_input", summary: "SYNTHETIC clarification", issues: [], provenance: syntheticProvenance(domain === "tags" ? "entity_tags" : "recommend", `syn-needs-${domain}`, "needs_input") } });

const venueTags = (n: number, correlationId = "syn-tags") => [
  op("credit_card:place", "card", "SYNTHETIC Card", correlationId),
  op("cost_description:place", "pricey", "Pricey", correlationId),
  op("inclusivity:place", "badge", "Owner badge", correlationId),
  op("specialty_dish:place", "dish", "House dish", correlationId),
  op("hotel_rating:place", "stars", "Star rating", correlationId),
  op("genre:place", "restaurant", "Restaurant", correlationId),
].slice(0, n);
const related = (domain: "artist" | "place" | "movie" | "book", n: number, type = "urn:entity", subtype?: string) =>
  Array.from({ length: n }, (_, index) => entity(`syn-${domain}-${index + 1}`, `SYNTHETIC ${domain} ${index + 1}`, `syn-${domain}`, type, subtype));
const allRelated = (type = "urn:entity", subtypeFor?: (domain: string) => string) => (["artist", "place", "movie", "book"] as const).map((domain) => relatedObservation(domain, related(domain, 10, type, subtypeFor?.(domain))));

export type BaselineCase = {
  id: string;
  description: string;
  observations: BaselineObservation[];
  incompleteStages?: string[];
  expect: {
    scanStatus: string;
    hypotheses: string[];
    statuses?: string[];
    typeEvidence?: Partial<Record<"PROVIDER_CONFIRMED_TYPE" | "QUERY_SCOPED" | "GENERIC_TYPE_UNRESOLVED" | "CONFLICTING_TYPE", number>>;
    excludedRules?: string[];
    themes?: string[];
    possibleDuplicates?: number;
    usefulness: "PASS" | "INSUFFICIENT";
  };
};

export const BRAND = syntheticBrand("SYNTHETIC House", "syn-brand-case");

export const BASELINE_CASES: BaselineCase[] = [
  {
    id: "luxury-shaped",
    description: "Luxury-like shape: six venue attributes, two taxonomy genres, two media keywords, 40 generic entities with recorded query scope.",
    observations: [tagsObservation([tag("genre:person", "model", "Runway model"), ...venueTags(6), tag("keyword:media", "drama", "period drama"), tag("genre:media", "couture", "Couture"), tag("keyword:media", "adaptation", "stage adaptation")]), ...allRelated()],
    expect: { scanStatus: "COMPLETE", hypotheses: ["Runway model", "Couture"], typeEvidence: { QUERY_SCOPED: 40 }, excludedRules: ["payment", "price_descriptor", "venue_listing_badge", "menu_item", "venue_rating", "venue_category"], themes: ["Media keywords"], usefulness: "PASS" },
  },
  {
    id: "unrelated-category",
    description: "Another category: curated concepts and a music genre, provider-confirmed entity types.",
    observations: [tagsObservation([tag("lifestyle:qloo", "trail", "Trail living"), tag("genre:music", "folk", "Folk"), tag("customer_segment:qloo", "climbers", "Climbers")]), ...allRelated("urn:entity", (domain) => `urn:entity:${domain}`)],
    expect: { scanStatus: "COMPLETE", hypotheses: ["Trail living", "Folk", "Climbers"], typeEvidence: { PROVIDER_CONFIRMED_TYPE: 40 }, usefulness: "PASS" },
  },
  {
    id: "many-cultural-tags",
    description: "Several verified cultural tags: the five-hypothesis ceiling keeps Qloo's order.",
    observations: [tagsObservation([tag("lifestyle:qloo", "a", "Slow living"), tag("aesthetic_property:qloo", "b", "Hand-finished"), tag("genre:media", "c", "Design"), tag("emotional_tone:qloo", "d", "Calm"), tag("audience:qloo", "e", "Collectors"), tag("lifestyle:qloo", "f", "City nomads"), tag("genre:music", "g", "Ambient")])],
    expect: { scanStatus: "COMPLETE", hypotheses: ["Slow living", "Hand-finished", "Design", "Calm", "Collectors"], themes: ["Lifestyle"], usefulness: "PASS" },
  },
  {
    id: "mainly-operational",
    description: "A brand whose profile is almost entirely venue metadata.",
    observations: [tagsObservation([...venueTags(6), tag("keyword:media", "night", "night")])],
    expect: { scanStatus: "PARTIAL", hypotheses: [], usefulness: "INSUFFICIENT" },
  },
  {
    id: "only-operational",
    description: "Every returned tag is operational: zero hypotheses, honest reason.",
    observations: [tagsObservation(venueTags(5))],
    expect: { scanStatus: "INSUFFICIENT_EVIDENCE", hypotheses: [], usefulness: "INSUFFICIENT" },
  },
  {
    id: "generic-types-scoped",
    description: "Generic urn:entity types with the harness-recorded filter.type: query-scoped, never confirmed.",
    observations: [tagsObservation([tag("genre:media", "x", "Documentary")]), relatedObservation("movie", related("movie", 10))],
    expect: { scanStatus: "COMPLETE", hypotheses: ["Documentary"], typeEvidence: { QUERY_SCOPED: 10, PROVIDER_CONFIRMED_TYPE: 0 }, usefulness: "PASS" },
  },
  {
    id: "mixed-types",
    description: "Mixed: some entities carry a Qloo subtype, some only the generic type.",
    observations: [tagsObservation([tag("genre:music", "soul", "Soul")]), relatedObservation("artist", [...related("artist", 3, "urn:entity", "urn:entity:artist"), entity("syn-artist-g1", "SYNTHETIC generic 1", "syn-artist"), entity("syn-artist-g2", "SYNTHETIC generic 2", "syn-artist")])],
    expect: { scanStatus: "COMPLETE", hypotheses: ["Soul"], typeEvidence: { PROVIDER_CONFIRMED_TYPE: 3, QUERY_SCOPED: 2 }, usefulness: "PASS" },
  },
  {
    id: "no-associations",
    description: "No useful associations anywhere.",
    observations: [emptyObservation("tags"), emptyObservation("artist"), emptyObservation("place")],
    expect: { scanStatus: "INSUFFICIENT_EVIDENCE", hypotheses: [], usefulness: "INSUFFICIENT" },
  },
  {
    id: "rich-fingerprint",
    description: "Rich fingerprint: themes, hypotheses and four confirmed domains.",
    observations: [tagsObservation([tag("genre:music", "jazz", "Jazz"), tag("genre:music", "bossa", "Bossa nova"), tag("lifestyle:qloo", "coastal", "Coastal living"), tag("genre:brand", "apparel", "Apparel"), tag("industry:qloo", "apparel", "Clothing industry")]), ...allRelated("urn:entity", (domain) => `urn:entity:${domain}`)],
    expect: { scanStatus: "COMPLETE", hypotheses: ["Jazz", "Bossa nova", "Coastal living"], themes: ["Music genres"], typeEvidence: { PROVIDER_CONFIRMED_TYPE: 40 }, usefulness: "PASS" },
  },
  {
    id: "conflicting-types",
    description: "A place-typed entity inside an artist query is set aside, not retyped.",
    observations: [tagsObservation([tag("genre:music", "pop", "Pop")]), relatedObservation("artist", [entity("syn-artist-ok", "SYNTHETIC artist", "syn-artist", "urn:entity", "urn:entity:artist"), entity("syn-place-in-artist", "SYNTHETIC venue", "syn-artist", "urn:entity", "urn:entity:place")])],
    expect: { scanStatus: "COMPLETE", hypotheses: ["Pop"], typeEvidence: { PROVIDER_CONFIRMED_TYPE: 1, CONFLICTING_TYPE: 1 }, excludedRules: ["conflicting_type"], usefulness: "PASS" },
  },
  {
    id: "scope-mismatch",
    description: "Qloo's recorded request type differs from the requested domain: the whole list is set aside.",
    observations: [tagsObservation([tag("genre:media", "y", "Poetry")]), relatedObservation("book", related("book", 3), { recordedType: "urn:entity:movie" })],
    expect: { scanStatus: "COMPLETE", hypotheses: ["Poetry"], typeEvidence: { CONFLICTING_TYPE: 3 }, excludedRules: ["conflicting_type"], usefulness: "PASS" },
  },
  {
    id: "incomplete-responses",
    description: "One stage asked for clarification and one never ran.",
    observations: [tagsObservation([tag("genre:media", "z", "Photography")]), needsInputObservation("artist")],
    incompleteStages: ["book"],
    expect: { scanStatus: "PARTIAL", hypotheses: ["Photography"], usefulness: "PASS" },
  },
  {
    id: "degraded-provenance",
    description: "Degraded tag call and a signal whose correlation does not match its call.",
    observations: [tagsObservation([tag("genre:media", "w", "Architecture"), tag("lifestyle:qloo", "v", "Minimalism", "syn-other-call")], { status: "degraded" })],
    expect: { scanStatus: "PARTIAL", hypotheses: ["Architecture"], statuses: ["PARTIAL_EVIDENCE"], usefulness: "PASS" },
  },
  {
    id: "duplicated-references",
    description: "Repeated IDs in one call and two spellings of one concept: neither counts twice.",
    observations: [tagsObservation([tag("genre:music", "kpop", "K-pop"), tag("genre:music", "kpop", "K-pop"), tag("genre:music", "k_pop", "KPop"), tag("genre:music", "rnb", "R&B")]), relatedObservation("artist", [entity("syn-artist-1", "SYNTHETIC artist", "syn-artist"), entity("syn-artist-1", "SYNTHETIC artist", "syn-artist")])],
    expect: { scanStatus: "COMPLETE", hypotheses: ["K-pop", "R&B"], possibleDuplicates: 1, themes: ["Music genres"], typeEvidence: { QUERY_SCOPED: 1 }, usefulness: "PASS" },
  },
  {
    id: "multi-signal",
    description: "The same tag from two independent calls is multi-signal; repeating one call is not.",
    observations: [
      tagsObservation([tag("lifestyle:qloo", "craft", "Craft", "syn-tags-a"), tag("genre:media", "ceramics", "Ceramics", "syn-tags-a")], { correlationId: "syn-tags-a" }),
      tagsObservation([tag("lifestyle:qloo", "craft", "Craft", "syn-tags-b")], { correlationId: "syn-tags-b" }),
      tagsObservation([tag("genre:media", "ceramics", "Ceramics", "syn-tags-a")], { correlationId: "syn-tags-a" }),
    ],
    expect: { scanStatus: "COMPLETE", hypotheses: ["Craft", "Ceramics"], statuses: ["MULTI_SIGNAL_SUPPORT", "OBSERVED_ASSOCIATION"], usefulness: "PASS" },
  },
  {
    id: "zero-territories-keywords",
    description: "Only descriptive keywords and the brand's own classification: zero hypotheses.",
    observations: [tagsObservation([tag("keyword:media", "a", "rainy city"), tag("keyword:media", "b", "road trip"), tag("genre:brand", "shoes", "Footwear")]), relatedObservation("place", related("place", 4))],
    expect: { scanStatus: "PARTIAL", hypotheses: [], themes: ["Media keywords"], typeEvidence: { QUERY_SCOPED: 4 }, usefulness: "INSUFFICIENT" },
  },
  {
    id: "unclassifiable-entities",
    description: "Generic types and no recorded request: entities stay unresolved.",
    observations: [tagsObservation([tag("genre:media", "u", "Travel")]), relatedObservation("place", related("place", 5), { recordedType: null })],
    expect: { scanStatus: "COMPLETE", hypotheses: ["Travel"], typeEvidence: { GENERIC_TYPE_UNRESOLVED: 5 }, usefulness: "PASS" },
  },
];
