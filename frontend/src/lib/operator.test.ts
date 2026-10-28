import assert from "node:assert/strict";
import test from "node:test";
import { backendConfigIssues } from "./backend-url.ts";
import { admissionForVisitor, clearedOperatorCookie, operatorCookie, readOperatorCredential } from "./operator.ts";

const TOKEN = "SYNTHETIC-operator-credential-0000000000";

test("the operator credential is read only from its own well-formed cookie", () => {
  assert.equal(readOperatorCredential(null), null);
  assert.equal(readOperatorCredential(`ce_visitor=abcdefabcdefabcdef; ce_paid_operator=${TOKEN}`), TOKEN);
  assert.equal(readOperatorCredential("ce_paid_operator=short"), null);
  assert.equal(readOperatorCredential(`ce_paid_operator=${TOKEN};x`), TOKEN);
  assert.equal(readOperatorCredential(`ce_paid_operator=${TOKEN}<script>`), null);
});

test("the cookie is HttpOnly, SameSite=Strict, scoped to /api and short-lived", () => {
  const cookie = operatorCookie(TOKEN, true);
  for (const part of ["HttpOnly", "SameSite=Strict", "Path=/api", "Secure", "Max-Age=14400"]) assert.ok(cookie.includes(part), part);
  assert.ok(clearedOperatorCookie(true).includes("Max-Age=0"));
});

test("an anonymous visitor never sees an enabled paid start on a backend that requires the operator", () => {
  assert.deepEqual(admissionForVisitor({ status: "accepting" }, { operatorRequired: true, operatorPresent: false }), { status: "paused" });
  assert.deepEqual(admissionForVisitor({ status: "accepting" }, { operatorRequired: true, operatorPresent: true }), { status: "accepting" });
  assert.deepEqual(admissionForVisitor({ status: "accepting" }, { operatorRequired: false, operatorPresent: false }), { status: "accepting" });
  assert.deepEqual(admissionForVisitor({ status: "unavailable" }, { operatorRequired: true, operatorPresent: true }), { status: "unavailable" });
});

test("a half-configured production server is reported, never shown as connected", () => {
  assert.deepEqual(backendConfigIssues({ NODE_ENV: "development" }), []);
  assert.deepEqual(backendConfigIssues({ NODE_ENV: "production" }), ["BACKEND_URL_MISSING", "INTERNAL_SECRET_MISSING"]);
  assert.deepEqual(backendConfigIssues({ NODE_ENV: "production", BACKEND_URL: "https://api.example.test" }), ["INTERNAL_SECRET_MISSING"]);
  assert.deepEqual(backendConfigIssues({ NODE_ENV: "production", BACKEND_URL: "http://api.internal.test:4000", CE_INTERNAL_API_SECRET: "x".repeat(32) }), []);
  assert.deepEqual(backendConfigIssues({ NODE_ENV: "production", BACKEND_URL: "ftp://api.example.test", CE_INTERNAL_API_SECRET: "x".repeat(32) }), ["BACKEND_URL_INVALID"]);
  assert.deepEqual(backendConfigIssues({ NODE_ENV: "production", BACKEND_URL: "not a url", CE_INTERNAL_API_SECRET: "x".repeat(32) }), ["BACKEND_URL_INVALID"]);
  assert.deepEqual(backendConfigIssues({ NODE_ENV: "production", BACKEND_URL: "https://api.example.test", CE_INTERNAL_API_SECRET: "x".repeat(32) }), []);
});
