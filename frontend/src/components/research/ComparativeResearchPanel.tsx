"use client";

import { useEffect, useId, useState } from "react";
import type { ComparativeStrategicReport, CulturalConnectionMap, CulturalRelationshipKind } from "@cultural-elasticity/shared";
import { parseJobEnvelope, type JobEnvelope } from "@/lib/job-envelope";
import { outcomeCopy, parseOptions, parsePreview, parseReportEnvelope, percent, referenceSourceCopy, relationshipKindCopy, typeEvidenceCopy, type ComparativeOptions, type ComparativePreview } from "@/lib/comparative";

const stopped = new Set(["completed", "failed", "cancelled", "expired"]);
const KINDS: CulturalRelationshipKind[] = ["DIRECT_QLOO_OBSERVATION", "DERIVED_PROFILE_OVERLAP", "AGENT_INTERPRETATION"];
const PER_DOMAIN = 8;

export type ComparativeFinding = { report: ComparativeStrategicReport; connections: CulturalConnectionMap | null };

/**
 * Sprint 9I: compare a completed single-direction investigation with server-offered references.
 * The browser sends identifiers only. Eligibility, authorization limits, the run and the report all come from the server.
 */
export function ComparativeResearchPanel({ scanId, scanToken, parentJob, onReport }: {
  scanId: string;
  scanToken: string;
  parentJob: { jobId: string; accessToken: string };
  onReport: (finding: ComparativeFinding) => void;
}) {
  const [options, setOptions] = useState<ComparativeOptions | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<ComparativePreview | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [job, setJob] = useState<JobEnvelope | null>(null);
  const [finding, setFinding] = useState<ComparativeFinding | null>(null);
  const [reportStatus, setReportStatus] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [startUnknown, setStartUnknown] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const authId = useId();
  const headers = { "content-type": "application/json", "x-baseline-token": scanToken, "x-job-token": parentJob.accessToken };
  const base = { scanId, parentJobId: parentJob.jobId };

  useEffect(() => {
    let active = true;
    void fetch("/api/research/compare/options", { method: "POST", headers, body: JSON.stringify(base) })
      .then(async (response) => {
        const value = parseOptions(await response.json());
        if (!active) return;
        if (response.ok && value) setOptions(value);
        else setError("Comparison options are not available for this investigation. It may have expired, or the service may have restarted.");
      })
      .catch(() => { if (active) setError("The research service is unavailable."); });
    return () => { active = false; };
    // The tokens and ids identify one investigation; they do not change while this panel is open.
  }, [scanId, parentJob.jobId]);

  useEffect(() => {
    if (!job?.accessToken || stopped.has(job.status)) return;
    let active = true;
    const timer = setTimeout(() => {
      void fetch(`/api/agent/jobs/${encodeURIComponent(job.jobId)}`, { headers: { "x-job-token": job.accessToken! }, cache: "no-store" })
        .then(async (response) => {
          const parsed = parseJobEnvelope(await response.json());
          if (!active) return;
          if (response.ok && parsed.ok) setJob({ ...parsed.job, accessToken: job.accessToken });
          else setError("This comparison cannot be reopened. It may have expired or the service may have restarted. An uncertain paid request will not be retried automatically.");
        })
        .catch(() => { if (active) setError("The research service cannot be reached. The comparison may still be running; no new paid request has been started."); });
    }, 2500);
    return () => { active = false; clearTimeout(timer); };
  }, [job]);

  useEffect(() => {
    if (!job?.accessToken || !stopped.has(job.status)) return;
    let active = true;
    void fetch(`/api/research/compare/report/${encodeURIComponent(job.jobId)}`, { headers: { "x-job-token": job.accessToken }, cache: "no-store" })
      .then(async (response) => {
        const envelope = parseReportEnvelope(await response.json());
        if (!active) return;
        if (!response.ok || !envelope) { setError("The validated comparison report is not available."); return; }
        setReportStatus(envelope.status);
        if (envelope.report) {
          const next = { report: envelope.report, connections: envelope.connections };
          setFinding(next);
          onReport(next);
        }
      })
      .catch(() => { if (active) setError("The research service cannot be reached."); });
    return () => { active = false; };
  }, [job?.status, job?.jobId, job?.accessToken, onReport]);

  const toggle = (id: string) => {
    setPreview(null);
    setAuthorized(false);
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const check = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/research/compare/preview", { method: "POST", headers, body: JSON.stringify({ ...base, referenceIds: selected }) });
      const value = parsePreview(await response.json());
      if (response.ok && value) setPreview(value);
      else setError("The selected references could not be checked. Reload the comparison options and try again.");
    } catch { setError("The research service is unavailable."); }
    finally { setBusy(false); }
  };

  const start = async () => {
    if (busy || job || startUnknown || !preview?.eligibility.eligible || !authorized) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/research/compare/jobs", { method: "POST", headers, body: JSON.stringify({ ...base, referenceIds: selected, idempotencyKey: key }) });
      const parsed = parseJobEnvelope(await response.json());
      if (response.ok && parsed.ok && parsed.job.accessToken) setJob(parsed.job);
      else if (response.status === 503) setError("Live comparisons are paused. No paid call was started.");
      else if (response.status === 429) setError("The investigation budget or rate limit does not allow another comparison now. No paid call was started.");
      else if (response.status === 422) setError("The server no longer considers this comparison eligible. Check it again.");
      else { setStartUnknown(true); setError("The start request could not be confirmed. It may have reached the provider, so this page will not send it again."); }
    } catch { setStartUnknown(true); setError("The start request could not be confirmed. It may have reached the provider, so this page will not send it again."); }
    finally { setBusy(false); }
  };

  const maxReferences = (options?.limits.maxPanelOptions ?? 6) - 1;
  const selectable = options?.references.filter((reference) => !reference.blocked) ?? [];

  return (
    <section className="rw-compare" aria-labelledby="rw-compare-title" data-testid="comparative-research">
      <h3 id="rw-compare-title">Compare with other territories</h3>
      <p className="quiet">A relative position needs at least three territories represented by the same entity type in one Qloo rank call. Only references backed by evidence the server holds can be selected.</p>
      {!options && !error ? <p role="status">Loading comparison options…</p> : null}
      {options ? <>
        <p><strong>Proposed territory.</strong> {options.target.label}{options.target.entityType ? `, represented by ${options.target.entityType} exemplars: ${options.target.exemplars.map((item) => item.label).join(", ")}` : ""}.</p>
        {!options.target.canAnchor ? <p className="notice" role="note">This investigation cannot anchor a comparison: {options.target.problem}</p> : <>
          <fieldset className="rw-compare__refs" disabled={Boolean(job)}>
            <legend>Reference territories (choose 2 to {maxReferences})</legend>
            {options.references.length === 0 ? <p>No reference is available yet. Investigate another direction of this brand first; each completed investigation becomes a reference.</p> : null}
            <ul className="rw-plain">
              {options.references.map((reference) => {
                const hint = `${reference.id}-hint`;
                const disabled = Boolean(reference.blocked) || (!selected.includes(reference.id) && selected.length >= maxReferences);
                return (
                  <li key={reference.id} data-testid="comparison-reference">
                    <label>
                      <input type="checkbox" checked={selected.includes(reference.id)} disabled={disabled} aria-describedby={hint} onChange={() => toggle(reference.id)} />
                      {" "}<strong>{reference.label}</strong> <span className="quiet">· {referenceSourceCopy[reference.source]}</span>
                    </label>
                    <p id={hint} className="quiet">{typeEvidenceCopy(reference)}{reference.blocked ? ` Not selectable: ${reference.blocked.reason} ${reference.blocked.action}` : ""}</p>
                  </li>
                );
              })}
            </ul>
          </fieldset>
          {!job ? <button type="button" className="rw-secondary" disabled={busy || selectable.length === 0 || selected.length === 0} onClick={() => void check()}>Check comparison</button> : null}
          {preview ? <div className="rw-compare__verdict" role="status" data-testid="comparison-eligibility" data-eligible={preview.eligibility.eligible ? "true" : "false"}>
            <p><strong>{preview.eligibility.eligible ? "Eligible." : "Not eligible."}</strong> {preview.eligibility.reason}</p>
          </div> : null}
          {preview?.eligibility.eligible && !job ? (
            options.admission.accepting && preview.admission.accepting ? (
              <div className="rw-compare__auth" data-testid="comparison-authorization">
                <h4>Research authorization</h4>
                <p>Starting runs a new live investigation of [{preview.territories?.join(", ")}] for {options.brand.name}:</p>
                <ul>
                  <li>up to {preview.limits.maxQlooCalls} Qloo calls and {preview.limits.maxAgentTurns} model turns ({preview.limits.model});</li>
                  <li>at most {preview.limits.maxRunMinutes} minutes, with a ${preview.limits.reservedUsd.toFixed(2)} spend reservation;</li>
                  <li>{preview.limits.unknownOutcomes}</li>
                </ul>
                <label htmlFor={authId}><input id={authId} type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} /> I authorize these paid provider calls for this comparison.</label>
                <p><button type="button" className="primary" disabled={!authorized || busy || startUnknown} onClick={() => void start()}>{busy ? "Starting…" : "Start comparison"}</button></p>
              </div>
            ) : <p className="notice" role="note" data-testid="comparison-paused">Live comparisons are paused, so no paid call can start from here. The eligibility check above made no provider call.</p>
          ) : null}
        </>}
        {job ? <p role="status" data-testid="comparison-status">{job.status === "completed" ? (finding ? "Comparison finished. The validated report is below." : "Comparison finished. Checking the result…") : job.status === "failed" ? "The comparison failed before a result was available." : job.status === "cancelled" ? "The comparison was cancelled. Requests already sent may still have been processed or charged." : job.status === "expired" ? "The comparison expired. Its in-process result is no longer available." : job.stageLabel} {job.error?.message ?? ""}</p> : null}
        {reportStatus && reportStatus !== "completed" && !finding ? <p>No ranking is shown for an unfinished comparison. That is not evidence against the territory.</p> : null}
        {finding ? <ComparativeReportView report={finding.report} /> : null}
        <CulturalConnectionsView map={finding?.connections ?? options.connections} title="Cultural connections across domains" />
      </> : null}
      {error ? <p role="alert" className="notice">{error}</p> : null}
    </section>
  );
}

