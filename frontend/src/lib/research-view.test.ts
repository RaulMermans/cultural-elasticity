/**
 * Research-truth, provenance and copy scenarios for the brand research workspace adapter.
 * Inputs: the Loewe research derived from a live canary (real stored Qloo evidence, re-read offline, kept with the
 * Sprint 9B.1 evidence), the stored as-run 0.1 Loewe result, and SYNTHETIC fixtures. Nothing here calls a provider.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AnyBrandBaselineResult, BrandBaselineResult, QueryResponse } from "@cultural-elasticity/shared";
import { apiErrorCopy, availabilityCopy, coverageCopy, scanStatusCopy, stageCopy } from "./research-copy.ts";
import { buildSummary, renderSummaryHtml } from "./research-summary.ts";
import { buildResearchView, connectionKey } from "./research-view.ts";

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const loeweAsRun = read("../../../evals/fixtures/live/loewe-baseline-canary-2.live.json").asRunResult.payload as AnyBrandBaselineResult;
const synthetic = read("../../../backend/tests/fixtures/synthetic/brand-baseline-e2e-v2.json") as { fixtureType: string; results: Record<"hypotheses" | "zeroTerritory" | "insufficient" | "partialProvider", BrandBaselineResult> };
const legacySynthetic = read("../../../backend/tests/fixtures/synthetic/brand-baseline-e2e.json") as { result: AnyBrandBaselineResult };
const derived = read("../../../docs/sprint-9b1/evidence/loewe-canary-2.derived-0.2.json") as { result: BrandBaselineResult };
const loewe = structuredClone(derived.result);
/** A SYNTHETIC completed investigation of another brand (Larkspur Velo). */
const otherBrand = (read("../../../backend/tests/fixtures/synthetic/comparative-e2e.json") as { parent: { view: { response: QueryResponse } } }).parent.view.response;

/** Words that must never appear in ordinary user copy. */
const INTERNAL = /urn:|mcp-|correlation|entity_tags|QUERY_SCOPED|OBSERVED_ASSOCIATION|PARTIAL_EVIDENCE|ce-brand-baseline|PROVIDER_CONFIRMED|GENERIC_TYPE|BRAND_CLASSIFICATION|AUDIENCE_TASTE|INSUFFICIENT_EVIDENCE|ADMISSIONS_PAUSED|_[A-Z]{3,}/u;
const PROMOTIONAL = /strong opportunity|high potential|excellent (cultural )?fit|best bet|winning|guaranteed/iu;
const userCopy = (view: ReturnType<typeof buildResearchView>) => [
  view.objective, view.outcome.headline, view.outcome.detail, view.core.note,
  ...view.connections.flatMap((item) => [item.name, item.contextLine, item.reason, item.meaning, item.next, ...item.observed, ...item.cannotConclude]),
  ...view.directions.flatMap((item) => [item.categoryLabel, item.why, item.strength, item.relation, item.nextQuestion, ...item.unknown, ...item.signals]),
  ...view.collections.flatMap((item) => [item.title, item.qualifier]),
  ...view.unresolved.flatMap((item) => [item.title, item.detail]), ...view.uncertainties, ...view.coverage.map((item) => item.text),
].join("\n");

// ---------- RESEARCH TRUTH ----------

test("RT-01 the Loewe research is a derived projection of a stored live scan", () => {
  assert.equal(loewe.execution.recordedOrLive, "recorded");
  assert.equal(loewe.execution.derivedFrom?.scanId, "b3a92759-2d28-4fdb-aeca-ca7845750f38");
});

test("RT-02 every displayed connection is a returned signal; nothing is added", () => {
  const view = buildResearchView(loewe);
  assert.equal(view.connections.length, loewe.fingerprint.signals.length);
  const ids = new Set(loewe.fingerprint.signals.map(connectionKey));
  for (const item of view.connections) assert.ok(ids.has(item.key), item.key);
  assert.equal(view.collections.reduce((sum, item) => sum + item.items.length, 0), 40);
});

test("RT-03 Loewe directions are never labelled adjacent or established from Qloo evidence alone", () => {
  const view = buildResearchView(loewe);
  assert.deepEqual(view.directions.map((item) => item.name), ["Model", "Fashion"]);
  for (const direction of view.directions) {
    assert.equal(direction.category, "OBSERVED");
    assert.equal(direction.categoryBasis, "evidence");
    assert.match(direction.relation, /Not established/u);
  }
});

test("RT-04 brand core is unverified when Qloo returned no category tags", () => {
  const view = buildResearchView(loewe);
  assert.equal(view.core.verified, false);
  assert.match(view.core.note, /Not verified/u);
  assert.ok(view.unresolved.some((item) => /current cultural position/u.test(item.title)));
});

