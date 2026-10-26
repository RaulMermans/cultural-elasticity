"use client";

import { useState } from "react";
import { RESOLUTION_COPY, availabilityCopy, type BrandResearchAvailability } from "@/lib/research-copy";
import type { RecordedEntry } from "@/lib/recorded-research";
import { sameName } from "@/lib/research-route";
import { formatDate } from "@/lib/research-summary";
import type { Resolution } from "./use-brand-research";

export function BrandDiscovery({ catalog, availability, resolution, busy, error, hasSessionScan, onResolve, onStart, onClearResolution, onOpenRecorded, onOpenInvestigation, onOpenSession }: {
  catalog: RecordedEntry[];
  availability: BrandResearchAvailability;
  resolution: Resolution | null;
  busy: boolean;
  error: string;
  hasSessionScan: boolean;
  onResolve: (name: string, selectedQlooId?: string) => void;
  onStart: () => void;
  onClearResolution: () => void;
  onOpenRecorded: (key: string) => void;
  onOpenInvestigation: () => void;
  onOpenSession: () => void;
}) {
  const [name, setName] = useState("");
  const [lookup, setLookup] = useState<{ query: string; match: RecordedEntry | null } | null>(null);
  const live = availability === "available";
  const copy = availabilityCopy(availability);
  const firstBaseline = catalog.find((entry) => entry.kind === "baseline");

  const submit = () => {
    const query = name.trim();
    if (query.length < 2) return;
    const match = catalog.find((entry) => sameName(entry.brand, query)) ?? null;
    setLookup({ query, match });
    if (live && !match) onResolve(query);
  };
  const open = (entry: RecordedEntry) => entry.kind === "baseline" ? onOpenRecorded(entry.key) : onOpenInvestigation();

  return (
    <div className="rw-discovery" data-testid="brand-discovery" data-availability={availability}>
      <section className="rw-discovery__intro" aria-labelledby="rw-discovery-title">
        <p className="eyebrow">Brand research</p>
        <h1 id="rw-discovery-title" tabIndex={-1}>Explore a brand&apos;s cultural connections.</h1>
        <p className="rw-discovery__lede">
          See which cultural associations Qloo shows for a brand, check the evidence behind each one, and decide which directions deserve deeper research.
        </p>
        {!live && firstBaseline ? (
          <p className="rw-discovery__cta">
            <button type="button" className="primary" data-testid="open-recorded-baseline" onClick={() => open(firstBaseline)}>Open the recorded {firstBaseline.brand} research</button>
          </p>
        ) : null}
        <ol className="rw-steps" aria-label="What the research produces">
          <li><strong>Cultural fingerprint</strong><span>What Qloo associates with the brand, and how complete that picture is.</span></li>
          <li><strong>Connections</strong><span>Artists, places, films, books and tags, each with its evidence and limits.</span></li>
          <li><strong>Directions to investigate</strong><span>Possible research directions, with what is still unknown.</span></li>
        </ol>
      </section>

      <section className="rw-discovery__search" aria-labelledby="rw-search-title">
        <h2 id="rw-search-title" className="rw-section-title">Explore a brand</h2>
        <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <label htmlFor="rw-brand">Brand name</label>
          <div className="rw-search">
            <input id="rw-brand" value={name} minLength={2} maxLength={200} required autoComplete="off" placeholder="For example, Loewe" onChange={(event) => { setName(event.target.value); setLookup(null); onClearResolution(); }} />
            <button type="submit" className={live ? "primary" : "rw-secondary"} disabled={busy}>{busy ? "Searching…" : live ? "Find brand" : "Find recorded research"}</button>
          </div>
        </form>
        <p className="rw-availability" role="status" data-testid="research-availability"><strong>{copy.label}</strong> {copy.detail} {live ? "Search is submitted explicitly and Qloo checks the brand identity before any scan starts." : "These examples are recorded, not a complete list of Qloo brands."}</p>
        {hasSessionScan ? <p><button type="button" className="ghost" onClick={onOpenSession}>Return to the research you started in this tab</button></p> : null}

        {lookup?.match ? (
          <div className="rw-lookup" role="status">
            <p>Recorded research for <strong>{lookup.match.brand}</strong> is available. It opens instantly and does not start a new search.</p>
            <button type="button" className="primary" onClick={() => open(lookup.match!)}>Open the {lookup.match.brand} research</button>
          </div>
        ) : lookup && !live ? (
          <div className="rw-lookup" role="status">
            <p>There is no recorded research for “{lookup.query}”. {copy.label} You can open one of the recorded examples below.</p>
          </div>
        ) : null}

        {live && resolution?.status === "AMBIGUOUS" ? (
          <fieldset className="rw-candidates">
            <legend>{RESOLUTION_COPY.AMBIGUOUS}</legend>
            {(resolution.candidates ?? []).map((candidate) => (
              <button type="button" className="rw-secondary" key={candidate.qlooId} disabled={busy} onClick={() => onResolve(name.trim(), candidate.qlooId)}>{candidate.label}{candidate.type ? ` · ${candidate.type.replace(/^urn:entity:/u, "")}` : ""} · ID {candidate.qlooId}</button>
            ))}
          </fieldset>
        ) : null}
        {live && resolution?.status === "RESOLVED" ? (
          <div className="rw-lookup" role="status">
            <p>Qloo matched <strong>{resolution.entity?.label}</strong>. Start research to build its cultural fingerprint. It runs a short, fixed set of Qloo lookups.</p>
            <button type="button" className="primary" disabled={busy} onClick={onStart}>{busy ? "Starting…" : `Start research on ${resolution.entity?.label ?? "this brand"}`}</button>
          </div>
        ) : null}
        {error ? <p className="notice" role="alert">{error}</p> : null}
      </section>

      <section className="rw-discovery__recorded" aria-labelledby="rw-recorded-title">
        <h2 id="rw-recorded-title" className="rw-section-title">Recorded research</h2>
        <p className="quiet">Captured earlier from Qloo and stored with the product. Opening one is instant and does not start a new search.</p>
        <ul className="rw-recorded">
          {catalog.map((entry) => (
            <li key={entry.key}>
              <div>
                <h3>{entry.brand}</h3>
                <p className="quiet">
                  {entry.kind === "baseline"
                    ? `Cultural fingerprint · captured ${formatDate(entry.recordedAt)} · ${entry.connections} connections, ${entry.directions} possible ${entry.directions === 1 ? "direction" : "directions"}`
                    : `Archived deep investigation${entry.question ? ` of “${entry.question}”` : ""} · captured ${formatDate(entry.recordedAt)} · historical Atlas view`}
                </p>
              </div>
              <button type="button" className="rw-secondary" data-testid={entry.kind === "baseline" ? `recorded-${entry.key}` : "recorded-investigation"} onClick={() => open(entry)}>
                {entry.kind === "baseline" ? "Open research" : "Open archived investigation"}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
