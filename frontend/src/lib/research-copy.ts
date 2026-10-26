/**
 * Every user-facing string for brand research states lives here. Components never print a backend code.
 * Unknown codes get a neutral fallback and are never given an invented meaning. Canonical values are not mutated.
 */

export type DomainWords = { singular: string; plural: string; title: string; article: "a" | "an" };

const DOMAINS: Record<string, DomainWords> = {
  artist: { singular: "artist", plural: "artists", title: "Artists", article: "an" },
  place: { singular: "place", plural: "places", title: "Places", article: "a" },
  movie: { singular: "film", plural: "films", title: "Films", article: "a" },
  book: { singular: "book", plural: "books", title: "Books", article: "a" },
  tv_show: { singular: "TV show", plural: "TV shows", title: "TV shows", article: "a" },
  podcast: { singular: "podcast", plural: "podcasts", title: "Podcasts", article: "a" },
  tags: { singular: "cultural tag", plural: "cultural tags", title: "Cultural tags", article: "a" },
};

export function domainWords(domain: string): DomainWords {
  return DOMAINS[domain] ?? { singular: "related result", plural: "related results", title: "Related results", article: "a" };
}

/** Facet label from the tag URN facet only (mirrors the backend rule), never from the tag name. */
export function facetWords(facet: string | undefined): string {
  if (!facet) return "Cultural tag";
  const [namespace = "", source = ""] = facet.split(":");
  const human = (value: string) => value.replaceAll("_", " ").replace(/^\p{L}/u, (letter) => letter.toUpperCase());
  if (!namespace) return "Cultural tag";
  if (source === "qloo") return namespace === "keyword" ? "Curated keywords" : human(namespace);
  const noun = namespace === "genre" ? "genres" : namespace === "keyword" ? "keywords" : namespace.replaceAll("_", " ");
  return source ? `${human(source)} ${noun}` : human(noun);
}

export type StatusTone = "complete" | "gaps" | "insufficient" | "working" | "stopped";

const SCAN_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  CREATED: { label: "Preparing the research", tone: "working" },
  QUEUED: { label: "Waiting to start", tone: "working" },
  RUNNING: { label: "Researching", tone: "working" },
  COMPLETE: { label: "Research complete", tone: "complete" },
  PARTIAL: { label: "Research complete, with gaps", tone: "gaps" },
  NEEDS_BRAND_CONFIRMATION: { label: "Waiting for you to confirm the brand", tone: "working" },
  INSUFFICIENT_EVIDENCE: { label: "Not enough evidence for a profile", tone: "insufficient" },
  INTERRUPTED: { label: "Research was interrupted before it finished", tone: "stopped" },
  FAILED: { label: "Research could not finish", tone: "stopped" },
  CANCELLED: { label: "Research was cancelled", tone: "stopped" },
};

export function scanStatusCopy(status: string): { label: string; tone: StatusTone } {
  return SCAN_STATUS[status] ?? { label: "Research status unknown", tone: "working" };
}

export const TERMINAL_SCAN_STATUSES = new Set(["COMPLETE", "PARTIAL", "INSUFFICIENT_EVIDENCE", "INTERRUPTED", "FAILED", "CANCELLED"]);

const STAGES: Record<string, string> = {
  identity: "Confirming the brand",
  tags: "Reading cultural tags",
  artist: "Finding related artists",
  place: "Finding related places",
  movie: "Finding related films",
  book: "Finding related books",
  normalize: "Organising the results",
  discover: "Looking for research directions",
  validate: "Checking the evidence",
  validation: "Checking the evidence",
};
const STAGE_STATUS: Record<string, string> = { PENDING: "not started", RUNNING: "in progress", COMPLETE: "done", SKIPPED: "skipped", FAILED: "not available", UNCERTAIN: "not available" };

export function stageCopy(stage: string, status: string): string {
  return `${STAGES[stage] ?? "Research step"}: ${STAGE_STATUS[status] ?? "in progress"}`;
}

const COVERAGE: Record<string, string> = {
  OBSERVED: "returned",
  EMPTY: "Qloo returned none",
  PARTIAL: "incomplete response",
  DEGRADED: "lower-quality response",
  UNAVAILABLE: "not available in this research",
};

export function coverageCopy(status: string, count: number, domain: string): string {
  const words = domainWords(domain);
  if (status === "OBSERVED") return `${count} ${count === 1 ? words.singular : words.plural} returned`;
  if (status === "PARTIAL" || status === "DEGRADED") return `${count} ${count === 1 ? words.singular : words.plural}, ${COVERAGE[status]}`;
  return COVERAGE[status] ?? "status unknown";
}

const STRENGTH: Record<string, string> = {
  OBSERVED_ASSOCIATION: "Seen once in Qloo's evidence",
  PARTIAL_EVIDENCE: "Seen in an incomplete Qloo response",
  MULTI_SIGNAL_SUPPORT: "Seen in more than one Qloo response",
};

