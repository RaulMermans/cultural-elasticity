"use client";

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
import { reasonCopy } from "./atlas-model";
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
  const comparedNames = atlas.nodes.filter((node) => atlas.compareIds.includes(node.id) && node.kind === "territory").map((node) => node.label);

  return (
    <AtlasShell inspector={atlas.inspectorOpen}>
      <div className={atlas.nodes.length === 0 ? "entrance" : "workspace"}>
        {atlas.nodes.length === 0 ? <Hero /> : null}
        <QueryComposer busy={Boolean(atlas.active)} onSubmit={(query) => void atlas.submit({ query })} />
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
                canCompare={comparedNames.length >= 2}
                onInspect={atlas.openInspector}
                onCompare={() => atlas.toggleCompare(atlas.selected!.id)}
                onFollow={(query) => {
                  if (!atlas.selected?.runId) return;
                  void atlas.submit({
                    query,
                    context: { runId: atlas.selected.runId, ...(atlas.selected.territoryKey ? { selectedTerritoryKey: atlas.selected.territoryKey } : {}) },
                  });
                }}
                onReturn={() => {
                  if (!atlas.selected?.runId) return;
                  void atlas.submit({ query: "Return to the previous investigation.", context: { runId: atlas.selected.runId } });
                }}
                onCompareSelected={() => {
                  const runId = atlas.nodes.find((node) => atlas.compareIds.includes(node.id))?.runId;
                  if (!runId || comparedNames.length < 2) return;
                  void atlas.submit({
                    query: `Compare ${comparedNames.join(", ")}.`,
                    intent: "compare_territories",
                    territories: comparedNames,
                    context: { runId },
                  });
                  atlas.clearCompare();
                }}
              />
            ) : <p className="quiet">Select a territory to read what the evidence supports.</p>}
          </div>
        ) : null}
      </div>
      {atlas.inspectorOpen && response ? (
        <EvidenceInspector response={response} territoryName={atlas.selected?.kind === "territory" ? atlas.selected.label : null} onClose={atlas.closeInspector} />
      ) : null}
      {clarify ? (
        <ClarificationDialog
          question={clarify.interpretation?.clarificationQuestion ?? "Which brand and territory should be investigated?"}
          options={[]}
          onAnswer={(answer) => {
            const parent = clarify.interpretation?.references.parentRunId;
            void atlas.submit(parent ? { query: answer, context: { runId: parent } } : { query: answer });
          }}
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

function Hero() {
  return (
    <section className="hero">
      <h1>Where could your brand go next?</h1>
      <p className="hero__lede">Ask a cultural question. The investigation follows the evidence: what can be supported, what stays uncertain, and what is not available.</p>
      <p className="hero__note">The map shows how an investigation grew. It does not measure cultural distance, and it does not promise success.</p>
      <svg className="sprig" width="180" height="72" viewBox="0 0 180 72" aria-hidden="true">
        <path d="M8 58 C 40 58, 52 20, 92 24" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M92 24 C 120 8, 150 18, 168 14" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <ellipse cx="58" cy="34" rx="14" ry="7" transform="rotate(-28 58 34)" fill="none" stroke="currentColor" />
        <ellipse cx="128" cy="16" rx="16" ry="7" transform="rotate(18 128 16)" fill="none" stroke="currentColor" />
      </svg>
    </section>
  );
}
