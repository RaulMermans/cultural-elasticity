/**
 * Presentation adapter for a validated brand baseline result (0.2, or legacy 0.1).
 *
 * It reorganises the server's canonical result for reading. It never adds evidence, never scores, never ranks
 * by opportunity and never mutates the input: every connection and direction keeps its source reference.
 * The only classification it applies is `research-position/v1`, which is deliberately conservative:
 *
 * - Qloo evidence alone never makes a direction "adjacent". A tag ID differing from the brand's category tags
 *   says nothing about cultural distance, so without user context every direction stays "relation not
 *   established" (or "unresolved" when its source response was incomplete).
 * - The brand core is shown only from Qloo's own category tags for the brand (BRAND_CLASSIFICATION).
 * - A user may record their own context ("already part of the brand" / "a new direction"). It is labelled as
 *   theirs everywhere it appears, and it never changes evidence, strength or limitations.
 */
import {
  BRAND_BASELINE_SCHEMA_VERSION,
  type AnyBrandBaselineResult,
  type BaselineEvidenceRef,
  type BaselineSignal,
  type BaselineTypeEvidence,
  type BrandBaselineResult,
} from "@cultural-elasticity/shared";
import {
  POSITION_COPY,
  connectionContextCopy,
  coverageCopy,
  domainWords,
  evidenceStrengthCopy,
  facetWords,
  scanStatusCopy,
  tagRoleCopy,
  typeEvidenceCopy,
  type StatusTone,
} from "./research-copy.ts";

export const RESEARCH_POSITION_RULE = "research-position/v1" as const;

export type Origin = "recorded" | "live";
export type UserPosition = "unsure" | "current" | "new";
/** Keyed by a direction's canonical concept. Only the user writes it. */
export type UserContext = Record<string, UserPosition>;
export type PositionCategory = keyof typeof POSITION_COPY;

export type ConnectionView = {
  key: string;
  id: string;
  name: string;
  kind: "entity" | "tag";
  domain: string;
  group: "association" | "taste" | "keyword" | "category";
  contextLine: string;
  reason: string;
  observed: string[];
  meaning: string;
  cannotConclude: string[];
  next: string;
  typeEvidence: BaselineTypeEvidence | null;
  possibleDuplicateOf: string | null;
  source: BaselineEvidenceRef;
  grounding: BaselineSignal["grounding"] | null;
  facet: string | null;
};

export type DirectionView = {
  key: string;
  id: string;
  name: string;
  canonicalConcept: string;
  category: PositionCategory;
  categoryLabel: string;
  categoryBasis: "evidence" | "user";
  userPosition: UserPosition;
  why: string;
  observed: string[];
  meaning: string;
  signals: string[];
  strength: string;
  partial: boolean;
  unknown: string[];
  relation: string;
  nextQuestion: string;
  refs: BaselineEvidenceRef[];
  linkedConnectionKey: string | null;
};

export type Collection = { domain: string; title: string; qualifier: string; items: ConnectionView[] };
export type Outcome = { kind: "directions" | "user-directions" | "connections-only" | "insufficient" | "empty"; headline: string; detail: string };

export type ResearchView = {
  scanId: string;
  legacy: boolean;
  brand: { name: string; qlooId: string };
  origin: Origin;
  capturedAt: string;
  finishedAt: string;
  derivedFrom: { scanId: string; schemaVersion: string; note: string } | null;
  status: { code: string; label: string; tone: StatusTone };
  objective: string;
  outcome: Outcome;
  core: { verified: boolean; categories: ConnectionView[]; note: string };
  tasteTags: ConnectionView[];
  keywords: ConnectionView[];
  themes: { label: string; members: string[] }[];
  collections: Collection[];
  coverage: { domain: string; title: string; text: string; status: string }[];
  directions: DirectionView[];
  unresolved: { title: string; detail: string }[];
  uncertainties: string[];
  nextSteps: string[];
  /** Why discovery found no direction, from the server. Empty when it found some. */
  noDirectionReasons: string[];
  setAside: { name: string; reason: string }[];
  method: {
    templateVersion: string;
    discoveryRule: string | null;
    themeRule: string | null;
    positionRule: typeof RESEARCH_POSITION_RULE;
    providerCallCount: number;
    sources: BaselineEvidenceRef[];
    audit: BrandBaselineResult["audit"] | null;
  };
  connections: ConnectionView[];
};

