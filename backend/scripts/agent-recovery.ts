/**
 * Sprint 10C operator tool for durable agent jobs (DATABASE_URL; no provider call, no credential printed).
 *
 *   pnpm agent:recovery -- list                         quarantined (INTERRUPTED_UNCERTAIN) and active jobs
 *   pnpm agent:recovery -- inspect <jobId>              status, provider-call journal summary, checkpoints, events
 *   pnpm agent:recovery -- authorize <jobId>            accept the unknown outcomes (they stay charged) and queue the
 *                                                       job for recovery; a re-request may dispatch them again
 *   pnpm agent:recovery -- manifest <jobId> [--out f]   export the run manifest (evidence ledger + decisions + result)
 *
 * `authorize` is an explicit, bounded decision: it never runs without a job id, never touches a job that is not
 * quarantined, and is recorded as an UNKNOWN_OUTCOME_AUTHORIZED event.
 */
import { writeFileSync } from "node:fs";
import { createBaselinePool } from "../src/brand-baseline/db.js";
import { DurableAgentStore } from "../src/agent/durable/store.js";
import { buildRunManifest } from "../src/agent/durable/manifest.js";

const [command, jobId, ...rest] = process.argv.slice(2).filter((arg) => arg !== "--");
const pool = createBaselinePool(process.env.DATABASE_URL);
const store = new DurableAgentStore(pool);

async function main(): Promise<number> {
  if (!(await store.schemaReady())) {
    console.error("DURABLE_SCHEMA_MISSING: apply migration 002_durable_agent.sql with pnpm db:migrate");
    return 2;
  }
  if (command === "list") {
    const result = await pool.query(
      `SELECT j.id, j.status, j.attempt, j.error_code, j.created_at, count(c.*) FILTER (WHERE c.status IN ('OUTCOME_UNKNOWN','DISPATCHING')) AS unknown
       FROM agent_jobs j LEFT JOIN agent_provider_calls c ON c.job_id = j.id
       WHERE j.status IN ('INTERRUPTED_UNCERTAIN','QUEUED','RUNNING','RECOVERING') GROUP BY j.id ORDER BY j.created_at`,
    );
    for (const row of result.rows) console.log(`${row.id} ${row.status} attempt=${row.attempt} unknown=${row.unknown} ${row.error_code ?? ""}`);
    if (result.rows.length === 0) console.log("NO_ACTIVE_OR_QUARANTINED_JOBS");
    return 0;
  }
  if (!jobId || !/^[0-9a-f-]{36}$/u.test(jobId)) {
    console.error("usage: agent-recovery list | inspect <jobId> | authorize <jobId> | manifest <jobId> [--out file]");
    return 2;
  }
  if (command === "inspect") {
    const job = await store.getJob(jobId);
    if (!job) return notFound();
    const calls = await store.calls(jobId);
    const byStatus = calls.reduce<Record<string, number>>((acc, c) => ({ ...acc, [`${c.provider}:${c.status}`]: (acc[`${c.provider}:${c.status}`] ?? 0) + 1 }), {});
    console.log(JSON.stringify({ id: job.id, status: job.status, kind: job.kind, attempt: job.attempt, leaseEpoch: job.leaseEpoch, deadlineAt: job.deadlineAt, cancelRequested: job.cancelRequested, errorCode: job.errorCode, runId: job.runId, calls: byStatus, unknown: calls.filter((c) => c.status === "OUTCOME_UNKNOWN" || c.status === "DISPATCHING").map((c) => ({ opKey: c.opKey, operation: c.operation, dispatchCount: c.dispatchCount })), checkpoints: (await store.jobCheckpoints(jobId)).map((c) => ({ seq: c.seq, boundary: c.boundary, digest: c.digest.slice(0, 16) })), events: await store.events(jobId) }, null, 2));
    return 0;
  }
  if (command === "authorize") {
    const ok = await store.authorizeUnknown(jobId);
    console.log(ok ? `UNKNOWN_OUTCOME_AUTHORIZED ${jobId}: queued for recovery; unknown calls stay charged` : `NOT_QUARANTINED ${jobId}: nothing changed`);
    return ok ? 0 : 1;
  }
  if (command === "manifest") {
    const manifest = await buildRunManifest(store, jobId);
    if (!manifest) return notFound();
    const outIndex = rest.indexOf("--out");
    const text = `${JSON.stringify(manifest, null, 2)}\n`;
    if (outIndex >= 0 && rest[outIndex + 1]) writeFileSync(rest[outIndex + 1]!, text);
    else process.stdout.write(text);
    return 0;
  }
  console.error(`unknown command ${command ?? "(none)"}`);
  return 2;
}

function notFound(): number {
  console.error("JOB_NOT_FOUND");
  return 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message.slice(0, 300) : "AGENT_RECOVERY_FAILED");
  process.exitCode = 1;
} finally {
  await pool.end();
}
