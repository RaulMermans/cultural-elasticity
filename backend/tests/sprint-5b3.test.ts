/** Sprint 5B.3: clarification continuity, navigation, comparison, refinement, jobs and public guards. SYNTHETIC world. */
import { afterEach, describe, expect, it } from "vitest";
import { parseQueryResponse } from "@cultural-elasticity/shared";
import { buildApp } from "../src/app.js";
import { resetAdmission } from "../src/api/admission.js";
import { BaselinePolicyModel } from "../src/agent/model/baseline.js";
import { JobManager } from "../src/agent/query/jobs.js";
import { QueryService } from "../src/agent/query/service.js";
import { ScriptedQueryInterpreter, type InterpretInput } from "../src/agent/query/interpreter.js";
import { conceptIsSpecific } from "../src/agent/query/refinement.js";
import { RunStore } from "../src/agent/run-store.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { named, proposal } from "../scripts/synthetic/query-proposals.js";
import { scripted } from "./fixtures/synthetic/agent.js";
import type { QueryResponse } from "@cultural-elasticity/shared";

function harness(answer: (input: InterpretInput) => unknown) {
  const provider = scripted();
  const runtime = new AgentRuntime({ model: new BaselinePolicyModel(), provider, store: new RunStore() });
  const interpreter = new ScriptedQueryInterpreter(answer);
  const service = new QueryService({ runtime, interpreter });
  return { service, runtime, interpreter, provider };
}

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

describe("refinement specificity", () => {
  it("treats a request to go deeper as not a concept", () => {
    expect(conceptIsSpecific("Bohemian lifestyle", "Bohemian lifestyle, more specific")).toBe(false);
    expect(conceptIsSpecific("Hospitality", "more specific")).toBe(false);
    expect(conceptIsSpecific("Hospitality", "something narrower")).toBe(false);
    expect(conceptIsSpecific("Hospitality", "design-led Mediterranean guesthouses")).toBe(true);
  });
});

