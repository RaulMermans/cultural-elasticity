"use client";

import { BRAND_BASELINE_SCHEMA_VERSION, isBrandBaselineResult, type AnyBrandBaselineResult, type BaselineEvidenceRef, type BaselineSignal, type BrandBaselineResult } from "@cultural-elasticity/shared";
import { useEffect, useState } from "react";

type Candidate = { qlooId: string; label: string; type?: string };
type Resolution = { resolutionId: string; accessToken: string; status: string; entity?: { qlooId: string; label: string }; candidates?: Candidate[] };
type Scan = { scanId: string; scanStatus: string };
const savedKey = "ce-baseline-current";

const STAGE_LABELS: Record<string, string> = { identity: "Brand identity", tags: "Cultural tags", artist: "Artists", place: "Places", movie: "Films", book: "Books", validation: "Evidence checks" };
const STAGE_STATUS: Record<string, string> = { PENDING: "waiting", RUNNING: "in progress", COMPLETE: "done", SKIPPED: "skipped", FAILED: "not available", UNCERTAIN: "not available" };
const DOMAIN: Record<string, { plural: string; title: string }> = {
  artist: { plural: "artists", title: "Artists" },
  place: { plural: "places", title: "Places" },
  movie: { plural: "films", title: "Films" },
  book: { plural: "books", title: "Books" },
  tags: { plural: "tags", title: "Cultural tags" },
};
const SCAN_STATUS: Record<string, string> = {
  QUEUED: "Queued for research", RUNNING: "Investigating Qloo", COMPLETE: "Research complete",
  PARTIAL: "Research complete, with gaps", INSUFFICIENT_EVIDENCE: "Not enough evidence for a profile",
  INTERRUPTED: "Research interrupted", FAILED: "Research could not finish", CANCELLED: "Research cancelled",
};
const ROLE: Record<string, string> = { AUDIENCE_TASTE: "Audience taste", BRAND_CLASSIFICATION: "How Qloo classifies the brand", DESCRIPTIVE_KEYWORD: "Descriptive keyword" };
const STRENGTH: Record<string, string> = { OBSERVED_ASSOCIATION: "One Qloo observation", PARTIAL_EVIDENCE: "Partial evidence", MULTI_SIGNAL_SUPPORT: "Several Qloo observations" };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
const domainOf = (domain: string) => DOMAIN[domain] ?? { plural: domain, title: domain };
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";

function typeQualifier(signals: BaselineSignal[], plural: string): string {
  const kinds = new Set(signals.map((signal) => signal.grounding?.typeEvidence));
  if (kinds.size === 1 && kinds.has("PROVIDER_CONFIRMED_TYPE")) return `Qloo identifies each of these as ${plural}.`;
  if (kinds.has("GENERIC_TYPE_UNRESOLVED")) return `Qloo did not confirm what kind of result these are.`;
  return `Returned when Qloo was asked for ${plural}. Qloo did not confirm each result individually.`;
}

function SourceList({ refs }: { refs: BaselineEvidenceRef[] }) {
  return <dl>{refs.flatMap((ref) => [
    <dt key={`${ref.correlationId}:${ref.sourceId}:q`}>{ref.operation === "describe" ? "Brand lookup" : ref.operation === "entity_tags" ? "Tag profile" : `Related ${domainOf(ref.scope).plural}`}</dt>,
    <dd key={`${ref.correlationId}:${ref.sourceId}:v`}>{when(ref.capturedAt)} · {ref.sourceStatus === "ok" ? "complete response" : `${ref.sourceStatus} response`}</dd>,
  ])}</dl>;
}