test("RT-05 brand core comes only from Qloo category tags, and is not offered as a direction", () => {
  const view = buildResearchView(synthetic.results.zeroTerritory);
  assert.equal(view.core.verified, true);
  assert.ok(view.core.categories.length > 0);
  for (const category of view.core.categories) assert.ok(!view.directions.some((direction) => direction.canonicalConcept === category.id));
  assert.match(view.core.categories[0]!.meaning, /not a new direction/u);
});

test("RT-06 a verified core still does not turn a different tag into an adjacent direction", () => {
  const withCore: BrandBaselineResult = structuredClone(synthetic.results.hypotheses);
  withCore.fingerprint.signals.push({ ...structuredClone(synthetic.results.zeroTerritory.fingerprint.signals.find((item) => item.role === "BRAND_CLASSIFICATION")!) });
  const view = buildResearchView(withCore);
  assert.equal(view.core.verified, true);
  for (const direction of view.directions) {
    assert.notEqual(direction.category, "ADJACENT");
    assert.match(direction.relation, /has not been checked/u);
  }
});

test("RT-07 adjacency appears only from user context and is labelled as the user's", () => {
  const concept = loewe.territories[1]!.canonicalConcept;
  const view = buildResearchView(loewe, { [concept]: "new" });
  const fashion = view.directions.find((item) => item.canonicalConcept === concept)!;
  assert.equal(fashion.category, "ADJACENT");
  assert.equal(fashion.categoryBasis, "user");
  assert.match(fashion.categoryLabel, /your context/u);
  assert.match(fashion.relation, /not Qloo evidence/u);
  assert.equal(view.outcome.kind, "user-directions");
});

test("RT-08 user context never changes evidence, strength or source references", () => {
  const concept = loewe.territories[0]!.canonicalConcept;
  const before = buildResearchView(loewe).directions[0]!;
  const after = buildResearchView(loewe, { [concept]: "current" }).directions[0]!;
  assert.equal(after.category, "ESTABLISHED");
  assert.deepEqual(after.refs, before.refs);
  assert.equal(after.strength, before.strength);
  assert.equal(after.why, before.why);
  assert.deepEqual(loewe, derived.result, "input result is not mutated");
});

test("RT-09 directions keep Qloo's order; no opportunity ranking is introduced", () => {
  const view = buildResearchView(synthetic.results.hypotheses);
  assert.deepEqual(view.directions.map((item) => item.id), synthetic.results.hypotheses.territories.map((item) => item.id));
});

test("RT-10 no score, percentage or probability is produced", () => {
  const text = userCopy(buildResearchView(loewe));
  assert.doesNotMatch(text, /\d+(\.\d+)?\s?%|score|probabilit|confidence|elasticity/iu);
});

test("RT-11 query-scoped entities are never described as confirmed types", () => {
  const view = buildResearchView(loewe);
  for (const item of view.connections.filter((entry) => entry.kind === "entity")) {
    assert.equal(item.typeEvidence, "QUERY_SCOPED");
    assert.match(item.contextLine, /^Returned when researching related/u);
    assert.ok(item.cannotConclude.some((line) => /confirmed .* individually/u.test(line)), item.name);
    assert.doesNotMatch(item.observed.join(" "), /identifies this as/u);
  }
});

test("RT-12 provider-confirmed and unresolved types are worded differently and honestly", () => {
  const result: BrandBaselineResult = structuredClone(synthetic.results.hypotheses);
  const entities = result.fingerprint.signals.filter((item) => item.kind === "entity");
  entities[0]!.grounding = { ...entities[0]!.grounding!, typeEvidence: "PROVIDER_CONFIRMED_TYPE" };
  entities[1]!.grounding = { ...entities[1]!.grounding!, typeEvidence: "GENERIC_TYPE_UNRESOLVED" };
  const view = buildResearchView(result);
  assert.match(view.connections.find((item) => item.id === entities[0]!.id)!.observed[1]!, /Qloo identifies this as/u);
  assert.match(view.connections.find((item) => item.id === entities[1]!.id)!.observed[1]!, /did not confirm what kind/u);
});

test("RT-13 positions are compared only within one Qloo call", () => {
  const view = buildResearchView(loewe);
  const artist = view.connections.find((item) => item.domain === "artist")!;
  assert.match(artist.reason, /position 1 of 10 when asked for artists/u);
  const fashion = view.connections.find((item) => item.name === "Fashion")!;
  assert.match(fashion.reason, /position 9 of 10/u);
});