const list = (items: string[]) => items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
const count = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;
export const connectionKey = (signal: Pick<BaselineSignal, "domain" | "id">) => `${signal.domain}:${signal.id}`;

/**
 * How many results the same Qloo call returned, including results set aside: positions are only meaningful
 * within one call.
 */
function callSize(returned: { source: BaselineEvidenceRef }[], ref: BaselineEvidenceRef): number {
  return returned.filter((item) => item.source.correlationId === ref.correlationId).length;
}

function entityConnection(signal: BaselineSignal, all: { source: BaselineEvidenceRef }[], brand: string): ConnectionView {
  const words = domainWords(signal.domain);
  const typeEvidence = signal.grounding?.typeEvidence ?? null;
  const size = callSize(all, signal.source);
  const reason = `Qloo returned ${signal.name} at position ${signal.rankWithinCall} of ${size} when asked for ${words.plural} related to ${brand}.`;
  const cannot = [
    `Why ${signal.name} and ${brand} are linked, or how strong the link is.`,
    `That ${brand}'s customers know or like ${signal.name}.`,
    "That its place in Qloo's list ranks importance or opportunity. Qloo's order is not a recommendation.",
  ];
  if (typeEvidence === "QUERY_SCOPED") cannot.push(`That Qloo confirmed ${signal.name} individually as ${words.article} ${words.singular}.`);
  if (typeEvidence === "GENERIC_TYPE_UNRESOLVED") cannot.push("What kind of result this is.");
  return {
    key: connectionKey(signal), id: signal.id, name: signal.name, kind: "entity", domain: signal.domain, group: "association",
    contextLine: connectionContextCopy(typeEvidence ?? undefined, signal.domain),
    reason,
    observed: [reason, typeEvidenceCopy(typeEvidence ?? undefined, signal.domain)],
    meaning: `Qloo's taste data links ${signal.name} with ${brand}. It may be a shared cultural reference worth exploring.`,
    cannotConclude: cannot,
    next: `Check whether the related ${words.plural} share a genre or scene. This research did not collect tags for them, so that needs a new research step.`,
    typeEvidence, possibleDuplicateOf: null, source: signal.source, grounding: signal.grounding ?? null, facet: null,
  };
}

function tagConnection(signal: BaselineSignal, all: { source: BaselineEvidenceRef }[], brand: string, names: Map<string, string>): ConnectionView {
  const size = callSize(all, signal.source);
  const role = signal.role;
  const group = role === "BRAND_CLASSIFICATION" ? "category" : role === "DESCRIPTIVE_KEYWORD" ? "keyword" : "taste";
  const reason = `Qloo's tag profile for ${brand} includes “${signal.name}”, at position ${signal.rankWithinCall} of ${size} in Qloo's order.`;
  const meaning = group === "category"
    ? `Qloo uses this tag to categorise ${brand} itself. It describes the brand's own category, not a new direction.`
    : group === "keyword"
      ? `A loose descriptive keyword Qloo attached to ${brand}. Keywords are not a curated category, so treat it as a clue rather than a theme.`
      : `Qloo associates this cultural tag with ${brand}. It may point to a cultural theme worth researching.`;
  const duplicate = signal.possibleDuplicateOf ? names.get(signal.possibleDuplicateOf) ?? null : null;
  const observed = [reason, `${tagRoleCopy(role)} (${facetWords(signal.facet).toLowerCase()}).`];
  if (duplicate) observed.push(`It may repeat “${duplicate}”. They are kept apart and not counted twice.`);
  return {
    key: connectionKey(signal), id: signal.id, name: signal.name, kind: "tag", domain: "tags", group,
    contextLine: group === "category" ? "How Qloo categorises the brand" : `${facetWords(signal.facet)} · cultural tag`,
    reason, observed, meaning,
    cannotConclude: [
      `How strongly “${signal.name}” is associated with ${brand} compared with other brands.`,
      `Whether ${brand}'s customers share this interest.`,
      "That its position in the tag list measures strength. It is Qloo's order.",
    ],
    next: group === "category"
      ? `Use it as context when judging whether a direction is new for ${brand}.`
      : `Test “${signal.name}” in a deep investigation that compares ${brand} with comparable references.`,
    typeEvidence: null, possibleDuplicateOf: duplicate, source: signal.source, grounding: null, facet: signal.facet ?? null,
  };
}

