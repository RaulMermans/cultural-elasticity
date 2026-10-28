import assert from "node:assert/strict";
import test from "node:test";
import { HOME, parseRoute, routeQuery, sameName } from "./research-route.ts";

const params = (query: string) => new URLSearchParams(query);

test("routes round-trip through the URL", () => {
  const route = parseRoute(params("research=loewe&view=connections&item=artist:ABC"));
  assert.deepEqual(route, { mode: "research", research: "loewe", view: "connections", layout: "tabs", item: "artist:ABC", open: null, ask: null });
  assert.deepEqual(parseRoute(params(routeQuery(route).slice(1))), route);
  assert.equal(routeQuery(HOME), "");
});

test("the research network is the default layout; a section or layout=tabs opens the classic view", () => {
  assert.equal(parseRoute(params("research=loewe")).layout, "network");
  assert.equal(parseRoute(params("research=loewe&view=summary")).layout, "tabs");
  const classic = parseRoute(params("research=loewe&layout=tabs"));
  assert.equal(classic.layout, "tabs");
  assert.equal(routeQuery(classic), "?research=loewe&layout=tabs");
  assert.equal(routeQuery({ ...classic, layout: "network" }), "?research=loewe");
});

test("unknown views and malformed keys fall back safely", () => {
  assert.equal(parseRoute(params("research=../etc&view=admin")).research, null);
  assert.equal(parseRoute(params("research=loewe&view=admin")).view, "overview");
});

test("atlas mode keeps only atlas parameters", () => {
  const route = parseRoute(params("mode=atlas&open=recorded&research=loewe&ask=Where"));
  assert.equal(route.research, null);
  assert.equal(routeQuery(route), "?mode=atlas&open=recorded&ask=Where");
});

test("a URL never carries a token or extra parameter", () => {
  const route = parseRoute(params("research=session&token=secret&x-baseline-token=abc"));
  assert.doesNotMatch(routeQuery(route), /token|secret/u);
});

test("recorded name lookup ignores case and accents, never partial matches", () => {
  assert.equal(sameName("loéwe", "Loewe"), true);
  assert.equal(sameName("Loe", "Loewe"), false);
  assert.equal(sameName("  ", ""), false);
});
