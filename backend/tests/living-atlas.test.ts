/** Sprint 5B.2: response validation, in-process jobs, and cancellation (SYNTHETIC world). */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetLifecycle } from "../src/ops/lifecycle.js";
import { parseQueryResponse } from "@cultural-elasticity/shared";
import { buildApp } from "../src/app.js";
import { BaselinePolicyModel } from "../src/agent/model/baseline.js";
import { JobManager, type InvestigationRunner } from "../src/agent/query/jobs.js";
import { QueryService } from "../src/agent/query/service.js";
import { ScriptedQueryInterpreter, type InterpretInput } from "../src/agent/query/interpreter.js";
import { RunStore } from "../src/agent/run-store.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { proposal, named } from "../scripts/synthetic/query-proposals.js";
import { scripted } from "./fixtures/synthetic/agent.js";
import type { QueryResponse } from "@cultural-elasticity/shared";

// PR #33 made paid investigation admission opt-in (CE_ACCEPT_INVESTIGATIONS=1). These tests exercise behaviour
// behind an open admission, so they opt in explicitly; the fail-closed default is covered by its own tests.
const previousAccept = process.env.CE_ACCEPT_INVESTIGATIONS;
beforeEach(() => {
  process.env.CE_ACCEPT_INVESTIGATIONS = "1";
  resetLifecycle();
});
afterEach(() => {
  if (previousAccept === undefined) delete process.env.CE_ACCEPT_INVESTIGATIONS;
  else process.env.CE_ACCEPT_INVESTIGATIONS = previousAccept;
  resetLifecycle();
});

function harness(answer: (input: InterpretInput) => unknown) {
  const provider = scripted();
  const runtime = new AgentRuntime({ model: new BaselinePolicyModel(), provider, store: new RunStore() });
  const service = new QueryService({ runtime, interpreter: new ScriptedQueryInterpreter(answer) });
  return { service, runtime };
}

describe("query response validation", () => {
  it("accepts a complete synthetic investigation and rejects unknown or coerced statuses", async () => {
    const { service } = harness(() => proposal({ primaryIntent: "analyze_move", brandsNamed: ["Northwind Atelier"], territories: named("Boutique Stays") }));
    const response = await service.execute({ query: "Would Northwind Atelier make sense in boutique stays?" });
    const parsed = parseQueryResponse(response);
    expect(parsed.ok, parsed.ok ? "" : JSON.stringify(parsed.issues)).toBe(true);
    expect(parseQueryResponse({ ...response, state: "SUCCESS" }).ok).toBe(false);
    expect(parseQueryResponse({ ...response, schemaVersion: "ce-query/9.9" }).ok).toBe(false);
    const forged = structuredClone(response);
    forged.territories[0]!.evidenceStatus = "RECOMMENDED" as never;
    expect(parseQueryResponse(forged).ok).toBe(false);
    const equivalent = structuredClone(response);
    equivalent.supportedAlternative = { description: "no", handoff: response.handoff!, equivalent: true as never, confirmQueryId: response.queryId };
    expect(parseQueryResponse(equivalent).ok).toBe(false);
  });

  it("accepts the asynchronous preview without treating it as a finished investigation", async () => {
    const { service } = harness(() => proposal({ primaryIntent: "explore_frontier", brandsNamed: ["Kestrel Outfitters"] }));
    const previews: QueryResponse[] = [];
    const response = await service.execute({ query: "Where could Kestrel Outfitters expand?" }, { onPreview: (value) => { previews.push(value); } });
    expect(previews[0]?.state).toBe("INVESTIGATION_STARTED");
    expect(previews[0]?.investigation).toBeNull();
    expect(parseQueryResponse(previews[0]).ok).toBe(true);
    expect(response.state).toBe("INVESTIGATION_COMPLETED");
    expect(parseQueryResponse(response).ok).toBe(true);
  });
});

