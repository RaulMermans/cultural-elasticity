/**
 * Sprint 10D: handoff idempotency and comparative report plans survive a backend restart (durable mode).
 * SYNTHETIC world, baseline policy, structural interpreter, disposable PostgreSQL (DATABASE_URL). No provider call.
 *
 * Two app instances share one database; the first is closed before the second starts, as a redeploy would.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AnyBrandBaselineResult, ComparativeReferenceCandidate } from "@cultural-elasticity/shared";
import { buildApp } from "../src/app.js";
import { durableAgentFromEnv } from "../src/api/agent.js";
import { createBaselinePool, migrate, type Database } from "../src/brand-baseline/db.js";
import { JournaledInterpreter, JournaledModel, JournaledToolProvider } from "../src/agent/durable/decorators.js";
import { BaselinePolicyModel } from "../src/agent/model/baseline.js";
import { StructuralQueryInterpreter } from "../src/agent/query/interpreter.js";
import { RunStore } from "../src/agent/run-store.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { buildBaselineResult } from "../src/brand-baseline/research.js";
import { resetAdmission } from "../src/api/admission.js";
import { resetLifecycle } from "../src/ops/lifecycle.js";
import { resetSpend } from "../src/ops/spend.js";
import { scripted } from "./fixtures/synthetic/agent.js";
import { syntheticBrand, syntheticTag, syntheticTagObservation } from "./fixtures/synthetic/brand-baseline.js";

const SECRET = "ce-synthetic-internal-auth-secret-10d";
const url = process.env.DATABASE_URL;
let pool: Database;

beforeAll(async () => {
  if (!url) throw new Error("DATABASE_URL is required for durable tests");
  pool = createBaselinePool(url);
  await migrate(pool);
  process.env.CE_INTERNAL_API_SECRET = SECRET;
  process.env.CE_ACCEPT_INVESTIGATIONS = "1";
  process.env.CE_DURABLE_AGENT = "1";
});
afterAll(async () => {
  delete process.env.CE_DURABLE_AGENT;
  await pool?.end();
});

type Scan = { token: string; result: AnyBrandBaselineResult };

function larkspur(): Scan {
  const scanId = randomUUID();
  const result = buildBaselineResult({
    scanId, brandId: `syn-internal-${scanId}`, brand: syntheticBrand("Larkspur Velo", "SYN-BR-3001"), brandCapturedAt: "2026-10-27T00:00:00.000Z",
    observations: [syntheticTagObservation([syntheticTag("urn:tag:interests:syn:slow_touring", "Slow Touring")])],
    startedAt: "2026-10-27T00:00:00.000Z", finishedAt: "2026-10-27T00:01:00.000Z", providerCallCount: 2, recordedOrLive: "recorded",
  });
  return { token: randomUUID(), result };
}

async function instance(scans: Map<string, Scan>) {
  resetLifecycle();
  resetSpend();
  resetAdmission();
  const runtime = new AgentRuntime({ model: new JournaledModel(new BaselinePolicyModel()), provider: new JournaledToolProvider(scripted()), store: new RunStore() });
  const interpreter = new JournaledInterpreter(new StructuralQueryInterpreter());
  const app = buildApp({
    logLevel: "silent",
    agentRuntimeFactory: () => runtime,
    queryInterpreterFactory: () => interpreter,
    durableAgent: durableAgentFromEnv()!,
    baselineReader: {
      readScan: async (id: string, token: string) => {
        const scan = scans.get(id);
        return scan && scan.token === token ? { status: scan.result.scanStatus, providerCallCount: 2, result: scan.result, stages: [] } : null;
      },
    },
  });
  await app.ready();
  const auth = (extra: Record<string, string> = {}) => ({ "x-ce-internal-auth": SECRET, "x-ce-visitor": "visitor-sprint10d-aaaaaa01", ...extra });
  const waitFor = async (jobId: string, token: string) => {
    for (let i = 0; i < 600; i += 1) {
      const view = (await app.inject({ method: "GET", url: `/api/agent/jobs/${jobId}`, headers: auth({ "x-job-token": token }) })).json();
      if (["completed", "failed", "cancelled", "expired"].includes(view.status)) return view;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("job did not finish");
  };
  const handoff = (scan: Scan, direction: string, idempotencyKey: string) =>
    app.inject({ method: "POST", url: "/api/agent/handoff/jobs", headers: auth({ "x-baseline-token": scan.token }), payload: { scanId: scan.result.scanId, proposedDirection: direction, idempotencyKey } });
  const investigate = async (scan: Scan, direction: string) => {
    const response = await handoff(scan, direction, randomUUID());
    expect(response.statusCode, response.body).toBe(202);
    const job = response.json() as { jobId: string; accessToken: string };
    expect((await waitFor(job.jobId, job.accessToken)).status).toBe("completed");
    return job;
  };
  const compare = (mode: "options" | "jobs", scan: Scan, parent: { jobId: string; accessToken: string }, body: Record<string, unknown> = {}) =>
    app.inject({ method: "POST", url: `/api/agent/handoff/compare/${mode}`, headers: auth({ "x-baseline-token": scan.token, "x-job-token": parent.accessToken }), payload: { scanId: scan.result.scanId, parentJobId: parent.jobId, ...body } });
  const report = (jobId: string, token: string) => app.inject({ method: "GET", url: `/api/agent/handoff/compare/${jobId}/report`, headers: auth({ "x-job-token": token }) });
  return { app, waitFor, handoff, investigate, compare, report };
}

const byLabel = (references: ComparativeReferenceCandidate[], label: string) => references.find((r) => r.label === label)!;

describe("SYNTHETIC Sprint 10D durable handoff state across a restart", () => {
  it("keeps the comparative report and never starts a second job for a repeated key", async () => {
    const scans = new Map<string, Scan>();
    const scan = larkspur();
    scans.set(scan.result.scanId, scan);

    const first = await instance(scans);
    const handoffKey = randomUUID();
    const parentStart = await first.handoff(scan, "Gravel Riding", handoffKey);
    expect(parentStart.statusCode, parentStart.body).toBe(202);
    const parent = parentStart.json() as { jobId: string; accessToken: string };
    expect((await first.waitFor(parent.jobId, parent.accessToken)).status).toBe("completed");
    await first.investigate(scan, "Alpine Hiking");
    await first.investigate(scan, "Mountain Town");
    const offered = (await first.compare("options", scan, parent)).json();
    const referenceIds = [byLabel(offered.references, "Alpine Hiking").id, byLabel(offered.references, "Mountain Town").id];
    const compareKey = randomUUID();
    const started = await first.compare("jobs", scan, parent, { referenceIds, idempotencyKey: compareKey });
    expect(started.statusCode, started.body).toBe(202);
    const comparison = started.json() as { jobId: string; accessToken: string };
    expect((await first.waitFor(comparison.jobId, comparison.accessToken)).status).toBe("completed");
    const before = (await first.report(comparison.jobId, comparison.accessToken)).json();
    expect(before.report.outcome).toBe("RELATIVE_POSITION_ESTABLISHED");
    await first.app.close();

    const second = await instance(scans);
    const jobsBefore = Number((await pool.query("SELECT count(*) AS n FROM agent_jobs")).rows[0].n);

    // The report is rebuilt from the durable plan; its validated content is unchanged.
    const after = await second.report(comparison.jobId, comparison.accessToken);
    expect(after.statusCode, after.body).toBe(200);
    expect(after.json().report).toEqual(before.report);
    // The token is still required.
    expect((await second.report(comparison.jobId, randomUUID())).statusCode).toBe(404);

    // Repeated keys: refused without a new job; a different request under the same key is a conflict.
    const again = await second.handoff(scan, "Gravel Riding", handoffKey);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: "idempotency_unavailable", jobId: parent.jobId });
    expect((await second.handoff(scan, "Alpine Hiking", handoffKey)).json()).toMatchObject({ error: "idempotency_conflict" });
    const compareAgain = await second.compare("jobs", scan, parent, { referenceIds, idempotencyKey: compareKey });
    expect(compareAgain.statusCode, compareAgain.body).toBe(409);
    expect(compareAgain.json()).toMatchObject({ error: "idempotency_unavailable", jobId: comparison.jobId });
    expect(Number((await pool.query("SELECT count(*) AS n FROM agent_jobs")).rows[0].n)).toBe(jobsBefore);
    await second.app.close();
  });
});
