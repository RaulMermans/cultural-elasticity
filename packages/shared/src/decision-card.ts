/**
 * Sprint 9N: the Strategic Decision Card (decision-card/v1), a deterministic projection of ONE territory of ONE
 * completed investigation. The live interface, the HTML/PDF report and the evaluations use this same function, so
 * they keep the same factual meaning.
 *
 * Every value is read from the stored result (class, rank within its comparison set, robustness, shared signals,
 * exemplars, limitations, comparison feasibility). Nothing is computed, estimated, ranked across calls or predicted.
 * The implication is an interpretation of the evidence, never a forecast of commercial performance:
 *   SUPPORTED_FOR_EXPLORATION    a natural fit or credible stretch whose ranking held (robustness HIGH or MEDIUM)
 *   PRELIMINARY_HYPOTHESIS       a class exists but the ranking may move, or the single-hypothesis reading found support
 *   RELATIVE_FIT_NOT_SUPPORTED   a cultural break whose ranking held, or the hypothesis is not supported by the evidence
 *   INCONCLUSIVE                 no relative position was measured, or the class is "insufficient evidence"
 * Next actions come from the recorded evidence gap. When feasibility says the same question would likely end the same
 * way (Qloo's evidence, not the run's budget, blocked it), the card never suggests asking it again.
 */
import type { AgentAnalysisResult, AgentTerritoryResult, ComparisonFeasibility } from "./agent.js";

export const DECISION_CARD_VERSION = "decision-card/v1" as const;

export type DecisionImplication = "SUPPORTED_FOR_EXPLORATION" | "PRELIMINARY_HYPOTHESIS" | "RELATIVE_FIT_NOT_SUPPORTED" | "INCONCLUSIVE";

export type DecisionNextAction = {
  kind: "COMPARE_WITH_NAMED" | "RUN_AGAIN" | "TEST_WITH_OTHER_EXAMPLES" | "VALIDATE_WITH_PEOPLE" | "EXPLORE_CONNECTIONS";
  text: string;
  /** A question the product can send as a new investigation (absent when the action is outside the product). */
  question?: string;
};

export type DecisionCard = {
  version: typeof DECISION_CARD_VERSION;
  territoryKey: string;
  territory: string;
  brand: string;
  measured: boolean;
  finding: string;
  whyInteresting: string[];
  supports: string[];
  uncertain: string[];
  implication: { code: DecisionImplication; label: string; text: string };
  nextActions: DecisionNextAction[];
  /** From comparison feasibility: would asking the same question again likely end the same way? */
  repeat: ComparisonFeasibility["repeat"] | null;
  evidenceOrigin: AgentAnalysisResult["evidenceOrigin"];
};

export type DecisionCardContext = {
  /** Why the direction appeared (the baseline's own observation), when the investigation started from one. */
  directionWhy?: string | null;
  /** Other Qloo-grounded directions of the same brand, for a named comparison (a different question). */
  otherDirections?: readonly string[];
};

const CLASS_LABEL: Record<string, string> = {
  NATURAL_ADJACENCY: "Natural fit",
  CREDIBLE_STRETCH: "Credible stretch",
  CULTURAL_BREAK: "Cultural break",
  UNCERTAIN_REPRESENTATION_SENSITIVE: "Not settled",
  INSUFFICIENT_EVIDENCE: "Not enough evidence",
};

const IMPLICATION: Record<DecisionImplication, { label: string; text: (t: string, b: string) => string }> = {
  SUPPORTED_FOR_EXPLORATION: { label: "Supported case for further exploration", text: (t, b) => `Within this comparison, Qloo's evidence supports exploring ${t} further for ${b}.` },
  PRELIMINARY_HYPOTHESIS: { label: "Preliminary hypothesis to validate", text: (t) => `${t} is a hypothesis worth validating; the evidence does not settle it yet.` },
  RELATIVE_FIT_NOT_SUPPORTED: { label: "Relative fit not supported", text: (t, b) => `Within this comparison, Qloo's evidence does not support ${t} as a close fit for ${b}.` },
  INCONCLUSIVE: { label: "Inconclusive evidence", text: (t) => `There is no measured position for ${t} yet, so the evidence is inconclusive.` },
};

