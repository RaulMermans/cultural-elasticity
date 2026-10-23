"use client";

import { useEffect, useRef } from "react";
import type { QueryResponse } from "@cultural-elasticity/shared";
import { evidenceSections, type EvidenceScope } from "./atlas-model";

export function EvidenceInspector({ response, scope, onClose }: { response: QueryResponse; scope: EvidenceScope; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const sections = evidenceSections(response, scope);
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
      <h2 id="evidence-title">What supports this</h2>
      <p className="quiet">{sections.scopeLabel}</p>
      <p>{sections.caution}</p>
      {sections.recorded ? <p className="quiet">Recorded example. Not a new live investigation.</p> : null}
      {sections.synthetic ? <p className="quiet">Synthetic evidence. This is not a live investigation.</p> : null}
      <Section title="What was observed" items={sections.observed} />
      <Section title="What was calculated" items={sections.calculated} />
      <Section title="What the agent inferred" items={sections.interpreted} />
      <Section title="What could not be established" items={sections.unavailable} />
      {sections.aggregate.length > 0 ? <Section title="Whole investigation" items={sections.aggregate} /> : null}
      <details>
        <summary>Provenance</summary>
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
