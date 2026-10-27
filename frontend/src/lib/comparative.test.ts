import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AnyBrandBaselineResult, ComparativeStrategicReport, CulturalConnectionMap } from "@cultural-elasticity/shared";
import { parseReportEnvelope } from "./comparative.ts";
import { buildSummary, renderSummaryHtml } from "./research-summary.ts";
import { buildResearchView } from "./research-view.ts";

const fixtures = JSON.parse(readFileSync(new URL("../../../backend/tests/fixtures/synthetic/brand-baseline-e2e-v2.json", import.meta.url), "utf8")) as { results: { hypotheses: AnyBrandBaselineResult } };
const baseline = fixtures.results.hypotheses;
const view = buildResearchView(baseline, {});

/** SYNTHETIC report for the synthetic baseline brand (placeholder ids, test world). */
function report(overrides: Partial<ComparativeStrategicReport> = {}): ComparativeStrategicReport {
  return {
    schemaVersion: "ce-comparative-report/0.2",
    outcome: "RELATIVE_POSITION_ESTABLISHED",
    checks: [{ code: "BRAND_MATCHES_SCAN", passed: true, detail: "SYNTHETIC check" }],
    brand: { id: baseline.brand.qlooId, name: baseline.brand.name },
    targetTerritory: {
      key: "syn_target", name: "SYNTHETIC Target", relativePosition: { position: 2, of: 3, medianPercentile: 0.5 },
      provisionalClassification: { label: "CREDIBLE_STRETCH", statement: "SYNTHETIC" }, robustness: { level: "MEDIUM", sensitivityDetail: "SYNTHETIC spread" },
      coherence: { band: "LOW", consistentlyShared: [] }, evidenceQuality: { level: "MEDIUM", drivers: [] },
      candidateSet: ["SYNTHETIC Target", "SYNTHETIC A", "SYNTHETIC B"], entityType: "place",
    },
    alternativesEvaluated: [
      { key: "syn_a", name: "SYNTHETIC A", role: "target", origin: "user", entityType: "place", analysisRoute: "FULL_RELATIVE_ANALYSIS", relativePosition: { position: 1, of: 3, medianPercentile: 1 }, classification: { label: "NATURAL_ADJACENCY" }, robustness: { level: "HIGH" }, comparisonLimitation: null },
      { key: "syn_c", name: "SYNTHETIC C", role: "target", origin: "user", entityType: "brand", analysisRoute: "PARTIAL_CULTURAL_ANALYSIS", relativePosition: null, classification: null, robustness: null, comparisonLimitation: "Represented by brand entities; qualitative evidence only." },
    ],
    whatEvidenceEstablishes: ["SYNTHETIC established fact."],
    whatRemainsUnknown: ["SYNTHETIC unknown."],
    strategicImplications: ["SYNTHETIC implication."],
    nextResearchActions: ["SYNTHETIC next step."],
    interpretation: null,
    evidenceOrigin: "synthetic",
    provenance: { runId: "syn-run", correlationIds: ["syn-rank-1"], methodologyVersion: "syn" },
    ...overrides,
  };
}

const connections: CulturalConnectionMap = {
  schemaVersion: "ce-cultural-connections/0.1", brand: { id: baseline.brand.qlooId, name: baseline.brand.name }, evidenceOrigin: "synthetic", domains: ["place"],
  relationships: [{ id: "r1", kind: "DIRECT_QLOO_OBSERVATION", from: { kind: "brand", id: "b", label: baseline.brand.name, domain: "brand" }, to: { kind: "entity", id: "SYN-PL-1", label: "SYNTHETIC Place", domain: "place" }, basis: "SYNTHETIC", correlationIds: ["syn-rec"], rankable: false, limitation: null }],
  notes: ["SYNTHETIC note."],
};

