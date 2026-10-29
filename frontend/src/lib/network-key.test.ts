import assert from "node:assert/strict";
import test from "node:test";
import { networkKeyOf } from "./network-key.ts";

const SECRET = "ce-synthetic-internal-auth-secret-9m-frontend";
const request = (headers: Record<string, string>) => new Request("https://synthetic.invalid/api/agent/jobs", { headers });

test("Sprint 9M network key: a stable keyed hash of the client address that never forwards the address", () => {
  const a = networkKeyOf(request({ "x-real-ip": "203.0.113.7" }), SECRET);
  assert.match(a ?? "", /^[a-f0-9]{32}$/u);
  assert.equal(networkKeyOf(request({ "x-real-ip": "203.0.113.7", cookie: "ce_visitor=a-different-cookie-value" }), SECRET), a);
  assert.ok(!a!.includes("203"));
  assert.notEqual(networkKeyOf(request({ "x-real-ip": "203.0.113.8" }), SECRET), a);
  assert.equal(networkKeyOf(request({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }), SECRET), a);
  assert.notEqual(networkKeyOf(request({ "x-real-ip": "203.0.113.7" }), "another-secret-value-for-tests-xx"), a);
});

test("Sprint 9M network key: none without an address or a secret, so Railway refuses public paid starts", () => {
  assert.equal(networkKeyOf(request({}), SECRET), null);
  assert.equal(networkKeyOf(request({ "x-real-ip": "203.0.113.7" }), undefined), null);
});
