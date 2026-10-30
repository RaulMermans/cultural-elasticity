import assert from "node:assert/strict";
import test from "node:test";
import { publicFailure } from "./job-envelope.ts";
import { allowanceCopy, apiErrorCopy, availabilityFromStatus, investigationBlockCopy, parseResearchEligibility } from "./research-copy.ts";

const allowance = { endsAt: "2026-11-06T05:00:00.000Z", searches: { used: 3, limit: 20 }, scans: { used: 2, limit: 8 }, investigations: { used: 4, limit: 12 } };
const status = (research: unknown, enabled = true) => ({ enabled, admissionsOpen: true, operator: "authorized", research });

test("HOTFIX: the homepage says what this caller can actually start", () => {
  assert.equal(availabilityFromStatus(status({ newBrandResearch: "available", investigations: "available", allowance }), true), "available");
  assert.equal(availabilityFromStatus(status({ newBrandResearch: "visitor_allowance_used", investigations: "available", allowance }), true), "allowance_used");
  assert.equal(availabilityFromStatus(status({ newBrandResearch: "budget_exhausted", investigations: "budget_exhausted", allowance: null }), true), "budget_exhausted");
  assert.equal(availabilityFromStatus(status({ newBrandResearch: "admissions_paused", investigations: "admissions_paused", allowance: null }), true), "paused");
  assert.equal(availabilityFromStatus(status(undefined, false), true), "paused");
  assert.equal(availabilityFromStatus(null, false), "unavailable");
  // An older backend or an unreadable ledger never disables anything.
  assert.equal(availabilityFromStatus(status(undefined), true), "available");
  assert.equal(availabilityFromStatus(status({ newBrandResearch: "unknown", investigations: "unknown", allowance: null }), true), "available");
});

test("HOTFIX: investigation controls are blocked only by a known refusal, with the matching reason", () => {
  assert.match(investigationBlockCopy("visitor_allowance_used") ?? "", /network has used its investigation allowance/);
  assert.match(investigationBlockCopy("budget_exhausted") ?? "", /shared research budget/);
  assert.match(investigationBlockCopy("admissions_paused") ?? "", /paused/);
  assert.equal(investigationBlockCopy("available"), null);
  assert.equal(investigationBlockCopy("unknown"), null);
  assert.equal(investigationBlockCopy(null), null);
});

test("HOTFIX: the allowance line shows this network's own numbers left, from the configured limits", () => {
  assert.equal(allowanceCopy(allowance), "Public evaluation allowance for this network: 6 of 8 brand research runs, 8 of 12 investigations and 17 of 20 brand searches left, until 6 Nov 2026, 05:00 UTC. Opening saved research and the recorded examples doesn't count.");
  assert.match(allowanceCopy({ ...allowance, investigations: { used: 5, limit: 4 } }), /0 of 4 investigations/);
  assert.equal(parseResearchEligibility({ newBrandResearch: "available", investigations: "available", allowance: { ...allowance, scans: { used: -1, limit: 8 } } })?.allowance, null);
  assert.equal(parseResearchEligibility({ newBrandResearch: "maybe", investigations: "available" }), null);
});

test("HOTFIX: each refusal keeps its own meaning; a 429 is not always the visitor allowance", () => {
  assert.match(publicFailure(429, { error: "visitor_quota_reached" }), /allowance/);
  assert.match(publicFailure(429, { error: "budget_exhausted" }), /shared research budget/);
  assert.match(publicFailure(429, { error: "too_many_requests" }), /Too many requests/);
  assert.match(publicFailure(503, { error: "admissions_paused" }), /paused/);
  assert.match(publicFailure(503, { error: "quota_unavailable" }), /usage record/);
  assert.doesNotMatch(publicFailure(429, { error: "something_new" }), /already running|allowance/);
  // The server's own message wins when present.
  assert.equal(publicFailure(429, { error: "visitor_quota_reached", message: "This network has used its allowance of 12 investigations." }), "This network has used its allowance of 12 investigations.");
  const copies = ["visitor_quota_reached", "budget_exhausted", "too_many_requests", "admissions_paused", "quota_unavailable"].map(apiErrorCopy);
  assert.equal(new Set(copies).size, copies.length);
  assert.ok(!copies.includes(apiErrorCopy("an_unknown_code")));
  assert.doesNotMatch(apiErrorCopy("global_call_limit_exhausted"), /allowance/);
  assert.doesNotMatch(apiErrorCopy("scan_call_limit_exhausted"), /allowance/);
});
