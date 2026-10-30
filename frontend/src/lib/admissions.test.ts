import assert from "node:assert/strict";
import test from "node:test";
import { admissionCopy, interpretAdmissionProbe, liveQuestionsEnabled, parseAdmission } from "./admissions.ts";

test("admission views stay public and do not enable paused ask", () => {
  assert.deepEqual(parseAdmission({ status: "accepting" }), { status: "accepting" });
  assert.deepEqual(parseAdmission({ status: "paused" }), { status: "paused" });
  assert.deepEqual(parseAdmission({ bootId: "secret", acceptingInvestigations: false }), { status: "unavailable" });
  assert.equal(liveQuestionsEnabled("paused"), false);
  assert.equal(liveQuestionsEnabled("unavailable"), false);
  assert.equal(liveQuestionsEnabled("unknown"), false);
  assert.equal(liveQuestionsEnabled("accepting"), true);
});

test("a paused /ready body is never labelled disconnected", () => {
  const paused = interpretAdmissionProbe({
    ready: { status: 503, body: { acceptingInvestigations: false, reasons: ["ADMISSIONS_PAUSED"], bootId: "secret" } },
    health: null,
  });
  assert.equal(paused.status, "paused");
  assert.equal(admissionCopy("paused").shortLabel, "Live research temporarily unavailable.");
  assert.match(admissionCopy("paused").sentence, /connected/iu);
  assert.equal(admissionCopy("paused").liveEnabled, false);
  assert.notEqual(admissionCopy("paused").shortLabel, admissionCopy("unavailable").shortLabel);
});

test("an unreachable service is disconnected, and a live /health with a failed /ready is paused", () => {
  assert.deepEqual(interpretAdmissionProbe({ ready: null, health: null }), { status: "unavailable" });
  assert.equal(admissionCopy("unavailable").shortLabel, "Service connection unavailable.");
  const reachable = interpretAdmissionProbe({
    ready: null,
    health: { status: 200, body: { status: "ok", service: "cultural-elasticity-api" } },
  });
  assert.equal(reachable.status, "paused");
  assert.equal(liveQuestionsEnabled(reachable.status), false);
});

test("accepting investigations stay accepting and enable Ask", () => {
  const accepting = interpretAdmissionProbe({
    ready: { status: 200, body: { acceptingInvestigations: true, reasons: [] } },
    health: null,
  });
  assert.equal(accepting.status, "accepting");
  assert.equal(admissionCopy("accepting").shortLabel, "Live research available.");
  assert.equal(liveQuestionsEnabled("accepting"), true);
});

test("checking copy does not enable Ask", () => {
  assert.equal(admissionCopy("unknown").shortLabel, "Checking the research service.");
  assert.equal(admissionCopy("unknown").liveEnabled, false);
});
