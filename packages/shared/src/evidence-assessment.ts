/**
 * Sprint 12: evidence-assessment/v1, the direct brand × territory evidence assessment.
 *
 * It answers what a completed investigation observed directly about a brand and a requested concept, without needing
 * a comparison set. It is a deterministic projection of a stored result: the runtime stores it, and the live interface,
 * the HTML/PDF report, the Decision Card and the evaluations call this same function, so they tell the same story.
 *
 * Outcomes (an evidence category, never a calibrated strength and never an elasticity class):
 *   ESTABLISHED_ASSOCIATION     Qloo categorises the brand as the concept, or the concept is on the brand's own Qloo
 *                               profile AND a brand-conditioned query returned entities for it
 *   OBSERVED_ASSOCIATION        one direct observation: the concept is on the brand's profile, or the brand-conditioned
 *                               query returned entities whose validated examples share a non-tautological signal with the brand
 *   LIMITED_EVIDENCE            some evidence, not enough for either of the above
 *   NO_SUPPORT_IN_TESTED_SCOPE  the brand-conditioned query answered cleanly with nothing, and the concept is not on the
 *                               brand's profile (no support in that scope; never proof that no relationship exists)
 *   CONCEPT_NOT_REPRESENTED     no Qloo concept anchors the territory, or only a related-but-different concept does
 *   INCOMPLETE                  the run or this territory did not finish (budget, interruption, not investigated)
 *
 * Rules apply in that order, after INCOMPLETE and CONCEPT_NOT_REPRESENTED. A returned-entity count is never read as
 * affinity strength (type-filtered queries saturate), absent evidence is never read as a negative fit, and evidence
 * about one concept is never read as evidence about another (a compound question keeps one assessment per concept).
 * Nothing here names a brand, territory or concept.
 */
import type { AgentAnalysisResult, AgentTerritoryResult, ConceptRelation, DirectEvidenceFacts } from "./agent.js";

export const EVIDENCE_ASSESSMENT_VERSION = "evidence-assessment/v1" as const;

export const EVIDENCE_OUTCOMES = [
  "ESTABLISHED_ASSOCIATION",
  "OBSERVED_ASSOCIATION",
  "LIMITED_EVIDENCE",
  "NO_SUPPORT_IN_TESTED_SCOPE",
  "CONCEPT_NOT_REPRESENTED",
  "INCOMPLETE",
] as const;
export type EvidenceOutcome = (typeof EVIDENCE_OUTCOMES)[number];

export const EVIDENCE_OUTCOME_LABEL: Record<EvidenceOutcome, string> = {
  ESTABLISHED_ASSOCIATION: "Established cultural association",
  OBSERVED_ASSOCIATION: "Observed association worth examining",
  LIMITED_EVIDENCE: "Limited evidence",
  NO_SUPPORT_IN_TESTED_SCOPE: "No support found in the scope tested",
  CONCEPT_NOT_REPRESENTED: "Not testable as asked",
  INCOMPLETE: "Investigation incomplete",
};

export type EvidenceObservationCode =
  | "BRAND_CATEGORY"
  | "BRAND_PROFILE_TAG"
  | "CONDITIONED_ENTITIES"
  | "CONDITIONED_EMPTY"
  | "VALIDATED_EXEMPLARS"
  | "SHARED_SIGNALS"
  | "RELATED_CONCEPT_ONLY";

export type EvidenceObservation = { code: EvidenceObservationCode; text: string; correlationIds: string[] };

export type ComparativeStatus = {
  /** MEASURED: a relative position exists. NOT_MEASURED: a comparison was attempted or possible but produced none. */
  status: "MEASURED" | "NOT_MEASURED" | "NOT_ATTEMPTED";
  text: string;
};

export type TerritoryEvidenceAssessment = {
  version: typeof EVIDENCE_ASSESSMENT_VERSION;
  territoryKey: string;
  /** The concept as the user named it. */
  requested: string;
  /** The Qloo concept actually investigated (null when none anchored). */
  investigated: { id: string; label: string } | null;
  relation: ConceptRelation | null;
  outcome: EvidenceOutcome;
  label: string;
  /** The defensible conclusion, in plain words. It states the scope and never a strength. */
  conclusion: string;
  /** The rule that decided the outcome (audit trail). */
  rule: string;
  observed: EvidenceObservation[];
  limitations: string[];
  /** What would change the answer: the missing evidence, stated concretely. */
  missing: string[];
  comparative: ComparativeStatus;
  /** DIRECT_FACTS: the runtime recorded direct-evidence/v1. DERIVED: rebuilt from an older stored result. */
  basis: "DIRECT_FACTS" | "DERIVED_FROM_STORED_RESULT";
};

