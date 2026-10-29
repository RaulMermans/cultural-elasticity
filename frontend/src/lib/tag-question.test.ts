import assert from "node:assert/strict";
import test from "node:test";
import { draftQuestion } from "./tag-question.ts";

test("Sprint 9L: a tapped tag drafts a question about its topic", () => {
  assert.equal(draftQuestion("Crocs", "Hip Hop", "concept"), "How far can Crocs extend into Hip Hop?");
  assert.equal(draftQuestion("Crocs", "  Olivia   Rodrigo ", "entity"), "What connects Crocs with Olivia Rodrigo?");
});
