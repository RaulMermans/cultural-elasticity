"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseAdmission, type AdmissionStatus } from "@/lib/admissions";
import { availabilityCopy, scanStatusCopy, stageCopy } from "@/lib/research-copy";
import { HOME, SESSION_RESEARCH, parseRoute, routeQuery, type Route } from "@/lib/research-route";
import { AtlasApp } from "../atlas/AtlasApp";
import { AtlasShell } from "../atlas/AtlasShell";
import { BrandDiscovery } from "./BrandDiscovery";
import { ResearchNetwork } from "./ResearchNetwork";
import { useBrandResearch } from "./use-brand-research";

export function ResearchApp({ initialRoute }: { initialRoute: Route }) {
  const [route, setRoute] = useState<Route>(initialRoute);
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
      if (current.research !== next.research || current.view !== next.view || current.mode !== next.mode || current.layout !== next.layout) window.scrollTo({ top: 0 });
      return next;
    });
  }, []);

  useEffect(() => {
    // Move focus to the new page heading only after an in-app navigation, never on first load.
    const key = `${route.mode}:${route.research}`;
    if (focusKey.current === key) return;
    focusKey.current = key;
    if (route.mode === "research") document.querySelector<HTMLElement>("#atlas-main h1")?.focus();
  }, [route.mode, route.research]);

  const nav = route.mode === "atlas" ? <nav aria-label="Research navigation"><a href="/" onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey) return; event.preventDefault(); navigate(HOME); }}>Back to brand research</a></nav> : undefined;

  if (route.mode === "atlas") {
    return <AtlasApp nav={nav} initialQuery={route.ask} />;
  }

  const deepResearch = admissions === "accepting" && route.research === SESSION_RESEARCH && Boolean(research.scanToken) ? "available" : "unavailable";
  const result = route.research === SESSION_RESEARCH ? research.scan?.result ?? null : null;

  let body;
  if (!route.research) {
    body = (
      <BrandDiscovery
        availability={research.availability}
        resolution={research.resolution}
        busy={research.busy}
        error={research.error}
        hasSessionScan={research.hasSessionScan}
        library={research.library}
        onResolve={(name, id) => void research.resolve(name, id)}
        onStart={() => void research.start().then((started) => { if (started) navigate({ ...HOME, research: SESSION_RESEARCH }); })}
        onClearResolution={research.clearResolution}
        onOpenSession={() => navigate({ ...HOME, research: SESSION_RESEARCH })}
        onOpenLibrary={(entry) => { research.openScan(entry); navigate({ ...HOME, research: SESSION_RESEARCH }); }}
      />
    );
  } else if (result) {
    body = (
      <ResearchNetwork
        key={result.scanId}
        result={result}
        scanToken={route.research === SESSION_RESEARCH ? research.scanToken : null}
        canAsk={admissions === "accepting"}
        canInvestigate={deepResearch === "available"}
        onHome={() => navigate(HOME)}
        onBack={() => { if (window.history.length > 1) window.history.back(); else navigate(HOME); }}
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
        ) : <p>Research started in another tab or browser can&apos;t be opened here. Start new research, or reopen it from your research library.</p>}
        {research.error ? <p className="notice" role="alert">{research.error}</p> : null}
      </section>
    );
  } else {
    body = (
      <section className="rw-progress" aria-labelledby="rw-progress-title">
        <button type="button" className="ghost" onClick={() => navigate(HOME)}>All brands</button>
        <h1 id="rw-progress-title" tabIndex={-1}>This research link isn&apos;t available</h1>
        <p>Start new research, or reopen one from your research library.</p>
      </section>
    );
  }

  return (
    <AtlasShell admissions={admissions} nav={nav} metaLabel={availabilityCopy(research.availability).label} skipLabel="Skip to the research">
      {body}
    </AtlasShell>
  );
}
