"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { brandSuggestions, type SuggestionSource } from "@/lib/brand-suggestions";
import { RESOLUTION_COPY, availabilityCopy, type BrandResearchAvailability } from "@/lib/research-copy";
import { sameName } from "@/lib/research-route";
import { formatDate } from "@/lib/research-summary";
import type { LibraryEntry, Resolution } from "./use-brand-research";

export function BrandDiscovery({ availability, resolution, busy, error, hasSessionScan, library, onResolve, onStart, onClearResolution, onOpenSession, onOpenLibrary }: {
  availability: BrandResearchAvailability;
  resolution: Resolution | null;
  busy: boolean;
  error: string;
  hasSessionScan: boolean;
  library: LibraryEntry[];
  onResolve: (name: string, selectedQlooId?: string) => void;
  onStart: () => void;
  onClearResolution: () => void;
  onOpenSession: () => void;
  onOpenLibrary: (entry: LibraryEntry) => void;
}) {
  const [name, setName] = useState("");
  const live = availability === "available";
  const copy = availabilityCopy(availability);

  const submit = () => {
    const query = name.trim();
    if (query.length < 2 || !live) return;
    onResolve(query);
  };

  // Suggestions narrow as you type, from your research library in this browser. Typing never calls Qloo.
  const sources = useMemo<SuggestionSource<LibraryEntry>[]>(() => library.map((entry) => ({ label: entry.brand, detail: `Your research · ${formatDate(new Date(entry.startedAt).toISOString())}`, kind: "library" as const, value: entry, at: entry.startedAt })), [library]);
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const suggestions = useMemo(() => brandSuggestions(name, sources), [name, sources]);
  const canSearch = live && name.trim().length >= 2 && !suggestions.some((item) => sameName(item.label, name));
  const options = suggestions.length + (canSearch ? 1 : 0);
  // Only open when there is something of yours to suggest; a new search is the Find brand button, never hidden under the list.
  const showList = listOpen && suggestions.length > 0;
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const choose = (index: number) => {
    setListOpen(false);
    setActive(-1);
    const pick = suggestions[index];
    if (!pick) { submit(); return; }
    onOpenLibrary(pick.value);
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && options) { event.preventDefault(); setListOpen(true); setActive((current) => (current + 1) % options); }
    else if (event.key === "ArrowUp" && options) { event.preventDefault(); setListOpen(true); setActive((current) => (current <= 0 ? options - 1 : current - 1)); }
    else if (event.key === "Enter" && showList && active >= 0) { event.preventDefault(); choose(active); }
    else if (event.key === "Escape") { setListOpen(false); setActive(-1); }
  };

  return (
    <div className="rw-discovery" data-testid="brand-discovery" data-availability={availability}>
      <section className="rw-discovery__intro" aria-labelledby="rw-discovery-title">
        <p className="eyebrow">Brand research</p>
        <h1 id="rw-discovery-title" tabIndex={-1}>Explore a brand&apos;s cultural connections.</h1>
        <p className="rw-discovery__lede">
          See which cultural associations Qloo shows for a brand, check the evidence behind each one, and decide which directions deserve deeper research.
        </p>
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
            <div className="rw-combo">
              <input id="rw-brand" value={name} minLength={2} maxLength={200} required autoComplete="off" placeholder="For example, Loewe"
                role="combobox" aria-expanded={showList} aria-controls="rw-brand-options" aria-autocomplete="list"
                aria-activedescendant={showList && active >= 0 ? `rw-brand-option-${active}` : undefined}
                onFocus={() => setListOpen(true)} onBlur={() => { blurTimer.current = setTimeout(() => setListOpen(false), 120); }} onKeyDown={onKey}
                onChange={(event) => { setName(event.target.value); setListOpen(true); setActive(-1); onClearResolution(); }} />
              {showList ? <ul id="rw-brand-options" role="listbox" className="rw-combo__list" aria-label="Brand suggestions" data-testid="brand-suggestions"
                onMouseDown={(event) => { event.preventDefault(); if (blurTimer.current) clearTimeout(blurTimer.current); }}>
                {suggestions.map((item, index) => <li key={`${item.kind}:${item.label}`} id={`rw-brand-option-${index}`} role="option" aria-selected={active === index} data-kind={item.kind}
                  onMouseEnter={() => setActive(index)} onClick={() => choose(index)}>
                  <span className="rw-combo__name">{item.label}</span>
                  <span className="rw-combo__detail">{item.detail}</span>
                </li>)}
                {canSearch ? <li id={`rw-brand-option-${suggestions.length}`} role="option" aria-selected={active === suggestions.length} data-kind="search"
                  onMouseEnter={() => setActive(suggestions.length)} onClick={() => choose(suggestions.length)}>
                  <span className="rw-combo__name">Find “{name.trim()}” in Qloo</span>
                  <span className="rw-combo__detail">Checks the brand with one Qloo lookup</span>
                </li> : null}
              </ul> : null}
            </div>
            <button type="submit" className="primary" disabled={busy || !live}>{busy ? "Searching…" : "Find brand"}</button>
          </div>
        </form>
        <p className="rw-availability" role="status" data-testid="research-availability"><strong>{copy.label}</strong> {copy.detail} {live ? "Search is submitted explicitly and Qloo checks the brand identity before any scan starts." : "Your research library below still opens."}</p>
        {hasSessionScan ? <p><button type="button" className="ghost" onClick={onOpenSession}>Return to the research you started in this tab</button></p> : null}
        {library.length ? <section className="rw-library" aria-labelledby="rw-library-title" data-testid="research-library">
          <h2 id="rw-library-title">Your research library</h2>
          <ul className="rw-plain">{[...library].reverse().map((entry) => <li key={entry.scanId}><button type="button" className="ghost" onClick={() => onOpenLibrary(entry)}>{entry.brand} <span className="quiet">· {formatDate(new Date(entry.startedAt).toISOString())}</span></button></li>)}</ul>
        </section> : null}

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

    </div>
  );
}
