"use client";

import type { AgentRunResponse, AnyBrandBaselineResult, QueryResponse } from "@cultural-elasticity/shared";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { reasonCopy } from "@/components/atlas/atlas-model";
import { evidenceTerm } from "@/lib/evidence-presentation";
import type { JobActivity } from "@/lib/job-envelope";
import { hypothesisOutcomeCopy } from "@/lib/research-copy";
import { BRAND_NODE, buildNetwork, canRetry, directionNodeId, inquiryNodeId, isPending, layoutNetwork, type Inquiry, type NetworkNode } from "@/lib/research-network";
import { buildResearchView, type ConnectionView, type DirectionView, type ResearchView } from "@/lib/research-view";
import { NetworkBoard, type BoardInset } from "./NetworkBoard";

/** Floating legend (top), dossier (right) and composer (bottom) cover these parts of the board. */
const BOARD_INSET: BoardInset = { top: 64, right: 430, bottom: 150, left: 70 };
import { useResearchNetwork } from "./use-research-network";
import { useResearchLayout } from "./use-research-layout";

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

type Elasticity = { label: string; explanation: string; position: string | null; set: string[]; robustness: string | null };

/** The elasticity reading of one territory, only when the deterministic methodology classified it. */
function elasticityOf(result: AgentRunResponse | null | undefined, territoryKey: string | null): Elasticity | null {
  if (!result || result.status === "NEEDS_INPUT") return null;
  const territory = result.territories.find((item) => (territoryKey ? item.key === territoryKey : item.role === "target") && item.classification);
  if (!territory?.classification) return null;
  const term = evidenceTerm(territory.classification.label);
  const position = territory.relativePosition?.position != null ? `Position ${territory.relativePosition.position} of ${territory.relativePosition.of} within the compared set` : null;
  return { label: term.label, explanation: term.explanation, position, set: territory.comparisonSet?.labels ?? [], robustness: territory.robustness?.level ?? null };
}

function ElasticityBlock({ elasticity, pending, investigated, onMeasure, busy }: { elasticity: Elasticity | null; pending?: boolean; investigated?: boolean; onMeasure?: () => void; busy?: boolean }) {
  return (
    <div className="rn-elasticity" data-testid="network-elasticity">
      <h3>Degree of elasticity</h3>
      {elasticity ? <>
        <p className="rn-elasticity__label">{elasticity.label} <span className="quiet">(provisional)</span></p>
        <p>{elasticity.explanation}</p>
        {elasticity.position ? <p className="quiet">{elasticity.position}{elasticity.set.length ? `: ${elasticity.set.join(", ")}` : ""}. Robustness {elasticity.robustness?.toLowerCase() ?? "unknown"}.</p> : null}
      </> : <p className="quiet">{pending ? "Being measured by the investigation." : investigated ? "Not measured by this investigation. A degree of elasticity needs a comparison with other territories from the same Qloo evidence." : "Not measured yet. Elasticity is only measured by an investigation, from Qloo evidence compared within one set."}</p>}
      {!elasticity && !pending && onMeasure ? <button type="button" className="rw-secondary" disabled={busy} onClick={onMeasure}>Measure it: compare with territories you name</button> : null}
    </div>
  );
}

function connectionsFor(view: ResearchView, direction: DirectionView): ConnectionView[] {
  const all = [...view.core.categories, ...view.tasteTags, ...view.keywords, ...view.collections.flatMap((collection) => collection.items)];
  const refs = new Set(direction.refs.map((ref) => `${ref.correlationId}:${ref.sourceId}`));
  const linked = all.filter((item) => item.key === direction.linkedConnectionKey || refs.has(`${item.source.correlationId}:${item.source.sourceId}`));
  return [...new Map(linked.map((item) => [item.key, item])).values()].slice(0, 8);
}

