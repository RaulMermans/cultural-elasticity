import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildBaselineResult } from "../src/brand-baseline/research.js";
import { createBaselinePool, databaseReady, migrate, type Database } from "../src/brand-baseline/db.js";
import { BaselineRepository } from "../src/brand-baseline/repository.js";
import { syntheticBrand, syntheticTag, syntheticTagObservation } from "./fixtures/synthetic/brand-baseline.js";
import { buildApp } from "../src/app.js";
import { BaselineCallGate, BaselineWorker } from "../src/brand-baseline/worker.js";
import { compactEntity, compactTag, envelope, FixtureTransport } from "./fixtures/synthetic/envelopes.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED_FOR_REAL_POSTGRES_TESTS");
const url = process.env.DATABASE_URL;
let pool: Database;
let repo: BaselineRepository;
const accessToken = randomUUID();
const scope = `syn-${randomUUID()}`;
const brand = syntheticBrand("Northwind Atelier", `syn-brand-${randomUUID()}`);

async function resolution(entity = brand) {
  const id = await repo.createResolution(scope, accessToken, entity.label);
  const callId = await repo.reserveResolutionCall(id, 1);
  await repo.settleCall(callId, { status: "COMPLETE", correlationId: "syn-describe", category: "ok", durationMs: 1 });
  await repo.finishResolution(id, { status: "RESOLVED", entity }, "syn-describe");
  return id;
}

beforeAll(async () => {
  pool = createBaselinePool(url);
  await migrate(pool);
  repo = new BaselineRepository(pool);
  await repo.setQlooCallLimit(100);
});
afterAll(async () => { await pool?.end(); });

