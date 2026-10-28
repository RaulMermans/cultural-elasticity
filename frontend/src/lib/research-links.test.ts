/** SYNTHETIC sources: cross-branch ties are shared Qloo identifiers only, never a score. */
import assert from "node:assert/strict";
import test from "node:test";
import { connectionQuestions, crossLinks, type LinkSource } from "./research-links.ts";

const source = (nodeId: string, parent: string, name: string, ids: string[]): LinkSource => ({ nodeId, lineage: [nodeId, parent, "brand"], name, items: ids.map((id) => ({ id, label: `SYN ${id}`, kind: id.startsWith("tag") ? "taste" : "example" })) });

test("cards on different branches that share Qloo identifiers are tied, with what they share", () => {
  const links = crossLinks([
    source("n1", "dir:a", "SYN One", ["tag:x", "ent:1", "ent:2"]),
    source("n2", "dir:b", "SYN Two", ["ent:2", "tag:x"]),
    source("n3", "dir:c", "SYN Three", ["ent:9"]),
  ]);
  assert.deepEqual(links.map((link) => [link.a, link.b, link.shared.map((item) => item.id)]), [["n1", "n2", ["tag:x", "ent:2"]]]);
});

test("a card and what grew from it, or the same territory twice, is never a tie", () => {
  assert.deepEqual(crossLinks([source("n1", "dir:a", "SYN One", ["ent:1"]), source("n2", "n1", "SYN Two", ["ent:1"])]), []);
  assert.deepEqual(crossLinks([source("n1", "dir:a", "SYN One", ["ent:1"]), source("n2", "dir:b", "syn  one", ["ent:1"])]), []);
});

test("ties are ordered by how much they share, deterministically, and capped", () => {
  const sources = [source("a", "b1", "A", ["e1"]), source("b", "b2", "B", ["e1", "e2"]), source("c", "b3", "C", ["e1", "e2"])];
  assert.deepEqual(crossLinks(sources).map((link) => `${link.a}-${link.b}`), ["b-c", "a-b", "a-c"]);
  assert.equal(crossLinks(sources, 1).length, 1);
});

test("connection questions name both ends and the shared ground, never an example entity as a territory", () => {
  const questions = connectionQuestions("SYN BRAND", "SYN A", "SYN B", [
    { id: "ent:1", label: "SYN Example", kind: "example" },
    { id: "tag:1", label: "SYN Common", kind: "taste" },
  ]).map((item) => item.question);
  assert.deepEqual(questions, ["Compare SYN A with SYN B for SYN BRAND", "How far can SYN BRAND extend into SYN Common?", "Where could SYN BRAND go next between SYN A and SYN B?"]);
  assert.equal(connectionQuestions("B", "A1", "B1", [{ id: "e", label: "E", kind: "example" }]).length, 2);
});
