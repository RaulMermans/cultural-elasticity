/**
 * Candidate-relative position within ONE ranking call.
 *
 * Every relative calculation requires a verified single-call scope (see verifyRankingScope). When the
 * scope is unverified, candidates are returned in id order, NOT rank order, and every relative
 * ingredient is `not_comparable`. Scores from separate calls are never merged or normalized together.
 *
 * Position comes from explicit ranks only. Values are not used to infer order (direction unknown).
 */
import type { RankedCandidateView, RankingIngredients } from "@cultural-elasticity/shared";
import { allComparable, verifyRankingScope } from "../evidence/comparability.js";
import { mergeProvenance } from "../evidence/provenance.js";
import type { Limitation, RankedCandidate, RankingEvidence } from "../evidence/schema.js";
import { available, withheld } from "./ingredient.js";

type TargetView = NonNullable<RankingIngredients["target"]>;

export function analyzeRanking(ranking: RankingEvidence | undefined, brandId: string): RankingIngredients {
  if (ranking === undefined) {
    return {
      status: "unavailable",
      scope: null,
      rankedAgainst: null,
      candidateCount: null,
      candidates: [],
      target: null,
      provenance: [],
      limitations: [{ code: "NO_RANKING_EVIDENCE", detail: "no candidate ranking was provided" }],
    };
  }

  const provenance = mergeProvenance(ranking.provenance, ...ranking.candidates.map((candidate) => candidate.provenance));
  const scope = verifyRankingScope(ranking);
  const limitations: Limitation[] = [];
  if (ranking.rankedAgainst !== brandId) {
    limitations.push({ code: "RANKING_NOT_AGAINST_BRAND", detail: `candidates were ranked for "${ranking.rankedAgainst}", not for the brand subject` });
  }
  if (ranking.targetCandidateId === undefined) {
    limitations.push({ code: "TARGET_NOT_AMONG_CANDIDATES", detail: "no candidate is marked as the target" });
  }
  const base = {
    scope: scope.verified
      ? { declared: ranking.comparisonScope, verified: true, correlationId: scope.correlationId }
      : { declared: ranking.comparisonScope, verified: false, reason: scope.reason },
    rankedAgainst: ranking.rankedAgainst,
    candidateCount: ranking.candidates.length,
    provenance,
  };

  if (!scope.verified) {
    const refusal: Limitation = { code: "RANKING_NOT_COMPARABLE", detail: `relative ranking refused: ${scope.reason}` };
    return {
      ...base,
      status: "not_comparable",
      candidates: [...ranking.candidates].sort((a, b) => (a.id < b.id ? -1 : 1)).map(view),
      target: ranking.targetCandidateId === undefined ? null : refusedTarget(ranking.targetCandidateId, refusal),
      limitations: [refusal, ...limitations],
    };
  }

  const unranked = ranking.candidates.filter((candidate) => candidate.rank === undefined).length;
  if (unranked > 0) {
    const missing: Limitation = { code: "UNRANKED_CANDIDATES", detail: `${unranked} candidate(s) have no rank, so positions are undefined` };
    return {
      ...base,
      status: "insufficient_evidence",
      candidates: [...ranking.candidates].sort((a, b) => (a.id < b.id ? -1 : 1)).map(view),
      target: ranking.targetCandidateId === undefined ? null : withheldTarget(ranking.targetCandidateId, "insufficient_evidence", missing),
      limitations: [missing, ...limitations],
    };
  }

  const ordered = [...ranking.candidates].sort((a, b) => (a.rank as number) - (b.rank as number));
  return {
    ...base,
    status: "available",
    candidates: ordered.map(view),
    target: ranking.targetCandidateId === undefined ? null : targetPosition(ordered, ranking.targetCandidateId, provenance),
    limitations,
  };
}

function targetPosition(ordered: RankedCandidate[], targetId: string, provenance: ReturnType<typeof mergeProvenance>): TargetView {
  const n = ordered.length;
  const index = ordered.findIndex((candidate) => candidate.id === targetId);
  const position = index + 1;
  const target = ordered[index] as RankedCandidate;
  const top = ordered[0] as RankedCandidate;
  const bottom = ordered[n - 1] as RankedCandidate;

  const percentile =
    n < 2
      ? withheld<number>("insufficient_evidence", [{ code: "SINGLE_CANDIDATE", detail: "a relative percentile needs at least two candidates" }], provenance)
      : available((n - position) / (n - 1), provenance);

  let gapTop = withheld<number>("insufficient_evidence", [{ code: "MISSING_CANDIDATE_VALUES", detail: "not every candidate carries a value" }], provenance);
  let gapBottom = gapTop;
  const valued = ordered.filter((candidate) => candidate.numeric !== undefined);
  if (valued.length === n) {
    const check = allComparable(valued.map((candidate) => ({ numeric: candidate.numeric!, provenance: candidate.provenance })), "same_ranking");
    if (check.comparable) {
      const note: Limitation = { code: "RAW_VALUE_DIFFERENCE", detail: "raw difference on the call's own scale; direction is not interpreted" };
      gapTop = available(top.numeric!.value - target.numeric!.value, provenance, [note]);
      gapBottom = available(target.numeric!.value - bottom.numeric!.value, provenance, [note]);
    } else {
      gapTop = withheld<number>("not_comparable", [{ code: "CANDIDATE_VALUES_NOT_COMPARABLE", detail: check.reason }], provenance);
      gapBottom = gapTop;
    }
  }

  return {
    candidateId: targetId,
    rankPosition: available(position, provenance),
    relativeRankPercentile: percentile,
    positionsFromTop: available(position - 1, provenance),
    positionsFromBottom: available(n - position, provenance),
    valueGapFromTop: gapTop,
    valueGapFromBottom: gapBottom,
  };
}

function refusedTarget(candidateId: string, refusal: Limitation): TargetView {
  return withheldTarget(candidateId, "not_comparable", refusal);
}

function withheldTarget(candidateId: string, status: "not_comparable" | "insufficient_evidence", limitation: Limitation): TargetView {
  const make = () => withheld<number>(status, [limitation]);
  return {
    candidateId,
    rankPosition: make(),
    relativeRankPercentile: make(),
    positionsFromTop: make(),
    positionsFromBottom: make(),
    valueGapFromTop: make(),
    valueGapFromBottom: make(),
  };
}

function view(candidate: RankedCandidate): RankedCandidateView {
  return {
    id: candidate.id,
    label: candidate.label,
    ...(candidate.rank !== undefined && { rank: candidate.rank }),
    ...(candidate.numeric !== undefined && { numeric: candidate.numeric }),
    provenance: candidate.provenance,
  };
}
