/** Trace completeness, provenance, observability metrics, and what must never appear in a trace. SYNTHETIC. */
import type { AgentAnalysisResult } from "@cultural-elasticity/shared";
import { describe, expect, it } from "vitest";
import { runtime } from "./fixtures/synthetic/agent.js";

async function run(): Promise<AgentAnalysisResult> {
  return (await runtime().runtime.run({ userQuery: "Could Northwind Atelier enter boutique hospitality?", brand: "Northwind Atelier", territories: ["Boutique Hospitality"] })) as AgentAnalysisResult;
}

describe("agent trace", () => {
  it("records every element the spec requires", async () => {
    const { trace } = await run();
    expect(trace.runId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(trace.intent).toBe("analyze_move");
    expect(trace.interpretedRequest).toMatchObject({ brand: "Northwind Atelier", territories: ["Boutique Hospitality"] });
    expect(trace.planRevisions.length).toBeGreaterThan(1);
    expect(trace.toolCalls.every((c) => c.arguments !== undefined && c.status && c.id)).toBe(true);
    expect(trace.resolvedEntities[0]).toMatchObject({ role: "brand", label: "Northwind Atelier", resolution: "confirmed" });
    expect(trace.territoryHypotheses.map((h) => `${h.role}:${h.origin}`)).toEqual(expect.arrayContaining(["target:user", "reference:qloo_evidence"]));
    expect(trace.representations.length).toBeGreaterThanOrEqual(3);
    expect(trace.representations.some((r) => r.rejected.length > 0)).toBe(true);
    expect(trace.sufficiency.map((s) => s.verdict)).toContain("SUFFICIENT");
    const invocation = trace.methodologyInvocations[0]!;
    expect(invocation.methodologyVersion).toBe("elasticity-v0.1");
    expect(invocation.panelIds.slice(0, 3)).toEqual(["A", "B", "C"]);
    // The repeat panel is the lowest-priority optional evidence: collected only if budget remains.
    expect(invocation.correlationIds).toHaveLength(invocation.panelIds.length);
    expect(trace.synthesis).toMatchObject({ source: "deterministic_template" });
    expect(trace.statusTransitions.at(-1)!.to).toBe("COMPLETE");
    expect(trace.limits).toMatchObject({ maxAgentIterations: 8, maxQlooCalls: 20 });
  });

  it("keeps provenance: every Qloo-facing call and every analyzed territory traces to correlation ids", async () => {
    const r = await run();
    for (const c of r.trace.toolCalls.filter((x) => x.permission === "read_only_external" && x.status !== "rejected")) expect(c.correlationIds.length, c.tool).toBeGreaterThan(0);
    for (const t of r.territories) {
      expect(t.provenance.correlationIds.length, t.key).toBeGreaterThan(0);
      expect(t.provenance.sources).toEqual(["synthetic-fixture"]);
    }
  });

  it("contains no secrets, raw reasoning or upstream payloads", async () => {
    const text = JSON.stringify((await run()).trace);
    expect(text).not.toMatch(/QLOO_API_KEY|ANTHROPIC_API_KEY|x-api-key|sk-ant/iu);
    expect(text).not.toMatch(/"(thinking|chainOfThought|reasoning)"\s*:/u);
    expect(text).not.toMatch(/"envelope"|"interpretation"|"schema_version"/u);
  });

  it("exposes run-level observability metrics consistent with the trace", async () => {
    const r = await run();
    const m = r.metrics;
    expect(m.agent_iterations).toBe(r.trace.turns.length);
    expect(m.tool_calls).toBe(r.trace.toolCalls.length);
    expect(m.qloo_calls).toBeLessThanOrEqual(r.trace.limits.maxQlooCalls!);
    expect(m.full_analysis_count + m.partial_analysis_count + m.descriptive_analysis_count + m.unsupported_count).toBe(r.territories.length);
    expect(m.methodology_calls).toBe(r.methodologyRuns.length);
    expect(m.representation_attempts).toBeGreaterThan(0);
    expect(m.budget_exhausted).toBe(false);
    expect(m.latency_ms).toBeGreaterThanOrEqual(0);
    expect(m.tool_success_rate).toBeGreaterThan(0.5);
  });
});
