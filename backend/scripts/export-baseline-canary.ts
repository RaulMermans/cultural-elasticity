/** Read-only recovery of the complete stored, normalized canary artifacts. No Qloo or model imports. */
import { writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { createBaselinePool } from "../src/brand-baseline/db.js";
import { loadLocalEnvFile } from "../src/config/env.js";
import { brandBaselineResultSchema } from "../src/brand-baseline/schema.js";

loadLocalEnvFile();
const scanId = z.uuid().parse(process.env.CE_CANARY_SCAN_ID);
const outputDirectory = process.env.CE_CANARY_OUTPUT_DIR;
const expectedDirectory = process.env.CE_CANARY_EXPECTED_DATA_DIRECTORY;
const expectedSystem = process.env.CE_CANARY_EXPECTED_SYSTEM_IDENTIFIER;
if (!outputDirectory || !isAbsolute(outputDirectory) || !expectedDirectory || !expectedSystem) throw new Error("CANARY_EXPORT_NOT_CONFIGURED");
const pool = createBaselinePool(process.env.DATABASE_URL);
try {
  const identity = await pool.query<{ database: string; db_user: string; server_address: string | null; system_identifier: string; data_directory: string; socket_directory: string }>(
    "SELECT current_database() AS database,current_user AS db_user,inet_server_addr()::text AS server_address,(pg_control_system()).system_identifier::text AS system_identifier,current_setting('data_directory') AS data_directory,current_setting('unix_socket_directories') AS socket_directory",
  );
  const target = identity.rows[0];
  if (!target || target.database !== "ce9d_loewe_canary" || target.db_user !== "ce9d_operator" || target.server_address !== null || target.system_identifier !== expectedSystem || realpathSync(target.data_directory) !== realpathSync(expectedDirectory) || realpathSync(target.socket_directory) !== realpathSync(join(expectedDirectory, "..", "socket"))) throw new Error("CANARY_EXPORT_DATABASE_IDENTITY_MISMATCH");
  const scan = await pool.query("SELECT id,brand_id,resolution_id,template_version,schema_version,status,requested_at,started_at,finished_at,provider_call_count,partial_failure_summary,result_artifact_id,cache_source_scan_id FROM baseline_scans WHERE id=$1", [scanId]);
  if (scan.rows.length !== 1 || scan.rows[0].status !== "COMPLETE") throw new Error("CANARY_EXPORT_SCAN_NOT_COMPLETE");
  const brand = await pool.query("SELECT b.id,b.qloo_id,b.name,b.qloo_type,b.verified_at FROM baseline_brands b JOIN baseline_scans s ON s.brand_id=b.id WHERE s.id=$1", [scanId]);
  const resolution = await pool.query("SELECT r.id,r.input_name,r.selected_qloo_id,r.status,r.candidates,r.provider_correlation_id,r.created_at,r.finished_at FROM baseline_resolutions r JOIN baseline_scans s ON s.resolution_id=r.id WHERE s.id=$1", [scanId]);
  const calls = await pool.query("SELECT id,scan_id,resolution_id,stage,operation,attempt,status,provider_correlation_id,outcome_category,unknown_outcome,dispatched_at,finished_at,duration_ms FROM baseline_provider_calls ORDER BY dispatched_at,id");
  const artifacts = await pool.query("SELECT id,scan_id,stage,schema_version,artifact_type,payload,source_correlation_ids,created_at FROM baseline_artifacts WHERE scan_id=$1 ORDER BY created_at,id", [scanId]);
  const stages = await pool.query("SELECT stage,attempt,status,started_at,finished_at,outcome,error_class,qloo_correlation_id FROM baseline_stages WHERE scan_id=$1 ORDER BY stage,attempt", [scanId]);
  const events = await pool.query("SELECT id,event_type,stage,occurred_at,metadata,error_class FROM baseline_execution_events WHERE scan_id=$1 ORDER BY occurred_at,id", [scanId]);
  const reservations = await pool.query("SELECT r.provider_call_id,r.reserved_calls,r.observed_calls,r.state,r.created_at,r.settled_at FROM baseline_budget_reservations r ORDER BY r.created_at,r.id");
  const budget = await pool.query("SELECT budget_key,limit_calls,used_calls,updated_at FROM baseline_budget_accounts WHERE budget_key='qloo'");
  const migrations = await pool.query("SELECT name,checksum,applied_at FROM baseline_schema_migrations ORDER BY name");
  if (brand.rows[0]?.name !== "Loewe" || resolution.rows[0]?.status !== "RESOLVED" || calls.rows.length > 7 || calls.rows.some((call) => call.status !== "COMPLETE" || call.unknown_outcome) || artifacts.rows.length !== 6 || artifacts.rows.filter((item) => item.artifact_type === "result").length !== 1 || budget.rows[0]?.used_calls !== calls.rows.length) throw new Error("CANARY_EXPORT_INTEGRITY_FAILED");
  brandBaselineResultSchema.parse(artifacts.rows.find((item) => item.artifact_type === "result")!.payload);
  const output = { fixtureType: "live", exportedAt: new Date().toISOString(), identity: { database: target.database, systemIdentifier: target.system_identifier, dataDirectory: target.data_directory, socketDirectory: target.socket_directory }, scan: scan.rows[0], brand: brand.rows[0], resolution: resolution.rows[0], calls: calls.rows, artifacts: artifacts.rows, stages: stages.rows, events: events.rows, reservations: reservations.rows, budget: budget.rows[0], migrations: migrations.rows };
  await writeFile(join(outputDirectory, "canary-run.json"), `${JSON.stringify(output, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ export: "COMPLETE", calls: calls.rows.length, artifacts: artifacts.rows.length, status: scan.rows[0].status }));
} catch (error) {
  console.error(error instanceof Error && error.message.startsWith("CANARY_EXPORT_") ? error.message : "CANARY_EXPORT_FAILED");
  process.exitCode = 1;
} finally {
  await pool.end();
}
