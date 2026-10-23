import assert from "node:assert/strict";
import test from "node:test";
import { backendBaseUrl } from "./backend-url.ts";
import { parseJobEnvelope, publicFailure } from "./job-envelope.ts";
import { newVisitorId, readVisitorId, visitorCookie, visitorFromRequest } from "./visitor.ts";

test("production does not default the backend URL to localhost", () => {
  assert.equal(backendBaseUrl({ NODE_ENV: "production" }), null);
  assert.equal(backendBaseUrl({ NODE_ENV: "production", BACKEND_URL: "https://api.example.test" }), "https://api.example.test");
  assert.equal(backendBaseUrl({ NODE_ENV: "development" }), "http://127.0.0.1:4000");
});

test("a visitor cookie is issued once and reused", () => {
  const first = visitorFromRequest(new Request("http://localhost/api/agent/jobs"));
  assert.match(first.id, /^[A-Za-z0-9_-]{16,64}$/u);
  assert.ok(first.setCookie?.includes("HttpOnly"));
  const reused = visitorFromRequest(
    new Request("http://localhost/api/agent/jobs", { headers: { cookie: visitorCookie(first.id, false) } }),
  );
  assert.equal(reused.id, first.id);
  assert.equal(reused.setCookie, null);
  assert.equal(readVisitorId("ce_visitor=short"), null);
  assert.ok(newVisitorId().length >= 16);
});

test("a missing production backend URL is an availability failure, not localhost", () => {
  assert.equal(backendBaseUrl({ NODE_ENV: "production", BACKEND_URL: "   " }), null);
  assert.equal(publicFailure(503, { error: "unavailable" }), "The investigation service is not available right now.");
  assert.equal(publicFailure(401, { error: "unauthorized" }), "The investigation service is not available from that origin.");
});

test("a malformed upstream job envelope is rejected", () => {
  assert.equal(parseJobEnvelope({ jobId: "x", status: "running" }).ok, false);
  assert.equal(parseJobEnvelope({ hello: "world" }).ok, false);
  assert.equal(parseJobEnvelope({ jobId: "x", status: "running", stage: "investigating", stageLabel: "Working", stopping: false, response: { not: "a query" }, error: null }).ok, false);
});