function BrandDossier({ view, onSelect }: { view: ResearchView; onSelect: (id: string) => void }) {
  return <>
    <p className="kicker">Cultural fingerprint</p>
    <h2>{view.brand.name}</h2>
    <p>{view.outcome.headline}</p>
    <p className="quiet">{view.outcome.detail}</p>
    {view.core.categories.length ? <><h3>What the brand is, per Qloo</h3><p>{view.core.categories.map((item) => item.name).join(", ")}</p></> : null}
    {view.tasteTags.length ? <><h3>Taste signals</h3><p>{view.tasteTags.slice(0, 10).map((item) => item.name).join(", ")}</p></> : null}
    {view.collections.filter((collection) => collection.items.length).map((collection) => <div key={collection.domain}><h3>{collection.title}</h3><p>{collection.items.slice(0, 6).map((item) => item.name).join(", ")}</p></div>)}
    <h3>Directions found</h3>
    {view.directions.length ? <ul className="rn-links">{view.directions.map((direction) => <li key={direction.key}><button type="button" className="rn-link" onClick={() => onSelect(directionNodeId(direction.key))}>{direction.name}</button></li>)}</ul>
      : <p className="quiet">No direction had enough evidence. Ask a question below to explore.</p>}
  </>;
}

function InquiryResult({ response }: { response: QueryResponse }) {
  const result = response.investigation?.result ?? null;
  if (!response.investigation) {
    return <p>{response.interpretation?.clarificationQuestion ?? reasonCopy(response.reasons[0]?.code ?? response.state, response.interpretation?.unsupportedCapabilities[0] ?? null)}</p>;
  }
  if (!result) return <p className="quiet">The investigation returned no result yet.</p>;
  if (result.status === "NEEDS_INPUT") return <p><strong>The agent needs one answer:</strong> {result.question}</p>;
  const assessment = result.hypothesisAssessment;
  return <>
    {assessment ? <>
      <p className="rn-outcome"><strong>{hypothesisOutcomeCopy[assessment.outcome]}.</strong> A cultural research judgment, not a commercial recommendation.</p>
      {assessment.observed.length ? <><h3>What Qloo showed</h3><ul>{assessment.observed.map((line) => <li key={line}>{line}</li>)}</ul></> : null}
      {assessment.supports.length ? <><h3>What supports it</h3><ul>{assessment.supports.map((line) => <li key={line}>{line}</li>)}</ul></> : null}
      {[...assessment.limitations, ...assessment.unknowns].length ? <><h3>Still uncertain</h3><ul>{[...assessment.limitations, ...assessment.unknowns].map((line) => <li key={line}>{line}</li>)}</ul></> : null}
    </> : null}
    {result.summary.claimValidation.passed ? <p>{result.summary.text}</p> : null}
  </>;
}

/** The agent's steps as the server reports them. Its reasons are its own notes, never evidence. */
function AgentActivity({ entries, live }: { entries: JobActivity[]; live: boolean }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => { if (live) list.current?.lastElementChild?.scrollIntoView({ block: "nearest" }); }, [entries.length, live]);
  return <div className="rn-trace" data-live={live ? "true" : undefined} data-testid="network-activity">
    <ol ref={list} aria-live={live ? "polite" : undefined}>
      {entries.map((entry, index) => <li key={index} data-kind={entry.kind} data-status={entry.status} style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}>
        <span className="rn-trace__label">{entry.label}</span>
        {entry.detail ? <span className="rn-trace__detail">{entry.detail}</span> : null}
      </li>)}
      {live ? <li className="rn-trace__thinking" aria-label="The agent is thinking"><span /><span /><span /></li> : null}
    </ol>
    <p className="quiet rn-trace__note">Steps come from the agent's trace. Its stated reasons are its own notes, not evidence; every number comes from Qloo.</p>
  </div>;
}