function legacyConnection(signal: BaselineSignal, brand: string): ConnectionView {
  const words = domainWords(signal.domain);
  return {
    key: connectionKey(signal), id: signal.id, name: signal.name, kind: signal.kind, domain: signal.domain, group: signal.kind === "tag" ? "taste" : "association",
    contextLine: signal.kind === "tag" ? "Cultural tag · earlier method" : `Returned when researching related ${words.plural}`,
    reason: `Recorded by an earlier version of the research for ${brand}, at position ${signal.rankWithinCall} in Qloo's order.`,
    observed: [`Recorded by an earlier version of the research for ${brand}.`, "The earlier method did not record how Qloo classified this result."],
    meaning: `Qloo linked ${signal.name} with ${brand} in this earlier research.`,
    cannotConclude: [`Why ${signal.name} and ${brand} are linked, or how strong the link is.`, "How this result was classified."],
    next: `Run new research for ${brand} with the current method when it is available.`,
    typeEvidence: null, possibleDuplicateOf: null, source: signal.source, grounding: null, facet: signal.facet ?? null,
  };
}

function classify(input: { partial: boolean; possibleDuplicate: boolean; user: UserPosition }): { category: PositionCategory; basis: "evidence" | "user" } {
  if (input.user === "current") return { category: "ESTABLISHED", basis: "user" };
  if (input.user === "new") return { category: "ADJACENT", basis: "user" };
  if (input.partial || input.possibleDuplicate) return { category: "UNRESOLVED", basis: "evidence" };
  return { category: "OBSERVED", basis: "evidence" };
}

function relationCopy(category: PositionCategory, basis: "evidence" | "user", brand: string, name: string, coreNames: string[]): string {
  if (basis === "user" && category === "ESTABLISHED") return `You marked “${name}” as already part of ${brand}'s current position. That is your context, not Qloo evidence.`;
  if (basis === "user" && category === "ADJACENT") return `You marked “${name}” as a new direction for ${brand}. That is your context, not Qloo evidence.`;
  if (coreNames.length) return `Qloo categorises ${brand} as ${list(coreNames.map((item) => `“${item}”`))}. Whether “${name}” sits inside that position or beyond it has not been checked.`;
  return `Not established. Qloo returned no category tags for ${brand} in this research, so it can't tell the brand's current position apart from a new direction.`;
}

export function positionLabel(category: PositionCategory, basis: "evidence" | "user"): string {
  const label = POSITION_COPY[category].label;
  return basis === "user" ? `${label} (your context)` : label;
}

