"use client";

import type { AgentRunResponse, AnyBrandBaselineResult, DecisionCardContext, QueryResponse } from "@cultural-elasticity/shared";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { reasonCopy } from "@/components/atlas/atlas-model";
import { elasticityVerdict } from "@/lib/elasticity-verdict";
import { evidenceTerm } from "@/lib/evidence-presentation";
import type { JobActivity } from "@/lib/job-envelope";
import { hypothesisOutcomeCopy } from "@/lib/research-copy";
import { BRAND_NODE, measureQuestion, branchDirection, bridgeId, buildNetwork, layoutWithBridges, lineageOf, territoryAncestor, type Bridge, canRetry, directionNodeId, inquiryNodeId, isPending, normName, type Inquiry, type NetworkNode } from "@/lib/research-network";
import { buildResearchView, type ConnectionView, type DirectionView, type ResearchView } from "@/lib/research-view";
import { NetworkBoard, type BoardInset } from "./NetworkBoard";

/** Floating legend (top), dossier (right) and composer (bottom) cover these parts of the board. */
const BOARD_INSET: BoardInset = { top: 104, right: 430, bottom: 150, left: 70 };
import { useResearchNetwork } from "./use-research-network";
import { useResearchLayout } from "./use-research-layout";
import { TerritoryReadingView } from "./TerritoryReading";
import { AskAboutTag, TagButton, TagChip } from "./TagChip";
import { draftQuestion, type TagKind } from "@/lib/tag-question";
import { readableClassCodes, territoryReading } from "@/lib/territory-reading";
import { buildNetworkReport } from "@/lib/network-report";
import { downloadReportHtml, downloadReportPdf } from "@/lib/report-download";
import { connectionQuestions, crossLinks, territoryItems, type CrossLink, type EvidenceItem, type LinkSource } from "@/lib/research-links";

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
      </> : <p className="quiet">{pending ? "Being measured by the investigation." : investigated ? "Not measured by this investigation yet. A degree of elasticity needs a comparison with other territories from the same Qloo evidence; measure it below." : "Not measured yet. Elasticity is only measured by an investigation, from Qloo evidence compared within one set."}</p>}
      {!elasticity && !pending && onMeasure ? <button type="button" className="rw-secondary" disabled={busy} onClick={onMeasure} data-testid="network-measure">Measure it with a Qloo comparison</button> : null}
    </div>
  );
}

/** A territory's plain reading when the run has one; otherwise the elasticity state alone. */
function Reading({ result, territoryKey, brand, pending, investigated, onMeasure, busy, context }: { result: AgentRunResponse | null | undefined; territoryKey: string | null; brand: string; pending?: boolean; investigated?: boolean; onMeasure?: () => void; busy?: boolean; context?: DecisionCardContext }) {
  const reading = pending ? null : territoryReading(result, territoryKey, brand, context);
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
        <button type="button" className="rn-open-tie" onClick={() => onSelect(bridgeId(link.a, link.b))}>Explore this connection</button>
        <ul className="rr-chips">{link.shared.slice(0, 6).map((item) => <TagChip key={item.id} label={item.label} kind={item.kind === "example" ? "entity" : "concept"} dataKind={item.kind} title={KIND_WORD[item.kind]} />)}</ul>
      </li>;
    })}</ul>
  </section>;
}