function InquiryDossier({ inquiry, node, onAnswer, onAsk, onMeasure, onRetry, onRephrase, busy }: { inquiry: Inquiry; node: NetworkNode; onAnswer: (text: string) => void; onAsk: (question: string) => void; onMeasure?: () => void; onRetry?: () => void; onRephrase?: () => void; busy: boolean }) {
  const [answer, setAnswer] = useState("");
  const response = inquiry.response;
  const result = response?.investigation?.result;
  const running = node.tone === "running";
  const waiting = node.status === "Needs your answer";
  const followUps = result && result.status !== "NEEDS_INPUT" ? result.followUpOptions : [];
  return <>
    <p className="kicker">{inquiry.origin === "direction" ? "Agent investigation" : "Research question"}</p>
    <h2>{inquiry.question}</h2>
    <p className="rn-status" data-tone={node.tone} role="status">{running ? `The agent is working: ${inquiry.stageLabel || "investigating"}` : node.status}</p>
    {inquiry.lost ? <p className="quiet">The research service no longer holds this investigation (it expired or restarted). Its question stays in your network; try it again to continue.</p> : null}
    {running ? <AgentActivity entries={inquiry.activity ?? []} live /> : null}
    {response && !running ? <InquiryResult response={response} /> : null}
    {!running && response && !response.investigation && onRephrase ? <button type="button" className="rw-secondary" disabled={busy} onClick={onRephrase}>Rephrase it as a question</button> : null}
    {onRetry ? <button type="button" className="primary" data-testid="network-retry" disabled={busy} onClick={onRetry}>Try again</button> : null}
    {!running && response?.investigation ? <ElasticityBlock elasticity={elasticityOf(result, null)} investigated onMeasure={onMeasure} busy={busy} /> : running ? <ElasticityBlock elasticity={null} pending /> : null}
    {waiting ? <form className="rn-answer" onSubmit={(event) => { event.preventDefault(); if (answer.trim()) { onAnswer(answer.trim()); setAnswer(""); } }}>
      <label htmlFor="rn-answer">Your answer</label>
      <input id="rn-answer" value={answer} maxLength={1000} onChange={(event) => setAnswer(event.target.value)} />
      <button type="submit" className="primary" disabled={busy || !answer.trim()}>Answer</button>
    </form> : null}
    {!running && inquiry.activity?.length ? <details className="rn-trace-details"><summary>How the agent worked ({inquiry.activity.length} steps)</summary><AgentActivity entries={inquiry.activity} live={false} /></details> : null}
    {followUps.length ? <><h3>Continue this path</h3><ul className="rn-links">{followUps.map((step) => <li key={step}><button type="button" className="rn-link" disabled={busy} onClick={() => onAsk(step)}>{step}</button></li>)}</ul></> : null}
  </>;
}

function FindingDossier({ node, inquiry, brand, onAsk, onMeasure, busy }: { node: NetworkNode; inquiry: Inquiry | null; brand: string; onAsk: (question: string) => void; onMeasure?: () => void; busy: boolean }) {
  return <>
    <p className="kicker">Territory found by the agent</p>
    <h2>{node.label}</h2>
    <p className="rn-status" data-tone={node.tone}>{node.status}</p>
    <ElasticityBlock elasticity={elasticityOf(inquiry?.response?.investigation?.result, node.territoryKey)} investigated onMeasure={onMeasure} busy={busy} />
    <h3>Continue this path</h3>
    <button type="button" className="primary" disabled={busy} onClick={() => onAsk(`How far can ${brand} extend into ${node.label}?`)}>Investigate {node.label}</button>
  </>;
}

function DirectionDossier({ view, direction, inquiries, canInvestigate, busy, onInvestigate, onSelect }: { view: ResearchView; direction: DirectionView; inquiries: Inquiry[]; canInvestigate: boolean; busy: boolean; onInvestigate: () => void; onSelect: (id: string) => void }) {
  const connections = connectionsFor(view, direction);
  const latest = [...inquiries].reverse().find((item) => item.response?.investigation?.result);
  const running = inquiries.some((item) => item.status === "queued" || item.status === "running");
  return <>
    <p className="kicker">Direction</p>
    <h2>{direction.name}</h2>
    <p className="quiet">{direction.categoryLabel}</p>
    <h3>Why it is here</h3>
    <p>{direction.why}</p>
    <h3>Its cultural fingerprint</h3>
    <p>{direction.signals.join("; ")}. {direction.strength}.</p>
    {connections.length ? <><h3>Connections behind it</h3><ul>{connections.map((item) => <li key={item.key}><strong>{item.name}</strong> <span className="quiet">{item.contextLine}</span></li>)}</ul></> : null}
    <ElasticityBlock elasticity={elasticityOf(latest?.response?.investigation?.result, null)} pending={running} />
    <h3>Still unknown</h3>
    <ul>{direction.unknown.map((line) => <li key={line}>{line}</li>)}</ul>
    {inquiries.length ? <><h3>Investigations of this direction</h3><ul className="rn-links">{inquiries.map((item) => <li key={item.jobId}><button type="button" className="rn-link" onClick={() => onSelect(inquiryNodeId(item.jobId))}>{item.question}</button></li>)}</ul></> : null}
    {canInvestigate
      ? <button type="button" className="primary" data-testid="network-investigate" disabled={busy || running} onClick={onInvestigate}>{running ? "Investigating…" : inquiries.length ? "Investigate again" : "Investigate this direction"}</button>
      : <p className="quiet">This direction comes from recorded research, so it can&apos;t be investigated directly. Ask about it in the question box below instead.</p>}
  </>;
}

