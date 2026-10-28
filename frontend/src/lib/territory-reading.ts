/**
 * A plain-language reading of one territory in one run, for people who do not know the methodology. Every value is
 * read from the deterministic result (class, ranks, robustness, shared signals, conditioned evidence, exemplars);
 * nothing is computed, estimated or ranked here. Sentences restate those values; none forecasts commercial outcomes.
 */
import type { AgentRunResponse, AgentTerritoryResult } from "@cultural-elasticity/shared";

export type FitStep = "NATURAL_ADJACENCY" | "CREDIBLE_STRETCH" | "CULTURAL_BREAK";

export const FIT_STEPS: { code: FitStep; label: string }[] = [
  { code: "NATURAL_ADJACENCY", label: "Natural fit" },
  { code: "CREDIBLE_STRETCH", label: "Credible stretch" },
  { code: "CULTURAL_BREAK", label: "Cultural break" },
];

export type TerritoryReading = {
  name: string;
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
};

const FIT_LABEL: Record<string, string> = {
  NATURAL_ADJACENCY: "Natural fit",
  CREDIBLE_STRETCH: "Credible stretch",
  CULTURAL_BREAK: "Cultural break",
  UNCERTAIN_REPRESENTATION_SENSITIVE: "Not settled",
  INSUFFICIENT_EVIDENCE: "Not enough evidence",
};

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
  TERRITORY_UNRESOLVED: (name) => `Qloo could not match ${name} to one of its concepts.`,
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

export function territoryReading(result: AgentRunResponse | null | undefined, territoryKey: string | null, brand: string): TerritoryReading | null {
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
  return {
    name,
    fit,
    steadiness,
    compared,
    sharedTastes: unique(territory.coherence?.consistentlyShared.map((signal) => signal.label) ?? []).slice(0, 10),
    closestMatches: unique(territory.conditionedEvidence?.topEntities.map((entity) => entity.label) ?? []).slice(0, 8),
    examples,
    concept: territory.resolvedConcept?.label ?? null,
    unknowns,
    technical: unique([...territory.keyEvidence, ...territory.limitations.map((limitation) => limitation.detail)]),
  };
}
