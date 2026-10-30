/**
 * Sprint 10C REAL PROCESS-INTERRUPTION tests (SYNTHETIC world, deterministic baseline reference policy, structural
 * interpreter: no Qloo or model call is made). Each test runs real worker processes against a disposable PostgreSQL
 * database, kills them with SIGKILL (or pauses them with SIGSTOP), restarts them, and asserts the database records,
 * job state, the independent dispatch oracle and the final output.
 *
 * Needs DATABASE_URL of a disposable database (migrations are applied here). Run: pnpm test:durable
 */
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBaselinePool, migrate, type Database } from "../src/brand-baseline/db.js";
import { DurableAgentStore } from "../src/agent/durable/store.js";
import { buildRunManifest } from "../src/agent/durable/manifest.js";
import { AMBIGUOUS, callRows, COMPARE, dispatches, events, finished, getJob, jobRow, journalCorrelationIds, post, researchProjection, resultCorrelationIds, scratch, sleep, startWorker, untilJob, type Worker } from "./durable/harness.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED_FOR_DURABLE_PROCESS_TESTS");
const url = process.env.DATABASE_URL;
let pool: Database;
let store: DurableAgentStore;
let reference: { projection: unknown; qloo: number; fingerprints: string[] };
const workers: Worker[] = [];

async function worker(env: Record<string, string>): Promise<Worker> {
  const started = await startWorker({ DATABASE_URL: url, ...env });
  workers.push(started);
  return started;
}

async function submit(w: Worker, body: unknown = COMPARE): Promise<{ jobId: string; token: string }> {
  const created = await post(w, "/api/agent/jobs", body);
  expect(created.status).toBe(202);
  return { jobId: String(created.body.jobId), token: String(created.body.accessToken) };
}

const qlooFingerprints = async (jobId: string) => (await callRows(pool, jobId)).filter((c) => c.provider === "qloo").map((c) => c.op_key).sort();

beforeAll(async () => {
  pool = createBaselinePool(url);
  await migrate(pool);
  store = new DurableAgentStore(pool);
  // The uninterrupted reference run every recovered run is compared with.
  const dir = scratch();
  const log = join(dir, "dispatch.log");
  const w = await worker({ CE_DURABLE_DISPATCH_LOG: log });
  const { jobId, token } = await submit(w);
  const view = await untilJob(w, jobId, token, finished);
  expect(view.status).toBe("completed");
  reference = { projection: researchProjection(view), qloo: dispatches(log).length, fingerprints: await qlooFingerprints(jobId) };
  expect(reference.qloo).toBeGreaterThan(10);
  await w.kill("SIGTERM");
}, 120_000);

afterAll(async () => {
  for (const w of workers) await w.kill();
  await pool?.end();
});

