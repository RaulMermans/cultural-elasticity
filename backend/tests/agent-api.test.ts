/** POST /api/agent/analyze and /api/agent/continue with an injected scripted runtime (SYNTHETIC world). */
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { AgentRuntimeFactory } from "../src/api/agent.js";
import { AgentNotConfiguredError } from "../src/agent/errors.js";
import { BaselinePolicyModel } from "../src/agent/model/baseline.js";
import { RunStore } from "../src/agent/run-store.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { scripted } from "./fixtures/synthetic/agent.js";

function app(factory?: AgentRuntimeFactory) {
  const store = new RunStore();
  const rt = new AgentRuntime({ model: new BaselinePolicyModel(), provider: scripted(), store });
  return buildApp({ logLevel: "silent", agentRuntimeFactory: factory ?? (() => rt) });
}

describe("agent API", () => {
  it("returns an AgentAnalysisResult for a structured request", async () => {
    const res = await app().inject({ method: "POST", url: "/api/agent/analyze", payload: { query: "Could Northwind Atelier enter boutique hospitality?", brand: "Northwind Atelier", territories: ["Boutique Hospitality"], model: "baseline" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ schemaVersion: "ce-agent-result/0.2", status: "COMPLETE", intent: "analyze_move", evidenceOrigin: "synthetic" });
    expect(body.territories.length).toBeGreaterThan(0);
    expect(body.trace.toolCalls.length).toBeGreaterThan(0);
  });

  it("exposes the Sprint 4 structured metadata for a future UI, and never the prompts", async () => {
    const res = await app().inject({ method: "POST", url: "/api/agent/analyze", payload: { query: "Where could Kestrel Outfitters expand?", brand: "Kestrel Outfitters", territories: [], model: "baseline" } });
    const body = res.json();
    expect(body.skillsUsed.length).toBeGreaterThan(0);
    expect(body.layers).toMatchObject({ qlooEvidence: expect.any(Object), systemAnalysis: expect.any(Object), agentInterpretation: expect.any(Object) });
    expect(body.comparisonSetConstruction.note).toMatch(/comparison set/u);
    expect(body.metrics).toMatchObject({ calls_avoided: expect.any(Number), model_attempts: expect.any(Number) });
    expect(body.territories.every((t: { analysisRoute: string }) => typeof t.analysisRoute === "string")).toBe(true);
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/You are the investigation layer|You explain deterministic Cultural Elasticity results/u);
  });

  it("returns a structured NEEDS_INPUT and continues the run", async () => {
    const server = app();
    const first = await server.inject({ method: "POST", url: "/api/agent/analyze", payload: { query: "Meridian into skincare?", brand: "Meridian", territories: ["Skincare"] } });
    expect(first.json()).toMatchObject({ status: "NEEDS_INPUT", options: [{ id: "SYN-BR-0005" }, { id: "SYN-BR-0006" }] });
    const second = await server.inject({ method: "POST", url: "/api/agent/continue", payload: { runId: first.json().runId, clarification: "SYN-BR-0005" } });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ status: "COMPLETE", brand: { id: "SYN-BR-0005" } });
    const again = await server.inject({ method: "POST", url: "/api/agent/continue", payload: { runId: first.json().runId, clarification: "x" } });
    expect(again.statusCode).toBe(409);
  });

  it("rejects invalid bodies and unknown runs", async () => {
    const server = app();
    expect((await server.inject({ method: "POST", url: "/api/agent/analyze", payload: { query: "" } })).statusCode).toBe(400);
    expect((await server.inject({ method: "POST", url: "/api/agent/analyze", payload: { query: "q", model: "gpt" } })).statusCode).toBe(400);
    expect((await server.inject({ method: "POST", url: "/api/agent/continue", payload: { runId: "00000000-0000-4000-8000-000000000000", clarification: "x" } })).statusCode).toBe(404);
  });

  it("reports missing configuration as 503 instead of faking a run", async () => {
    const server = app(() => {
      throw new AgentNotConfiguredError("AGENT_MODEL_NOT_CONFIGURED", "no ANTHROPIC_API_KEY (LIVE_AGENT_MODEL_VALIDATION_NOT_RUN)");
    });
    const res = await server.inject({ method: "POST", url: "/api/agent/analyze", payload: { query: "q" } });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: "AGENT_MODEL_NOT_CONFIGURED" });
  });
});
