/**
 * Multi-exemplar candidate panels. A panel is ONE rank call over one exemplar per territory, ranked for
 * the brand. Inside a panel the order is usable (and raw values may be shown, labelled within-call).
 * Across panels ONLY rank positions and rank percentiles are compared; raw values never are.
 *
 * A panel is usable only when its single-call scope is verified (every candidate traces to the same
 * correlation id) and every candidate carries an explicit rank. Positions come from rank order, never
 * from values. Repeat panels test determinism and are never aggregated (no double counting).
 */
import type { PanelObservation, PanelReport, RepeatCheck } from "@cultural-elasticity/shared";
import { verifyRankingScope } from "../evidence/comparability.js";
import type { CandidatePanel, MethodologyInput } from "./contracts.js";
import { compareStrings, rankPercentile } from "./stats.js";

export type PanelAnalysis = {
  reports: PanelReport[];
  /** Observations from valid, aggregated (non-repeat) panels, by territory id. */
  observations: Map<string, PanelObservation[]>;
  repeatChecks: RepeatCheck[];
  /** Aggregated panels declared in the input, and those whose evidence is valid. */
  aggregatedPanelIds: string[];
  validAggregatedPanelIds: string[];
};

type RankedEntry = PanelReport["order"][number];

function analyzePanel(panel: CandidatePanel, input: MethodologyInput): { report: PanelReport; entries: RankedEntry[]; correlationId: string | null } {
  const base = { id: panel.id, purpose: panel.purpose, ...(panel.repeatOf !== undefined && { repeatOf: panel.repeatOf }), size: panel.assignments.length };
  const fail = (status: PanelReport["status"], reason: string) => ({ report: { ...base, status, correlationId: null, order: [], reasons: [reason] }, entries: [], correlationId: null });
  if (panel.ranking === undefined) return fail("missing", "no ranking evidence for this panel (call failed or not collected)");
  const scope = verifyRankingScope(panel.ranking);
  if (!scope.verified) return fail("scope_unverified", `single-call scope not verified: ${scope.reason}`);
  if (panel.ranking.candidates.some((candidate) => candidate.rank === undefined)) return fail("unranked", "a candidate has no explicit rank, so positions are undefined");

  const territoryOf = new Map(panel.assignments.map((a) => [a.exemplarId, a.territoryId]));
  const labels = new Map(input.territories.flatMap((t) => t.exemplars.map((e) => [e.id, e.label] as const)));
  // Position = place in explicit rank order (ranks are unique per panel), so gaps in rank numbers do not matter.
  const ordered = [...panel.ranking.candidates].sort((a, b) => (a.rank as number) - (b.rank as number));
  const entries = ordered.map((candidate, index) => ({
    territoryId: territoryOf.get(candidate.id) as string,
    exemplarId: candidate.id,
    exemplarLabel: labels.get(candidate.id) ?? candidate.label,
    rank: index + 1,
    withinCallValue: candidate.numeric?.comparisonScope === "within_call" ? candidate.numeric.value : null,
  }));
  return { report: { ...base, status: "valid", correlationId: scope.correlationId, order: entries, reasons: [] }, entries, correlationId: scope.correlationId };
}

export function analyzePanels(input: MethodologyInput): PanelAnalysis {
  const panels = [...input.panels].sort((a, b) => compareStrings(a.id, b.id));
  const analyzed = new Map(panels.map((panel) => [panel.id, analyzePanel(panel, input)]));
  const observations = new Map<string, PanelObservation[]>(input.territories.map((t) => [t.id, []]));
  const aggregated = panels.filter((panel) => panel.purpose !== "repeat");

  for (const panel of aggregated) {
    const { entries, correlationId } = analyzed.get(panel.id)!;
    if (correlationId === null) continue;
    for (const entry of entries) {
      observations.get(entry.territoryId)!.push({
        panelId: panel.id,
        exemplarId: entry.exemplarId,
        exemplarLabel: entry.exemplarLabel,
        rank: entry.rank,
        panelSize: entries.length,
        percentile: rankPercentile(entry.rank, entries.length),
        withinCallValue: entry.withinCallValue,
        correlationId,
      });
    }
  }

  const repeatChecks: RepeatCheck[] = panels
    .filter((panel) => panel.purpose === "repeat")
    .map((panel) => {
      const repeat = analyzed.get(panel.id)!;
      const original = analyzed.get(panel.repeatOf as string)!;
      if (repeat.correlationId === null || original.correlationId === null) {
        return { panelId: panel.id, repeatOf: panel.repeatOf as string, status: "not_comparable" as const, detail: "one of the two panels has no valid ranking" };
      }
      const a = original.entries.map((e) => e.exemplarId);
      const b = repeat.entries.map((e) => e.exemplarId);
      const identical = a.length === b.length && a.every((id, i) => id === b[i]);
      return {
        panelId: panel.id,
        repeatOf: panel.repeatOf as string,
        status: identical ? ("identical" as const) : ("different" as const),
        detail: identical ? `same ordinal order in two separate calls (${original.correlationId}, ${repeat.correlationId})` : `order changed: ${a.join(" > ")} vs ${b.join(" > ")}`,
      };
    });

  return {
    reports: panels.map((panel) => analyzed.get(panel.id)!.report),
    observations,
    repeatChecks,
    aggregatedPanelIds: aggregated.map((panel) => panel.id),
    validAggregatedPanelIds: aggregated.filter((panel) => analyzed.get(panel.id)!.correlationId !== null).map((panel) => panel.id),
  };
}
