"use client";

import { parseQueryResponse, type QueryResponse } from "@cultural-elasticity/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { liveQuestionsEnabled } from "@/lib/admissions";
import { AlternativeConfirmation } from "./AlternativeConfirmation";
import { AtlasNavigation } from "./AtlasNavigation";
import { AtlasShell } from "./AtlasShell";
import { ClarificationDialog } from "./ClarificationDialog";
import { EvidenceInspector } from "./EvidenceInspector";
import { HowItWorks } from "./HowItWorks";
import { InvestigationCanvas } from "./InvestigationCanvas";
import { InvestigationHistory } from "./InvestigationHistory";
import { InvestigationProgress } from "./InvestigationProgress";
import { Landing } from "./Landing";
import { QueryComposer } from "./QueryComposer";
import { TerritoryDetail } from "./TerritoryDetail";
import { reasonCopy, isRecorded } from "./atlas-model";
import { assessComparison } from "./atlas-comparison";
import { ReadOnlyComparison } from "./ReadOnlyComparison";
import { useAtlas } from "./use-atlas";

/** The optional Living Atlas exploration view. Brand research is the default product view (ResearchApp). */
export function AtlasApp({ nav, autoOpenRecorded = false, initialQuery = null }: { nav?: ReactNode; autoOpenRecorded?: boolean; initialQuery?: string | null }) {
  const atlas = useAtlas();
  const opened = useRef(false);
  useEffect(() => {
    // Opening the recorded investigation is local to the bundled artifact; it never starts a live job.
    if (!autoOpenRecorded || opened.current) return;
    opened.current = true;
    void openRecorded(atlas.showRecorded, atlas.fail);
  }, [autoOpenRecorded, atlas.showRecorded, atlas.fail]);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [how, setHow] = useState(false);
  const [showReadOnlyComparison, setShowReadOnlyComparison] = useState(false);
  const inspectRef = useRef<HTMLButtonElement>(null);
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
  const liveEnabled = liveQuestionsEnabled(atlas.admissions);
  const question = response?.interpretation?.rawQuery ?? latest?.interpretation?.rawQuery ?? null;

  return (
    <AtlasShell inspector={atlas.inspectorOpen} admissions={atlas.admissions} recorded={recorded} nav={nav}>
      {atlas.nodes.length === 0 ? (
        <>
          <Landing
            admissions={atlas.admissions}
            busy={Boolean(atlas.active)}
            onRecorded={(prepared) => void openRecorded(atlas.showRecorded, atlas.fail, prepared)}
            onAsk={(query) => void atlas.submit({ query })}
            onHow={() => setHow(true)}
            initialQuery={initialQuery ?? ""}
          />
          <div className="landing-status">
            {atlas.active ? (
              <InvestigationProgress label={atlas.active.stageLabel} stopping={atlas.active.stopping} onCancel={() => void atlas.cancel(atlas.active!)} />
            ) : null}
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
          </div>
        </>
      ) : (
        <div className="workspace">
          <aside className="rail">
            <div className="rail__identity">
              <p className="kicker">{recorded ? "Recorded investigation" : "Investigation"}</p>
              <p className="badge" data-kind={recorded ? "recorded" : liveEnabled ? "live" : "paused"}>
                {recorded ? "Recorded example" : liveEnabled ? "Live" : "Live paused"}
              </p>
              <h2>{atlas.nodes.find((node) => node.kind === "brand")?.label ?? "Investigation"}</h2>
              {question ? <p className="quiet">{question}</p> : null}
            </div>
            <div className="rail__path">
              <AtlasNavigation nodes={atlas.nodes} selectedId={atlas.selected?.id ?? null} onSelect={atlas.select} />
              <InvestigationHistory nodes={atlas.nodes} onSelect={atlas.select} />
            </div>
            {liveEnabled ? (
              <div className="rail__ask">
                <p className="kicker">New question</p>
                <QueryComposer busy={Boolean(atlas.active)} compact onSubmit={(query) => void atlas.submit({ query })} />
              </div>
            ) : (
              <p className="quiet rail__ask">Live questions are not being accepted right now.</p>
            )}
            {atlas.active ? (
              <InvestigationProgress label={atlas.active.stageLabel} stopping={atlas.active.stopping} onCancel={() => void atlas.cancel(atlas.active!)} />
            ) : null}
            {recorded ? <p className="recorded quiet rail__note" role="note">Recorded example. These findings are from an earlier investigation. They are not a new live query.</p> : null}
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
          </aside>
          <div className="observatory">
            <InvestigationCanvas
              nodes={atlas.nodes}
              selectedId={atlas.selected?.id ?? null}
              compareIds={atlas.compareIds}
              reducedMotion={atlas.reducedMotion}
              guided={atlas.narrow}
              onSelect={atlas.select}
            />
          </div>
          {showReadOnlyComparison ? <ReadOnlyComparison plan={comparison} responses={atlas.responses} onClose={() => setShowReadOnlyComparison(false)} /> : atlas.inspectorOpen && response ? (
            <EvidenceInspector
              response={response}
              scope={{
                territoryKey: atlas.selected?.kind === "territory" ? atlas.selected.territoryKey : null,
                territoryName: atlas.selected?.kind === "territory" ? atlas.selected.label : null,
                runId: atlas.selected?.runId ?? null,
              }}
              onClose={() => {
                atlas.closeInspector();
                queueMicrotask(() => inspectRef.current?.focus());
              }}
            />
          ) : atlas.selected ? (
            <TerritoryDetail
              node={atlas.selected}
              response={response}
              compared={atlas.compareIds.includes(atlas.selected.id)}
              canCompare={comparison.ok}
              comparisonNote={comparison.ok ? null : comparison.reason}
              liveEnabled={liveEnabled}
              inspectRef={inspectRef}
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
              onReadOnlyComparison={() => setShowReadOnlyComparison(true)}
            />
          ) : <p className="quiet finding">Select a territory to read what the evidence supports.</p>}
        </div>
      )}
      {how ? <HowItWorks onClose={() => setHow(false)} /> : null}
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

async function openRecorded(
  show: (responses: QueryResponse[]) => void,
  fail: (message: string) => void,
  prepared?: QueryResponse[],
) {
  if (prepared && prepared.length > 0) {
    show(prepared);
    return;
  }
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
