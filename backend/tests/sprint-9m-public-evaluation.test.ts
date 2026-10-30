/**
 * Sprint 9M: public evaluation admits anonymous visitors to paid research under durable global and per-network
 * quotas, only while configured and unexpired. SYNTHETIC world, baseline policy and scripted Qloo: no provider call.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { BaselinePolicyModel } from "../src/agent/model/baseline.js";
import { StructuralQueryInterpreter } from "../src/agent/query/interpreter.js";
import { RunStore } from "../src/agent/run-store.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { resetAdmission } from "../src/api/admission.js";
import { readiness } from "../src/api/health.js";
import { publicEvaluationActive, validatePublicRuntime } from "../src/config/production.js";
import { verifyPaidOperator } from "../src/ops/identity.js";
import { resetLifecycle } from "../src/ops/lifecycle.js";
import { researchEligibility } from "../src/ops/eligibility.js";
import { returnPublicQuota, takePublicQuota, visitorAllowance } from "../src/ops/public-quota.js";
import { refusingRunLedger, runCredential, setRunLedgerForTests, unusedReservationCents } from "../src/ops/run-ledger.js";
import { resetSpend, spendLedger } from "../src/ops/spend.js";
import { scripted } from "./fixtures/synthetic/agent.js";
import { memoryRunLedger } from "./fixtures/synthetic/run-ledger.js";

const SECRET = "ce-synthetic-internal-auth-secret-9m";
const PAID = "ce-synthetic-paid-operator-token-9m-xx";
const FUTURE = "2999-01-01T00:00:00Z";
const NETWORK_A = "a".repeat(32);
const NETWORK_B = "b".repeat(32);
const KEYS = [
  "CE_PUBLIC_DEPLOYMENT", "CE_INTERNAL_API_SECRET", "CE_ACCEPT_INVESTIGATIONS", "CE_SPEND_BUDGET_USD", "CE_INVESTIGATION_RESERVE_USD",
  "CE_PAID_OPERATOR_TOKEN", "CE_PAID_OPERATOR_EXPIRES_AT", "QLOO_API_KEY", "ANTHROPIC_API_KEY", "QLOO_API_BASE_URL",
  "CE_PUBLIC_EVALUATION", "CE_PUBLIC_EVALUATION_ID", "CE_PUBLIC_EVALUATION_EXPIRES_AT", "CE_PUBLIC_QUOTA_INVESTIGATIONS", "CE_PUBLIC_QUOTA_SCANS", "CE_PUBLIC_QUOTA_RESOLVES", "CE_PROCESS_QLOO_CALL_LIMIT", "DATABASE_URL",
] as const;
const previous = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
let ledger = memoryRunLedger();
beforeEach(() => {
  ledger = memoryRunLedger();
  setRunLedgerForTests(ledger);
});
afterEach(() => {
  for (const key of KEYS) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  setRunLedgerForTests(undefined);
  resetAdmission();
  resetSpend();
  resetLifecycle();
});

const evaluation = { CE_PUBLIC_DEPLOYMENT: "1", CE_INTERNAL_API_SECRET: SECRET, CE_PUBLIC_EVALUATION: "1", CE_PUBLIC_EVALUATION_ID: "syn-eval-9m", CE_PUBLIC_EVALUATION_EXPIRES_AT: FUTURE } as NodeJS.ProcessEnv;

describe("public evaluation admission", () => {
  it("admits an anonymous caller only while configured and unexpired; an operator credential still wins", () => {
    expect(verifyPaidOperator({}, evaluation)).toEqual({ ok: true, via: "public_evaluation" });
    expect(verifyPaidOperator({}, { ...evaluation, CE_PUBLIC_EVALUATION_EXPIRES_AT: "2020-01-01T00:00:00Z" })).toEqual({ ok: false, code: "operator_required" });
    expect(verifyPaidOperator({}, { ...evaluation, CE_PUBLIC_EVALUATION_EXPIRES_AT: undefined })).toEqual({ ok: false, code: "operator_required" });
    expect(verifyPaidOperator({}, { ...evaluation, CE_PUBLIC_EVALUATION: "0" })).toEqual({ ok: false, code: "operator_required" });
    expect(verifyPaidOperator({}, { ...evaluation, CE_PUBLIC_EVALUATION_ID: "bad id!" })).toEqual({ ok: false, code: "operator_required" });
    const both = { ...evaluation, CE_PAID_OPERATOR_TOKEN: PAID, CE_PAID_OPERATOR_EXPIRES_AT: FUTURE };
    expect(verifyPaidOperator({ "x-ce-paid-operator": PAID }, both)).toEqual({ ok: true, via: "operator" });
    expect(verifyPaidOperator({ "x-ce-paid-operator": "wrong" }, both)).toEqual({ ok: true, via: "public_evaluation" });
    const now = Date.parse("2026-11-06T05:00:00Z");
    expect(publicEvaluationActive({ ...evaluation, CE_PUBLIC_EVALUATION_EXPIRES_AT: "2026-11-06T05:00:00Z" }, now)).toBe(false);
  });

  it("refuses to boot a public evaluation without an id, expiry, explicit Qloo ceiling and durable ledger", () => {
    const codes = validatePublicRuntime({ ...evaluation, CE_PUBLIC_EVALUATION_ID: "", CE_PUBLIC_EVALUATION_EXPIRES_AT: "" }).map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining(["PUBLIC_EVALUATION_ID_INVALID", "PUBLIC_EVALUATION_EXPIRY_MISSING", "PUBLIC_EVALUATION_QLOO_LIMIT_MISSING", "PUBLIC_EVALUATION_LEDGER_MISSING"]));
    const complete = validatePublicRuntime({ ...evaluation, CE_PROCESS_QLOO_CALL_LIMIT: "300", DATABASE_URL: "postgres://synthetic" }).map((issue) => issue.code);
    expect(complete.filter((code) => code.startsWith("PUBLIC_EVALUATION"))).toEqual([]);
  });

  it("keys the durable run by the evaluation, never by the visitor, so every visitor shares one global cap", () => {
    expect(runCredential(evaluation)).toBe("public-evaluation:syn-eval-9m");
    expect(runCredential({ ...evaluation, CE_PAID_OPERATOR_TOKEN: PAID })).toBe("public-evaluation:syn-eval-9m");
    expect(runCredential({ CE_PAID_OPERATOR_TOKEN: PAID })).toBe(PAID);
  });

  it("returns only the provably unused part of a durable model reservation", () => {
    expect(unusedReservationCents(50, { uncertainty: "none", consumedUsd: 0.0113 })).toBe(48);
    expect(unusedReservationCents(50, { uncertainty: "none", consumedUsd: 0 })).toBe(50);
    expect(unusedReservationCents(50, { uncertainty: "none", consumedUsd: 0.9 })).toBe(0);
    expect(unusedReservationCents(50, { uncertainty: "provider_usage_missing", consumedUsd: 0.5 })).toBe(0);
    expect(unusedReservationCents(50, null)).toBe(0);
    expect(unusedReservationCents(0, { uncertainty: "none", consumedUsd: 0 })).toBe(0);
  });

  it("readiness tells the browser no operator cookie is needed only while the evaluation is active", () => {
    expect(readiness({ ...evaluation }).dependencies.paidOperatorRequired).toBe(false);
    expect(readiness({ ...evaluation, CE_PUBLIC_EVALUATION_EXPIRES_AT: "2020-01-01T00:00:00Z" }).dependencies.paidOperatorRequired).toBe(true);
  });

  it("HOTFIX: a raised quota admits a visitor who had used the old one, keeps their usage, and still caps them", async () => {
    const caller = { "x-ce-network": NETWORK_A };
    const at = (n: string) => ({ ...evaluation, CE_PUBLIC_QUOTA_INVESTIGATIONS: n });
    for (let i = 0; i < 4; i += 1) expect(await takePublicQuota(caller, "investigation", at("4"))).toEqual({ ok: true });
    const refused = await takePublicQuota(caller, "investigation", at("4"));
    expect(refused).toMatchObject({ ok: false, status: 429, error: "visitor_quota_reached" });
    expect(refused.ok ? "" : refused.message).toBe("This network has used its allowance of 4 investigations for this evaluation, which runs until 1 Jan 2999, 00:00 UTC. Saved research and the recorded example remain available.");
    expect(ledger.quotas.get(`investigation:${NETWORK_A}`)).toEqual({ limit: 4, used: 4 });
    ledger.rows.set("qloo_calls", { limit: 1000, used: 70 });
    ledger.rows.set("model_usd_cents", { limit: 500, used: 5 });

    // Railway raises the variable to 12: the next request applies it, the 4 used stay used.
    expect(await takePublicQuota(caller, "investigation", at("12"))).toEqual({ ok: true });
    expect(ledger.quotas.get(`investigation:${NETWORK_A}`)).toEqual({ limit: 12, used: 5 });
    for (let i = 0; i < 7; i += 1) expect(await takePublicQuota(caller, "investigation", at("12"))).toEqual({ ok: true });
    expect(await takePublicQuota(caller, "investigation", at("12"))).toMatchObject({ ok: false, error: "visitor_quota_reached" });
    expect(ledger.quotas.get(`investigation:${NETWORK_A}`)).toEqual({ limit: 12, used: 12 });

    // A lower (or accidentally unset) variable neither resets the usage nor reopens anything.
    expect(await takePublicQuota(caller, "investigation", at("4"))).toMatchObject({ ok: false, error: "visitor_quota_reached" });
    expect(await takePublicQuota(caller, "investigation", { ...evaluation, CE_PUBLIC_QUOTA_INVESTIGATIONS: "" })).toMatchObject({ ok: false });
    expect(ledger.quotas.get(`investigation:${NETWORK_A}`)).toEqual({ limit: 12, used: 12 });
    // The global caps are separate counters and never move with a quota.
    expect(ledger.rows.get("qloo_calls")).toEqual({ limit: 1000, used: 70 });
    expect(ledger.rows.get("model_usd_cents")).toEqual({ limit: 500, used: 5 });
  });

  it("HOTFIX: a quota unit is returned only to an evaluation visitor, and the allowance read takes nothing", async () => {
    const env = { ...evaluation, CE_PUBLIC_QUOTA_INVESTIGATIONS: "12" };
    const caller = { "x-ce-network": NETWORK_A };
    expect(await visitorAllowance(caller, env)).toEqual({ endsAt: new Date(FUTURE).toISOString(), searches: { used: 0, limit: 10 }, scans: { used: 0, limit: 4 }, investigations: { used: 0, limit: 12 } });
    await takePublicQuota(caller, "investigation", env);
    await takePublicQuota(caller, "investigation", env);
    await returnPublicQuota(caller, "investigation", env);
    expect(ledger.quotas.get(`investigation:${NETWORK_A}`)).toEqual({ limit: 12, used: 1 });
    expect((await visitorAllowance(caller, env))?.investigations).toEqual({ used: 1, limit: 12 });
    expect((await visitorAllowance(caller, { ...env, CE_PUBLIC_QUOTA_INVESTIGATIONS: "4" }))?.investigations).toEqual({ used: 1, limit: 12 });
    const operator = { ...env, CE_PAID_OPERATOR_TOKEN: PAID, CE_PAID_OPERATOR_EXPIRES_AT: FUTURE };
    await returnPublicQuota({ ...caller, "x-ce-paid-operator": PAID }, "investigation", operator);
    expect(ledger.quotas.get(`investigation:${NETWORK_A}`)?.used).toBe(1);
    expect(await visitorAllowance({ ...caller, "x-ce-paid-operator": PAID }, operator)).toBeNull();
    expect(await visitorAllowance({}, env)).toBeNull();
    expect(await visitorAllowance(caller, { ...env, CE_PUBLIC_EVALUATION_EXPIRES_AT: "2020-01-01T00:00:00Z" })).toBeNull();
  });

  it("HOTFIX: eligibility reports states only, and an unreadable ledger never claims a refusal", async () => {
    Object.assign(process.env, { CE_ACCEPT_INVESTIGATIONS: "1", CE_SPEND_BUDGET_USD: "5", CE_INVESTIGATION_RESERVE_USD: "0.5" });
    resetLifecycle();
    resetSpend();
    resetAdmission();
    const env = { ...evaluation, CE_SPEND_BUDGET_USD: "5", CE_INVESTIGATION_RESERVE_USD: "0.5", CE_PUBLIC_QUOTA_INVESTIGATIONS: "2", CE_PUBLIC_QUOTA_SCANS: "1" };
    const headers = { "x-ce-network": NETWORK_A };
    const budget = async () => ({ limitCalls: 400, usedCalls: 20 });
    const check = () => researchEligibility({ headers, callerAuthorized: true, baselineOpen: true, baselineBudget: budget, env });
    expect(await check()).toMatchObject({ newBrandResearch: "available", investigations: "available" });
    await takePublicQuota(headers, "scan", env);
    await takePublicQuota(headers, "investigation", env);
    await takePublicQuota(headers, "investigation", env);
    const spent = await check();
    expect(spent).toMatchObject({ newBrandResearch: "visitor_allowance_used", investigations: "visitor_allowance_used" });
    expect(Object.keys(spent)).toEqual(["newBrandResearch", "investigations", "allowance"]);
    // Raising the variable reopens it without touching the counter.
    expect(await researchEligibility({ headers, callerAuthorized: true, baselineOpen: true, baselineBudget: budget, env: { ...env, CE_PUBLIC_QUOTA_INVESTIGATIONS: "12" } })).toMatchObject({ investigations: "available" });
    ledger.rows.set("model_usd_cents", { limit: 500, used: 480 });
    expect(await check()).toMatchObject({ investigations: "budget_exhausted" });
    expect(await researchEligibility({ headers, callerAuthorized: true, baselineOpen: true, baselineBudget: async () => ({ limitCalls: 400, usedCalls: 395 }), env })).toMatchObject({ newBrandResearch: "budget_exhausted" });
    expect(await researchEligibility({ headers, callerAuthorized: false, baselineOpen: true, baselineBudget: budget, env })).toMatchObject({ newBrandResearch: "operator_required", investigations: "operator_required" });
    setRunLedgerForTests(refusingRunLedger);
    expect(await check()).toMatchObject({ investigations: "unknown", allowance: null });
  });

  it("per-network quotas are durable, separate per network and kind, refuse unattributed callers and skip operators", async () => {
    const env = { ...evaluation, CE_PUBLIC_QUOTA_INVESTIGATIONS: "2" };
    const caller = (network: string) => ({ "x-ce-network": network });
    expect(await takePublicQuota(caller(NETWORK_A), "investigation", env)).toEqual({ ok: true });
    expect(await takePublicQuota(caller(NETWORK_A), "investigation", env)).toEqual({ ok: true });
    expect(await takePublicQuota(caller(NETWORK_A), "investigation", env)).toMatchObject({ ok: false, status: 429, error: "visitor_quota_reached" });
    expect(await takePublicQuota(caller(NETWORK_B), "investigation", env)).toEqual({ ok: true });
    expect(await takePublicQuota(caller(NETWORK_A), "scan", env)).toEqual({ ok: true });
    expect(await takePublicQuota({}, "scan", env)).toMatchObject({ ok: false, status: 403, error: "visitor_unattributed" });
    expect(await takePublicQuota({ "x-ce-network": "not-a-key" }, "scan", env)).toMatchObject({ ok: false, error: "visitor_unattributed" });
    const operator = { ...env, CE_PAID_OPERATOR_TOKEN: PAID, CE_PAID_OPERATOR_EXPIRES_AT: FUTURE };
    for (let i = 0; i < 5; i += 1) expect(await takePublicQuota({ ...caller(NETWORK_A), "x-ce-paid-operator": PAID }, "investigation", operator)).toEqual({ ok: true });
  });
});

function harness(env: Record<string, string>) {
  Object.assign(process.env, {
    CE_ACCEPT_INVESTIGATIONS: "1", CE_SPEND_BUDGET_USD: "2", CE_INVESTIGATION_RESERVE_USD: "1",
    QLOO_API_KEY: "present", ANTHROPIC_API_KEY: "present", QLOO_API_BASE_URL: "https://hackathon.api.qloo.com",
    ...(evaluation as Record<string, string>), ...env,
  });
  resetLifecycle();
  resetSpend();
  resetAdmission();
  const runtime = new AgentRuntime({ model: new BaselinePolicyModel(), provider: scripted(), store: new RunStore() });
  const app = buildApp({ logLevel: "silent", agentRuntimeFactory: () => runtime, queryInterpreterFactory: () => new StructuralQueryInterpreter() });
  const visitor = (network: string | null, extra: Record<string, string> = {}) => ({
    "x-ce-internal-auth": SECRET, "x-ce-visitor": "visitor-sprint9m-aaaaaa01", ...(network ? { "x-ce-network": network } : {}), ...extra,
  });
  async function waitFor(jobId: string, token: string) {
    for (let i = 0; i < 400; i += 1) {
      const view = (await app.inject({ method: "GET", url: `/api/agent/jobs/${jobId}`, headers: visitor(null, { "x-job-token": token }) })).json();
      if (["completed", "failed", "cancelled", "expired"].includes(view.status)) return view;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("job did not finish");
  }
  return { app, visitor, waitFor };
}

describe("SYNTHETIC public evaluation through the HTTP API", () => {
  const payload = { query: "Where could Northwind Atelier expand?" };

  it("an anonymous visitor starts research without an operator cookie, until their network quota is spent", async () => {
    const h = harness({ CE_PUBLIC_QUOTA_INVESTIGATIONS: "1" });
    const first = await h.app.inject({ method: "POST", url: "/api/agent/jobs", headers: h.visitor(NETWORK_A), payload });
    expect(first.statusCode, first.body).toBe(202);
    const second = await h.app.inject({ method: "POST", url: "/api/agent/jobs", headers: h.visitor(NETWORK_A), payload });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({ error: "visitor_quota_reached" });
    const unattributed = await h.app.inject({ method: "POST", url: "/api/agent/jobs", headers: h.visitor(null), payload });
    expect(unattributed.statusCode).toBe(403);
    // Without internal auth nothing is admitted, evaluation or not.
    const direct = await h.app.inject({ method: "POST", url: "/api/agent/jobs", headers: { "x-ce-network": NETWORK_B }, payload });
    expect(direct.statusCode).toBe(401);
    await h.app.close();
  });

  it("an expired evaluation refuses anonymous starts and reserves nothing", async () => {
    const h = harness({ CE_PUBLIC_EVALUATION_EXPIRES_AT: "2020-01-01T00:00:00Z" });
    const refused = await h.app.inject({ method: "POST", url: "/api/agent/jobs", headers: h.visitor(NETWORK_A), payload });
    expect(refused.statusCode).toBe(403);
    expect(spendLedger().snapshot().reservedUsd).toBe(0);
    await h.app.close();
  });

  it("HOTFIX: a budget refusal costs no quota, and a quota refusal returns the spend it held", async () => {
    const h = harness({ CE_PUBLIC_QUOTA_INVESTIGATIONS: "1" });
    ledger.rows.set("model_usd_cents", { limit: 200, used: 200 });
    const broke = await h.app.inject({ method: "POST", url: "/api/agent/jobs", headers: h.visitor(NETWORK_A), payload });
    expect(broke.statusCode).toBe(429);
    expect(broke.json()).toMatchObject({ error: "budget_exhausted" });
    expect(ledger.quotas.get(`investigation:${NETWORK_A}`)).toBeUndefined();

    ledger.rows.set("model_usd_cents", { limit: 200, used: 0 });
    ledger.quotas.set(`investigation:${NETWORK_A}`, { limit: 1, used: 1 });
    const over = await h.app.inject({ method: "POST", url: "/api/agent/jobs", headers: h.visitor(NETWORK_A), payload });
    expect(over.statusCode).toBe(429);
    expect(over.json()).toMatchObject({ error: "visitor_quota_reached" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ledger.rows.get("model_usd_cents")).toEqual({ limit: 200, used: 0 });
    expect(spendLedger().snapshot().reservedUsd).toBe(0);
    expect(ledger.quotas.get(`investigation:${NETWORK_A}`)).toEqual({ limit: 1, used: 1 });

    // Raised on Railway: the same visitor is admitted on the next request.
    process.env.CE_PUBLIC_QUOTA_INVESTIGATIONS = "12";
    const raised = await h.app.inject({ method: "POST", url: "/api/agent/jobs", headers: h.visitor(NETWORK_A), payload });
    expect(raised.statusCode, raised.body).toBe(202);
    expect(ledger.quotas.get(`investigation:${NETWORK_A}`)).toEqual({ limit: 12, used: 2 });
    await h.waitFor(raised.json().jobId, raised.json().accessToken);
    await h.app.close();
  });

  it("the global model cap is durable and a settlement with unknown usage keeps its reservation", async () => {
    const h = harness({ CE_PUBLIC_QUOTA_INVESTIGATIONS: "10" });
    const started = await h.app.inject({ method: "POST", url: "/api/agent/jobs", headers: h.visitor(NETWORK_A), payload });
    expect(started.statusCode, started.body).toBe(202);
    expect(ledger.rows.get("model_usd_cents")).toEqual({ limit: 200, used: 100 });
    const job = started.json();
    await h.waitFor(job.jobId, job.accessToken);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The baseline policy reports no provider usage: unknown usage keeps the whole durable reservation.
    expect(ledger.rows.get("model_usd_cents")?.used).toBe(100);

    // A restart cannot reopen a spent global cap.
    ledger.rows.set("model_usd_cents", { limit: 200, used: 200 });
    resetSpend();
    const exhausted = await h.app.inject({ method: "POST", url: "/api/agent/jobs", headers: h.visitor(NETWORK_B), payload });
    expect(exhausted.statusCode).toBe(429);
    expect(exhausted.json()).toMatchObject({ error: "budget_exhausted" });
    await h.app.close();
  });
});