/** Plain-language versions of the comparison-feasibility blockers. */
const BLOCKER: Record<string, (t: string, f: ComparisonFeasibility) => string> = {
  TARGET_NOT_ANCHORED: (t) => `Qloo could not yet match ${t} to one of its concepts.`,
  TARGET_UNSUPPORTED: (t) => `Qloo does not support ${t} as a concept, so nothing could be compared with it.`,
  TARGET_NOT_REPRESENTED: (t) => `No validated set of examples could stand for ${t} in this run.`,
  TARGET_CONCEPT_ONLY: (t) => `Qloo knows ${t} as a concept, but returned no examples that could stand for it in a comparison.`,
  THIN_TARGET_PANEL: (t, f) => `Only ${f.target.validExemplars} example passed validation for ${t}. A comparison needs other territories tied to the question, and with one example only the brand's own Qloo tags could supply them.`,
  REFERENCE_DISCOVERY_PENDING: () => "The investigation stopped before it could look for comparable territories.",
  REFERENCE_PROBES_PENDING: () => "Comparable territories were found but not all of them could be checked in time.",
  NO_REFERENCE_YIELD: (_t, f) => `Qloo returned no comparable ${f.compatibleEntityType ?? ""} examples for ${f.referenceProbes.empty} candidate territories, so there was nothing to compare it with.`.replace("  ", " "),
  NO_MEANINGFUL_REFERENCE_CANDIDATES: () => "Qloo showed no other territory closely enough tied to the question to compare with fairly.",
  TURN_BUDGET: () => "The investigation ran out of steps before the comparison was complete.",
  QLOO_BUDGET: () => "The investigation reached its Qloo call budget before the comparison was complete.",
  CANDIDATE_SLOTS: () => "The investigation had no room left for more comparison territories.",
  SKILL_BUDGET: () => "The investigation spent its budget for building comparisons.",
};

/** Plain versions of territory limitations people often meet (others stay in technical notes). */
const LIMITATION: Record<string, (t: string) => string> = {
  NO_RELATIVE_POSITION: (t) => `${t} was not ranked against other territories.`,
  NO_VALID_REPRESENTATION: (t) => `No solid set of examples could be found to stand for ${t}.`,
  TERRITORY_UNRESOLVED: (t) => `Qloo could not match ${t} to one of its concepts.`,
  NOT_COLLECTED_BUDGET: () => "Some evidence was not collected because the investigation reached its budget.",
  PANEL_CALL_FAILED: () => "One of Qloo's lookups failed, so part of the comparison is missing.",
  SEMANTIC_COMPARISON_INVALID: () => "The territories available were not similar enough in kind for a fair ranking.",
};

/** Why an unmeasured territory has no position, from its route alone (used when no feasibility blocker was recorded). */
const ROUTE: Record<string, (t: string) => string> = {
  FULL_RELATIVE_ANALYSIS: (t) => `${t} was in a comparison, but the methodology gave it no settled class and position.`,
  PARTIAL_CULTURAL_ANALYSIS: (t) => `${t} has cultural evidence from Qloo but was not placed in a comparison of at least three territories of one kind.`,
  DESCRIPTIVE_ANALYSIS: (t) => `Qloo describes ${t}, but returned no examples that could be compared with other territories.`,
  INSUFFICIENT_EVIDENCE: (t) => `Qloo did not return enough evidence about ${t} to place it.`,
};

const uniq = (items: (string | null | undefined | false)[]) => [...new Set(items.filter((x): x is string => typeof x === "string" && x.trim().length > 0))];

function pick(result: AgentAnalysisResult, territoryKey: string | null): AgentTerritoryResult | undefined {
  if (territoryKey) return result.territories.find((t) => t.key === territoryKey);
  return result.territories.find((t) => t.role === "target") ?? (result.territories.length === 1 ? result.territories[0] : undefined);
}

function implicationOf(t: AgentTerritoryResult, result: AgentAnalysisResult, measured: boolean): DecisionImplication {
  if (!measured) {
    const outcome = result.hypothesisAssessment?.outcome;
    if (outcome === "WORTH_FURTHER_INVESTIGATION") return "PRELIMINARY_HYPOTHESIS";
    if (outcome === "NOT_SUPPORTED_BY_CURRENT_EVIDENCE") return "RELATIVE_FIT_NOT_SUPPORTED";
    return "INCONCLUSIVE";
  }
  const steady = t.robustness?.level === "HIGH" || t.robustness?.level === "MEDIUM";
  const cls = t.classification!.label;
  if (cls === "INSUFFICIENT_EVIDENCE") return "INCONCLUSIVE";
  if (steady && (cls === "NATURAL_ADJACENCY" || cls === "CREDIBLE_STRETCH")) return "SUPPORTED_FOR_EXPLORATION";
  if (steady && cls === "CULTURAL_BREAK") return "RELATIVE_FIT_NOT_SUPPORTED";
  return "PRELIMINARY_HYPOTHESIS";
}

