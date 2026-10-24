"use client";

import { type QueryResponse } from "@cultural-elasticity/shared";
import { useEffect, useRef } from "react";
import { QueryComposer } from "./QueryComposer";
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
  const openedRecorded = useRef(false);
  useEffect(() => {
    if (openedRecorded.current) return;
    if (new URLSearchParams(window.location.search).get("recorded") !== "1") return;
    openedRecorded.current = true;
    onRecorded();
  }, [onRecorded]);
  return (
    <section className="landing">
      <div className="landing__copy">
        <p className="eyebrow">Living Atlas</p>
        <h1>See where a brand can stretch.</h1>
        <p className="landing__lede">
          A cultural observatory. Investigate expansion territories from observed affinities, with uncertainty kept in view. The atlas shows investigation lineage, not cultural distance.
        </p>
        {live ? (
          <div>
            <p className="kicker">Ask a cultural question</p>
            <QueryComposer busy={busy} onSubmit={onAsk} />
          </div>
        ) : null}
        <div className="landing__actions">
          <button className="ghost" type="button" onClick={onHow}>
            Learn how it works
          </button>
        </div>
        {admissions === "paused" ? (
          <p className="landing__note">{status.sentence}</p>
        ) : null}
        {admissions === "unavailable" ? (
          <p className="landing__note">{status.sentence}</p>
        ) : null}
        {admissions === "unknown" ? (
          <p className="landing__note">{status.sentence}</p>
        ) : null}
      </div>
      <aside className="landing__preview" aria-label="Empty observatory">
        <p className="landing__preview-label">Awaiting investigation</p>
        <div className="landing__empty" data-testid="landing-empty">
          <p>The atlas is empty until a brand is investigated.</p>
          <p className="quiet">Territories appear as research objects. An edge means investigated-from, not cultural distance.</p>
        </div>
      </aside>
    </section>
  );
}
