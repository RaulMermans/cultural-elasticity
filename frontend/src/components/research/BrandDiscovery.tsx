"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { brandSuggestions, type SuggestionSource } from "@/lib/brand-suggestions";
import { RESOLUTION_COPY, allowanceCopy, availabilityCopy, type BrandResearchAvailability, type VisitorAllowance } from "@/lib/research-copy";
import { sameName } from "@/lib/research-route";
import { formatDate } from "@/lib/research-summary";
import type { LibraryEntry, Resolution } from "./use-brand-research";

export function BrandDiscovery({ availability, allowance, resolution, busy, error, hasSessionScan, library, onResolve, onStart, onClearResolution, onOpenSession, onOpenLibrary }: {
  availability: BrandResearchAvailability;
  allowance: VisitorAllowance | null;
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
        <p className="eyebrow">Cultural Elasticity · built on Qloo</p>
        <h1 id="rw-discovery-title" tabIndex={-1}>How far can a brand stretch before it stops feeling like itself?</h1>
        <p className="rw-discovery__lede">
          Enter a brand. Qloo maps its cultural fingerprint, then an AI agent investigates any territory you choose and places it against Qloo-validated alternatives, with the evidence and with what it still can&apos;t tell.
        </p>
        <ol className="rw-steps" aria-label="How the research works">
          <li><strong>Cultural fingerprint</strong><span>What Qloo associates with the brand: artists, places, films, books and taste tags.</span></li>
          <li><strong>Agent investigation</strong><span>Claude plans a bounded set of Qloo lookups for the territory you pick or ask about.</span></li>
          <li><strong>A reading you can act on</strong><span>Where the territory sits, how steady that is, and what evidence is missing.</span></li>
        </ol>
        <dl className="rw-outcomes" aria-label="What the outcomes mean">
          <div><dt>Natural fit</dt><dd>Near the top of the comparison: close to the brand&apos;s observed taste.</dd></div>
          <div><dt>Credible stretch</dt><dd>In the middle: further out, with real shared taste.</dd></div>
          <div><dt>Cultural break</dt><dd>Near the bottom: little shared taste with the brand.</dd></div>
          <div><dt>Not settled</dt><dd>The answer changes with the examples, or Qloo returned too little, so no call is made.</dd></div>
        </dl>
        <p className="rw-outcomes__note">Every outcome is relative to the alternatives the agent compared, never a forecast of sales. All numbers come from Qloo; the model only plans and explains.</p>
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
        {allowance ? <p className="rw-availability" data-testid="public-allowance">{allowanceCopy(allowance)}</p> : null}
        <div className="rw-example" data-testid="recorded-examples">
          <p>Want to see finished results first? Two research reports recorded from live runs on 29 October 2026, with real Qloo and Claude calls. Opening them runs nothing new.</p>
          <ul>
            <li><a href="/examples/crocs-2026-10-29.html" target="_blank" rel="noopener">Crocs</a>: a measured finding (fine dining, a steady credible stretch) next to a direction that could not be measured yet (fiction), and why.</li>
            <li><a href="/examples/patagonia-2026-10-29.html" target="_blank" rel="noopener">Patagonia</a>: when the evidence does not settle (ethical consumption) and when Qloo has nothing comparable to measure against.</li>
          </ul>
          <p>Then research any brand yourself above: that starts new Qloo calls.</p>
        </div>
        {hasSessionScan ? <p><button type="button" className="ghost" onClick={onOpenSession}>Return to the research you started in this tab</button></p> : null}
        {library.length ? <section className="rw-library" aria-labelledby="rw-library-title" data-testid="research-library">
          <h2 id="rw-library-title">Your research library</h2>
          <ul className="rw-plain">{[...library].reverse().map((entry) => <li key={entry.scanId}><button type="button" className="ghost" onClick={() => onOpenLibrary(entry)}>{entry.brand} <span className="quiet">· {formatDate(new Date(entry.startedAt).toISOString())}</span></button></li>)}</ul>
        </section> : null}

        {live && resolution?.status === "AMBIGUOUS" ? (
          <fieldset className="rw-candidates">
            <legend>{RESOLUTION_COPY.AMBIGUOUS}</legend>
            {(resolution.candidates ?? []).map((candidate) => (
              <button type="button" className="rw-secondary" key={candidate.qlooId} disabled={busy} onClick={() => onResolve(name.trim(), candidate.qlooId)}>
                {candidate.label}{candidate.type ? ` · ${candidate.type.replace(/^urn:entity:/u, "")}` : ""} · ID {candidate.qlooId}
                {candidate.description || typeof candidate.popularity === "number" ? (
                  <span className="rw-candidate-detail quiet">
                    {candidate.description ? `Qloo: “${candidate.description}”` : ""}
                    {typeof candidate.popularity === "number" ? `${candidate.description ? " · " : ""}Qloo popularity ${candidate.popularity.toFixed(2)}` : ""}
                  </span>
                ) : null}
              </button>
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
