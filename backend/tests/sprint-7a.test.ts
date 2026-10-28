/** Sprint 7A: public runtime safety, spend, proxy trust, health, jobs and recorded provenance. SYNTHETIC. */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setRunLedgerForTests } from "../src/ops/run-ledger.js";
import { memoryRunLedger } from "./fixtures/synthetic/run-ledger.js";
import { parseQueryResponse } from "@cultural-elasticity/shared";
import { buildApp } from "../src/app.js";
import { resetAdmission } from "../src/api/admission.js";
import { readiness } from "../src/api/health.js";
import { BaselinePolicyModel } from "../src/agent/model/baseline.js";
import { JobManager } from "../src/agent/query/jobs.js";
import { ScriptedQueryInterpreter } from "../src/agent/query/interpreter.js";
import { RunStore } from "../src/agent/run-store.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { investigationsAccepted, validatePublicRuntime } from "../src/config/production.js";
import { conservativeReserveUsd } from "../src/ops/pricing.js";
import { resetLifecycle } from "../src/ops/lifecycle.js";
import { resetMetrics } from "../src/ops/metrics.js";
import { resetSpend, SpendLedger } from "../src/ops/spend.js";
import { admitVisitor, verifyInternalAuth } from "../src/ops/identity.js";
import { proposal } from "../scripts/synthetic/query-proposals.js";
import { scripted } from "./fixtures/synthetic/agent.js";
import type { QueryResponse } from "@cultural-elasticity/shared";

const SECRET = "ce-public-internal-auth-secret-32ch";
const OPERATOR = "ce-operator-token-value-32chars-xx";
const PAID_OPERATOR = "ce-paid-operator-token-value-32ch-x";
const PAID_EXPIRY = "2999-01-01T00:00:00Z";
const KEYS = ["CE_PUBLIC_DEPLOYMENT", "CE_INTERNAL_API_SECRET", "CE_SPEND_BUDGET_USD", "CE_INVESTIGATION_RESERVE_USD", "CE_ACCEPT_INVESTIGATIONS", "CE_JOB_CREATE_LIMIT", "CE_GLOBAL_JOB_LIMIT", "CE_OPERATOR_TOKEN", "CE_PAID_OPERATOR_TOKEN", "CE_PAID_OPERATOR_EXPIRES_AT", "QLOO_API_KEY", "ANTHROPIC_API_KEY", "QLOO_API_BASE_URL", "QLOO_CALL_SPACING_MS"] as const;

const previous: Record<string, string | undefined> = {};

function snapshotEnv(): void {
  for (const key of KEYS) previous[key] = process.env[key];
}

function restoreEnv(): void {
  for (const key of KEYS) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  resetAdmission();
  resetSpend();
  resetMetrics();
  resetLifecycle();
}

function publicEnv(): void {
  process.env.CE_PUBLIC_DEPLOYMENT = "1";
  process.env.CE_INTERNAL_API_SECRET = SECRET;
  process.env.CE_SPEND_BUDGET_USD = "20";
  process.env.CE_INVESTIGATION_RESERVE_USD = "1";
  process.env.CE_ACCEPT_INVESTIGATIONS = "1";
  // Sprint 9J: a public paid dispatch also needs the scoped operator credential.
  process.env.CE_PAID_OPERATOR_TOKEN = PAID_OPERATOR;
  process.env.CE_PAID_OPERATOR_EXPIRES_AT = PAID_EXPIRY;
  resetLifecycle();
}

function auth(visitor = "visitor-aaaaaaaaaaaaaa01"): Record<string, string> {
  return { "x-ce-internal-auth": SECRET, "x-ce-visitor": visitor, "x-ce-paid-operator": PAID_OPERATOR };
}

