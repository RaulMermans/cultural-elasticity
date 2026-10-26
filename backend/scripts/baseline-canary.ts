/** One bounded live Qloo canary. No model import and no Anthropic call. */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { loadLocalEnvFile } from "../src/config/env.js";
import { createBaselinePool, migrate } from "../src/brand-baseline/db.js";
import { BaselineRepository, payloadHash } from "../src/brand-baseline/repository.js";
import { resolveBrand } from "../src/brand-baseline/research.js";
import { BaselineWorker, createLiveBaselineCallGate } from "../src/brand-baseline/worker.js";

loadLocalEnvFile();
const brandName = process.argv[2]?.trim() || "Loewe";
const selectedQlooId = process.argv[3]?.trim() || undefined;
const pool = createBaselinePool(process.env.DATABASE_URL);
const repository = new BaselineRepository(pool);
let gate: ReturnType<typeof createLiveBaselineCallGate> | null = null;
let resolutionId: string | null = null;
let scanId: string | null = null;
let accessToken: string;
let migrationNames: string[] = [];
let databaseIdentity: { database: string; systemIdentifier: string; dataDirectory: string; socketDirectory: string } | null = null;
const outputDirectory = process.env.CE_CANARY_OUTPUT_DIR;

/** The target must be a newly created local cluster, reached only through its private Unix socket. */
async function verifyIsolatedDatabase(): Promise<NonNullable<typeof databaseIdentity>> {
  const connection = process.env.DATABASE_URL;
  const expectedDirectory = process.env.CE_CANARY_EXPECTED_DATA_DIRECTORY;
  const expectedSystem = process.env.CE_CANARY_EXPECTED_SYSTEM_IDENTIFIER;
  if (!connection || !expectedDirectory || !expectedSystem || !outputDirectory || !isAbsolute(outputDirectory)) throw new Error("CANARY_DATABASE_IDENTITY_NOT_CONFIGURED");
  const url = new URL(connection);
  const socket = url.searchParams.get("host");
  if (url.protocol !== "postgresql:" || url.hostname !== "localhost" || url.port !== "55439" || url.pathname !== "/ce9d_loewe_canary" || url.username !== "ce9d_operator" || !socket || !isAbsolute(socket)) throw new Error("CANARY_DATABASE_NOT_ISOLATED");
  const expectedReal = realpathSync(expectedDirectory);
  const socketReal = realpathSync(socket);
  if (!expectedReal.startsWith("/private/tmp/ce9d-loewe-") || socketReal !== join(expectedReal, "..", "socket") || statSync(expectedReal).uid !== (process.getuid?.() ?? -1)) throw new Error("CANARY_DATABASE_NOT_ISOLATED");
  const result = await pool.query<{ database: string; db_user: string; server_address: string | null; system_identifier: string; data_directory: string; socket_directory: string; user_tables: string }>(
    "SELECT current_database() AS database, current_user AS db_user, inet_server_addr()::text AS server_address, (pg_control_system()).system_identifier::text AS system_identifier, current_setting('data_directory') AS data_directory, current_setting('unix_socket_directories') AS socket_directory, (SELECT count(*)::text FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')) AS user_tables",
  );
  const row = result.rows[0];
  if (!row || row.database !== "ce9d_loewe_canary" || row.db_user !== "ce9d_operator" || row.server_address !== null || row.system_identifier !== expectedSystem || realpathSync(row.data_directory) !== expectedReal || realpathSync(row.socket_directory) !== socketReal || row.user_tables !== "0") throw new Error("CANARY_DATABASE_IDENTITY_MISMATCH");
  return { database: row.database, systemIdentifier: row.system_identifier, dataDirectory: expectedReal, socketDirectory: socketReal };
}

