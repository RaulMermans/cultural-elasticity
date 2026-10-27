"use client";

import type { AnyBrandBaselineResult, QueryResponse } from "@cultural-elasticity/shared";
import { useEffect, useMemo, useState } from "react";
import { formatDate } from "@/lib/research-summary";
import type { ResearchSection } from "@/lib/research-route";
import { buildResearchView, type UserContext, type UserPosition } from "@/lib/research-view";
import { ConnectionExplorer } from "./ConnectionExplorer";
import { DirectionList } from "./DirectionList";
import { FingerprintOverview } from "./FingerprintOverview";
import { ResearchSummaryView } from "./ResearchSummaryView";
import { DeepResearchPanel } from "./DeepResearchPanel";
import type { ComparativeFinding } from "./ComparativeResearchPanel";
import { RecordedComparativeDemo } from "./RecordedComparativeDemo";

const contextKey = (scanId: string) => `ce.research.context.${scanId}`;

/** The user's own context is a per-tab convenience. It is never sent to the server and never becomes evidence. */
function useUserContext(scanId: string): [UserContext, (concept: string, position: UserPosition) => void] {
  const [context, setContext] = useState<UserContext>({});
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(contextKey(scanId)) ?? "{}");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        setContext(Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, UserPosition] => entry[1] === "current" || entry[1] === "new")));
      }
    } catch { setContext({}); }
  }, [scanId]);
  const update = (concept: string, position: UserPosition) => setContext((current) => {
    const next = { ...current };
    if (position === "unsure") delete next[concept];
    else next[concept] = position;
    try { sessionStorage.setItem(contextKey(scanId), JSON.stringify(next)); } catch { /* Storage may be blocked; the choice still applies on this page. */ }
    return next;
  });
  return [context, update];
}

const SECTIONS: { id: ResearchSection; label: (counts: { connections: number; directions: number }) => string }[] = [
  { id: "overview", label: () => "Cultural fingerprint" },
  { id: "connections", label: (counts) => `Connections (${counts.connections})` },
  { id: "directions", label: (counts) => `Directions (${counts.directions})` },
  { id: "summary", label: () => "Summary" },
];

export function ResearchWorkspace({ researchKey, result, section, item, deepResearch, scanToken, onNavigate, onHome }: {
  researchKey: string;
  result: AnyBrandBaselineResult;
  section: ResearchSection;
  item: string | null;
  deepResearch: "available" | "unavailable";
  scanToken: string | null;
  onNavigate: (section: ResearchSection, item?: string | null, replace?: boolean) => void;
  onHome: () => void;
}) {
  const [context, setUserContext] = useUserContext(result.scanId);
  const [investigation, setInvestigation] = useState<{ territoryId?: string; proposedDirection?: string } | null>(null);
  const [finding, setFinding] = useState<QueryResponse | null>(null);
  const [comparative, setComparative] = useState<ComparativeFinding | null>(null);
  const view = useMemo(() => buildResearchView(result, context), [result, context]);
  const counts = { connections: view.connections.length, directions: view.directions.length };

  return (
    <div className="rw" data-testid="research-workspace" data-origin={view.origin}>
      <header className="rw-head">
        <button type="button" className="ghost rw-head__home" onClick={onHome}>All brands</button>
        <p className="kicker">{view.origin === "recorded" ? "Recorded research" : "Live research"} · {formatDate(view.capturedAt)}</p>
        <h1 tabIndex={-1}>{view.brand.name}</h1>
        <p className="rw-head__objective">{view.objective}</p>
        <p className="badge" data-kind={view.origin === "recorded" ? "recorded" : "live"} role="note">
          {view.origin === "recorded" ? "Recorded Qloo research, captured earlier. Opening it did not start a new search." : "Live Qloo research from this session."}
          {view.legacy ? " Recorded with an earlier method and shown as stored." : ""}
          {view.status.tone !== "complete" ? ` ${view.status.label}.` : ""}
        </p>
        <nav className="rw-tabs" aria-label="Research sections">
          {SECTIONS.map((entry) => (
            <a
              key={entry.id}
              href={`?research=${encodeURIComponent(researchKey)}${entry.id === "overview" ? "" : `&view=${entry.id}`}`}
              aria-current={section === entry.id ? "page" : undefined}
              onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey) return; event.preventDefault(); onNavigate(entry.id, null); }}
            >
              {entry.label(counts)}
            </a>
          ))}
        </nav>
      </header>

      <div className="rw-body">
        {section === "overview" ? (
          <FingerprintOverview view={view} onOpenConnection={(key) => onNavigate("connections", key)} onSection={(next) => onNavigate(next, null)} />
        ) : section === "connections" ? (
          <ConnectionExplorer view={view} selectedKey={item} onSelect={(key) => onNavigate("connections", key)} onClear={() => onNavigate("connections", null)} />
        ) : section === "directions" ? (
          <DirectionList
            view={view}
            selectedKey={item}
            deepResearch={deepResearch}
            onSelect={(key) => onNavigate("directions", key)}
            onClear={() => onNavigate("directions", null)}
            onContext={setUserContext}
            onDeepResearch={(territoryId) => setInvestigation({ territoryId })}
            onPropose={(proposedDirection) => setInvestigation({ proposedDirection })}
          />
        ) : (
          <ResearchSummaryView view={view} investigation={finding} comparative={comparative} />
        )}
        {section === "directions" && view.origin === "recorded" ? <RecordedComparativeDemo brandQlooId={view.brand.qlooId} /> : null}
      </div>

      {investigation && scanToken ? <DeepResearchPanel key={investigation.territoryId ?? investigation.proposedDirection} scanId={result.scanId} {...investigation} token={scanToken} onClose={() => setInvestigation(null)} onFinding={setFinding} onComparative={setComparative} onOpenSummary={() => { setInvestigation(null); onNavigate("summary", null); }} /> : null}

      <details className="rw-method">
        <summary>Methodology details</summary>
        <p>
          Method {view.method.templateVersion}{view.method.discoveryRule ? `, discovery rule ${view.method.discoveryRule}` : ""}{view.method.themeRule ? `, grouping rule ${view.method.themeRule}` : ""}, position rule {view.method.positionRule}. {view.method.providerCallCount} Qloo calls in this scan. Scan <code>{view.scanId}</code>.
          {view.derivedFrom ? ` ${view.derivedFrom.note} Source result ${view.derivedFrom.schemaVersion}.` : ""}
        </p>
        {view.method.audit ? (
          <p>
            {view.method.audit.returnedTags} tags returned · {view.method.audit.operationalTags} set aside as venue metadata · {view.method.audit.culturalTags} kept · {view.method.audit.returnedEntities} related entities · {view.method.audit.typeEvidence.PROVIDER_CONFIRMED_TYPE} with a Qloo-confirmed type · {view.method.audit.typeEvidence.QUERY_SCOPED} scoped by the search only.
          </p>
        ) : null}
        {view.setAside.length ? <><h3>Set aside</h3><ul>{view.setAside.map((entry) => <li key={entry.name}>{entry.name}: {entry.reason}</li>)}</ul></> : null}
        <h3>Qloo calls</h3>
        <ul>{view.method.sources.map((ref) => <li key={ref.correlationId}><code>{ref.operation}</code> · {ref.scope} · <code>{ref.correlationId}</code> · {formatDate(ref.capturedAt)}</li>)}</ul>
      </details>
    </div>
  );
}