function completed(): QueryResponse {
  return {
    schemaVersion: "ce-query/0.1",
    queryId: "00000000-0000-4000-8000-0000000000aa",
    state: "INVESTIGATION_INCOMPLETE",
    interpretation: null,
    reasons: [],
    handoff: null,
    supportedAlternative: null,
    context: null,
    investigation: null,
    territories: [],
    nextOperations: [],
    telemetry: {
      queryId: "00000000-0000-4000-8000-0000000000aa",
      schemaVersion: "ce-query/0.1",
      intent: null,
      secondaryIntents: [],
      explicitFields: [],
      inheritedFieldNames: [],
      clarificationRequired: false,
      validationOutcome: null,
      selectedCapability: null,
      routingOutcome: "INVESTIGATION_INCOMPLETE",
      parentRunId: null,
      childRunId: null,
      interpretationLatencyMs: 12,
      interpretationTokens: { input: 20, output: 8 },
      interpretationCostUsd: 0.0001,
      repairAttempts: 0,
      executionHandOffStatus: "NOT_ATTEMPTED",
      errorCodes: [],
      queryChars: 0,
      queryHash: "abc",
    },
  };
}

function server() {
  const runtime = new AgentRuntime({ model: new BaselinePolicyModel(), provider: scripted(), store: new RunStore() });
  return buildApp({
    logLevel: "silent",
    agentRuntimeFactory: () => runtime,
    queryInterpreterFactory: () => new ScriptedQueryInterpreter(() => proposal({ primaryIntent: "explore_frontier", brandsNamed: ["Northwind Atelier"] })),
  });
}

async function stopJob(app: ReturnType<typeof buildApp>, response: { statusCode: number; json: () => { jobId?: string; accessToken?: string } }, headers: Record<string, string>) {
  if (response.statusCode !== 202) return;
  const body = response.json();
  if (!body.jobId || !body.accessToken) return;
  await app.inject({ method: "POST", url: `/api/agent/jobs/${body.jobId}/cancel`, headers: { ...headers, "x-job-token": body.accessToken } });
}

snapshotEnv();
afterEach(restoreEnv);

// Sprint 9J: a public runtime with a paid operator needs a durable run ledger; these tests use a SYNTHETIC one.
beforeEach(() => setRunLedgerForTests(memoryRunLedger()));
afterEach(() => setRunLedgerForTests(undefined));

describe("production configuration", () => {
  it("requires explicit opt-in to permit paid investigations in every runtime", () => {
    for (const value of [undefined, "", "0", "true", "false", "on", "1 "]) {
      expect(investigationsAccepted(value === undefined ? {} : { CE_ACCEPT_INVESTIGATIONS: value })).toBe(false);
    }
    expect(investigationsAccepted({ CE_ACCEPT_INVESTIGATIONS: "1" })).toBe(true);
    expect(investigationsAccepted({ CE_PUBLIC_DEPLOYMENT: "1" })).toBe(false);
    expect(investigationsAccepted({ CE_PUBLIC_DEPLOYMENT: "1", CE_ACCEPT_INVESTIGATIONS: "1" })).toBe(true);
  });

  it("rejects an otherwise authorized job when the admission flag is omitted", async () => {
    publicEnv();
    delete process.env.CE_ACCEPT_INVESTIGATIONS;
    resetLifecycle();
    resetSpend();
    const app = server();
    const reply = await app.inject({ method: "POST", url: "/api/agent/jobs", headers: auth(), payload: { query: "Where could Northwind Atelier expand?" } });
    expect(reply.statusCode).toBe(503);
    expect(reply.json().error).toBe("admissions_paused");
    await app.close();
  });

  it("fails closed when public budget or internal auth is missing", () => {
    const issues = validatePublicRuntime({
      NODE_ENV: "production",
      QLOO_API_KEY: "present",
      ANTHROPIC_API_KEY: "present",
      QLOO_API_BASE_URL: "https://hackathon.api.qloo.com",
    });
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["INTERNAL_AUTH_MISSING", "SPEND_BUDGET_MISSING"]));
    expect(JSON.stringify(issues)).not.toContain("present");
  });

  it("accepts a complete public configuration", () => {
    expect(
      validatePublicRuntime({
        CE_PUBLIC_DEPLOYMENT: "1",
        CE_INTERNAL_API_SECRET: SECRET,
        CE_SPEND_BUDGET_USD: "25",
        QLOO_API_KEY: "present",
        ANTHROPIC_API_KEY: "present",
        QLOO_API_BASE_URL: "https://hackathon.api.qloo.com",
      }),
    ).toEqual([]);
  });

  it("refuses an unsafe Qloo spacing override", () => {
    const issues = validatePublicRuntime({
      CE_PUBLIC_DEPLOYMENT: "1",
      CE_INTERNAL_API_SECRET: SECRET,
      CE_SPEND_BUDGET_USD: "25",
      QLOO_API_KEY: "present",
      ANTHROPIC_API_KEY: "present",
      QLOO_API_BASE_URL: "https://hackathon.api.qloo.com",
      QLOO_CALL_SPACING_MS: "100",
    });
    expect(issues.map((issue) => issue.code)).toContain("QLOO_SPACING_UNSAFE");
  });
});

