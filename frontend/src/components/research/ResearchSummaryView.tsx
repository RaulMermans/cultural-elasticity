"use client";

import { useMemo } from "react";
import { buildSummary, renderSummaryHtml } from "@/lib/research-summary";
import type { ResearchView } from "@/lib/research-view";
import type { QueryResponse } from "@cultural-elasticity/shared";

export function ResearchSummaryView({ view, investigation = null }: { view: ResearchView; investigation?: QueryResponse | null }) {
  const { summary, ms } = useMemo(() => {
    const started = performance.now();
    const built = buildSummary(view, investigation);
    return { summary: built, ms: performance.now() - started };
  }, [view, investigation]);

  const download = () => {
    const html = renderSummaryHtml(summary, new Date().toISOString());
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${view.brand.name.toLowerCase().replace(/[^a-z0-9]+/gu, "-") || "brand"}-strategic-research-brief.html`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <article className="rw-summary" aria-labelledby="rw-summary-title" data-testid="research-summary" data-generation-ms={ms.toFixed(2)}>
      <div className="rw-summary__actions">
        <button type="button" className="primary" onClick={() => window.print()}>Print or save as PDF</button>
        <button type="button" className="ghost" onClick={download}>Download brief (HTML)</button>
      </div>
      <p className="kicker">Strategic research brief</p>
      <h2 id="rw-summary-title">{summary.title}</h2>
      <p className="quiet">{summary.provenanceLine} Research date: {summary.researchDate}.</p>
      <p><strong>Research objective.</strong> {summary.objective}</p>
      <div className="rw-outcome"><p><strong>{summary.outcome.headline}</strong></p><p>{summary.outcome.detail}</p></div>
      {summary.sections.map((section) => (
        <section key={section.id} aria-labelledby={`rw-sum-${section.id}`}>
          <h3 id={`rw-sum-${section.id}`}>{section.title}</h3>
          {section.intro ? <p className="quiet">{section.intro}</p> : null}
          <ul>{section.items.map((item) => <li key={item.text}>{item.text}{item.detail ? <><br /><span className="quiet">{item.detail}</span></> : null}</li>)}</ul>
        </section>
      ))}
      <section aria-labelledby="rw-sum-sources" className="rw-summary__sources">
        <h3 id="rw-sum-sources">Evidence sources</h3>
        <ul>{summary.sources.map((source) => <li key={source.reference}>{source.label} · {source.capturedAt} · {source.status} · reference <code>{source.reference}</code></li>)}</ul>
      </section>
      <p className="quiet">{summary.footer} Generated without an AI model. Evidence support is not a commercial recommendation.</p>
    </article>
  );
}