export function evidenceStrengthCopy(status: string): string {
  return STRENGTH[status] ?? "Evidence status not recognised";
}

const TYPE_EVIDENCE: Record<string, (words: DomainWords) => string> = {
  PROVIDER_CONFIRMED_TYPE: (words) => `Qloo identifies this as ${words.article} ${words.singular}.`,
  QUERY_SCOPED: (words) => `Returned when researching related ${words.plural}. Qloo did not confirm its type individually.`,
  GENERIC_TYPE_UNRESOLVED: () => "Qloo did not confirm what kind of result this is.",
  CONFLICTING_TYPE: (words) => `Qloo's type for this result conflicts with the search for ${words.plural}, so it was set aside.`,
};

export function typeEvidenceCopy(code: string | undefined, domain: string): string {
  const words = domainWords(domain);
  return code && TYPE_EVIDENCE[code] ? TYPE_EVIDENCE[code](words) : "How Qloo classified this result was not recorded.";
}

/** The short label under a connection name. */
export function connectionContextCopy(code: string | undefined, domain: string): string {
  const words = domainWords(domain);
  if (code === "PROVIDER_CONFIRMED_TYPE") return `${words.title.replace(/s$/u, "")} · identified by Qloo`;
  if (code === "QUERY_SCOPED") return `Returned when researching related ${words.plural}`;
  return "Kind of result not confirmed";
}

const ROLE: Record<string, string> = {
  AUDIENCE_TASTE: "Cultural tag Qloo associates with the brand",
  BRAND_CLASSIFICATION: "How Qloo categorises the brand itself",
  DESCRIPTIVE_KEYWORD: "Descriptive keyword",
};

export function tagRoleCopy(role: string | undefined): string {
  return role && ROLE[role] ? ROLE[role] : "Cultural tag";
}

export type BrandResearchAvailability = "checking" | "available" | "paused" | "unavailable";

export function availabilityCopy(status: BrandResearchAvailability): { label: string; detail: string } {
  switch (status) {
    case "available":
      return { label: "New brand research available.", detail: "Research runs a short, fixed set of Qloo lookups for the brand you confirm." };
    case "paused":
      return { label: "New research is temporarily unavailable.", detail: "The research service is connected, but it is not accepting new brand research right now. Recorded research still opens instantly." };
    case "unavailable":
      return { label: "The research service can't be reached right now.", detail: "New research can't start. Recorded research still opens, because it is stored with the product." };
    default:
      return { label: "Checking whether new research is available.", detail: "Recorded research is available while we check." };
  }
}

const API_ERRORS: Record<string, string> = {
  baseline_paused: "New research is temporarily unavailable.",
  baseline_unavailable: "The research service can't be reached right now. Please try again later.",
  unauthorized: "This research can't be opened from here.",
  not_found: "This research is no longer available, or it belongs to another session.",
  invalid_brand_request: "Enter a brand name between 2 and 200 characters.",
  invalid_baseline_request: "The research could not start. Please confirm the brand again.",
  idempotency_conflict: "This research request was already used. Please confirm the brand again.",
  scan_in_progress: "Research for this brand is already in progress.",
  resolution_invalid_or_stale: "The brand confirmation expired. Please search for the brand again.",
  request_too_large: "That request is too long.",
};

/** API error bodies carry a code; this turns it into a sentence. Limits share one message. */
export function apiErrorCopy(code: unknown): string {
  if (typeof code !== "string") return "Something went wrong. Please try again later.";
  if (code.includes("limit")) return "The research allowance for now has been used. Please try again later.";
  return API_ERRORS[code] ?? "Something went wrong. Please try again later.";
}

export const RESOLUTION_COPY: Record<string, string> = {
  NOT_FOUND: "Qloo did not recognise this as a brand. Try the brand's full name.",
  TEMPORARILY_UNAVAILABLE: "Brand lookup is temporarily unavailable. Please try again later.",
  AMBIGUOUS: "Qloo found more than one brand with this name. Choose the one you mean.",
};

export const POSITION_COPY = {
  ESTABLISHED: { label: "Part of the brand's current position", short: "Current position" },
  ADJACENT: { label: "Adjacent research direction", short: "Adjacent direction" },
  OBSERVED: { label: "Observed association, relation to the brand not established", short: "Relation not established" },
  UNRESOLVED: { label: "Unresolved direction", short: "Unresolved" },
} as const;

export const USER_POSITION_COPY = {
  unsure: "Not sure",
  current: "Already part of the brand",
  new: "A new direction",
} as const;
export const hypothesisOutcomeCopy = {
  WORTH_FURTHER_INVESTIGATION: "Worth further investigation",
  INCONCLUSIVE: "Inconclusive",
  NOT_SUPPORTED_BY_CURRENT_EVIDENCE: "Not supported by current evidence",
  UNABLE_TO_COMPLETE_RESEARCH: "Research could not be completed",
} as const;
