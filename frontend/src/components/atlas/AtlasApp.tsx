"use client";

import { parseQueryResponse, type QueryResponse } from "@cultural-elasticity/shared";
import { useState } from "react";
import { AlternativeConfirmation } from "./AlternativeConfirmation";
import { AtlasNavigation } from "./AtlasNavigation";
import { AtlasShell } from "./AtlasShell";
import { ClarificationDialog } from "./ClarificationDialog";
import { EvidenceInspector } from "./EvidenceInspector";
import { InvestigationCanvas } from "./InvestigationCanvas";
import { InvestigationHistory } from "./InvestigationHistory";
import { InvestigationProgress } from "./InvestigationProgress";
import { QueryComposer } from "./QueryComposer";
import { TerritoryDetail } from "./TerritoryDetail";
import { reasonCopy, isRecorded } from "./atlas-model";
import { assessComparison } from "./atlas-comparison";
import { useAtlas } from "./use-atlas";

export function AtlasApp() {
  const atlas = useAtlas();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const latest = atlas.latest;
  const dialogId = latest?.queryId ?? null;
  const showDialogs = dialogId !== null && dialogId !== dismissed && !atlas.active;
  const clarify = showDialogs && latest?.state === "NEEDS_CLARIFICATION" ? latest : null;
  const needsInput = showDialogs && latest?.state === "INVESTIGATION_NEEDS_INPUT" && latest.investigation?.result?.status === "NEEDS_INPUT" ? latest : null;
  const alternative = showDialogs && latest?.supportedAlternative && (latest.state === "PARTIALLY_SUPPORTED" || latest.state === "UNSUPPORTED_OPERATION") ? latest : null;
  const outcome = !atlas.active && !clarify && !needsInput && !alternative && latest && (atlas.nodes.length === 0 || latest.state === "UNSUPPORTED_OPERATION" || latest.state === "PARTIALLY_SUPPORTED" || latest.state === "CONTEXT_UNAVAILABLE" || latest.state === "INTERPRETATION_FAILED") ? latest : null;
  const response = atlas.responseFor(atlas.selected);
  const comparison = assessComparison(atlas.nodes, atlas.responses, atlas.compareIds);
  const recorded = isRecorded(response) || atlas.nodes.some((node) => node.recorded);

  return (
    <AtlasShell inspector={atlas.inspectorOpen}>
      <div className={atlas.nodes.length === 0 ? "entrance" : "workspace"}>
        {atlas.nodes.length === 0 ? <Hero onRecorded={() => void openRecorded(atlas.showRecorded, atlas.fail)} /> : null}
        <QueryComposer busy={Boolean(atlas.active)} onSubmit={(query) => void atlas.submit({ query })} />
        {atlas.active ? (
          <InvestigationProgress label={atlas.active.stageLabel} stopping={atlas.active.stopping} onCancel={() => void atlas.cancel(atlas.active!)} />
        ) : null}
        {recorded ? <p className="recorded" role="note">Recorded example. These findings are from an earlier investigation. They are not a new live query.</p> : null}
        {atlas.notice ? <p className="notice" role="alert">{atlas.notice}</p> : null}
        {outcome ? (
          <section className="recovery" role="status" data-testid="query-outcome">
            <p>{outcome.interpretation?.clarificationQuestion ?? reasonCopy(outcome.reasons[0]?.code ?? outcome.state, outcome.interpretation?.unsupportedCapabilities[0] ?? null)}</p>
          </section>
        ) : null}
        {atlas.recovery ? (
          <div className="recovery" role="status">
            <p>{atlas.recovery}</p>
            <button className="ghost" type="button" onClick={atlas.dismissRecovery}>Start a new investigation</button>
          </div>
        ) : null}
        {atlas.nodes.length > 0 ? (
          <div className="stage">
            <div>
              <AtlasNavigation nodes={atlas.nodes} selectedId={atlas.selected?.id ?? null} onSelect={atlas.select} />
              <InvestigationHistory nodes={atlas.nodes} onSelect={atlas.select} />
              <InvestigationCanvas
                nodes={atlas.nodes}
                selectedId={atlas.selected?.id ?? null}
                compareIds={atlas.compareIds}
                reducedMotion={atlas.reducedMotion}
                guided={atlas.narrow}
                onSelect={atlas.select}
              />
            </div>
            {atlas.selected ? (
              <TerritoryDetail
                node={atlas.selected}
                response={response}
                compared={atlas.compareIds.includes(atlas.selected.id)}
                canCompare={comparison.ok}
                comparisonNote={comparison.ok ? null : comparison.reason}
                onInspect={atlas.openInspector}
                onCompare={() => atlas.toggleCompare(atlas.selected!.id)}
                onFollow={(query) => {
                  if (isRecorded(response)) {
                    const brand = response?.investigation?.result && response.investigation.result.status !== "NEEDS_INPUT" ? response.investigation.result.brand?.label : null;
                    const territory = atlas.selected?.kind === "territory" ? atlas.selected.label : null;
                    void atlas.submit({ query: [brand, territory, query].filter(Boolean).join(" — ") });
                    return;
                  }
                  if (!atlas.selected?.runId) return;
                  void atlas.submit({
                    query,
                    context: { runId: atlas.selected.runId, ...(atlas.selected.territoryKey ? { selectedTerritoryKey: atlas.selected.territoryKey } : {}) },
                  });
                }}
                onReturn={() => {
                  const parentRunId = response?.investigation?.link?.parentRunId ?? response?.context?.lineage[1]?.runId ?? null;
                  const territoryKey = response?.investigation?.link?.selectedTerritoryKey ?? null;
                  if (!parentRunId) return;
                  if (isRecorded(response)) {
                    const parent = atlas.nodes.find((node) => node.runId === parentRunId && (territoryKey ? node.territoryKey === territoryKey : node.kind === "brand"));
                    if (!parent) return;
                    atlas.focusRun(parentRunId, territoryKey);
                    return;
                  }
                  void atlas.submit({ navigateToRunId: parentRunId, ...(territoryKey ? { territoryKey } : {}) });
                }}
                onCompareSelected={() => {
                  if (!comparison.ok) return;
                  void atlas.submit({
                    query: `Compare ${comparison.sources.map((source) => source.label).join(", ")}.`,
                    intent: "compare_territories",
                    territories: comparison.sources.map((source) => source.label),
                    comparisonSources: comparison.sources.map((source) => ({ runId: source.runId, territoryKey: source.territoryKey })),
                  });
                  atlas.clearCompare();
                }}
              />
            ) : <p className="quiet">Select a territory to read what the evidence supports.</p>}
          </div>
        ) : null}
      </div>
      {atlas.inspectorOpen && response ? (
        <EvidenceInspector
          response={response}
          scope={{
            territoryKey: atlas.selected?.kind === "territory" ? atlas.selected.territoryKey : null,
            territoryName: atlas.selected?.kind === "territory" ? atlas.selected.label : null,
            runId: atlas.selected?.runId ?? null,
          }}
          onClose={atlas.closeInspector}
        />
      ) : null}
      {clarify ? (
        <ClarificationDialog
          question={clarify.interpretation?.clarificationQuestion ?? "Which brand and territory should be investigated?"}
          original={clarify.interpretation?.rawQuery ?? null}
          options={[]}
          onAnswer={(answer) => void atlas.submit({ clarifyQueryId: clarify.queryId, clarification: answer })}
          onDismiss={() => setDismissed(clarify.queryId)}
        />
      ) : null}
      {needsInput && needsInput.investigation?.result?.status === "NEEDS_INPUT" ? (
        <ClarificationDialog
          question={needsInput.investigation.result.question}
          options={needsInput.investigation.result.options}
          onAnswer={(answer) => void atlas.submit({ continueRunId: needsInput.investigation!.runId, clarification: answer })}
          onDismiss={() => setDismissed(needsInput.queryId)}
        />
      ) : null}
      {alternative?.supportedAlternative ? (
        <AlternativeConfirmation
          explanation={reasonCopy(alternative.reasons[0]?.code ?? "UNSUPPORTED_OPERATION", alternative.interpretation?.unsupportedCapabilities[0] ?? null)}
          offer={alternative.supportedAlternative.description}
          onConfirm={() => void atlas.submit({ confirmQueryId: alternative.supportedAlternative!.confirmQueryId })}
          onDismiss={() => setDismissed(alternative.queryId)}
        />
      ) : null}
    </AtlasShell>
  );
}