describe("REAL PROCESS crash recovery (synthetic provider, disposable PostgreSQL)", () => {
  it("Test 1 — crash before dispatch: resumes safely, no phantom or duplicate call, same result", async () => {
    const log = join(scratch(), "dispatch.log");
    const a = await worker({ CE_DURABLE_DISPATCH_LOG: log, CE_DURABLE_FAULT_INJECTION: "1", CE_DURABLE_FAULT: "qloo.before_dispatch:6" });
    const { jobId, token } = await submit(a);
    await a.waitFor("CE_FAULT_REACHED qloo.before_dispatch");
    await a.kill();
    expect(dispatches(log)).toHaveLength(5);
    expect((await callRows(pool, jobId)).filter((c) => c.status === "RESERVED")).toHaveLength(1);
    const b = await worker({ CE_DURABLE_DISPATCH_LOG: log });
    const view = await untilJob(b, jobId, token, finished);
    expect(view.status).toBe("completed");
    expect(dispatches(log)).toHaveLength(reference.qloo);
    expect(researchProjection(view)).toEqual(reference.projection);
    const calls = await callRows(pool, jobId);
    expect(calls.every((c) => c.status === "COMPLETED")).toBe(true);
    expect(calls.filter((c) => c.provider === "qloo").every((c) => c.dispatch_count === 1)).toBe(true);
    expect((await jobRow(pool, jobId))?.attempt).toBe(2);
    await b.kill("SIGTERM");
  }, 90_000);

  it("Test 2 — crash after the dispatch mark: the call is not repeated without proof it never left", async () => {
    const log = join(scratch(), "dispatch.log");
    const a = await worker({ CE_DURABLE_DISPATCH_LOG: log, CE_DURABLE_FAULT_INJECTION: "1", CE_DURABLE_FAULT: "qloo.after_dispatch_mark:6" });
    const { jobId, token } = await submit(a);
    await a.waitFor("CE_FAULT_REACHED qloo.after_dispatch_mark");
    await a.kill();
    const b = await worker({ CE_DURABLE_DISPATCH_LOG: log });
    const view = await untilJob(b, jobId, token, finished);
    expect(view.status).toBe("failed");
    expect((view.error as { code: string }).code).toBe("INVESTIGATION_INTERRUPTED_UNCERTAIN");
    expect(view.response).toBeNull();
    // The oracle shows it never reached the transport, but the process could not know: nothing was sent again.
    expect(dispatches(log)).toHaveLength(5);
    const row = await jobRow(pool, jobId);
    expect(row?.status).toBe("INTERRUPTED_UNCERTAIN");
    const calls = await callRows(pool, jobId);
    expect(calls.filter((c) => c.status === "OUTCOME_UNKNOWN")).toHaveLength(1);
    expect(calls.filter((c) => c.provider === "qloo" && c.status === "COMPLETED")).toHaveLength(5);
    expect((await events(pool, jobId)).some((e) => e.event_type === "RECOVERY_DECISION" && e.detail.action === "quarantine")).toBe(true);
    await b.kill("SIGTERM");
  }, 90_000);

  it("Test 3 — crash after a committed answer: committed evidence is reused, never fetched twice", async () => {
    const log = join(scratch(), "dispatch.log");
    const a = await worker({ CE_DURABLE_DISPATCH_LOG: log, CE_DURABLE_FAULT_INJECTION: "1", CE_DURABLE_FAULT: "qloo.after_commit:15" });
    const { jobId, token } = await submit(a);
    await a.waitFor("CE_FAULT_REACHED qloo.after_commit");
    await a.kill();
    const killedAt = Date.now();
    expect(dispatches(log)).toHaveLength(15);
    const b = await worker({ CE_DURABLE_DISPATCH_LOG: log });
    const view = await untilJob(b, jobId, token, finished);
    const metrics = /"event":"job_durable_metrics"[^}]*/u.exec(b.output())?.[0] ?? "";
    // Measured, not asserted: restart time includes process start (tsx) and the 1.5 s test lease expiring.
    console.log(`DURABLE_METRIC restart_to_completed_ms=${Date.now() - killedAt} ${metrics}`);
    expect(view.status).toBe("completed");
    const sent = dispatches(log);
    expect(sent).toHaveLength(reference.qloo);
    expect(new Set(sent.map((d) => JSON.stringify([d.operation, d.input]))).size).toBe(reference.qloo);
    expect(researchProjection(view)).toEqual(reference.projection);
    expect(await qlooFingerprints(jobId)).toEqual(reference.fingerprints);
    // Provenance survives recovery: every cited correlation id belongs to a committed journal answer of this job.
    const cited = resultCorrelationIds(view);
    expect(cited.length).toBeGreaterThan(0);
    const journal = await journalCorrelationIds(pool, jobId);
    expect(cited.every((id) => journal.has(id))).toBe(true);
    expect(b.output()).toMatch(/"reused":(1[5-9]|[2-9]\d)/u);
    await b.kill("SIGTERM");
  }, 90_000);

  it("Test 4 — crash with an answered but uncommitted call: OUTCOME_UNKNOWN, quarantined, resumed only after authorization", async () => {
    const log = join(scratch(), "dispatch.log");
    const a = await worker({ CE_DURABLE_DISPATCH_LOG: log, CE_DURABLE_FAULT_INJECTION: "1", CE_DURABLE_FAULT: "qloo.before_commit:6" });
    const { jobId, token } = await submit(a);
    await a.waitFor("CE_FAULT_REACHED qloo.before_commit");
    await a.kill();
    expect(dispatches(log)).toHaveLength(6);
    const b = await worker({ CE_DURABLE_DISPATCH_LOG: log });
    const quarantined = await untilJob(b, jobId, token, finished);
    expect(quarantined.status).toBe("failed");
    expect((await jobRow(pool, jobId))?.status).toBe("INTERRUPTED_UNCERTAIN");
    await sleep(2_500);
    expect(dispatches(log)).toHaveLength(6);
    // Explicit, bounded operator decision: the unknown call stays charged and may be dispatched once more.
    expect(await store.authorizeUnknown(jobId)).toBe(true);
    const view = await untilJob(b, jobId, token, (v) => v.status === "completed", 30_000);
    expect(researchProjection(view)).toEqual(reference.projection);
    expect(dispatches(log)).toHaveLength(reference.qloo + 1);
    const repeated = (await callRows(pool, jobId)).filter((c) => c.dispatch_count > 1);
    expect(repeated).toHaveLength(1);
    expect(repeated[0]!.attempt).toBe(2);
    expect((await events(pool, jobId)).map((e) => e.event_type)).toContain("UNKNOWN_OUTCOME_AUTHORIZED");
    await b.kill("SIGTERM");
  }, 90_000);

  it("Test 5 — crash during a model decision: committed evidence kept; an unknown decision call is quarantined, a not-yet-sent one resumes", async () => {
    const logA = join(scratch(), "dispatch.log");
    const a = await worker({ CE_DURABLE_DISPATCH_LOG: logA, CE_DURABLE_FAULT_INJECTION: "1", CE_DURABLE_FAULT: "model.after_dispatch_mark:3" });
    const unknownJob = await submit(a);
    await a.waitFor("CE_FAULT_REACHED model.after_dispatch_mark");
    await a.kill();
    const committedBefore = (await callRows(pool, unknownJob.jobId)).filter((c) => c.status === "COMPLETED").length;
    const b = await worker({ CE_DURABLE_DISPATCH_LOG: logA });
    const view = await untilJob(b, unknownJob.jobId, unknownJob.token, finished);
    expect(view.status).toBe("failed");
    const calls = await callRows(pool, unknownJob.jobId);
    expect(calls.filter((c) => c.status === "OUTCOME_UNKNOWN").map((c) => c.provider)).toEqual(["model"]);
    expect(calls.filter((c) => c.status === "COMPLETED")).toHaveLength(committedBefore);
    await b.kill("SIGTERM");

    const logC = join(scratch(), "dispatch.log");
    const c = await worker({ CE_DURABLE_DISPATCH_LOG: logC, CE_DURABLE_FAULT_INJECTION: "1", CE_DURABLE_FAULT: "model.before_dispatch:3" });
    const safeJob = await submit(c);
    await c.waitFor("CE_FAULT_REACHED model.before_dispatch");
    await c.kill();
    const d = await worker({ CE_DURABLE_DISPATCH_LOG: logC });
    const resumed = await untilJob(d, safeJob.jobId, safeJob.token, finished);
    expect(resumed.status).toBe("completed");
    expect(researchProjection(resumed)).toEqual(reference.projection);
    expect(dispatches(logC)).toHaveLength(reference.qloo);
    await d.kill("SIGTERM");
  }, 120_000);

  it("Test 6 — crash during finalization: one final result, not duplicated or corrupted", async () => {
    for (const point of ["checkpoint.final.after:1", "job.before_terminal_commit:1"]) {
      const log = join(scratch(), "dispatch.log");
      const a = await worker({ CE_DURABLE_DISPATCH_LOG: log, CE_DURABLE_FAULT_INJECTION: "1", CE_DURABLE_FAULT: point });
      const { jobId, token } = await submit(a);
      await a.waitFor(`CE_FAULT_REACHED ${point.split(":")[0]}`);
      await a.kill();
      expect((await jobRow(pool, jobId))?.has_result).toBe(false);
      const b = await worker({ CE_DURABLE_DISPATCH_LOG: log });
      const view = await untilJob(b, jobId, token, finished);
      expect(view.status).toBe("completed");
      expect(researchProjection(view)).toEqual(reference.projection);
      expect(dispatches(log)).toHaveLength(reference.qloo);
      const finals = (await pool.query("SELECT count(*)::int AS n FROM agent_checkpoints WHERE job_id=$1 AND boundary='final'", [jobId])).rows[0].n;
      expect(finals).toBe(1);
      expect((await jobRow(pool, jobId))?.status).toBe("COMPLETED");
      await b.kill("SIGTERM");
    }
  }, 150_000);

  it("Test 7 — lease expiry: a stalled worker is fenced out; only one worker advances the run", async () => {
    const log = join(scratch(), "dispatch.log");
    const a = await worker({ CE_DURABLE_DISPATCH_LOG: log, CE_DURABLE_FAULT_INJECTION: "1", CE_DURABLE_FAULT: "qloo.after_commit:8", CE_DURABLE_FAULT_PAUSE_MS: "6000" });
    const { jobId, token } = await submit(a);
    await a.waitFor("CE_FAULT_REACHED qloo.after_commit");
    a.process.kill("SIGSTOP");
    await sleep(2_000);
    const b = await worker({ CE_DURABLE_DISPATCH_LOG: log });
    const view = await untilJob(b, jobId, token, finished);
    expect(view.status).toBe("completed");
    const bPid = b.process.pid!;
    a.process.kill("SIGCONT");
    await sleep(7_000);
    const sent = dispatches(log);
    expect(sent.filter((d) => d.pid !== bPid)).toHaveLength(8);
    expect(sent).toHaveLength(reference.qloo);
    expect((await jobRow(pool, jobId))?.status).toBe("COMPLETED");
    expect((await jobRow(pool, jobId))?.lease_epoch).toBe(2);
    expect(researchProjection((await getJob(b, jobId, token)).body)).toEqual(reference.projection);
    expect(a.output()).toMatch(/job_lease_lost|job_commit_fenced/u);
    await a.kill();
    await b.kill("SIGTERM");
  }, 90_000);

  it("Test 8 — clarification pending: the user can answer after a restart", async () => {
    const log = join(scratch(), "dispatch.log");
    const a = await worker({ CE_DURABLE_DISPATCH_LOG: log });
    const asked = await submit(a, AMBIGUOUS);
    const waiting = await untilJob(a, asked.jobId, asked.token, finished);
    const run = (waiting.response as { investigation: { runId: string; result: { status: string } } }).investigation;
    expect(run.result.status).toBe("NEEDS_INPUT");
    await a.kill();
    const b = await worker({ CE_DURABLE_DISPATCH_LOG: log, CE_DURABLE_FAULT_INJECTION: "1", CE_DURABLE_FAULT: "qloo.after_commit:2" });
    const continued = await post(b, "/api/agent/jobs", { continueRunId: run.runId, clarification: "SYN-BR-0006" });
    expect(continued.status).toBe(202);
    // Crash during the continuation too: it restarts from the needs_input checkpoint, not from mutated state.
    await b.waitFor("CE_FAULT_REACHED qloo.after_commit");
    await b.kill();
    const c = await worker({ CE_DURABLE_DISPATCH_LOG: log });
    const view = await untilJob(c, String(continued.body.jobId), String(continued.body.accessToken), finished);
    expect(view.status).toBe("completed");
    const result = (view.response as { investigation: { runId: string; result: { status: string; brand: { id: string } } } }).investigation;
    expect(result.runId).toBe(run.runId);
    expect(result.result.status).toBe("COMPLETE");
    expect(result.result.brand.id).toBe("SYN-BR-0006");
    expect(new Set(dispatches(log).map((d) => JSON.stringify([d.operation, d.input]))).size).toBe(dispatches(log).length);
    await c.kill("SIGTERM");
  }, 90_000);

  it("Test 9 — cancellation then restart: cancelled work does not resume", async () => {
    const log = join(scratch(), "dispatch.log");
    const a = await worker({ CE_DURABLE_DISPATCH_LOG: log, CE_DURABLE_FAULT_INJECTION: "1", CE_DURABLE_FAULT: "qloo.after_commit:5" });
    const { jobId, token } = await submit(a);
    await a.waitFor("CE_FAULT_REACHED qloo.after_commit");
    const cancelled = await post(a, `/api/agent/jobs/${jobId}/cancel`, {}, { "x-job-token": token });
    expect(cancelled.status).toBe(200);
    await sleep(300);
    expect((await jobRow(pool, jobId))?.cancel_requested).toBe(true);
    await a.kill();
    const b = await worker({ CE_DURABLE_DISPATCH_LOG: log });
    const view = await untilJob(b, jobId, token, finished);
    expect(view.status).toBe("cancelled");
    await sleep(2_000);
    expect(dispatches(log)).toHaveLength(5);
    expect((await jobRow(pool, jobId))?.status).toBe("CANCELLED");
    await b.kill("SIGTERM");
  }, 90_000);

  it("Test 10 — retention: a result survives restarts for its window, then is cleaned up; tokens stay required", async () => {
    const log = join(scratch(), "dispatch.log");
    const a = await worker({ CE_DURABLE_DISPATCH_LOG: log, CE_AGENT_RETENTION_MS: "4000" });
    const { jobId, token } = await submit(a);
    const done = await untilJob(a, jobId, token, finished);
    expect(done.status).toBe("completed");
    await a.kill();
    const b = await worker({ CE_DURABLE_DISPATCH_LOG: log, CE_AGENT_RETENTION_MS: "4000" });
    const after = await getJob(b, jobId, token);
    expect(after.status).toBe(200);
    expect(researchProjection(after.body)).toEqual(reference.projection);
    // Authorization survives the restart: a wrong token or a guessed id reads as not found.
    expect((await getJob(b, jobId, "wrong-token")).status).toBe(404);
    expect((await getJob(b, "00000000-0000-4000-8000-000000000000", token)).status).toBe(404);
    const manifest = await buildRunManifest(store, jobId);
    expect(manifest?.providerCalls.totals.qlooCommitted).toBe(reference.qloo);
    expect(JSON.stringify(manifest)).not.toContain(token);
    await sleep(4_500);
    await store.sweep();
    const expired = await getJob(b, jobId, token);
    expect(expired.body.status).toBe("expired");
    expect(expired.body.response).toBeNull();
    expect((await pool.query("SELECT count(*)::int AS n FROM agent_checkpoints WHERE job_id=$1", [jobId])).rows[0].n).toBe(0);
    await sleep(4_500);
    await store.sweep();
    expect(await jobRow(pool, jobId)).toBeUndefined();
    expect((await getJob(b, jobId, token)).status).toBe(404);
    await b.kill("SIGTERM");
  }, 90_000);

  it("graceful shutdown (SIGTERM) suspends a running job without a result; the next process finishes it", async () => {
    const log = join(scratch(), "dispatch.log");
    const a = await worker({ CE_DURABLE_DISPATCH_LOG: log, CE_SYNTHETIC_DELAY_MS: "150" });
    const { jobId, token } = await submit(a);
    while (dispatches(log).length < 6) await sleep(50);
    await a.kill("SIGTERM");
    const row = await jobRow(pool, jobId);
    expect(["RUNNING", "RECOVERING"]).toContain(row?.status);
    expect(row?.has_result).toBe(false);
    const b = await worker({ CE_DURABLE_DISPATCH_LOG: log });
    const view = await untilJob(b, jobId, token, finished);
    expect(view.status).toBe("completed");
    expect(researchProjection(view)).toEqual(reference.projection);
    expect(dispatches(log)).toHaveLength(reference.qloo);
    await b.kill("SIGTERM");
  }, 90_000);

  it("a confirmation stays single-use across a restart", async () => {
    const a = await worker({});
    const interpreted = await post(a, "/api/agent/interpret", COMPARE);
    const queryId = String((interpreted.body as { queryId?: string }).queryId ?? (interpreted.body as { telemetry?: { queryId?: string } }).telemetry?.queryId);
    expect(queryId).toMatch(/^[0-9a-f-]{36}$/u);
    const first = await post(a, "/api/agent/jobs", { confirmQueryId: queryId });
    expect(first.status).toBe(202);
    const done = await untilJob(a, String(first.body.jobId), String(first.body.accessToken), finished);
    expect(done.status).toBe("completed");
    await a.kill();
    const b = await worker({});
    const second = await post(b, "/api/agent/jobs", { confirmQueryId: queryId });
    const view = second.status === 202 ? await untilJob(b, String(second.body.jobId), String(second.body.accessToken), finished) : second.body;
    expect(JSON.stringify(view)).toMatch(/QUERY_ALREADY_EXECUTED|query_already_executed/u);
    await b.kill("SIGTERM");
  }, 90_000);
});
