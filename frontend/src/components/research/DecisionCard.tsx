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

/** The Strategic Decision Card: a deterministic projection of the stored result (shared `decisionCard`). */
export function DecisionCardView({ card }: { card: DecisionCard }) {
  return <section className="rr-section rr-decision" data-testid="decision-card" data-implication={card.implication.code}>
    <h3>What this means</h3>
    <p className="rr-decision__finding" data-testid="decision-finding">{card.finding}</p>
    <p className="rr-decision__implication"><strong>{card.implication.label}.</strong> {card.implication.text}</p>
    {card.whyInteresting.length ? <><h4>Why it is interesting</h4><ul>{card.whyInteresting.map((line) => <li key={line}>{line}</li>)}</ul></> : null}
    {card.supports.length ? <><h4>What the evidence supports</h4><ul>{card.supports.map((line) => <li key={line}>{line}</li>)}</ul></> : null}
    <h4>What remains uncertain</h4>
    <ul data-testid="decision-uncertain">{card.uncertain.map((line) => <li key={line}>{line}</li>)}</ul>
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
    <h4>Next useful step</h4>
    <ul data-testid="decision-next">{card.nextActions.map((action) => <li key={action.kind} data-kind={action.kind}>{action.text}</li>)}</ul>
    <p className="rr-hint">{ORIGIN[card.evidenceOrigin]} An interpretation of cultural evidence, not a forecast of commercial results.</p>
  </section>;
}
