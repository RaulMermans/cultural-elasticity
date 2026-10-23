/** Sprint 7B: production-mode HTTP boundaries. SYNTHETIC. No live Qloo or Haiku. */
import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app.js";
import { resetAdmission } from "../src/api/admission.js";
import { BaselinePolicyModel } from "../src/agent/model/baseline.js";
import { ScriptedQueryInterpreter } from "../src/agent/query/interpreter.js";
import { RunStore } from "../src/agent/run-store.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { resetLifecycle } from "../src/ops/lifecycle.js";
import { resetMetrics } from "../src/ops/metrics.js";
import { resetProviderConnectivity, setProviderProbes } from "../src/ops/providers.js";
import { resetSpend } from "../src/ops/spend.js";
import { proposal } from "../scripts/synthetic/query-proposals.js";
import { scripted } from "./fixtures/synthetic/agent.js";

const SECRET = "ce-public-internal-auth-secret-32ch";
const OPERATOR = "ce-operator-token-value-32chars-xx";
const KEYS = [
  "CE_PUBLIC_DEPLOYMENT",
  "CE_INTERNAL_API_SECRET",
  "CE_SPEND_BUDGET_USD",
  "CE_INVESTIGATION_RESERVE_USD",
  "CE_ACCEPT_INVESTIGATIONS",
  "CE_OPERATOR_TOKEN",
  "QLOO_API_KEY",
  "ANTHROPIC_API_KEY",
  "QLOO_API_BASE_URL",
] as const;
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
  resetProviderConnectivity();
}

function publicEnv(): void {
  process.env.CE_PUBLIC_DEPLOYMENT = "1";
  process.env.CE_INTERNAL_API_SECRET = SECRET;
  process.env.CE_SPEND_BUDGET_USD = "20";
  process.env.CE_INVESTIGATION_RESERVE_USD = "1";
  process.env.CE_ACCEPT_INVESTIGATIONS = "1";
  process.env.CE_OPERATOR_TOKEN = OPERATOR;
  process.env.QLOO_API_KEY = "present";
  process.env.ANTHROPIC_API_KEY = "present";
  process.env.QLOO_API_BASE_URL = "https://hackathon.api.qloo.com";
}

function app() {
  const runtime = new AgentRuntime({ model: new BaselinePolicyModel(), provider: scripted(), store: new RunStore() });
  return buildApp({
    logLevel: "silent",
    agentRuntimeFactory: () => runtime,
    queryInterpreterFactory: () => new ScriptedQueryInterpreter(() => proposal({ primaryIntent: "explore_frontier", brandsNamed: ["Northwind Atelier"] })),
  });
}

async function listen() {
  const instance = app();
  await instance.listen({ host: "127.0.0.1", port: 0 });
  const address = instance.server.address() as AddressInfo;
  return { instance, origin: `http://127.0.0.1:${address.port}` };
}

snapshotEnv();
afterEach(restoreEnv);

describe("production HTTP integration", () => {
  it("serves liveness, admission readiness, and refuses a direct unauthenticated job", async () => {
    publicEnv();
    resetLifecycle();
    resetSpend();
    const { instance, origin } = await listen();
    try {
      const health = await fetch(`${origin}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: "ok", service: "cultural-elasticity-api" });
      const ready = await fetch(`${origin}/ready`);
      expect(ready.status).toBe(200);
      const readyBody = (await ready.json()) as { semantics: { providerConnectivity: string; admission: string } };
      expect(readyBody.semantics.admission).toBe("ready");
      expect(readyBody.semantics.providerConnectivity).toBe("not_verified_by_this_endpoint");
      const unauth = await fetch(`${origin}/api/agent/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
        body: JSON.stringify({ query: "Where could Northwind Atelier expand?" }),
      });
      expect(unauth.status).toBe(401);
    } finally {
      await instance.close();
    }
  });

  it("creates, polls, cancels, and recovers after the process is gone", async () => {
    publicEnv();
    resetLifecycle();
    resetSpend();
    const { instance, origin } = await listen();
    const auth = {
      "x-ce-internal-auth": SECRET,
      "x-ce-visitor": "visitor-http-7b-aaaaaa01",
    };
    try {
      const created = await fetch(`${origin}/api/agent/jobs`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ query: "Where could Northwind Atelier expand?" }),
      });
      expect(created.status).toBe(202);
      const job = (await created.json()) as { jobId: string; accessToken: string };
      const wrong = await fetch(`${origin}/api/agent/jobs/${job.jobId}`, { headers: { ...auth, "x-job-token": "not-the-token" } });
      expect(wrong.status).toBe(404);
      const cancel = await fetch(`${origin}/api/agent/jobs/${job.jobId}/cancel`, {
        method: "POST",
        headers: { ...auth, "x-job-token": job.accessToken },
      });
      expect([200, 202, 404].includes(cancel.status)).toBe(true);
      await instance.close();
      await expect(fetch(`${origin}/health`)).rejects.toThrow();
      const restarted = await listen();
      try {
        const missing = await fetch(`${restarted.origin}/api/agent/jobs/${job.jobId}`, {
          headers: { ...auth, "x-job-token": job.accessToken },
        });
        expect(missing.status).toBe(404);
        const body = (await missing.json()) as { error: string; message: string };
        expect(body.error).toBe("job_not_found");
        expect(body.message).not.toMatch(/unsupported/iu);
      } finally {
        await restarted.instance.close();
      }
    } catch (error) {
      await instance.close().catch(() => undefined);
      throw error;
    }
  });

  it("rejects an exhausted budget over HTTP and keeps operator status off the public surface", async () => {
    publicEnv();
    process.env.CE_SPEND_BUDGET_USD = "0.2";
    process.env.CE_INVESTIGATION_RESERVE_USD = "1";
    resetLifecycle();
    resetSpend();
    const { instance, origin } = await listen();
    try {
      const over = await fetch(`${origin}/api/agent/jobs`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ce-internal-auth": SECRET,
          "x-ce-visitor": "visitor-http-7b-bbbbbb01",
        },
        body: JSON.stringify({ query: "Where could Northwind Atelier expand?" }),
      });
      expect(over.status).toBe(429);
      expect(((await over.json()) as { error: string }).error).toBe("budget_exhausted");
      expect((await fetch(`${origin}/ops/status`)).status).toBe(404);
      const ops = await fetch(`${origin}/ops/status`, { headers: { "x-ce-operator": OPERATOR } });
      expect(ops.status).toBe(200);
      const snapshot = (await ops.json()) as { spend: { durable: boolean }; providerConnectivity: { qloo: { status: string } } };
      expect(snapshot.spend.durable).toBe(false);
      expect(snapshot.providerConnectivity.qloo.status).toBe("not_probed");
    } finally {
      await instance.close();
    }
  });

  it("records a stubbed operator provider probe without changing /ready semantics", async () => {
    publicEnv();
    resetLifecycle();
    setProviderProbes({
      qloo: async () => ({ ok: true, detail: "stub" }),
      haiku: async () => ({ ok: true, detail: "stub" }),
    });
    const { instance, origin } = await listen();
    try {
      const probed = await fetch(`${origin}/ops/providers/probe`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-ce-operator": OPERATOR },
        body: JSON.stringify({ providers: ["qloo", "haiku"] }),
      });
      expect(probed.status).toBe(200);
      const ready = await fetch(`${origin}/ready`);
      const body = (await ready.json()) as { semantics: { providerConnectivity: string } };
      expect(body.semantics.providerConnectivity).toBe("not_verified_by_this_endpoint");
    } finally {
      await instance.close();
    }
  });
});
