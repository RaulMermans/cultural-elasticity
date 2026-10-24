import assert from "node:assert/strict";
import test from "node:test";
import { evidenceTerm, findingCopy, presentEvidenceText } from "./evidence-presentation.ts";

test("known methodology codes become labels without discarding the canonical value", () => {
  const term = evidenceTerm("UNCERTAIN_REPRESENTATION_SENSITIVE");
  assert.equal(term.known, true);
  assert.equal(term.label, "Representation-sensitive interpretation");
  assert.match(term.explanation, /may depend/iu);
  assert.equal(term.code, "UNCERTAIN_REPRESENTATION_SENSITIVE");
});

test("unknown methodology codes receive a generic fallback and are not invented", () => {
  const term = evidenceTerm("MADE_UP_METHODOLOGY_CODE");
  assert.equal(term.known, false);
  assert.equal(term.label, "Recorded technical detail");
  assert.match(term.explanation, /without a product interpretation/iu);
  assert.equal(term.code, "MADE_UP_METHODOLOGY_CODE");
  const presented = presentEvidenceText("Flag MADE_UP_METHODOLOGY_CODE was recorded.");
  assert.equal(presented.display.includes("MADE_UP_METHODOLOGY_CODE"), false);
  assert.deepEqual(presented.unknownCodes, ["MADE_UP_METHODOLOGY_CODE"]);
  assert.match(presented.display, /Recorded technical detail/u);
});

test("user-facing calculated lines keep numbers and hide raw class identifiers", () => {
  const presented = presentEvidenceText(
    "Provisional class UNCERTAIN_REPRESENTATION_SENSITIVE, relative to this comparison set only.",
  );
  assert.equal(presented.display.includes("UNCERTAIN_REPRESENTATION_SENSITIVE"), false);
  assert.match(presented.display, /Representation-sensitive interpretation/u);
  assert.deepEqual(presented.codes, ["UNCERTAIN_REPRESENTATION_SENSITIVE"]);
  const position = presentEvidenceText(
    "Relative position 2 of 3 (median panel percentile 0.5) within the comparison set Avant-garde experimental fashion, Bohemian lifestyle, Art and culture.",
  );
  assert.match(position.display, /2nd of 3/u);
  assert.match(position.display, /0\.5/u);
  assert.match(position.display, /Bohemian lifestyle/u);
});

test("limitation details strip territory keys and keep an honest absence", () => {
  const presented = presentEvidenceText(
    "art_and_culture: no brand-conditioned territory evidence (reported as absent, never as zero)",
  );
  assert.doesNotMatch(presented.display, /^art_and_culture/u);
  assert.match(presented.display, /absent, never as zero/u);
  const tag = presentEvidenceText("urn:tag:decor:qloo:boutique_hotel the list reached the requested limit");
  assert.doesNotMatch(tag.display, /urn:tag/u);
  assert.match(tag.display, /A recorded cultural tag:/u);
  const position = presentEvidenceText(
    "Relative position 1 of 3 (median panel percentile 0.75) within the comparison set Avant-garde experimental fashion, Bohemian lifestyle, Art and culture.",
  );
  assert.equal(position.display.includes("culture.."), false);
});

test("a supported territory finding prefers a grounded observation over boilerplate", () => {
  const finding = findingCopy({
    kind: "territory",
    tone: "supported",
    statusLabel: "Evidence supports a comparison",
    observed: ["Examples connected: Isabel Marant, Hopeless Lingerie."],
    calculated: [
      "Relative position 2 of 3 (median panel percentile 0.5) within the comparison set Avant-garde experimental fashion, Bohemian lifestyle, Art and culture.",
      "Provisional class UNCERTAIN_REPRESENTATION_SENSITIVE, relative to this comparison set only.",
    ],
    unavailable: ["conditioned not collected: Qloo call budget (32) spent"],
  });
  assert.match(finding.observation, /Isabel Marant/u);
  assert.doesNotMatch(finding.observation, /Investigated as a cultural territory/u);
  assert.match(finding.whyItMatters, /representation-sensitive/iu);
  assert.match(finding.whyItMatters, /not a recommendation/iu);
  assert.equal(finding.empty, false);
  assert.equal(finding.limitations.some((line) => line.includes("32")), true);
});

test("an unsupported territory states the absence without inventing a connection", () => {
  const finding = findingCopy({
    kind: "territory",
    tone: "unsupported",
    statusLabel: "No usable evidence",
    observed: ["No separate record of observed cultural evidence was included for this territory."],
    calculated: ["No calculated finding was recorded."],
    unavailable: ["No further limitation was recorded."],
  });
  assert.match(finding.observation, /Insufficient evidence to establish a territory-specific connection/u);
  assert.equal(finding.empty, true);
  assert.doesNotMatch(finding.whyItMatters, /recommendation to expand/iu);
});
