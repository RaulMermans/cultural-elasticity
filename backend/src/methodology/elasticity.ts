/**
 * Cultural Elasticity Methodology v0 (deterministic; no LLM, no agent, no network).
 *
 *   MethodologyInput ─→ panel analysis (one rank call each) ─→ ordinal aggregation (median percentile)
 *     ─→ representation robustness ─→ territory evidence (Sprint 1 core per exemplar)
 *     ─→ operational tag filter ─→ set coherence (RAW and CULTURAL_FILTERED)
 *     ─→ classification (PROVISIONAL) ─→ index gate ─→ CulturalElasticityResult + trace
 *
 * Same input + same METHODOLOGY_VERSION = same output. Output order never depends on input order.
 */
import {
  ELASTICITY_RESULT_SCHEMA_VERSION,
  type CulturalElasticityResult,
  type Limitation,
  type MethodologyTrace,
  type TerritoryElasticity,
  type TerritoryRepresentationView,
} from "@cultural-elasticity/shared";
import { mergeProvenance } from "../evidence/provenance.js";
import type { ProvenanceRef } from "../evidence/schema.js";
import { aggregateTerritories, relativePositions } from "./aggregation.js";
import { classifyTerritory, DEFAULT_THRESHOLDS, type ClassificationThresholds } from "./classification.js";
import { coherenceView } from "./coherence.js";
import { CLASSIFICATION_POLICY, METHODOLOGY_VERSION, RELATIVE_INDEX_DECISION } from "./config.js";
import { MethodologyInputError, parseMethodologyInput, type MethodologyInput, type TerritoryRepresentation } from "./contracts.js";
import { applyOperationalTagPolicy, OPERATIONAL_TAG_POLICY_VERSION, policyDescription, tagFilterReport } from "./operational-tags.js";
import { analyzePanels } from "./panel.js";
import { emittedIndex, evaluateIndexGate, type GateTerritory } from "./relative-index.js";
import { assessRobustness } from "./robustness.js";
import { compareStrings } from "./stats.js";
import { assembleTerritoryEvidence } from "./territory-evidence.js";
import { assertElasticityInvariants } from "./validate.js";

export type AnalyzeOptions = {
  /** Calibration only: evaluate alternative PROVISIONAL thresholds. Product calls use the configured policy. */
  thresholds?: ClassificationThresholds;
};

/** Validates, analyzes and checks invariants. Throws MethodologyInputError for invalid input. */
export function analyzeElasticity(raw: unknown, options: AnalyzeOptions = {}): CulturalElasticityResult {
  const parsed = parseMethodologyInput(raw);
  if (!parsed.ok) throw new MethodologyInputError(parsed.issues);
  const result = computeElasticity(parsed.input, options);
  assertElasticityInvariants(result);
  return result;
}

const METHODOLOGY_LIMITATIONS: Limitation[] = [
  { code: "RELATIVE_TO_COMPARISON_SET", detail: "positions, classes and any index are relative to this candidate set; adding or removing a territory can change them" },
  { code: "NOT_A_SUCCESS_PREDICTION", detail: "this does not predict commercial success, consumer intent or any individual's preference" },
  { code: "TERRITORY_REPRESENTATION_DERIVED", detail: "each territory is represented by human-pinned exemplar entities; the representation is a methodological choice, disclosed per territory" },
  { code: "CLASSIFICATION_PROVISIONAL", detail: "classification thresholds are provisional; the benchmark is too small to validate them" },
  { code: "NO_CULTURAL_DISTANCE_NUMBER", detail: "no Cultural Distance Proxy number is defined in v0; relative position is the only proximity measure" },
];

function representationView(territory: TerritoryRepresentation): TerritoryRepresentationView {
  const exemplars = [...territory.exemplars].sort((a, b) => (a.role === b.role ? compareStrings(a.id, b.id) : a.role === "primary" ? -1 : 1));
  return {
    id: territory.id,
    label: territory.label,
    ...(territory.concept !== undefined && { concept: territory.concept }),
    exemplars,
    rejectedExemplars: territory.rejectedExemplars ?? [],
    assumptions: territory.assumptions,
    approximationWarnings: territory.approximationWarnings,
    provenance: territory.provenance,
  };
}

