/**
 * A plain-language reading of one territory in one run, for people who do not know the methodology. Every value is
 * read from the deterministic result (class, ranks, robustness, shared signals, conditioned evidence, exemplars);
 * nothing is computed, estimated or ranked here. Sentences restate those values; none forecasts commercial outcomes.
 */
import { decisionCard, nonTautologicalSignals, researchAssessmentOf, type AgentRunResponse, type AgentTerritoryResult, type DecisionCard, type DecisionCardContext, type OpportunityView } from "@cultural-elasticity/shared";

export type FitStep = "NATURAL_ADJACENCY" | "CREDIBLE_STRETCH" | "CULTURAL_BREAK";

export const FIT_STEPS: { code: FitStep; label: string }[] = [
  { code: "NATURAL_ADJACENCY", label: "Natural fit" },
  { code: "CREDIBLE_STRETCH", label: "Credible stretch" },
  { code: "CULTURAL_BREAK", label: "Cultural break" },
];

export type TerritoryReading = {
  name: string;
  /** Sprint 12: the user's question, which the research conclusion answers. */
  question: string | null;
  fit: { code: string; label: string; onScale: FitStep | null; meaning: string } | null;
  steadiness: { steady: boolean; text: string } | null;
  /** The comparison, in the methodology's order (1 is the strongest association within the set). */
  compared: { name: string; position: number; current: boolean }[];
  sharedTastes: string[];
  closestMatches: string[];
  examples: string[];
  concept: string | null;
  unknowns: string[];
  technical: string[];
  /** Sprint 9N: the Strategic Decision Card for this territory (the same projection the report uses). */
  decision: DecisionCard | null;
  /** Sprint 10A: for a discovered direction, why it surfaced and what its evidence status is (null otherwise). */
  surfaced: SurfacedReading | null;
};

export type SurfacedReading = {
  status: string;
  statusText: string;
  signals: string[];
  domain: string | null;
  /** The agent's own reading of the signals. Shown as interpretation, never as evidence. */
  interpretation: string | null;
  unknowns: string[];
  next: string | null;
};

const STATUS_COPY: Record<string, { label: string; text: string }> = {
  OBSERVED_ASSOCIATION: { label: "Observed association", text: "Qloo returned it for the brand. It has not been tested as a territory." },
  UNVALIDATED_HYPOTHESIS: { label: "Hypothesis", text: "Proposed in this investigation. Qloo support was not tested before it ended." },
  QLOO_SUPPORTED: { label: "Supported by Qloo, not measured", text: "Qloo returns entities for this concept on its own, so it can be investigated. How far the brand extends into it is not measured." },
  RELATIVELY_MEASURED: { label: "Measured", text: "Placed against other territories in one Qloo comparison. The position holds only within that comparison." },
  UNSUPPORTED: { label: "Not supported by Qloo", text: "Qloo returned no entities for the concept tried, or it was not a cultural territory." },
  DUPLICATE: { label: "Merged with a similar direction", text: "It repeated another direction, so it was not counted twice." },
  UNMEASURABLE: { label: "Found, but not measurable yet", text: "Qloo returns entities for it, but no sound set of examples could be built to measure it." },
  INCONCLUSIVE: { label: "Not settled", text: "The investigation ended before this direction was tested." },
};

function surfacedReading(opportunity: OpportunityView | undefined, brand: string): SurfacedReading | null {
  if (!opportunity) return null;
  const copy = STATUS_COPY[opportunity.blocker ?? opportunity.status] ?? { label: "Not settled", text: "" };
  const relation = (kind: string) => kind === "SEED_ENTITY_TAG" || kind === "BRAND_CONDITIONED_ENTITY" ? `returned for ${brand} in the brand scan` : kind === "BRAND_PROFILE_TAG" ? `on ${brand}'s own Qloo profile` : `a brand Qloo relates to ${brand}`;
  return {
    status: copy.label,
    statusText: copy.text,
    signals: opportunity.surfacedBy.map((signal) => `${signal.label} (${relation(signal.relation)})`),
    domain: opportunity.domainRelation === "OUTSIDE_BRAND_PROFILE_FACETS" ? `A different kind of Qloo tag from any on ${brand}'s own profile.` : opportunity.domainRelation === "WITHIN_BRAND_PROFILE_FACETS" ? `The same kind of Qloo tag as some on ${brand}'s own profile.` : null,
    interpretation: opportunity.interpretation,
    unknowns: opportunity.unknowns,
    next: opportunity.nextInvestigation,
  };
}

const FIT_LABEL: Record<string, string> = {
  NATURAL_ADJACENCY: "Natural fit",
  CREDIBLE_STRETCH: "Credible stretch",
  CULTURAL_BREAK: "Cultural break",
  UNCERTAIN_REPRESENTATION_SENSITIVE: "Not settled",
  INSUFFICIENT_EVIDENCE: "Not enough evidence",
};

/**
 * Sprint 9M: the agent's validated write-up may name a class by its code. Shown to a reader, the code becomes its
 * plain label; the text itself (and what the claim validator checked) is unchanged.
 */
export function readableClassCodes(text: string): string {
  return text.replace(/\b(NATURAL_ADJACENCY|CREDIBLE_STRETCH|CULTURAL_BREAK|UNCERTAIN_REPRESENTATION_SENSITIVE|INSUFFICIENT_EVIDENCE)\b/gu, (code) => `“${FIT_LABEL[code]!.toLowerCase()}”`);
}

