/**
 * Bridge evidence: provider-supplied shared, joint or intermediate signals ("Qloo-supported
 * intermediate cultural signals" for Qloo). They are not graph paths.
 *
 * The output is a set of ingredients, deliberately with no bridge score. No bridge evidence means
 * `unavailable` with signalCount null. An observed empty result that traces to a call means 0.
 */
import type { BridgeIngredients, BridgeSemantics } from "@cultural-elasticity/shared";
import { normalizeSignals } from "../evidence/normalize.js";
import { mergeProvenance, provenanceCoverage } from "../evidence/provenance.js";
import { isObservedBridge } from "../evidence/quality.js";
import type { BridgeEvidence, Limitation } from "../evidence/schema.js";

export function analyzeBridges(bridges: readonly BridgeEvidence[] | undefined): BridgeIngredients {
  const observed = (bridges ?? []).filter(isObservedBridge);
  if (observed.length === 0) {
    return {
      status: "unavailable",
      signalCount: null,
      signals: [],
      bySemantics: {},
      categoryCount: null,
      numericCoverage: null,
      provenance: [],
      provenanceCoverage: null,
      limitations: [{ code: "NO_BRIDGE_EVIDENCE", detail: "no observed bridge evidence; this is unknown, not zero bridges" }],
    };
  }

  const limitations: Limitation[] = [];
  // Same signal under several bridge items: merge it once across all of them (deterministically).
  const signals = normalizeSignals(
    observed.flatMap((bridge) => bridge.signals.map(({ rank: _rank, ...signal }) => signal)),
    "bridge evidence (all items)",
    limitations,
  );
  const bySemantics: Partial<Record<BridgeSemantics, number>> = {};
  for (const bridge of observed) {
    const distinct = new Set(bridge.signals.map((signal) => signal.id)).size;
    bySemantics[bridge.semantics] = (bySemantics[bridge.semantics] ?? 0) + distinct;
  }
  const categories = new Set(signals.flatMap((signal) => (signal.category === undefined ? [] : [signal.category])));

  return {
    status: "available",
    signalCount: signals.length,
    signals,
    bySemantics,
    categoryCount: categories.size === 0 ? null : categories.size,
    numericCoverage: signals.length === 0 ? null : signals.filter((signal) => signal.numeric !== undefined).length / signals.length,
    provenance: mergeProvenance(...observed.map((bridge) => bridge.provenance), ...signals.map((signal) => signal.provenance)),
    provenanceCoverage: provenanceCoverage(signals),
    limitations,
  };
}
