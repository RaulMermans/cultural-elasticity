/**
 * Comparability model. A calculator that compares two numbers must ask here first and must refuse
 * (return `not_comparable`) when the answer is no. Nothing is normalized to make it comparable.
 *
 * Two values are comparable only when ALL of the following hold:
 *   1. neither scope is `unknown`;
 *   2. both declare the same scope;
 *   3. both declare the same scale, or both declare none;
 *   4. the scope itself permits the comparison:
 *        within_call          each value comes from exactly one identifiable call, and it is the same call
 *        within_profile       the comparison is inside a single profile
 *        cross_call_verified  a scale is declared (verification is meaningless without one)
 */
import { singleCorrelationId } from "./provenance.js";
import type { NumericEvidence, ProvenanceRef, RankingEvidence } from "./schema.js";

export type ComparisonContext = "same_profile" | "cross_profile" | "same_ranking";

export type Comparability = { comparable: true } | { comparable: false; reason: string };

export type NumericObservation = { numeric: NumericEvidence; provenance: readonly ProvenanceRef[] };

export function compareNumeric(a: NumericObservation, b: NumericObservation, context: ComparisonContext): Comparability {
  const scopeA = a.numeric.comparisonScope;
  const scopeB = b.numeric.comparisonScope;
  if (scopeA === "unknown" || scopeB === "unknown") return refuse("a value has an unknown comparison scope");
  if (scopeA !== scopeB) return refuse(`values declare different comparison scopes (${scopeA} vs ${scopeB})`);
  if ((a.numeric.scale ?? null) !== (b.numeric.scale ?? null)) {
    return refuse(`values declare different or partially declared scales (${a.numeric.scale ?? "none"} vs ${b.numeric.scale ?? "none"})`);
  }
  switch (scopeA) {
    case "within_call": {
      const callA = singleCorrelationId(a.provenance);
      const callB = singleCorrelationId(b.provenance);
      if (callA === undefined || callB === undefined) return refuse("within_call value does not trace to exactly one identifiable call");
      if (callA !== callB) return refuse(`within_call values come from different calls (${callA} vs ${callB})`);
      return { comparable: true };
    }
    case "within_profile":
      return context === "same_profile" ? { comparable: true } : refuse("within_profile values may only be compared inside one profile");
    case "cross_call_verified":
      return a.numeric.scale === undefined ? refuse("cross_call_verified comparison requires a declared scale") : { comparable: true };
  }
}

/** All observations pairwise comparable. The rules are equality-based, so checking against the first suffices. */
export function allComparable(observations: readonly NumericObservation[], context: ComparisonContext): Comparability {
  const [first, ...rest] = observations;
  if (first === undefined) return refuse("no numeric values");
  for (const other of rest) {
    const result = compareNumeric(first, other, context);
    if (!result.comparable) return result;
  }
  return { comparable: true };
}

export type RankingScopeVerification = { verified: true; correlationId: string } | { verified: false; reason: string };

/**
 * A ranking is comparable across its candidates only when it is declared `single_call` AND every
 * candidate (and any ranking-level provenance) traces to the same single correlation id.
 * Separate ranking calls are never merged.
 */
export function verifyRankingScope(ranking: RankingEvidence): RankingScopeVerification {
  if (ranking.comparisonScope !== "single_call") return { verified: false, reason: "ranking comparison scope is not declared single_call" };
  const calls = new Set<string>();
  for (const candidate of ranking.candidates) {
    const call = singleCorrelationId(candidate.provenance);
    if (call === undefined) return { verified: false, reason: `candidate "${candidate.id}" does not trace to exactly one identifiable call` };
    calls.add(call);
  }
  for (const ref of ranking.provenance) if (ref.correlationId !== undefined) calls.add(ref.correlationId);
  if (calls.size !== 1) return { verified: false, reason: `declared single_call, but candidates trace to ${calls.size} different calls` };
  return { verified: true, correlationId: [...calls][0] as string };
}

function refuse(reason: string): Comparability {
  return { comparable: false, reason };
}
