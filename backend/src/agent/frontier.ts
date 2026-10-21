/**
 * Frontier candidate set: validation, diversity and comparison-set construction.
 *
 * Two candidate channels feed EXPLORE_FRONTIER:
 *   qloo_grounded     concepts derived from Qloo evidence (related-entity profiles, tags, pools)
 *   agent_hypothesis  lateral territories the model proposes; NEVER accepted because the model named them
 * Before analysis every frontier candidate must pass, in order:
 *   resolution   anchored to a Qloo concept                                  else TERRITORY_UNRESOLVED
 *   qloo_support Qloo returned ≥ 1 brand-independent member for the concept  else HYPOTHESIS_UNSUPPORTED
 *   semantic     (Sprint 5A) not a venue-listing attribute / operational tag  else INCIDENTAL_CONCEPT;
 *                not judged weak/mismatched by the agent (advisory veto)       else SEMANTIC_REFERENCE_REJECTED
 *   (representation feasibility and evidence availability are then decided by the analysis route)
 * Then duplicates are removed (concept-dedup.ts) and, when more candidates exist than the set needs,
 * candidates that overlap an earlier one culturally are pruned for diversity.
 *
 * Relative positions and classes depend on the comparison set, so how the set was built is always
 * recorded (ComparisonSetConstruction) and returned with the result.
 */
import type { AgentTerritoryResult, CandidateSource, ComparisonSetConstruction } from "@cultural-elasticity/shared";
import { setOverlap } from "../analysis/overlap.js";
import { matchOperationalRule } from "../methodology/operational-tags.js";
import { labelTokens } from "./candidate-discovery.js";
import { MIN_FRONTIER_SUPPORTED } from "./contracts.js";
import { incidentalConcept } from "./semantic-comparison.js";
import type { AgentRunState, TerritoryState } from "./state.js";

/** Union-of-exemplar-profile Jaccard at or above this marks two candidates as culturally overlapping. */
export const DIVERSITY_OVERLAP = 0.5;

/** Qloo support for a concept: a non-empty brand-independent pool of any type, or a profile carrying it. */
export function qlooSupport(state: AgentRunState, t: TerritoryState): boolean {
  if (!t.concept) return false;
  const brandId = state.brand.entity?.id;
  if (state.pools.some((p) => p.conditionedOn === null && p.tagIds.includes(t.concept!.id) && p.memberIds.some((id) => id !== brandId))) return true;
  return [...state.profiles.values()].some((p) => p.subjectId !== brandId && p.tagIds.includes(t.concept!.id));
}

function drop(state: AgentRunState, t: TerritoryState, stage: AgentRunState["candidateRejections"][number]["stage"], code: NonNullable<TerritoryState["dropReason"]>["code"], detail: string) {
  t.status = "dropped";
  t.dropReason = { code, detail };
  state.candidateRejections.push({ key: t.key, stage, code, reason: detail });
}

/** Resolution and Qloo-support gates for frontier candidates in `keys` (dropped ones are removed). */
export function gateFrontierCandidates(state: AgentRunState, keys: readonly string[]): string[] {
  for (const key of keys) {
    const t = state.territories.find((x) => x.key === key);
    if (!t || t.role !== "frontier_candidate" || t.status === "dropped" || t.status === "analyzed") continue;
    if (!t.concept) drop(state, t, "resolution", "TERRITORY_UNRESOLVED", `${t.source === "agent_hypothesis" ? "agent hypothesis" : "candidate"} was never anchored to a Qloo concept`);
    else if (!qlooSupport(state, t)) drop(state, t, "qloo_support", "HYPOTHESIS_UNSUPPORTED", `Qloo returned no brand-independent member for ${t.concept.label}; the hypothesis is not supported by Qloo evidence`);
    else if (incidentalConcept(t.concept.id)) drop(state, t, "semantic", "INCIDENTAL_CONCEPT", `${t.concept.label}: ${incidentalConcept(t.concept.id)!.explanation}`);
    else if (t.semanticJudgment && (t.semanticJudgment.relevance === "WEAK" || t.semanticJudgment.relevance === "MISMATCH")) drop(state, t, "semantic", "SEMANTIC_REFERENCE_REJECTED", `the agent judged ${t.concept.label} ${t.semanticJudgment.relevance.toLowerCase()} as a frontier territory (advisory veto): ${t.semanticJudgment.reason}`);
  }
  return keys.filter((k) => state.territories.some((t) => t.key === k && t.status !== "dropped"));
}