export function decisionCard(result: AgentAnalysisResult | null | undefined, territoryKey: string | null, context: DecisionCardContext = {}): DecisionCard | null {
  if (!result || !Array.isArray(result.territories)) return null;
  const t = pick(result, territoryKey);
  if (!t) return null;
  const brand = result.brand?.label ?? "the brand";
  const name = t.label;
  const position = t.relativePosition?.position ?? null;
  const measured = t.analysisRoute === "FULL_RELATIVE_ANALYSIS" && Boolean(t.classification) && position !== null;
  const feasibility = result.comparisonFeasibility ?? null;
  const inSet = new Set(t.comparisonSet?.territoryKeys ?? []);
  const peers = result.territories.filter((x) => inSet.has(x.key) && x.key !== t.key).map((x) => x.label);

  const finding = measured
    ? `${CLASS_LABEL[t.classification!.label] ?? "Classified"} (provisional): ranked ${position} of ${t.relativePosition!.of} in one Qloo comparison with ${peers.join(", ")}.`
    : result.hypothesisAssessment
      ? `Not measured: ${name} was examined as a single hypothesis, without a comparison.`
      : `Not measured yet: ${name} has no position relative to other territories.`;

  const whyInteresting = uniq([
    context.directionWhy ?? null,
    t.resolvedConcept ? `Qloo resolves ${name} to its concept "${t.resolvedConcept.label}".` : null,
    t.conditionedEvidence?.topEntities.length ? `For ${brand}, Qloo's closest matches within ${name} include ${t.conditionedEvidence.topEntities.slice(0, 3).map((e) => e.label).join(", ")}.` : null,
    t.coherence?.consistentlyShared.length ? `${name}'s examples share these Qloo signals with ${brand}: ${t.coherence.consistentlyShared.slice(0, 4).map((s) => s.label).join(", ")}.` : null,
  ]).slice(0, 3);

  const exemplars = t.representation.exemplars.map((e) => e.label);
  const supports = uniq([
    measured ? `Its position comes from one Qloo call, compared only within these ${t.relativePosition!.of} territories.` : null,
    measured && (t.robustness?.level === "HIGH" || t.robustness?.level === "MEDIUM") ? "The ranking held across the example sets tested." : null,
    exemplars.length ? `Examples that stood for it: ${exemplars.slice(0, 5).join(", ")}.` : null,
    t.evidenceQuality ? `Evidence quality: ${t.evidenceQuality.level.toLowerCase()}.` : null,
    result.hypothesisAssessment?.supports.length ? result.hypothesisAssessment.supports[0] : null,
  ]);

  const blocker = measured ? null : (feasibility?.blocker ? BLOCKER[feasibility.blocker.code]?.(name, feasibility) : null) ?? ROUTE[t.analysisRoute]?.(name) ?? null;
  const uncertain = uniq([
    blocker,
    measured && t.robustness && t.robustness.level !== "HIGH" && t.robustness.level !== "MEDIUM" ? "The ranking could change with a different set of examples." : null,
    measured && t.classification?.label === "UNCERTAIN_REPRESENTATION_SENSITIVE" ? "The class depends on which examples stand for it." : null,
    ...t.limitations.map((l) => LIMITATION[l.code]?.(name)),
    ...(result.hypothesisAssessment?.unknowns ?? []).slice(0, 2),
    "Qloo describes cultural taste; it does not show whether people would buy.",
  ]).slice(0, 5);

  const code = implicationOf(t, result, measured);
  const repeat = !measured && feasibility ? feasibility.repeat : null;
  const others = [...new Set((context.otherDirections ?? []).filter((d) => d.trim().toLowerCase() !== name.trim().toLowerCase()))];
  const nextActions: DecisionNextAction[] = [];
  const compareNamed = () => {
    if (others.length >= 2) nextActions.push({ kind: "COMPARE_WITH_NAMED", text: `Name the comparison yourself: compare ${name} with ${others[0]} and ${others[1]}, two other directions Qloo found for ${brand}.`, question: `Compare ${name} with ${others[0]} and ${others[1]}` });
  };
  if (measured) {
    if (code === "PRELIMINARY_HYPOTHESIS") nextActions.push({ kind: "TEST_WITH_OTHER_EXAMPLES", text: `Test ${name} again with other examples; a different set could move its ranking.` });
    else compareNamed();
    nextActions.push({ kind: "VALIDATE_WITH_PEOPLE", text: `Check the idea with the people ${brand} serves; Qloo shows cultural affinity, not purchase intent.` });
  } else if (repeat === "MAY_CHANGE" && feasibility?.blocker && ["TURN_BUDGET", "QLOO_BUDGET", "SKILL_BUDGET", "CANDIDATE_SLOTS", "REFERENCE_PROBES_PENDING", "REFERENCE_DISCOVERY_PENDING"].includes(feasibility.blocker.code)) {
    nextActions.push({ kind: "RUN_AGAIN", text: `Measure ${name} again: this run stopped on its own budget, not on Qloo's evidence.` });
    compareNamed();
  } else {
    compareNamed();
    if (nextActions.length === 0) nextActions.push({ kind: "EXPLORE_CONNECTIONS", text: `Explore the Qloo connections around ${name} to find a related territory Qloo represents better.` });
    if (repeat === "LIKELY_REPEATS") nextActions.push({ kind: "VALIDATE_WITH_PEOPLE", text: "Asking the same question again would likely repeat the same work; qualitative research with people is the next useful evidence." });
  }

  return {
    version: DECISION_CARD_VERSION,
    territoryKey: t.key,
    territory: name,
    brand,
    measured,
    finding,
    whyInteresting,
    supports,
    uncertain,
    implication: { code, label: IMPLICATION[code].label, text: IMPLICATION[code].text(name, brand) },
    nextActions: nextActions.slice(0, 2),
    repeat,
    evidenceOrigin: result.evidenceOrigin,
  };
}

