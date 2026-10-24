import assert from "node:assert/strict";
import test from "node:test";
import { liveQuestionsEnabled, parseAdmission } from "./admissions.ts";

test("admission views stay public and do not enable paused ask", () => {
  assert.deepEqual(parseAdmission({ status: "accepting" }), { status: "accepting" });
  assert.deepEqual(parseAdmission({ status: "paused" }), { status: "paused" });
  assert.deepEqual(parseAdmission({ bootId: "secret", acceptingInvestigations: false }), { status: "unavailable" });
  assert.equal(liveQuestionsEnabled("paused"), false);
  assert.equal(liveQuestionsEnabled("unavailable"), false);
  assert.equal(liveQuestionsEnabled("unknown"), false);
  assert.equal(liveQuestionsEnabled("accepting"), true);
});