describe("investigation jobs", () => {
  function deferred() {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const calls: string[] = [];
    const runner: InvestigationRunner = {
      async execute(_body, hooks) {
        calls.push("execute");
        hooks?.onProgress?.({ phase: "interpreting" });
        await gate;
        if (hooks?.signal?.aborted) return cancelled();
        hooks?.onProgress?.({ phase: "investigating", intent: "explore_frontier" });
        return completed();
      },
      async confirm(_id, hooks) {
        calls.push("confirm");
        await gate;
        if (hooks?.signal?.aborted) return cancelled();
        return completed();
      },
      async continueRun() {
        calls.push("continue");
        return completed();
      },
    };
    return { runner, calls, release: () => release?.() };
  }

  it("returns a handle before the investigation finishes, then the validated result", async () => {
    const { runner, release } = deferred();
    const jobs = new JobManager({ runnerFor: () => runner, maxRunning: 1, maxQueued: 2 });
    const created = jobs.create({ kind: "execute", model: "auto", body: { query: "Where next?" } });
    expect(created.status).toBe("running");
    expect(created.accessToken.length).toBeGreaterThan(20);
    expect(jobs.get(created.jobId, "wrong")).toBeNull();
    expect(jobs.get(created.jobId, created.accessToken)?.stageLabel).toBe("Interpreting question");
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const done = jobs.get(created.jobId, created.accessToken);
    expect(done?.status).toBe("completed");
    expect(done?.response?.state).toBe("INVESTIGATION_COMPLETED");
  });

  it("cancels a queued job without starting it, and stops a running job between turns", async () => {
    const { runner, calls, release } = deferred();
    const jobs = new JobManager({ runnerFor: () => runner, maxRunning: 1, maxQueued: 2 });
    const first = jobs.create({ kind: "execute", model: "auto", body: { query: "first" } });
    const second = jobs.create({ kind: "execute", model: "auto", body: { query: "second" } });
    expect(jobs.get(second.jobId, second.accessToken)?.status).toBe("queued");
    expect(jobs.cancel(second.jobId, second.accessToken)?.status).toBe("cancelled");
    expect(calls).toEqual(["execute"]);
    expect(jobs.cancel(first.jobId, first.accessToken)?.stopping).toBe(true);
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(jobs.get(first.jobId, first.accessToken)?.status).toBe("cancelled");
    expect(calls).toEqual(["execute"]);
  });

  it("bounds concurrency and rejects a second confirmation of the same query", async () => {
    const limited = deferred();
    const jobs = new JobManager({ runnerFor: () => limited.runner, maxRunning: 1, maxQueued: 1 });
    jobs.create({ kind: "execute", model: "auto", body: { query: "a" } });
    jobs.create({ kind: "execute", model: "auto", body: { query: "b" } });
    expect(() => jobs.create({ kind: "execute", model: "auto", body: { query: "c" } })).toThrow(/too many/iu);
    limited.release();
    const confirms = deferred();
    const confirming = new JobManager({ runnerFor: () => confirms.runner, maxRunning: 2, maxQueued: 2 });
    const queryId = "00000000-0000-4000-8000-000000000010";
    confirming.create({ kind: "confirm", model: "auto", queryId });
    expect(() => confirming.create({ kind: "confirm", model: "auto", queryId })).toThrow(/already running/iu);
    confirms.release();
  });

  it("expires a finished job instead of serving its evidence forever", async () => {
    let clock = 1_000;
    const jobs = new JobManager({
      now: () => clock,
      ttlMs: 100,
      maxRunMs: 1_000,
      runnerFor: () => ({ execute: async () => completed(), confirm: async () => completed(), continueRun: async () => completed() }),
    });
    const created = jobs.create({ kind: "execute", model: "auto", body: { query: "Where next?" } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(jobs.get(created.jobId, created.accessToken)?.response?.state).toBe("INVESTIGATION_COMPLETED");
    clock += 500;
    const expired = jobs.get(created.jobId, created.accessToken);
    expect(expired?.status).toBe("expired");
    expect(expired?.response).toBeNull();
    expect(jobs.get(created.jobId, created.accessToken)).toBeNull();
  });
});

describe("job API", () => {
  it("accepts work with 202, hides it behind the token, and shares the query service", async () => {
    const runtime = new AgentRuntime({ model: new BaselinePolicyModel(), provider: scripted(), store: new RunStore() });
    const interpreter = new ScriptedQueryInterpreter(() => proposal({ primaryIntent: "explore_frontier", brandsNamed: ["Northwind Atelier"] }));
    const server = buildApp({ logLevel: "silent", agentRuntimeFactory: () => runtime, queryInterpreterFactory: () => interpreter });
    const created = await server.inject({ method: "POST", url: "/api/agent/jobs", payload: { query: "Where could Northwind Atelier expand?" } });
    expect(created.statusCode).toBe(202);
    const body = created.json() as { jobId: string; accessToken: string };
    expect((await server.inject({ method: "GET", url: `/api/agent/jobs/${body.jobId}` })).statusCode).toBe(404);
    let view: { status: string; response: QueryResponse | null } | null = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const polled = await server.inject({ method: "GET", url: `/api/agent/jobs/${body.jobId}`, headers: { "x-job-token": body.accessToken } });
      view = polled.json();
      if (view?.status === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(view?.status).toBe("completed");
    expect(parseQueryResponse(view?.response).ok).toBe(true);
    expect((await server.inject({ method: "POST", url: "/api/agent/jobs", payload: { query: "" } })).statusCode).toBe(400);
  });
});

function completed(): QueryResponse {
  return {
    schemaVersion: "ce-query/0.1",
    queryId: "00000000-0000-4000-8000-0000000000aa",
    state: "INVESTIGATION_COMPLETED",
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
      routingOutcome: "INVESTIGATION_COMPLETED",
      parentRunId: null,
      childRunId: null,
      interpretationLatencyMs: 0,
      interpretationTokens: { input: 0, output: 0 },
      interpretationCostUsd: null,
      repairAttempts: 0,
      executionHandOffStatus: "NOT_ATTEMPTED",
      errorCodes: [],
      queryChars: 0,
      queryHash: "abc",
    },
  };
}

function cancelled(): QueryResponse {
  return { ...completed(), state: "INVESTIGATION_FAILED", reasons: [{ code: "INVESTIGATION_CANCELLED", detail: "cancelled" }], telemetry: { ...completed().telemetry, routingOutcome: "INVESTIGATION_FAILED" } };
}
