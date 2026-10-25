"use client";

import type { BaselineEvidenceRef } from "@cultural-elasticity/shared";
import { forwardRef, type ReactNode } from "react";
import { domainWords, typeEvidenceCopy } from "@/lib/research-copy";
import { formatDate } from "@/lib/research-summary";
import type { ConnectionView, DirectionView, Origin } from "@/lib/research-view";

const SCOPE_BASIS: Record<string, string> = {
  RECORDED_PROVIDER_REQUEST: "Qloo's own record of the request",
  BASELINE_TEMPLATE_STAGE: "the stored research step (this scan did not keep Qloo's request record)",
};

function sourceLabel(ref: BaselineEvidenceRef): string {
  if (ref.operation === "describe") return "Brand lookup";
  if (ref.operation === "entity_tags") return "Cultural tag profile";
  return `Related ${domainWords(ref.scope).plural}`;
}

export function SourceDetails({ refs, origin, extra }: { refs: BaselineEvidenceRef[]; origin: Origin; extra?: ReactNode }) {
  return (
    <details className="rw-source">
      <summary>Source and method</summary>
      <dl>
        <dt>Research</dt>
        <dd>{origin === "recorded" ? "Recorded Qloo research, captured earlier. Not a new live run." : "Live Qloo research from this session."}</dd>
        {extra}
        {refs.map((ref) => (
          <div key={`${ref.correlationId}:${ref.sourceId}`} className="rw-source__call">
            <dt>{sourceLabel(ref)}</dt>
            <dd>
              Captured {formatDate(ref.capturedAt)} · {ref.sourceStatus === "ok" ? "complete response" : `${ref.sourceStatus} response`}
              <br /><span className="quiet">Reference <code>{ref.correlationId}</code> · item <code>{ref.sourceId}</code></span>
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

type Detail = { title: string; context: string; observed: string[]; meaning: string; cannot: string[]; next: string; refs: BaselineEvidenceRef[]; extra?: ReactNode };

export function connectionDetail(item: ConnectionView): Detail {
  const grounding = item.grounding;
  return {
    title: item.name,
    context: item.contextLine,
    observed: item.observed,
    meaning: item.meaning,
    cannot: item.cannotConclude,
    next: item.next,
    refs: [item.source],
    extra: grounding ? (
      <>
        <dt>Type evidence</dt>
        <dd>
          {typeEvidenceCopy(grounding.typeEvidence, item.domain)}
          <br /><span className="quiet">Qloo type <code>{grounding.providerType ?? "none"}</code>, subtype <code>{grounding.providerSubtype ?? "none"}</code>, searched for <code>{grounding.requestedType}</code>{grounding.scopeBasis ? <>, scope from {SCOPE_BASIS[grounding.scopeBasis] ?? "an unrecognised basis"}</> : null}.</span>
        </dd>
      </>
    ) : item.facet ? (<><dt>Tag facet</dt><dd><code>{item.facet}</code></dd></>) : null,
  };
}

export function directionDetail(item: DirectionView): Detail {
  return { title: item.name, context: item.categoryLabel, observed: item.observed, meaning: `${item.meaning} ${item.relation}`, cannot: item.unknown, next: item.nextQuestion, refs: item.refs };
}

/** The four-part evidence reading. Provenance stays behind a disclosure; nothing is hidden or reworded upward. */
export const EvidenceDetail = forwardRef<HTMLHeadingElement, { detail: Detail; origin: Origin; onBack?: () => void; backLabel?: string }>(function EvidenceDetail({ detail, origin, onBack, backLabel }, ref) {
  return (
    <article className="rw-detail" aria-labelledby="rw-detail-title" data-testid="evidence-detail">
      {onBack ? <button className="ghost rw-detail__back" type="button" onClick={onBack}>{backLabel ?? "Back"}</button> : null}
      <p className="kicker">{detail.context}</p>
      <h2 id="rw-detail-title" tabIndex={-1} ref={ref}>{detail.title}</h2>
      <section>
        <h3>What was observed</h3>
        <ul>{detail.observed.map((line) => <li key={line}>{line}</li>)}</ul>
      </section>
      <section>
        <h3>What this might mean</h3>
        <p>{detail.meaning}</p>
      </section>
      <section>
        <h3>What we cannot conclude</h3>
        <ul>{detail.cannot.map((line) => <li key={line}>{line}</li>)}</ul>
      </section>
      <section>
        <h3>What to investigate next</h3>
        <p>{detail.next}</p>
      </section>
      <SourceDetails refs={detail.refs} origin={origin} extra={detail.extra} />
    </article>
  );
});
