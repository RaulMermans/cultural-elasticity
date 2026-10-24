"use client";

import { parseQueryResponse, type QueryResponse } from "@cultural-elasticity/shared";
import { useEffect, useMemo, useState } from "react";
import { QueryComposer } from "./QueryComposer";
import { InvestigationCanvas } from "./InvestigationCanvas";
import { buildAtlas, layoutAtlas, type AtlasDraft } from "./atlas-model";
import { admissionCopy, liveQuestionsEnabled, type AdmissionStatus } from "@/lib/admissions";

export function Landing({
  admissions,
  busy,
  onRecorded,
  onAsk,
  onHow,
}: {
  admissions: AdmissionStatus;
  busy: boolean;
  onRecorded: (responses?: QueryResponse[]) => void;
  onAsk: (query: string) => void;
  onHow: () => void;
}) {
  const live = liveQuestionsEnabled(admissions);
  const status = admissionCopy(admissions);
  const preview = useRecordedPreview();
  const nodes = useMemo(() => placed(preview.nodes), [preview.nodes]);
  return (
    <section className="landing">
      <div className="landing__copy">
        <p className="eyebrow">Living Atlas</p>
        <h1>See where a brand can stretch.</h1>
        <p className="landing__lede">
          A cultural observatory. Investigate expansion territories from observed affinities, with uncertainty kept in view. The atlas shows investigation lineage, not cultural distance.
        </p>
        <div className="landing__actions">
          <button className="primary" type="button" data-testid="recorded-open" onClick={() => onRecorded(preview.responses ?? undefined)}>
            Explore the Jacquemus investigation
          </button>
          <button className="ghost" type="button" onClick={onHow}>
            Learn how it works
          </button>
        </div>
        {admissions === "paused" ? (
          <p className="landing__note">{status.sentence} The Jacquemus example is a recorded investigation, not a new query.</p>
        ) : null}
        {admissions === "unavailable" ? (
          <p className="landing__note">{status.sentence}</p>
        ) : null}
        {admissions === "unknown" ? (
          <p className="landing__note">{status.sentence}</p>
        ) : null}
        {live ? (
          <div>
            <p className="kicker">Ask a cultural question</p>
            <QueryComposer busy={busy} onSubmit={onAsk} />
          </div>
        ) : null}
      </div>
      <aside className="landing__preview" aria-label="Preview of the recorded atlas">
        <p className="landing__preview-label">Recorded · Jacquemus</p>
        {nodes.length > 0 ? (
          <InvestigationCanvas
            nodes={nodes}
            selectedId={nodes.find((node) => node.label === "Bohemian lifestyle")?.id ?? nodes[1]?.id ?? null}
            compareIds={[]}
            reducedMotion
            guided={false}
            preview
            onSelect={() => onRecorded(preview.responses ?? undefined)}
          />
        ) : <p className="quiet" style={{ padding: "1rem" }}>Loading the recorded atlas…</p>}
      </aside>
    </section>
  );
}

function placed(drafts: AtlasDraft[]): Array<AtlasDraft & { x: number; y: number }> {
  const positions = layoutAtlas(drafts, new Map());
  return drafts.map((draft) => ({ ...draft, ...(positions.get(draft.id) ?? { x: 28, y: 28 }) }));
}

function useRecordedPreview(): { nodes: AtlasDraft[]; responses: QueryResponse[] | null } {
  const [responses, setResponses] = useState<QueryResponse[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/demo/recorded", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const body: unknown = await response.json();
        if (!body || typeof body !== "object" || !("responses" in body) || !Array.isArray(body.responses)) return;
        const parsed = body.responses.map((item: unknown) => parseQueryResponse(item)).filter((item) => item.ok);
        if (!cancelled) setResponses(parsed.map((item) => item.response));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return { nodes: responses ? buildAtlas(responses) : [], responses };
}