export type ConceptCoverage = {
  concept: string;
  status: "COVERED" | "PARTIAL" | "RELATED_ONLY" | "NOT_COVERED";
  territoryKey: string | null;
  qlooConcept: string | null;
  note: string;
};

export type ResearchAssessment = {
  version: typeof EVIDENCE_ASSESSMENT_VERSION;
  question: string;
  brand: string | null;
  /** One assessment per target territory, in result order. */
  territories: TerritoryEvidenceAssessment[];
  /** Each requested concept and how this run covered it (a compound question lists every part). */
  coverage: ConceptCoverage[];
  /** The answer to the question as asked: one line per requested concept, never merged across concepts. */
  headline: string;
};

const RELATION_WORDS: Record<ConceptRelation, string> = {
  EQUIVALENT: "the same as",
  NARROWER: "narrower than",
  PARTIAL_COVERAGE: "only part of",
  RELATED_DIFFERENT: "related to, but not the same as,",
  MISMATCHED: "different from",
};

const uniq = <T>(items: T[]): T[] => [...new Set(items)];
const canonical = (id: string) => (id.split(":").pop() ?? id).toLowerCase();
const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** Shared signals without the concept's own tag (same id or same canonical name). */
export function nonTautologicalSignals(t: Pick<AgentTerritoryResult, "coherence" | "resolvedConcept">): { kept: { id: string; label: string }[]; removed: { id: string; label: string }[] } {
  const shared = t.coherence?.consistentlyShared ?? [];
  const concept = t.resolvedConcept;
  if (!concept) return { kept: shared, removed: [] };
  const own = (s: { id: string; label: string }) => s.id === concept.id || canonical(s.id) === canonical(concept.id) || s.label.trim().toLowerCase() === concept.label.trim().toLowerCase();
  return { kept: shared.filter((s) => !own(s)), removed: shared.filter(own) };
}

/** The facts the rules read: the runtime's direct-evidence/v1 when recorded, else what an older stored result shows. */
export function directFacts(result: AgentAnalysisResult, t: AgentTerritoryResult): { facts: DirectEvidenceFacts; basis: TerritoryEvidenceAssessment["basis"] } {
  if (t.directEvidence) return { facts: t.directEvidence, basis: "DIRECT_FACTS" };
  const { kept, removed } = nonTautologicalSignals(t);
  // Shared signals are the brand profile ∩ each exemplar profile, so the concept tag among them is on the brand's profile.
  const onProfile = removed.length > 0 || Boolean(t.brandCore);
  const c = t.conditionedEvidence;
  const cap = t.capabilities?.conditionedEvidence;
  const conditionedStatus: DirectEvidenceFacts["conditionedQuery"]["status"] =
    c && c.entityCount > 0 ? "RETURNED" : cap === "EMPTY" ? "CLEAN_EMPTY" : t.limitations.some((l) => l.code === "CONDITIONED_CALL_FAILED") ? "FAILED" : "NOT_RUN";
  const judged = (result.layers?.agentInterpretation?.semanticJudgments ?? []).filter((j) => j.territoryKey === t.key && t.representation.exemplars.some((e) => e.label === j.label));
  const count = (r: string) => judged.filter((j) => String(j.relevance).toLowerCase() === r).length;
  return {
    basis: "DERIVED_FROM_STORED_RESULT",
    facts: {
      version: "direct-evidence/v1",
      brandProfile: { status: onProfile ? "CONTAINS_CONCEPT" : "NOT_OBSERVED", source: onProfile ? "run_profile" : null, correlationId: null },
      conditionedQuery: { status: conditionedStatus, entityCount: c?.entityCount ?? 0, correlationId: c?.correlationId ?? null },
      conceptSearch: "NOT_RUN",
      exemplarJudgments: { strong: count("strong"), adequate: count("adequate"), weak: count("weak"), mismatch: count("mismatch"), unjudged: Math.max(0, t.representation.exemplars.length - judged.length) },
      sharedSignals: kept,
      tautologicalSignals: removed,
    },
  };
}