/** The validated report as the server built it. No number here is computed in the browser. */
export function ComparativeReportView({ report }: { report: ComparativeStrategicReport }) {
  const outcome = outcomeCopy[report.outcome];
  const rows = [{ key: report.targetTerritory.key || "target", name: report.targetTerritory.name, entityType: report.targetTerritory.entityType, relativePosition: report.targetTerritory.relativePosition, classification: report.targetTerritory.provisionalClassification ? { label: report.targetTerritory.provisionalClassification.label } : null, robustness: report.targetTerritory.robustness ? { level: report.targetTerritory.robustness.level } : null, comparisonLimitation: null as string | null, target: true }, ...report.alternativesEvaluated.map((alt) => ({ ...alt, target: false }))];
  return (
    <div className="rw-comparative-assessment" data-testid="comparative-report" data-outcome={report.outcome} data-origin={report.evidenceOrigin}>
      <h4>Comparative cultural elasticity</h4>
      <p className="badge" data-kind={report.evidenceOrigin === "live" ? "live" : "recorded"} role="note">{report.evidenceOrigin === "live" ? "Live Qloo evidence" : report.evidenceOrigin === "recorded" ? "Recorded Qloo evidence" : "SYNTHETIC evidence (test world, not Qloo)"}</p>
      <p><strong>{outcome.headline}.</strong> {outcome.detail}</p>
      <div className="rw-table-scroll">
        <table>
          <caption className="quiet">Relative to [{report.targetTerritory.candidateSet.join(", ")}] only. Not a distance, demand or commercial measure.</caption>
          <thead><tr><th scope="col">Territory</th><th scope="col">Entity type</th><th scope="col">Position</th><th scope="col">Percentile</th><th scope="col">Classification</th><th scope="col">Robustness</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.name}{row.target ? " (proposed)" : ""}{row.comparisonLimitation ? <><br /><small className="quiet">{row.comparisonLimitation}</small></> : null}</th>
                <td>{row.entityType ?? "n/a"}</td>
                <td>{row.relativePosition?.position != null ? `${row.relativePosition.position} of ${row.relativePosition.of}` : "not ranked"}</td>
                <td>{row.relativePosition ? percent(row.relativePosition.medianPercentile) : "n/a"}</td>
                <td>{row.classification?.label ?? "none"}</td>
                <td>{row.robustness?.level ?? "n/a"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report.targetTerritory.robustness ? <p><strong>Representation robustness.</strong> {report.targetTerritory.robustness.level}. {report.targetTerritory.robustness.sensitivityDetail}</p> : null}
      {report.targetTerritory.coherence ? <p><strong>Cultural coherence.</strong> {report.targetTerritory.coherence.band}{report.targetTerritory.coherence.consistentlyShared.length ? `: shared ${report.targetTerritory.coherence.consistentlyShared.map((tag) => tag.label).join(", ")}` : ": no consistently shared cultural tag"}.</p> : null}
      {report.targetTerritory.evidenceQuality ? <p><strong>Evidence quality.</strong> {report.targetTerritory.evidenceQuality.level}.</p> : null}
      <h5>What the evidence establishes</h5><ul>{report.whatEvidenceEstablishes.map((line) => <li key={line}>{line}</li>)}</ul>
      {report.strategicImplications.length ? <><h5>Strategic reading</h5><ul>{report.strategicImplications.map((line) => <li key={line}>{line}</li>)}</ul></> : null}
      {report.interpretation ? <><h5>Interpretation (validated, not evidence)</h5><p>{report.interpretation.text}</p></> : null}
      <h5>What remains unknown</h5><ul>{report.whatRemainsUnknown.map((line) => <li key={line}>{line}</li>)}</ul>
      <h5>Research next</h5><ul>{report.nextResearchActions.map((line) => <li key={line}>{line}</li>)}</ul>
      <details><summary>Checks and sources</summary>
        <ul>{report.checks.map((item, index) => <li key={`${item.code}-${index}`}>{item.passed ? "Passed" : "Failed"}: {item.detail}</li>)}</ul>
        <p>Run {report.provenance.runId}; method {report.provenance.methodologyVersion}.</p>
        <p>{report.provenance.correlationIds.join("; ") || "No source references"}</p>
      </details>
    </div>
  );
}

