"use client";

import type { ComparativeReferenceCandidate, ComparisonEligibility, CulturalConnectionMap } from "@cultural-elasticity/shared";
import demo from "@/demo/recorded-comparative.json";
import { hypothesisOutcomeCopy } from "@/lib/research-copy";
import { referenceSourceCopy, typeEvidenceCopy } from "@/lib/comparative";
import { CulturalConnectionsView } from "./ComparativeResearchPanel";

type Demo = {
  kind: "RECORDED_COMPARATIVE_DEMO";
  evidenceOrigin: "live";
  brand: { qlooId: string; name: string };
  investigation: { question: string; outcome: keyof typeof hypothesisOutcomeCopy | null; observed: string[]; limitations: string[]; target: { label: string; entityType: string | null; exemplars: { label: string }[] } };
  references: ComparativeReferenceCandidate[];
  eligibility: ComparisonEligibility;
  connections: CulturalConnectionMap;
  comparison: { status: "NOT_RUN"; reason: string };
};

const recorded = demo as unknown as Demo;

/**
 * Sprint 9I recorded demonstration: the comparative journey on stored live evidence, stopped honestly where the
 * evidence stops. It has no enabled action and never calls a provider.
 */
export function RecordedComparativeDemo({ brandQlooId }: { brandQlooId: string }) {
  if (recorded.kind !== "RECORDED_COMPARATIVE_DEMO" || recorded.brand.qlooId !== brandQlooId) return null;
  const { investigation } = recorded;
  return (
    <section className="rw-compare" aria-labelledby="rw-recorded-compare" data-testid="recorded-comparative-demo">
      <p className="kicker">Recorded comparative research</p>
      <h2 id="rw-recorded-compare">Can {investigation.target.label} be compared with other territories?</h2>
      <p className="badge" data-kind="recorded" role="note">Recorded from earlier live Qloo research. Nothing on this page starts a new search.</p>
      <h3>1. Investigated direction</h3>
      <p>{investigation.question}</p>
      <p><strong>{investigation.outcome ? hypothesisOutcomeCopy[investigation.outcome] : "No conclusion"}.</strong> Represented by {investigation.target.entityType ?? "no"} exemplars: {investigation.target.exemplars.map((item) => item.label).join(", ")}.</p>
      <ul>{investigation.observed.map((line) => <li key={line}>{line}</li>)}</ul>
      <details><summary>Limitations recorded by the investigation</summary><ul>{investigation.limitations.map((line) => <li key={line}>{line}</li>)}</ul></details>
      <h3>2. Possible reference territories</h3>
      <ul className="rw-plain">
        {recorded.references.map((reference) => (
          <li key={reference.id} data-testid="recorded-reference">
            <strong>{reference.label}</strong> <span className="quiet">· {referenceSourceCopy[reference.source]}</span>
            <p className="quiet">{typeEvidenceCopy(reference)}{reference.blocked ? ` ${reference.blocked.action}` : ""}</p>
          </li>
        ))}
      </ul>
      <h3>3. Comparison check</h3>
      <p data-testid="recorded-eligibility"><strong>{recorded.eligibility.eligible ? "Eligible." : "Not eligible."}</strong> {recorded.eligibility.reason}</p>
      <p className="notice" role="note" data-testid="recorded-comparison-not-run"><strong>No comparison was run.</strong> {recorded.comparison.reason} No relative position or classification is shown, and none was estimated.</p>
      <CulturalConnectionsView map={recorded.connections} title="4. Cultural connections across domains" />
    </section>
  );
}
