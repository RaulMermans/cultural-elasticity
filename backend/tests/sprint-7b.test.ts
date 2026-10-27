/** Sprint 7B: spend overage, visitor-adjacent backend identity, readiness semantics, runtime spend. SYNTHETIC. */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseQueryResponse, type QueryResponse } from "@cultural-elasticity/shared";
import { buildApp } from "../src/app.js";
import { resetAdmission } from "../src/api/admission.js";
import { readiness } from "../src/api/health.js";
import { BaselinePolicyModel } from "../src/agent/model/baseline.js";
import { ScriptedAgentModel } from "../src/agent/model/scripted.js";
import { ScriptedQueryInterpreter } from "../src/agent/query/interpreter.js";
import { RunStore } from "../src/agent/run-store.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { validatePublicRuntime } from "../src/config/production.js";
import { reconcileLatency } from "../src/ops/latency.js";
import { resetLifecycle } from "../src/ops/lifecycle.js";
import { resetMetrics } from "../src/ops/metrics.js";
import { floorReserveUsd } from "../src/ops/pricing.js";
import { probeProviders, resetProviderConnectivity, setProviderProbes } from "../src/ops/providers.js";
import { resetSpend, SpendLedger, type SpendBound } from "../src/ops/spend.js";
import { proposal } from "../scripts/synthetic/query-proposals.js";
import { scripted } from "./fixtures/synthetic/agent.js";

const SECRET = "ce-public-internal-auth-secret-32ch";
const KEYS = [
  "CE_PUBLIC_DEPLOYMENT",
  "CE_INTERNAL_API_SECRET",
  "CE_SPEND_BUDGET_USD",
  "CE_INVESTIGATION_RESERVE_USD",
  "CE_ACCEPT_INVESTIGATIONS",
  "CE_REPLICA_COUNT",
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

snapshotEnv();
afterEach(restoreEnv);

function refusingBound(): SpendBound {
  return {
    reservationId: "test",
    authorizedUsd: 0.5,
    observedUsd: () => 0.5,
    remainingUsd: () => 0,
    authorizeNextCall: () => false,
    addObserved: () => {},
    markUnknownCall: () => {},
  };
}

describe("spend overage accounting", () => {
  it("records observed spend above the reservation instead of truncating it", () => {
    const ledger = new SpendLedger({ CE_SPEND_BUDGET_USD: "5", CE_INVESTIGATION_RESERVE_USD: "0.5" });
    const reserved = ledger.reserve("job-over");
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    ledger.markStarted(reserved.reservation.id);
    const settled = ledger.settle(reserved.reservation.id, { observedUsd: 0.8, started: true });
    expect(settled?.observedUsd).toBeCloseTo(0.8, 5);
    expect(settled?.consumedUsd).toBeCloseTo(0.8, 5);
    expect(settled?.overageUsd).toBeCloseTo(0.3, 5);
    const snap = ledger.snapshot();
    expect(snap.consumedUsd).toBeCloseTo(0.8, 5);
    expect(snap.chargedOrEstimatedUsd).toBeCloseTo(0.8, 5);
    expect(snap.overageUsd).toBeCloseTo(0.3, 5);
    expect(snap.remainingBudgetUsd).toBeCloseTo(4.2, 5);
    expect(snap.availableUsd).toBeCloseTo(4.2, 5);
    expect(snap.durable).toBe(false);
  });

  it("charges the full reserve when provider usage is missing", () => {
    const ledger = new SpendLedger({ CE_SPEND_BUDGET_USD: "5", CE_INVESTIGATION_RESERVE_USD: "1" });
    const reserved = ledger.reserve();
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    ledger.markStarted(reserved.reservation.id);
    ledger.settle(reserved.reservation.id, { observedUsd: null, started: true });
    expect(ledger.snapshot().consumedUsd).toBe(1);
    expect(ledger.snapshot().unknownUsageReserveUsd).toBe(1);
    expect(ledger.snapshot().uncertaintyCounts.provider_usage_missing).toBe(1);
  });

  it("reconciles in-flight progress when a started job is cancelled", () => {
    const ledger = new SpendLedger({ CE_SPEND_BUDGET_USD: "5", CE_INVESTIGATION_RESERVE_USD: "1" });
    const reserved = ledger.reserve();
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    ledger.markStarted(reserved.reservation.id);
    ledger.recordProgress(reserved.reservation.id, 0.22);
    ledger.settle(reserved.reservation.id, { observedUsd: null, started: true });
    expect(ledger.snapshot().consumedUsd).toBeCloseTo(0.22, 5);
    expect(ledger.snapshot().overageUsd).toBe(0);
  });

  it("cannot oversubscribe the remaining budget with concurrent reservations", () => {
    const ledger = new SpendLedger({ CE_PUBLIC_DEPLOYMENT: "1", CE_SPEND_BUDGET_USD: "1", CE_INVESTIGATION_RESERVE_USD: "1" });
    const first = ledger.reserve("a");
    const second = ledger.reserve("b");
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("budget_exhausted");
  });

  it("counts an in-flight overage against remaining budget before the job settles", () => {
    const ledger = new SpendLedger({ CE_SPEND_BUDGET_USD: "2.1", CE_INVESTIGATION_RESERVE_USD: "1" });
    const first = ledger.reserve("a");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    ledger.recordProgress(first.reservation.id, 1.2);
    const second = ledger.reserve("b");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("budget_exhausted");
  });
});

describe("invalid reserve configuration", () => {
  it("fails closed on a public reserve that is too low to protect a run", () => {
    const issues = validatePublicRuntime({
      CE_PUBLIC_DEPLOYMENT: "1",
      CE_INTERNAL_API_SECRET: SECRET,
      CE_SPEND_BUDGET_USD: "25",
      CE_INVESTIGATION_RESERVE_USD: "0.01",
      QLOO_API_KEY: "present",
      ANTHROPIC_API_KEY: "present",
      QLOO_API_BASE_URL: "https://hackathon.api.qloo.com",
    });
    expect(issues.map((issue) => issue.code)).toContain("RESERVE_TOO_LOW");
    expect(floorReserveUsd()).toBeGreaterThan(0.01);
  });

  it("rejects a non-positive reserve and a replica count other than one", () => {
    const issues = validatePublicRuntime({
      NODE_ENV: "production",
      CE_INTERNAL_API_SECRET: SECRET,
      CE_SPEND_BUDGET_USD: "25",
      CE_INVESTIGATION_RESERVE_USD: "0",
      CE_REPLICA_COUNT: "2",
      QLOO_API_KEY: "present",
      ANTHROPIC_API_KEY: "present",
      QLOO_API_BASE_URL: "https://hackathon.api.qloo.com",
    });
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["RESERVE_INVALID", "REPLICA_COUNT_UNSUPPORTED"]));
  });
});