describe("health and readiness", () => {
  it("keeps liveness separate from readiness", async () => {
    process.env.CE_ACCEPT_INVESTIGATIONS = "0";
    resetLifecycle();
    const app = buildApp({ logLevel: "silent" });
    const live = await app.inject({ method: "GET", url: "/health" });
    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: "ok", service: "cultural-elasticity-api" });
    const ready = await app.inject({ method: "GET", url: "/ready" });
    expect(ready.statusCode).toBe(503);
    expect(ready.json().reasons).toContain("ADMISSIONS_PAUSED");
    expect(JSON.stringify(ready.json())).not.toMatch(/sk-ant-|QLOO_API_KEY=|ANTHROPIC/);
    await app.close();
  });

  it("does not treat missing credentials as a paid probe", () => {
    const body = readiness({ CE_PUBLIC_DEPLOYMENT: "1" });
    expect(body.dependencies.qlooTransportInitialized).toBe(false);
    expect(body.reasons).toEqual(expect.arrayContaining(["MISSING_QLOO_CREDENTIAL", "MISSING_MODEL_CREDENTIAL"]));
  });
});

describe("spend ledger", () => {
  it("reserves a conservative maximum and refuses when the budget cannot cover it", () => {
    const ledger = new SpendLedger({ CE_PUBLIC_DEPLOYMENT: "1", CE_SPEND_BUDGET_USD: "0.2", CE_INVESTIGATION_RESERVE_USD: "0.5" });
    const first = ledger.reserve("job-a");
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.code).toBe("budget_exhausted");
  });

  it("fails closed when a public budget is missing", () => {
    const ledger = new SpendLedger({ CE_PUBLIC_DEPLOYMENT: "1" });
    const reserved = ledger.reserve();
    expect(reserved.ok).toBe(false);
    if (!reserved.ok) expect(reserved.code).toBe("budget_unavailable");
  });

  it("reconciles observed usage and records missing provider usage as consumed reserve", () => {
    const ledger = new SpendLedger({ CE_SPEND_BUDGET_USD: "5", CE_INVESTIGATION_RESERVE_USD: "1" });
    const first = ledger.reserve("a");
    const second = ledger.reserve("b");
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    ledger.markStarted(first.reservation.id);
    ledger.settle(first.reservation.id, { observedUsd: 0.12, started: true });
    ledger.settle(second.reservation.id, { observedUsd: null, started: true });
    const snap = ledger.snapshot();
    expect(snap.consumedUsd).toBeCloseTo(1.12, 5);
    expect(snap.uncertaintyCounts.provider_usage_missing).toBe(1);
    expect(snap.durable).toBe(false);
    expect(snap.multiInstanceSafe).toBe(false);
  });

  it("releases a reservation that never started", () => {
    const ledger = new SpendLedger({ CE_SPEND_BUDGET_USD: "5", CE_INVESTIGATION_RESERVE_USD: "1" });
    const reserved = ledger.reserve();
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    ledger.settle(reserved.reservation.id, { observedUsd: null, started: false, cancelledBeforeStart: true });
    expect(ledger.snapshot().consumedUsd).toBe(0);
    expect(ledger.snapshot().availableUsd).toBe(5);
  });

  it("uses the dated conservative reserve when no override is set", () => {
    expect(conservativeReserveUsd({})).toBeGreaterThan(0);
  });
});

