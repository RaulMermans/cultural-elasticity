/**
 * P0 hotfix: a request that never begins an executable investigation consumes no public investigation unit.
 * SYNTHETIC world, scripted interpreter (a fixed proposal per test question, validated like a model's), baseline policy,
 * in-memory run ledger: no provider call. The brand and artist names are only the user's words in a synthetic proposal.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startedNewInvestigation } from "@cultural-elasticity/shared";
import { buildApp } from "../src/app.js";
import { BaselinePolicyModel } from "../src/agent/model/baseline.js";
import { ScriptedQueryInterpreter, type InterpretInput } from "../src/agent/query/interpreter.js";
import { RunStore } from "../src/agent/run-store.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { resetAdmission } from "../src/api/admission.js";
import { publicEvaluationQuota } from "../src/config/production.js";
import { resetLifecycle } from "../src/ops/lifecycle.js";
import { setRunLedgerForTests } from "../src/ops/run-ledger.js";
import { resetSpend, spendLedger } from "../src/ops/spend.js";
import { named, proposal } from "../scripts/synthetic/query-proposals.js";
import { scripted } from "./fixtures/synthetic/agent.js";
import { memoryRunLedger } from "./fixtures/synthetic/run-ledger.js";

const SECRET = "ce-synthetic-internal-auth-secret-hotfix";
const PAID = "ce-synthetic-paid-operator-token-hotfix-xx";
const FUTURE = "2999-01-01T00:00:00Z";
const NETWORK = "c".repeat(32);
const KEYS = [
  "CE_PUBLIC_DEPLOYMENT", "CE_INTERNAL_API_SECRET", "CE_ACCEPT_INVESTIGATIONS", "CE_SPEND_BUDGET_USD", "CE_INVESTIGATION_RESERVE_USD",
  "CE_PAID_OPERATOR_TOKEN", "CE_PAID_OPERATOR_EXPIRES_AT", "QLOO_API_KEY", "ANTHROPIC_API_KEY", "QLOO_API_BASE_URL",
  "CE_PUBLIC_EVALUATION", "CE_PUBLIC_EVALUATION_ID", "CE_PUBLIC_EVALUATION_EXPIRES_AT", "CE_PUBLIC_QUOTA_INVESTIGATIONS", "CE_PUBLIC_QUOTA_QUESTIONS", "DATABASE_URL",
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

// SYNTHETIC proposals, as a model would return them for each test question.
const BRIDGE = "What connects Loewe with BLACKPINK?";
const UNCLEAR = "What about that one?";
const SUPPORTED = "Could Northwind Atelier move into boutique stays?";
function answer({ query }: InterpretInput) {
  if (query === BRIDGE) return proposal({ primaryIntent: "bridge_builder", brandsNamed: ["Loewe"], territories: named("BLACKPINK") });
  if (query === UNCLEAR) return proposal({ primaryIntent: "clarify_reference", unresolvedReferences: ["that one"], clarificationQuestion: "Which brand or territory do you mean?" });
  return proposal({ primaryIntent: "analyze_move", brandsNamed: ["Northwind Atelier"], territories: named("Boutique Stays") });
}

function harness(env: Record<string, string> = {}) {
  Object.assign(process.env, {
    CE_PUBLIC_DEPLOYMENT: "1", CE_INTERNAL_API_SECRET: SECRET, CE_PUBLIC_EVALUATION: "1", CE_PUBLIC_EVALUATION_ID: "syn-eval-hotfix", CE_PUBLIC_EVALUATION_EXPIRES_AT: FUTURE,
    CE_ACCEPT_INVESTIGATIONS: "1", CE_SPEND_BUDGET_USD: "5", CE_INVESTIGATION_RESERVE_USD: "0.5",
    QLOO_API_KEY: "present", ANTHROPIC_API_KEY: "present", QLOO_API_BASE_URL: "https://hackathon.api.qloo.com",
    ...env,
  });
  resetLifecycle();
  resetSpend();
  resetAdmission();
  const runtime = new AgentRuntime({ model: new BaselinePolicyModel(), provider: scripted(), store: new RunStore() });
  const app = buildApp({ logLevel: "silent", agentRuntimeFactory: () => runtime, queryInterpreterFactory: () => new ScriptedQueryInterpreter(answer) });
  const headers = (extra: Record<string, string> = {}) => ({ "x-ce-internal-auth": SECRET, "x-ce-visitor": "visitor-hotfix-aaaaaa01", "x-ce-network": NETWORK, ...extra });
  const ask = (query: string, extra: Record<string, string> = {}) => app.inject({ method: "POST", url: "/api/agent/jobs", headers: headers(extra), payload: { query } });
  async function settle(created: { jobId: string; accessToken: string }) {
    for (let i = 0; i < 400; i += 1) {
      const view = (await app.inject({ method: "GET", url: `/api/agent/jobs/${created.jobId}`, headers: headers({ "x-job-token": created.accessToken }) })).json();
      if (["completed", "failed", "cancelled", "expired"].includes(view.status)) {
        await new Promise((resolve) => setTimeout(resolve, 20)); // the unit is returned right after the terminal event
        return view;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("job did not finish");
  }
  const used = (kind: "investigation" | "question") => ledger.quotas.get(`${kind}:${NETWORK}`)?.used ?? 0;
  return { app, ask, settle, used };
}

describe("P0: investigation units pay only for an investigation that starts", () => {
  it("LOEWE × BLACKPINK is unsupported (bridge_builder) and costs no investigation unit; the spend hold is released", async () => {
    const h = harness({ CE_PUBLIC_QUOTA_INVESTIGATIONS: "12" });
    const created = await h.ask(BRIDGE);
    expect(created.statusCode, created.body).toBe(202);
    const view = await h.settle(created.json());
    expect(view.response.state).toBe("UNSUPPORTED_OPERATION");
    expect(view.response.investigation).toBeNull();
    expect(view.response.reasons.map((r: { code: string }) => r.code)).toContain("UNSUPPORTED_OPERATION");
    expect(h.used("investigation")).toBe(0);
    expect(h.used("question")).toBe(1);
    expect(spendLedger().snapshot().reservedUsd).toBe(0);
    await h.app.close();
  });

  it("a clarification costs no investigation unit", async () => {
    const h = harness();
    const view = await h.settle((await h.ask(UNCLEAR)).json());
    expect(view.response.state).toBe("NEEDS_CLARIFICATION");
    expect(h.used("investigation")).toBe(0);
    await h.app.close();
  });

  it("a supported investigation that starts costs exactly one unit, which stays used", async () => {
    const h = harness();
    const view = await h.settle((await h.ask(SUPPORTED)).json());
    expect(view.response.investigation).not.toBeNull();
    expect(startedNewInvestigation(view.response)).toBe(true);
    expect(h.used("investigation")).toBe(1);
    await h.app.close();
  });

  it("definition of done: with one unit left, an unsupported question keeps it and the next supported question runs", async () => {
    const h = harness({ CE_PUBLIC_QUOTA_INVESTIGATIONS: "1" });
    await h.settle((await h.ask(BRIDGE)).json());
    expect(h.used("investigation")).toBe(0);
    const supported = await h.ask(SUPPORTED);
    expect(supported.statusCode, supported.body).toBe(202);
    await h.settle(supported.json());
    expect(h.used("investigation")).toBe(1);
    const after = await h.ask(SUPPORTED);
    expect(after.statusCode).toBe(429);
    expect(after.json()).toMatchObject({ error: "visitor_quota_reached" });
    await h.app.close();
  });

  it("interpretation stays bounded: question units are never returned, and a question refusal holds nothing", async () => {
    const h = harness({ CE_PUBLIC_QUOTA_INVESTIGATIONS: "4", CE_PUBLIC_QUOTA_QUESTIONS: "2" });
    for (let i = 0; i < 2; i += 1) await h.settle((await h.ask(BRIDGE)).json());
    const third = await h.ask(BRIDGE);
    expect(third.statusCode).toBe(429);
    expect(third.json()).toMatchObject({ error: "visitor_quota_reached" });
    expect(h.used("question")).toBe(2);
    expect(h.used("investigation")).toBe(0);
    expect(spendLedger().snapshot().reservedUsd).toBe(0);
    await h.app.close();
  });

  it("an investigation refusal returns the question unit it took", async () => {
    const h = harness({ CE_PUBLIC_QUOTA_INVESTIGATIONS: "1" });
    ledger.quotas.set(`investigation:${NETWORK}`, { limit: 1, used: 1 });
    const refused = await h.ask(SUPPORTED);
    expect(refused.statusCode).toBe(429);
    expect(h.used("question")).toBe(0);
    await h.app.close();
  });

  it("concurrent requests cannot overrun the investigation quota", async () => {
    const h = harness({ CE_PUBLIC_QUOTA_INVESTIGATIONS: "2" });
    const results = await Promise.all(Array.from({ length: 6 }, () => h.ask(SUPPORTED)));
    expect(results.filter((r) => r.statusCode === 202)).toHaveLength(2);
    expect(results.filter((r) => r.statusCode === 429)).toHaveLength(4);
    for (const r of results.filter((x) => x.statusCode === 202)) await h.settle(r.json());
    expect(h.used("investigation")).toBe(2);
    await h.app.close();
  });

  it("an operator is never quota-counted, and nothing is returned to a ledger it did not take from", async () => {
    const h = harness({ CE_PAID_OPERATOR_TOKEN: PAID, CE_PAID_OPERATOR_EXPIRES_AT: FUTURE });
    await h.settle((await h.ask(BRIDGE, { "x-ce-paid-operator": PAID })).json());
    expect(ledger.quotas.get(`investigation:${NETWORK}`)).toBeUndefined();
    expect(ledger.quotas.get(`question:${NETWORK}`)).toBeUndefined();
    await h.app.close();
  });

  it("the shared predicate: returning to an existing run, or no run at all, is not a new investigation; unknown is", () => {
    expect(startedNewInvestigation({ investigation: null })).toBe(false);
    expect(startedNewInvestigation({ investigation: { runId: "r", reused: true, link: null, result: null } })).toBe(false);
    expect(startedNewInvestigation({ investigation: { runId: "r", reused: false, link: null, result: null } })).toBe(true);
    expect(startedNewInvestigation(null)).toBe(true);
  });

  it("question quota defaults to three per investigation and can be set explicitly", () => {
    expect(publicEvaluationQuota("question", { CE_PUBLIC_QUOTA_INVESTIGATIONS: "12" })).toBe(36);
    expect(publicEvaluationQuota("question", { CE_PUBLIC_QUOTA_INVESTIGATIONS: "12", CE_PUBLIC_QUOTA_QUESTIONS: "20" })).toBe(20);
  });
});