/** An opened connection: what two territory cards share, and questions that branch from the connection itself. */
function ConnectionDossier({ node, link, byId, brand, inquiries, canAsk, busy, onAsk, onSelect }: { node: NetworkNode; link: CrossLink | null; byId: ReadonlyMap<string, NetworkNode>; brand: string; inquiries: Inquiry[]; canAsk: boolean; busy: boolean; onAsk: (question: string) => void; onSelect: (id: string) => void }) {
  const [aId, bId] = node.id.slice(4).split("|");
  const a = byId.get(aId ?? "");
  const b = byId.get(bId ?? "");
  const asked = new Set(inquiries.map((item) => normName(item.question)));
  const suggestions = a && b ? connectionQuestions(brand, a.label, b.label, link?.shared ?? []).filter((item) => !asked.has(normName(item.question))) : [];
  return <>
    <p className="kicker">Connection across branches</p>
    <h2>{a?.label ?? "?"} <span className="rn-x">×</span> {b?.label ?? "?"}</h2>
    <p className="quiet">These two sit on different branches, and Qloo&apos;s evidence for them carries the same signals. Shared evidence, not a similarity score.</p>
    <div className="rn-ends">
      {a ? <button type="button" className="rn-end" onClick={() => onSelect(a.id)}>{a.label}</button> : null}
      {b ? <button type="button" className="rn-end" onClick={() => onSelect(b.id)}>{b.label}</button> : null}
    </div>
    {link?.shared.length ? <div className="rr-section"><h3>What they share</h3><p className="rr-hint">The same Qloo concept, taste signal or example entity appears in both.</p>
      <ul className="rr-chips">{link.shared.map((item) => <TagChip key={item.id} label={item.label} kind={item.kind === "example" ? "entity" : "concept"} dataKind={item.kind} title={KIND_WORD[item.kind]} />)}</ul></div> : null}
    {inquiries.length ? <><h3>Explored from this connection</h3><ul className="rn-links">{inquiries.map((item) => <li key={item.jobId}><button type="button" className="rn-link" onClick={() => onSelect(inquiryNodeId(item.jobId))}>{item.question}</button></li>)}</ul></> : null}
    {suggestions.length ? <div className="rr-section" data-testid="network-connection-questions"><h3>Questions to explore it</h3>
      <ul className="rn-suggest">{suggestions.map((item) => <li key={item.question}>
        <button type="button" className="rn-suggest__q" disabled={!canAsk || busy} onClick={() => onAsk(item.question)}>{item.question}</button>
        <span className="rr-hint">{item.why}</span>
      </li>)}</ul></div> : null}
    <p className="quiet">Or ask your own below: it will branch from this connection.</p>
  </>;
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
    {view.core.categories.length ? <><h3>What the brand is, per Qloo</h3><ul className="rr-chips">{view.core.categories.map((item) => <TagChip key={item.key} label={item.name} kind="concept" />)}</ul></> : null}
    {view.tasteTags.length ? <><h3>Taste signals</h3><ul className="rr-chips">{view.tasteTags.slice(0, 10).map((item) => <TagChip key={item.key} label={item.name} kind="concept" />)}</ul></> : null}
    {view.collections.filter((collection) => collection.items.length).map((collection) => <div key={collection.domain}><h3>{collection.title}</h3><ul className="rr-chips">{collection.items.slice(0, 6).map((item) => <TagChip key={item.key} label={item.name} kind={item.kind === "tag" ? "concept" : "entity"} />)}</ul></div>)}
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
    {result.summary.claimValidation.passed ? <div className="rr-section rn-writeup"><h3>The agent&apos;s write-up</h3><p>{readableClassCodes(result.summary.text)}</p></div> : null}
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

/** How each territory of a multi-territory question placed, read from its result; each row opens that territory's card. */
function Placements({ response, brand, locate, onSelect }: { response: QueryResponse; brand: string; locate: (name: string, key: string | null, index: number) => string | null; onSelect: (id: string) => void }) {
  const result = response.investigation?.result;
  const rows = response.territories.map((territory, index) => {
    const reading = territoryReading(result, territory.territoryKey, brand);
    const position = reading?.compared.find((item) => item.current)?.position ?? null;
    return { name: territory.name, fit: reading?.fit?.label ?? null, position, of: reading?.compared.length ?? 0, id: locate(territory.name, territory.territoryKey, index) };
  }).sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  return <div className="rr-section" data-testid="network-placements">
    <h3>How each one placed</h3>
    <p className="rr-hint">From this question&apos;s own Qloo comparison{rows.some((row) => row.position) ? `, strongest link to ${brand} first. The order holds only within this set` : ""}.</p>
    <ol className="rr-rank">{rows.map((row) => <li key={row.name}>
      <span className="rr-rank__n">{row.position ?? "–"}</span>
      {row.id ? <button type="button" className="rn-link rr-rank__name" onClick={() => onSelect(row.id!)}>{row.name}</button> : <span className="rr-rank__name">{row.name}</span>}
      <span className="rr-rank__fit">{row.fit ?? "Not ranked"}</span>
    </li>)}</ol>
  </div>;
}

function InquiryDossier({ inquiry, node, brand, branch, locate, onSelect, onAnswer, onAsk, onMeasure, onRetry, onRephrase, busy, directions }: { inquiry: Inquiry; node: NetworkNode; brand: string; branch: string | null; locate: (name: string, key: string | null, index: number) => string | null; onSelect: (id: string) => void; onAnswer: (text: string) => void; onAsk: (question: string) => void; onMeasure?: () => void; onRetry?: () => void; onRephrase?: () => void; busy: boolean; directions?: readonly string[] }) {
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
    {/* Decision first: the deterministic reading, then the agent's validated write-up and the evidence. */}
    {!running && response?.investigation ? (territory || response.territories.length <= 1
      ? <Reading result={result} territoryKey={territory?.territoryKey ?? null} brand={brand} investigated onMeasure={onMeasure} busy={busy} context={{ otherDirections: directions ?? [] }} />
      : <Placements response={response} brand={brand} locate={locate} onSelect={onSelect} />) : running ? <ElasticityBlock elasticity={null} brand={brand} pending /> : null}
    {response && !running ? <InquiryResult response={response} /> : null}
    {!running && response && !response.investigation && onRephrase ? <button type="button" className="rw-secondary" disabled={busy} onClick={onRephrase}>Edit and ask again</button> : null}
    {onRetry ? <button type="button" className="primary" data-testid="network-retry" disabled={busy} onClick={onRetry}>Try again</button> : null}
    {waiting ? <form className="rn-answer" onSubmit={(event) => { event.preventDefault(); if (answer.trim()) { onAnswer(answer.trim()); setAnswer(""); } }}>
      <label htmlFor="rn-answer">Your answer</label>
      <input id="rn-answer" value={answer} maxLength={1000} onChange={(event) => setAnswer(event.target.value)} />
      <button type="submit" className="primary" disabled={busy || !answer.trim()}>Answer</button>
    </form> : null}
    {!running && inquiry.activity?.length ? <details className="rn-trace-details"><summary>How the agent worked ({inquiry.activity.length} steps)</summary><AgentActivity entries={inquiry.activity} live={false} /></details> : null}
    {followUps.length ? <><h3>Continue this path</h3><ul className="rn-links">{followUps.map((step) => <li key={step}><button type="button" className="rn-link" disabled={busy} onClick={() => onAsk(step)}>{step}</button></li>)}</ul></> : null}
  </>;
}

function FindingDossier({ node, inquiry, brand, onInvestigate, onMeasure, busy, directions }: { node: NetworkNode; inquiry: Inquiry | null; brand: string; onInvestigate: () => void; onMeasure?: () => void; busy: boolean; directions?: readonly string[] }) {
  const response = inquiry?.response ?? null;
  return <>
    <p className="kicker">Territory found by the agent</p>
    <h2>{node.label}</h2>
    <p className="rn-status" data-tone={node.tone}>{node.status}</p>
    <Reading result={response?.investigation?.result} territoryKey={node.territoryKey} brand={brand} pending={Boolean(inquiry && isPending(inquiry))} investigated onMeasure={onMeasure} busy={busy} context={{ otherDirections: directions ?? [] }} />
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

function DirectionDossier({ view, direction, inquiries, canInvestigate, busy, onInvestigate, onSelect, onMeasure }: { view: ResearchView; direction: DirectionView; inquiries: Inquiry[]; canInvestigate: boolean; busy: boolean; onInvestigate: () => void; onSelect: (id: string) => void; onMeasure?: (result: AgentRunResponse | null | undefined) => (() => void) | undefined }) {
  const investigations = inquiries.filter((item) => item.origin === "direction");
  const connections = connectionsFor(view, direction);
  const latest = [...inquiries].reverse().find((item) => item.response?.investigation?.result);
  const running = inquiries.some((item) => item.status === "queued" || item.status === "running");
  const latestResult = latest?.response?.investigation?.result;
  // Sprint 9N: a measurement Qloo's evidence could not support would likely repeat; offer the named comparison instead.
  const repeats = Boolean(latestResult && latestResult.status !== "NEEDS_INPUT" && latestResult.comparisonFeasibility?.repeat === "LIKELY_REPEATS");
  return <>
    <p className="kicker">Direction</p>
    <h2>{direction.name}</h2>
    <p className="quiet">{direction.categoryLabel}</p>
    <h3>Why it is here</h3>
    <p>{direction.why}</p>
    <h3>Its cultural fingerprint</h3>
    <p>{direction.signals.join("; ")}. {direction.strength}.</p>
    {connections.length ? <><h3>Connections behind it</h3><ul>{connections.map((item) => <li key={item.key}><TagButton label={item.name} kind={item.kind === "tag" ? "concept" : "entity"} /> <span className="quiet">{item.contextLine}</span></li>)}</ul></> : null}
    {latest ? <Reading result={latestResult} territoryKey={branchTerritory(latest.response, direction.name)?.territoryKey ?? null} brand={view.brand.name} pending={running} investigated onMeasure={repeats ? onMeasure?.(latestResult) : undefined} busy={busy} context={{ directionWhy: direction.why, otherDirections: view.directions.map((item) => item.name) }} />
      : <ElasticityBlock elasticity={null} brand={view.brand.name} pending={running} />}
    <h3>Still unknown</h3>
    <ul>{direction.unknown.map((line) => <li key={line}>{line}</li>)}</ul>
    {inquiries.length ? <><h3>Investigations and questions on this direction</h3><ul className="rn-links">{inquiries.map((item) => <li key={item.jobId}><button type="button" className="rn-link" onClick={() => onSelect(inquiryNodeId(item.jobId))}>{item.question}</button></li>)}</ul></> : null}
    <div className="rn-modes" data-testid="direction-modes">
      <h3>Two ways to go further</h3>
      <p><strong>Explore connections.</strong> The connections above are recorded Qloo evidence from the brand scan; select them on the board at no cost. A question in the box below starts a new investigation.</p>
      <p><strong>Measure cultural fit.</strong> Runs a live investigation (new Qloo and model calls) that compares {direction.name} with other territories Qloo supports, in one Qloo call. It can end &ldquo;not measured&rdquo; when Qloo has nothing comparable: an honest result, not an error.</p>
    </div>
    {canInvestigate && repeats && !running
      ? <p className="quiet" data-testid="network-repeat-note">Measured once already. Qloo&apos;s evidence could not support a comparison, so measuring the same question again would likely repeat the same work. Use the next step above instead.</p>
      : canInvestigate
        ? <button type="button" className="primary" data-testid="network-investigate" disabled={busy || running} onClick={onInvestigate}>{running ? "Measuring…" : investigations.length ? "Measure again" : "Measure cultural fit"}</button>
        : <p className="quiet">This research was reopened without its scan session, so the direction can&apos;t be measured directly. Ask about it in the question box below instead.</p>}
  </>;
}

// Ties are drawn between territory cards (directions and found territories), never between question cards. A
// question's evidence counts for the territory card it grew from, when the question was about that territory.
function tiesOf(nodes: readonly NetworkNode[], view: ResearchView, inquiries: readonly Inquiry[]): CrossLink[] {
  const cards = new Map<string, LinkSource>();
  const add = (cardId: string, name: string, items: EvidenceItem[]) => {
    const lineage = lineageOf(nodes, cardId);
    // The top-level branch: the last id before the brand (a bridge's questions have no brand above them).
    const branch = lineage.length > 1 && lineage[lineage.length - 1] === BRAND_NODE ? lineage[lineage.length - 2]! : lineage[lineage.length - 1]!;
    const card = cards.get(cardId) ?? { nodeId: cardId, branch, name, items: [] };
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
    const inquiry = inquiries.find((item) => item.jobId === node.jobId);
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
}

/** A card and every card that grew from it: dragging a card carries its branch. */
function branchOf(nodes: readonly NetworkNode[], id: string): string[] {
  const out = [id];
  for (let index = 0; index < out.length; index += 1) for (const node of nodes) if (node.parentId === out[index] && !out.includes(node.id)) out.push(node.id);
  return out;
}

export function ResearchNetwork({ result, scanToken, canAsk, canInvestigate, onHome, onBack }: { result: AnyBrandBaselineResult; scanToken: string | null; canAsk: boolean; canInvestigate: boolean; onHome: () => void; onBack: () => void }) {
  const view = useMemo(() => buildResearchView(result, {}), [result]);
  const network = useResearchNetwork({ scanId: view.scanId, brand: view.brand.name, scanToken });
  const [selectedId, setSelectedId] = useState<string>(BRAND_NODE);
  const [question, setQuestion] = useState("");
  const [openDirection, setOpenDirection] = useState<string | null>(null);
  const expanded = useMemo(() => {
    const direction = view.directions.find((item) => directionNodeId(item.key) === openDirection);
    return direction ? { nodeId: directionNodeId(direction.key), connections: connectionsFor(view, direction).map((item) => ({ key: item.key, name: item.name })) } : null;
  }, [view, openDirection]);
  // First pass: the tree without bridges, from which ties are found. Second pass adds the opened bridges.
  const baseNodes = useMemo(() => buildNetwork(view.brand.name, view.directions, network.inquiries, expanded), [view, network.inquiries, expanded]);
  const links = useMemo(() => tiesOf(baseNodes, view, network.inquiries), [baseNodes, view, network.inquiries]);
  const bridges = useMemo(() => {
    const labels = new Map(baseNodes.map((node) => [node.id, node.label]));
    const open = new Set(network.inquiries.map((item) => item.parentId).filter((id) => id.startsWith("tie:")));
    if (selectedId.startsWith("tie:")) open.add(selectedId);
    return [...open].flatMap((id): Bridge[] => {
      const [a, b] = id.slice(4).split("|");
      return a && b && labels.has(a) && labels.has(b) ? [{ id, a, b, label: `${labels.get(a)} × ${labels.get(b)}`, aLabel: labels.get(a)!, bLabel: labels.get(b)! }] : [];
    });
  }, [baseNodes, network.inquiries, selectedId]);
  const nodes = useMemo(() => bridges.length ? buildNetwork(view.brand.name, view.directions, network.inquiries, expanded, bridges) : baseNodes, [baseNodes, bridges, view, network.inquiries, expanded]);
  const layout = useResearchLayout(view.scanId);
  const positions = useMemo(() => layout.apply(layoutWithBridges(nodes, bridges)), [nodes, bridges, layout]);
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
   * A comparison within one Qloo call is what measures elasticity. One click asks the follow-up that can measure it
   * (`measureQuestion`); only when there is nothing concrete to propose does the user name the references.
   */
  const composerRef = useRef<HTMLInputElement>(null);
  const measureFor = (label: string, result?: AgentRunResponse | null) => {
    if (!live) return undefined;
    const question = measureQuestion(view.brand.name, label, result, view.directions.map((direction) => direction.name));
    if (question) return () => void open(network.ask(question, askFrom));
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
  const askFrom = selected.runId && !selectedLost ? selected : selected.kind === "bridge" ? selected : directionNode.kind === "direction" ? directionNode : branchOfSelected;
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

  // The report is built from what is on the board right now, stamped with the moment it is downloaded.
  const [reporting, setReporting] = useState<"pdf" | "html" | null>(null);
  const download = async (format: "pdf" | "html") => {
    setReporting(format);
    try {
      const report = buildNetworkReport({ view, nodes, inquiries: network.inquiries, links, now: new Date() });
      if (format === "html") downloadReportHtml(report);
      else await downloadReportPdf(report);
    } finally {
      setReporting(null);
    }
  };
  /** The board is kept as you work; this writes it once more before leaving. */
  const saveAndBack = () => {
    network.saveNow();
    onBack();
  };

  let dossier;
  if (directionNode.kind === "direction" && directionNode.directionKey) {
    const direction = view.directions.find((item) => item.key === directionNode.directionKey)!;
    dossier = <DirectionDossier view={view} direction={direction} inquiries={branchInquiries(directionNode.id)} canInvestigate={canInvestigate && Boolean(scanToken)} busy={network.starting} onInvestigate={() => void network.investigateDirection(direction.id, direction.name, directionNode.id)} onSelect={setSelectedId} onMeasure={(result) => measureFor(direction.name, result)} />;
  } else if (directionNode.kind === "direction") {
    dossier = <NewDirectionDossier node={directionNode} inquiries={branchInquiries(directionNode.id)} brand={view.brand.name} canAsk={live} busy={network.starting} onInvestigate={() => investigateTerritory(directionNode.label)} onSelect={setSelectedId} />;
  } else if (selected.kind === "bridge") {
    const [a, b] = selected.id.slice(4).split("|");
    const link = links.find((item) => item.a === a && item.b === b) ?? null;
    dossier = <ConnectionDossier node={selected} link={link} byId={byId} brand={view.brand.name} inquiries={branchInquiries(selected.id)} canAsk={live} busy={network.starting} onAsk={(text) => void open(network.ask(text, selected))} onSelect={setSelectedId} />;
  } else if (selected.kind === "inquiry") {
    const inquiry = inquiryOf(selected);
    const branch = (selected.parentId ? territoryAncestor(nodes, selected.parentId) : null)?.label ?? null;
    // A territory of this question is either its own card here, or one of the connection's ends it was asked from.
    const ends = selected.parentId?.startsWith("tie:") ? selected.parentId.slice(4).split("|") : [];
    const locate = (name: string, key: string | null, index: number) => {
      const finding = `find:${selected.jobId}:${key ?? index}`;
      if (byId.has(finding)) return finding;
      return ends.find((end) => normName(byId.get(end)?.label ?? "") === normName(name)) ?? null;
    };
    dossier = inquiry ? <InquiryDossier key={inquiry.jobId} inquiry={inquiry} node={selected} brand={view.brand.name} branch={branch} locate={locate} onSelect={setSelectedId} busy={network.starting || !live} onAnswer={(text) => void open(network.answer(inquiry, text))} onAsk={(text) => void open(network.ask(text, askFrom))} onMeasure={measureFor(branch ?? inquiry.response?.territories[0]?.name ?? inquiry.question, inquiry.response?.investigation?.result)} onRetry={retryFor(inquiry)} directions={view.directions.map((direction) => direction.name)} onRephrase={live ? () => { setQuestion(inquiry.question); setSelectedId(inquiry.parentId); composerRef.current?.focus(); } : undefined} /> : null;
  } else if (selected.kind === "finding") {
    const parentInquiry = inquiryOf(selected);
    dossier = <FindingDossier node={selected} inquiry={parentInquiry} brand={view.brand.name} busy={network.starting || !live || Boolean(parentInquiry && isPending(parentInquiry))} onInvestigate={() => investigateTerritory(selected.label, selected.id)} onMeasure={measureFor(selected.label, parentInquiry?.response?.investigation?.result)} directions={view.directions.map((direction) => direction.name)} />;
  } else {
    dossier = <BrandDossier view={view} onSelect={setSelectedId} />;
  }

  // A question, or a direction your questions opened, can be removed with everything that grew from it.
  // Cards on other branches that carry the same Qloo identifiers as this one.
  const related = links.filter((link) => link.a === selected.id || link.b === selected.id);
  if (related.length) {
    dossier = <>{dossier}<SharedAcross links={related} selectedId={selected.id} byId={byId} onSelect={setSelectedId} /></>;
  }

  const removable = selected.kind === "inquiry" || selected.kind === "bridge" || (selected.kind === "direction" && !selected.directionKey);
  if (removable) {
    const branch = branchOf(nodes, selected.id);
    const jobIds = [...new Set(branch.map((id) => byId.get(id)?.jobId).filter((id): id is string => Boolean(id)))];
    const cards = branch.filter((id) => byId.get(id)?.kind !== "connection").length;
    const running = jobIds.some((jobId) => { const item = network.inquiries.find((inquiry) => inquiry.jobId === jobId); return Boolean(item && isPending(item)); });
    dossier = <>{dossier}<DeleteBranch key={selected.id} count={cards} running={running} onDelete={() => { setSelectedId(selected.parentId ?? BRAND_NODE); network.forgetMany(jobIds); }} /></>;
  }

  const draftAbout = (topic: string, kind: TagKind) => {
    setQuestion(draftQuestion(view.brand.name, topic, kind));
    composerRef.current?.focus();
  };

  return (
    <AskAboutTag.Provider value={live ? draftAbout : null}>
    <section className="rn" aria-labelledby="rn-title" data-testid="research-network">
      <header className="rn-header">
        <div>
          <p className="kicker">Research network · {view.origin === "recorded" ? "recorded Qloo evidence" : "live Qloo evidence"}</p>
          <h1 id="rn-title" tabIndex={-1}>{view.brand.name}</h1>
        </div>
        <div className="rn-header__actions">
          <button type="button" className="rw-secondary" onClick={onHome} data-testid="network-home">Home</button>
          <button type="button" className="rw-secondary" onClick={saveAndBack} data-testid="network-save-back">Save and go back</button>
          <div className="rn-report" data-testid="network-report">
            <span className="rn-report__label">Download report</span>
            <button type="button" className="primary" onClick={() => void download("pdf")} disabled={reporting !== null}>{reporting === "pdf" ? "Preparing…" : "PDF"}</button>
            <button type="button" className="primary" onClick={() => void download("html")} disabled={reporting !== null}>{reporting === "html" ? "Preparing…" : "HTML"}</button>
          </div>
        </div>
      </header>
      <div className="rn-stage">
        <NetworkBoard nodes={nodes} positions={positions} links={links} selectedId={selected.id} onSelect={setSelectedId}
          onMove={(id, dx, dy, origin) => layout.move(branchOf(nodes, id), origin, dx, dy)} onTidy={layout.reset} moved={layout.moved} label={`Research network for ${view.brand.name}`} inset={BOARD_INSET} />
        <div className="rn-key">
        <ul className="rn-legend" aria-label="Legend">
          <li data-tone="brand">Brand</li><li data-tone="hypothesis">Direction</li><li data-tone="running">Agent investigating</li><li data-tone="supported">Worth pursuing</li><li data-tone="partial">Not measured yet or partial</li><li data-tone="unsupported">Not supported or not run</li><li data-tone="cross">Shares Qloo signals across branches</li>
        </ul>
        <p className="rn-note">Drag to move, scroll to zoom. Lines show what was investigated from what; distance on the board is not cultural distance.</p>
        </div>
        <aside className="rn-dossier" aria-live="polite" data-testid="network-dossier">{dossier}</aside>
        <form className="rn-composer" onSubmit={submit} data-testid="network-composer">
          <label htmlFor="rn-question">
            {askFrom?.kind === "bridge" ? <>Ask about the connection <strong>{clip(askFrom.label, 60)}</strong></> : askFrom?.kind === "direction" ? <>Ask about <strong>{clip(askFrom.label, 48)}</strong> for {view.brand.name}</> : askFrom ? <>Continue from <strong>{clip(askFrom.label, 48)}</strong></> : <>Ask a research question about <strong>{view.brand.name}</strong></>}
          </label>
          <div className="rn-composer__row">
            <input id="rn-question" ref={composerRef} value={question} maxLength={2000} placeholder={askFrom?.kind === "bridge" ? "What do these two share for the brand? Which audiences overlap?" : askFrom?.kind === "direction" ? `How far can ${view.brand.name} extend into ${askFrom.label}? Which audiences overlap?` : askFrom ? "Ask a follow-up, narrow it down, or switch territory" : `Where could ${view.brand.name} go next? How far can ${view.brand.name} extend into tennis?`} onChange={(event) => setQuestion(event.target.value)} disabled={!live} />
            <button type="submit" className="primary" disabled={!live || network.starting || !question.trim()}>{network.starting ? "Starting…" : "Ask the agent"}</button>
          </div>
          <p className="quiet">{live ? "The agent plans its own Qloo lookups within a fixed budget. Every number it reports comes from Qloo." : "Live research is off, so new questions can’t start. You can still explore this network."}</p>
          {network.notice ? <p className="notice" role="alert">{network.notice}</p> : null}
        </form>
      </div>
    </section>
    </AskAboutTag.Provider>
  );
}
