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
  assert.match(mountain.meta!, /Natural fit · ranked 1 of 3 among/u);
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