const INCOMPLETE_CODES = new Set(["NOT_INVESTIGATED", "BUDGET_EXHAUSTED"]);

function comparativeOf(result: AgentAnalysisResult, t: AgentTerritoryResult): ComparativeStatus {
  const position = t.relativePosition?.position ?? null;
  if (t.analysisRoute === "FULL_RELATIVE_ANALYSIS" && t.classification && position !== null) {
    return { status: "MEASURED", text: `Ranked ${position} of ${t.relativePosition!.of} in one Qloo comparison with ${(t.comparisonSet?.labels ?? []).filter((l) => l !== t.label).join(", ")}; the position holds only within that set.` };
  }
  if (t.limitations.some((l) => l.code === "COMPARISON_DECLINED") || result.researchApproach?.approach === "investigate" || result.hypothesisAssessment) {
    return { status: "NOT_ATTEMPTED", text: "Cultural fit was not compared with other territories: the investigation answered the question from direct evidence." };
  }
  return { status: "NOT_MEASURED", text: "Cultural fit was not established comparatively: no valid comparison with other territories of the same kind was completed." };
}

/** The evidence assessment of one territory of one stored result. */
export function assessTerritoryEvidence(result: AgentAnalysisResult, t: AgentTerritoryResult): TerritoryEvidenceAssessment {
  const brand = result.brand?.label ?? "the brand";
  const name = t.label;
  const { facts, basis } = directFacts(result, t);
  const alignment = t.conceptAlignment ?? null;
  const relation = alignment?.relation ?? null;
  const concept = t.resolvedConcept ? { id: t.resolvedConcept.id, label: t.resolvedConcept.label } : null;
  const conceptName = concept?.label ?? name;
  const conceptIds = t.provenance?.correlationIds ?? [];
  const validExemplars = t.representation.exemplars.filter((e) => e.quality !== "WEAK");
  const j = facts.exemplarJudgments;
  const exemplarsMeaningful = validExemplars.length > 0 && j.mismatch === 0 && j.strong + j.adequate + j.unjudged > 0;
  const shared = facts.sharedSignals;
  const q = facts.conditionedQuery;
  const onProfile = facts.brandProfile.status === "CONTAINS_CONCEPT";
  const partial = relation === "NARROWER" || relation === "PARTIAL_COVERAGE";
  const substituted = relation === "RELATED_DIFFERENT" || relation === "MISMATCHED";

  const observed: EvidenceObservation[] = [];
  if (t.brandCore) observed.push({ code: "BRAND_CATEGORY", text: `Qloo categorises ${brand} itself as "${t.brandCore.label}".`, correlationIds: [] });
  if (onProfile && !t.brandCore) observed.push({ code: "BRAND_PROFILE_TAG", text: `"${conceptName}" is one of the tags on ${brand}'s own Qloo profile${facts.brandProfile.source === "baseline_scan" ? " (observed by the brand scan)" : ""}.`, correlationIds: facts.brandProfile.correlationId ? [facts.brandProfile.correlationId] : [] });
  if (q.status === "RETURNED") observed.push({ code: "CONDITIONED_ENTITIES", text: `Asked for ${conceptName} entities with ${brand} as context, Qloo returned ${q.entityCount}${t.conditionedEvidence?.topEntities.length ? `, led by ${t.conditionedEvidence.topEntities.slice(0, 3).map((e) => e.label).join(", ")}` : ""}. A count of returned entities is not a measure of affinity.`, correlationIds: q.correlationId ? [q.correlationId] : [] });
  if (q.status === "CLEAN_EMPTY") observed.push({ code: "CONDITIONED_EMPTY", text: `Asked for ${conceptName} entities with ${brand} as context, Qloo returned none.`, correlationIds: q.correlationId ? [q.correlationId] : [] });
  if (validExemplars.length) observed.push({ code: "VALIDATED_EXEMPLARS", text: `Examples that passed validation for ${conceptName}: ${validExemplars.slice(0, 5).map((e) => e.label).join(", ")}${j.weak + j.mismatch > 0 ? "; the agent judged some candidates weak or off-topic, and they were not used" : ""}.`, correlationIds: conceptIds });
  if (shared.length) observed.push({ code: "SHARED_SIGNALS", text: `Those examples share these Qloo signals with ${brand}'s profile: ${shared.slice(0, 5).map((s) => s.label).join(", ")}.`, correlationIds: conceptIds });
  if (substituted && concept) observed.push({ code: "RELATED_CONCEPT_ONLY", text: `The evidence above is about Qloo's "${concept.label}", which the agent judged ${RELATION_WORDS[relation!]} ${alignment!.userConcept}.`, correlationIds: [] });

  const limitations: string[] = [];
  const missing: string[] = [];
  if (partial && alignment) limitations.push(`Qloo's "${alignment.qlooConcept.label}" is ${RELATION_WORDS[alignment.relation]} "${alignment.userConcept}"${alignment.uncovered.length ? `; not covered: ${alignment.uncovered.join(", ")}` : ""}. The conclusion holds for that part only.`);
  if (facts.tautologicalSignals.length) limitations.push(`"${facts.tautologicalSignals[0]!.label}" is shared with ${brand} only because it is the concept itself, so it is not counted as a separate signal.`);
  if (q.status === "UNRELIABLE") limitations.push("Qloo flagged the brand-conditioned answer as partial or degraded, so it is not read as evidence.");
  if (q.status === "FAILED") limitations.push("The brand-conditioned Qloo call failed; a failed call is never evidence.");
  if (t.limitations.some((l) => l.code === "CONDITIONED_LIST_TRUNCATED")) limitations.push("Qloo returned more entities than were read; only the first page was used.");
  if (facts.brandProfile.status === "NOT_OBSERVED" && concept && !substituted) limitations.push(`Whether "${conceptName}" is on ${brand}'s own Qloo profile was not observed in this run.`);

  const decide = (): { outcome: EvidenceOutcome; rule: string } => {
    const failure = t.representation.failure?.code;
    const incompleteCode = t.limitations.find((l) => INCOMPLETE_CODES.has(l.code))?.code ?? (failure && INCOMPLETE_CODES.has(failure) ? failure : null);
    if (result.status !== "COMPLETE" && t.analysisRoute === "INSUFFICIENT_EVIDENCE") return { outcome: "INCOMPLETE", rule: `run status ${result.status}` };
    if (incompleteCode) return { outcome: "INCOMPLETE", rule: `territory ${incompleteCode}` };
    if (!concept) return { outcome: "CONCEPT_NOT_REPRESENTED", rule: "no Qloo concept anchored" };
    if (substituted) return { outcome: "CONCEPT_NOT_REPRESENTED", rule: `concept ${relation}` };
    if (t.brandCore) return { outcome: "ESTABLISHED_ASSOCIATION", rule: "brand category tag" };
    if (onProfile && q.status === "RETURNED") return { outcome: "ESTABLISHED_ASSOCIATION", rule: "brand profile tag + conditioned entities" };
    if (onProfile) return { outcome: "OBSERVED_ASSOCIATION", rule: "brand profile tag only" };
    if (q.status === "RETURNED" && exemplarsMeaningful && shared.length > 0) return { outcome: "OBSERVED_ASSOCIATION", rule: "conditioned entities + validated exemplars + shared signal" };
    if (q.status === "CLEAN_EMPTY") return { outcome: "NO_SUPPORT_IN_TESTED_SCOPE", rule: "conditioned query cleanly empty, concept not on brand profile" };
    return { outcome: "LIMITED_EVIDENCE", rule: q.status === "RETURNED" ? (exemplarsMeaningful ? "conditioned entities, no shared signal" : "conditioned entities, no meaningful exemplar") : `conditioned query ${q.status}` };
  };
  const { outcome, rule } = decide();

  // What would change the answer, by outcome.
  if (outcome === "LIMITED_EVIDENCE" || outcome === "OBSERVED_ASSOCIATION") {
    if (!validExemplars.length) missing.push(`A set of examples that clearly stand for ${conceptName}.`);
    else if (!shared.length) missing.push(`A cultural signal, beyond the concept itself, that ${conceptName}'s examples share with ${brand}.`);
    if (q.status !== "RETURNED" && q.status !== "CLEAN_EMPTY") missing.push(`A completed brand-conditioned Qloo query for ${conceptName}.`);
    if (!onProfile && facts.brandProfile.status !== "ABSENT") missing.push(`Whether "${conceptName}" is on ${brand}'s own Qloo profile.`);
  }
  if (outcome === "CONCEPT_NOT_REPRESENTED") missing.push(substituted ? `A Qloo concept that means ${alignment!.userConcept} itself, rather than ${concept!.label}.` : `A Qloo concept that represents ${name}; a more specific wording may find one.`);
  if (outcome === "NO_SUPPORT_IN_TESTED_SCOPE") missing.push(`Evidence from another faithful Qloo concept or entity type for ${name}; this run tested only "${conceptName}".`);
  if (outcome === "INCOMPLETE") missing.push("A completed investigation.");

  const scope = partial && alignment ? `For the part of ${alignment.userConcept} that Qloo's "${alignment.qlooConcept.label}" covers: ` : "";
  const conclusion = ((): string => {
    switch (outcome) {
      case "ESTABLISHED_ASSOCIATION":
        return t.brandCore
          ? `${scope}${name} is part of ${brand}'s established positioning, not a new extension: Qloo categorises ${brand} itself as "${t.brandCore.label}".`
          : `${scope}${name} is already culturally associated with ${brand} in Qloo: "${conceptName}" is on ${brand}'s own Qloo profile, and Qloo returns ${conceptName} entities for ${brand}. Read it as part of the brand's existing cultural position rather than a new direction.`;
      case "OBSERVED_ASSOCIATION":
        return onProfile
          ? `${scope}Qloo links ${name} to ${brand}: "${conceptName}" is on ${brand}'s own Qloo profile. No second, independent observation corroborated it in this run, so treat it as an association to examine.`
          : `${scope}Qloo links ${name} to ${brand}: examples of ${conceptName} returned for ${brand} share cultural signals with the brand's profile (${shared.slice(0, 3).map((s) => s.label).join(", ")}). This is an observed association worth examining, not a measured fit.`;
      case "LIMITED_EVIDENCE":
        return `${scope}Qloo returned some evidence about ${name} for ${brand}, but not enough to call it an association: ${rule.includes("no shared signal") ? `${facts.tautologicalSignals.length ? `the examples share no cultural signal with ${brand} beyond the concept itself` : `the examples share no consistent cultural signal with ${brand}'s Qloo profile`}` : rule.includes("no meaningful exemplar") ? `no set of examples clearly stood for ${conceptName}` : "the brand-conditioned evidence was not completed"}.`;
      case "NO_SUPPORT_IN_TESTED_SCOPE":
        return `${scope}In the scope tested (Qloo's "${conceptName}"), Qloo returned nothing for ${brand}, and the concept is not on ${brand}'s Qloo profile. This is no support found in that scope, not proof that no relationship exists.`;
      case "CONCEPT_NOT_REPRESENTED":
        return substituted
          ? `Qloo has no concept for ${alignment!.userConcept} as asked. Its closest concept, "${concept!.label}", is ${RELATION_WORDS[relation!]} it, so the evidence below is not an answer about ${alignment!.userConcept}.`
          : `Qloo has no concept that represents ${name} as asked, so this investigation could not test it.`;
      case "INCOMPLETE":
        return `The investigation of ${name} did not finish, so no conclusion is drawn.`;
    }
  })();

  return {
    version: EVIDENCE_ASSESSMENT_VERSION,
    territoryKey: t.key,
    requested: alignment?.userConcept ?? name,
    investigated: concept,
    relation,
    outcome,
    label: EVIDENCE_OUTCOME_LABEL[outcome],
    conclusion,
    rule,
    observed,
    limitations: uniq(limitations),
    missing: uniq(missing),
    comparative: comparativeOf(result, t),
    basis,
  };
}