export function buildResearchView(result: AnyBrandBaselineResult, user: UserContext = {}): ResearchView {
  const brand = result.brand.name;
  const legacy = result.schemaVersion !== BRAND_BASELINE_SCHEMA_VERSION;
  const signals = result.fingerprint.signals;
  const names = new Map(signals.map((signal) => [signal.id, signal.name]));
  const returned = [...signals, ...(legacy ? [] : (result as BrandBaselineResult).fingerprint.excluded)];
  const connections = signals.map((signal) => legacy ? legacyConnection(signal, brand) : signal.kind === "entity" ? entityConnection(signal, returned, brand) : tagConnection(signal, returned, brand, names));
  const tags = connections.filter((item) => item.kind === "tag");
  const categories = tags.filter((item) => item.group === "category");
  const coreNames = categories.map((item) => item.name);
  const v2 = legacy ? null : result as BrandBaselineResult;

  const domains = [...new Set(connections.filter((item) => item.kind === "entity").map((item) => item.domain))];
  const collections: Collection[] = domains.map((domain) => {
    const items = connections.filter((item) => item.kind === "entity" && item.domain === domain);
    const words = domainWords(domain);
    const kinds = new Set(items.map((item) => item.typeEvidence));
    const qualifier = legacy
      ? `${words.title} recorded by an earlier version of the research.`
      : kinds.size === 1 && kinds.has("PROVIDER_CONFIRMED_TYPE")
        ? `Qloo identifies each of these as ${words.article} ${words.singular}.`
        : kinds.has("GENERIC_TYPE_UNRESOLVED")
          ? "Qloo did not confirm what kind of result these are."
          : `Returned when researching related ${words.plural}. Qloo did not confirm each result's type individually.`;
    return { domain, title: `${words.title} returned by Qloo`, qualifier, items };
  });

  const directions: DirectionView[] = result.territories.map((territory) => {
    const v2Territory = "explanation" in territory ? territory : null;
    const partial = territory.evidenceStatus === "PARTIAL_EVIDENCE";
    const linked = signals.find((signal) => signal.id === territory.canonicalConcept) ?? null;
    const possibleDuplicate = Boolean(linked?.possibleDuplicateOf);
    const userPosition = user[territory.canonicalConcept] ?? "unsure";
    const { category, basis } = classify({ partial, possibleDuplicate, user: userPosition });
    const unknown = [...territory.limitations];
    if (partial) unknown.push("The Qloo response behind it was incomplete, so it may change when the research is repeated.");
    if (possibleDuplicate) unknown.push(`It may repeat another tag (“${names.get(linked!.possibleDuplicateOf!)}”).`);
    if (basis === "evidence") unknown.push(coreNames.length ? `Whether it is new for ${brand} or already part of its position.` : `Whether it is new for ${brand}: its current cultural position is not verified.`);
    unknown.push("Whether it would be credible or commercially useful. No method here measures that.");
    const why = v2Territory?.explanation ?? "Recorded by an earlier version of the research. Why it appeared was not recorded.";
    const signalsSeen = territory.supportingReferences.map((ref) => ref.operation === "entity_tags" ? `Qloo's tag profile for ${brand}` : ref.operation === "recommend" ? `Related ${domainWords(ref.scope).plural} for ${brand}` : `Qloo's description of ${brand}`);
    return {
      key: territory.id,
      id: territory.id,
      name: territory.name,
      canonicalConcept: territory.canonicalConcept,
      category,
      categoryLabel: positionLabel(category, basis),
      categoryBasis: basis,
      userPosition,
      why,
      observed: [why, ...signalsSeen.map((source) => `Source: ${source}. ${evidenceStrengthCopy(territory.evidenceStatus)}.`)],
      meaning: `“${territory.name}” could be a cultural direction to research for ${brand}. It is a research direction, not a validated finding or a recommendation.`,
      signals: signalsSeen,
      strength: evidenceStrengthCopy(territory.evidenceStatus),
      partial,
      unknown,
      relation: relationCopy(category, basis, brand, territory.name, coreNames),
      nextQuestion: v2Territory?.nextInvestigation ?? `Research “${territory.name}” for ${brand} with the current method.`,
      refs: territory.supportingReferences,
      linkedConnectionKey: linked ? connectionKey(linked) : null,
    };
  });

  const entityCount = connections.filter((item) => item.kind === "entity").length;
  const status = scanStatusCopy(result.scanStatus);
  const found = [...collections.map((item) => { const words = domainWords(item.domain); return count(item.items.length, words.singular, words.plural); }), ...(tags.length ? [count(tags.length, "cultural tag", "cultural tags")] : [])];
  const outcome = outcomeOf({ brand, status: result.scanStatus, entityCount, tagCount: tags.length, found, directions, coreVerified: categories.length > 0 });

  const unresolved: { title: string; detail: string }[] = [];
  if (!categories.length && !legacy) unresolved.push({ title: `${brand}'s current cultural position`, detail: `Qloo returned no category tags for ${brand} in this research, so directions can't be sorted into existing and new. You can add your own context to each direction.` });
  const ungrouped = collections.filter((collection) => collection.items.length >= 2).map((collection) => { const words = domainWords(collection.domain); return count(collection.items.length, words.singular, words.plural); });
  if (ungrouped.length) unresolved.push({ title: `What links the ${list(ungrouped)}`, detail: "Whether they share a genre, scene or style is unknown. This research did not collect tags for them, so they can't be grouped yet." });
  for (const direction of directions.filter((item) => item.category === "UNRESOLVED")) unresolved.push({ title: direction.name, detail: direction.partial ? "Its Qloo response was incomplete, so it is not yet a stable direction." : "It may repeat another tag, so it is not counted as a separate direction." });
  for (const coverage of result.fingerprint.domainCoverage.filter((item) => item.status === "EMPTY" || item.status === "UNAVAILABLE")) {
    const words = domainWords(coverage.domain);
    unresolved.push({ title: `No ${words.plural}`, detail: coverage.status === "EMPTY" ? `Qloo returned no ${words.plural} for ${brand}. That is missing evidence, not a sign that there is no connection.` : `${words.title} were not available in this research.` });
  }

  return {
    scanId: result.scanId,
    legacy,
    brand: { name: brand, qlooId: result.brand.qlooId },
    origin: result.execution.recordedOrLive,
    capturedAt: result.brand.source.capturedAt,
    finishedAt: result.execution.finishedAt,
    derivedFrom: v2?.execution.derivedFrom ?? null,
    status: { code: result.scanStatus, ...status },
    objective: `Which cultural associations does Qloo show for ${brand}, and which of them deserve deeper research?`,
    outcome,
    core: {
      verified: categories.length > 0,
      categories,
      note: categories.length
        ? `Qloo categorises ${brand} as ${list(coreNames.map((item) => `“${item}”`))}. These describe the brand itself, not new directions.`
        : `Not verified. Qloo returned no category tags for ${brand} in this research, so its existing position is not established from evidence.`,
    },
    tasteTags: tags.filter((item) => item.group === "taste"),
    keywords: tags.filter((item) => item.group === "keyword"),
    themes: (v2?.fingerprint.themes ?? []).map((theme) => ({ label: theme.label, members: [...theme.memberIds, ...theme.possibleDuplicateIds].map((id) => names.get(id) ?? "Unnamed tag") })),
    collections,
    coverage: result.fingerprint.domainCoverage.map((item) => ({
      domain: item.domain,
      title: domainWords(item.domain).title,
      text: item.domain === "tags" && !legacy && item.status === "OBSERVED" ? `${item.entityCount} returned, ${tags.length} kept as cultural` : coverageCopy(item.status, item.entityCount, item.domain),
      status: item.status,
    })),
    directions,
    unresolved,
    uncertainties: result.fingerprint.limitations,
    nextSteps: v2?.discovery.nextSteps ?? [],
    noDirectionReasons: v2?.discovery.reasons ?? [],
    setAside: (v2?.fingerprint.excluded ?? []).map((item) => ({ name: item.name, reason: item.reason })),
    method: {
      templateVersion: result.execution.templateVersion,
      discoveryRule: v2?.discovery.rule ?? null,
      themeRule: v2?.discovery.themeRule ?? null,
      positionRule: RESEARCH_POSITION_RULE,
      providerCallCount: result.execution.providerCallCount,
      sources: [...new Map(result.fingerprint.provenance.map((ref) => [ref.correlationId, ref])).values()],
      audit: v2?.audit ?? null,
    },
    connections,
  };
}

