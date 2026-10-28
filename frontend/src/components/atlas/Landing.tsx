"use client";

import { QueryComposer } from "./QueryComposer";
import { admissionCopy, liveQuestionsEnabled, type AdmissionStatus } from "@/lib/admissions";

export function Landing({
  admissions,
  busy,
  onAsk,
  onHow,
  initialQuery = "",
}: {
  initialQuery?: string;
  admissions: AdmissionStatus;
  busy: boolean;
  onAsk: (query: string) => void;
  onHow: () => void;
}) {
  const live = liveQuestionsEnabled(admissions);
  const status = admissionCopy(admissions);
  return (
    <section className="landing">
      <div className="landing__copy">
        <p className="eyebrow">Living Atlas</p>
        <h1>See where a brand can stretch.</h1>
        <p className="landing__lede">
          A cultural observatory. Investigate expansion territories from observed affinities, with uncertainty kept in view. The atlas shows investigation lineage, not cultural distance.
        </p>
        <div className="landing__actions">
          <button className="ghost" type="button" onClick={onHow}>
            Learn how it works
          </button>
        </div>
        {admissions !== "accepting" ? <p className="landing__note">{status.sentence}</p> : null}
        {live ? (
          <div>
            <p className="kicker">Ask a cultural question</p>
            <QueryComposer busy={busy} onSubmit={onAsk} initial={initialQuery} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
