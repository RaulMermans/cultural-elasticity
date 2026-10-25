"use client";

import { isBrandBaselineResult, type BrandBaselineResult } from "@cultural-elasticity/shared";
import { useEffect, useState } from "react";

type Candidate = { qlooId: string; label: string; type?: string };
type Resolution = { resolutionId: string; accessToken: string; status: string; entity?: { qlooId: string; label: string }; candidates?: Candidate[] };
type Scan = { scanId: string; scanStatus: string };
const savedKey = "ce-baseline-current";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function BrandBaselinePanel() {
  const [enabled, setEnabled] = useState(false);
  const [name, setName] = useState("");
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [token, setToken] = useState("");
  const [result, setResult] = useState<BrandBaselineResult | null>(null);
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
        if (!response.ok || !body) { setError("This scan could not be retrieved. Check the research service."); return; }
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
      if (!response.ok || !body || typeof body.status !== "string" || typeof body.resolutionId !== "string" || typeof body.accessToken !== "string") throw new Error("Brand resolution is temporarily unavailable.");
      setResolution(body as Resolution);
      if (body.status === "NOT_FOUND") setError("Qloo did not resolve this as a brand. Try a more specific name.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Brand resolution failed."); }
    finally { setBusy(false); }
  }

  async function start() {
    if (!resolution || resolution.status !== "RESOLVED") return;
    setBusy(true); setError("");
    try {
      const idempotencyKey = crypto.randomUUID();
      const response = await fetch("/api/brands/baselines", { method: "POST", headers: { "content-type": "application/json", "x-baseline-token": resolution.accessToken }, body: JSON.stringify({ resolutionId: resolution.resolutionId, idempotencyKey }) });
      const body = record(await response.json());
      if (!response.ok || !body || typeof body.scanId !== "string" || typeof body.scanStatus !== "string") throw new Error("The baseline could not start.");
      setToken(resolution.accessToken);
      setScan({ scanId: body.scanId, scanStatus: body.scanStatus });
      sessionStorage.setItem(savedKey, JSON.stringify({ scanId: body.scanId, token: resolution.accessToken }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The baseline could not start."); }
    finally { setBusy(false); }
  }

  if (!enabled && !scan) return null;
  const territory = result?.territories.find((item) => item.id === selected);
  return (
    <section className="brand-baseline" aria-label="Brand cultural baseline">
      <p className="kicker">Brand research · Qloo baseline</p>
      <h2>Explore a brand&apos;s observed cultural associations</h2>
      <p className="quiet">A bounded Qloo investigation. Associations are evidence to inspect, not commercial recommendations.</p>
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
          <p role="status">{scan.scanStatus === "QUEUED" ? "Queued for research" : scan.scanStatus === "RUNNING" ? "Investigating Qloo" : scan.scanStatus.replaceAll("_", " ").toLowerCase()}</p>
          {stages.length ? <ol className="brand-baseline__stages">{stages.map((stage) => <li key={stage.stage}>{stage.stage}: {stage.status.toLowerCase()}</li>)}</ol> : null}
          {result ? (
            <div className="brand-baseline__result">
              <h3>{result.brand.name} · Cultural Fingerprint</h3>
              <p>{result.execution.recordedOrLive === "recorded" ? "Recorded Qloo evidence" : "New Qloo research"} · {result.execution.providerCallCount} calls in this scan</p>
              <ul>{result.fingerprint.domainCoverage.map((domain) => <li key={domain.domain}>{domain.domain}: {domain.status.toLowerCase()} ({domain.entityCount} returned)</li>)}</ul>
              <h4>Validated cultural signals</h4>
              {result.fingerprint.signals.length ? <ul>{result.fingerprint.signals.map((signal) => <li key={`${signal.source.correlationId}:${signal.id}`}><details><summary>{signal.name} · {signal.domain}</summary><dl><dt>Qloo call</dt><dd>{signal.source.operation} · {signal.source.correlationId}</dd><dt>Observed ID</dt><dd>{signal.id}</dd><dt>Captured</dt><dd>{signal.source.capturedAt}</dd><dt>Status</dt><dd>{signal.source.sourceStatus}</dd></dl></details></li>)}</ul> : <p>No validated cultural signal emerged from this bounded scan.</p>}
              {result.fingerprint.limitations.map((limitation) => <p className="quiet" key={limitation}>{limitation}</p>)}
              <h3>Territories to inspect</h3>
              {result.territories.length ? result.territories.map((item) => <button className="brand-baseline__territory" type="button" key={item.id} onClick={() => setSelected(item.id)} aria-pressed={selected === item.id}><strong>{item.name}</strong><span>{item.evidenceStatus === "OBSERVED_ASSOCIATION" ? "Observed association" : "Partial evidence"}</span></button>) : <p>No grounded territory emerged from this bounded scan.</p>}
              {territory ? <div className="brand-baseline__evidence"><h4>{territory.name} · evidence</h4><p>{territory.limitations.join(" ")}</p>{territory.supportingReferences.map((ref) => <dl key={`${ref.correlationId}:${ref.sourceId}`}><dt>Qloo source</dt><dd>{ref.operation} · {ref.correlationId}</dd><dt>Observed reference</dt><dd>{ref.sourceId}</dd><dt>Captured</dt><dd>{ref.capturedAt}</dd><dt>Status</dt><dd>{ref.sourceStatus}</dd></dl>)}</div> : null}
            </div>
          ) : null}
        </>
      )}
      {error ? <p className="notice" role="alert">{error}</p> : null}
    </section>
  );
}
