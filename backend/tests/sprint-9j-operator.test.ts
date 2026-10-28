/**
 * Sprint 9J: paid dispatch needs an operator authorization that is independent of internal auth.
 * SYNTHETIC world, SYN- ids, baseline policy and scripted Qloo: no Qloo, no model, no network.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { refusingRunLedger, setRunLedgerForTests } from "../src/ops/run-ledger.js";
import { memoryRunLedger } from "./fixtures/synthetic/run-ledger.js";
import type { AnyBrandBaselineResult } from "@cultural-elasticity/shared";
import { buildApp } from "../src/app.js";
import { BaselinePolicyModel } from "../src/agent/model/baseline.js";
import { StructuralQueryInterpreter } from "../src/agent/query/interpreter.js";
import { RunStore } from "../src/agent/run-store.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { buildBaselineResult } from "../src/brand-baseline/research.js";
import { resetAdmission } from "../src/api/admission.js";
import { validatePublicRuntime } from "../src/config/production.js";
import { verifyPaidOperator } from "../src/ops/identity.js";
import { resetLifecycle } from "../src/ops/lifecycle.js";
import { resetSpend, spendLedger } from "../src/ops/spend.js";
import { scripted } from "./fixtures/synthetic/agent.js";
import { syntheticBrand, syntheticTag, syntheticTagObservation } from "./fixtures/synthetic/brand-baseline.js";

const SECRET = "ce-synthetic-internal-auth-secret-9j";
const DIAGNOSTICS = "ce-synthetic-diagnostics-operator-9j";
const PAID = "ce-synthetic-paid-operator-token-9j-xx";
const FUTURE = "2999-01-01T00:00:00Z";
const KEYS = [
  "CE_PUBLIC_DEPLOYMENT", "CE_INTERNAL_API_SECRET", "CE_ACCEPT_INVESTIGATIONS", "CE_SPEND_BUDGET_USD", "CE_INVESTIGATION_RESERVE_USD",
  "CE_OPERATOR_TOKEN", "CE_PAID_OPERATOR_TOKEN", "CE_PAID_OPERATOR_EXPIRES_AT", "QLOO_API_KEY", "ANTHROPIC_API_KEY", "QLOO_API_BASE_URL",
] as const;
const previous = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
afterEach(() => {
  for (const key of KEYS) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  resetAdmission();
  resetSpend();
  resetLifecycle();
});

const publicEnv = { CE_PUBLIC_DEPLOYMENT: "1", CE_INTERNAL_API_SECRET: SECRET } as NodeJS.ProcessEnv;

// Sprint 9J: a public runtime with a paid operator needs a durable run ledger; these tests use a SYNTHETIC one.
beforeEach(() => setRunLedgerForTests(memoryRunLedger()));
afterEach(() => setRunLedgerForTests(undefined));

describe("verifyPaidOperator", () => {
  const header = (value: string) => ({ "x-ce-paid-operator": value });

  it("is not required on a private process without a token, and required once one is configured", () => {
    expect(verifyPaidOperator({}, {})).toEqual({ ok: true });
    expect(verifyPaidOperator({}, { CE_PAID_OPERATOR_TOKEN: PAID })).toEqual({ ok: false, code: "operator_required" });
    expect(verifyPaidOperator(header(PAID), { CE_PAID_OPERATOR_TOKEN: PAID })).toEqual({ ok: true });
  });

  it("fails closed on a public process: no token, no expiry, a past expiry or a wrong value are refused", () => {
    expect(verifyPaidOperator(header(PAID), publicEnv)).toEqual({ ok: false, code: "operator_required" });
    expect(verifyPaidOperator(header(PAID), { ...publicEnv, CE_PAID_OPERATOR_TOKEN: PAID })).toEqual({ ok: false, code: "operator_expired" });
    expect(verifyPaidOperator(header(PAID), { ...publicEnv, CE_PAID_OPERATOR_TOKEN: PAID, CE_PAID_OPERATOR_EXPIRES_AT: "not a date" })).toEqual({ ok: false, code: "operator_expired" });
    const now = Date.parse("2026-10-27T12:00:00Z");
    expect(verifyPaidOperator(header(PAID), { ...publicEnv, CE_PAID_OPERATOR_TOKEN: PAID, CE_PAID_OPERATOR_EXPIRES_AT: "2026-10-27T11:59:59Z" }, now)).toEqual({ ok: false, code: "operator_expired" });
    expect(verifyPaidOperator(header(`${PAID}x`), { ...publicEnv, CE_PAID_OPERATOR_TOKEN: PAID, CE_PAID_OPERATOR_EXPIRES_AT: FUTURE })).toEqual({ ok: false, code: "operator_required" });
    // The internal secret is not an operator credential.
    expect(verifyPaidOperator({ "x-ce-internal-auth": SECRET, "x-ce-paid-operator": SECRET }, { ...publicEnv, CE_PAID_OPERATOR_TOKEN: PAID, CE_PAID_OPERATOR_EXPIRES_AT: FUTURE })).toEqual({ ok: false, code: "operator_required" });
    expect(verifyPaidOperator(header(PAID), { ...publicEnv, CE_PAID_OPERATOR_TOKEN: PAID, CE_PAID_OPERATOR_EXPIRES_AT: FUTURE }, now)).toEqual({ ok: true });
  });

  it("a public process refuses a weak paid token or one that reuses another credential", () => {
    const codes = (env: NodeJS.ProcessEnv) => validatePublicRuntime(env).map((issue) => issue.code);
    expect(codes({ ...publicEnv, CE_PAID_OPERATOR_TOKEN: "short" })).toContain("PAID_OPERATOR_WEAK");
    expect(codes({ ...publicEnv, CE_PAID_OPERATOR_TOKEN: SECRET })).toContain("PAID_OPERATOR_REUSED");
    expect(codes({ ...publicEnv, CE_OPERATOR_TOKEN: DIAGNOSTICS, CE_PAID_OPERATOR_TOKEN: DIAGNOSTICS })).toContain("PAID_OPERATOR_REUSED");
    expect(codes({ ...publicEnv, CE_OPERATOR_TOKEN: DIAGNOSTICS, CE_PAID_OPERATOR_TOKEN: PAID })).not.toEqual(expect.arrayContaining(["PAID_OPERATOR_WEAK", "PAID_OPERATOR_REUSED"]));
  });
});

type Scan = { token: string; result: AnyBrandBaselineResult };

function scanFor(label: string, qlooId: string): Scan {
  const scanId = randomUUID();
  const result = buildBaselineResult({
    scanId, brandId: `syn-internal-${scanId}`, brand: syntheticBrand(label, qlooId), brandCapturedAt: "2026-10-27T00:00:00.000Z",
    observations: [syntheticTagObservation([syntheticTag("urn:tag:interests:syn:slow_touring", "Slow Touring")])],
    startedAt: "2026-10-27T00:00:00.000Z", finishedAt: "2026-10-27T00:01:00.000Z", providerCallCount: 2, recordedOrLive: "recorded",
  });
  return { token: randomUUID(), result };
}

function harness(env: Record<string, string>) {
  process.env.CE_INTERNAL_API_SECRET = SECRET;
  process.env.CE_ACCEPT_INVESTIGATIONS = "1";
  process.env.CE_SPEND_BUDGET_USD = "20";
  process.env.CE_INVESTIGATION_RESERVE_USD = "1";
  Object.assign(process.env, env);
  resetLifecycle();
  resetSpend();
  resetAdmission();
  const scans = new Map<string, Scan>();
  const runtime = new AgentRuntime({ model: new BaselinePolicyModel(), provider: scripted(), store: new RunStore() });
  const app = buildApp({
    logLevel: "silent",
    agentRuntimeFactory: () => runtime,
    queryInterpreterFactory: () => new StructuralQueryInterpreter(),
    baselineReader: {
      readScan: async (id: string, token: string) => {
        const scan = scans.get(id);
        return scan && scan.token === token ? { status: scan.result.scanStatus, providerCallCount: 2, result: scan.result, stages: [] } : null;
      },
    },
  });
  const auth = (extra: Record<string, string> = {}) => ({ "x-ce-internal-auth": SECRET, "x-ce-visitor": "visitor-sprint9j-aaaaaa01", ...extra });
  const operator = (extra: Record<string, string> = {}) => auth({ "x-ce-paid-operator": PAID, ...extra });
  const addScan = (scan: Scan) => { scans.set(scan.result.scanId, scan); return scan; };
  async function waitFor(jobId: string, token: string) {
    for (let i = 0; i < 400; i += 1) {
      const view = (await app.inject({ method: "GET", url: `/api/agent/jobs/${jobId}`, headers: auth({ "x-job-token": token }) })).json();
      if (["completed", "failed", "cancelled", "expired"].includes(view.status)) return view;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("job did not finish");
  }
  return { app, auth, operator, addScan, waitFor };
}

describe("SYNTHETIC paid dispatch through the HTTP API", () => {
  it("a public process with open admissions refuses an anonymous paid start and reserves nothing", async () => {
    const h = harness({ CE_PUBLIC_DEPLOYMENT: "1", CE_PAID_OPERATOR_TOKEN: PAID, CE_PAID_OPERATOR_EXPIRES_AT: FUTURE, QLOO_API_KEY: "present", ANTHROPIC_API_KEY: "present", QLOO_API_BASE_URL: "https://hackathon.api.qloo.com" });
    const payload = { query: "Where could Northwind Atelier expand?" };
    const anonymous = await h.app.inject({ method: "POST", url: "/api/agent/jobs", headers: h.auth(), payload });
    expect(anonymous.statusCode).toBe(403);
    expect(anonymous.json()).toMatchObject({ error: "operator_required" });
    const forged = await h.app.inject({ method: "POST", url: "/api/agent/jobs", headers: h.auth({ "x-ce-paid-operator": SECRET }), payload });
    expect(forged.statusCode).toBe(403);
    expect(spendLedger().snapshot().reservedUsd).toBe(0);

    const ready = (await h.app.inject({ method: "GET", url: "/ready" })).json();
    expect(ready.dependencies.paidOperatorRequired).toBe(true);
    expect(JSON.stringify(ready)).not.toContain(PAID);

    const authorized = await h.app.inject({ method: "POST", url: "/api/agent/jobs", headers: h.operator(), payload });
    expect(authorized.statusCode, authorized.body).toBe(202);
    await h.app.close();
  });

  it("an expired authorization is refused even with the right token", async () => {
    const h = harness({ CE_PUBLIC_DEPLOYMENT: "1", CE_PAID_OPERATOR_TOKEN: PAID, CE_PAID_OPERATOR_EXPIRES_AT: "2020-01-01T00:00:00Z", QLOO_API_KEY: "present", ANTHROPIC_API_KEY: "present", QLOO_API_BASE_URL: "https://hackathon.api.qloo.com" });
    const response = await h.app.inject({ method: "POST", url: "/api/agent/jobs", headers: h.operator(), payload: { query: "Where could Northwind Atelier expand?" } });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "operator_expired" });
    await h.app.close();
  });

  it("an authorized operator is refused when the durable run record is unavailable or spent, and nothing stays reserved", async () => {
    const env = { CE_PUBLIC_DEPLOYMENT: "1", CE_PAID_OPERATOR_TOKEN: PAID, CE_PAID_OPERATOR_EXPIRES_AT: FUTURE, QLOO_API_KEY: "present", ANTHROPIC_API_KEY: "present", QLOO_API_BASE_URL: "https://hackathon.api.qloo.com" };
    const payload = { query: "Where could Northwind Atelier expand?" };
    setRunLedgerForTests(refusingRunLedger);
    const unavailable = harness(env);
    const refused = await unavailable.app.inject({ method: "POST", url: "/api/agent/jobs", headers: unavailable.operator(), payload });
    expect(refused.statusCode).toBe(503);
    expect(refused.json()).toMatchObject({ error: "budget_unavailable" });
    expect(spendLedger().snapshot().reservedUsd).toBe(0);
    await unavailable.app.close();

    // A restarted process: the in-memory ledger is empty, the durable record is already spent.
    const spent = memoryRunLedger();
    spent.rows.set("model_usd_cents", { limit: 100, used: 100 });
    setRunLedgerForTests(spent);
    resetSpend();
    const restarted = harness(env);
    const exhausted = await restarted.app.inject({ method: "POST", url: "/api/agent/jobs", headers: restarted.operator(), payload });
    expect(exhausted.statusCode).toBe(429);
    expect(exhausted.json()).toMatchObject({ error: "budget_exhausted" });
    expect(spendLedger().snapshot().reservedUsd).toBe(0);
    await restarted.app.close();
  });

  it("paused admission still wins: an operator cannot start work while admissions are off", async () => {
    const h = harness({ CE_PAID_OPERATOR_TOKEN: PAID, CE_ACCEPT_INVESTIGATIONS: "0" });
    const response = await h.app.inject({ method: "POST", url: "/api/agent/jobs", headers: h.operator(), payload: { query: "Where could Northwind Atelier expand?" } });
    expect(response.statusCode).toBe(503);
    await h.app.close();
  });

  it("handoff and comparison starts need the operator; free previews and options do not; a repeated start dispatches once", async () => {
    const h = harness({ CE_PAID_OPERATOR_TOKEN: PAID });
    const scan = h.addScan(scanFor("Larkspur Velo", "SYN-BR-3001"));
    const handoff = (direction: string, headers: Record<string, string>) =>
      h.app.inject({ method: "POST", url: "/api/agent/handoff/jobs", headers: { ...headers, "x-baseline-token": scan.token }, payload: { scanId: scan.result.scanId, proposedDirection: direction, idempotencyKey: randomUUID() } });

    const preview = await h.app.inject({ method: "POST", url: "/api/agent/handoff/preview", headers: h.auth({ "x-baseline-token": scan.token }), payload: { scanId: scan.result.scanId, proposedDirection: "Gravel Riding", idempotencyKey: randomUUID() } });
    expect(preview.statusCode, preview.body).toBe(200);
    expect((await handoff("Gravel Riding", h.auth())).statusCode).toBe(403);

    const started: { jobId: string; accessToken: string }[] = [];
    for (const direction of ["Gravel Riding", "Alpine Hiking", "Mountain Town"]) {
      const response = await handoff(direction, h.operator());
      expect(response.statusCode, response.body).toBe(202);
      const job = response.json() as { jobId: string; accessToken: string };
      expect((await h.waitFor(job.jobId, job.accessToken)).status).toBe("completed");
      started.push(job);
    }
    const parent = started[0]!;
    const compare = (mode: string, body: Record<string, unknown>, headers: Record<string, string>) =>
      h.app.inject({ method: "POST", url: `/api/agent/handoff/compare/${mode}`, headers: { ...headers, "x-baseline-token": scan.token, "x-job-token": parent.accessToken }, payload: { scanId: scan.result.scanId, parentJobId: parent.jobId, ...body } });
    const options = await compare("options", {}, h.auth());
    expect(options.statusCode, options.body).toBe(200);
    const ids = (options.json().references as { id: string; label: string }[]).filter((r) => r.label === "Alpine Hiking" || r.label === "Mountain Town").map((r) => r.id);
    expect(ids).toHaveLength(2);
    expect((await compare("preview", { referenceIds: ids }, h.auth())).json().eligibility.eligible).toBe(true);

    const key = randomUUID();
    const refused = await compare("jobs", { referenceIds: ids, idempotencyKey: key }, h.auth());
    expect(refused.statusCode).toBe(403);
    const first = await compare("jobs", { referenceIds: ids, idempotencyKey: key }, h.operator());
    expect(first.statusCode, first.body).toBe(202);
    const repeat = await compare("jobs", { referenceIds: ids, idempotencyKey: key }, h.operator());
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().jobId).toBe(first.json().jobId);
    await h.app.close();
  });
});