describe("proxy trust and admission", () => {
  it("never treats forwarded headers as an admission key", () => {
    expect(verifyInternalAuth({ "x-forwarded-for": "8.8.8.8" }, { CE_PUBLIC_DEPLOYMENT: "1", CE_INTERNAL_API_SECRET: SECRET })).toBe(false);
    const visitor = admitVisitor({ "x-forwarded-for": "8.8.8.8", "x-ce-visitor": "visitor-bbbbbbbbbbbbbb02" }, true);
    expect(visitor).toEqual({ visitorId: "visitor-bbbbbbbbbbbbbb02", attributed: true });
    expect(admitVisitor({ "x-forwarded-for": "8.8.8.8" }, true).visitorId).toBe("unattributed");
  });

  it("rejects direct backend job creation without internal auth", async () => {
    publicEnv();
    const app = server();
    const forged = await app.inject({
      method: "POST",
      url: "/api/agent/jobs",
      headers: { "x-forwarded-for": "203.0.113.9", "x-real-ip": "203.0.113.9" },
      payload: { query: "Where could Northwind Atelier expand?" },
    });
    expect(forged.statusCode).toBe(401);
    await app.close();
  });

  it("attributes visitors separately after a verified frontend hop", async () => {
    publicEnv();
    process.env.CE_JOB_CREATE_LIMIT = "1";
    resetAdmission();
    const app = server();
    const firstHeaders = auth("visitor-cccccccccccccccc01");
    const otherHeaders = auth("visitor-dddddddddddddddd01");
    const first = await app.inject({ method: "POST", url: "/api/agent/jobs", headers: firstHeaders, payload: { query: "Where could Northwind Atelier expand?" } });
    const second = await app.inject({ method: "POST", url: "/api/agent/jobs", headers: firstHeaders, payload: { query: "Where could Northwind Atelier expand?" } });
    const other = await app.inject({ method: "POST", url: "/api/agent/jobs", headers: otherHeaders, payload: { query: "Where could Northwind Atelier expand?" } });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(429);
    expect(other.statusCode).toBe(202);
    await stopJob(app, first, firstHeaders);
    await stopJob(app, other, otherHeaders);
    await app.close();
  });

  it("enforces the global create ceiling across visitors", async () => {
    publicEnv();
    process.env.CE_JOB_CREATE_LIMIT = "10";
    process.env.CE_GLOBAL_JOB_LIMIT = "1";
    resetAdmission();
    const app = server();
    const firstHeaders = auth("visitor-eeeeeeeeeeeeeeee01");
    const first = await app.inject({ method: "POST", url: "/api/agent/jobs", headers: firstHeaders, payload: { query: "Where could Northwind Atelier expand?" } });
    const second = await app.inject({ method: "POST", url: "/api/agent/jobs", headers: auth("visitor-ffffffffffffffff01"), payload: { query: "Where could Northwind Atelier expand?" } });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(429);
    await stopJob(app, first, firstHeaders);
    await app.close();
  });
});

