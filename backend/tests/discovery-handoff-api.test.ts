/**
 * Sprint 10A: the explore handoff through the real API route (SYNTHETIC world, SYN- ids). Baseline policy + structural
 * interpreter + scripted Qloo provider: no Qloo, no model, no network.
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentAnalysisResult, AnyBrandBaselineResult } from "@cultural-elasticity/shared";
import { buildApp } from "../src/app.js";
import { BaselinePolicyModel } from "../src/agent/model/baseline.js";
import { StructuralQueryInterpreter } from "../src/agent/query/interpreter.js";
import { RunStore } from "../src/agent/run-store.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { buildBaselineResult, type BaselineObservation } from "../src/brand-baseline/research.js";
import { resetAdmission } from "../src/api/admission.js";
import { resetLifecycle } from "../src/ops/lifecycle.js";
import { resetSpend } from "../src/ops/spend.js";
import { scripted } from "./fixtures/synthetic/agent.js";
import { syntheticBrand, syntheticProvenance, syntheticTag, syntheticTagObservation } from "./fixtures/synthetic/brand-baseline.js";

const SECRET = "ce-synthetic-internal-auth-secret-10a";
const KEYS = ["CE_INTERNAL_API_SECRET", "CE_ACCEPT_INVESTIGATIONS"] as const;
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

const artists: BaselineObservation = {
  domain: "artist",
  capturedAt: "2026-10-29T00:00:00.000Z",
  outcome: {
    kind: "ok",
    data: { signals: [syntheticBrand("Ashgrove Workwear", "SYN-BR-10A0")], entities: [["SYN-AR-10A1", "Cinder Choir"], ["SYN-AR-10A2", "Low Ceiling"]].map(([qlooId, label]) => ({ kind: "entity" as const, qlooId: qlooId!, label: label!, type: "urn:entity:artist", affinity: 0.8, sourceCorrelationId: "syn-10a-artists" })) },
    provenance: syntheticProvenance("recommend", "syn-10a-artists"),
  },
};

function harness() {
  process.env.CE_INTERNAL_API_SECRET = SECRET;
  process.env.CE_ACCEPT_INVESTIGATIONS = "1";
  resetLifecycle();
  resetSpend();
  resetAdmission();
  const scanId = randomUUID();
  const token = randomUUID();
  const result: AnyBrandBaselineResult = buildBaselineResult({
    scanId, brandId: `syn-internal-${scanId}`, brand: syntheticBrand("Ashgrove Workwear", "SYN-BR-10A0"), brandCapturedAt: "2026-10-29T00:00:00.000Z",
    observations: [syntheticTagObservation([syntheticTag("urn:tag:interests:syn:trade_heritage", "Trade Heritage")]), artists],
    startedAt: "2026-10-29T00:00:00.000Z", finishedAt: "2026-10-29T00:01:00.000Z", providerCallCount: 3, recordedOrLive: "recorded",
  });
  const runtime = new AgentRuntime({ model: new BaselinePolicyModel(), provider: scripted(), store: new RunStore() });
  const app = buildApp({
    logLevel: "silent",
    agentRuntimeFactory: () => runtime,
    queryInterpreterFactory: () => new StructuralQueryInterpreter(),
    baselineReader: { readScan: async (id: string, given: string) => (id === scanId && given === token ? { status: result.scanStatus, providerCallCount: 3, result, stages: [] } : null) },
  });
  const headers = { "x-ce-internal-auth": SECRET, "x-ce-visitor": "visitor-sprint10a-aaaaaa01", "x-baseline-token": token };
  const post = (mode: "preview" | "jobs", payload: Record<string, unknown>) => app.inject({ method: "POST", url: `/api/agent/handoff/${mode}`, headers, payload: { scanId, ...payload } });
  async function waitFor(jobId: string, jobToken: string) {
    for (let i = 0; i < 400; i += 1) {
      const view = (await app.inject({ method: "GET", url: `/api/agent/jobs/${jobId}`, headers: { ...headers, "x-job-token": jobToken } })).json();
      if (["completed", "failed", "cancelled", "expired"].includes(view.status)) return view;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("job did not finish");
  }
  return { result, post, waitFor };
}

describe("SYNTHETIC Sprint 10A explore handoff (API)", () => {
  it("previews open discovery with the scan's own observations as seeds, and no seed in the question", async () => {
    const h = harness();
    const preview = await h.post("preview", { explore: true, idempotencyKey: randomUUID() });
    expect(preview.statusCode, preview.body).toBe(200);
    const body = preview.json();
    expect(body.version).toBe("ce-explore-investigation/0.1");
    expect(body.agentRequest).toMatchObject({ intent: "explore_frontier", territories: [] });
    expect(body.seeds.map((s: { id: string; correlationId: string }) => [s.id, s.correlationId])).toEqual([["SYN-AR-10A1", "syn-10a-artists"], ["SYN-AR-10A2", "syn-10a-artists"]]);
    expect(body.agentRequest.userQuery).not.toMatch(/Cinder Choir|SYN-AR/u);
  });

  it("runs explore_frontier with the seeds server-held, recorded in the result, never as support", async () => {
    const h = harness();
    const created = await h.post("jobs", { explore: true, idempotencyKey: randomUUID() });
    expect(created.statusCode, created.body).toBe(202);
    const job = created.json() as { jobId: string; accessToken: string };
    const view = await h.waitFor(job.jobId, job.accessToken);
    expect(view.status).toBe("completed");
    const result = view.response.investigation.result as AgentAnalysisResult;
    expect(result.intent).toBe("explore_frontier");
    expect(result.comparisonSetConstruction.seeds?.map((s) => s.id)).toEqual(["SYN-AR-10A1", "SYN-AR-10A2"]);
    expect(result.comparisonSetConstruction.candidatePoolRule).toBe("frontier-pool/v2");
    for (const o of result.comparisonSetConstruction.opportunities ?? []) expect(["QLOO_SUPPORTED", "RELATIVELY_MEASURED"].includes(o.status) ? result.territories.some((t) => t.key === o.territoryKey && t.resolvedConcept) : true).toBe(true);
  });

  it("refuses a request naming both a direction and exploration, and an idempotency key reused across kinds", async () => {
    const h = harness();
    expect((await h.post("preview", { explore: true, territoryId: h.result.territories[0]!.id, idempotencyKey: randomUUID() })).statusCode).toBe(400);
    expect((await h.post("preview", { explore: false, idempotencyKey: randomUUID() })).statusCode).toBe(400);
    const key = randomUUID();
    expect((await h.post("jobs", { explore: true, idempotencyKey: key })).statusCode).toBe(202);
    expect((await h.post("jobs", { territoryId: h.result.territories[0]!.id, idempotencyKey: key })).statusCode).toBe(409);
  });
});