describe("REAL POSTGRES synthetic baseline durability", () => {
  it("repeats the checked migration without applying it twice", async () => {
    expect(await migrate(pool)).toEqual([]);
    expect(await databaseReady(pool)).toBe(true);
  });

  it("creates one scan for simultaneous idempotent requests and rejects payload conflicts", async () => {
    const resolutionId = await resolution();
    const input = { resolutionId, scope, accessToken, idempotencyKey: randomUUID(), requestHash: "syn-request-a" };
    const [a, b] = await Promise.all([repo.createScan(input), repo.createScan(input)]);
    expect(a.id).toBe(b.id);
    expect([a.reused, b.reused].sort()).toEqual([false, true]);
    await expect(repo.createScan({ ...input, requestHash: "syn-request-b" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(repo.createScan({ ...input, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "SCAN_IN_PROGRESS" });
  });

  it("enforces foreign keys and transaction rollback", async () => {
    const before = await pool.query<{ count: string }>("SELECT count(*) FROM baseline_scans");
    await expect(pool.query("INSERT INTO baseline_scans (id,brand_id,resolution_id,template_version,schema_version,status,access_scope,access_token_hash,idempotency_key,request_hash) VALUES ($1,$2,$3,'x','x','QUEUED','x','x','x','x')", [randomUUID(), randomUUID(), randomUUID()])).rejects.toThrow();
    const after = await pool.query<{ count: string }>("SELECT count(*) FROM baseline_scans");
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it("reserves provider calls atomically and never refunds uncertain dispatches", async () => {
    const id = (await repo.createScan({ resolutionId: await resolution(syntheticBrand("Synthetic Budget Brand", `syn-brand-${randomUUID()}`)), scope, accessToken, idempotencyKey: randomUUID(), requestHash: "syn-budget" })).id;
    const owner = randomUUID();
    expect(await repo.claim(id, owner)).toBe(true);
    const before = await repo.budgetSnapshot();
    const callId = await repo.reserveCall(id, owner, "tags", "entity_tags", 1);
    await repo.settleCall(callId, { status: "UNKNOWN", category: "SYNTHETIC_TIMEOUT", durationMs: 9 });
    await repo.settleCall(callId, { status: "COMPLETE", category: "late", durationMs: 10 });
    const after = await repo.budgetSnapshot();
    expect(after.usedCalls).toBe(before.usedCalls + 1);
    const call = await pool.query<{ status: string; unknown_outcome: boolean }>("SELECT status,unknown_outcome FROM baseline_provider_calls WHERE id=$1", [callId]);
    expect(call.rows[0]).toMatchObject({ status: "UNKNOWN", unknown_outcome: true });
  });

  it("survives a new connection pool after completion and validates artifacts", async () => {
    const entity = syntheticBrand("Synthetic Pool Restart Brand", `syn-brand-${randomUUID()}`);
    const scanId = (await repo.createScan({ resolutionId: await resolution(entity), scope, accessToken, idempotencyKey: randomUUID(), requestHash: "syn-restart" })).id;
    const owner = randomUUID();
    expect(await repo.claim(scanId, owner)).toBe(true);
    const brandRow = await repo.scanBrand(scanId);
    const observation = syntheticTagObservation([syntheticTag("urn:tag:interests:qloo:craft", "Craft")]);
    const callId = await repo.reserveCall(scanId, owner, "tags", "entity_tags", 1);
    await repo.settleCall(callId, { status: "COMPLETE", correlationId: "syn-tags", category: "ok", durationMs: 2 });
    await repo.recordObservation(scanId, owner, observation);
    const result = buildBaselineResult({ scanId, brandId: brandRow!.id, brand: entity, brandCapturedAt: "2026-10-25T00:00:00.000Z", observations: [observation], startedAt: "2026-10-25T00:00:00.000Z", finishedAt: "2026-10-25T00:01:00.000Z", providerCallCount: 1, recordedOrLive: "recorded" });
    const invented = structuredClone(result);
    invented.fingerprint.signals[0]!.source.sourceId = "syn-invented-id";
    await expect(repo.complete(scanId, owner, invented)).rejects.toMatchObject({ code: "UNRECORDED_EVIDENCE" });
    expect(await repo.complete(scanId, owner, result)).toBe(true);
    expect(await repo.complete(scanId, owner, result)).toBe(false);
    const restartedPool = createBaselinePool(url);
    try {
      const restarted = new BaselineRepository(restartedPool);
      const read = await restarted.readScan(scanId, accessToken);
      expect(read?.status).toBe("COMPLETE");
      expect(read?.result?.territories).toHaveLength(1);
      expect(await restarted.readScan(scanId, "wrong-token")).toBeNull();
    } finally { await restartedPool.end(); }
  });

  it("interrupts stale workers and marks in-flight calls unknown without replay", async () => {
    const scanId = (await repo.createScan({ resolutionId: await resolution(syntheticBrand("Synthetic Stale Brand", `syn-brand-${randomUUID()}`)), scope, accessToken, idempotencyKey: randomUUID(), requestHash: "syn-stale" })).id;
    const owner = randomUUID();
    expect(await repo.claim(scanId, owner)).toBe(true);
    const callId = await repo.reserveCall(scanId, owner, "tags", "entity_tags", 1);
    await pool.query("UPDATE baseline_scans SET lease_until=now()-interval '1 minute' WHERE id=$1", [scanId]);
    expect(await repo.recoverStale()).toBeGreaterThanOrEqual(1);
    const read = await repo.readScan(scanId, accessToken);
    expect(read?.status).toBe("INTERRUPTED");
    const call = await pool.query<{ status: string }>("SELECT status FROM baseline_provider_calls WHERE id=$1", [callId]);
    expect(call.rows[0]?.status).toBe("UNKNOWN");
    expect(await repo.claim(scanId, randomUUID())).toBe(false);
  });

  it("returns an inspectable error for a corrupted stored artifact", async () => {
    const entity = syntheticBrand("Synthetic Corrupt Brand", `syn-brand-${randomUUID()}`);
    const scanId = (await repo.createScan({ resolutionId: await resolution(entity), scope, accessToken, idempotencyKey: randomUUID(), requestHash: "syn-corrupt" })).id;
    const owner = randomUUID();
    expect(await repo.claim(scanId, owner)).toBe(true);
    const brandRow = await repo.scanBrand(scanId);
    const result = buildBaselineResult({ scanId, brandId: brandRow!.id, brand: entity, brandCapturedAt: "2026-10-25T00:00:00.000Z", observations: [], startedAt: "2026-10-25T00:00:00.000Z", finishedAt: "2026-10-25T00:01:00.000Z", providerCallCount: 0, recordedOrLive: "recorded" });
    await repo.complete(scanId, owner, result);
    await pool.query("UPDATE baseline_artifacts SET payload='{}'::jsonb WHERE id=(SELECT result_artifact_id FROM baseline_scans WHERE id=$1)", [scanId]);
    await expect(repo.readScan(scanId, accessToken)).rejects.toMatchObject({ code: "RESULT_ARTIFACT_CORRUPT" });
  });

  it("reports an unreachable database without leaking a connection string", async () => {
    const unavailable = createBaselinePool("postgresql://synthetic@127.0.0.1:1/absent");
    try { expect(await databaseReady(unavailable)).toBe(false); } finally { await unavailable.end(); }
  });

  it("denies direct callers and spoofed browser identity before any provider call", async () => {
    const previous = { CE_BASELINE_ENABLED: process.env.CE_BASELINE_ENABLED, CE_BASELINE_LIVE_ENABLED: process.env.CE_BASELINE_LIVE_ENABLED, CE_INTERNAL_API_SECRET: process.env.CE_INTERNAL_API_SECRET, CE_BASELINE_TOTAL_QLOO_CALLS: process.env.CE_BASELINE_TOTAL_QLOO_CALLS };
    Object.assign(process.env, { CE_BASELINE_ENABLED: "1", CE_BASELINE_LIVE_ENABLED: "0", CE_INTERNAL_API_SECRET: "synthetic-secret-for-backend-test-12345", CE_BASELINE_TOTAL_QLOO_CALLS: "100" });
    const app = buildApp({ logLevel: "silent" });
    try {
      const before = await repo.budgetSnapshot();
      expect((await app.inject({ method: "POST", url: "/api/brands/resolve", payload: { name: "Northwind Atelier" }, headers: { "x-ce-visitor": "spoofed-browser-identity-1234" } })).statusCode).toBe(401);
      expect((await app.inject({ method: "POST", url: "/api/brands/resolve", payload: { name: "Northwind Atelier" }, headers: { "x-ce-internal-auth": "synthetic-secret-for-backend-test-12345" } })).statusCode).toBe(503);
      expect((await repo.budgetSnapshot()).usedCalls).toBe(before.usedCalls);
    } finally {
      await app.close();
      for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });

  it("exposes database diagnostics only to the operator while baseline admission is paused", async () => {
    const previous = { CE_BASELINE_ENABLED: process.env.CE_BASELINE_ENABLED, CE_BASELINE_LIVE_ENABLED: process.env.CE_BASELINE_LIVE_ENABLED, CE_OPERATOR_TOKEN: process.env.CE_OPERATOR_TOKEN };
    Object.assign(process.env, { CE_BASELINE_ENABLED: "0", CE_BASELINE_LIVE_ENABLED: "0", CE_OPERATOR_TOKEN: "synthetic-operator-token" });
    const app = buildApp({ logLevel: "silent" });
    try {
      expect((await app.inject({ method: "GET", url: "/ops/baselines" })).statusCode).toBe(404);
      const response = await app.inject({ method: "GET", url: "/ops/baselines", headers: { "x-ce-operator": "synthetic-operator-token" } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ enabled: false, liveEnabled: false, databaseReady: true, migrationCount: 1 });
      expect(response.body).not.toContain("postgresql://");
    } finally {
      await app.close();
      for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });

  it("retrieves the same completed result after a real backend process restart", async () => {
    const entity = syntheticBrand("Synthetic Restart Brand", `syn-brand-${randomUUID()}`);
    const scanId = (await repo.createScan({ resolutionId: await resolution(entity), scope, accessToken, idempotencyKey: randomUUID(), requestHash: "syn-process-restart" })).id;
    const owner = randomUUID();
    expect(await repo.claim(scanId, owner)).toBe(true);
    const brandRow = await repo.scanBrand(scanId);
    const observation = syntheticTagObservation([syntheticTag("urn:tag:interests:qloo:design", "Design")]);
    const callId = await repo.reserveCall(scanId, owner, "tags", "entity_tags", 1);
    await repo.settleCall(callId, { status: "COMPLETE", correlationId: "syn-tags", category: "ok", durationMs: 2 });
    await repo.recordObservation(scanId, owner, observation);
    const result = buildBaselineResult({ scanId, brandId: brandRow!.id, brand: entity, brandCapturedAt: "2026-10-25T00:00:00.000Z", observations: [observation], startedAt: "2026-10-25T00:00:00.000Z", finishedAt: "2026-10-25T00:01:00.000Z", providerCallCount: 1, recordedOrLive: "recorded" });
    expect(await repo.complete(scanId, owner, result)).toBe(true);
    const backendCwd = fileURLToPath(new URL("../", import.meta.url));
    const port = 46_000 + Math.floor(Math.random() * 1_000);
    const launch = async () => {
      const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/index.ts"], { cwd: backendCwd, stdio: "ignore", env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", NODE_ENV: "test", CE_ACCEPT_INVESTIGATIONS: "0", CE_BASELINE_ENABLED: "1", CE_BASELINE_LIVE_ENABLED: "0", CE_BASELINE_TOTAL_QLOO_CALLS: "100", CE_INTERNAL_API_SECRET: "synthetic-secret-for-backend-test-12345" } });
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (child.exitCode !== null) throw new Error("BACKEND_PROCESS_EXITED");
        try {
          const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(100) });
          if (response.ok) return child;
        } catch { /* Still starting. */ }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      child.kill("SIGTERM");
      throw new Error("BACKEND_PROCESS_START_TIMEOUT");
    };
    for (let cycle = 0; cycle < 2; cycle += 1) {
      const child = await launch();
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/brands/baselines/${scanId}`, { headers: { "x-ce-internal-auth": "synthetic-secret-for-backend-test-12345", "x-baseline-token": accessToken } });
        expect(response.status).toBe(200);
        const body = await response.json() as { result?: { scanId: string } };
        expect(body.result?.scanId).toBe(scanId);
      } finally {
        child.kill("SIGTERM");
        await new Promise((resolve) => child.once("exit", resolve));
      }
    }
  }, 30_000);

  it("runs the full deterministic workflow over SYNTHETIC Qloo transport with five recorded dispatches", async () => {
    const entity = syntheticBrand("Synthetic Workflow Brand", `syn-brand-${randomUUID()}`);
    const scanId = (await repo.createScan({ resolutionId: await resolution(entity), scope, accessToken, idempotencyKey: randomUUID(), requestHash: "syn-full-workflow" })).id;
    const transport = new FixtureTransport((operation, input) => operation === "entity_tags"
      ? envelope("entity_tags", "ok", { interpretation: { entities: [] }, results: [compactTag("urn:tag:interests:qloo:craft", "Craft")] })
      : envelope("recommend", "ok", { interpretation: { signals: [] }, results: [compactEntity(`syn-${String(input.target_type)}-1`, `Synthetic ${String(input.target_type)}`, `urn:entity:${String(input.target_type)}`)] }));
    const gate = new BaselineCallGate(repo, transport);
    const worker = new BaselineWorker(repo, gate, "recorded");
    const before = await repo.budgetSnapshot();
    await worker.run(scanId);
    worker.stop();
    const read = await repo.readScan(scanId, accessToken);
    expect(read?.status).toBe("COMPLETE");
    expect(read?.providerCallCount).toBe(5);
    expect(read?.result?.territories.map((territory) => territory.canonicalConcept)).toEqual(["urn:tag:interests:qloo:craft"]);
    expect(read?.result?.fingerprint.domainCoverage).toHaveLength(5);
    expect((await repo.budgetSnapshot()).usedCalls).toBe(before.usedCalls + 5);
    expect(transport.calls).toHaveLength(5);
    const artifacts = await pool.query<{ count: string }>("SELECT count(*) FROM baseline_artifacts WHERE scan_id=$1 AND artifact_type='observation'", [scanId]);
    expect(Number(artifacts.rows[0]?.count)).toBe(5);
  }, 60_000);
});
