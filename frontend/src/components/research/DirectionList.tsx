"use client";

import { useEffect, useRef } from "react";
import { POSITION_COPY, USER_POSITION_COPY } from "@/lib/research-copy";
import type { DirectionView, PositionCategory, ResearchView, UserPosition } from "@/lib/research-view";
import { MasterDetail, onListKey } from "./ConnectionExplorer";
import { EvidenceDetail, directionDetail } from "./EvidenceDetail";

const ORDER: PositionCategory[] = ["ADJACENT", "OBSERVED", "UNRESOLVED", "ESTABLISHED"];

function DirectionCard({ direction, brand, selected, onInspect, onContext }: {
  direction: DirectionView;
  brand: string;
  selected: boolean;
  onInspect: () => void;
  onContext: (position: UserPosition) => void;
}) {
  const name = `rw-context-${direction.key}`;
  return (
    <article className="rw-direction" data-category={direction.category} aria-labelledby={`${name}-title`}>
      {direction.categoryBasis === "user" ? <p className="rw-direction__label">{direction.categoryLabel}</p> : null}
      <h3 id={`${name}-title`}>{direction.name}</h3>
      <dl>
        <dt>Why it appeared</dt><dd>{direction.why}</dd>
        <dt>Supporting signal</dt><dd>{direction.signals.join("; ")}. {direction.strength}.</dd>
        <dt>Relation to {brand}&apos;s current position</dt><dd>{direction.relation}</dd>
        <dt>Still unknown</dt><dd><ul className="rw-plain">{direction.unknown.map((line) => <li key={line}>{line}</li>)}</ul></dd>
        <dt>Next research question</dt><dd>{direction.nextQuestion}</dd>
      </dl>
      <div className="rw-direction__actions">
        <button type="button" className="ghost" data-row={direction.key} aria-current={selected ? "true" : undefined} onClick={onInspect}>Inspect the evidence for {direction.name}</button>
        <fieldset className="rw-context">
          <legend>Your context <span className="quiet">(optional, not Qloo evidence)</span></legend>
          {(["unsure", "current", "new"] as const).map((value) => (
            <label key={value}>
              <input type="radio" name={name} value={value} checked={direction.userPosition === value} onChange={() => onContext(value)} />
              {USER_POSITION_COPY[value]}
            </label>
          ))}
        </fieldset>
      </div>
    </article>
  );
}

export function DirectionList({ view, selectedKey, deepResearch, onSelect, onClear, onContext, onDeepResearch }: {
  view: ResearchView;
  selectedKey: string | null;
  deepResearch: "available" | "unavailable";
  onSelect: (key: string) => void;
  onClear: () => void;
  onContext: (concept: string, position: UserPosition) => void;
  onDeepResearch: (question: string) => void;
}) {
  const brand = view.brand.name;
  const selected = view.directions.find((item) => item.key === selectedKey) ?? null;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastSelected = useRef<string | null>(null);
  useEffect(() => {
    if (selected) { headingRef.current?.focus(); lastSelected.current = selected.key; return; }
    if (lastSelected.current) {
      document.querySelector<HTMLButtonElement>(`[data-row="${CSS.escape(lastSelected.current)}"]`)?.focus();
      lastSelected.current = null;
    }
  }, [selected?.key]);

  const present = ORDER.filter((category) => view.directions.some((item) => item.category === category));
  const list = (
    <div onKeyDown={onListKey}>
      <section aria-labelledby="rw-directions-title" className="rw-directions">
        <h2 id="rw-directions-title" className="rw-section-title">Directions worth investigating</h2>
        {view.directions.length ? (
          <>
            <p>Each direction is a question for further research, not a validated finding or a recommendation. Only the classifications the evidence supports are used.</p>
            {present.map((category) => (
              <div key={category} className="rw-direction-group">
                <h3 className="rw-direction-group__title">{POSITION_COPY[category].label}</h3>
                {view.directions.filter((item) => item.category === category).map((direction) => (
                  <DirectionCard key={direction.key} direction={direction} brand={brand} selected={direction.key === selectedKey} onInspect={() => onSelect(direction.key)} onContext={(position) => onContext(direction.canonicalConcept, position)} />
                ))}
              </div>
            ))}
            {!view.core.verified ? <p className="quiet">You know {brand} better than this data does. Marking a direction as already part of the brand, or as new, sorts it for your summary. It never changes the evidence.</p> : null}
          </>
        ) : (
          <div className="rw-empty" data-testid="no-directions">
            <p><strong>We found cultural connections, but the available evidence does not yet support a specific direction.</strong></p>
            {view.noDirectionReasons.length ? <ul className="rw-plain">{view.noDirectionReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
            <p>The connections are still worth reading: they show what Qloo associates with {brand} today.</p>
          </div>
        )}
      </section>

      {view.unresolved.length ? (
        <section aria-labelledby="rw-unresolved" className="rw-unresolved">
          <h2 id="rw-unresolved" className="rw-section-title">Open questions</h2>
          <p className="quiet">Possibilities the current evidence can&apos;t yet support or classify.</p>
          <dl>{view.unresolved.map((item) => <div key={item.title}><dt>{item.title}</dt><dd>{item.detail}</dd></div>)}</dl>
        </section>
      ) : null}

      {view.nextSteps.length ? (
        <section aria-labelledby="rw-next" className="rw-next">
          <h2 id="rw-next" className="rw-section-title">Next research steps</h2>
          <ol>{view.nextSteps.map((step) => <li key={step}>{step}</li>)}</ol>
          {deepResearch === "available" && view.directions[0]
            ? <button type="button" className="primary" onClick={() => onDeepResearch(view.directions[0]!.nextQuestion)}>Ask this in a deep investigation</button>
            : <p className="quiet" data-testid="deep-research-unavailable">Deep investigations are temporarily unavailable, so these steps can&apos;t be started from here right now.</p>}
        </section>
      ) : null}
    </div>
  );

  return (
    <MasterDetail
      collapse
      selected={Boolean(selected)}
      list={list}
      detail={selected ? <EvidenceDetail ref={headingRef} detail={directionDetail(selected)} origin={view.origin} onBack={onClear} backLabel="Back to all directions" /> : null}
      empty={<><h2>Inspect a direction</h2><p>Choose “Inspect the evidence” on a direction to read what was observed, what it might mean, what can&apos;t be concluded, and the next question.</p></>}
    />
  );
}
