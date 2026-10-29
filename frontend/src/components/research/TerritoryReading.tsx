"use client";

import { FIT_STEPS, type TerritoryReading } from "@/lib/territory-reading";
import { TagChip } from "./TagChip";

function Chips({ title, hint, items }: { title: string; hint: string; items: string[] }) {
  return <div className="rr-section">
    <h3>{title}</h3>
    <p className="rr-hint">{hint}</p>
    <ul className="rr-chips">{items.map((item) => <TagChip key={item} label={item} kind="entity" />)}</ul>
  </div>;
}

/** One territory's result in plain words. Everything shown is read from the deterministic result. */
export function TerritoryReadingView({ reading, brand, onMeasure, busy }: { reading: TerritoryReading; brand: string; onMeasure?: () => void; busy?: boolean }) {
  const { fit, name } = reading;
  return <section className="rr" data-testid="network-reading">
    <div className="rr-hero" data-fit={fit?.code ?? "NONE"} data-testid="network-elasticity">
      <p className="rr-eyebrow">How well does {name} fit {brand}?</p>
      <p className="rr-verdict" data-testid="network-verdict">{fit ? fit.label : "Not measured yet"}{fit ? <span className="rr-provisional">provisional</span> : null}</p>
      <p className="rr-meaning">{fit ? fit.meaning : `${name} hasn't been compared with other territories yet, so Qloo can't say how well it fits.`}</p>
      {fit ? <ol className="rr-scale" aria-label="Where it sits, from natural fit to cultural break">
        {FIT_STEPS.map((step) => <li key={step.code} data-active={fit.onScale === step.code ? "true" : undefined} aria-current={fit.onScale === step.code ? "true" : undefined}>{step.label}</li>)}
      </ol> : null}
      {fit && !fit.onScale ? <p className="rr-offscale">Not placed on the scale until the evidence settles.</p> : null}
      {reading.steadiness ? <p className="rr-steady" data-steady={reading.steadiness.steady ? "true" : "false"}>{reading.steadiness.text}</p> : null}
      {!fit && onMeasure ? <button type="button" className="rw-secondary" disabled={busy} onClick={onMeasure} data-testid="network-measure">Measure it with a Qloo comparison</button> : null}
    </div>

    {reading.compared.length > 1 ? <div className="rr-section">
      <h3>How it ranked</h3>
      <p className="rr-hint">How strongly Qloo links each one to {brand}, strongest first. The order holds only within these {reading.compared.length}.</p>
      <ol className="rr-rank">{reading.compared.map((item) => <li key={item.name} data-current={item.current ? "true" : undefined}>
        <span className="rr-rank__n">{item.position}</span>
        <span className="rr-rank__name">{item.name}</span>
        {item.current ? <span className="rr-rank__you">this one</span> : null}
      </li>)}</ol>
    </div> : null}

    {reading.sharedTastes.length ? <Chips title={`Tastes it shares with ${brand}`} hint={`Signals Qloo finds both in ${brand}'s profile and in the examples for ${name}.`} items={reading.sharedTastes} /> : null}
    {reading.closestMatches.length ? <Chips title={`Qloo's closest matches for ${brand} here`} hint={`Within ${name}, what Qloo associates most with ${brand}, in Qloo's order.`} items={reading.closestMatches} /> : null}
    {reading.examples.length ? <Chips title="Examples that stand for it" hint={`What the agent used to represent ${name} in the comparison.`} items={reading.examples} /> : null}

    {reading.unknowns.length ? <div className="rr-section">
      <h3>What we don&apos;t know yet</h3>
      <ul className="rr-unknowns">{reading.unknowns.map((line) => <li key={line}>{line}</li>)}</ul>
    </div> : null}

    {reading.technical.length || reading.concept ? <details className="rr-tech">
      <summary>Technical notes</summary>
      <ul>
        {reading.concept ? <li>Qloo concept: {reading.concept}</li> : null}
        {reading.technical.map((line) => <li key={line}>{line}</li>)}
      </ul>
    </details> : null}
    <p className="rr-foot">This describes cultural taste from Qloo. It is not a forecast of sales or demand.</p>
  </section>;
}
