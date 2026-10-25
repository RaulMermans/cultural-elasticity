"use client";

import { isBrandBaselineResult, type AnyBrandBaselineResult } from "@cultural-elasticity/shared";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { parseAdmission, type AdmissionStatus } from "@/lib/admissions";
import type { RecordedBaseline, RecordedEntry } from "@/lib/recorded-research";
import { availabilityCopy, scanStatusCopy, stageCopy } from "@/lib/research-copy";
import { HOME, SESSION_RESEARCH, parseRoute, routeQuery, type ResearchSection, type Route } from "@/lib/research-route";
import { AtlasApp } from "../atlas/AtlasApp";
import { AtlasShell } from "../atlas/AtlasShell";
import { BrandDiscovery } from "./BrandDiscovery";
import { ResearchWorkspace } from "./ResearchWorkspace";
import { useBrandResearch } from "./use-brand-research";

function ModeNav({ mode, onGo }: { mode: Route["mode"]; onGo: (mode: Route["mode"]) => void }) {
  const link = (target: Route["mode"], href: string, label: string) => (
    <a href={href} aria-current={mode === target ? "page" : undefined} onClick={(event: MouseEvent) => { if (event.metaKey || event.ctrlKey || event.shiftKey) return; event.preventDefault(); onGo(target); }}>{label}</a>
  );
  return (
    <nav className="mode-nav" aria-label="Product views">
      {link("research", "/", "Brand research")}
      {link("atlas", "/?mode=atlas", "Living Atlas")}
    </nav>
  );
}