/** Cultural tags across a territory's exemplar profiles (null when no exemplar profile is known). */
function culturalUnion(state: AgentRunState, t: TerritoryState): Set<string> | null {
  const profiles = (t.representation?.exemplars ?? []).flatMap((e) => (state.profiles.get(e.id) ? [state.profiles.get(e.id)!.tagIds] : []));
  if (profiles.length === 0) return null;
  return new Set(profiles.flat().filter((id) => matchOperationalRule({ id }) === undefined));
}

export type SimilarPair = { a: string; b: string; basis: string; similarity: number };

/** Pairwise cultural overlap between candidates, from exemplar profiles and label tokens. */
export function similarPairs(state: AgentRunState, territories: readonly TerritoryState[]): { pairs: SimilarPair[]; unknown: boolean } {
  const pairs: SimilarPair[] = [];
  let unknown = false;
  for (let i = 0; i < territories.length; i += 1) {
    for (let j = i + 1; j < territories.length; j += 1) {
      const a = territories[i]!;
      const b = territories[j]!;
      const ua = culturalUnion(state, a);
      const ub = culturalUnion(state, b);
      if (ua && ub) {
        const jaccard = setOverlap(ua, ub).jaccard ?? 0;
        if (jaccard >= DIVERSITY_OVERLAP) pairs.push({ a: a.key, b: b.key, basis: `exemplar profiles share ${Math.round(jaccard * 100) / 100} of their cultural tags (Jaccard)`, similarity: jaccard });
      } else {
        unknown = true;
      }
      const tokens = setOverlap(labelTokens(a.label), labelTokens(b.label)).jaccard ?? 0;
      if (tokens >= 0.5 && !pairs.some((p) => p.a === a.key && p.b === b.key)) pairs.push({ a: a.key, b: b.key, basis: "labels share most words", similarity: tokens });
    }
  }
  return { pairs, unknown };
}

/** Drops later candidates that overlap an earlier kept one, while ≥ MIN_FRONTIER_SUPPORTED would remain. */
export function pruneForDiversity(state: AgentRunState, keys: readonly string[]): string[] {
  const candidates = keys.map((k) => state.territories.find((t) => t.key === k)!).filter((t) => t.role === "frontier_candidate" && t.status !== "dropped" && t.status !== "analyzed");
  if (candidates.length <= MIN_FRONTIER_SUPPORTED) return [...keys];
  const kept: TerritoryState[] = [];
  let remaining = candidates.length;
  for (const t of candidates) {
    const near = kept.find((k) => similarPairs(state, [k, t]).pairs.some((p) => p.basis.startsWith("exemplar profiles")));
    if (near && remaining > MIN_FRONTIER_SUPPORTED) {
      drop(state, t, "diversity", "LOW_DIVERSITY", `culturally overlaps ${near.label} (exemplar profiles); kept the earlier candidate so the set spans different territories`);
      remaining -= 1;
      continue;
    }
    kept.push(t);
  }
  return keys.filter((k) => state.territories.some((t) => t.key === k && t.status !== "dropped"));
}

const STAGE_BY_CODE: Record<string, ComparisonSetConstruction["rejected"][number]["stage"]> = {
  TERRITORY_UNRESOLVED: "resolution",
  TERRITORY_AMBIGUOUS: "resolution",
  HYPOTHESIS_UNSUPPORTED: "qloo_support",
  QLOO_EMPTY: "qloo_support",
  NO_VALID_REPRESENTATION: "representation",
  REPRESENTATION_QUALITY_WEAK: "representation",
  DUPLICATE_TERRITORY: "dedup",
  LOW_DIVERSITY: "diversity",
  BUDGET_EXHAUSTED: "budget",
  INCIDENTAL_CONCEPT: "semantic",
  SEMANTIC_REFERENCE_REJECTED: "semantic",
};

const NOTE =
  "Relative positions and provisional classes hold only for this comparison set: a different set of territories can change every position. The set was assembled from the candidates listed here; rejected candidates and the reason for each rejection are shown.";