/** A card and every card that grew from it: dragging a card carries its branch. */
function branchOf(nodes: readonly NetworkNode[], id: string): string[] {
  const out = [id];
  for (let index = 0; index < out.length; index += 1) for (const node of nodes) if (node.parentId === out[index] && !out.includes(node.id)) out.push(node.id);
  return out;
}

export function ResearchNetwork({ result, scanToken, canAsk, canInvestigate, onHome, onClassic, onSections }: { result: AnyBrandBaselineResult; scanToken: string | null; canAsk: boolean; canInvestigate: boolean; onHome: () => void; onClassic: () => void; onSections: () => void }) {
  const view = useMemo(() => buildResearchView(result, {}), [result]);
  const network = useResearchNetwork({ scanId: view.scanId, brand: view.brand.name, scanToken });
  const [selectedId, setSelectedId] = useState<string>(BRAND_NODE);
  const [question, setQuestion] = useState("");
  const [openDirection, setOpenDirection] = useState<string | null>(null);
  const expanded = useMemo(() => {
    const direction = view.directions.find((item) => directionNodeId(item.key) === openDirection);
    return direction ? { nodeId: directionNodeId(direction.key), connections: connectionsFor(view, direction).map((item) => ({ key: item.key, name: item.name })) } : null;
  }, [view, openDirection]);
  const nodes = useMemo(() => buildNetwork(view.brand.name, view.directions, network.inquiries, expanded), [view, network.inquiries, expanded]);
  const layout = useResearchLayout(view.scanId);
  const positions = useMemo(() => layout.apply(layoutNetwork(nodes)), [nodes, layout]);
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const selected = byId.get(selectedId) ?? byId.get(BRAND_NODE)!;
  const previousCount = useRef(network.inquiries.length);

  // A newly started investigation becomes the selection, so its progress is visible at once.
  useEffect(() => {
    if (network.inquiries.length > previousCount.current) {
      const latest = [...network.inquiries].sort((a, b) => b.createdAt - a.createdAt)[0];
      if (latest) setSelectedId(inquiryNodeId(latest.jobId));
    }
    previousCount.current = network.inquiries.length;
  }, [network.inquiries]);

  // Opening a direction shows its Qloo connections around it; selecting one of them keeps the direction open.
  useEffect(() => {
    const node = byId.get(selectedId);
    if (node?.kind === "direction") setOpenDirection(node.id);
    else if (node && node.kind !== "connection") setOpenDirection(null);
  }, [selectedId, byId]);

  /**
   * A comparison within one Qloo call is what measures elasticity. The user names the reference territories: guessed
   * references (baseline tags) often do not resolve as Qloo concepts, and the comparison then measures nothing.
   */
  const composerRef = useRef<HTMLInputElement>(null);
  const measureFor = (label: string) => {
    if (!live) return undefined;
    return () => {
      setQuestion(`Compare ${label} with `);
      composerRef.current?.focus();
    };
  };
  // Retry starts the same request again from the same parent; the new job takes the failed card's place.
  const retryFor = (inquiry: Inquiry) => {
    if (!live || !canRetry(inquiry)) return undefined;
    const parent = byId.get(inquiry.parentId) ?? null;
    const direction = inquiry.origin === "direction" ? view.directions.find((item) => directionNodeId(item.key) === inquiry.parentId) : undefined;
    if (inquiry.origin === "direction" && (!direction || !canInvestigate || !scanToken)) return undefined;
    return () => {
      void network.retry(inquiry, direction ? { directionId: direction.id } : { from: parent?.runId ? parent : null })
        .then((jobId) => { if (jobId) setSelectedId(inquiryNodeId(jobId)); });
    };
  };
  const inquiryOf = (node: NetworkNode) => network.inquiries.find((item) => item.jobId === node.jobId) ?? null;
  const askFrom = selected.runId ? selected : null;
  const live = canAsk;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = question.trim();
    if (!text) return;
    void network.ask(text, askFrom).then((started) => { if (started) setQuestion(""); });
  };

  let dossier;
  const directionNode = selected.kind === "connection" ? byId.get(selected.parentId ?? "") ?? selected : selected;
  if (directionNode.kind === "direction") {
    const direction = view.directions.find((item) => item.key === directionNode.directionKey)!;
    const related = network.inquiries.filter((item) => item.parentId === directionNode.id && item.origin === "direction");
    dossier = <DirectionDossier view={view} direction={direction} inquiries={related} canInvestigate={canInvestigate && Boolean(scanToken)} busy={network.starting} onInvestigate={() => void network.investigateDirection(direction.id, direction.name, directionNode.id)} onSelect={setSelectedId} />;
  } else if (selected.kind === "inquiry") {
    const inquiry = inquiryOf(selected);
    dossier = inquiry ? <InquiryDossier key={inquiry.jobId} inquiry={inquiry} node={selected} busy={network.starting || !live} onAnswer={(text) => void network.answer(inquiry, text)} onAsk={(text) => void network.ask(text, selected)} onMeasure={measureFor(inquiry.response?.territories[0]?.name ?? inquiry.question)} onRetry={retryFor(inquiry)} onRephrase={live ? () => { setQuestion(inquiry.question); setSelectedId(inquiry.parentId); composerRef.current?.focus(); } : undefined} /> : null;
  } else if (selected.kind === "finding") {
    const parentInquiry = inquiryOf(selected);
    dossier = <FindingDossier node={selected} inquiry={parentInquiry} brand={view.brand.name} busy={network.starting || !live || Boolean(parentInquiry && isPending(parentInquiry))} onAsk={(text) => void network.ask(text, selected)} onMeasure={measureFor(selected.label)} />;
  } else {
    dossier = <BrandDossier view={view} onSelect={setSelectedId} />;
  }

  return (
    <section className="rn" aria-labelledby="rn-title" data-testid="research-network">
      <header className="rn-header">
        <div>
          <p className="kicker">Research network · {view.origin === "recorded" ? "recorded Qloo evidence" : "live Qloo evidence"}</p>
          <h1 id="rn-title" tabIndex={-1}>{view.brand.name}</h1>
        </div>
        <div className="rn-header__actions">
          <button type="button" className="ghost" onClick={onHome}>Research library</button>
          <button type="button" className="ghost" onClick={onSections}>Sections view</button>
          <button type="button" className="ghost" onClick={onClassic}>Research brief</button>
        </div>
      </header>
      <div className="rn-stage">
        <NetworkBoard nodes={nodes} positions={positions} selectedId={selected.id} onSelect={setSelectedId}
          onMove={(id, dx, dy, origin) => layout.move(branchOf(nodes, id), origin, dx, dy)} onTidy={layout.reset} moved={layout.moved} label={`Research network for ${view.brand.name}`} inset={BOARD_INSET} />
        <ul className="rn-legend" aria-label="Legend">
          <li data-tone="brand">Brand</li><li data-tone="hypothesis">Direction</li><li data-tone="running">Agent investigating</li><li data-tone="supported">Worth pursuing</li><li data-tone="partial">Inconclusive or partial</li><li data-tone="unsupported">Not supported or not run</li>
        </ul>
        <p className="rn-note">Drag to move, scroll to zoom. Lines show what was investigated from what; distance on the board is not cultural distance.</p>
        <aside className="rn-dossier" aria-live="polite" data-testid="network-dossier">{dossier}</aside>
        <form className="rn-composer" onSubmit={submit} data-testid="network-composer">
          <label htmlFor="rn-question">
            {askFrom ? <>Continue from <strong>{clip(selected.label, 48)}</strong></> : <>Ask a research question about <strong>{view.brand.name}</strong></>}
          </label>
          <div className="rn-composer__row">
            <input id="rn-question" ref={composerRef} value={question} maxLength={2000} placeholder={askFrom ? "Ask a follow-up, narrow it down, or switch territory" : `Where could ${view.brand.name} go next? How far can ${view.brand.name} extend into tennis?`} onChange={(event) => setQuestion(event.target.value)} disabled={!live} />
            <button type="submit" className="primary" disabled={!live || network.starting || !question.trim()}>{network.starting ? "Starting…" : "Ask the agent"}</button>
          </div>
          <p className="quiet">{live ? "The agent plans its own Qloo lookups within a fixed budget. Every number it reports comes from Qloo." : "Live research is off, so new questions can’t start. You can still explore this network."}</p>
          {network.notice ? <p className="notice" role="alert">{network.notice}</p> : null}
        </form>
      </div>
    </section>
  );
}
