"use client";

import { useEffect, useState } from "react";
import type { QueryResponse } from "@cultural-elasticity/shared";
import { parseJobEnvelope, type JobEnvelope } from "@/lib/job-envelope";
import { buildResearchFinding } from "@/lib/research-findings";
import { hypothesisOutcomeCopy } from "@/lib/research-copy";

type Prepared = {
  version: "ce-deep-investigation/0.1" | "ce-deep-investigation/0.2";
  objective: string;
  brand: { name: string; qlooId: string };
  territory: { id: string; name: string };
  limitations: string[];
  evidence: { correlationId: string; operation: string }[];
};

function isPrepared(value: unknown): value is Prepared {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Prepared>;
  return (item.version === "ce-deep-investigation/0.1" || item.version === "ce-deep-investigation/0.2") && typeof item.objective === "string" && typeof item.brand?.qlooId === "string" && typeof item.territory?.id === "string" && Array.isArray(item.limitations) && Array.isArray(item.evidence);
}

const stopped = new Set(["completed", "failed", "cancelled", "expired"]);

/** Shows only the job's actual stage and validated result, never a reasoning stream. */
export function DeepResearchPanel({ scanId, territoryId, proposedDirection, token, onClose, onFinding }: { scanId: string; territoryId?: string; proposedDirection?: string; token: string; onClose: () => void; onFinding: (response: QueryResponse) => void }) {
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [job, setJob] = useState<JobEnvelope | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => crypto.randomUUID());

  useEffect(() => {
    let active = true;
    setPrepared(null); setJob(null); setError("");
    void fetch("/api/research/handoff/preview", { method: "POST", headers: { "content-type": "application/json", "x-baseline-token": token }, body: JSON.stringify({ scanId, territoryId, proposedDirection, idempotencyKey: key }) })
      .then(async (response) => {
        const value: unknown = await response.json();
        if (!active) return;
        if (response.ok && isPrepared(value)) setPrepared(value);
        else setError("This direction cannot be prepared from the stored research. Reopen the scan and try again.");
      }).catch(() => { if (active) setError("The research service is unavailable."); });
    return () => { active = false; };
  }, [scanId, territoryId, proposedDirection, token, key]);

  useEffect(() => {
    if (!job?.accessToken || stopped.has(job.status)) return;
    let active = true;
    const timer = setTimeout(() => {
      void fetch(`/api/agent/jobs/${encodeURIComponent(job.jobId)}`, { headers: { "x-job-token": job.accessToken! }, cache: "no-store" })
        .then(async (response) => {
          const parsed = parseJobEnvelope(await response.json());
          if (!active) return;
          if (response.ok && parsed.ok) {
            setJob({ ...parsed.job, accessToken: job.accessToken });
            if (parsed.job.status === "completed" && parsed.job.response?.investigation?.result?.status === "COMPLETE") onFinding(parsed.job.response);
          }
          else setError("This investigation is no longer available. It may have expired or the service may have restarted.");
        }).catch(() => { if (active) setError("The research service cannot be reached right now."); });
    }, 2500);
    return () => { active = false; clearTimeout(timer); };
  }, [job, onFinding]);

  const start = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/research/handoff/jobs", { method: "POST", headers: { "content-type": "application/json", "x-baseline-token": token }, body: JSON.stringify({ scanId, territoryId, proposedDirection, idempotencyKey: key }) });
      const parsed = parseJobEnvelope(await response.json());
      if (response.ok && parsed.ok && parsed.job.accessToken) setJob(parsed.job);
      else setError(response.status === 503 ? "Live investigations are paused." : "The investigation could not be started.");
    } catch { setError("The research service cannot be reached right now."); }
    finally { setBusy(false); }
  };

  const result = job?.response?.investigation?.result;
  const findings = result && result.status !== "NEEDS_INPUT" ? result.territories.filter((item) => item.role === "target").flatMap((item) => {
    const finding = buildResearchFinding(result, item.key);
    return finding ? [finding] : [];
  }) : [];

  return <section className="rw-deep" aria-labelledby="rw-deep-title" data-testid="deep-investigation">
    <button type="button" className="ghost" onClick={onClose}>Close investigation</button>
    <p className="kicker">Deep investigation</p>
    <h2 id="rw-deep-title">{prepared?.territory.name ?? "Preparing research direction"}</h2>
    {prepared ? <>
      <p><strong>Research question.</strong> {prepared.objective}</p>
      <p className="quiet">{prepared.version === "ce-deep-investigation/0.2" ? "This is your proposed direction. It has no supporting Qloo evidence yet." : "This direction is an unvalidated baseline hypothesis."} The investigation checks it against fresh Qloo evidence.</p>
      {!job ? <button type="button" className="primary" disabled={busy} onClick={() => void start()}>{busy ? "Starting…" : "Start live investigation"}</button> : null}
      <details><summary>Starting evidence and limits</summary><ul>{prepared.limitations.map((line) => <li key={line}>{line}</li>)}</ul><p>{prepared.evidence.length} stored source references; the agent must recheck support.</p></details>
    </> : <p role="status">Checking the selected research direction…</p>}
    {job ? <p role="status">{job.status === "completed" ? "Investigation finished." : job.status === "failed" ? "Investigation failed before a conclusion was available." : job.stageLabel} {job.error?.message ?? ""}</p> : null}
    {result?.status === "NEEDS_INPUT" ? <p>This investigation needs clarification: {result.question}</p> : null}
    {result?.status === "COMPLETE" ? <>
      <h3>Findings</h3>
      {result.hypothesisAssessment ? <div className="rw-hypothesis-finding">
        <p><strong>{hypothesisOutcomeCopy[result.hypothesisAssessment.outcome]}.</strong> This is a cultural research judgment, not a commercial recommendation.</p>
        <h4>What Qloo showed</h4><ul>{result.hypothesisAssessment.observed.length ? result.hypothesisAssessment.observed.map((line) => <li key={line}>{line}</li>) : <li>No completed relationship observation was available.</li>}</ul>
        {result.hypothesisAssessment.supports.length ? <><h4>What supports this direction</h4><ul>{result.hypothesisAssessment.supports.map((line) => <li key={line}>{line}</li>)}</ul></> : null}
        <h4>What remains uncertain</h4><ul>{[...result.hypothesisAssessment.limitations, ...result.hypothesisAssessment.unknowns].map((line) => <li key={line}>{line}</li>)}</ul>
        <h4>Research next</h4><p>{result.hypothesisAssessment.nextStep}</p>
        <details><summary>Source and method</summary><p>{result.hypothesisAssessment.correlationIds.join("; ") || "No eligible source references"}</p></details>
      </div> : null}
      <p>{result.summary.claimValidation.passed ? result.summary.text : "The investigation did not produce a validated interpretation."}</p>
      {findings.map((item) => <article key={item.territory.key}>
        <h4>{item.territory.name}</h4>
        <p>{item.observation ?? "No supported observation was established for this direction."}</p>
        {item.interpretations.map((entry) => <p key={entry.text}>{entry.text}</p>)}
        <p>{item.status === "INSUFFICIENT" ? "There is not enough evidence for a reliable conclusion." : "This is a research finding, not a commercial recommendation."}</p>
        {item.limitations.length ? <ul>{item.limitations.map((line) => <li key={line}>{line}</li>)}</ul> : null}
        <details><summary>Sources and method</summary><p>{item.evidenceReferences.join("; ") || "No eligible source references"}</p></details>
      </article>)}
      <h3>Next research step</h3><ul>{result.followUpOptions.map((step) => <li key={step}>{step}</li>)}</ul>
    </> : result && result.status !== "NEEDS_INPUT" ? <p>No completed finding was established. The research may be retried only through a new authorized investigation.</p> : null}
    {error ? <p role="alert" className="notice">{error}</p> : null}
  </section>;
}
