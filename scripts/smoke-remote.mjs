#!/usr/bin/env node
// Deployed-backend smoke (Sprint 8E). Makes no paid provider call: run it only while CE_ACCEPT_INVESTIGATIONS=0,
// so even the authenticated job request is refused before any model or Qloo work. Secrets are read from the
// environment and never printed. /ops/providers/probe is only called WITHOUT the operator token.
// Usage: CE_INTERNAL_API_SECRET=… CE_OPERATOR_TOKEN=… node scripts/smoke-remote.mjs https://<backend-origin>
import { randomUUID } from "node:crypto";

const base = (process.argv.slice(2).find((a) => a !== "--") ?? "").replace(/\/+$/u, "");
const internal = process.env.CE_INTERNAL_API_SECRET ?? "";
const operator = process.env.CE_OPERATOR_TOKEN ?? "";
if (!base.startsWith("https://") || !internal) {
  console.error("usage: CE_INTERNAL_API_SECRET=… [CE_OPERATOR_TOKEN=…] node scripts/smoke-remote.mjs https://<backend-origin>");
  process.exit(2);
}

const results = [];
async function req(method, path, { body, headers = {}, raw } = {}) {
  const data = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  try {
    const res = await fetch(base + path, { method, body: data, headers: { ...(data === undefined ? {} : { "content-type": "application/json" }), ...headers } });
    return { status: res.status, text: await res.text() };
  } catch (error) {
    return { status: 0, text: `connection closed by server: ${error.cause?.code ?? error.message}` };
  }
}
function check(name, ok, detail) {
  results.push(ok);
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}: ${detail}`);
}

const job = { query: "Where could Jacquemus expand?" };
let r = await req("GET", "/health");
check("health 200", r.status === 200 && r.text.includes("cultural-elasticity-api"), r.status);
r = await req("GET", "/ready");
check("ready 503 ADMISSIONS_PAUSED", r.status === 503 && r.text.includes("ADMISSIONS_PAUSED"), r.status);
if (r.status === 200) {
  console.error("admissions are open: refusing to send authenticated job requests (they could start a paid run)");
  process.exit(1);
}
r = await req("POST", "/api/agent/jobs", { body: job });
check("job without auth -> 401", r.status === 401, r.status);
r = await req("POST", "/api/agent/jobs", { body: job, headers: { "x-ce-internal-auth": `wrong-${randomUUID()}` } });
check("job with wrong secret -> 401", r.status === 401, r.status);
r = await req("POST", "/api/agent/jobs", { body: job, headers: { "x-ce-internal-auth": internal } });
check("authenticated job while paused -> 503 (no paid call)", r.status === 503 && r.text.includes("admissions_paused"), r.status);
r = await req("POST", "/api/agent/jobs", { body: { ...job, model: "baseline" }, headers: { "x-ce-internal-auth": internal } });
check("baseline override refused (403, or 503 while paused)", r.status === 403 || r.status === 503, r.status);
r = await req("POST", "/api/agent/jobs", { body: job, headers: { "x-ce-visitor": "spoofed", "x-forwarded-for": "1.2.3.4" } });
check("client-supplied identity headers do not authenticate", r.status === 401, r.status);
for (const path of ["/api/agent/query", "/api/agent/interpret", "/api/agent/analyze", "/api/agent/follow-up", "/api/agent/continue"]) {
  r = await req("POST", path, { body: job });
  check(`${path} without auth refused`, r.status === 401 || r.status === 404, r.status);
}
r = await req("GET", `/api/agent/jobs/${randomUUID()}`);
check("job poll without auth/token refused", r.status === 401 || r.status === 404, r.status);
r = await req("POST", `/api/agent/jobs/${randomUUID()}/cancel`);
check("cancel without auth refused", r.status === 401 || r.status === 404, r.status);
r = await req("GET", "/ops/status");
check("operator status without token -> 404", r.status === 404, r.status);
r = await req("POST", "/ops/providers/probe");
check("provider probe without token -> 404", r.status === 404, r.status);
if (operator) {
  r = await req("GET", "/ops/status", { headers: { "x-ce-operator": operator } });
  check("operator status with token -> 200", r.status === 200, r.status);
  check("operator status leaks no secret", !r.text.includes(internal) && !r.text.includes(operator), "checked");
  let revisionSource = "missing";
  try {
    const parsed = JSON.parse(r.text).revision;
    if (parsed && typeof parsed.source === "string") revisionSource = parsed.source;
  } catch {
    revisionSource = "missing";
  }
  if (revisionSource === "missing") {
    console.log("[SKIP] operator status revision: this deployment predates the Sprint 8F revision field");
  } else {
    check("operator status includes revision object", true, revisionSource);
  }
}
for (const path of ["/api/methodology/analyze", "/api/analysis/ingredients"]) {
  r = await req("POST", path, { body: {} });
  check(`${path} closed in public mode`, [401, 403, 404].includes(r.status), r.status);
}
r = await req("POST", "/api/agent/jobs", { raw: JSON.stringify({ query: "x".repeat(2 * 1024 * 1024) }), headers: { "content-type": "application/json", "x-ce-internal-auth": internal } });
check("oversized body refused (413 or connection closed)", r.status === 413 || r.status === 0, r.status);
r = await req("GET", "/debug");
check("no /debug route", r.status === 404, r.status);

const failed = results.filter((ok) => !ok).length;
console.log(`\nREMOTE_SMOKE ${failed === 0 ? "PASS" : "FAIL"} ${results.length - failed}/${results.length}`);
process.exit(failed === 0 ? 0 : 1);
