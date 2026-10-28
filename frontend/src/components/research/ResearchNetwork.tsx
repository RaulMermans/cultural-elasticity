"use client";

import type { AgentRunResponse, AnyBrandBaselineResult, QueryResponse } from "@cultural-elasticity/shared";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { reasonCopy } from "@/components/atlas/atlas-model";
import { elasticityVerdict } from "@/lib/elasticity-verdict";
import { evidenceTerm } from "@/lib/evidence-presentation";
import type { JobActivity } from "@/lib/job-envelope";
import { hypothesisOutcomeCopy } from "@/lib/research-copy";
import { BRAND_NODE, branchDirection, buildNetwork, lineageOf, territoryAncestor, canRetry, directionNodeId, inquiryNodeId, isPending, normName, layoutNetwork, type Inquiry, type NetworkNode } from "@/lib/research-network";
import { buildResearchView, type ConnectionView, type DirectionView, type ResearchView } from "@/lib/research-view";
import { NetworkBoard, type BoardInset } from "./NetworkBoard";

/** Floating legend (top), dossier (right) and composer (bottom) cover these parts of the board. */
const BOARD_INSET: BoardInset = { top: 64, right: 430, bottom: 150, left: 70 };
import { useResearchNetwork } from "./use-research-network";
import { useResearchLayout } from "./use-research-layout";
import { TerritoryReadingView } from "./TerritoryReading";
import { territoryReading } from "@/lib/territory-reading";
import { crossLinks, territoryItems, type CrossLink, type EvidenceItem, type LinkSource } from "@/lib/research-links";

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

type Elasticity = { code: string; label: string; explanation: string; position: number | null; of: number | null; set: string[]; robustness: string | null };

/** The elasticity reading of one territory, only when the deterministic methodology classified it. */
function elasticityOf(result: AgentRunResponse | null | undefined, territoryKey: string | null): Elasticity | null {
  if (!result || result.status === "NEEDS_INPUT") return null;
  const territory = result.territories.find((item) => (territoryKey ? item.key === territoryKey : item.role === "target") && item.classification);
  if (!territory?.classification) return null;
  const term = evidenceTerm(territory.classification.label);
  return { code: territory.classification.label, label: term.label, explanation: term.explanation, position: territory.relativePosition?.position ?? null, of: territory.relativePosition?.of ?? null, set: territory.comparisonSet?.labels ?? [], robustness: territory.robustness?.level ?? null };
}

function ElasticityBlock({ elasticity, brand, pending, investigated, onMeasure, busy }: { elasticity: Elasticity | null; brand: string; pending?: boolean; investigated?: boolean; onMeasure?: () => void; busy?: boolean }) {
  const verdict = elasticity ? elasticityVerdict({ ...elasticity, brand }) : null;
  return (
    <div className="rn-elasticity" data-testid="network-elasticity">
      <h3>Degree of elasticity</h3>
      {elasticity ? <>
        <p className="rn-elasticity__label">{elasticity.label} <span className="quiet">(provisional)</span></p>
        <p className="rn-verdict" data-testid="network-verdict"><strong>In short:</strong> {verdict!.headline}</p>
        {verdict!.lines.length ? <ul>{verdict!.lines.map((line) => <li key={line}>{line}</li>)}</ul> : null}
      </> : <p className="quiet">{pending ? "Being measured by the investigation." : investigated ? "Not measured by this investigation. A degree of elasticity needs a comparison with other territories from the same Qloo evidence." : "Not measured yet. Elasticity is only measured by an investigation, from Qloo evidence compared within one set."}</p>}
      {!elasticity && !pending && onMeasure ? <button type="button" className="rw-secondary" disabled={busy} onClick={onMeasure}>Measure it: compare with territories you name</button> : null}
    </div>
  );
}

