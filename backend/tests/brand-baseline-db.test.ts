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
import { readFileSync } from "node:fs";
import { resetLifecycle } from "../src/ops/lifecycle.js";

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

  it("previews a SYNTHETIC user-proposed direction from an authorized stored scan while paid admission stays closed", async () => {
    const entity = syntheticBrand("Synthetic Proposal Brand", `syn-brand-${randomUUID()}`);
    const scanId = (await repo.createScan({ resolutionId: await resolution(entity), scope, accessToken, idempotencyKey: randomUUID(), requestHash: "syn-proposal-preview" })).id;
    const owner = randomUUID();
    expect(await repo.claim(scanId, owner)).toBe(true);
    const brandRow = await repo.scanBrand(scanId);
    const result = buildBaselineResult({ scanId, brandId: brandRow!.id, brand: entity, brandCapturedAt: "2026-10-25T00:00:00.000Z", observations: [], startedAt: "2026-10-25T00:00:00.000Z", finishedAt: "2026-10-25T00:01:00.000Z", providerCallCount: 0, recordedOrLive: "recorded" });
    expect(await repo.complete(scanId, owner, result)).toBe(true);
    const previous = { CE_BASELINE_ENABLED: process.env.CE_BASELINE_ENABLED, CE_BASELINE_LIVE_ENABLED: process.env.CE_BASELINE_LIVE_ENABLED, CE_BASELINE_TOTAL_QLOO_CALLS: process.env.CE_BASELINE_TOTAL_QLOO_CALLS, CE_ACCEPT_INVESTIGATIONS: process.env.CE_ACCEPT_INVESTIGATIONS, CE_INTERNAL_API_SECRET: process.env.CE_INTERNAL_API_SECRET };
    Object.assign(process.env, { CE_BASELINE_ENABLED: "1", CE_BASELINE_LIVE_ENABLED: "0", CE_BASELINE_TOTAL_QLOO_CALLS: "100", CE_ACCEPT_INVESTIGATIONS: "0", CE_INTERNAL_API_SECRET: "synthetic-secret-for-backend-test-12345" });
    resetLifecycle();
    const app = buildApp({ logLevel: "silent" });
    try {
      const payload = { scanId, proposedDirection: "Ritual hospitality", idempotencyKey: randomUUID() };
      const headers = { "x-ce-internal-auth": "synthetic-secret-for-backend-test-12345", "x-baseline-token": accessToken };
      const preview = await app.inject({ method: "POST", url: "/api/agent/handoff/preview", headers, payload });
      expect(preview.statusCode).toBe(200);
      expect(preview.json()).toMatchObject({ version: "ce-deep-investigation/0.2", evidence: [], territory: { name: "Ritual hospitality", canonicalConcept: "UNVERIFIED" }, agentRequest: { intent: "analyze_move" } });
      expect(preview.json().agentRequest).not.toHaveProperty("researchMode");
      expect((await app.inject({ method: "POST", url: "/api/agent/handoff/preview", headers: { ...headers, "x-baseline-token": "wrong-token" }, payload })).statusCode).toBe(404);
      const blocked = await app.inject({ method: "POST", url: "/api/agent/handoff/jobs", headers, payload });
      expect(blocked.statusCode).toBe(503);
    } finally {
      await app.close();
      for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      resetLifecycle();
    }
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

  it("stops a SYNTHETIC scan immediately when the provider contract drifts", async () => {
    const entity = syntheticBrand("Synthetic Contract Brand", `syn-brand-${randomUUID()}`);
    const scanId = (await repo.createScan({ resolutionId: await resolution(entity), scope, accessToken, idempotencyKey: randomUUID(), requestHash: "syn-contract-drift" })).id;
    const transport = new FixtureTransport(() => ({ schema_version: "SYNTHETIC_INVALID_CONTRACT" }));
    const gate = new BaselineCallGate(repo, transport);
    const worker = new BaselineWorker(repo, gate, "recorded");
    await worker.run(scanId);
    worker.stop();
    expect(transport.calls).toHaveLength(1);
    const scan = await pool.query<{ status: string; partial_failure_summary: string }>("SELECT status,partial_failure_summary FROM baseline_scans WHERE id=$1", [scanId]);
    expect(scan.rows[0]).toMatchObject({ status: "INTERRUPTED", partial_failure_summary: "CONTRACT_DRIFT" });
    const calls = await pool.query<{ status: string; outcome_category: string }>("SELECT status,outcome_category FROM baseline_provider_calls WHERE scan_id=$1", [scanId]);
    expect(calls.rows).toEqual([{ status: "FAILED", outcome_category: "CONTRACT_DRIFT" }]);
  });

  it("keeps a stored 0.1 as-run artifact readable exactly as written", async () => {
    const recorded = JSON.parse(readFileSync(new URL("../../evals/fixtures/live/loewe-baseline-canary-2.live.json", import.meta.url), "utf8")) as { asRunResult: { payload: Record<string, unknown> } };
    const entity = syntheticBrand("Synthetic Legacy Holder", `syn-brand-${randomUUID()}`);
    const scanId = (await repo.createScan({ resolutionId: await resolution(entity), scope, accessToken, idempotencyKey: randomUUID(), requestHash: "syn-legacy" })).id;
    const artifactId = randomUUID();
    await pool.query("INSERT INTO baseline_artifacts (id,scan_id,schema_version,artifact_type,payload) VALUES ($1,$2,'ce-brand-baseline/0.1','result',$3)", [artifactId, scanId, recorded.asRunResult.payload]);
    await pool.query("UPDATE baseline_scans SET status='COMPLETE',result_artifact_id=$2 WHERE id=$1", [scanId, artifactId]);
    const read = await repo.readScan(scanId, accessToken);
    expect(read?.result?.schemaVersion).toBe("ce-brand-baseline/0.1");
    expect(read?.result).toEqual(recorded.asRunResult.payload);
    const stored = await pool.query<{ payload: unknown }>("SELECT payload FROM baseline_artifacts WHERE id=$1", [artifactId]);
    expect(stored.rows[0]?.payload).toEqual(recorded.asRunResult.payload);
  });

  it("captures subtype and the recorded request type, and qualifies generic entities end to end", async () => {
    const entity = syntheticBrand("Synthetic Generic Type Brand", `syn-brand-${randomUUID()}`);
    const scanId = (await repo.createScan({ resolutionId: await resolution(entity), scope, accessToken, idempotencyKey: randomUUID(), requestHash: "syn-generic-workflow" })).id;
    const transport = new FixtureTransport((operation, input) => {
      if (operation === "entity_tags") return envelope("entity_tags", "ok", { interpretation: { entities: [] }, results: [compactTag("urn:tag:genre:media:syn_design", "Design"), compactTag("urn:tag:credit_card:place:syn_card", "SYNTHETIC Card")] });
      const domain = String(input.target_type);
      const requests = [{ method: "GET", path: "/v2/insights", query: { "filter.type": `urn:entity:${domain}`, take: 10 } }];
      const results = [compactEntity(`syn-${domain}-generic`, `Synthetic ${domain}`, "urn:entity"), { ...compactEntity(`syn-${domain}-typed`, `Synthetic typed ${domain}`, "urn:entity"), subtype: `urn:entity:${domain}` }];
      return envelope("recommend", "ok", { interpretation: { signals: [] }, results, provenance: { source: "SYNTHETIC", endpoint: "/v2/insights", documentation: "https://docs.qloo.com/reference/insights-api-deep-dive", requests } });
    });
    const gate = new BaselineCallGate(repo, transport);
    const worker = new BaselineWorker(repo, gate, "recorded");
    await worker.run(scanId);
    worker.stop();
    const read = await repo.readScan(scanId, accessToken);
    const result = read?.result;
    if (result?.schemaVersion !== "ce-brand-baseline/0.2") throw new Error("expected a 0.2 result");
    expect(result.execution.templateVersion).toBe("ce-brand-baseline/v2");
    expect(result.audit.typeEvidence).toEqual({ PROVIDER_CONFIRMED_TYPE: 4, QUERY_SCOPED: 4, GENERIC_TYPE_UNRESOLVED: 0, CONFLICTING_TYPE: 0 });
    expect(result.territories.map((territory) => territory.name)).toEqual(["Design"]);
    expect(result.fingerprint.excluded.map((item) => item.rule)).toEqual(["payment"]);
    expect((transport.calls[0]?.input as { limit?: number }).limit).toBe(20);
    const observations = await pool.query<{ schema_version: string; payload: { recordedRequestType?: string; signals: { subtype?: string }[] } }>("SELECT schema_version,payload FROM baseline_artifacts WHERE scan_id=$1 AND artifact_type='observation' AND stage='artist'", [scanId]);
    expect(observations.rows[0]?.schema_version).toBe("ce-brand-baseline-observation/0.3");
    expect(observations.rows[0]?.payload.recordedRequestType).toBe("urn:entity:artist");
    expect(observations.rows[0]?.payload.signals.map((signal) => signal.subtype ?? null)).toEqual([null, "urn:entity:artist"]);
  }, 60_000);

  it("rejects an exclusion that cites no recorded observation", async () => {
    const entity = syntheticBrand("Synthetic Exclusion Brand", `syn-brand-${randomUUID()}`);
    const scanId = (await repo.createScan({ resolutionId: await resolution(entity), scope, accessToken, idempotencyKey: randomUUID(), requestHash: "syn-exclusion" })).id;
    const owner = randomUUID();
    expect(await repo.claim(scanId, owner)).toBe(true);
    const brandRow = await repo.scanBrand(scanId);
    const observation = syntheticTagObservation([syntheticTag("urn:tag:interests:qloo:craft", "Craft"), syntheticTag("urn:tag:credit_card:place:visa", "Visa")]);
    const callId = await repo.reserveCall(scanId, owner, "tags", "entity_tags", 1);
    await repo.settleCall(callId, { status: "COMPLETE", correlationId: "syn-tags", category: "ok", durationMs: 2 });
    await repo.recordObservation(scanId, owner, observation);
    const result = buildBaselineResult({ scanId, brandId: brandRow!.id, brand: entity, brandCapturedAt: "2026-10-25T00:00:00.000Z", observations: [observation], startedAt: "2026-10-25T00:00:00.000Z", finishedAt: "2026-10-25T00:01:00.000Z", providerCallCount: 1, recordedOrLive: "recorded" });
    const invented = structuredClone(result);
    invented.fingerprint.excluded[0]!.source.correlationId = "syn-not-recorded";
    await expect(repo.complete(scanId, owner, invented)).rejects.toMatchObject({ code: "UNRECORDED_EVIDENCE" });
    expect(await repo.complete(scanId, owner, result)).toBe(true);
  });
});
