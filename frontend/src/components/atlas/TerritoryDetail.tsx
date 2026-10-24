"use client";

import { useState, type Ref } from "react";
import type { QueryResponse } from "@cultural-elasticity/shared";
import { findingCopy } from "@/lib/evidence-presentation";
import { evidenceSections, type AtlasDraft } from "./atlas-model";

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
  liveEnabled,
  inspectRef,
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
  liveEnabled: boolean;
  inspectRef?: Ref<HTMLButtonElement>;
}) {
  const [narrower, setNarrower] = useState("");
  const canReturn = response?.nextOperations.includes("return_to_parent") ?? false;
  const canFollow = Boolean(node.runId) && node.kind === "territory";
  const question = response?.interpretation?.rawQuery ?? null;
  const sections = response
    ? evidenceSections(response, {
      territoryKey: node.kind === "territory" ? node.territoryKey : null,
      territoryName: node.kind === "territory" ? node.label : null,
      runId: node.runId,
    })
    : null;
  const finding = sections
    ? findingCopy({
      kind: node.kind,
      tone: node.tone,
      statusLabel: node.statusLabel,
      observed: sections.observed,
      calculated: sections.calculated,
      unavailable: sections.unavailable,
    })
    : {
      statusLabel: node.statusLabel,
      observation: node.detail,
      whyItMatters: node.kind === "territory"
        ? "Its place on the atlas is investigation lineage, not a score."
        : "Open a territory to read what the evidence supports.",
      limitations: [],
      unresolved: [],
      empty: false,
    };
  return (
    <section className="detail finding" aria-labelledby="territory-title">
      <p className="kicker">{node.kind === "brand" ? "Investigation" : "Territory"}</p>
      <h2 id="territory-title">{node.label}</h2>
      <div className="finding__block">
        <h3>Evidence status</h3>
        <p><strong>{finding.statusLabel}.</strong></p>
      </div>
      <div className="finding__block">
        <h3>What the evidence shows</h3>
        <p>{finding.observation}</p>
      </div>
      <div className="finding__block">
        <h3>Why it matters</h3>
        <p>{finding.whyItMatters}</p>
      </div>
      {finding.limitations.length > 0 ? (
        <div className="finding__block">
          <h3>Limitations</h3>
          <ul className="finding__list">
            {finding.limitations.slice(0, 3).map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      ) : null}
      {node.mismatchedBrand ? <p>The follow-up resolved a different brand, so it stands on its own.</p> : null}
      {response?.interpretation?.refinement?.relationBasis === "AGENT_HYPOTHESIS" ? <p>This narrower concept is a hypothesis, not a verified category.</p> : null}
      {response?.interpretation?.refinement && response.interpretation.refinement.refinementRelationship !== "NARROWER" ? <p>This follow-up is not a verified narrower category.</p> : null}
      {question && node.kind === "brand" ? <p className="quiet">{question}</p> : null}
      <div className="actions">
        <button className="primary" type="button" ref={inspectRef} data-testid="evidence-open" onClick={onInspect} disabled={!response?.investigation?.result}>
          See the evidence
        </button>
        {node.kind === "territory" ? (
          <button className="ghost" type="button" aria-pressed={compared} onClick={onCompare}>
            {compared ? "Remove from comparison" : "Compare"}
          </button>
        ) : null}
        {canReturn ? (
          <button className="ghost" type="button" data-testid="return-parent" onClick={onReturn}>
            Return to previous
          </button>
        ) : null}
      </div>
      {canFollow ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const query = narrower.trim();
            if (!query || !liveEnabled) return;
            onFollow(query);
            setNarrower("");
          }}
        >
          <label htmlFor="narrower">Name a more specific cultural concept</label>
          <input id="narrower" data-testid="follow-up-input" value={narrower} maxLength={2000} onChange={(event) => setNarrower(event.target.value)} disabled={!liveEnabled} />
          <button className="ghost" type="submit" data-testid="follow-up-submit" disabled={!liveEnabled || narrower.trim().length === 0}>
            Explore deeper
          </button>
          {!liveEnabled ? <p className="quiet">A deeper question would start a new live investigation. Those are not being accepted right now.</p> : null}
        </form>
      ) : null}
      {canCompare && liveEnabled ? (
        <button className="ghost" type="button" data-testid="compare-submit" onClick={onCompareSelected}>
          Compare these in a new investigation
        </button>
      ) : null}
      {canCompare && !liveEnabled ? <p className="quiet">Comparing these would start a new live investigation, which is not being accepted right now.</p> : null}
      {comparisonNote ? <p className="quiet">{comparisonNote}</p> : null}
    </section>
  );
}