test("RT-14 zero directions still give a useful fingerprint and say why", () => {
  const view = buildResearchView(synthetic.results.zeroTerritory);
  assert.equal(view.directions.length, 0);
  assert.equal(view.outcome.kind, "connections-only");
  assert.match(view.outcome.headline, /not enough evidence for a new direction/u);
  assert.ok(view.connections.length > 0);
  assert.ok(view.nextSteps.length > 0);
});

test("RT-15 insufficient evidence is reported as missing evidence, not as a finding", () => {
  const view = buildResearchView(synthetic.results.insufficient);
  assert.equal(view.outcome.kind, "empty");
  assert.match(view.outcome.detail, /missing evidence, not a finding/u);
  assert.equal(view.status.tone, "insufficient");
});

test("RT-16 a partial provider response makes a direction unresolved, never stronger", () => {
  const view = buildResearchView(synthetic.results.partialProvider);
  const direction = view.directions[0]!;
  assert.equal(direction.category, "UNRESOLVED");
  assert.equal(direction.partial, true);
  assert.ok(direction.unknown.some((line) => /incomplete/u.test(line)));
  assert.equal(view.status.tone, "gaps");
});

test("RT-17 empty or unavailable domains are missing evidence, not zero connection", () => {
  const result: BrandBaselineResult = structuredClone(synthetic.results.hypotheses);
  result.fingerprint.domainCoverage = [...result.fingerprint.domainCoverage, { domain: "podcast", status: "EMPTY", entityCount: 0 }];
  const view = buildResearchView(result);
  assert.ok(view.unresolved.some((item) => item.title === "No podcasts" && /missing evidence/u.test(item.detail)));
  assert.equal(coverageCopy("EMPTY", 0, "podcast"), "Qloo returned none");
});

test("RT-18 ungrouped associations are listed as an open question, not invented themes", () => {
  const view = buildResearchView(loewe);
  assert.deepEqual(view.themes, [{ label: "Media keywords", members: ["japanese drama", "live action adaptation"] }]);
  assert.ok(view.unresolved.some((item) => /What links the 10 artists, 10 places, 10 films and 10 books/u.test(item.title)));
});

test("RT-19 possible duplicate tags are flagged, kept apart and not promoted", () => {
  const result: BrandBaselineResult = structuredClone(synthetic.results.hypotheses);
  const tags = result.fingerprint.signals.filter((item) => item.kind === "tag" && item.role === "AUDIENCE_TASTE");
  tags[1]!.possibleDuplicateOf = tags[0]!.id;
  result.territories = result.territories.map((item) => item.canonicalConcept === tags[1]!.id ? item : item);
  const view = buildResearchView(result);
  const flagged = view.connections.find((item) => item.id === tags[1]!.id)!;
  assert.equal(flagged.possibleDuplicateOf, tags[0]!.name);
  const direction = view.directions.find((item) => item.canonicalConcept === tags[1]!.id);
  if (direction) assert.equal(direction.category, "UNRESOLVED");
});

// ---------- PROVENANCE ----------

test("PV-01 every connection and direction keeps an eligible source reference", () => {
  const view = buildResearchView(loewe);
  const calls = new Set(loewe.fingerprint.provenance.map((ref) => ref.correlationId));
  for (const item of view.connections) assert.ok(calls.has(item.source.correlationId), item.name);
  for (const item of view.directions) for (const ref of item.refs) assert.ok(calls.has(ref.correlationId), item.name);
});

test("PV-02 recorded origin, capture time and derivation are preserved", () => {
  const view = buildResearchView(loewe);
  assert.equal(view.origin, "recorded");
  assert.equal(view.capturedAt, "2026-10-25T13:08:43.545Z");
  assert.equal(view.derivedFrom?.schemaVersion, "ce-brand-baseline/0.1");
  assert.match(buildSummary(view).provenanceLine, /not a new live run/u);
});

test("PV-03 the stored as-run 0.1 Loewe result stays readable, without new claims", () => {
  const view = buildResearchView(loeweAsRun);
  assert.equal(view.legacy, true);
  assert.equal(view.directions.length, 0);
  assert.equal(view.scanId, "b3a92759-2d28-4fdb-aeca-ca7845750f38");
  assert.ok(view.connections.every((item) => item.observed.some((line) => /earlier method/u.test(line))));
});

test("PV-04 legacy synthetic 0.1 directions render with an honest missing-explanation note", () => {
  const view = buildResearchView(legacySynthetic.result);
  assert.equal(view.legacy, true);
  for (const direction of view.directions) assert.match(direction.why, /was not recorded/u);
});

