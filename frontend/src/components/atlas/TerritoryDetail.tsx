"use client";

import { useState } from "react";
import type { QueryResponse } from "@cultural-elasticity/shared";
import type { AtlasDraft } from "./atlas-model";

export function TerritoryDetail({
  node,
  response,
  compared,
  onInspect,
  onCompare,
  onFollow,
  onReturn,
  onCompareSelected,
  canCompare,
  comparisonNote,
}: {
  node: AtlasDraft;
  response: QueryResponse | null;
  compared: boolean;
  onInspect: () => void;
  onCompare: () => void;
  onFollow: (query: string) => void;
  onReturn: () => void;
  onCompareSelected: () => void;
  canCompare: boolean;
  comparisonNote: string | null;
}) {
  const [narrower, setNarrower] = useState("");
  const canReturn = response?.nextOperations.includes("return_to_parent") ?? false;
  const canFollow = Boolean(node.runId) && node.kind === "territory";
  const summary = response?.investigation?.result && response.investigation.result.status !== "NEEDS_INPUT" ? response.investigation.result.summary.text : null;
  return (
    <section className="detail" aria-labelledby="territory-title">
      <p className="quiet">{node.kind === "brand" ? "Investigation" : "Territory"}</p>
      <h2 id="territory-title">{node.label}</h2>
      <p><strong>{node.statusLabel}.</strong> {node.detail}</p>
      {node.mismatchedBrand ? <p>The follow-up resolved a different brand, so it stands on its own.</p> : null}
      {node.recorded ? <p className="quiet">Recorded example. A deeper question starts a new live investigation. It does not continue the recording.</p> : null}
      {response?.interpretation?.refinement?.relationBasis === "AGENT_HYPOTHESIS" ? <p>This narrower concept is a hypothesis, not a verified category.</p> : null}
      {response?.interpretation?.refinement && response.interpretation.refinement.refinementRelationship !== "NARROWER" ? <p>This follow-up is not a verified narrower category.</p> : null}
      {summary && node.kind === "brand" ? <p>{summary}</p> : null}
      <div className="actions">
        <button className="primary" type="button" data-testid="evidence-open" onClick={onInspect} disabled={!response?.investigation?.result}>
          See the evidence
        </button>
        {node.kind === "territory" ? (
          <button className="ghost" type="button" aria-pressed={compared} onClick={onCompare}>
            {compared ? "Remove from comparison" : "Compare"}
          </button>
        ) : null}
        {canReturn ? (
          <button className="ghost" type="button" data-testid="return-parent" onClick={onReturn}>
            Return to your previous investigation
          </button>
        ) : null}
      </div>
      {canFollow ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const query = narrower.trim();
            if (!query) return;
            onFollow(query);
            setNarrower("");
          }}
        >
          <label htmlFor="narrower">Name a more specific cultural concept</label>
          <input id="narrower" data-testid="follow-up-input" value={narrower} maxLength={2000} onChange={(event) => setNarrower(event.target.value)} />
          <button className="ghost" type="submit" data-testid="follow-up-submit" disabled={narrower.trim().length === 0}>
            Explore deeper
          </button>
        </form>
      ) : null}
      {canCompare ? (
        <button className="ghost" type="button" data-testid="compare-submit" onClick={onCompareSelected}>
          Compare these in a new investigation
        </button>
      ) : null}
      {comparisonNote ? <p className="quiet">{comparisonNote}</p> : null}
    </section>
  );
}