function Profile({ result, selected, onSelect }: { result: BrandBaselineResult; selected: string | null; onSelect: (id: string) => void }) {
  const tags = result.fingerprint.signals.filter((signal) => signal.kind === "tag");
  const grouped = new Set(result.fingerprint.themes.flatMap((theme) => [...theme.memberIds, ...theme.possibleDuplicateIds]));
  const loose = tags.filter((tag) => !grouped.has(tag.id));
  const tagName = new Map(tags.map((tag) => [tag.id, tag.name]));
  const domains = [...new Set(result.fingerprint.signals.filter((signal) => signal.kind === "entity").map((signal) => signal.domain))];
  const silent = result.fingerprint.domainCoverage.filter((item) => item.status === "EMPTY" || item.status === "UNAVAILABLE").map((item) => domainOf(item.domain).plural);
  const territory = result.territories.find((item) => item.id === selected);
  const chip = (tag: BaselineSignal) => <li key={tag.id}>{tag.name}{tag.role ? <small> · {ROLE[tag.role]}</small> : null}{tag.possibleDuplicateOf ? <small> · may repeat “{tagName.get(tag.possibleDuplicateOf)}”</small> : null}</li>;
  return (
    <>
      <section aria-labelledby="baseline-found">
        <h4 id="baseline-found">What we found</h4>
        {tags.length ? <>
          <p>Cultural tags Qloo associates with {result.brand.name}, in Qloo&apos;s returned order:</p>
          {result.fingerprint.themes.map((theme) => <div key={theme.id}><h5>{theme.label}</h5><ul className="brand-baseline__chips">{tags.filter((tag) => theme.memberIds.includes(tag.id) || theme.possibleDuplicateIds.includes(tag.id)).map(chip)}</ul></div>)}
          {loose.length ? <ul className="brand-baseline__chips">{loose.map(chip)}</ul> : null}
        </> : <p>Qloo returned no cultural tag for this brand.</p>}
        {domains.map((domain) => {
          const items = result.fingerprint.signals.filter((signal) => signal.domain === domain && signal.kind === "entity");
          const words = domainOf(domain);
          return <div key={domain}><h5>{words.title} connected with {result.brand.name}&apos;s audience</h5><p className="quiet">{typeQualifier(items, words.plural)}</p><ol className="brand-baseline__list">{items.map((item) => <li key={item.id}>{item.name}</li>)}</ol></div>;
        })}
        {silent.length ? <p className="quiet">No usable evidence came back for: {silent.join(", ")}.</p> : null}
      </section>

      <section aria-labelledby="baseline-territories">
        <h4 id="baseline-territories">Territories worth investigating</h4>
        {result.territories.length ? <>
          <p className="quiet">Directions for further research, not validated findings or recommendations.</p>
          {result.territories.map((item) => <button className="brand-baseline__territory" type="button" key={item.id} onClick={() => onSelect(item.id)} aria-pressed={selected === item.id}><strong>{item.name}</strong><span>{STRENGTH[item.evidenceStatus]}</span></button>)}
          {territory ? <div className="brand-baseline__evidence" aria-live="polite">
            <h5>{territory.name}</h5>
            <p><strong>Why it appeared.</strong> {territory.explanation}</p>
            <p><strong>How certain.</strong> {territory.limitations.join(" ")}</p>
            <p><strong>Next.</strong> {territory.nextInvestigation}</p>
            <SourceList refs={territory.supportingReferences} />
          </div> : null}
        </> : <>
          <p>No territory hypothesis is supported yet.</p>
          <ul>{result.discovery.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </>}
      </section>

      <section aria-labelledby="baseline-uncertain">
        <h4 id="baseline-uncertain">What remains uncertain</h4>
        <ul>{result.fingerprint.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
      </section>

      {result.discovery.nextSteps.length ? <section aria-labelledby="baseline-next">
        <h4 id="baseline-next">What to explore next</h4>
        <ul>{result.discovery.nextSteps.map((step) => <li key={step}>{step}</li>)}</ul>
      </section> : null}

      <details className="brand-baseline__method">
        <summary>Methodology details</summary>
        <p>{result.execution.derivedFrom ? `Offline projection of stored scan ${result.execution.derivedFrom.scanId}. ` : ""}Method {result.execution.templateVersion}, discovery rule {result.discovery.rule}, grouping rule {result.discovery.themeRule}. {result.execution.providerCallCount} Qloo calls in this scan.</p>
        <p>{result.audit.returnedTags} tags returned · {result.audit.operationalTags} set aside as venue metadata · {result.audit.culturalTags} kept · {result.audit.returnedEntities} related entities returned · {result.audit.typeEvidence.PROVIDER_CONFIRMED_TYPE} with a Qloo-confirmed type · {result.audit.typeEvidence.QUERY_SCOPED} scoped by query only.</p>
        {result.fingerprint.excluded.length ? <><h5>Set aside</h5><ul>{result.fingerprint.excluded.map((item) => <li key={`${item.source.correlationId}:${item.id}`}>{item.name}: {item.reason}</li>)}</ul></> : null}
        <h5>Qloo calls</h5>
        <ul>{[...new Map(result.fingerprint.provenance.map((ref) => [ref.correlationId, ref])).values()].map((ref) => <li key={ref.correlationId}><code>{ref.operation}</code> · {domainOf(ref.scope).plural} · <code>{ref.correlationId}</code> · {when(ref.capturedAt)}</li>)}</ul>
      </details>
    </>
  );
}

function LegacyProfile({ result, selected, onSelect }: { result: Exclude<AnyBrandBaselineResult, BrandBaselineResult>; selected: string | null; onSelect: (id: string) => void }) {
  const territory = result.territories.find((item) => item.id === selected);
  return (
    <>
      <p className="quiet">Recorded with an earlier method. It is shown exactly as it was stored.</p>
      <h4>Cultural signals</h4>
      {result.fingerprint.signals.length ? <ul className="brand-baseline__chips">{result.fingerprint.signals.map((signal) => <li key={`${signal.source.correlationId}:${signal.id}`}>{signal.name} <small>· {domainOf(signal.domain).title}</small></li>)}</ul> : <p>No cultural signal was kept from this scan.</p>}
      <h4>Territories worth investigating</h4>
      {result.territories.length ? result.territories.map((item) => <button className="brand-baseline__territory" type="button" key={item.id} onClick={() => onSelect(item.id)} aria-pressed={selected === item.id}><strong>{item.name}</strong><span>{STRENGTH[item.evidenceStatus]}</span></button>) : <p>No territory hypothesis emerged from this scan.</p>}
      {territory ? <div className="brand-baseline__evidence"><h5>{territory.name}</h5><p>{territory.limitations.join(" ")}</p><SourceList refs={territory.supportingReferences} /></div> : null}
      <h4>What remains uncertain</h4>
      <ul>{result.fingerprint.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
      <details className="brand-baseline__method">
        <summary>Methodology details</summary>
        <ul>{[...new Map(result.fingerprint.provenance.map((ref) => [ref.correlationId, ref])).values()].map((ref) => <li key={ref.correlationId}><code>{ref.operation}</code> · <code>{ref.correlationId}</code> · {when(ref.capturedAt)}</li>)}</ul>
      </details>
    </>
  );
}

export function BrandBaselinePanel() {
  const [enabled, setEnabled] = useState(false);
  const [name, setName] = useState("");
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [token, setToken] = useState("");
  const [result, setResult] = useState<AnyBrandBaselineResult | null>(null);
  const [stages, setStages] = useState<{ stage: string; status: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/brands/status", { cache: "no-store" }).then(async (response) => {
      const body = record(await response.json().catch(() => null));
      setEnabled(response.ok && body?.enabled === true);
    }).catch(() => setEnabled(false));
    try {
      const saved = record(JSON.parse(sessionStorage.getItem(savedKey) ?? "null"));
      if (typeof saved?.scanId === "string" && typeof saved?.token === "string") {
        setScan({ scanId: saved.scanId, scanStatus: "QUEUED" });
        setToken(saved.token);
      }
    } catch { /* A malformed local pointer is ignored; the database remains authoritative. */ }
  }, []);

  useEffect(() => {
    if (!scan || !token) return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(`/api/brands/baselines/${scan.scanId}`, { headers: { "x-baseline-token": token }, cache: "no-store" });
        const body = record(await response.json());
        if (!active) return;
        if (!response.ok || !body) { setError("This scan could not be retrieved right now. Please try again later."); return; }
        if (typeof body.scanStatus === "string") setScan({ scanId: scan.scanId, scanStatus: body.scanStatus });
        if (Array.isArray(body.stages)) setStages(body.stages.filter((stage): stage is { stage: string; status: string } => typeof stage?.stage === "string" && typeof stage?.status === "string"));
        if (isBrandBaselineResult(body.result)) setResult(body.result);
      } catch { if (active) setError("The research service is temporarily unavailable. Your scan remains stored."); }
    };
    void poll();
    const timer = setInterval(() => { void poll(); }, 2500);
    return () => { active = false; clearInterval(timer); };
  }, [scan?.scanId, token]);

  async function resolve(selectedQlooId?: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/brands/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, ...(selectedQlooId ? { selectedQlooId } : {}) }) });
      const body = record(await response.json());
      if (!response.ok || !body || typeof body.status !== "string" || typeof body.resolutionId !== "string" || typeof body.accessToken !== "string") throw new Error("Brand lookup is temporarily unavailable.");
      setResolution(body as Resolution);
      if (body.status === "NOT_FOUND") setError("Qloo did not recognise this as a brand. Try a more specific name.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Brand lookup failed."); }
    finally { setBusy(false); }
  }

  async function start() {
    if (!resolution || resolution.status !== "RESOLVED") return;
    setBusy(true); setError("");
    try {
      const idempotencyKey = crypto.randomUUID();
      const response = await fetch("/api/brands/baselines", { method: "POST", headers: { "content-type": "application/json", "x-baseline-token": resolution.accessToken }, body: JSON.stringify({ resolutionId: resolution.resolutionId, idempotencyKey }) });
      const body = record(await response.json());
      if (!response.ok || !body || typeof body.scanId !== "string" || typeof body.scanStatus !== "string") throw new Error("The research could not start.");
      setToken(resolution.accessToken);
      setScan({ scanId: body.scanId, scanStatus: body.scanStatus });
      sessionStorage.setItem(savedKey, JSON.stringify({ scanId: body.scanId, token: resolution.accessToken }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The research could not start."); }
    finally { setBusy(false); }
  }

  if (!enabled && !scan) return null;
  return (
    <section className="brand-baseline" aria-label="Brand cultural baseline">
      <p className="kicker">Brand research · Qloo baseline</p>
      <h2>Explore a brand&apos;s observed cultural associations</h2>
      <p className="quiet">A short, fixed Qloo investigation. Associations are evidence to inspect, not commercial recommendations.</p>
      {!scan ? (
        <>
          <form onSubmit={(event) => { event.preventDefault(); void resolve(); }}>
            <label htmlFor="baseline-brand">Brand name</label>
            <div className="brand-baseline__form">
              <input id="baseline-brand" value={name} onChange={(event) => { setName(event.target.value); setResolution(null); }} minLength={2} maxLength={200} required placeholder="Enter a brand" />
              <button className="primary" type="submit" disabled={busy}>{busy ? "Searching Qloo…" : "Find brand"}</button>
            </div>
          </form>
          {resolution?.status === "AMBIGUOUS" ? (
            <div role="group" aria-label="Confirm brand identity">
              <p>Qloo found more than one brand. Choose the intended identity:</p>
              {(resolution.candidates ?? []).map((candidate) => <button className="ghost" type="button" key={candidate.qlooId} disabled={busy} onClick={() => void resolve(candidate.qlooId)}>{candidate.label}</button>)}
            </div>
          ) : null}
          {resolution?.status === "RESOLVED" ? <div role="status"><p>Confirmed: {resolution.entity?.label}</p><button className="primary" type="button" onClick={() => void start()} disabled={busy}>{busy ? "Starting…" : "Start cultural baseline"}</button></div> : null}
        </>
      ) : (
        <>
          <p role="status">{SCAN_STATUS[scan.scanStatus] ?? "Research in progress"}</p>
          {stages.length && !result ? <ol className="brand-baseline__stages">{stages.map((stage) => <li key={stage.stage}>{STAGE_LABELS[stage.stage] ?? "Research step"}: {STAGE_STATUS[stage.status] ?? "in progress"}</li>)}</ol> : null}
          {result ? (
            <div className="brand-baseline__result">
              <h3>{result.brand.name} · Cultural Fingerprint</h3>
              <p className="quiet">{result.execution.recordedOrLive === "recorded" ? "From stored Qloo research" : "From a new Qloo scan"}</p>
              {result.schemaVersion === BRAND_BASELINE_SCHEMA_VERSION
                ? <Profile result={result} selected={selected} onSelect={setSelected} />
                : <LegacyProfile result={result} selected={selected} onSelect={setSelected} />}
            </div>
          ) : null}
        </>
      )}
      {error ? <p className="notice" role="alert">{error}</p> : null}
    </section>
  );
}