describe("public execution safety", () => {
  it("closes synchronous expensive routes and the baseline", async () => {
    publicEnv();
    const app = server();
    const headers = auth();
    expect((await app.inject({ method: "POST", url: "/api/agent/query", headers, payload: { query: "Where next?" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/agent/follow-up", headers, payload: { query: "Go deeper", context: { runId: "00000000-0000-4000-8000-000000000001" } } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/agent/interpret", headers, payload: { query: "Where next?" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/agent/analyze", headers, payload: { query: "Where next?" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/agent/jobs", headers, payload: { query: "Where next?", model: "baseline" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/methodology/analyze", payload: {} })).statusCode).toBe(404);
    await app.close();
  });

  it("rejects an over-budget public job and a paused admission switch", async () => {
    publicEnv();
    process.env.CE_SPEND_BUDGET_USD = "0.2";
    process.env.CE_INVESTIGATION_RESERVE_USD = "1";
    resetSpend();
    const app = server();
    const over = await app.inject({ method: "POST", url: "/api/agent/jobs", headers: auth(), payload: { query: "Where could Northwind Atelier expand?" } });
    expect(over.statusCode).toBe(429);
    expect(over.json().error).toBe("budget_exhausted");
    await app.close();
    process.env.CE_SPEND_BUDGET_USD = "20";
    process.env.CE_ACCEPT_INVESTIGATIONS = "0";
    resetSpend();
    resetLifecycle();
    const paused = server();
    const refused = await paused.inject({ method: "POST", url: "/api/agent/jobs", headers: auth("visitor-gggggggggggggggg01"), payload: { query: "Where could Northwind Atelier expand?" } });
    expect(refused.statusCode).toBe(503);
    expect(refused.json().error).toBe("admissions_paused");
    await paused.close();
  });

  it("hides operator status without a token and never prints secrets", async () => {
    publicEnv();
    process.env.CE_OPERATOR_TOKEN = OPERATOR;
    const app = server();
    expect((await app.inject({ method: "GET", url: "/ops/status" })).statusCode).toBe(404);
    const ok = await app.inject({ method: "GET", url: "/ops/status", headers: { "x-ce-operator": OPERATOR } });
    expect(ok.statusCode).toBe(200);
    expect(JSON.stringify(ok.json())).not.toContain(SECRET);
    expect(JSON.stringify(ok.json())).not.toContain(OPERATOR);
    expect(ok.json().spend.durable).toBe(false);
    await app.close();
  });
});

describe("job lifecycle", () => {
  it("keeps prepared findings when the time limit fires", async () => {
    const jobs = new JobManager({
      maxRunMs: 20,
      runnerFor: () => ({
        execute: async (_body, hooks) => {
          await new Promise<void>((resolve) => hooks?.signal?.addEventListener("abort", () => resolve(), { once: true }));
          return completed();
        },
        confirm: async () => completed(),
        continueRun: async () => completed(),
      }),
    });
    const created = jobs.create({ kind: "execute", model: "auto", body: { query: "Where next?" } });
    await new Promise((resolve) => setTimeout(resolve, 60));
    const view = jobs.get(created.jobId, created.accessToken);
    expect(view?.status).toBe("completed");
    expect(view?.error?.code).toBe("INVESTIGATION_TIMEOUT");
    expect(view?.response?.state).toBe("INVESTIGATION_INCOMPLETE");
    expect(view?.error?.message).toMatch(/not evidence against a territory/u);
  });

  it("does not let a wrong token read a job, and shutdown is not unsupported evidence", async () => {
    let resolveRun: (value: QueryResponse) => void = () => {};
    const gate = new Promise<QueryResponse>((resolve) => {
      resolveRun = resolve;
    });
    const jobs = new JobManager({
      runnerFor: () => ({ execute: () => gate, confirm: async () => completed(), continueRun: async () => completed() }),
    });
    const created = jobs.create({ kind: "execute", model: "auto", body: { query: "Keep going." } });
    expect(jobs.get(created.jobId, "not-the-token")).toBeNull();
    jobs.shutdown();
    const view = jobs.get(created.jobId, created.accessToken);
    expect(view?.status === "running" || view?.error?.code === "BACKEND_RESTART").toBe(true);
    resolveRun(completed());
    await gate;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const finished = jobs.get(created.jobId, created.accessToken);
    expect(finished?.error?.code === "BACKEND_RESTART" || finished?.status === "failed" || finished?.status === "cancelled").toBe(true);
    expect(finished?.error?.message ?? "").not.toMatch(/unsupported/iu);
  });

  it("rejects a cancelled job token after expiry as gone", async () => {
    let clock = 1_000;
    let resolveRun: (value: QueryResponse) => void = () => {};
    const gate = new Promise<QueryResponse>((resolve) => {
      resolveRun = resolve;
    });
    const jobs = new JobManager({
      now: () => clock,
      ttlMs: 50,
      maxRunMs: 5_000,
      runnerFor: () => ({ execute: () => gate, confirm: async () => completed(), continueRun: async () => completed() }),
    });
    const created = jobs.create({ kind: "execute", model: "auto", body: { query: "Stop." } });
    expect(jobs.cancel(created.jobId, created.accessToken)?.stopping).toBe(true);
    resolveRun(completed());
    await gate;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(jobs.get(created.jobId, created.accessToken)?.status).toBe("cancelled");
    clock += 80;
    expect(jobs.get(created.jobId, created.accessToken)?.status).toBe("expired");
  });
});

describe("recorded example provenance", () => {
  it("validates the published artifact without provider secrets", () => {
    const artifact = JSON.parse(readFileSync(new URL("../../frontend/src/demo/recorded-example.json", import.meta.url), "utf8")) as {
      kind: string;
      recordedAt: string;
      evidenceOrigin: string;
      sourceSha256: string;
      note: string;
      responses: QueryResponse[];
    };
    const meta = JSON.parse(readFileSync(new URL("../../frontend/src/demo/recorded-example.meta.json", import.meta.url), "utf8")) as {
      kind: string;
      sourceSha256: string;
      recordedAt: string;
    };
    expect(artifact.kind).toBe("RECORDED_EXAMPLE");
    expect(meta.kind).toBe("RECORDED_EXAMPLE");
    expect(artifact.sourceSha256).toBe(meta.sourceSha256);
    expect(artifact.recordedAt).toBe(meta.recordedAt);
    expect(artifact.evidenceOrigin).toBe("live");
    expect(artifact.note).toMatch(/does not call a provider/iu);
    expect(JSON.stringify(artifact)).not.toMatch(/sk-ant-|QLOO_API_KEY|ANTHROPIC_API_KEY|authorization/iu);
    expect(artifact.responses.length).toBeGreaterThan(0);
    expect(artifact.responses[0]?.state).toBe("INVESTIGATION_INCOMPLETE");
    const child = artifact.responses[1];
    expect(child?.state).toBe("INVESTIGATION_COMPLETED");
    const childResult = child?.investigation?.result;
    expect(childResult && childResult.status !== "NEEDS_INPUT" ? childResult.territories[0]?.evidenceStatus : null).toBe("PARTIAL_EVIDENCE");
    expect(childResult && childResult.status !== "NEEDS_INPUT" ? childResult.territories[0]?.analysisRoute : null).toBe("PARTIAL_CULTURAL_ANALYSIS");
    for (const response of artifact.responses) {
      expect(parseQueryResponse(response).ok).toBe(true);
      expect(response.interpretation?.interpretationWarnings).toContain("RECORDED_EXAMPLE");
    }
  });
});

describe("queue saturation", () => {
  it("refuses a third investigation when one is running and the queue is full", () => {
    let resolveRun: (value: QueryResponse) => void = () => {};
    const gate = new Promise<QueryResponse>((resolve) => {
      resolveRun = resolve;
    });
    const jobs = new JobManager({
      maxRunning: 1,
      maxQueued: 1,
      runnerFor: () => ({ execute: () => gate, confirm: async () => completed(), continueRun: async () => completed() }),
    });
    jobs.create({ kind: "execute", model: "auto", body: { query: "One." } });
    jobs.create({ kind: "execute", model: "auto", body: { query: "Two." } });
    expect(() => jobs.create({ kind: "execute", model: "auto", body: { query: "Three." } })).toThrow(/Too many investigations/u);
    resolveRun(completed());
  });
});