test("14: the brief and its export repeat the server report exactly, with its evidence label", () => {
  const summary = buildSummary(view, null, { report: report(), connections });
  const section = summary.sections.find((item) => item.id === "comparison")!;
  assert.match(section.intro!, /SYNTHETIC test world, not Qloo/u);
  assert.equal(section.items[0]!.text, "SYNTHETIC Target (proposed): position 2 of 3 (50th percentile). Classification: CREDIBLE_STRETCH.");
  assert.equal(section.items[1]!.text, "SYNTHETIC A: position 1 of 3 (100th percentile). Classification: NATURAL_ADJACENCY.");
  assert.equal(section.items[2]!.text, "SYNTHETIC C: not ranked. Classification: none.");
  assert.match(section.items[2]!.detail!, /qualitative evidence only/u);
  assert.match(summary.outcome.detail, /position 2 of 3/u);
  assert.ok(summary.sources.some((source) => source.reference === "syn-rank-1"));
  const relationships = summary.sections.find((item) => item.id === "relationships")!;
  assert.match(relationships.items[0]!.text, /^Observed by Qloo \(1\)/u);
  const html = renderSummaryHtml(summary, "2026-10-27T00:00:00.000Z");
  for (const item of section.items) assert.ok(html.includes(item.text.replace(/&/gu, "&amp;")), item.text);
  assert.ok(html.includes("SYNTHETIC test world, not Qloo"));
});

test("a report for another brand never enters the brief; a withheld ranking shows no position", () => {
  const other = buildSummary(view, null, { report: report({ brand: { id: "SYN-OTHER", name: "Other" } }), connections });
  assert.ok(!other.sections.some((item) => item.id === "relationships"));
  assert.ok(!JSON.stringify(other).includes("SYNTHETIC Target"));
  const withheld = report({ outcome: "INTEGRITY_FAILED", targetTerritory: { ...report().targetTerritory, relativePosition: null, provisionalClassification: null }, alternativesEvaluated: report().alternativesEvaluated.map((alt) => ({ ...alt, relativePosition: null, classification: null })) });
  const summary = buildSummary(view, null, { report: withheld, connections: null });
  assert.match(summary.outcome.headline, /Ranking withheld/u);
  assert.ok(!/position \d of/u.test(JSON.stringify(summary.sections.find((item) => item.id === "comparison"))));
});

test("the report boundary rejects an unknown schema or a rankable relationship", () => {
  const envelope = { version: "ce-comparative-report-envelope/0.1", status: "completed", error: null, report: report(), connections };
  assert.ok(parseReportEnvelope(envelope));
  assert.equal(parseReportEnvelope({ ...envelope, report: { ...report(), schemaVersion: "ce-comparative-report/0.1" } }), null);
  assert.equal(parseReportEnvelope({ ...envelope, connections: { ...connections, relationships: [{ ...connections.relationships[0], rankable: true }] } }), null);
});

test("12: the recorded comparative demo is reproducible from its sources and contains no ranking", () => {
  const demo = JSON.parse(readFileSync(new URL("../demo/recorded-comparative.json", import.meta.url), "utf8")) as {
    kind: string; evidenceOrigin: string; sources: { path: string; sha256: string }[]; eligibility: { eligible: boolean; code: string };
    comparison: { status: string }; connections: CulturalConnectionMap;
  };
  assert.equal(demo.kind, "RECORDED_COMPARATIVE_DEMO");
  assert.equal(demo.evidenceOrigin, "live");
  for (const source of demo.sources) {
    const text = readFileSync(new URL(`../../../${source.path}`, import.meta.url), "utf8");
    assert.equal(createHash("sha256").update(text).digest("hex"), source.sha256, source.path);
  }
  assert.equal(demo.eligibility.eligible, false);
  assert.equal(demo.comparison.status, "NOT_RUN");
  assert.ok(!/relativePosition|medianPercentile|NATURAL_ADJACENCY|CREDIBLE_STRETCH|CULTURAL_BREAK/u.test(JSON.stringify(demo)));
  assert.ok(demo.connections.relationships.every((item) => item.rankable === false && item.correlationIds.every((id) => id.startsWith("mcp-"))));
  assert.equal(demo.connections.evidenceOrigin, "recorded");
});