/** Wording a decision card must never contain (commercial outcomes, certainty, raw codes). Used by tests and evals. */
const FORBIDDEN = /\b(sales|revenue|profit|profitab\w*|roi|market share|will (succeed|sell|win)|guarantee\w*|demand forecast|probability|confidence)\b|%/iu;
const RAW_CODE = /\b[A-Z]{3,}_[A-Z_]{2,}\b/u;

export function decisionCardViolations(card: DecisionCard, result: AgentAnalysisResult): string[] {
  const out: string[] = [];
  const text = [card.finding, ...card.whyInteresting, ...card.supports, ...card.uncertain, card.implication.text, ...card.nextActions.map((a) => a.text)];
  for (const line of text) {
    const hit = FORBIDDEN.exec(line) ?? RAW_CODE.exec(line);
    if (hit) out.push(`forbidden wording "${hit[0]}" in: ${line}`);
  }
  const t = result.territories.find((x) => x.key === card.territoryKey);
  const allowed = new Set([t?.relativePosition?.position, t?.relativePosition?.of, result.comparisonFeasibility?.target.validExemplars, result.comparisonFeasibility?.referenceProbes.empty].filter((n): n is number => typeof n === "number").map(String));
  // Digits inside recorded names (a venue called "Studio 54") are part of the name, not a claim.
  const labels = [card.brand, ...result.territories.flatMap((x) => [x.label, x.resolvedConcept?.label ?? "", ...x.representation.exemplars.map((e) => e.label), ...(x.coherence?.consistentlyShared.map((c) => c.label) ?? []), ...(x.conditionedEvidence?.topEntities.map((e) => e.label) ?? [])])];
  for (const line of text) {
    const stripped = labels.filter(Boolean).sort((a, b) => b.length - a.length).reduce((acc, label) => acc.split(label).join(" "), line);
    for (const n of stripped.match(/\b\d+\b/gu) ?? []) if (!allowed.has(n)) out.push(`number ${n} is not a recorded result value: ${line}`);
  }
  if (!card.measured && /\b(natural fit|credible stretch|cultural break)\b/iu.test(card.finding)) out.push("an unmeasured card names a class");
  if (!card.measured && card.implication.code === "SUPPORTED_FOR_EXPLORATION") out.push("an unmeasured card claims support");
  if (card.repeat === "LIKELY_REPEATS" && card.nextActions.some((a) => a.kind === "RUN_AGAIN")) out.push("suggests repeating a question that would likely end the same way");
  if (!card.measured && card.uncertain.length === 0) out.push("a partial finding states no limitation");
  if (card.nextActions.length === 0) out.push("no next action");
  return out;
}