export function comparisonSetConstruction(state: AgentRunState, results: readonly AgentTerritoryResult[]): ComparisonSetConstruction {
  const byKey = new Map(results.map((r) => [r.key, r]));
  const sourceOf = (t: TerritoryState): CandidateSource => (t.role === "reference" ? "reference_strategy" : t.source);
  const rejected: ComparisonSetConstruction["rejected"] = [];
  for (const t of state.territories) {
    const recorded = [...state.candidateRejections].reverse().find((r) => r.key === t.key);
    if (t.status === "dropped") {
      rejected.push({ key: t.key, label: t.label, stage: recorded?.stage ?? STAGE_BY_CODE[t.dropReason?.code ?? ""] ?? "agent", code: t.dropReason?.code ?? "DROPPED", reason: t.dropReason?.detail ?? "dropped" });
      continue;
    }
    const r = byKey.get(t.key);
    if (t.role !== "target" && r?.analysisRoute === "INSUFFICIENT_EVIDENCE") {
      rejected.push({ key: t.key, label: t.label, stage: "evidence", code: r.representation.failure?.code ?? "INSUFFICIENT_EVIDENCE", reason: r.representation.failure?.detail ?? "no measurable Qloo evidence" });
    }
  }
  const finalTerritories = state.territories.filter((t) => t.status !== "dropped" && byKey.has(t.key) && !rejected.some((x) => x.key === t.key));
  const frontier = finalTerritories.filter((t) => t.role !== "target");
  const diversity = similarPairs(state, frontier);
  return {
    intent: state.interpretation?.intent ?? null,
    proposed: state.territories.map((t) => ({ key: t.key, label: t.label, role: t.role, source: sourceOf(t), evidence: t.sourceEvidence })),
    rejected,
    final: finalTerritories.map((t) => ({ key: t.key, label: t.label, role: t.role, source: sourceOf(t), route: byKey.get(t.key)!.analysisRoute })),
    dedupDecisions: state.trace.conceptDedup,
    semanticAssessments: state.semanticAssessments,
    diversity: {
      assessment: frontier.length < 2 ? "unknown" : diversity.pairs.length > 0 ? "overlapping" : diversity.unknown ? "unknown" : "diverse",
      similarPairs: diversity.pairs.map(({ a, b, basis }) => ({ a, b, basis })),
      detail:
        frontier.length < 2
          ? "fewer than two non-target territories: diversity not assessed"
          : diversity.pairs.length > 0
            ? `${diversity.pairs.length} overlapping pair(s) remain`
            : diversity.unknown
              ? "no overlap detected, but not every candidate has exemplar profiles"
              : "no pair of candidates overlaps culturally in Qloo evidence",
    },
    note: NOTE,
  };
}

// ---- Frontier set stability (repeated runs of the same request) ----

export type FrontierRun = { candidates: { key: string; label: string; conceptId: string | null; route: string; position: number | null; classification: string | null }[] };

export type FrontierStability = {
  runs: number;
  /** Mean pairwise Jaccard of candidate labels (normalized). */
  exactCandidateOverlap: number | null;
  /** Mean pairwise Jaccard of resolved Qloo concept ids. */
  resolvedConceptOverlap: number | null;
  /** Share of runs whose top-positioned candidate concept equals the most common top concept. */
  topCandidateConsistency: number | null;
  /** For concepts analyzed with a class in ≥ 2 runs: share with an identical class every time. */
  methodologyStability: number | null;
};

const mean = (values: number[]) => (values.length === 0 ? null : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1000) / 1000);

export function frontierStability(runs: readonly FrontierRun[]): FrontierStability {
  const pairwise = (key: (c: FrontierRun["candidates"][number]) => string | null) => {
    const values: number[] = [];
    for (let i = 0; i < runs.length; i += 1)
      for (let j = i + 1; j < runs.length; j += 1) {
        const a = runs[i]!.candidates.map(key).filter((x): x is string => x !== null);
        const b = runs[j]!.candidates.map(key).filter((x): x is string => x !== null);
        values.push(setOverlap(a, b).jaccard ?? (a.length === 0 && b.length === 0 ? 1 : 0));
      }
    return mean(values);
  };
  const tops = runs.map((r) => [...r.candidates].filter((c) => c.position !== null).sort((a, b) => a.position! - b.position!)[0]?.conceptId ?? null).filter((x): x is string => x !== null);
  const counts = new Map<string, number>();
  for (const t of tops) counts.set(t, (counts.get(t) ?? 0) + 1);
  const modal = Math.max(0, ...counts.values());
  const classes = new Map<string, Set<string>>();
  const seen = new Map<string, number>();
  for (const r of runs)
    for (const c of r.candidates) {
      if (!c.conceptId || !c.classification) continue;
      seen.set(c.conceptId, (seen.get(c.conceptId) ?? 0) + 1);
      classes.set(c.conceptId, (classes.get(c.conceptId) ?? new Set()).add(c.classification));
    }
  const repeated = [...seen.entries()].filter(([, n]) => n >= 2).map(([id]) => id);
  return {
    runs: runs.length,
    exactCandidateOverlap: runs.length < 2 ? null : pairwise((c) => c.label.trim().toLowerCase()),
    resolvedConceptOverlap: runs.length < 2 ? null : pairwise((c) => c.conceptId),
    topCandidateConsistency: tops.length === 0 ? null : Math.round((modal / runs.length) * 1000) / 1000,
    methodologyStability: repeated.length === 0 ? null : Math.round((repeated.filter((id) => classes.get(id)!.size === 1).length / repeated.length) * 1000) / 1000,
  };
}
