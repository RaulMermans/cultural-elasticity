"use client";

import { useEffect, useRef } from "react";
import type { QueryResponse } from "@cultural-elasticity/shared";
import { evidenceTerm, isPlaceholderLine, presentEvidenceLines, type PresentedEvidence } from "@/lib/evidence-presentation";
import { evidenceSections, type EvidenceScope } from "./atlas-model";

export function EvidenceInspector({
  response,
  scope,
  onClose,
}: {
  response: QueryResponse;
  scope: EvidenceScope;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const sections = evidenceSections(response, scope);
  const observed = presentEvidenceLines(sections.observed);
  const calculated = presentEvidenceLines(sections.calculated);
  const interpreted = presentEvidenceLines(sections.interpreted);
  const unavailable = presentEvidenceLines(sections.unavailable);
  const aggregate = presentEvidenceLines(sections.aggregate);
  const codes = unique([...observed, ...calculated, ...interpreted, ...unavailable, ...aggregate].flatMap((line) => line.codes));
  const lead = leadFinding(observed, calculated);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <aside
      className="inspector inspector--docked"
      role="dialog"
      aria-modal="true"
      aria-labelledby="evidence-title"
      data-testid="evidence-inspector"
      ref={panelRef}
    >
      <div className="inspector__head">
        <button className="ghost" type="button" ref={closeRef} data-testid="evidence-close" onClick={onClose}>
          Close
        </button>
        <h2 id="evidence-title">Evidence dossier</h2>
        <p className="quiet">{sections.scopeLabel}</p>
        {sections.recorded ? <p className="quiet">Recorded example. Not a new live investigation.</p> : null}
        {sections.synthetic ? <p className="quiet">Synthetic evidence. This is not a live investigation.</p> : null}
      </div>
      <p className="dossier-lead">{lead}</p>
      <Section title="Supporting observations" items={observed} />
      <Section title="Calculated evidence" items={calculated} />
      <Section title="Agent interpretation" items={interpreted} />
      <Section title="Contradictory or missing evidence" items={unavailable} />
      {aggregate.some((item) => !isPlaceholderLine(item.display)) ? (
        <details>
          <summary>This run, not this territory alone</summary>
          <Section title="Whole investigation" items={aggregate} />
        </details>
      ) : null}
      <p className="quiet">{sections.caution}</p>
      <details data-testid="evidence-technical">
        <summary>Source and methodology details</summary>
        {codes.length > 0 ? (
          <dl className="dossier-terms">
            {codes.map((code) => {
              const term = evidenceTerm(code);
              return (
                <div key={code}>
                  <dt>{term.label}</dt>
                  <dd>
                    <p>{term.explanation}</p>
                    <p className="quiet">Canonical identifier: {code}</p>
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : <p>No methodology identifier was recorded for this territory.</p>}
        {sections.provenance.length > 0 ? (
          <div>
            <h3>Source provenance</h3>
            <ul>
              {sections.provenance.map((id) => <li key={id}>{id}</li>)}
            </ul>
          </div>
        ) : <p>No correlation id was recorded.</p>}
      </details>
    </aside>
  );
}

function Section({ title, items }: { title: string; items: PresentedEvidence[] }) {
  const visible = items.filter((item) => !isPlaceholderLine(item.display));
  if (visible.length === 0) {
    return (
      <section>
        <h3>{title}</h3>
        <p className="quiet">Nothing further was recorded in this layer.</p>
      </section>
    );
  }
  return (
    <section>
      <h3>{title}</h3>
      <ul>
        {visible.map((item, index) => <li key={`${index}-${item.display}`}>{item.display}</li>)}
      </ul>
    </section>
  );
}

function leadFinding(observed: readonly PresentedEvidence[], calculated: readonly PresentedEvidence[]): string {
  const examples = observed.find((line) => /^Examples connected/u.test(line.display) && !isPlaceholderLine(line.display));
  if (examples) return examples.display;
  const concept = observed.find((line) => /^Concepts observed/u.test(line.display) && !isPlaceholderLine(line.display));
  if (concept) return concept.display;
  const position = calculated.find((line) => /In this comparison|sat \d/u.test(line.display));
  if (position) return position.display;
  const first = [...observed, ...calculated].find((line) => !isPlaceholderLine(line.display));
  return first?.display ?? "No key finding was recorded for this territory.";
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