describe("clarification, navigation, comparison and narrowing", () => {
  it("continues a clarification with the original question and the answer", async () => {
    const seen: string[] = [];
    const { service } = harness((input) => {
      seen.push(input.query);
      if (!input.query.includes("Answer:")) {
        return proposal({ primaryIntent: "analyze_move", territories: named("Ceramics"), unresolvedReferences: ["the brand"], clarificationQuestion: "Which brand should be investigated?" });
      }
      return proposal({ primaryIntent: "analyze_move", brandsNamed: ["Northwind Atelier"], territories: named("Ceramics") });
    });
    const first = await service.execute({ query: "Could this brand enter ceramics?" });
    expect(first.state).toBe("NEEDS_CLARIFICATION");
    const next = await service.execute({ clarifyQueryId: first.queryId, clarification: "Northwind Atelier" });
    expect(next.state).toBe("INVESTIGATION_COMPLETED");
    expect(seen[1]).toContain("Could this brand enter ceramics?");
    expect(seen[1]).toContain("Northwind Atelier");
    expect(next.handoff?.territories).toEqual(["Ceramics"]);
    expect(next.handoff?.brand).toBeTruthy();
    expect(parseQueryResponse(next).ok).toBe(true);
  });

  it("returns to a parent without another investigation", async () => {
    const { service, runtime, interpreter } = harness(() => proposal({ primaryIntent: "explore_frontier", brandsNamed: ["Northwind Atelier"] }));
    const parent = await service.execute({ query: "Where could Northwind Atelier expand?" });
    const runs = runtime.store.size;
    const seen = interpreter.seen.length;
    const territoryKey = parent.territories.find((territory) => territory.territoryKey)?.territoryKey;
    const back = await service.execute({ navigateToRunId: parent.investigation!.runId, ...(territoryKey ? { territoryKey } : {}) });
    expect(back.state).toBe("RETURNED_TO_INVESTIGATION");
    expect(back.investigation).toMatchObject({ runId: parent.investigation!.runId, reused: true });
    expect(runtime.store.size).toBe(runs);
    expect(interpreter.seen.length).toBe(seen);
    if (territoryKey) expect(back.interpretation?.references.selectedTerritoryKey).toBe(territoryKey);
    const missing = await service.execute({ navigateToRunId: "00000000-0000-4000-8000-000000000099" });
    expect(missing.state).toBe("CONTEXT_UNAVAILABLE");
  });

  it("refuses a vague narrowing and keeps an explicit one", async () => {
    const { service } = harness((input) => {
      if (input.query.startsWith("Where could")) return proposal({ primaryIntent: "explore_frontier", brandsNamed: ["Northwind Atelier"] });
      const parentLabel = input.context?.nodes[0]?.territories[0]?.label ?? "Territory";
      if (input.query.includes("more specifically")) {
        return proposal({ primaryIntent: "refine_territory", territories: named(`${parentLabel}, more specific`), contextRef: "L0", contextTerritoryKey: input.context?.selectedTerritoryKey ?? input.context?.nodes[0]?.territories[0]?.key ?? null });
      }
      return proposal({
        primaryIntent: "refine_territory",
        territories: named("design-led guesthouses"),
        contextRef: "L0",
        contextTerritoryKey: input.context?.nodes[0]?.territories[0]?.key ?? null,
        refinement: { proposedChildConcept: "design-led guesthouses", refinementRelationship: "NARROWER", relationBasis: "USER_EXPLICIT", requiresClarification: false },
      });
    });
    const parent = await service.execute({ query: "Where could Northwind Atelier expand?" });
    const key = parent.territories[0]?.territoryKey ?? undefined;
    const vague = await service.execute({ query: "Explore the territory more specifically.", context: { runId: parent.investigation!.runId, ...(key ? { selectedTerritoryKey: key } : {}) } });
    expect(vague.state).toBe("NEEDS_CLARIFICATION");
    expect(vague.reasons.map((reason) => reason.code)).toContain("REFINEMENT_NOT_A_CONCEPT");
    expect(vague.interpretation?.clarificationQuestion).toMatch(/What part of this territory/u);
    expect(vague.investigation).toBeNull();
    const specific = await service.execute({ query: "Look at design-led guesthouses.", context: { runId: parent.investigation!.runId, ...(key ? { selectedTerritoryKey: key } : {}) } });
    expect(specific.handoff).toMatchObject({ territories: ["design-led guesthouses"], operation: "REFINE_TERRITORY" });
    expect(specific.interpretation?.refinement).toMatchObject({ relationBasis: "USER_EXPLICIT", refinementRelationship: "NARROWER", requiresClarification: false });
    expect(specific.investigation?.link?.inheritedBrand?.id).toBe((parent.investigation!.result as { brand: { id: string } }).brand.id);
    expect(specific.investigation?.runId).not.toBe(parent.investigation!.runId);
  });

  it("refuses cross-brand comparison and starts a new same-brand comparison", async () => {
    const { service, interpreter } = harness((input) => {
      if (input.explicit.intent === "compare_territories") return proposal({ primaryIntent: "compare_territories", brandsNamed: input.explicit.brand ? [input.explicit.brand] : [], territories: (input.explicit.territories ?? []).map((name) => ({ name, fromContext: false })) });
      if (input.query.includes("Kestrel")) return proposal({ primaryIntent: "analyze_move", brandsNamed: ["Kestrel Outfitters"], territories: named("Trail gear") });
      return proposal({ primaryIntent: "analyze_move", brandsNamed: ["Northwind Atelier"], territories: named(input.query.includes("Tableware") ? "Tableware" : "Ceramics") });
    });
    const ceramics = await service.execute({ query: "Would Northwind Atelier enter Ceramics?" });
    const tableware = await service.execute({ query: "Would Northwind Atelier enter Tableware?" });
    const kestrel = await service.execute({ query: "Would Kestrel Outfitters enter Trail gear?" });
    const seen = interpreter.seen.length;
    const crossed = await service.execute({
      query: "Compare these.",
      comparisonSources: [
        { runId: ceramics.investigation!.runId, territoryKey: ceramics.territories[0]!.territoryKey! },
        { runId: kestrel.investigation!.runId, territoryKey: kestrel.territories[0]!.territoryKey! },
      ],
    });
    expect(crossed.state).toBe("UNSUPPORTED_OPERATION");
    expect(crossed.reasons[0]?.code).toBe("CROSS_RUN_BRAND");
    expect(crossed.handoff).toBeNull();
    expect(interpreter.seen.length).toBe(seen);
    const same = await service.execute({
      query: "Compare Ceramics and Tableware.",
      comparisonSources: [
        { runId: ceramics.investigation!.runId, territoryKey: ceramics.territories[0]!.territoryKey! },
        { runId: tableware.investigation!.runId, territoryKey: tableware.territories[0]!.territoryKey! },
      ],
    });
    expect(same.handoff).toMatchObject({ intent: "compare_territories", operation: "NEW_INVESTIGATION" });
    expect(same.investigation?.runId).not.toBe(ceramics.investigation!.runId);
    expect(same.handoff?.territories).toEqual(expect.arrayContaining(["Ceramics", "Tableware"]));
  });
});

