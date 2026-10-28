/** SYNTHETIC inputs: the verdict restates the computed class, rank and robustness and adds nothing. */
import assert from "node:assert/strict";
import test from "node:test";
import { elasticityVerdict } from "./elasticity-verdict.ts";

test("a representation-sensitive last place with low robustness reads as not settled", () => {
  const verdict = elasticityVerdict({ code: "UNCERTAIN_REPRESENTATION_SENSITIVE", position: 3, of: 3, set: ["SYN A", "SYN B", "SYN C"], robustness: "LOW", brand: "SYN BRAND" });
  assert.match(verdict.headline, /^Not settled/u);
  assert.equal(verdict.lines[0], "It ranked 3 of 3 among SYN A, SYN B, SYN C in Qloo's association with SYN BRAND (1 is the strongest). The rank holds only for this set.");
  assert.match(verdict.lines[1]!, /Robustness is low/u);
});

test("an unknown class gets no invented reading, and a missing position adds no rank line", () => {
  const verdict = elasticityVerdict({ code: "SYN_UNKNOWN", position: null, of: null, set: [], robustness: null, brand: "B" });
  assert.deepEqual(verdict.lines, []);
  assert.doesNotMatch(verdict.headline, /fit|stretch/u);
});
