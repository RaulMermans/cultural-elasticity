"use client";

import { useEffect, useRef } from "react";
import type { QueryResponse } from "@cultural-elasticity/shared";
import { evidenceSections, type EvidenceScope } from "./atlas-model";

export function EvidenceInspector({ response, scope, onClose }: { response: QueryResponse; scope: EvidenceScope; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const sections = evidenceSections(response, scope);
  const skipLead = /^(Analysis route|Representation robustness|Provisional class|Position |Relative position|Shared cultural|Evidence quality)/u;
  const keyFinding = sections.observed.find((line) => /^(Concepts observed|Examples connected)/u.test(line))
    ?? sections.calculated.find((line) => !skipLead.test(line))
    ?? sections.observed.find((line) => !line.startsWith("No separate record"))
    ?? sections.calculated[0]
    ?? "No key finding was recorded for this territory.";
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <aside className="inspector" role="dialog" aria-modal="true" aria-labelledby="evidence-title" data-testid="evidence-inspector">
      <button className="ghost" type="button" ref={closeRef} data-testid="evidence-close" onClick={onClose}>
        Close
      </button>
      <h2 id="evidence-title">Evidence dossier</h2>
      <p className="quiet">{sections.scopeLabel}</p>
      {sections.recorded ? <p className="quiet">Recorded example. Not a new live investigation.</p> : null}
      {sections.synthetic ? <p className="quiet">Synthetic evidence. This is not a live investigation.</p> : null}
      <p className="dossier-lead">{keyFinding}</p>
      <Section title="Observed evidence" items={sections.observed} />
      <Section title="Calculated results" items={sections.calculated} />
      <Section title="Agent interpretation" items={sections.interpreted} />
      <Section title="Missing or insufficient evidence" items={sections.unavailable} />
      {sections.aggregate.length > 0 ? (
        <details>
          <summary>This run, not this territory alone</summary>
          <Section title="Whole investigation" items={sections.aggregate} />
        </details>
      ) : null}
      <p className="quiet">{sections.caution}</p>
      <details>
        <summary>Source provenance</summary>
        {sections.provenance.length > 0 ? (
          <ul>
            {sections.provenance.map((id) => <li key={id}>{id}</li>)}
          </ul>
        ) : <p>No correlation id was recorded.</p>}
      </details>
    </aside>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <section>
      <h3>{title}</h3>
      <ul>
        {items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
      </ul>
    </section>
  );
}