describe("job lifecycle", () => {
  it("does not let a cancelled job complete, and drops expired terminal jobs", async () => {
    let clock = 1_000;
    let resolveRun: (value: QueryResponse) => void = () => {};
    const gate = new Promise<QueryResponse>((resolve) => {
      resolveRun = resolve;
    });
    const jobs = new JobManager({
      now: () => clock,
      ttlMs: 100,
      maxRunMs: 5_000,
      runnerFor: () => ({ execute: () => gate, confirm: async () => completed(), continueRun: async () => completed() }),
    });
    const created = jobs.create({ kind: "execute", model: "auto", body: { query: "Keep going." } });
    expect(jobs.cancel(created.jobId, created.accessToken)?.stopping).toBe(true);
    resolveRun(completed());
    await gate;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(jobs.get(created.jobId, created.accessToken)?.status).toBe("cancelled");
    clock += 150;
    expect(jobs.get(created.jobId, created.accessToken)?.status).toBe("expired");
    clock += 200;
    jobs.create({ kind: "execute", model: "auto", body: { query: "Another." } });
    expect(jobs.get(created.jobId, created.accessToken)).toBeNull();
  });
});

describe("public execution guards", () => {
  const previous = { deployment: process.env.CE_PUBLIC_DEPLOYMENT, limit: process.env.CE_JOB_CREATE_LIMIT };
  afterEach(() => {
    if (previous.deployment === undefined) delete process.env.CE_PUBLIC_DEPLOYMENT;
    else process.env.CE_PUBLIC_DEPLOYMENT = previous.deployment;
    if (previous.limit === undefined) delete process.env.CE_JOB_CREATE_LIMIT;
    else process.env.CE_JOB_CREATE_LIMIT = previous.limit;
    resetAdmission();
  });

  it("disables the baseline and development routes in a public deployment", async () => {
    process.env.CE_PUBLIC_DEPLOYMENT = "1";
    const runtime = new AgentRuntime({ model: new BaselinePolicyModel(), provider: scripted(), store: new RunStore() });
    const server = buildApp({
      logLevel: "silent",
      agentRuntimeFactory: () => runtime,
      queryInterpreterFactory: () => new ScriptedQueryInterpreter(() => proposal({ primaryIntent: "explore_frontier", brandsNamed: ["Northwind Atelier"] })),
    });
    const baseline = await server.inject({ method: "POST", url: "/api/agent/jobs", payload: { query: "Where next?", model: "baseline" } });
    expect(baseline.statusCode).toBe(403);
    const analyze = await server.inject({ method: "POST", url: "/api/agent/analyze", payload: { query: "Where next?", model: "baseline" } });
    expect(analyze.statusCode).toBe(404);
    const methodology = await server.inject({ method: "POST", url: "/api/methodology/analyze", payload: {} });
    expect(methodology.statusCode).toBe(404);
    await server.close();
  });

  it("rate limits expensive job creation", async () => {
    process.env.CE_JOB_CREATE_LIMIT = "1";
    resetAdmission();
    const runtime = new AgentRuntime({ model: new BaselinePolicyModel(), provider: scripted(), store: new RunStore() });
    const server = buildApp({
      logLevel: "silent",
      agentRuntimeFactory: () => runtime,
      queryInterpreterFactory: () => new ScriptedQueryInterpreter(() => proposal({ primaryIntent: "explore_frontier", brandsNamed: ["Northwind Atelier"] })),
    });
    const first = await server.inject({ method: "POST", url: "/api/agent/jobs", payload: { query: "Where could Northwind Atelier expand?" } });
    expect(first.statusCode).toBe(202);
    const second = await server.inject({ method: "POST", url: "/api/agent/jobs", payload: { query: "Where could Northwind Atelier expand?" } });
    expect(second.statusCode).toBe(429);
    await server.close();
  });
});