describe("runtime spend bound", () => {
  it("refuses the next model call and keeps an incomplete budget-limited result", async () => {
    const model = new ScriptedAgentModel([[{ action: "finish", resultIds: [], reasonSummary: "should not run" }]], [], "spend");
    const runtime = new AgentRuntime({ model, provider: scripted(), store: new RunStore() });
    const result = await runtime.run(
      { userQuery: "Where could Northwind Atelier expand?", brand: "Northwind Atelier", intent: "explore_frontier" },
      undefined,
      { spend: refusingBound() },
    );
    expect(model.seen).toHaveLength(0);
    expect(result.status).toBe("BUDGET_EXHAUSTED");
    if (result.status !== "BUDGET_EXHAUSTED") return;
    expect(result.limitations.some((limitation) => limitation.code === "SPEND_LIMIT_REACHED")).toBe(true);
    expect(result.territories.every((territory) => territory.analysisRoute !== "FULL_RELATIVE_ANALYSIS" || territory.evidenceStatus)).toBe(true);
  });
});

describe("readiness semantics", () => {
  it("does not treat admission readiness as provider connectivity", () => {
    process.env.CE_ACCEPT_INVESTIGATIONS = "1";
    resetLifecycle();
    const ready = readiness({
      CE_PUBLIC_DEPLOYMENT: "1",
      CE_INTERNAL_API_SECRET: SECRET,
      CE_SPEND_BUDGET_USD: "20",
      QLOO_API_KEY: "present",
      ANTHROPIC_API_KEY: "present",
    });
    expect(ready.semantics.providerConnectivity).toBe("not_verified_by_this_endpoint");
    expect(ready.semantics.agentCompetence).toBe("not_this_endpoint");
    expect(ready.semantics.liveness).toBe("not_this_endpoint");
    expect(ready.dependencies.qlooTransportInitialized).toBe(false);
  });

  it("stores an operator probe separately from /ready", async () => {
    setProviderProbes({
      qloo: async () => ({ ok: true, detail: "stub qloo" }),
      haiku: async () => ({ ok: false, detail: "stub haiku" }),
    });
    const probed = await probeProviders(["qloo", "haiku"]);
    expect(probed.qloo.status).toBe("ok");
    expect(probed.haiku.status).toBe("failed");
    expect(readiness().semantics.providerConnectivity).toBe("not_verified_by_this_endpoint");
  });
});

