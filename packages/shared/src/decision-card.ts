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
 *
 * Sprint 12 (decision-card/v2): the card leads with the research conclusion, the shared evidence assessment
 * (evidence-assessment/v1), so a result with valid direct evidence is never reduced to "not measured". The comparative
 * result is its own section. Next actions follow the investigation's real blockers; a named comparison only ever
 * uses references a validated source supplied (never the brand's other directions taken in list order).
 */
import type { AgentAnalysisResult, AgentTerritoryResult, ComparisonFeasibility, ConceptRelation, StrategicInsight } from "./agent.js";
import { researchAssessmentOf, type ConceptCoverage, type ComparativeStatus, type EvidenceOutcome, type TerritoryEvidenceAssessment } from "./evidence-assessment.js";

export const DECISION_CARD_VERSION = "decision-card/v2" as const;

export type DecisionImplication = "SUPPORTED_FOR_EXPLORATION" | "PRELIMINARY_HYPOTHESIS" | "RELATIVE_FIT_NOT_SUPPORTED" | "INCONCLUSIVE" | "ESTABLISHED_POSITIONING" | "NO_SUPPORT_FOUND" | "NOT_TESTABLE_AS_ASKED";

export type DecisionNextAction = {
  kind: "COMPARE_WITH_NAMED" | "MEASURE_WITH_COMPARISON" | "RUN_AGAIN" | "TEST_WITH_OTHER_EXAMPLES" | "VALIDATE_WITH_PEOPLE" | "EXPLORE_CONNECTIONS" | "INVESTIGATE_UNCOVERED" | "REFRAME_CONCEPT" | "EXTEND_ESTABLISHED";
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
  /** Sprint 12: the research conclusion (evidence-assessment/v1) for this territory; null only for a non-target. */
  conclusion: { outcome: EvidenceOutcome; label: string; text: string } | null;
  /** Sprint 12: what was observed directly, with its limits and the evidence that would change the answer. */
  evidence: { observed: string[]; limitations: string[]; missing: string[]; coverage: ConceptCoverage[] };
  /** Sprint 12: whether cultural fit was established comparatively, kept apart from the conclusion. */
  comparative: ComparativeStatus;
  /** The comparative finding when measured, else the conclusion (kept for decision-card/v1 readers). */
  finding: string;
  whyInteresting: string[];
  supports: string[];
  uncertain: string[];
  implication: { code: DecisionImplication; label: string; text: string };
  nextActions: DecisionNextAction[];
  /** From comparison feasibility: would asking the same question again likely end the same way? */
  repeat: ComparisonFeasibility["repeat"] | null;
  evidenceOrigin: AgentAnalysisResult["evidenceOrigin"];
  /**
   * Sprint 11 (additive): validated strategic interpretations for this territory. Labelled reasoning, not evidence:
   * only `observation` states what was found.
   */
  interpretations?: Pick<StrategicInsight, "observation" | "interpretation" | "implication" | "counterpoint" | "validation" | "horizon">[];
};

export type DecisionCardContext = {
  /** Why the direction appeared (the baseline's own observation), when the investigation started from one. */
  directionWhy?: string | null;
  /**
   * Sprint 12: comparison references a validated source accepted for THIS target (the server's comparison-eligibility
   * gate). The only names a named-comparison action may use. Sprint 9N's `otherDirections` (the brand's other
   * directions in list order) is no longer read: they were not checked as meaningful alternatives to the question.
   */
  validatedReferences?: readonly string[];
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
  INCONCLUSIVE: { label: "No decision yet", text: (t) => `The evidence gathered for ${t} does not support a conclusion either way yet.` },
  ESTABLISHED_POSITIONING: { label: "Part of the existing position", text: (t, b) => `Treat ${t} as cultural ground ${b} already holds; the strategic question is how to deepen or extend it, not whether it fits.` },
  NO_SUPPORT_FOUND: { label: "No support found in the scope tested", text: (t, b) => `Qloo's evidence gives no reason to pursue ${t} for ${b} on this concept; this is not proof that no relationship exists.` },
  NOT_TESTABLE_AS_ASKED: { label: "Not testable as asked", text: (t) => `Qloo has no faithful concept for ${t} as asked, so this investigation cannot answer the question.` },
};

const FROM_OUTCOME: Record<EvidenceOutcome, DecisionImplication> = {
  ESTABLISHED_ASSOCIATION: "ESTABLISHED_POSITIONING",
  OBSERVED_ASSOCIATION: "PRELIMINARY_HYPOTHESIS",
  LIMITED_EVIDENCE: "INCONCLUSIVE",
  NO_SUPPORT_IN_TESTED_SCOPE: "NO_SUPPORT_FOUND",
  CONCEPT_NOT_REPRESENTED: "NOT_TESTABLE_AS_ASKED",
  INCOMPLETE: "INCONCLUSIVE",
};

/** Plain-language versions of the comparison-feasibility blockers. */
const BLOCKER: Record<string, (t: string, f: ComparisonFeasibility) => string> = {
  TARGET_NOT_ANCHORED: (t) => `Qloo could not yet match ${t} to one of its concepts.`,
  TARGET_UNSUPPORTED: (t) => `No Qloo tag tried for ${t} in this run returned entities that could stand for it, so nothing could be compared with it.`,
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
  TERRITORY_UNRESOLVED: (t) => `This run found no Qloo tag for ${t} that returns entities.`,
  NOT_COLLECTED_BUDGET: () => "Some evidence was not collected because the investigation reached its budget.",
  PANEL_CALL_FAILED: () => "One of Qloo's lookups failed, so part of the comparison is missing.",
  SEMANTIC_COMPARISON_INVALID: () => "The territories available were not similar enough in kind for a fair ranking.",
  COMPARISON_DECLINED: (t) => `${t} was investigated without a ranking, because a comparison would not have answered the question.`,
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

function implicationOf(t: AgentTerritoryResult, measured: boolean, assessment: TerritoryEvidenceAssessment | null): DecisionImplication {
  const outcome = assessment?.outcome;
  // The concept or the run's completeness decides first: a ranking of the wrong concept, or of nothing, settles nothing.
  if (outcome === "CONCEPT_NOT_REPRESENTED" || outcome === "INCOMPLETE") return FROM_OUTCOME[outcome];
  if (!measured) return outcome ? FROM_OUTCOME[outcome] : "INCONCLUSIVE";
  const steady = t.robustness?.level === "HIGH" || t.robustness?.level === "MEDIUM";
  const cls = t.classification!.label;
  if (cls === "INSUFFICIENT_EVIDENCE") return outcome ? FROM_OUTCOME[outcome] : "INCONCLUSIVE";
  if (steady && (cls === "NATURAL_ADJACENCY" || cls === "CREDIBLE_STRETCH")) return outcome === "ESTABLISHED_ASSOCIATION" ? "ESTABLISHED_POSITIONING" : "SUPPORTED_FOR_EXPLORATION";
  if (steady && cls === "CULTURAL_BREAK") return "RELATIVE_FIT_NOT_SUPPORTED";
  // An unsettled ranking leaves the direct evidence as the answer.
  return outcome === "ESTABLISHED_ASSOCIATION" ? "ESTABLISHED_POSITIONING" : "PRELIMINARY_HYPOTHESIS";
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
  const research = t.role === "target" ? researchAssessmentOf(result) : null;
  const assessment = research?.territories.find((a) => a.territoryKey === t.key) ?? null;

  const measuredFinding = measured ? `${CLASS_LABEL[t.classification!.label] ?? "Classified"} (provisional): ranked ${position} of ${t.relativePosition!.of} in one Qloo comparison with ${peers.join(", ")}.` : null;
  const finding = measuredFinding
    ?? assessment?.conclusion
    ?? (result.hypothesisAssessment ? `${name} was examined as a single hypothesis, without a comparison.` : `${name} has no position relative to other territories.`);

  // Sprint 11: a non-equivalent concept and the brand's own category change how every other line must be read.
  const alignment = t.conceptAlignment && t.conceptAlignment.relation !== "EQUIVALENT" ? t.conceptAlignment : null;
  const whyInteresting = uniq([
    t.brandCore ? `Qloo categorises ${brand} itself as "${t.brandCore.label}", so ${name} is ${brand}'s established positioning, not a new direction.` : null,
    !t.brandCore && assessment?.outcome === "ESTABLISHED_ASSOCIATION" ? `${name} is already on ${brand}'s own Qloo profile, so it reads as existing cultural ground rather than a new extension.` : null,
    context.directionWhy ?? null,
    alignment ? `The evidence below is about Qloo's concept "${alignment.qlooConcept.label}", which is ${RELATION_COPY[alignment.relation]} ${name}.` : t.resolvedConcept ? `Qloo resolves ${name} to its concept "${t.resolvedConcept.label}".` : null,
  ]).slice(0, 3);

  const supports = uniq([
    measured ? `Its position comes from one Qloo call, compared only within these ${t.relativePosition!.of} territories.` : null,
    measured && (t.robustness?.level === "HIGH" || t.robustness?.level === "MEDIUM") ? "The ranking held across the example sets tested." : null,
    t.evidenceQuality ? `Evidence quality: ${t.evidenceQuality.level.toLowerCase()}.` : null,
    result.hypothesisAssessment?.supports.length ? result.hypothesisAssessment.supports[0] : null,
  ]);

  const blocker = measured ? null : (feasibility?.blocker ? BLOCKER[feasibility.blocker.code]?.(name, feasibility) : null) ?? ROUTE[t.analysisRoute]?.(name) ?? null;
  const uncertain = uniq([
    alignment ? `Qloo has no exact concept for ${name} as asked${alignment.uncovered.length ? `; not covered: ${alignment.uncovered.join(", ")}` : ""}.` : null,
    t.brandCore && measured ? `A ranking here compares cultural taste within one set; it does not say how far ${name} is from ${brand}'s business.` : null,
    blocker,
    measured && t.robustness && t.robustness.level !== "HIGH" && t.robustness.level !== "MEDIUM" ? "The ranking could change with a different set of examples." : null,
    measured && t.classification?.label === "UNCERTAIN_REPRESENTATION_SENSITIVE" ? "The class depends on which examples stand for it." : null,
    ...t.limitations.map((l) => LIMITATION[l.code]?.(name)),
    ...(result.hypothesisAssessment?.unknowns ?? []).slice(0, 2),
    "Qloo describes cultural taste; it does not show whether people would buy.",
  ]).slice(0, 5);

  const code = implicationOf(t, measured, assessment);
  const repeat = !measured && feasibility ? feasibility.repeat : null;
  const nextActions = nextActionsFor({ result, t, name, brand, measured, code, assessment, coverage: research?.coverage ?? [], feasibility, repeat, validated: context.validatedReferences ?? [] });

  return {
    version: DECISION_CARD_VERSION,
    territoryKey: t.key,
    territory: name,
    brand,
    measured,
    conclusion: assessment ? { outcome: assessment.outcome, label: assessment.label, text: assessment.conclusion } : null,
    evidence: {
      observed: assessment?.observed.map((o) => o.text) ?? [],
      limitations: assessment?.limitations ?? [],
      missing: assessment?.missing ?? [],
      coverage: research?.coverage ?? [],
    },
    comparative: measured ? { status: "MEASURED", text: measuredFinding! } : { status: assessment?.comparative.status ?? "NOT_MEASURED", text: [assessment?.comparative.text ?? `Cultural fit was not established comparatively for ${name}.`, blocker].filter(Boolean).join(" ") },
    finding,
    whyInteresting,
    supports,
    uncertain,
    implication: { code, label: IMPLICATION[code].label, text: IMPLICATION[code].text(name, brand) },
    nextActions: nextActions.slice(0, 2),
    repeat,
    evidenceOrigin: result.evidenceOrigin,
    ...((result.insights?.length ?? 0) > 0 && {
      interpretations: (result.insights ?? [])
        .filter((i) => i.territoryKey === t.key || i.territoryKey === null)
        .map(({ observation, interpretation, implication, counterpoint, validation, horizon }) => ({ observation, interpretation, implication, counterpoint, validation, horizon })),
    }),
  };
}

const BUDGET_BLOCKERS = new Set(["TURN_BUDGET", "QLOO_BUDGET", "SKILL_BUDGET", "CANDIDATE_SLOTS", "REFERENCE_PROBES_PENDING", "REFERENCE_DISCOVERY_PENDING"]);

/**
 * Research-question-aware next actions (Sprint 12). Each follows from the investigation's actual blocker:
 *   an uncovered part of a compound question      → investigate that part on its own
 *   no faithful Qloo concept                       → reframe the concept (never a ranking of the substitute)
 *   the run's own budget stopped it                → run it again (never when Qloo's evidence blocked it)
 *   established positioning                        → explore what extends it (fit is not the open question)
 *   an observed association without a comparison  → measure it with the product's validated comparison, or a named
 *                                                    comparison only with validated references
 *   no support / thin evidence that would repeat   → qualitative validation, never the same paid investigation again
 */
function nextActionsFor(input: { result: AgentAnalysisResult; t: AgentTerritoryResult; name: string; brand: string; measured: boolean; code: DecisionImplication; assessment: TerritoryEvidenceAssessment | null; coverage: ConceptCoverage[]; feasibility: ComparisonFeasibility | null; repeat: ComparisonFeasibility["repeat"] | null; validated: readonly string[] }): DecisionNextAction[] {
  const { result, t, name, brand, measured, code, assessment, coverage, feasibility, repeat } = input;
  const out: DecisionNextAction[] = [];
  const outcome = assessment?.outcome ?? null;
  const repeats = repeat === "LIKELY_REPEATS";
  const references = [...new Set(input.validated.filter((d) => d.trim().toLowerCase() !== name.trim().toLowerCase()))];
  const compare = () => {
    if (references.length >= 2) out.push({ kind: "COMPARE_WITH_NAMED", text: `Compare ${name} with ${references[0]} and ${references[1]}, references checked as meaningful alternatives for this question.`, question: `Compare ${name} with ${references[0]} and ${references[1]}` });
    else if (!repeats && !t.brandCore) out.push({ kind: "MEASURE_WITH_COMPARISON", text: `Measure ${name}'s fit with a Qloo comparison; the product proposes only reference territories Qloo ties to this question.` });
  };
  const uncovered = coverage.filter((c) => c.status === "NOT_COVERED" && c.territoryKey === null);
  if (uncovered[0]) out.push({ kind: "INVESTIGATE_UNCOVERED", text: `Investigate ${uncovered[0].concept} on its own: this run did not cover it, and the evidence about ${name} says nothing about it.`, question: `Is ${uncovered[0].concept} a credible cultural territory for ${brand}?` });
  const budgetStopped = result.status === "BUDGET_EXHAUSTED" || t.limitations.some((l) => l.code === "BUDGET_EXHAUSTED" || l.code === "NOT_COLLECTED_BUDGET") || (feasibility?.blocker && BUDGET_BLOCKERS.has(feasibility.blocker.code) && repeat === "MAY_CHANGE");
  if (outcome === "INCOMPLETE") {
    if (budgetStopped || !repeats) out.push({ kind: "RUN_AGAIN", text: `Run the investigation of ${name} again: it stopped before finishing, not on Qloo's evidence.` });
    else out.push({ kind: "VALIDATE_WITH_PEOPLE", text: "Asking the same question again would likely repeat the same work; qualitative research with people is the next useful evidence." });
  } else if (outcome === "CONCEPT_NOT_REPRESENTED") {
    const a = t.conceptAlignment;
    out.push({ kind: "REFRAME_CONCEPT", text: a && t.resolvedConcept ? `Decide whether Qloo's "${t.resolvedConcept.label}" is a useful stand-in for ${a.userConcept}; if not, ask again with a more specific term for ${a.userConcept} (a practice, scene, genre or kind of place).` : `Ask again with a more specific term for ${name} that Qloo may know (a practice, scene, genre or kind of place).` });
  } else if (measured) {
    if (code === "PRELIMINARY_HYPOTHESIS" && t.robustness && t.robustness.level !== "HIGH" && t.robustness.level !== "MEDIUM") out.push({ kind: "TEST_WITH_OTHER_EXAMPLES", text: `Treat ${name}'s position as unsettled: it moved with the examples used, so check it against other examples before relying on it.` });
    else if (code === "ESTABLISHED_POSITIONING") out.push({ kind: "EXTEND_ESTABLISHED", text: `${name} is already part of ${brand}'s position; explore which neighbouring territories extend it.`, question: `Which cultural territories could extend ${brand}'s ${name} positioning?` });
    else if (references.length >= 2) compare();
    out.push({ kind: "VALIDATE_WITH_PEOPLE", text: `Check the idea with the people ${brand} serves; Qloo shows cultural affinity, not purchase intent.` });
  } else if (outcome === "ESTABLISHED_ASSOCIATION") {
    out.push({ kind: "EXTEND_ESTABLISHED", text: `${name} is already part of ${brand}'s cultural position, so its fit is not the open question; explore which neighbouring territories extend it.`, question: `Which cultural territories could extend ${brand}'s ${name} positioning?` });
    out.push({ kind: "VALIDATE_WITH_PEOPLE", text: `Check with the people ${brand} serves how they see ${name} in the brand today; Qloo shows cultural affinity, not purchase intent.` });
  } else if (outcome === "OBSERVED_ASSOCIATION") {
    if (budgetStopped && !repeats) out.push({ kind: "RUN_AGAIN", text: `Measure ${name} again: this run stopped on its own budget, not on Qloo's evidence.` });
    else compare();
    out.push({ kind: "VALIDATE_WITH_PEOPLE", text: `Test the association with the people ${brand} serves; Qloo shows cultural affinity, not purchase intent.` });
  } else if (outcome === "NO_SUPPORT_IN_TESTED_SCOPE") {
    out.push({ kind: "REFRAME_CONCEPT", text: `If ${name} still matters, name a narrower or neighbouring concept to test; repeating this investigation would query the same Qloo concept.` });
    out.push({ kind: "VALIDATE_WITH_PEOPLE", text: "Qualitative research with people is the next useful evidence on this question." });
  } else {
    // LIMITED_EVIDENCE (or a non-target): name what is missing, and never send the same paid investigation again.
    if (budgetStopped && !repeats) out.push({ kind: "RUN_AGAIN", text: `Run the investigation of ${name} again: it stopped on its own budget, not on Qloo's evidence.` });
    else if (!repeats && references.length >= 2) compare();
    out.push(repeats
      ? { kind: "VALIDATE_WITH_PEOPLE", text: "Asking the same question again would likely repeat the same work; qualitative research with people is the next useful evidence." }
      : { kind: "EXPLORE_CONNECTIONS", text: `Explore the Qloo connections around ${name} to find a related territory Qloo represents better.` });
  }
  if (out.length === 0) out.push({ kind: "VALIDATE_WITH_PEOPLE", text: `Check the idea with the people ${brand} serves; Qloo shows cultural affinity, not purchase intent.` });
  return out.filter((a, i) => out.findIndex((b) => b.kind === a.kind) === i);
}

const RELATION_COPY: Record<ConceptRelation, string> = {
  EQUIVALENT: "the same as",
  NARROWER: "narrower than",
  PARTIAL_COVERAGE: "only part of",
  RELATED_DIFFERENT: "related to, but not the same as,",
  MISMATCHED: "different from",
};

/** Wording a decision card must never contain (commercial outcomes, certainty, raw codes). Used by tests and evals. */
const FORBIDDEN = /\b(sales|revenue|profit|profitab\w*|roi|market share|will (succeed|sell|win)|guarantee\w*|demand forecast|probability|confidence)\b|%/iu;
const RAW_CODE = /\b[A-Z]{3,}_[A-Z_]{2,}\b/u;

export function decisionCardViolations(card: DecisionCard, result: AgentAnalysisResult, context: DecisionCardContext = {}): string[] {
  const out: string[] = [];
  const text = [card.finding, card.conclusion?.text ?? "", ...card.evidence.observed, ...card.evidence.limitations, ...card.evidence.missing, card.comparative.text, ...card.whyInteresting, ...card.supports, ...card.uncertain, card.implication.text, ...card.nextActions.map((a) => a.text)].filter(Boolean);
  for (const line of text) {
    const hit = FORBIDDEN.exec(line) ?? RAW_CODE.exec(line);
    if (hit) out.push(`forbidden wording "${hit[0]}" in: ${line}`);
  }
  const t = result.territories.find((x) => x.key === card.territoryKey);
  const allowed = new Set([t?.relativePosition?.position, t?.relativePosition?.of, result.comparisonFeasibility?.target.validExemplars, result.comparisonFeasibility?.referenceProbes.empty, t?.conditionedEvidence?.entityCount, t?.directEvidence?.conditionedQuery.entityCount].filter((n): n is number => typeof n === "number").map(String));
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
  // Sprint 12: recommendations follow the real blocker and never name an unvalidated comparison.
  const validated = new Set((context.validatedReferences ?? []).map((r) => r.trim().toLowerCase()));
  for (const a of card.nextActions.filter((x) => x.kind === "COMPARE_WITH_NAMED")) {
    const named = /with (.+) and (.+)$/u.exec(a.question ?? "");
    if (!named || ![named[1]!, named[2]!].every((n) => validated.has(n.trim().toLowerCase()))) out.push(`names a comparison that no validated source supplied: ${a.text}`);
  }
  if (card.repeat === "LIKELY_REPEATS" && card.nextActions.some((a) => a.kind === "MEASURE_WITH_COMPARISON")) out.push("offers a comparison that Qloo's evidence already blocked");
  if ((card.conclusion?.outcome === "NO_SUPPORT_IN_TESTED_SCOPE" || card.conclusion?.outcome === "CONCEPT_NOT_REPRESENTED") && card.nextActions.some((a) => a.kind === "RUN_AGAIN")) out.push("suggests repeating an investigation whose evidence path would not change");
  if (card.conclusion && !card.measured && /^not measured/iu.test(card.finding)) out.push("leads with 'not measured' while a direct assessment exists");
  return out;
}
