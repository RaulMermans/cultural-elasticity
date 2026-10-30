/** SYNTHETIC network: the report restates computed results, stamps the moment, and invents nothing. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AnyBrandBaselineResult, QueryResponse } from "@cultural-elasticity/shared";
import { buildNetworkReport, renderReportHtml, reportFileName } from "./network-report.ts";
import { buildNetwork, type Inquiry } from "./research-network.ts";
import { buildResearchView } from "./research-view.ts";

const fixture = JSON.parse(readFileSync(new URL("../../../backend/tests/fixtures/synthetic/comparative-e2e.json", import.meta.url), "utf8")) as { baseline: AnyBrandBaselineResult; compare: { view: { response: QueryResponse } } };
const view = buildResearchView(fixture.baseline);
const inquiry: Inquiry = { jobId: "syn-1", token: "syn", parentId: "brand", origin: "question", question: "Compare Gravel Riding with Alpine Hiking and Mountain Town", status: "completed", stageLabel: "", response: fixture.compare.view.response, lost: false, createdAt: Date.UTC(2026, 9, 28, 12, 0) };
const nodes = buildNetwork(view.brand.name, view.directions, [inquiry]);
const now = new Date(Date.UTC(2026, 9, 28, 18, 45, 30));
const report = buildNetworkReport({ view, nodes, inquiries: [inquiry], links: [], now });

test("the summary restates each measured class with its territories", () => {
  const text = report.summary.join(" ");
  assert.match(text, /1 natural fit \(Mountain Town\)/u);
  assert.match(text, /1 credible stretch \(Alpine Hiking\)/u);
  assert.match(text, /1 cultural break \(Gravel Riding\)/u);
  assert.doesNotMatch(text, /%|probability|forecast|will (sell|succeed)/iu);
});

test("territory readings name the comparison each rank holds in", () => {
  const territories = report.sections.find((section) => section.id === "territories")!;
  const mountain = territories.blocks.find((block) => block.heading === "Mountain Town")!;
  // Sprint 12: the research conclusion leads; the comparative result and its set follow.
  assert.match(mountain.meta!, /^[A-Z][a-z ]+ · comparative: natural fit · ranked 1 of 3 among/u);
});

test("the report is stamped with the download time and the file name carries it", () => {
  assert.equal(report.stamp.iso, "2026-10-28T18:45:30.000Z");
  assert.match(reportFileName(view.brand.name, now, "pdf"), /^larkspur-velo-cultural-research_2026-10-28_\d{4}\.pdf$/u);
  const html = renderReportHtml(report);
  assert.match(html, /Generated .*2026-10-28T18:45:30\.000Z/u);
  assert.doesNotMatch(html, /<script/iu);
});

test("patterns state per-comparison ranks without combining them, and name uninvestigated directions", () => {
  const again: Inquiry = { ...inquiry, jobId: "syn-2", question: "Compare Mountain Town with Gravel Riding and Alpine Hiking", createdAt: inquiry.createdAt + 1000 };
  const twice = buildNetworkReport({ view, nodes: buildNetwork(view.brand.name, view.directions, [inquiry, again]), inquiries: [inquiry, again], links: [], now });
  const patterns = twice.sections.find((section) => section.id === "patterns")!;
  const consistency = patterns.blocks.find((block) => block.heading === "How territories hold up across comparisons")!;
  assert.ok(consistency.bullets!.includes("Mountain Town came first in every comparison it was part of (1st of 3, 1st of 3)."));
  assert.ok(consistency.bullets!.includes("Gravel Riding came last in every comparison it was part of (3rd of 3, 3rd of 3)."));
  const blind = patterns.blocks.find((block) => block.heading === "Blind spots")!;
  assert.match(blind.text!, /Slow Touring/u);
});

test("a territory found in two questions is read once, and an unchanged rank is not called changing", () => {
  const again: Inquiry = { ...inquiry, jobId: "syn-3", question: "Compare Mountain Town with Gravel Riding and Alpine Hiking", createdAt: inquiry.createdAt + 1000 };
  const twice = buildNetworkReport({ view, nodes: buildNetwork(view.brand.name, view.directions, [inquiry, again]), inquiries: [inquiry, again], links: [], now });
  assert.doesNotMatch(twice.summary.join(" "), /Mountain Town and Mountain Town/u);
  assert.equal(twice.stats.find((stat) => stat.label === "Territories read")!.value, 3);
  const consistency = twice.sections.find((section) => section.id === "patterns")!.blocks.find((block) => block.heading === "How territories hold up across comparisons")!;
  assert.ok(consistency.bullets!.includes("Alpine Hiking held the same place in every comparison it was part of (2nd of 3, 2nd of 3)."));
});

test("the PDF never draws a line over the one above it (the title once overlapped the header)", async () => {
  const { jsPDF } = await import("jspdf");
  const { buildReportPdf } = await import("./report-download.ts");
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const drawn: { page: number; top: number; size: number }[] = [];
  const text = pdf.text.bind(pdf);
  (pdf as unknown as { text: (...args: unknown[]) => unknown }).text = (line: unknown, x: unknown, y: unknown, options?: { baseline?: string }) => {
    if (options?.baseline === "top") drawn.push({ page: pdf.getCurrentPageInfo().pageNumber, top: y as number, size: pdf.getFontSize() });
    return text(line as string, x as number, y as number, options as never);
  };
  buildReportPdf(report, pdf);
  assert.ok(drawn.length > 10);
  for (let i = 1; i < drawn.length; i += 1) {
    const [previous, current] = [drawn[i - 1]!, drawn[i]!];
    if (previous.page === current.page) assert.ok(current.top >= previous.top + previous.size, `line ${i} overlaps the line above it`);
  }
});

test("Sprint 9N: the report prints the same decision card the live reading shows (parity)", async () => {
  const { territoryReading } = await import("./territory-reading.ts");
  const { decisionCard } = await import("@cultural-elasticity/shared");
  const territories = report.sections.find((section) => section.id === "territories")!;
  const result = fixture.compare.view.response.investigation!.result;
  for (const block of territories.blocks) {
    const key = fixture.compare.view.response.territories.find((item) => item.name === block.heading)?.territoryKey ?? null;
    const reading = territoryReading(result, key, view.brand.name);
    const card = decisionCard(result as never, key);
    assert.deepEqual(reading?.decision, card);
    assert.ok(card && block.bullets?.includes(`Implication: ${card.implication.label}. ${card.implication.text}`), block.heading);
    for (const action of card!.nextActions) assert.ok(block.bullets?.includes(`Next: ${action.text}`));
  }
  assert.doesNotMatch(renderReportHtml(report), /\b(THIN_TARGET_PANEL|LIKELY_REPEATS|SUPPORTED_FOR_EXPLORATION)\b/u);
});

test("Sprint 9O: each exported card is the card its live dossier shows, with the same baseline context (live Carhartt export)", async () => {
  const { decisionCard } = await import("@cultural-elasticity/shared");
  const { directionNodeId } = await import("./research-network.ts");
  // SYNTHETIC: one baseline direction investigated and left unmeasured (as live Carhartt → Blue Collar on 2026-10-29).
  const base = view.directions[0]!;
  const wide = { ...view, directions: [base, { ...base, key: "syn-9o-a", id: "syn-9o-a", name: "Harbour Walks" }, { ...base, key: "syn-9o-b", id: "syn-9o-b", name: "Night Ferries" }] };
  const direction = base;
  const response = structuredClone(fixture.compare.view.response);
  const result = response.investigation!.result as unknown as { territories: Record<string, unknown>[] };
  const territory = { ...result.territories[0]!, label: direction.name, analysisRoute: "INSUFFICIENT_EVIDENCE", classification: null, relativePosition: null, comparisonSet: null };
  result.territories = [territory];
  response.territories = [{ ...response.territories[0]!, name: direction.name, territoryKey: territory.key as string }];
  const asked: Inquiry = { ...inquiry, jobId: "syn-9o", parentId: directionNodeId(direction.key), origin: "direction", question: `Investigate ${direction.name}`, response };
  const unmeasured = buildNetworkReport({ view: wide, nodes: buildNetwork(wide.brand.name, wide.directions, [asked]), inquiries: [asked], links: [], now });
  const block = unmeasured.sections.find((section) => section.id === "territories")!.blocks.find((item) => item.heading === direction.name)!;
  // ResearchNetwork's direction dossier passes the direction's own "why" (Sprint 12: never the brand's other directions).
  const live = decisionCard(result as never, territory.key as string, { directionWhy: direction.why })!;
  assert.notDeepEqual(live, decisionCard(result as never, territory.key as string), "the live context must change this card");
  assert.ok(live.nextActions.every((action) => action.kind !== "COMPARE_WITH_NAMED" && !/Harbour Walks|Night Ferries/u.test(action.text)), "the brand's other directions are not comparison references");
  for (const action of live.nextActions) assert.ok(block.bullets?.includes(`Next: ${action.text}`), action.text);
});

test("Sprint 10A: the export prints the evidence status and the signals a discovered direction surfaced from (parity)", async () => {
  const { territoryReading } = await import("./territory-reading.ts");
  const response = structuredClone(fixture.compare.view.response);
  const result = response.investigation!.result as unknown as { territories: { key: string; label: string }[]; comparisonSetConstruction: Record<string, unknown> };
  const target = result.territories[0]!;
  // SYNTHETIC opportunity view for one territory of the fixture.
  result.comparisonSetConstruction = { ...result.comparisonSetConstruction, opportunities: [{ territoryKey: target.key, direction: target.label, source: "agent_hypothesis", status: "QLOO_SUPPORTED", blocker: null, surfacedBy: [{ id: "SYN-AR-1", label: "SYN artist", relation: "SEED_ENTITY_TAG", correlationIds: ["syn-1"] }], facet: "genre:syn", domainRelation: "OUTSIDE_BRAND_PROFILE_FACETS", interpretation: "SYN reading", unknowns: [], nextInvestigation: null }] };
  const asked: Inquiry = { ...inquiry, jobId: "syn-10a", origin: "explore", response };
  const exported = buildNetworkReport({ view, nodes: buildNetwork(view.brand.name, view.directions, [asked]), inquiries: [asked], links: [], now });
  const block = exported.sections.find((section) => section.id === "territories")!.blocks.find((item) => item.heading === target.label)!;
  const live = territoryReading(result as never, target.key, view.brand.name)!.surfaced!;
  assert.ok(block.bullets?.includes(`Evidence status: ${live.status}. ${live.statusText}`));
  assert.ok(block.bullets?.includes(`Surfaced from: ${live.signals.join("; ")}`));
  assert.ok(block.bullets?.includes("Agent's interpretation (not Qloo evidence): SYN reading"));
  assert.doesNotMatch(renderReportHtml(exported), /\b(QLOO_SUPPORTED|SEED_ENTITY_TAG|OUTSIDE_BRAND_PROFILE_FACETS)\b/u);
});