export function ResearchApp({ initialRoute, catalog, initialRecorded }: { initialRoute: Route; catalog: RecordedEntry[]; initialRecorded: RecordedBaseline | null }) {
  const [route, setRoute] = useState<Route>(initialRoute);
  const [recorded, setRecorded] = useState<Record<string, AnyBrandBaselineResult>>(initialRecorded ? { [initialRecorded.key]: initialRecorded.result } : {});
  const [recordedError, setRecordedError] = useState("");
  const [admissions, setAdmissions] = useState<AdmissionStatus>("unknown");
  const research = useBrandResearch();
  const focusKey = useRef(`${initialRoute.mode}:${initialRoute.research}`);

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(new URLSearchParams(window.location.search)));
    window.addEventListener("popstate", onPop);
    void fetch("/api/agent/admissions", { cache: "no-store" }).then(async (response) => parseAdmission(await response.json()).status).then(setAdmissions).catch(() => setAdmissions("unavailable"));
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((next: Route, replace = false) => {
    const url = `${window.location.pathname}${routeQuery(next)}`;
    if (replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
    setRoute((current) => {
      if (current.research !== next.research || current.view !== next.view || current.mode !== next.mode) window.scrollTo({ top: 0 });
      return next;
    });
  }, []);

  // Recorded research is bundled with the product; reading it is a static file, never a provider call.
  const recordedKey = route.mode === "research" && route.research && route.research !== SESSION_RESEARCH ? route.research : null;
  useEffect(() => {
    if (!recordedKey || recorded[recordedKey]) return;
    let active = true;
    setRecordedError("");
    void fetch("/api/demo/baselines").then(async (response) => {
      const body: unknown = await response.json();
      const items = response.ok && body && typeof body === "object" && "items" in body && Array.isArray(body.items) ? body.items as { key?: unknown; result?: unknown }[] : [];
      const loaded = Object.fromEntries(items.filter((item) => typeof item.key === "string" && isBrandBaselineResult(item.result)).map((item) => [item.key as string, item.result as AnyBrandBaselineResult]));
      if (!active) return;
      setRecorded((current) => ({ ...current, ...loaded }));
      if (!loaded[recordedKey]) setRecordedError("This recorded research isn't available.");
    }).catch(() => { if (active) setRecordedError("Recorded research could not be opened. Please reload the page."); });
    return () => { active = false; };
  }, [recordedKey, recorded]);

  useEffect(() => {
    // Move focus to the new page heading only after an in-app navigation, never on first load.
    const key = `${route.mode}:${route.research}`;
    if (focusKey.current === key) return;
    focusKey.current = key;
    if (route.mode === "research") document.querySelector<HTMLElement>("#atlas-main h1")?.focus();
  }, [route.mode, route.research]);

  const goMode = (mode: Route["mode"]) => navigate(mode === "atlas" ? { ...HOME, mode: "atlas" } : HOME);
  const nav = <ModeNav mode={route.mode} onGo={goMode} />;

  if (route.mode === "atlas") {
    return <AtlasApp nav={nav} autoOpenRecorded={route.open === "recorded"} initialQuery={route.ask} />;
  }

  const section = (next: ResearchSection, item: string | null = null, replace = false) => navigate({ ...route, view: next, item }, replace);
  const deepResearch = admissions === "accepting" && route.research === SESSION_RESEARCH && Boolean(research.scanToken) ? "available" : "unavailable";
  const result = route.research === SESSION_RESEARCH ? research.scan?.result ?? null : recordedKey ? recorded[recordedKey] ?? null : null;

  let body;
  if (!route.research) {
    body = (
      <BrandDiscovery
        catalog={catalog}
        availability={research.availability}
        resolution={research.resolution}
        busy={research.busy}
        error={research.error}
        hasSessionScan={research.hasSessionScan}
        onResolve={(name, id) => void research.resolve(name, id)}
        onStart={() => void research.start().then((started) => { if (started) navigate({ ...HOME, research: SESSION_RESEARCH }); })}
        onClearResolution={research.clearResolution}
        onOpenRecorded={(key) => navigate({ ...HOME, research: key })}
        onOpenInvestigation={() => navigate({ ...HOME, mode: "atlas", open: "recorded" })}
        onOpenSession={() => navigate({ ...HOME, research: SESSION_RESEARCH })}
      />
    );
  } else if (result) {
    body = (
      <ResearchWorkspace
        researchKey={route.research}
        result={result}
        section={route.view}
        item={route.item}
        deepResearch={deepResearch}
        scanToken={route.research === SESSION_RESEARCH ? research.scanToken : null}
        onNavigate={section}
        onHome={() => navigate(HOME)}
      />
    );
  } else if (route.research === SESSION_RESEARCH) {
    const status = research.scan ? scanStatusCopy(research.scan.scanStatus) : null;
    body = (
      <section className="rw-progress" aria-labelledby="rw-progress-title" data-testid="research-progress">
        <button type="button" className="ghost" onClick={() => navigate(HOME)}>All brands</button>
        <h1 id="rw-progress-title" tabIndex={-1}>{research.hasSessionScan ? status?.label ?? "Opening your research" : "This research isn't available in this tab"}</h1>
        {research.hasSessionScan ? (
          <>
            <p role="status">{status?.tone === "stopped" ? "No findings were kept from the unfinished steps." : "Results appear here as soon as the research finishes. You can leave this page; the research continues and stays stored."}</p>
            {research.scan?.stages.length ? <ul className="rw-plain">{research.scan.stages.map((stage) => <li key={stage.stage}>{stageCopy(stage.stage, stage.status)}</li>)}</ul> : null}
          </>
        ) : <p>Research started in another tab or browser can&apos;t be opened here. Start new research or open a recorded example.</p>}
        {research.error ? <p className="notice" role="alert">{research.error}</p> : null}
      </section>
    );
  } else {
    body = (
      <section className="rw-progress" aria-labelledby="rw-progress-title">
        <button type="button" className="ghost" onClick={() => navigate(HOME)}>All brands</button>
        <h1 id="rw-progress-title" tabIndex={-1}>{recordedError ? "Recorded research unavailable" : "Opening recorded research"}</h1>
        {recordedError ? <p className="notice" role="alert">{recordedError}</p> : <p role="status">Loading the stored research…</p>}
      </section>
    );
  }

  return (
    <AtlasShell admissions={admissions} nav={nav} metaLabel={availabilityCopy(research.availability).label} skipLabel="Skip to the research">
      {body}
    </AtlasShell>
  );
}