describe("recorded demo provenance", () => {
  it("keeps the 23 October 2026 source hash and incomplete parent", () => {
    const artifact = JSON.parse(readFileSync(new URL("../../frontend/src/demo/recorded-example.json", import.meta.url), "utf8")) as {
      kind: string;
      recordedAt: string;
      sourceSha256: string;
      responses: QueryResponse[];
    };
    expect(artifact.kind).toBe("RECORDED_EXAMPLE");
    expect(artifact.recordedAt).toBe("2026-10-23T06:28:19.052Z");
    expect(artifact.sourceSha256).toBe("064c7f6e87692a45cc5790cf4901b879dd75d8ecbb0b72ad2aee0a76e41d3f75");
    expect(artifact.responses[0]?.state).toBe("INVESTIGATION_INCOMPLETE");
    expect(parseQueryResponse(artifact.responses[0]).ok).toBe(true);
  });
});

describe("latency reconciliation", () => {
  it("does not add overlapping stage clocks as independent wall time", () => {
    const parent = reconcileLatency({
      latencyMs: 810_000,
      modelLatencyMs: 62_000,
      qlooLatencyMs: 119_000,
      qlooSpacingMs: 95_000,
      analysisLatencyMs: 21_000,
      synthesisLatencyMs: 36_000,
    });
    expect(parent.naiveSumMs).toBe(238_000);
    expect(parent.unattributedMs).toBe(572_000);
    expect(parent.stages.qlooActiveMs).toBe(24_000);
    expect(parent.overlapMs).toBe(0);
    const overlap = reconcileLatency({
      latencyMs: 100,
      modelLatencyMs: 80,
      qlooLatencyMs: 80,
      qlooSpacingMs: 10,
      analysisLatencyMs: 20,
      synthesisLatencyMs: 20,
    });
    expect(overlap.overlapMs).toBeGreaterThan(0);
    expect(overlap.unattributedMs).toBe(0);
  });
});

describe("public job still refuses unsupported models", () => {
  // PR #33 made paid admission opt-in; this guard is checked behind an open admission.
  beforeEach(() => {
    process.env.CE_ACCEPT_INVESTIGATIONS = "1";
    resetLifecycle();
  });
  it("rejects baseline on the public job route", async () => {
    process.env.CE_PUBLIC_DEPLOYMENT = "1";
    process.env.CE_INTERNAL_API_SECRET = SECRET;
    process.env.CE_SPEND_BUDGET_USD = "20";
    process.env.CE_INVESTIGATION_RESERVE_USD = "1";
    resetSpend();
    const runtime = new AgentRuntime({ model: new BaselinePolicyModel(), provider: scripted(), store: new RunStore() });
    const app = buildApp({
      logLevel: "silent",
      agentRuntimeFactory: () => runtime,
      queryInterpreterFactory: () => new ScriptedQueryInterpreter(() => proposal({ primaryIntent: "explore_frontier", brandsNamed: ["Northwind Atelier"] })),
    });
    const rejected = await app.inject({
      method: "POST",
      url: "/api/agent/jobs",
      headers: { "x-ce-internal-auth": SECRET, "x-ce-visitor": "visitor-sprint7b-aaaaaa01" },
      payload: { query: "Where next?", model: "baseline" },
    });
    expect(rejected.statusCode).toBe(403);
    await app.close();
  });
});
