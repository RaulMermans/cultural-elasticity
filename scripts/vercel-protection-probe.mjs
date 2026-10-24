#!/usr/bin/env node
// Anonymous protection probe for Vercel URLs. Never sends cookies, tokens, or bypass headers.
// A protected redirect (401/403/302/307 to the Vercel login) is a pass.
// HTTP 404 DEPLOYMENT_NOT_FOUND on an unassigned alias is a pass (not app exposure).
// HTTP 200 with the Living Atlas document is a fail: VERCEL_PROTECTION_GATE_FAILED.
// Usage: node scripts/vercel-protection-probe.mjs https://<url> [https://<url> ...]
const urls = process.argv.slice(2).filter((value) => value !== "--");
if (urls.length === 0 || urls.some((url) => !url.startsWith("https://"))) {
  console.error("usage: node scripts/vercel-protection-probe.mjs https://<deployment-or-alias> [...]");
  process.exit(2);
}

const results = [];
for (const url of urls) {
  const res = await fetch(url, { redirect: "manual", headers: { accept: "text/html,application/json" } });
  const location = res.headers.get("location") ?? "";
  const vercelError = res.headers.get("x-vercel-error") ?? "";
  const body = await res.text();
  const looksLikeLogin = /vercel\.com\/login|authentication required|sso-api|_vercel_sso|protected by vercel authentication/i.test(`${location}\n${body}`);
  const servedApp = res.status === 200 && /cultural elasticity|living atlas|__next/i.test(body);
  const protectedStatus = res.status === 401 || res.status === 403 || ([301, 302, 303, 307, 308].includes(res.status) && looksLikeLogin);
  const unassigned = res.status === 404 && /DEPLOYMENT_NOT_FOUND/i.test(`${vercelError}\n${body}`);
  const pass = (protectedStatus || unassigned) && !servedApp;
  results.push({ url, status: res.status, location, pass, servedApp, unassigned });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${url} status=${res.status} location=${location || "-"} servedApp=${servedApp} unassigned=${unassigned}`);
}

const failed = results.filter((row) => !row.pass);
if (failed.length > 0) {
  console.error("\nVERCEL_PROTECTION_GATE_FAILED");
  process.exit(1);
}
console.log("\nVERCEL_PROTECTION_PROBE_PASS");