test("PV-06 source list is one entry per Qloo call", () => {
  const view = buildResearchView(loewe);
  assert.equal(view.method.sources.length, new Set(loewe.fingerprint.provenance.map((ref) => ref.correlationId)).size);
  assert.equal(view.method.positionRule, "research-position/v1");
});

// ---------- USER EXPERIENCE / COPY ----------

test("UX-01 ordinary copy contains no internal codes or identifiers", () => {
  for (const result of [loewe, loeweAsRun, ...Object.values(synthetic.results), legacySynthetic.result]) {
    assert.doesNotMatch(userCopy(buildResearchView(result)), INTERNAL);
  }
});

test("UX-02 no promotional opportunity language anywhere", () => {
  for (const result of [loewe, ...Object.values(synthetic.results)]) {
    const view = buildResearchView(result);
    assert.doesNotMatch(userCopy(view), PROMOTIONAL);
    assert.doesNotMatch(renderSummaryHtml(buildSummary(view), "now"), PROMOTIONAL);
  }
});

test("UX-03 each connection answers why, what it might mean, what it cannot show, and what next", () => {
  for (const item of buildResearchView(loewe).connections) {
    assert.ok(item.reason && item.meaning && item.next, item.name);
    assert.ok(item.cannotConclude.length >= 2, item.name);
  }
});

test("UX-04 status, stage, availability and API error codes all map to sentences", () => {
  assert.equal(scanStatusCopy("PARTIAL").label, "Research complete, with gaps");
  assert.equal(scanStatusCopy("SOMETHING_NEW").label, "Research status unknown");
  assert.equal(stageCopy("artist", "RUNNING"), "Finding related artists: in progress");
  assert.equal(availabilityCopy("paused").label, "New research is temporarily unavailable.");
  assert.equal(apiErrorCopy("baseline_paused"), "New research is temporarily unavailable.");
  // Hotfix: a shared limit is not the visitor allowance.
  assert.match(apiErrorCopy("qloo_call_limit_reached"), /limit was reached/u);
  assert.doesNotMatch(apiErrorCopy("qloo_call_limit_reached"), /allowance/u);
  assert.match(apiErrorCopy({}), /Something went wrong/u);
});

// ---------- SUMMARY ----------

test("SM-01 summary matches the canonical findings", () => {
  const view = buildResearchView(loewe);
  const summary = buildSummary(view);
  const connections = summary.sections.find((item) => item.id === "connections")!;
  for (const collection of view.collections) for (const item of collection.items) assert.ok(connections.items.some((entry) => entry.text.includes(item.name)), item.name);
  const directions = summary.sections.find((item) => item.id === "directions")!;
  assert.deepEqual(directions.items.map((item) => item.text.split(":")[0]), ["Model", "Fashion"]);
  assert.equal(summary.sources.length, view.method.sources.length);
});

test("SM-02 summary with zero directions says so instead of recommending", () => {
  const summary = buildSummary(buildResearchView(synthetic.results.zeroTerritory));
  assert.equal(summary.sections.find((item) => item.id === "directions")!.items[0]!.text, "The available evidence does not yet support a specific direction.");
});

test("SM-03 user context appears in the summary only when given, labelled as the user's", () => {
  assert.equal(buildSummary(buildResearchView(loewe)).sections.some((item) => item.id === "context"), false);
  const summary = buildSummary(buildResearchView(loewe, { [loewe.territories[0]!.canonicalConcept]: "current" }));
  assert.match(summary.sections.find((item) => item.id === "context")!.intro!, /not Qloo evidence/u);
});

test("SM-04 summary HTML escapes every value and includes no script", () => {
  const result: BrandBaselineResult = structuredClone(synthetic.results.hypotheses);
  result.brand.name = `<img src=x onerror=alert(1)>`;
  const html = renderSummaryHtml(buildSummary(buildResearchView(result)), "2026-10-25");
  assert.doesNotMatch(html, /<img|<script/u);
  assert.match(html, /&lt;img/u);
});

test("SM-05 summary generation is deterministic", () => {
  const a = renderSummaryHtml(buildSummary(buildResearchView(loewe)), "fixed");
  const b = renderSummaryHtml(buildSummary(buildResearchView(loewe)), "fixed");
  assert.equal(a, b);
});

test("SM-06 a different brand's investigation cannot enter the brief", () => {
  const response = otherBrand;
  const summary = buildSummary(buildResearchView(loewe), response);
  assert.match(summary.sections.find((item) => item.id === "observations")!.items[0]!.text, /No completed, matching/u);
  assert.equal(summary.sources.length, buildResearchView(loewe).method.sources.length);
});
