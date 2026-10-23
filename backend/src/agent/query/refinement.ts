/**
 * Decides whether a follow-up is a real cultural refinement.
 *
 * A phrase that only asks to go deeper is an intent, not a territory. The model proposes a concept and a
 * relationship; this module accepts the concept only when it is specific and is either in the user's words or
 * already present in the parent run's observed concepts. It never invents a subcategory.
 */
import type { InvestigationOperation, RefinementRecord, RelationBasis, RefinementRelationship } from "@cultural-elasticity/shared";
import type { ResolvedContext } from "./context.js";
import type { QueryProposal } from "./contracts.js";

export const REFINEMENT_QUESTION = "What part of this territory would you like to explore?";

const norm = (value: string) => value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();

/**
 * Closed-class residue left when someone asks to go deeper without naming a concept.
 * This is not a list of cultural territories.
 */
const RESIDUE = new Set([
  "a", "an", "the", "of", "and", "or", "to", "in", "on", "for", "with", "from", "into", "more", "less", "most", "very",
  "specific", "specifically", "something", "anything", "narrower", "narrow", "deeper", "deep", "further", "explore",
  "exploring", "exploration", "just", "please", "really", "quite", "rather", "else", "other", "another", "territory",
  "concept", "direction", "part", "bit", "way", "this", "that", "these", "those", "it", "its", "than", "then",
]);

function tokens(value: string | null | undefined): string[] {
  return norm(value ?? "").split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 0);
}

/** True when the concept adds a content word beyond the parent label and words that only mean "go deeper". */
export function conceptIsSpecific(parentLabel: string | null, concept: string): boolean {
  const parent = new Set(tokens(parentLabel));
  const extra = tokens(concept).filter((token) => !parent.has(token) && !RESIDUE.has(token) && token.length >= 3);
  return extra.length > 0;
}

function userNamed(query: string, concept: string, explicit: readonly string[] | undefined): boolean {
  if (explicit?.some((name) => norm(name) === norm(concept))) return true;
  return norm(query).includes(norm(concept));
}

function observedLabels(context: ResolvedContext | null): string[] {
  const final = context?.nodes[0]?.state.final;
  if (!final) return [];
  const concepts = final.layers?.qlooEvidence?.concepts?.map((concept) => concept.label) ?? [];
  return [...concepts, ...final.territories.map((territory) => territory.label)];
}

function matchesObserved(concept: string, labels: readonly string[]): boolean {
  const wanted = norm(concept);
  return labels.some((label) => norm(label) === wanted);
}

export type RefinementDecision =
  | { ok: true; territories: { name: string; source: "EXPLICIT" }[]; operation: InvestigationOperation; record: RefinementRecord; warnings: string[] }
  | { ok: false; detail: string; question: string };

export function assessRefinement(input: {
  query: string;
  proposal: QueryProposal;
  context: ResolvedContext | null;
  territories: { name: string; source: "EXPLICIT" | "INHERITED" }[];
  explicitTerritories?: string[];
  parentRunId: string | null;
  parentTerritoryKey: string | null;
  parentLabel: string | null;
}): RefinementDecision {
  const proposed = input.proposal.refinement;
  const question = input.proposal.clarificationQuestion ?? REFINEMENT_QUESTION;
  if (proposed?.requiresClarification || proposed?.refinementRelationship === "UNCLEAR") {
    return { ok: false, detail: "the message asks to look closer without naming a cultural concept", question };
  }
  const named = input.territories.map((territory) => territory.name);
  const concept = proposed?.proposedChildConcept ?? (named.length === 1 ? named[0]! : null);
  if (!concept || !conceptIsSpecific(input.parentLabel, concept)) {
    return { ok: false, detail: "the requested refinement does not name a more specific cultural concept", question };
  }
  const namedByUser = userNamed(input.query, concept, input.explicitTerritories);
  const observed = matchesObserved(concept, observedLabels(input.context));
  if (!namedByUser && !observed) {
    return { ok: false, detail: "the proposed concept is neither in the user's words nor in the parent investigation's observed concepts", question };
  }
  const warnings: string[] = [];
  let basis: RelationBasis = namedByUser ? "USER_EXPLICIT" : proposed?.relationBasis === "AGENT_HYPOTHESIS" ? "AGENT_HYPOTHESIS" : "OBSERVED_EVIDENCE";
  if (proposed?.relationBasis === "USER_EXPLICIT" && !namedByUser) warnings.push("REFINEMENT_BASIS_ADJUSTED: the concept was not in the user's words");
  if (proposed?.relationBasis === "OBSERVED_EVIDENCE" && !observed) warnings.push("OBSERVED_EVIDENCE_NOT_FOUND: the parent investigation does not record this concept");
  if (!namedByUser && basis === "OBSERVED_EVIDENCE" && proposed?.relationBasis === "AGENT_HYPOTHESIS") basis = "AGENT_HYPOTHESIS";
  if (basis === "AGENT_HYPOTHESIS") warnings.push("REFINEMENT_HYPOTHESIS: the narrower concept is a hypothesis, not a verified category");
  const relationship: RefinementRelationship = proposed?.refinementRelationship ?? "NARROWER";
  const operation: InvestigationOperation = relationship === "ALTERNATIVE" ? "SWITCH_TERRITORY" : relationship === "RELATED" ? "FOLLOW_UP" : "REFINE_TERRITORY";
  if (operation !== "REFINE_TERRITORY") warnings.push("REFINEMENT_NOT_NARROWER: the follow-up is not recorded as a verified narrower category");
  return {
    ok: true,
    territories: [{ name: concept, source: "EXPLICIT" }],
    operation,
    warnings,
    record: {
      parentRunId: input.parentRunId,
      parentTerritoryKey: input.parentTerritoryKey,
      userRefinement: input.query,
      proposedChildConcept: concept,
      refinementRelationship: relationship,
      relationBasis: basis,
      requiresClarification: false,
    },
  };
}
