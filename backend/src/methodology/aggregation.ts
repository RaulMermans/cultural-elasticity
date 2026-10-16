/**
 * Ordinal aggregation across panels.
 *
 * Chosen method: MEDIAN PANEL PERCENTILE. For each territory, take its rank percentile
 * (n − rank) / (n − 1) in every valid aggregated panel and use the median as the central ordinal
 * position. Dispersion (spread, best/worst rank) is reported separately as representation robustness,
 * never folded into the position. Pairwise wins/losses are reported as supporting evidence and used
 * only to order ties for display; tied territories keep the same position.
 *
 * Alternatives considered (see the methodology doc): mean percentile / Borda count (one bad exemplar
 * drags the mean), pairwise win rate / Copeland (sensible but harder to read, ties common with 2–3
 * panels), Kemeny consensus (optimal but opaque and NP-hard). The median is the simplest method that
 * uses ranks only, resists one outlying exemplar when there are three panels, and is explainable.
 */
import type { PairwiseRecord, PanelObservation, RelativePosition } from "@cultural-elasticity/shared";
import { compareStrings, median } from "./stats.js";

export type TerritoryAggregate = {
  territoryId: string;
  observations: PanelObservation[];
  medianPercentile: number | null;
  medianRank: number | null;
  bestRank: number | null;
  pairwise: PairwiseRecord[];
};

export function aggregateTerritories(observations: ReadonlyMap<string, readonly PanelObservation[]>): TerritoryAggregate[] {
  const ids = [...observations.keys()].sort(compareStrings);
  return ids.map((territoryId) => {
    const own = [...observations.get(territoryId)!].sort((a, b) => compareStrings(a.panelId, b.panelId));
    const pairwise = ids
      .filter((other) => other !== territoryId)
      .map((other) => {
        const theirs = new Map(observations.get(other)!.map((o) => [o.panelId, o.rank]));
        let wins = 0;
        let losses = 0;
        for (const o of own) {
          const rank = theirs.get(o.panelId);
          if (rank === undefined) continue;
          if (o.rank < rank) wins += 1;
          else losses += 1;
        }
        return { otherTerritoryId: other, wins, losses, sharedPanels: wins + losses };
      });
    return {
      territoryId,
      observations: own,
      medianPercentile: own.length === 0 ? null : median(own.map((o) => o.percentile)),
      medianRank: own.length === 0 ? null : median(own.map((o) => o.rank)),
      bestRank: own.length === 0 ? null : Math.min(...own.map((o) => o.rank)),
      pairwise,
    };
  });
}

/** Number of other territories this one beats in a strict majority of shared panels (Copeland count). */
function majorityWins(aggregate: TerritoryAggregate): number {
  return aggregate.pairwise.filter((p) => p.wins > p.losses).length;
}

/**
 * Competition ranking on the median percentile (ties share a position), and a deterministic display
 * order: median desc → majority wins desc → best rank asc → id.
 */
export function relativePositions(aggregates: readonly TerritoryAggregate[]): { order: string[]; positions: Map<string, RelativePosition> } {
  const withEvidence = aggregates.filter((a) => a.medianPercentile !== null);
  const positions = new Map<string, RelativePosition>();
  for (const aggregate of aggregates) {
    if (aggregate.medianPercentile === null) {
      positions.set(aggregate.territoryId, { status: "insufficient_evidence", position: null, of: withEvidence.length, medianPercentile: null, medianRank: null, tiedWith: [], semantics: "relative_candidate_position" });
      continue;
    }
    const m = aggregate.medianPercentile;
    positions.set(aggregate.territoryId, {
      status: "available",
      position: 1 + withEvidence.filter((other) => (other.medianPercentile as number) > m).length,
      of: withEvidence.length,
      medianPercentile: m,
      medianRank: aggregate.medianRank,
      tiedWith: withEvidence.filter((other) => other.territoryId !== aggregate.territoryId && other.medianPercentile === m).map((other) => other.territoryId),
      semantics: "relative_candidate_position",
    });
  }
  const order = [...aggregates]
    .sort(
      (a, b) =>
        (b.medianPercentile ?? -1) - (a.medianPercentile ?? -1) ||
        majorityWins(b) - majorityWins(a) ||
        (a.bestRank ?? Infinity) - (b.bestRank ?? Infinity) ||
        compareStrings(a.territoryId, b.territoryId),
    )
    .map((a) => a.territoryId);
  return { order, positions };
}
