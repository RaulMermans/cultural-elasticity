/**
 * Distance-proxy ingredients: the individually defensible measurements a future Cultural Distance
 * Proxy may draw on. There is NO formula here (`formula: "NOT_DEFINED"`), no weights and no
 * combination. Each ingredient carries its own availability, provenance and limitations, so missing
 * evidence reaches consumers as `null` plus a status, never as 0.
 */
import type {
  AudienceIngredients,
  BridgeIngredients,
  DistanceProxyIngredients,
  OverlapReport,
  ProfileCoverageReport,
  RankingIngredients,
  StabilityReport,
} from "@cultural-elasticity/shared";
import { available, withheld } from "./ingredient.js";

export type DistanceProxyInputs = {
  overlap: OverlapReport;
  coverage: ProfileCoverageReport;
  stability: StabilityReport;
  audience: AudienceIngredients;
  ranking: RankingIngredients;
  bridges: BridgeIngredients;
  brandId: string;
};

export function buildDistanceProxyIngredients(inputs: DistanceProxyInputs): DistanceProxyIngredients {
  const { overlap, coverage, stability, audience, ranking, bridges, brandId } = inputs;
  const overlapAvailable = overlap.status === "available";
  const overlapMissing = <T>() => withheld<T>("insufficient_evidence", overlap.limitations, overlap.provenance);

  return {
    formula: "NOT_DEFINED",
    jaccardOverlap: overlapAvailable ? available(overlap.jaccard as number, overlap.provenance, overlap.limitations) : overlapMissing(),
    overlapCoefficient: overlapAvailable ? available(overlap.overlapCoefficient as number, overlap.provenance, overlap.limitations) : overlapMissing(),
    sharedSignalCount: overlapAvailable ? available(overlap.sharedSignalCount, overlap.provenance, overlap.limitations) : overlapMissing(),
    weightedSharedOverlap: overlap.weightedSharedOverlap,
    relativeRankPercentile: rankPercentile(ranking, brandId),
    audienceMetrics:
      audience.status === "available"
        ? available(audience.metrics.filter((metric) => metric.usableAsIngredient), audience.provenance, audience.limitations)
        : withheld(audience.status, audience.limitations, audience.provenance),
    bridgeSignalCount:
      bridges.status === "available" ? available(bridges.signalCount as number, bridges.provenance, bridges.limitations) : withheld("unavailable", bridges.limitations),
    profileCoverage: overlapAvailable
      ? available(
          {
            brandSignals: overlap.brandSignalCount,
            targetSignals: overlap.targetSignalCount,
            sharedOfBrand: coverage.sharedOfBrand as number,
            sharedOfTarget: coverage.sharedOfTarget as number,
          },
          overlap.provenance,
          overlap.limitations,
        )
      : overlapMissing(),
    profileStability:
      stability.status === "available" && stability.summary
        ? available(
            { jaccardMin: stability.summary.jaccardMin, jaccardMax: stability.summary.jaccardMax, jaccardRange: stability.summary.jaccardRange },
            overlap.provenance,
            stability.limitations,
          )
        : withheld("insufficient_evidence", stability.limitations, overlap.provenance),
  };
}

function rankPercentile(ranking: RankingIngredients, brandId: string) {
  if (ranking.target === null) {
    return withheld<number>(ranking.status === "not_comparable" ? "not_comparable" : "unavailable", ranking.limitations, ranking.provenance);
  }
  const percentile = ranking.target.relativeRankPercentile;
  if (percentile.status === "available" && ranking.rankedAgainst !== brandId) {
    return withheld<number>(
      "not_comparable",
      [{ code: "RANKING_NOT_AGAINST_BRAND", detail: `percentile is relative to "${ranking.rankedAgainst}", not the brand` }],
      percentile.provenance,
    );
  }
  return percentile;
}