function outcomeOf(input: { brand: string; status: string; entityCount: number; tagCount: number; found: string[]; directions: DirectionView[]; coreVerified: boolean }): Outcome {
  const { brand, entityCount, tagCount, found, directions } = input;
  if (input.status === "INSUFFICIENT_EVIDENCE" || (!entityCount && !tagCount)) {
    return { kind: entityCount || tagCount ? "insufficient" : "empty", headline: "Qloo didn't return enough cultural evidence for a profile.", detail: `This is missing evidence, not a finding about ${brand}. The research can be repeated, or a deep investigation can look elsewhere.` };
  }
  const chosen = directions.filter((item) => item.category === "ADJACENT");
  if (chosen.length) return { kind: "user-directions", headline: `${count(chosen.length, "direction", "directions")} you marked as new can be researched further.`, detail: `Qloo returned ${list(found)} for ${brand}. Your marks are your context, not Qloo evidence, and no direction is validated yet.` };
  if (!directions.length) return { kind: "connections-only", headline: "We found cultural connections, but not enough evidence for a new direction.", detail: `Qloo returned ${list(found)} for ${brand}. None of them supports a specific research direction on its own yet.` };
  return {
    kind: "directions",
    headline: `We found cultural connections and ${count(directions.length, "possible direction", "possible directions")} to research further.`,
    detail: input.coreVerified
      ? `Qloo returned ${list(found)} for ${brand}. No direction is established as new yet: each one still needs to be compared with the brand's own category.`
      : `Qloo returned ${list(found)} for ${brand}. No direction is established as new: Qloo returned no category tags for ${brand}, so its current position is not verified.`,
  };
}