function Hero({ onRecorded }: { onRecorded: () => void }) {
  return (
    <section className="hero">
      <p className="eyebrow">Cultural Elasticity</p>
      <h1>Where could your brand go next?</h1>
      <p className="hero__lede">An investigation of cultural territory. Ask about a brand, see what the evidence can support, and look closer only where a real concept is named.</p>
      <p className="hero__note">The map shows how an investigation grew. It does not measure cultural distance, and it does not promise success.</p>
      <button className="ghost" type="button" data-testid="recorded-open" onClick={onRecorded}>Open a recorded investigation</button>
      <svg className="sprig" width="180" height="72" viewBox="0 0 180 72" aria-hidden="true">
        <path d="M8 58 C 40 58, 52 20, 92 24" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M92 24 C 120 8, 150 18, 168 14" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <ellipse cx="58" cy="34" rx="14" ry="7" transform="rotate(-28 58 34)" fill="none" stroke="currentColor" />
        <ellipse cx="128" cy="16" rx="16" ry="7" transform="rotate(18 128 16)" fill="none" stroke="currentColor" />
      </svg>
    </section>
  );
}

async function openRecorded(show: (responses: QueryResponse[]) => void, fail: (message: string) => void) {
  try {
    const response = await fetch("/api/demo/recorded", { cache: "no-store" });
    if (!response.ok) {
      fail("The recorded example could not be opened.");
      return;
    }
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("responses" in body) || !Array.isArray(body.responses)) {
      fail("The recorded example could not be opened.");
      return;
    }
    const parsed = body.responses.map((item: unknown) => parseQueryResponse(item)).filter((item) => item.ok);
    if (parsed.length === 0) {
      fail("The recorded example could not be shown.");
      return;
    }
    show(parsed.map((item) => item.response));
  } catch {
    fail("The recorded example could not be opened.");
  }
}
