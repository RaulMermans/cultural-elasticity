import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CoherenceView, CulturalElasticityResult } from "@cultural-elasticity/shared";
import { notFound } from "next/navigation";
import { postMethodology } from "@/lib/backend";

// Developer-only inspection of the deterministic methodology: a LIVE benchmark fixture (replayed
// offline) → backend /api/methodology/analyze → shared types. Not a product page; never in production.
export const dynamic = "force-dynamic";

const EVIDENCE_DIR = join(process.cwd(), "..", "evals", "benchmarks", "cultural-elasticity-v0", "evidence");

const n = (value: number | null | undefined) => (value === null || value === undefined ? "—" : String(Number(value.toFixed(3))));

function coherenceCell(view: CoherenceView) {
  if (!view.summary) return "insufficient evidence";
  return `median ${n(view.summary.sharedCountMedian)} shared (${view.summary.sharedCountMin}–${view.summary.sharedCountMax}) · ${view.band}`;
}

function Territories({ result }: { result: CulturalElasticityResult }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Position</th>
          <th>Territory</th>
          <th>Median panel percentile</th>
          <th>Panel evidence (exemplar substitutions)</th>
          <th>Robustness</th>
          <th>Coherence RAW → FILTERED</th>
          <th>Conditioned</th>
          <th>Quality</th>
          <th>Classification</th>
          {result.indexDecision.decision === "APPROVED" && <th>Relative index</th>}
        </tr>
      </thead>
      <tbody>
        {result.territories.map((t) => (
          <tr key={t.territory.id}>
            <td>{t.relativePosition.position === null ? "—" : `${t.relativePosition.position} / ${t.relativePosition.of}`}</td>
            <td>{t.territory.label}</td>
            <td>{n(t.relativePosition.medianPercentile)}</td>
            <td>{t.panelEvidence.map((o) => `${o.panelId}: ${o.exemplarLabel} ${o.rank}/${o.panelSize}`).join(" · ")}</td>
            <td>
              {t.robustness.level} (spread {n(t.robustness.percentileSpread)}, {t.robustness.panelledExemplars}/{t.robustness.declaredExemplars} exemplars)
            </td>
            <td>
              {coherenceCell(t.coherenceRaw)} → {coherenceCell(t.coherenceFiltered)}
            </td>
            <td>{t.conditionedEvidence === null ? "not collected" : `${t.conditionedEvidence.support} (${t.conditionedEvidence.entityCount})`}</td>
            <td>{t.evidenceQuality.level}</td>
            <td>{t.classification.label}</td>
            {result.indexDecision.decision === "APPROVED" && <td>{t.relativeElasticityIndex ? `${t.relativeElasticityIndex.value} / 100` : "withheld"}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function DevMethodologyPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  if (process.env.NODE_ENV === "production") notFound();

  const files = (await readdir(EVIDENCE_DIR)).filter((file) => file.endsWith(".live.json")).sort();
  const requested = (await searchParams).brand;
  const selected = files.find((file) => file === `${requested}.live.json`) ?? files.find((file) => file.startsWith("jacquemus")) ?? files[0];
  if (!selected) return <main>No live benchmark fixtures found in evals/benchmarks/cultural-elasticity-v0/evidence.</main>;

  const fixture = JSON.parse(await readFile(join(EVIDENCE_DIR, selected), "utf8")) as { notice: string; captureDate: string; apiEnvironment: string; input: unknown };
  const response = await postMethodology(fixture.input);

  return (
    <main className="dev">
      <h1>/dev/methodology</h1>
      <p className="notice">
        {fixture.notice} Captured {fixture.captureDate} from {fixture.apiEnvironment}; replayed offline (not a new live validation).
      </p>
      <nav>
        {files.map((file) => {
          const brand = file.replace(/\.live\.json$/, "");
          return (
            <a key={file} href={`?brand=${encodeURIComponent(brand)}`} aria-current={file === selected ? "page" : undefined}>
              {brand}
            </a>
          );
        })}
      </nav>
      {response.status === "unavailable" && <p data-status="unavailable">Backend unavailable.</p>}
      {response.status === "rejected" && <pre data-status="unavailable">{response.detail}</pre>}
      {response.status === "ok" && (
        <>
          <h2>
            {response.result.brand.label} · {response.result.methodologyVersion}
          </h2>
          <p>
            Evidence origin: <strong>{response.result.evidenceOrigin}</strong> · Index decision: <strong>{response.result.indexDecision.decision}</strong> · Index gate:{" "}
            <strong>{response.result.indexGate.status}</strong> · Classification thresholds ({response.result.classificationPolicy.status}): natural ≥ {response.result.classificationPolicy.naturalAdjacencyMinMedianPercentile}, break ≤{" "}
            {response.result.classificationPolicy.culturalBreakMaxMedianPercentile}
          </p>
          <p className="notice">{response.result.comparisonSet.note}</p>
          <Territories result={response.result} />

          <h3>Panels (one rank call each; values comparable only inside a panel)</h3>
          <table>
            <thead>
              <tr>
                <th>Panel</th>
                <th>Status</th>
                <th>Correlation id</th>
                <th>Rank order (within-call value)</th>
              </tr>
            </thead>
            <tbody>
              {response.result.panels.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.id} ({p.purpose})
                  </td>
                  <td>{p.status}</td>
                  <td>{p.correlationId ?? "—"}</td>
                  <td>{p.order.map((o) => `${o.rank}. ${o.exemplarLabel} (${n(o.withinCallValue)})`).join("  ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>Repeat checks: {response.result.repeatChecks.map((r) => `${r.panelId} ${r.status}`).join(", ") || "none"}</p>

          <h3>Index gate</h3>
          <table>
            <tbody>
              {response.result.indexGate.checks.map((c) => (
                <tr key={c.id}>
                  <td>{c.id}</td>
                  <td>{c.status}</td>
                  <td>{c.name}</td>
                  <td>{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="notice">{response.result.indexDecision.basis}</p>

          <h3>Operational tag filter ({response.result.brandTagFilter.policyVersion}), brand profile</h3>
          <p>
            Kept {response.result.brandTagFilter.keptCount} of {response.result.brandTagFilter.rawCount}. Excluded:{" "}
            {response.result.brandTagFilter.excluded.map((e) => `${e.signal.label} [${e.rule}]`).join(", ") || "none"}
          </p>

          <h3>Limitations</h3>
          <ul>
            {response.result.limitations.map((l) => (
              <li key={`${l.code}-${l.detail}`}>
                <code>{l.code}</code> {l.detail}
              </li>
            ))}
          </ul>
          <p>Not measured: {response.result.semantics.notMeasured.join("; ")}</p>

          <details>
            <summary>Why this result? (methodology trace)</summary>
            <pre>{JSON.stringify(response.result.trace, null, 2)}</pre>
          </details>
          <details>
            <summary>CulturalElasticityResult JSON</summary>
            <pre>{JSON.stringify(response.result, null, 2)}</pre>
          </details>
        </>
      )}
    </main>
  );
}
