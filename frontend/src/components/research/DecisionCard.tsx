"use client";

import type { DecisionCard } from "@cultural-elasticity/shared";

const ORIGIN: Record<DecisionCard["evidenceOrigin"], string> = {
  live: "From a live Qloo investigation.",
  recorded: "From recorded Qloo evidence (no new Qloo call).",
  synthetic: "Synthetic test evidence, not Qloo.",
};

const HORIZON: Record<NonNullable<DecisionCard["interpretations"]>[number]["horizon"], string> = {
  ESTABLISHED: "already part of the brand's position",
  ADJACENT: "a neighbouring direction",
  SPECULATIVE: "a long shot",
};

const COVERAGE: Record<DecisionCard["evidence"]["coverage"][number]["status"], string> = {
  COVERED: "Covered",
  PARTIAL: "Partly covered",
  RELATED_ONLY: "Related concept only",
  NOT_COVERED: "Not covered",
};

/**
 * Sprint 12 result hierarchy, all from the shared `decisionCard` (the same projection the report uses):
 * 1. research conclusion, 2. evidence measurement, 3. strategic meaning; the comparative result and the technical
 * details are rendered by TerritoryReadingView around these.
 */
export function ResearchConclusionView({ card, question }: { card: DecisionCard; question: string | null }) {
  const conclusion = card.conclusion!;
  return <div className="rr-hero rr-conclusion" data-outcome={conclusion.outcome} data-testid="research-conclusion">
    <p className="rr-eyebrow">{question ?? `What the evidence says about ${card.territory} for ${card.brand}`}</p>
    <p className="rr-verdict" data-testid="research-conclusion-label">{conclusion.label}</p>
    <p className="rr-meaning" data-testid="decision-finding">{conclusion.text}</p>
    <p className="rr-decision__implication" data-testid="decision-implication" data-implication={card.implication.code}><strong>{card.implication.label}.</strong> {card.implication.text}</p>
  </div>;
}

export function EvidenceMeasurementView({ card }: { card: DecisionCard }) {
  const { observed, limitations, missing, coverage } = card.evidence;
  const showCoverage = coverage.length > 1 || coverage.some((item) => item.status !== "COVERED");
  return <section className="rr-section rr-decision" data-testid="evidence-measurement">
    <h3>Evidence measurement</h3>
    <p className="rr-hint">What Qloo returned directly for this question. Counts are what Qloo returned, not a strength of fit.</p>
    {observed.length ? <><h4>Observed</h4><ul data-testid="evidence-observed">{observed.map((line) => <li key={line}>{line}</li>)}</ul></> : <p className="rr-hint">No direct observation was recorded.</p>}
    {showCoverage ? <><h4>What the question covered</h4><ul className="rr-coverage" data-testid="evidence-coverage">{coverage.map((item) => <li key={item.concept} data-status={item.status}><strong>{item.concept}</strong>: {COVERAGE[item.status]}. {item.note}</li>)}</ul></> : null}
    {limitations.length ? <><h4>Limits of this evidence</h4><ul>{limitations.map((line) => <li key={line}>{line}</li>)}</ul></> : null}
    {missing.length ? <><h4>What would change the answer</h4><ul data-testid="evidence-missing">{missing.map((line) => <li key={line}>{line}</li>)}</ul></> : null}
  </section>;
}

export function StrategicMeaningView({ card }: { card: DecisionCard }) {
  if (!card.whyInteresting.length && !card.interpretations?.length) return null;
  return <section className="rr-section rr-decision" data-testid="decision-card" data-implication={card.implication.code}>
    <h3>Strategic meaning</h3>
    {card.whyInteresting.length ? <><h4>Why it matters</h4><ul>{card.whyInteresting.map((line) => <li key={line}>{line}</li>)}</ul></> : null}
    {card.interpretations?.length ? <div data-testid="decision-interpretations">
      <h4>Strategic interpretation <span className="rr-hint">(reasoning, not evidence)</span></h4>
      {card.interpretations.map((item) => <dl key={item.observation} className="rr-decision__interpretation" data-horizon={item.horizon}>
        <dt>Observed</dt><dd>{item.observation}</dd>
        <dt>Could mean</dt><dd>{item.interpretation}</dd>
        <dt>Why it may matter</dt><dd>{item.implication} <span className="rr-hint">({HORIZON[item.horizon]})</span></dd>
        <dt>Could be wrong if</dt><dd>{item.counterpoint}</dd>
        <dt>To validate</dt><dd>{item.validation}</dd>
      </dl>)}
    </div> : null}
  </section>;
}

export function NextStepsView({ card, onAsk }: { card: DecisionCard; onAsk?: (question: string) => void }) {
  return <section className="rr-section rr-decision">
    <h3>Best next research action</h3>
    <ul data-testid="decision-next">{card.nextActions.map((action) => <li key={action.kind} data-kind={action.kind}>
      {action.text}
      {action.question && onAsk ? <> <button type="button" className="rr-chip-button rr-chip-button--inline" onClick={() => onAsk(action.question!)}>Ask this</button></> : null}
    </li>)}</ul>
    <p className="rr-hint">{ORIGIN[card.evidenceOrigin]} An interpretation of cultural evidence, not a forecast of commercial results.</p>
  </section>;
}

/** The card's uncertainty lines, kept for the technical details. */
export function DecisionUncertainty({ card }: { card: DecisionCard }) {
  return card.uncertain.length ? <ul data-testid="decision-uncertain">{card.uncertain.map((line) => <li key={line}>{line}</li>)}</ul> : null;
}