function coverageOf(result: AgentAnalysisResult, targets: AgentTerritoryResult[]): ConceptCoverage[] {
  const status = (t: AgentTerritoryResult): ConceptCoverage["status"] => {
    if (!t.resolvedConcept) return "NOT_COVERED";
    const r = t.conceptAlignment?.relation;
    return r === "NARROWER" || r === "PARTIAL_COVERAGE" ? "PARTIAL" : r === "RELATED_DIFFERENT" || r === "MISMATCHED" ? "RELATED_ONLY" : "COVERED";
  };
  const note = (t: AgentTerritoryResult) => {
    const s = status(t);
    const q = t.resolvedConcept?.label;
    return s === "COVERED" ? `Investigated as Qloo's "${q}".` : s === "PARTIAL" ? `Qloo's "${q}" covers only part of it.` : s === "RELATED_ONLY" ? `Only Qloo's related concept "${q}" was found.` : "No Qloo concept represented it.";
  };
  const out: ConceptCoverage[] = [];
  const scope = result.researchScope;
  if (scope) {
    for (const part of scope.concepts) {
      const t = targets.find((x) => x.key === part.territoryKey);
      out.push(t ? { concept: part.name, status: status(t), territoryKey: t.key, qlooConcept: t.resolvedConcept?.label ?? null, note: note(t) } : { concept: part.name, status: "NOT_COVERED", territoryKey: null, qlooConcept: null, note: "Not investigated." });
    }
  } else {
    for (const t of targets) out.push({ concept: t.conceptAlignment?.userConcept ?? t.label, status: status(t), territoryKey: t.key, qlooConcept: t.resolvedConcept?.label ?? null, note: note(t) });
  }
  // Parts of a concept a partial anchor left uncovered are listed as their own, uncovered concepts.
  for (const t of targets) {
    for (const part of t.conceptAlignment?.uncovered ?? []) {
      if (!out.some((c) => c.concept.trim().toLowerCase() === part.trim().toLowerCase())) out.push({ concept: part, status: "NOT_COVERED", territoryKey: null, qlooConcept: null, note: `Not covered by Qloo's "${t.resolvedConcept?.label ?? t.label}" and not investigated separately.` });
    }
  }
  return out;
}