/** A territory's plain reading when the run has one; otherwise the elasticity state alone. */
function Reading({ result, territoryKey, brand, pending, investigated, onMeasure, busy }: { result: AgentRunResponse | null | undefined; territoryKey: string | null; brand: string; pending?: boolean; investigated?: boolean; onMeasure?: () => void; busy?: boolean }) {
  const reading = pending ? null : territoryReading(result, territoryKey, brand);
  if (reading) return <TerritoryReadingView reading={reading} brand={brand} onMeasure={onMeasure} busy={busy} />;
  return <ElasticityBlock elasticity={pending ? null : elasticityOf(result, territoryKey)} brand={brand} pending={pending} investigated={investigated} onMeasure={onMeasure} busy={busy} />;
}

const KIND_WORD: Record<EvidenceItem["kind"], string> = { concept: "Same Qloo concept", taste: "Shared taste", example: "Same example" };

/** Other branches tied to this card by the same Qloo identifiers. A tie is shared evidence, not a similarity score. */
function SharedAcross({ links, selectedId, byId, onSelect }: { links: CrossLink[]; selectedId: string; byId: ReadonlyMap<string, NetworkNode>; onSelect: (id: string) => void }) {
  return <section className="rr-section rn-shared" data-testid="network-shared">
    <h3>Also connected, on another branch</h3>
    <p className="rr-hint">These cards sit on different branches but carry the same Qloo signals, so they can be looked at side by side. This is shared evidence, not a similarity score.</p>
    <ul className="rn-shared__list">{links.map((link) => {
      const other = byId.get(link.a === selectedId ? link.b : link.a);
      if (!other) return null;
      return <li key={other.id}>
        <button type="button" className="rn-link" onClick={() => onSelect(other.id)}>{other.label}</button>
        <ul className="rr-chips">{link.shared.slice(0, 6).map((item) => <li key={item.id} data-kind={item.kind} title={KIND_WORD[item.kind]}>{item.label}</li>)}</ul>
      </li>;
    })}</ul>
  </section>;
}

