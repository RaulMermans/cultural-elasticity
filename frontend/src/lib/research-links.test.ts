/** SYNTHETIC sources: cross-branch ties are shared Qloo identifiers only, never a score. */
import assert from "node:assert/strict";
import test from "node:test";
import { crossLinks, type LinkSource } from "./research-links.ts";

const source = (nodeId: string, branch: string, name: string, ids: string[]): LinkSource => ({ nodeId, branch, name, items: ids.map((id) => ({ id, label: `SYN ${id}`, kind: id.startsWith("tag") ? "taste" : "example" })) });

test("cards on different branches that share Qloo identifiers are tied, with what they share", () => {
  const links = crossLinks([
    source("n1", "dir:a", "SYN One", ["tag:x", "ent:1", "ent:2"]),
    source("n2", "dir:b", "SYN Two", ["ent:2", "tag:x"]),
    source("n3", "dir:c", "SYN Three", ["ent:9"]),
  ]);
  assert.deepEqual(links.map((link) => [link.a, link.b, link.shared.map((item) => item.id)]), [["n1", "n2", ["tag:x", "ent:2"]]]);
});

test("the same branch, or the same territory twice, is never a tie", () => {
  assert.deepEqual(crossLinks([source("n1", "dir:a", "SYN One", ["ent:1"]), source("n2", "dir:a", "SYN Two", ["ent:1"])]), []);
  assert.deepEqual(crossLinks([source("n1", "dir:a", "SYN One", ["ent:1"]), source("n2", "dir:b", "syn  one", ["ent:1"])]), []);
});

test("ties are ordered by how much they share, deterministically, and capped", () => {
  const sources = [source("a", "b1", "A", ["e1"]), source("b", "b2", "B", ["e1", "e2"]), source("c", "b3", "C", ["e1", "e2"])];
  assert.deepEqual(crossLinks(sources).map((link) => `${link.a}-${link.b}`), ["b-c", "a-b", "a-c"]);
  assert.equal(crossLinks(sources, 1).length, 1);
});
