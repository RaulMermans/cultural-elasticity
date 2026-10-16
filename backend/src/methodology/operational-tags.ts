/**
 * OperationalTagPolicyV1: separates likely cultural signals from venue/operational metadata.
 *
 * This is OUR methodological interpretation, not Qloo truth. Nothing is deleted: every profile keeps
 * a RAW view, and the CULTURAL_FILTERED view lists every excluded signal with its rule and reason.
 *
 * Basis [live 2026-10-16]: brand tag profiles inherit attributes of the brand's PLACE listings
 * (stores, cafés). Those arrive in `<namespace>:place` tag namespaces (e.g. urn:tag:credit_card:place:visa)
 * on brands as different as Jacquemus, Sperry, Goop and Royal Copenhagen. Rules are keyed on the tag
 * namespace and source segment of the URN (`urn:tag:<namespace>:<source>:…`).
 *
 * Reviewed and KEPT (not operational): `amenity:qloo` and other `:qloo` concept namespaces (curated
 * concepts such as lifestyle, aesthetic, customer segment, industry), media/music/person genres and
 * media keywords (noisy, but they describe taste, not venue operations). Keeping a signal does not
 * assert it is meaningful; it asserts it is not venue metadata.
 */
import type { ExcludedSignal, TagFilterReport } from "@cultural-elasticity/shared";
import type { CulturalProfile, CulturalSignal } from "../evidence/schema.js";

export const OPERATIONAL_TAG_POLICY_VERSION = "operational-tags-v1";

export type OperationalRule = { id: string; namespace: string; source: string | "*"; matches: string; reason: string };

export const OPERATIONAL_TAG_RULES: readonly OperationalRule[] = [
  { id: "payment", namespace: "credit_card", source: "*", matches: "urn:tag:credit_card:*", reason: "payment method accepted at a venue (e.g. VISA)" },
  { id: "venue_rating", namespace: "hotel_rating", source: "*", matches: "urn:tag:hotel_rating:*", reason: "star rating of a lodging venue" },
  { id: "menu_item", namespace: "specialty_dish", source: "*", matches: "urn:tag:specialty_dish:*", reason: "menu dish served at a venue" },
  { id: "price_descriptor", namespace: "cost_description", source: "*", matches: "urn:tag:cost_description:*", reason: "venue price descriptor (e.g. Expensive), not a brand positioning statement" },
  {
    id: "venue_listing_badge",
    namespace: "inclusivity",
    source: "place",
    matches: "urn:tag:inclusivity:place:*",
    reason: "ownership badge of a venue listing; observed on nearly every live brand profile regardless of brand culture",
  },
  { id: "venue_category", namespace: "genre", source: "place", matches: "urn:tag:genre:place:*", reason: "category of a venue listing (e.g. Restaurant, Shopping mall, Tourist attraction)" },
  { id: "venue_facility", namespace: "amenity", source: "place", matches: "urn:tag:amenity:place:*", reason: "facility of a venue listing" },
  { id: "venue_offering", namespace: "offerings", source: "place", matches: "urn:tag:offerings:place:*", reason: "service offered at a venue listing" },
  { id: "venue_service_option", namespace: "service_option", source: "place", matches: "urn:tag:service_option:place:*", reason: "service option of a venue listing (e.g. takeout)" },
];

/** `urn:tag:<namespace>:<source>:…` → namespace and source. Uses the declared category when present. */
export function tagNamespace(signal: Pick<CulturalSignal, "id" | "category">): { namespace: string; source: string } | undefined {
  for (const candidate of [signal.category, signal.id]) {
    if (candidate === undefined) continue;
    const parts = candidate.split(":");
    if (parts[0] === "urn" && parts[1] === "tag" && parts[2] && parts[3]) return { namespace: parts[2], source: parts[3] };
  }
  return undefined;
}

export function matchOperationalRule(signal: Pick<CulturalSignal, "id" | "category">): OperationalRule | undefined {
  const ns = tagNamespace(signal);
  if (ns === undefined) return undefined;
  return OPERATIONAL_TAG_RULES.find((rule) => rule.namespace === ns.namespace && (rule.source === "*" || rule.source === ns.source));
}

export type FilteredProfile = {
  /** The RAW profile, untouched. */
  raw: CulturalProfile;
  /** Same subject and provenance; only the kept signals. */
  filtered: CulturalProfile;
  keptSignals: CulturalSignal[];
  excludedSignals: ExcludedSignal[];
  policyVersion: typeof OPERATIONAL_TAG_POLICY_VERSION;
};

export function applyOperationalTagPolicy(profile: CulturalProfile): FilteredProfile {
  const keptSignals: CulturalSignal[] = [];
  const excludedSignals: ExcludedSignal[] = [];
  for (const signal of profile.signals) {
    const rule = matchOperationalRule(signal);
    if (rule === undefined) keptSignals.push(signal);
    else excludedSignals.push({ signal: { id: signal.id, label: signal.label, ...(signal.category !== undefined && { category: signal.category }) }, reason: rule.reason, rule: rule.id });
  }
  return { raw: profile, filtered: { ...profile, signals: keptSignals }, keptSignals, excludedSignals, policyVersion: OPERATIONAL_TAG_POLICY_VERSION };
}

export function tagFilterReport(filtered: FilteredProfile): TagFilterReport {
  return {
    policyVersion: filtered.policyVersion,
    profileSubjectId: filtered.raw.subject.id,
    rawCount: filtered.raw.signals.length,
    keptCount: filtered.keptSignals.length,
    excluded: filtered.excludedSignals,
  };
}

export function policyDescription() {
  return { version: OPERATIONAL_TAG_POLICY_VERSION, rules: OPERATIONAL_TAG_RULES.map(({ id, matches, reason }) => ({ id, matches, reason })) };
}