/** The research assessment of a stored result: one assessment per target, the concept coverage, and the headline. */
export function assessResearch(result: AgentAnalysisResult): ResearchAssessment {
  const targets = result.territories.filter((t) => t.role === "target");
  const territories = targets.map((t) => assessTerritoryEvidence(result, t));
  const coverage = coverageOf(result, targets);
  const uncovered = coverage.filter((c) => c.status === "NOT_COVERED" && c.territoryKey === null).map((c) => c.concept);
  const lines = territories.length === 1
    ? [territories[0]!.conclusion]
    : territories.map((a) => `${a.requested}: ${a.label.toLowerCase()}.`);
  if (uncovered.length) lines.push(`Not investigated: ${list(uncovered)}. No conclusion about ${uncovered.length === 1 ? "it" : "them"} is drawn from the other evidence.`);
  return {
    version: EVIDENCE_ASSESSMENT_VERSION,
    question: result.userQuery,
    brand: result.brand?.label ?? null,
    territories,
    coverage,
    headline: lines.join(" ") || "No requested territory was investigated.",
  };
}

/** The stored assessment when present, else this function's projection of the stored result (older results). */
export function researchAssessmentOf(result: AgentAnalysisResult): ResearchAssessment {
  return result.evidenceAssessment ?? assessResearch(result);
}