function sortLimitations(limitations: Limitation[]): Limitation[] {
  const seen = new Set<string>();
  return limitations
    .filter((l) => {
      const key = `${l.code}\u0000${l.detail}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => compareStrings(a.code, b.code) || compareStrings(a.detail, b.detail));
}

export function computeElasticity(input: MethodologyInput, options: AnalyzeOptions = {}): CulturalElasticityResult {
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const territoriesById = new Map(input.territories.map((t) => [t.id, t]));
  const territoryIds = [...territoriesById.keys()].sort(compareStrings);
  const comparisonSet = territoryIds;

  const panels = analyzePanels(input);
  const aggregates = aggregateTerritories(panels.observations);
  const { order, positions } = relativePositions(aggregates);
  const aggregateById = new Map(aggregates.map((a) => [a.territoryId, a]));

  const brandFilter = applyOperationalTagPolicy(input.brand);
  const exemplarFilters = new Map(input.exemplarProfiles.map((profile) => [profile.subject.id, applyOperationalTagPolicy(profile)]));

  const panelProvenance = (exemplarIds: Set<string>): ProvenanceRef[] =>
    mergeProvenance(
      ...input.panels
        .filter((p) => p.purpose !== "repeat" && panels.validAggregatedPanelIds.includes(p.id))
        .flatMap((p) => (p.ranking?.candidates ?? []).filter((c) => exemplarIds.has(c.id)).map((c) => c.provenance)),
    );

  const gateTerritories: GateTerritory[] = [];
  const built = territoryIds.map((id) => {
    const territory = territoriesById.get(id)!;
    const aggregate = aggregateById.get(id)!;
    const position = positions.get(id)!;
    const evidence = assembleTerritoryEvidence(input, territory);
    const robustness = assessRobustness(territory, aggregate.observations, panels);
    const exemplarRefs = territory.exemplars.map((e) => ({ id: e.id, label: e.label }));
    const coherenceRaw = coherenceView("RAW", input.brand, exemplarRefs.map((exemplar) => ({ exemplar, profile: exemplarFilters.get(exemplar.id)?.raw })), null);
    const coherenceFiltered = coherenceView(
      "CULTURAL_FILTERED",
      brandFilter.filtered,
      exemplarRefs.map((exemplar) => ({ exemplar, profile: exemplarFilters.get(exemplar.id)?.filtered })),
      OPERATIONAL_TAG_POLICY_VERSION,
    );
    const classification = classifyTerritory({ position, robustness, evidenceQuality: evidence.evidenceQuality }, thresholds);
    gateTerritories.push({ territory, observations: aggregate.observations, medianPercentile: aggregate.medianPercentile, robustness, evidenceQuality: evidence.evidenceQuality });

    const limitations: Limitation[] = [...evidence.limitations, ...(evidence.conditionedView?.limitations ?? [])];
    for (const warning of territory.approximationWarnings) limitations.push({ code: "TERRITORY_APPROXIMATION", detail: `${territory.id}: ${warning}` });
    if (robustness.level === "INSUFFICIENT" || robustness.level === "LOW") limitations.push({ code: `ROBUSTNESS_${robustness.level}`, detail: `${territory.id}: ${robustness.reasons.join("; ")}` });

    const exemplarIds = new Set(territory.exemplars.map((e) => e.id));
    const provenance = mergeProvenance(
      territory.provenance,
      ...territory.exemplars.map((e) => e.provenance),
      panelProvenance(exemplarIds),
      ...territory.exemplars.map((e) => exemplarFilters.get(e.id)?.raw.provenance ?? []),
      evidence.conditionedView?.provenance ?? [],
    );

    const view: TerritoryElasticity = {
      territory: representationView(territory),
      relativePosition: position,
      panelEvidence: aggregate.observations,
      pairwise: aggregate.pairwise,
      robustness,
      coherenceRaw,
      coherenceFiltered,
      conditionedEvidence: evidence.conditionedView,
      classification,
      evidenceQuality: evidence.evidenceQuality,
      limitations: sortLimitations(limitations),
      provenance,
    };
    return view;
  });

  const indexGate = evaluateIndexGate({
    territories: gateTerritories,
    panelReports: panels.reports,
    repeatChecks: panels.repeatChecks,
    aggregatedPanelIds: panels.aggregatedPanelIds,
    validAggregatedPanelIds: panels.validAggregatedPanelIds,
  });
  for (const view of built) {
    const gateTerritory = gateTerritories.find((g) => g.territory.id === view.territory.id)!;
    const index = emittedIndex(gateTerritory, indexGate, comparisonSet);
    if (index !== undefined) view.relativeElasticityIndex = index;
  }
  const rank = new Map(order.map((id, i) => [id, i]));
  const territories = built.sort((a, b) => rank.get(a.territory.id)! - rank.get(b.territory.id)!);

  const brandReport = tagFilterReport(brandFilter);
  const limitations: Limitation[] = [...input.limitations, ...METHODOLOGY_LIMITATIONS];
  limitations.push({
    code: RELATIVE_INDEX_DECISION.decision === "APPROVED" ? "RELATIVE_INDEX_APPROVED" : "RELATIVE_INDEX_REJECTED_FOR_NOW",
    detail: RELATIVE_INDEX_DECISION.decision === "APPROVED" ? "a Relative Elasticity Index is shown only where this analysis passes the index gate" : "no 0–100 index is produced; use relative position, robustness, coherence and classification",
  });
  if (input.brand.truncated === true) limitations.push({ code: "TAG_OVERLAP_TRUNCATED", detail: `tag overlap is computed on top-${input.tagTake} profiles at one fixed take` });
  for (const report of panels.reports) if (report.status !== "valid") limitations.push({ code: `PANEL_${report.status.toUpperCase()}`, detail: `panel ${report.id}: ${report.reasons.join("; ")}` });

  const trace: MethodologyTrace = {
    methodologyVersion: METHODOLOGY_VERSION,
    steps: [
      { step: "brand", detail: `${input.brand.subject.label} (${input.brand.subject.id}); ${input.brand.signals.length} tag signals at take ${input.tagTake}` },
      { step: "territory_representations", detail: territories.map((t) => `${t.territory.label}: ${t.territory.exemplars.map((e) => e.label).join(", ")}`).join(" | ") },
      { step: "panel_calls", detail: panels.reports.map((p) => `${p.id} (${p.purpose}) ${p.status}${p.correlationId ? ` ${p.correlationId}` : ""}`).join("; ") },
      { step: "aggregation", detail: "median over aggregated panels of the rank percentile (n − rank)/(n − 1); ranks only, raw values never compared across panels" },
      { step: "robustness", detail: territories.map((t) => `${t.territory.id} ${t.robustness.level}`).join(", ") },
      { step: "tag_filtering", detail: `${OPERATIONAL_TAG_POLICY_VERSION}: brand keeps ${brandReport.keptCount} of ${brandReport.rawCount} signals` },
      { step: "overlap", detail: territories.map((t) => `${t.territory.id} shared median raw ${t.coherenceRaw.summary?.sharedCountMedian ?? "n/a"} / filtered ${t.coherenceFiltered.summary?.sharedCountMedian ?? "n/a"}`).join(", ") },
      { step: "classification", detail: territories.map((t) => `${t.territory.id} ${t.classification.label}`).join(", ") },
      { step: "index", detail: `decision ${RELATIVE_INDEX_DECISION.decision}; gate ${indexGate.status}` },
    ],
    panels: panels.reports.map((p) => ({ id: p.id, purpose: p.purpose, correlationId: p.correlationId, ranks: p.order.map((o) => ({ territoryId: o.territoryId, exemplarId: o.exemplarId, rank: o.rank })) })),
    aggregation: territories.map((t) => ({ territoryId: t.territory.id, percentiles: t.panelEvidence.map((o) => o.percentile), medianPercentile: t.relativePosition.medianPercentile, position: t.relativePosition.position })),
    robustness: territories.map((t) => ({ territoryId: t.territory.id, level: t.robustness.level, percentileSpread: t.robustness.percentileSpread })),
    tagFiltering: [brandReport, ...[...exemplarFilters.values()].map(tagFilterReport)]
      .sort((a, b) => (a.profileSubjectId === input.brand.subject.id ? -1 : b.profileSubjectId === input.brand.subject.id ? 1 : compareStrings(a.profileSubjectId, b.profileSubjectId)))
      .map((r) => ({ profileSubjectId: r.profileSubjectId, kept: r.keptCount, excluded: r.excluded.length })),
    coherence: territories.map((t) => ({ territoryId: t.territory.id, rawSharedMedian: t.coherenceRaw.summary?.sharedCountMedian ?? null, filteredSharedMedian: t.coherenceFiltered.summary?.sharedCountMedian ?? null })),
    classification: territories.map((t) => ({ territoryId: t.territory.id, label: t.classification.label })),
    index: { decision: RELATIVE_INDEX_DECISION.decision, gate: indexGate.status, emitted: territories.filter((t) => t.relativeElasticityIndex !== undefined).length },
  };

  return {
    schemaVersion: ELASTICITY_RESULT_SCHEMA_VERSION,
    methodologyVersion: METHODOLOGY_VERSION,
    evidenceOrigin: input.origin,
    brand: input.brand.subject,
    comparisonSet: {
      territories: territoryIds.map((id) => ({ id, label: territoriesById.get(id)!.label })),
      panels: panels.aggregatedPanelIds,
      note: "Every relative statement in this result holds only for this set of territories and these panels.",
    },
    semantics: {
      relativePosition: "Where the territory sits among this candidate set: the median, over panels, of its rank percentile in one same-call rank of territory exemplars for the brand. Rank-only; raw values are never compared across calls.",
      representationRobustness: "Whether that position survives swapping the territory's exemplars (rule-based HIGH/MEDIUM/LOW/INSUFFICIENT; not a probability).",
      culturalCoherence: "Which tag signals the brand and each territory exemplar share, by set membership only, in a RAW and an operational-filtered view. Explanatory; not used to classify.",
      evidenceQuality: "Whether the evidence packets are technically trustworthy and complete (Sprint 1 Cultural Evidence Core). Independent of robustness.",
      classification: `Relative to the comparison set; PROVISIONAL thresholds. ${CLASSIFICATION_POLICY.basis}`,
      notMeasured: [
        "commercial success or its likelihood",
        "consumer purchase intent",
        "any individual's preference",
        "a measured network separation between brand and territory (Qloo exposes none)",
        "audience adjacency (no documented audience metric)",
        "bridge strength (bridge evidence is qualitative only)",
        "novelty or momentum (unsupported by live evidence)",
      ],
    },
    territories,
    panels: panels.reports,
    repeatChecks: panels.repeatChecks,
    brandTagFilter: brandReport,
    operationalTagPolicy: policyDescription(),
    classificationPolicy: { status: "PROVISIONAL", naturalAdjacencyMinMedianPercentile: thresholds.naturalAdjacencyMin, culturalBreakMaxMedianPercentile: thresholds.culturalBreakMax, basis: CLASSIFICATION_POLICY.basis },
    indexDecision: { decision: RELATIVE_INDEX_DECISION.decision, basis: RELATIVE_INDEX_DECISION.basis },
    indexGate,
    limitations: sortLimitations(limitations),
    provenance: mergeProvenance(input.provenance, input.brand.provenance, input.brand.subject.provenance, ...territories.map((t) => t.provenance)),
    trace,
  };
}
