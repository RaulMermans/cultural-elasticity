"use client";

import { POSITION_COPY } from "@/lib/research-copy";
import type { ConnectionView, ResearchView } from "@/lib/research-view";

const PREVIEW = 5;

export function FingerprintOverview({ view, onOpenConnection, onSection }: {
  view: ResearchView;
  onOpenConnection: (key: string) => void;
  onSection: (section: "connections" | "directions" | "summary") => void;
}) {
  const brand = view.brand.name;
  const chip = (item: ConnectionView) => (
    <li key={item.key}><button type="button" className="rw-chip" onClick={() => onOpenConnection(item.key)}>{item.name}</button></li>
  );
  return (
    <div className="rw-overview" data-testid="fingerprint">
      <section className="rw-outcome" aria-labelledby="rw-outcome-title" data-outcome={view.outcome.kind}>
        <h2 id="rw-outcome-title">{view.outcome.headline}</h2>
        <p>{view.outcome.detail}</p>
      </section>

      <div className="rw-overview__grid">
        <section aria-labelledby="rw-shows" className="rw-overview__main">
          <h2 id="rw-shows" className="rw-section-title">What Qloo shows for {brand}</h2>
          {view.collections.length === 0 && view.tasteTags.length === 0 && view.keywords.length === 0
            ? <p>Qloo returned no cultural connections in this research.</p>
            : <p className="quiet">Listed in Qloo&apos;s order. The order is not a ranking of strength or opportunity. Select a name to see its evidence.</p>}
          {view.collections.map((collection) => (
            <div className="rw-collection" key={collection.domain}>
              <h3>{collection.title}</h3>
              <p className="quiet">{collection.qualifier}</p>
              <ul className="rw-chips">{collection.items.slice(0, PREVIEW).map(chip)}</ul>
              {collection.items.length > PREVIEW ? (
                <button type="button" className="ghost" onClick={() => onSection("connections")}>
                  See all {collection.items.length} {collection.title.split(" ")[0]!.toLowerCase()}
                </button>
              ) : null}
            </div>
          ))}
          {view.tasteTags.length ? (
            <div className="rw-collection">
              <h3>Cultural tags</h3>
              <p className="quiet">Tags Qloo associates with {brand}.</p>
              <ul className="rw-chips">{view.tasteTags.map(chip)}</ul>
            </div>
          ) : null}
          {view.keywords.length ? (
            <div className="rw-collection">
              <h3>Descriptive keywords</h3>
              <p className="quiet">Loose keywords Qloo attached to {brand}. They are clues, not curated categories.</p>
              <ul className="rw-chips">{view.keywords.map(chip)}</ul>
            </div>
          ) : null}
          <p><button type="button" className="primary" onClick={() => onSection("connections")}>Explore all connections</button></p>
        </section>

        <aside className="rw-overview__aside" aria-label="Research context">
          <section aria-labelledby="rw-core">
            <h3 id="rw-core">{brand}&apos;s current position</h3>
            <p>{view.core.note}</p>
            {view.core.categories.length ? <ul className="rw-chips">{view.core.categories.map(chip)}</ul> : null}
          </section>

          <section aria-labelledby="rw-directions-peek">
            <h3 id="rw-directions-peek">Directions to investigate</h3>
            {view.directions.length ? (
              <ul className="rw-plain">
                {view.directions.map((direction) => <li key={direction.key}><strong>{direction.name}</strong> <span className="quiet">· {POSITION_COPY[direction.category].short}{direction.categoryBasis === "user" ? " (your context)" : ""}</span></li>)}
              </ul>
            ) : <p>The available evidence does not yet support a specific direction.</p>}
            <button type="button" className="ghost" onClick={() => onSection("directions")}>{view.directions.length ? "Review the directions" : "See why, and what to try next"}</button>
          </section>

          <section aria-labelledby="rw-uncertain">
            <h3 id="rw-uncertain">What is uncertain</h3>
            <ul className="rw-plain">{view.uncertainties.slice(0, 3).map((line) => <li key={line}>{line}</li>)}</ul>
            {view.unresolved.length ? <p className="quiet">{view.unresolved.length} open {view.unresolved.length === 1 ? "question is" : "questions are"} listed under Directions.</p> : null}
          </section>

          <section aria-labelledby="rw-coverage">
            <h3 id="rw-coverage">Research coverage</h3>
            <dl className="rw-coverage">
              {view.coverage.map((item) => <div key={item.domain}><dt>{item.title}</dt><dd>{item.text}</dd></div>)}
            </dl>
          </section>

          <button type="button" className="ghost" onClick={() => onSection("summary")}>Open the research summary</button>
        </aside>
      </div>
    </div>
  );
}