/** Wording an assessment must never contain: strengths, scores, distances, commercial outcomes. Used by tests and evals. */
const FORBIDDEN = /\b(strong(ly)? (fit|affinity|association)|weak (fit|affinity)|score|distance|path|probability|confidence|sales|revenue|demand|will (succeed|sell|win)|proves?|proven)\b|%/iu;

export function evidenceAssessmentViolations(a: TerritoryEvidenceAssessment): string[] {
  const out: string[] = [];
  for (const line of [a.conclusion, ...a.observed.map((o) => o.text), ...a.limitations, ...a.missing, a.comparative.text]) {
    const hit = FORBIDDEN.exec(line);
    if (hit) out.push(`forbidden wording "${hit[0]}" in: ${line}`);
  }
  if (a.outcome === "NO_SUPPORT_IN_TESTED_SCOPE" && !/not proof/iu.test(a.conclusion)) out.push("a no-support conclusion must say it is not proof of no relationship");
  if (a.outcome !== "INCOMPLETE" && a.outcome !== "CONCEPT_NOT_REPRESENTED" && a.investigated === null) out.push("an evidence outcome without an investigated concept");
  if ((a.relation === "RELATED_DIFFERENT" || a.relation === "MISMATCHED") && a.outcome !== "CONCEPT_NOT_REPRESENTED" && a.outcome !== "INCOMPLETE") out.push("evidence about a different concept was read as evidence about the requested one");
  if (a.comparative.status !== "MEASURED" && /\branked\b/iu.test(a.conclusion)) out.push("an unmeasured assessment states a rank");
  return out;
}
