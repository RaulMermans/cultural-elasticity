"use client";

import type { QueryResponse } from "@cultural-elasticity/shared";
import { useMemo } from "react";
import type { ComparisonPlan } from "./atlas-comparison";

/** Reads completed result fields only. There is no fetch or provider action in this comparison. */
export function ReadOnlyComparison({ plan, responses, onClose }: { plan: ComparisonPlan; responses: readonly QueryResponse[]; onClose: () => void }) {
  const rows = useMemo(() => plan.ok ? plan.sources.map((source) => {
    const response = responses.find((entry) => entry.investigation?.runId === source.runId);
    const result = response?.investigation?.result;
    const territory = result && result.status !== "NEEDS_INPUT" ? result.territories.find((item) => item.key === source.territoryKey) : null;
    return { source, question: response?.interpretation?.rawQuery ?? "Research question unavailable", territory };
  }) : [], [plan, responses]);
  return <section className="finding" aria-labelledby="readonly-comparison-title" data-testid="read-only-comparison">
    <button type="button" className="ghost" onClick={onClose}>Back to finding</button>
    <p className="kicker">Existing research</p>
    <h2 id="readonly-comparison-title">Compare directions</h2>
    {!plan.ok ? <p>{plan.reason ?? "Select at least two researched territories to compare."}</p> : <>
      <p>These findings are shown side by side from their stored investigations. This view starts no new research and makes no numerical ranking.</p>
      <div className="rw-compare-list">
        {rows.map(({ source, question, territory }) => <article key={`${source.runId}:${source.territoryKey}`} className="rw-direction">
          <h3>{source.label}</h3>
          <dl>
            <dt>Research question</dt><dd>{question}</dd>
            <dt>Observed connection</dt><dd>{territory?.keyEvidence[0] ?? "No supported observation was retained."}</dd>
            <dt>Evidence coverage</dt><dd>{territory ? territory.analysisRoute === "INSUFFICIENT_EVIDENCE" ? "Insufficient for a conclusion" : territory.analysisRoute === "FULL_RELATIVE_ANALYSIS" ? "Relative analysis within its recorded comparison set" : "Partial or descriptive evidence" : "Result unavailable"}</dd>
            <dt>Limitations</dt><dd>{territory?.limitations.map((item) => item.detail).join("; ") || "No additional limitation recorded."}</dd>
            <dt>Next validation</dt><dd>{territory?.analysisRoute === "INSUFFICIENT_EVIDENCE" ? "Collect eligible Qloo evidence for this concept before drawing a conclusion." : "Validate the relationship with a new, explicitly authorized investigation."}</dd>
          </dl>
          <details><summary>Source references</summary><p>{territory?.provenance.correlationIds.join("; ") || "No eligible source references"}</p></details>
        </article>)}
      </div>
      <p className="quiet">Different investigations may use different Qloo calls and comparison sets. Their quantities are not combined or ranked here. More returned entities do not imply a stronger opportunity.</p>
    </>}
  </section>;
}