/** Relationships grouped by how they were obtained. Nothing here is ranked or scored. */
export function CulturalConnectionsView({ map, title }: { map: CulturalConnectionMap; title: string }) {
  return (
    <div className="rw-connections" data-testid="cultural-connections">
      <h4>{title}</h4>
      <p className="quiet">Domains: {map.domains.join(", ") || "none"}. These relationships explain and suggest research; none of them enters a relative ranking.</p>
      {KINDS.map((kind) => {
        const items = map.relationships.filter((item) => item.kind === kind);
        if (!items.length) return null;
        const domains = [...new Set(items.map((item) => item.to.domain))];
        return (
          <section key={kind} data-kind={kind}>
            <h5>{relationshipKindCopy[kind].label} <span className="quiet">({items.length})</span></h5>
            <p className="quiet">{relationshipKindCopy[kind].note}</p>
            {domains.map((domain) => {
              const inDomain = items.filter((item) => item.to.domain === domain);
              return (
                <div key={domain} className="rw-connections__domain">
                  <h6>{domain} <span className="quiet">({inDomain.length})</span></h6>
                  <ul>
                    {inDomain.slice(0, PER_DOMAIN).map((item) => (
                      <li key={item.id}>
                        {item.from.label} → {item.to.label}
                        <details><summary>Source</summary><p>{item.basis}</p>{item.limitation ? <p>{item.limitation}</p> : null}<p>{item.correlationIds.join("; ")}</p></details>
                      </li>
                    ))}
                  </ul>
                  {inDomain.length > PER_DOMAIN ? <p className="quiet">{inDomain.length - PER_DOMAIN} more in the research brief.</p> : null}
                </div>
              );
            })}
          </section>
        );
      })}
      {map.notes.length ? <ul className="quiet">{map.notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
    </div>
  );
}