/** Removing a branch takes two deliberate steps. It only changes this browser's board; spend already made stays spent. */
function DeleteBranch({ count, running, onDelete }: { count: number; running: boolean; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (running) return <p className="quiet rn-delete__note">This branch can be removed once its investigation finishes.</p>;
  return <div className="rn-delete" data-testid="network-delete">
    {!confirming
      ? <button type="button" className="rn-link rn-delete__start" onClick={() => setConfirming(true)}>Remove this branch…</button>
      : <div className="rn-delete__confirm" role="alertdialog" aria-labelledby="rn-delete-title">
        <p id="rn-delete-title"><strong>Remove {count === 1 ? "this card" : `these ${count} cards`} from your board?</strong> The answers are deleted from this browser and can&apos;t be brought back. Credits already used are not refunded.</p>
        <div className="rn-delete__actions">
          <button type="button" className="rw-secondary" onClick={() => setConfirming(false)} autoFocus>Keep it</button>
          <button type="button" className="rn-delete__yes" onClick={onDelete}>Yes, remove {count === 1 ? "it" : `all ${count}`}</button>
        </div>
      </div>}
  </div>;
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

/** The territory of an inquiry's branch, as the server returned it in that inquiry's response. */
function branchTerritory(response: QueryResponse | null, branch: string | null) {
  if (!response) return null;
  return (branch ? response.territories.find((item) => normName(item.name) === normName(branch)) : null) ?? (response.territories.length === 1 ? response.territories[0]! : null);
}

function InquiryDossier({ inquiry, node, brand, branch, onAnswer, onAsk, onMeasure, onRetry, onRephrase, busy }: { inquiry: Inquiry; node: NetworkNode; brand: string; branch: string | null; onAnswer: (text: string) => void; onAsk: (question: string) => void; onMeasure?: () => void; onRetry?: () => void; onRephrase?: () => void; busy: boolean }) {
  const [answer, setAnswer] = useState("");
  const response = inquiry.response;
  const result = response?.investigation?.result;
  const running = node.tone === "running";
  const waiting = node.status === "Needs your answer";
  const followUps = result && result.status !== "NEEDS_INPUT" ? result.followUpOptions : [];
  const territory = branchTerritory(response, branch);
  return <>
    <p className="kicker">{inquiry.origin === "direction" ? "Agent investigation" : "Research question"}</p>
    <h2>{inquiry.question}</h2>
    <p className="rn-status" data-tone={node.tone} role="status">{running ? `The agent is working: ${inquiry.stageLabel || "investigating"}` : node.status}</p>
    {inquiry.lost && node.status === "No longer available" ? <p className="quiet">The research service no longer holds this investigation (it expired or restarted) and it never sent an answer. Its question stays in your network; try it again to continue.</p> : null}
    {inquiry.lost && node.status !== "No longer available" ? <p className="quiet">Its answer is kept in this browser. The research service has let the run go, so a new question from here starts fresh on the same direction.</p> : null}
    {running ? <AgentActivity entries={inquiry.activity ?? []} live /> : null}
    {response && !running ? <InquiryResult response={response} /> : null}
    {!running && response && !response.investigation && onRephrase ? <button type="button" className="rw-secondary" disabled={busy} onClick={onRephrase}>Rephrase it as a question</button> : null}
    {onRetry ? <button type="button" className="primary" data-testid="network-retry" disabled={busy} onClick={onRetry}>Try again</button> : null}
    {!running && response?.investigation ? (territory || response.territories.length <= 1
      ? <Reading result={result} territoryKey={territory?.territoryKey ?? null} brand={brand} investigated onMeasure={onMeasure} busy={busy} />
      : <p className="quiet">This question looked at {response.territories.length} territories. Open each card around it to see how it fits {brand}.</p>) : running ? <ElasticityBlock elasticity={null} brand={brand} pending /> : null}
    {waiting ? <form className="rn-answer" onSubmit={(event) => { event.preventDefault(); if (answer.trim()) { onAnswer(answer.trim()); setAnswer(""); } }}>
      <label htmlFor="rn-answer">Your answer</label>
      <input id="rn-answer" value={answer} maxLength={1000} onChange={(event) => setAnswer(event.target.value)} />
      <button type="submit" className="primary" disabled={busy || !answer.trim()}>Answer</button>
    </form> : null}
    {!running && inquiry.activity?.length ? <details className="rn-trace-details"><summary>How the agent worked ({inquiry.activity.length} steps)</summary><AgentActivity entries={inquiry.activity} live={false} /></details> : null}
    {followUps.length ? <><h3>Continue this path</h3><ul className="rn-links">{followUps.map((step) => <li key={step}><button type="button" className="rn-link" disabled={busy} onClick={() => onAsk(step)}>{step}</button></li>)}</ul></> : null}
  </>;
}

function FindingDossier({ node, inquiry, brand, onInvestigate, onMeasure, busy }: { node: NetworkNode; inquiry: Inquiry | null; brand: string; onInvestigate: () => void; onMeasure?: () => void; busy: boolean }) {
  const response = inquiry?.response ?? null;
  return <>
    <p className="kicker">Territory found by the agent</p>
    <h2>{node.label}</h2>
    <p className="rn-status" data-tone={node.tone}>{node.status}</p>
    <Reading result={response?.investigation?.result} territoryKey={node.territoryKey} brand={brand} pending={Boolean(inquiry && isPending(inquiry))} investigated onMeasure={onMeasure} busy={busy} />
    <h3>Continue this path</h3>
    <p className="quiet">It came up in another question. Investigating it runs a full investigation of {node.label} and grows this branch.</p>
    <button type="button" className="primary" disabled={busy} onClick={onInvestigate}>Investigate {node.label} further</button>
  </>;
}

/** A direction the user's questions opened: a territory the baseline did not list. */
function NewDirectionDossier({ node, inquiries, brand, canAsk, busy, onInvestigate, onSelect }: { node: NetworkNode; inquiries: Inquiry[]; brand: string; canAsk: boolean; busy: boolean; onInvestigate: () => void; onSelect: (id: string) => void }) {
  const latest = [...inquiries].reverse().find((item) => item.response?.investigation?.result);
  const running = inquiries.some(isPending);
  const territory = branchTerritory(latest?.response ?? null, node.label);
  return <>
    <p className="kicker">New direction</p>
    <h2>{node.label}</h2>
    <p className="quiet">Opened by your questions. It was not among the directions the brand&apos;s baseline found, so its connections come only from the investigations below.</p>
    <Reading result={latest?.response?.investigation?.result} territoryKey={territory?.territoryKey ?? null} brand={brand} pending={running} investigated={Boolean(latest)} />
    {inquiries.length ? <><h3>Investigations and questions on this direction</h3><ul className="rn-links">{inquiries.map((item) => <li key={item.jobId}><button type="button" className="rn-link" onClick={() => onSelect(inquiryNodeId(item.jobId))}>{item.question}</button></li>)}</ul></> : null}
    {canAsk && !inquiries.length ? <button type="button" className="primary" disabled={busy || running} onClick={onInvestigate}>Investigate this direction</button> : null}
    <p className="quiet">Select it and ask below to branch a new question from it.</p>
  </>;
}

function DirectionDossier({ view, direction, inquiries, canInvestigate, busy, onInvestigate, onSelect }: { view: ResearchView; direction: DirectionView; inquiries: Inquiry[]; canInvestigate: boolean; busy: boolean; onInvestigate: () => void; onSelect: (id: string) => void }) {
  const investigations = inquiries.filter((item) => item.origin === "direction");
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
    {latest ? <Reading result={latest.response?.investigation?.result} territoryKey={branchTerritory(latest.response, direction.name)?.territoryKey ?? null} brand={view.brand.name} pending={running} investigated />
      : <ElasticityBlock elasticity={null} brand={view.brand.name} pending={running} />}
    <h3>Still unknown</h3>
    <ul>{direction.unknown.map((line) => <li key={line}>{line}</li>)}</ul>
    {inquiries.length ? <><h3>Investigations and questions on this direction</h3><ul className="rn-links">{inquiries.map((item) => <li key={item.jobId}><button type="button" className="rn-link" onClick={() => onSelect(inquiryNodeId(item.jobId))}>{item.question}</button></li>)}</ul></> : null}
    {canInvestigate
      ? <button type="button" className="primary" data-testid="network-investigate" disabled={busy || running} onClick={onInvestigate}>{running ? "Investigating…" : investigations.length ? "Investigate again" : "Investigate this direction"}</button>
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
  // Ties are drawn between territory cards (directions and found territories), never between question cards. A
  // question's evidence counts for the territory card it grew from, when the question was about that territory.
  const links = useMemo(() => {
    const cards = new Map<string, LinkSource>();
    const add = (cardId: string, name: string, items: EvidenceItem[]) => {
      const card = cards.get(cardId) ?? { nodeId: cardId, lineage: lineageOf(nodes, cardId), name, items: [] };
      card.items = [...card.items, ...items];
      cards.set(cardId, card);
    };
    for (const node of nodes) {
      if (node.kind === "direction" && node.directionKey) {
        const direction = view.directions.find((item) => item.key === node.directionKey);
        if (direction?.canonicalConcept) add(node.id, node.label, [{ id: direction.canonicalConcept, label: direction.name, kind: "concept" }]);
        continue;
      }
      if (node.kind !== "inquiry" && node.kind !== "finding") continue;
      const inquiry = network.inquiries.find((item) => item.jobId === node.jobId);
      const result = inquiry?.response?.investigation?.result;
      if (!inquiry || !result || isPending(inquiry)) continue;
      if (node.kind === "finding") {
        const found = territoryItems(result, node.territoryKey);
        if (found?.items.length) add(node.id, found.name, found.items);
        continue;
      }
      const card = node.parentId ? territoryAncestor(nodes, node.parentId) : null;
      const own = card ? inquiry.response?.territories.find((item) => normName(item.name) === normName(card.label)) : undefined;
      if (!card || !own) continue;
      const found = territoryItems(result, own.territoryKey);
      if (found?.items.length) add(card.id, card.label, found.items);
    }
    return crossLinks([...cards.values()]);
  }, [nodes, view, network.inquiries]);
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
  const live = canAsk;
  // A connection belongs to its direction; asking with a direction selected branches from that direction.
  const directionNode = selected.kind === "connection" ? byId.get(selected.parentId ?? "") ?? selected : selected;
  const branchOfSelected = branchDirection(nodes, selected.id);
  // A run the server let go cannot carry a follow-up; its question then starts fresh on the same direction.
  const selectedLost = selected.jobId ? Boolean(inquiryOf(selected)?.lost) : false;
  const askFrom = selected.runId && !selectedLost ? selected : directionNode.kind === "direction" ? directionNode : branchOfSelected;
  const branchInquiries = (nodeId: string) => nodes.filter((node) => node.parentId === nodeId && node.kind === "inquiry").map(inquiryOf).filter((item): item is Inquiry => item !== null);
  /** Any started or reused inquiry becomes the selection, so its answer is in view. */
  const open = (started: Promise<string | null>) => started.then((jobId) => { if (jobId) setSelectedId(inquiryNodeId(jobId)); return jobId; });
  /** A fresh, full investigation of one territory. From a found territory it stays on that branch. */
  const investigateTerritory = (name: string, placeUnder?: string) => void open(network.ask(`How far can ${view.brand.name} extend into ${name}?`, null, placeUnder));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = question.trim();
    if (!text) return;
    void open(network.ask(text, askFrom)).then((started) => { if (started) setQuestion(""); });
  };

  let dossier;
  if (directionNode.kind === "direction" && directionNode.directionKey) {
    const direction = view.directions.find((item) => item.key === directionNode.directionKey)!;
    dossier = <DirectionDossier view={view} direction={direction} inquiries={branchInquiries(directionNode.id)} canInvestigate={canInvestigate && Boolean(scanToken)} busy={network.starting} onInvestigate={() => void network.investigateDirection(direction.id, direction.name, directionNode.id)} onSelect={setSelectedId} />;
  } else if (directionNode.kind === "direction") {
    dossier = <NewDirectionDossier node={directionNode} inquiries={branchInquiries(directionNode.id)} brand={view.brand.name} canAsk={live} busy={network.starting} onInvestigate={() => investigateTerritory(directionNode.label)} onSelect={setSelectedId} />;
  } else if (selected.kind === "inquiry") {
    const inquiry = inquiryOf(selected);
    const branch = (selected.parentId ? territoryAncestor(nodes, selected.parentId) : null)?.label ?? null;
    dossier = inquiry ? <InquiryDossier key={inquiry.jobId} inquiry={inquiry} node={selected} brand={view.brand.name} branch={branch} busy={network.starting || !live} onAnswer={(text) => void open(network.answer(inquiry, text))} onAsk={(text) => void open(network.ask(text, askFrom))} onMeasure={measureFor(branch ?? inquiry.response?.territories[0]?.name ?? inquiry.question)} onRetry={retryFor(inquiry)} onRephrase={live ? () => { setQuestion(inquiry.question); setSelectedId(inquiry.parentId); composerRef.current?.focus(); } : undefined} /> : null;
  } else if (selected.kind === "finding") {
    const parentInquiry = inquiryOf(selected);
    dossier = <FindingDossier node={selected} inquiry={parentInquiry} brand={view.brand.name} busy={network.starting || !live || Boolean(parentInquiry && isPending(parentInquiry))} onInvestigate={() => investigateTerritory(selected.label, selected.id)} onMeasure={measureFor(selected.label)} />;
  } else {
    dossier = <BrandDossier view={view} onSelect={setSelectedId} />;
  }

  // A question, or a direction your questions opened, can be removed with everything that grew from it.
  // Cards on other branches that carry the same Qloo identifiers as this one.
  const related = links.filter((link) => link.a === selected.id || link.b === selected.id);
  if (related.length) {
    dossier = <>{dossier}<SharedAcross links={related} selectedId={selected.id} byId={byId} onSelect={setSelectedId} /></>;
  }

  const removable = selected.kind === "inquiry" || (selected.kind === "direction" && !selected.directionKey);
  if (removable) {
    const branch = branchOf(nodes, selected.id);
    const jobIds = [...new Set(branch.map((id) => byId.get(id)?.jobId).filter((id): id is string => Boolean(id)))];
    const cards = branch.filter((id) => byId.get(id)?.kind !== "connection").length;
    const running = jobIds.some((jobId) => { const item = network.inquiries.find((inquiry) => inquiry.jobId === jobId); return Boolean(item && isPending(item)); });
    dossier = <>{dossier}<DeleteBranch key={selected.id} count={cards} running={running} onDelete={() => { setSelectedId(selected.parentId ?? BRAND_NODE); network.forgetMany(jobIds); }} /></>;
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
        <NetworkBoard nodes={nodes} positions={positions} links={links} selectedId={selected.id} onSelect={setSelectedId}
          onMove={(id, dx, dy, origin) => layout.move(branchOf(nodes, id), origin, dx, dy)} onTidy={layout.reset} moved={layout.moved} label={`Research network for ${view.brand.name}`} inset={BOARD_INSET} />
        <ul className="rn-legend" aria-label="Legend">
          <li data-tone="brand">Brand</li><li data-tone="hypothesis">Direction</li><li data-tone="running">Agent investigating</li><li data-tone="supported">Worth pursuing</li><li data-tone="partial">Inconclusive or partial</li><li data-tone="unsupported">Not supported or not run</li><li data-tone="cross">Shares Qloo signals across branches</li>
        </ul>
        <p className="rn-note">Drag to move, scroll to zoom. Lines show what was investigated from what; distance on the board is not cultural distance.</p>
        <aside className="rn-dossier" aria-live="polite" data-testid="network-dossier">{dossier}</aside>
        <form className="rn-composer" onSubmit={submit} data-testid="network-composer">
          <label htmlFor="rn-question">
            {askFrom?.kind === "direction" ? <>Ask about <strong>{clip(askFrom.label, 48)}</strong> for {view.brand.name}</> : askFrom ? <>Continue from <strong>{clip(askFrom.label, 48)}</strong></> : <>Ask a research question about <strong>{view.brand.name}</strong></>}
          </label>
          <div className="rn-composer__row">
            <input id="rn-question" ref={composerRef} value={question} maxLength={2000} placeholder={askFrom?.kind === "direction" ? `How far can ${view.brand.name} extend into ${askFrom.label}? Which audiences overlap?` : askFrom ? "Ask a follow-up, narrow it down, or switch territory" : `Where could ${view.brand.name} go next? How far can ${view.brand.name} extend into tennis?`} onChange={(event) => setQuestion(event.target.value)} disabled={!live} />
            <button type="submit" className="primary" disabled={!live || network.starting || !question.trim()}>{network.starting ? "Starting…" : "Ask the agent"}</button>
          </div>
          <p className="quiet">{live ? "The agent plans its own Qloo lookups within a fixed budget. Every number it reports comes from Qloo." : "Live research is off, so new questions can’t start. You can still explore this network."}</p>
          {network.notice ? <p className="notice" role="alert">{network.notice}</p> : null}
        </form>
      </div>
    </section>
  );
}