const MEANING: Record<string, (name: string, brand: string) => string> = {
  NATURAL_ADJACENCY: (name, brand) => `Qloo ties ${name} closely to ${brand}'s taste. In this comparison it reads as part of the brand's cultural world.`,
  CREDIBLE_STRETCH: (name, brand) => `Qloo finds real overlap between ${name} and ${brand}'s taste, but not at its centre. A step outward, not a leap.`,
  CULTURAL_BREAK: (name, brand) => `Qloo finds little in common between ${name} and ${brand}'s taste in this comparison. Going there would be a leap.`,
  UNCERTAIN_REPRESENTATION_SENSITIVE: (name) => `Qloo's answer for ${name} changes with the examples used to stand for it, so it can't be called yet.`,
  INSUFFICIENT_EVIDENCE: (name) => `Qloo did not return enough evidence about ${name} to place it.`,
};

/** Plain versions of the limitations people most often meet. Anything else stays in the technical notes. */
const UNKNOWN: Record<string, (name: string, brand: string) => string> = {
  NO_RELATIVE_POSITION: (name) => `${name} wasn't ranked against other territories, so there is no comparison yet.`,
  NO_VALID_REPRESENTATION: (name) => `No solid set of examples could be found to stand for ${name}.`,
  TERRITORY_UNRESOLVED: (name) => `This run found no Qloo tag for ${name} that returns entities.`,
  QLOO_EMPTY: (name) => `One of Qloo's lookups for ${name} came back empty.`,
  NOT_COLLECTED_BUDGET: () => "Some evidence was not collected because the investigation reached its budget.",
  PANEL_CALL_FAILED: () => "One of Qloo's lookups failed, so part of the comparison is missing.",
  PANEL_RANKING_INCOMPLETE: () => "Part of the ranking was incomplete and was left out.",
  CONDITIONED_CALL_FAILED: (name, brand) => `Qloo's ${brand}-specific look at ${name} failed.`,
  EXEMPLAR_PROFILE_NOT_COLLECTED: () => "The taste profile of some examples was not collected.",
  TAG_PROFILES_TRUNCATED_AT_TAKE: () => "Qloo returned more matches than were read, so the picture may be wider than shown.",
  SEMANTIC_COMPARISON_INVALID: () => "The territories compared were not similar enough in kind for a fair ranking.",
};

const unique = (items: (string | null | undefined)[]) => [...new Set(items.filter((item): item is string => Boolean(item && item.trim())))];

type Done = Exclude<AgentRunResponse, { status: "NEEDS_INPUT" }>;

export function territoryReading(result: AgentRunResponse | null | undefined, territoryKey: string | null, brand: string, context: DecisionCardContext = {}): TerritoryReading | null {
  if (!result || result.status === "NEEDS_INPUT") return null;
  const done = result as Done;
  const territory: AgentTerritoryResult | undefined = territoryKey
    ? done.territories.find((item) => item.key === territoryKey)
    : done.territories.length === 1 ? done.territories[0] : done.territories.find((item) => item.role === "target");
  if (!territory) return null;
  const name = territory.label;
  const code = territory.classification?.label ?? null;
  const fit = code ? {
    code,
    label: FIT_LABEL[code] ?? code,
    onScale: FIT_STEPS.some((step) => step.code === code) ? (code as FitStep) : null,
    meaning: MEANING[code]?.(name, brand) ?? "The methodology classified this territory.",
  } : null;
  const level = territory.robustness?.level ?? null;
  const steadiness = !territory.relativePosition?.position ? null
    : level === "HIGH" || level === "MEDIUM" ? { steady: true, text: "Steady: the ranking held across the example sets tested." }
    : level ? { steady: false, text: "Could change: a different set of examples could move this ranking." } : null;
  const inSet = new Set(territory.comparisonSet?.territoryKeys ?? []);
  const compared = done.territories
    .filter((item) => inSet.has(item.key) && item.relativePosition?.position != null)
    .map((item) => ({ name: item.label, position: item.relativePosition!.position!, current: item.key === territory.key }))
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const examples = unique([
    ...territory.representation.exemplars.map((item) => item.label),
    ...(done.layers?.qlooEvidence.exemplars ?? []).filter((item) => item.territoryKey === territory.key).map((item) => item.label),
  ]).slice(0, 8);
  const unknowns = unique(territory.limitations.map((limitation) => UNKNOWN[limitation.code]?.(name, brand)));
  if (!compared.length && !unknowns.some((line) => line.includes("wasn't ranked"))) unknowns.unshift(`${name} wasn't ranked against other territories, so there is no comparison yet.`);
  if (steadiness && !steadiness.steady) unknowns.push("Whether the ranking holds with other examples.");
  // Sprint 12: the assessment's rule and the calls behind each observation go to the technical details.
  const assessed = territory.role === "target" ? researchAssessmentOf(done).territories.find((item) => item.territoryKey === territory.key) : undefined;
  const provenance = assessed ? [`Evidence assessment (${assessed.version}, ${assessed.basis === "DIRECT_FACTS" ? "recorded facts" : "rebuilt from the stored result"}): ${assessed.rule}.`, ...assessed.observed.filter((item) => item.correlationIds.length).map((item) => `${item.code}: Qloo call ${item.correlationIds.slice(0, 3).join(", ")}`)] : [];
  return {
    name,
    question: done.userQuery || null,
    fit,
    steadiness,
    compared,
    sharedTastes: unique(nonTautologicalSignals(territory).kept.map((signal) => signal.label)).slice(0, 10),
    closestMatches: unique(territory.conditionedEvidence?.topEntities.map((entity) => entity.label) ?? []).slice(0, 8),
    examples,
    concept: territory.resolvedConcept?.label ?? null,
    unknowns,
    technical: unique([...provenance, ...territory.keyEvidence, ...territory.limitations.map((limitation) => limitation.detail)]),
    decision: decisionCard(done, territory.key, context),
    surfaced: surfacedReading(done.comparisonSetConstruction?.opportunities?.find((item) => item.territoryKey === territory.key), brand),
  };
}