try {
  databaseIdentity = await verifyIsolatedDatabase();
  await mkdir(outputDirectory!, { recursive: true, mode: 0o700 });
  await writeFile(join(outputDirectory!, "database-preflight.json"), `${JSON.stringify({ databaseIdentity, checkedAt: new Date().toISOString(), userTablesBeforeMigration: 0 }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  migrationNames = await migrate(pool);
  const before = await repository.budgetSnapshot();
  if (before.usedCalls !== 0) throw new Error("CANARY_DATABASE_MUST_HAVE_ZERO_PRIOR_CALLS");
  await repository.setQlooCallLimit(7);
  gate = createLiveBaselineCallGate(repository);
  const scope = `canary-${randomUUID()}`;
  accessToken = randomBytes(32).toString("base64url");
  resolutionId = await repository.createResolution(scope, accessToken, brandName, selectedQlooId);
  const resolution = await resolveBrand(gate.scoped({ resolutionId }), brandName, selectedQlooId);
  await repository.finishResolution(resolutionId, resolution.status === "RESOLVED" ? { status: "RESOLVED", entity: resolution.entity } : resolution.status === "AMBIGUOUS" ? { status: "AMBIGUOUS", candidates: resolution.candidates } : { status: resolution.status }, resolution.status === "RESOLVED" ? resolution.entity.provenance[0]?.correlationId : undefined);
  if (resolution.status !== "RESOLVED") {
    console.log(JSON.stringify({ canary: "NOT_COMPLETED", resolutionStatus: resolution.status, candidates: resolution.status === "AMBIGUOUS" ? resolution.candidates : [], usedCalls: (await repository.budgetSnapshot()).usedCalls }));
    process.exitCode = 2;
  } else {
    const idempotencyKey = `canary-${randomUUID()}`;
    const requestHash = payloadHash({ resolutionId });
    const created = await repository.createScan({ resolutionId, scope, accessToken, idempotencyKey, requestHash });
    scanId = created.id;
    const worker = new BaselineWorker(repository, gate);
    const started = performance.now();
    await worker.run(created.id);
    const first = await repository.readScan(created.id, accessToken);
    const beforeRepeat = await repository.budgetSnapshot();
    const repeated = await repository.createScan({ resolutionId, scope, accessToken, idempotencyKey, requestHash });
    const afterRepeat = await repository.budgetSnapshot();
    if (!repeated.reused || repeated.id !== created.id || afterRepeat.usedCalls !== beforeRepeat.usedCalls) throw new Error("IDEMPOTENT_REPEAT_FAILED");
    const calls = await pool.query<{ operation: string; status: string; provider_correlation_id: string | null; outcome_category: string | null; duration_ms: number | null }>("SELECT operation,status,provider_correlation_id,outcome_category,duration_ms FROM baseline_provider_calls WHERE resolution_id=$1 OR scan_id=$2 ORDER BY dispatched_at,id", [resolutionId, created.id]);
    if (calls.rows.length > 7) throw new Error("CANARY_CALL_CAP_BREACHED");
    const reopened = createBaselinePool(process.env.DATABASE_URL);
    let persisted: Awaited<ReturnType<BaselineRepository["readScan"]>>;
    try { persisted = await new BaselineRepository(reopened).readScan(created.id, accessToken); } finally { await reopened.end(); }
    console.log(JSON.stringify({
      canary: persisted?.result ? "COMPLETED" : "INCOMPLETE",
      scanId: created.id,
      resolutionStatus: resolution.status,
      scanStatus: persisted?.status,
      totalQlooCalls: calls.rows.length,
      scanQlooCalls: first?.providerCallCount,
      durationMs: Math.round(performance.now() - started),
      idempotentRepeatNewCalls: afterRepeat.usedCalls - beforeRepeat.usedCalls,
      persistedAfterReconnect: Boolean(persisted?.result),
      calls: calls.rows,
      coverage: persisted?.result?.fingerprint.domainCoverage,
      signals: persisted?.result?.fingerprint.signals.map((signal) => ({ id: signal.id, name: signal.name, domain: signal.domain, correlationId: signal.source.correlationId })),
      territories: persisted?.result?.territories.map((territory) => ({ name: territory.name, concept: territory.canonicalConcept, status: territory.evidenceStatus, correlationIds: territory.supportingReferences.map((ref) => ref.correlationId) })),
      limitations: persisted?.result?.fingerprint.limitations,
    }));
    if (!persisted?.result) process.exitCode = 3;
  }
} catch (error) {
  console.error(error instanceof Error && /^(CANARY_|IDEMPOTENT_|DATABASE_NOT_CONFIGURED|QLOO_NOT_CONFIGURED|QLOO_HOST_NOT_VERIFIED|BASELINE_QLOO_SPACING_UNSAFE)/u.test(error.message) ? error.message : "LIVE_QLOO_BASELINE_FAILED");
  process.exitCode = 1;
} finally {
  gate?.close();
  if (databaseIdentity && outputDirectory) {
    try {
      const calls = await pool.query("SELECT id,scan_id,resolution_id,stage,operation,attempt,status,provider_correlation_id,outcome_category,unknown_outcome,dispatched_at,finished_at,duration_ms FROM baseline_provider_calls ORDER BY dispatched_at,id");
      const artifacts = scanId ? await pool.query("SELECT id,scan_id,stage,schema_version,artifact_type,payload,source_correlation_ids,created_at FROM baseline_artifacts WHERE scan_id=$1 ORDER BY created_at,id", [scanId]) : { rows: [] };
      const stages = scanId ? await pool.query("SELECT stage,attempt,status,started_at,finished_at,outcome,error_class,qloo_correlation_id FROM baseline_stages WHERE scan_id=$1 ORDER BY stage,attempt", [scanId]) : { rows: [] };
      const scan = scanId ? await pool.query("SELECT id,status,provider_call_count,started_at,finished_at,result_artifact_id,partial_failure_summary FROM baseline_scans WHERE id=$1", [scanId]) : { rows: [] };
      const budget = migrationNames.length ? await repository.budgetSnapshot() : null;
      await writeFile(join(outputDirectory, "canary-run.json"), `${JSON.stringify({ fixtureType: "live", brand: brandName, databaseIdentity, migrationNames, resolutionId, scanId, scan: scan.rows[0] ?? null, budget, calls: calls.rows, stages: stages.rows, artifacts: artifacts.rows }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      console.log("CANARY_ARTIFACT_SAVED");
    } catch { console.error("CANARY_ARTIFACT_EXPORT_FAILED"); process.exitCode = 1; }
  }
  if (!pool.ended) await pool.end();
}
