/**
 * Sprint 10C: PostgreSQL persistence for durable agent jobs (migration 002_durable_agent.sql).
 *
 * Every write that advances a job (status, checkpoint, provider-call journal, terminal result) is fenced by the
 * worker's lease: owner + epoch + an unexpired lease_until, checked under a row lock in the same statement. A worker
 * whose lease expired or was taken over gets LeaseLostError and cannot commit anything, so it can never overwrite a
 * newer worker's state. Reads are unfenced. Connection strings and tokens never appear in errors.
 */
import type { Database } from "../../brand-baseline/db.js";

export type DurableJobStatus = "QUEUED" | "RUNNING" | "RECOVERING" | "COMPLETED" | "FAILED" | "CANCELLED" | "INTERRUPTED_UNCERTAIN" | "EXPIRED";
export type CallStatus = "RESERVED" | "DISPATCHING" | "COMPLETED" | "FAILED" | "OUTCOME_UNKNOWN" | "UNKNOWN_ACCEPTED";
export type CallProvider = "qloo" | "model" | "interpreter";

export type Lease = { jobId: string; owner: string; epoch: number };

export class LeaseLostError extends Error {
  constructor(readonly jobId: string) {
    super(`LEASE_LOST: job ${jobId} is no longer owned by this worker`);
    this.name = "LeaseLostError";
  }
}

export type JobRow = {
  id: string;
  accessTokenHash: string;
  request: unknown;
  kind: "execute" | "confirm" | "continue";
  status: DurableJobStatus;
  stage: string;
  intent: string | null;
  runId: string | null;
  parentRunId: string | null;
  baseCheckpointId: number | null;
  originScope: string | null;
  attempt: number;
  leaseOwner: string | null;
  leaseEpoch: number;
  leaseUntil: Date | null;
  deadlineAt: Date;
  cancelRequested: boolean;
  unknownAuthorizedAt: Date | null;
  spendAuthorizedUsd: number | null;
  result: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
  expiresAt: Date | null;
};

export type CallRow = {
  jobId: string;
  opKey: string;
  provider: CallProvider;
  operation: string;
  fingerprint: string;
  status: CallStatus;
  attempt: number;
  dispatchCount: number;
  leaseEpoch: number;
  correlationId: string | null;
  result: unknown;
  usage: unknown;
  discarded: boolean;
  errorCode: string | null;
};

export type CheckpointRow = { id: number; jobId: string; runId: string; seq: number; boundary: string; schemaVersion: string; digest: string; state: unknown; leaseEpoch: number; createdAt: Date };

export type NewJob = {
  id: string;
  accessTokenHash: string;
  request: unknown;
  kind: JobRow["kind"];
  deadlineAt: Date;
  parentRunId: string | null;
  baseCheckpointId: number | null;
  originScope: string | null;
  spendAuthorizedUsd: number | null;
};

const ACTIVE: DurableJobStatus[] = ["QUEUED", "RUNNING", "RECOVERING"];
/** Checkpoints kept per (job, run): enough to verify a replay and to restore the latest committed state. */
const KEEP_CHECKPOINTS = 3;

function jobRow(r: Record<string, unknown>): JobRow {
  return {
    id: r.id as string,
    accessTokenHash: r.access_token_hash as string,
    request: r.request,
    kind: r.kind as JobRow["kind"],
    status: r.status as DurableJobStatus,
    stage: r.stage as string,
    intent: (r.intent as string | null) ?? null,
    runId: (r.run_id as string | null) ?? null,
    parentRunId: (r.parent_run_id as string | null) ?? null,
    baseCheckpointId: r.base_checkpoint_id === null || r.base_checkpoint_id === undefined ? null : Number(r.base_checkpoint_id),
    originScope: (r.origin_scope as string | null) ?? null,
    attempt: Number(r.attempt),
    leaseOwner: (r.lease_owner as string | null) ?? null,
    leaseEpoch: Number(r.lease_epoch),
    leaseUntil: (r.lease_until as Date | null) ?? null,
    deadlineAt: r.deadline_at as Date,
    cancelRequested: Boolean(r.cancel_requested),
    unknownAuthorizedAt: (r.unknown_authorized_at as Date | null) ?? null,
    spendAuthorizedUsd: r.spend_authorized_usd === null || r.spend_authorized_usd === undefined ? null : Number(r.spend_authorized_usd),
    result: r.result ?? null,
    errorCode: (r.error_code as string | null) ?? null,
    errorMessage: (r.error_message as string | null) ?? null,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
    finishedAt: (r.finished_at as Date | null) ?? null,
    expiresAt: (r.expires_at as Date | null) ?? null,
  };
}

function callRow(r: Record<string, unknown>): CallRow {
  return {
    jobId: r.job_id as string,
    opKey: r.op_key as string,
    provider: r.provider as CallProvider,
    operation: r.operation as string,
    fingerprint: r.fingerprint as string,
    status: r.status as CallStatus,
    attempt: Number(r.attempt),
    dispatchCount: Number(r.dispatch_count),
    leaseEpoch: Number(r.lease_epoch),
    correlationId: (r.correlation_id as string | null) ?? null,
    result: r.result ?? null,
    usage: r.usage ?? null,
    discarded: Boolean(r.discarded),
    errorCode: (r.error_code as string | null) ?? null,
  };
}

/** SQL fragment: the job row, locked, only while `lease` still owns it. Parameters $1 job id, $2 owner, $3 epoch. */
const FENCE = "SELECT id FROM agent_jobs WHERE id=$1 AND lease_owner=$2 AND lease_epoch=$3 AND lease_until > now() FOR UPDATE";

export class DurableAgentStore {
  constructor(readonly pool: Database) {}

  /** The schema this build needs is applied (migrations are explicit; the API never runs them). */
  async schemaReady(): Promise<boolean> {
    try {
      const result = await this.pool.query("SELECT 1 FROM baseline_schema_migrations WHERE name = '002_durable_agent.sql'");
      return result.rows.length === 1;
    } catch {
      return false;
    }
  }

  async createJob(job: NewJob): Promise<void> {
    await this.pool.query(
      `INSERT INTO agent_jobs (id, access_token_hash, request, kind, status, deadline_at, parent_run_id, base_checkpoint_id, origin_scope, spend_authorized_usd)
       VALUES ($1,$2,$3,$4,'QUEUED',$5,$6,$7,$8,$9)`,
      [job.id, job.accessTokenHash, JSON.stringify(job.request), job.kind, job.deadlineAt, job.parentRunId, job.baseCheckpointId, job.originScope, job.spendAuthorizedUsd],
    );
  }

  async getJob(id: string): Promise<JobRow | null> {
    const result = await this.pool.query("SELECT * FROM agent_jobs WHERE id=$1", [id]);
    return result.rows[0] ? jobRow(result.rows[0]) : null;
  }

  async jobsByOrigin(originScope: string): Promise<JobRow[]> {
    const result = await this.pool.query("SELECT * FROM agent_jobs WHERE origin_scope=$1 ORDER BY created_at", [originScope]);
    return result.rows.map(jobRow);
  }

  /** Jobs that are not terminal, oldest first. */
  async activeJobs(): Promise<JobRow[]> {
    const result = await this.pool.query("SELECT * FROM agent_jobs WHERE status = ANY($1) ORDER BY created_at", [ACTIVE]);
    return result.rows.map(jobRow);
  }

  /**
   * Takes ownership of an active job whose lease is free or expired, bumping the epoch (the fencing token). Returns
   * null when another worker holds a live lease or the job is terminal.
   */
  async claim(id: string, owner: string, leaseMs: number, status: "RUNNING" | "RECOVERING"): Promise<Lease | null> {
    const result = await this.pool.query<{ lease_epoch: number }>(
      `UPDATE agent_jobs SET lease_owner=$2, lease_epoch=lease_epoch+1, lease_until=now() + ($3 * interval '1 millisecond'), heartbeat_at=now(),
         status=$4, attempt=attempt+1, updated_at=now()
       WHERE id=$1 AND status = ANY($5) AND (lease_owner IS NULL OR lease_until IS NULL OR lease_until < now())
       RETURNING lease_epoch`,
      [id, owner, leaseMs, status, ACTIVE],
    );
    const row = result.rows[0];
    return row ? { jobId: id, owner, epoch: Number(row.lease_epoch) } : null;
  }

  /** Extends a live lease. False when the lease was lost (expired or taken over): the worker must stop. */
  async heartbeat(lease: Lease, leaseMs: number): Promise<boolean> {
    try {
      const result = await this.pool.query(
        "UPDATE agent_jobs SET lease_until=now() + ($4 * interval '1 millisecond'), heartbeat_at=now() WHERE id=$1 AND lease_owner=$2 AND lease_epoch=$3 AND lease_until > now()",
        [lease.jobId, lease.owner, lease.epoch, leaseMs],
      );
      return result.rowCount === 1;
    } catch {
      return false;
    }
  }

  /** Gives up ownership without changing status (graceful shutdown: the next worker recovers immediately). */
  async release(lease: Lease): Promise<void> {
    await this.pool.query("UPDATE agent_jobs SET lease_until=now() - interval '1 millisecond', updated_at=now() WHERE id=$1 AND lease_owner=$2 AND lease_epoch=$3", [lease.jobId, lease.owner, lease.epoch]).catch(() => undefined);
  }

  private async fenced(lease: Lease, sql: string, params: unknown[]): Promise<number> {
    const result = await this.pool.query(`WITH lease AS (${FENCE}) ${sql}`, [lease.jobId, lease.owner, lease.epoch, ...params]);
    if (result.rowCount === 0) throw new LeaseLostError(lease.jobId);
    return result.rowCount ?? 0;
  }

  async updateProgress(lease: Lease, patch: { stage?: string; intent?: string | null; runId?: string | null }): Promise<void> {
    await this.fenced(
      lease,
      "UPDATE agent_jobs j SET stage=COALESCE($4, j.stage), intent=COALESCE($5, j.intent), run_id=COALESCE($6::uuid, j.run_id), updated_at=now() FROM lease WHERE j.id=lease.id",
      [patch.stage ?? null, patch.intent ?? null, patch.runId ?? null],
    );
  }

  /** Terminal (or quarantine) write. Atomic with lease release; a lost lease commits nothing. */
  async finish(lease: Lease, outcome: { status: DurableJobStatus; result: unknown; errorCode: string | null; errorMessage: string | null; retentionMs: number; runId?: string | null }): Promise<void> {
    await this.fenced(
      lease,
      `UPDATE agent_jobs j SET status=$4, stage='done', result=$5, error_code=$6, error_message=$7, finished_at=now(), expires_at=now() + ($8 * interval '1 millisecond'),
         run_id=COALESCE($9::uuid, j.run_id), lease_until=now() - interval '1 millisecond', updated_at=now()
       FROM lease WHERE j.id=lease.id`,
      [outcome.status, outcome.result === null ? null : JSON.stringify(outcome.result), outcome.errorCode, outcome.errorMessage, outcome.retentionMs, outcome.runId ?? null],
    );
  }

  /** Unfenced terminal write for a job no worker owns (a queued job cancelled or expired before it started). */
  async finishUnowned(id: string, outcome: { status: DurableJobStatus; errorCode: string; errorMessage: string; retentionMs: number }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE agent_jobs SET status=$2, stage='done', error_code=$3, error_message=$4, finished_at=now(), expires_at=now() + ($5 * interval '1 millisecond'), updated_at=now()
       WHERE id=$1 AND status = ANY($6) AND (lease_owner IS NULL OR lease_until IS NULL OR lease_until < now())`,
      [id, outcome.status, outcome.errorCode, outcome.errorMessage, outcome.retentionMs, ACTIVE],
    );
    return result.rowCount === 1;
  }

  /** Records a user's cancellation durably, whoever owns the job. */
  async requestCancel(id: string): Promise<void> {
    await this.pool.query("UPDATE agent_jobs SET cancel_requested=true, updated_at=now() WHERE id=$1 AND status = ANY($2)", [id, [...ACTIVE, "INTERRUPTED_UNCERTAIN"]]);
  }

  /**
   * Operator decision for a quarantined job: its unknown-outcome calls stay charged (UNKNOWN_ACCEPTED) and the job is
   * queued for recovery. Returns false when the job is not quarantined.
   */
  async authorizeUnknown(id: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const job = await client.query("UPDATE agent_jobs SET status='QUEUED', unknown_authorized_at=now(), error_code=NULL, error_message=NULL, finished_at=NULL, expires_at=NULL, updated_at=now() WHERE id=$1 AND status='INTERRUPTED_UNCERTAIN' AND cancel_requested=false", [id]);
      if (job.rowCount !== 1) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query("UPDATE agent_provider_calls SET status='UNKNOWN_ACCEPTED' WHERE job_id=$1 AND status='OUTCOME_UNKNOWN'", [id]);
      await client.query("INSERT INTO agent_events (job_id, event_type, detail) VALUES ($1,'UNKNOWN_OUTCOME_AUTHORIZED','{}')", [id]);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  // ---- provider-call journal ----

  async getCall(jobId: string, opKey: string): Promise<CallRow | null> {
    const result = await this.pool.query("SELECT * FROM agent_provider_calls WHERE job_id=$1 AND op_key=$2", [jobId, opKey]);
    return result.rows[0] ? callRow(result.rows[0]) : null;
  }

  async calls(jobId: string): Promise<CallRow[]> {
    const result = await this.pool.query("SELECT * FROM agent_provider_calls WHERE job_id=$1 ORDER BY reserved_at, op_key", [jobId]);
    return result.rows.map(callRow);
  }

  /**
   * Reserves an operation before it can be dispatched. A fresh key inserts RESERVED; a RESERVED row (never dispatched)
   * or an UNKNOWN_ACCEPTED row (operator-authorized) is re-reserved with attempt+1. Any other existing status is refused
   * by the caller before this is reached.
   */
  async reserveCall(lease: Lease, call: { opKey: string; provider: CallProvider; operation: string; fingerprint: string }): Promise<void> {
    await this.fenced(
      lease,
      `INSERT INTO agent_provider_calls (job_id, op_key, provider, operation, fingerprint, status, lease_epoch)
       SELECT lease.id, $4, $5, $6, $7, 'RESERVED', $3 FROM lease
       ON CONFLICT (job_id, op_key) DO UPDATE SET status='RESERVED', attempt=agent_provider_calls.attempt+1, lease_epoch=EXCLUDED.lease_epoch, reserved_at=now()
         WHERE agent_provider_calls.status IN ('RESERVED','UNKNOWN_ACCEPTED')`,
      [call.opKey, call.provider, call.operation, call.fingerprint],
    );
  }

  /** Marks the moment the request may leave the process. From here, a crash leaves the outcome unknown. */
  async markDispatching(lease: Lease, opKey: string): Promise<void> {
    await this.fenced(
      lease,
      "UPDATE agent_provider_calls c SET status='DISPATCHING', dispatch_count=c.dispatch_count+1, dispatched_at=now() FROM lease WHERE c.job_id=lease.id AND c.op_key=$4 AND c.status IN ('RESERVED','DISPATCHING')",
      [opKey],
    );
  }

  /** Commits the provider's answer (success or failure). Durable before the runtime sees it. */
  async completeCall(lease: Lease, opKey: string, outcome: { status: "COMPLETED" | "FAILED"; result: unknown; usage: unknown; correlationId: string | null; errorCode: string | null }): Promise<void> {
    await this.fenced(
      lease,
      `UPDATE agent_provider_calls c SET status=$5, result=$6, usage=$7, correlation_id=$8, error_code=$9, completed_at=now()
       FROM lease WHERE c.job_id=lease.id AND c.op_key=$4 AND c.status IN ('RESERVED','DISPATCHING')`,
      [opKey, outcome.status, JSON.stringify(outcome.result ?? null), outcome.usage === undefined ? null : JSON.stringify(outcome.usage), outcome.correlationId, outcome.errorCode],
    );
  }

  /** A committed answer that the runtime discarded (a late answer after a tool timeout). Still charged, never evidence. */
  async markDiscarded(lease: Lease, opKey: string): Promise<void> {
    await this.pool.query(`WITH lease AS (${FENCE}) UPDATE agent_provider_calls c SET discarded=true FROM lease WHERE c.job_id=lease.id AND c.op_key=$4`, [lease.jobId, lease.owner, lease.epoch, opKey]);
  }

  /** Recovery: dispatches with no committed answer become OUTCOME_UNKNOWN. Returns how many. */
  async markUnknown(lease: Lease): Promise<number> {
    const result = await this.pool.query(
      `WITH lease AS (${FENCE}) UPDATE agent_provider_calls c SET status='OUTCOME_UNKNOWN' FROM lease WHERE c.job_id=lease.id AND c.status='DISPATCHING'`,
      [lease.jobId, lease.owner, lease.epoch],
    );
    return result.rowCount ?? 0;
  }

  // ---- checkpoints ----

  async putCheckpoint(lease: Lease, checkpoint: { runId: string; seq: number; boundary: string; schemaVersion: string; digest: string; state: unknown }): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query<{ id: string }>(
        `WITH lease AS (${FENCE}) INSERT INTO agent_checkpoints (job_id, run_id, seq, boundary, schema_version, digest, state, lease_epoch)
         SELECT lease.id, $4, $5, $6, $7, $8, $9, $3 FROM lease
         ON CONFLICT (job_id, run_id, seq) DO UPDATE SET boundary=EXCLUDED.boundary, schema_version=EXCLUDED.schema_version, digest=EXCLUDED.digest, state=EXCLUDED.state, lease_epoch=EXCLUDED.lease_epoch, created_at=now()
         RETURNING id`,
        [lease.jobId, lease.owner, lease.epoch, checkpoint.runId, checkpoint.seq, checkpoint.boundary, checkpoint.schemaVersion, checkpoint.digest, JSON.stringify(checkpoint.state)],
      );
      if (inserted.rowCount === 0) throw new LeaseLostError(lease.jobId);
      // Keep the last few per (job, run), plus every needs_input / final boundary (continuations start from them).
      await client.query(
        `DELETE FROM agent_checkpoints WHERE job_id=$1 AND run_id=$2 AND boundary IN ('intake','turn')
           AND id NOT IN (SELECT id FROM agent_checkpoints WHERE job_id=$1 AND run_id=$2 ORDER BY seq DESC LIMIT $3)`,
        [lease.jobId, checkpoint.runId, KEEP_CHECKPOINTS],
      );
      await client.query("COMMIT");
      return Number(inserted.rows[0]!.id);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async checkpoint(id: number): Promise<CheckpointRow | null> {
    const result = await this.pool.query("SELECT * FROM agent_checkpoints WHERE id=$1", [id]);
    return result.rows[0] ? checkpointRow(result.rows[0]) : null;
  }

  /** The latest checkpoint of a run at one of `boundaries`, across jobs (a run continues in a later job). */
  async latestCheckpoint(runId: string, boundaries: string[]): Promise<CheckpointRow | null> {
    const result = await this.pool.query("SELECT * FROM agent_checkpoints WHERE run_id=$1 AND boundary = ANY($2) ORDER BY id DESC LIMIT 1", [runId, boundaries]);
    return result.rows[0] ? checkpointRow(result.rows[0]) : null;
  }

  async jobCheckpoints(jobId: string): Promise<CheckpointRow[]> {
    const result = await this.pool.query("SELECT * FROM agent_checkpoints WHERE job_id=$1 ORDER BY id", [jobId]);
    return result.rows.map(checkpointRow);
  }

  /** Runs whose latest checkpoint is a continuation point (needs_input) or a final result, newest first. */
  async recentRunCheckpoints(limit: number): Promise<CheckpointRow[]> {
    const result = await this.pool.query(
      `SELECT DISTINCT ON (c.run_id) c.* FROM agent_checkpoints c JOIN agent_jobs j ON j.id = c.job_id
       WHERE c.boundary IN ('needs_input','final') AND (j.expires_at IS NULL OR j.expires_at > now()) AND j.status IN ('COMPLETED')
       ORDER BY c.run_id, c.id DESC`,
    );
    return result.rows.map(checkpointRow).sort((a, b) => b.id - a.id).slice(0, limit);
  }

  // ---- interpreted queries ----

  async putQuery(queryId: string, record: unknown, retentionMs: number): Promise<void> {
    await this.pool.query(
      "INSERT INTO agent_queries (query_id, record, expires_at) VALUES ($1,$2, now() + ($3 * interval '1 millisecond')) ON CONFLICT (query_id) DO NOTHING",
      [queryId, JSON.stringify(record), retentionMs],
    );
  }

  async queries(limit: number): Promise<{ queryId: string; record: unknown; executed: boolean }[]> {
    const result = await this.pool.query("SELECT query_id, record, executed FROM agent_queries WHERE expires_at > now() ORDER BY created_at DESC LIMIT $1", [limit]);
    return result.rows.map((r) => ({ queryId: r.query_id as string, record: r.record, executed: Boolean(r.executed) }));
  }

  /** Single-use confirmation across processes. The same job may claim again (its own replay). */
  async markQueryExecuted(queryId: string, jobId: string | null): Promise<boolean> {
    const result = await this.pool.query(
      "UPDATE agent_queries SET executed=true, executed_by_job=$2 WHERE query_id=$1 AND (executed=false OR ($2::uuid IS NOT NULL AND executed_by_job=$2::uuid))",
      [queryId, jobId],
    );
    return result.rowCount === 1;
  }

  // ---- events and retention ----

  async event(jobId: string | null, type: string, detail: Record<string, unknown> = {}): Promise<void> {
    await this.pool.query("INSERT INTO agent_events (job_id, event_type, detail) VALUES ($1,$2,$3)", [jobId, type, JSON.stringify(detail)]).catch(() => undefined);
  }

  async events(jobId: string): Promise<{ type: string; detail: unknown; occurredAt: Date }[]> {
    const result = await this.pool.query("SELECT event_type, detail, occurred_at FROM agent_events WHERE job_id=$1 ORDER BY id", [jobId]);
    return result.rows.map((r) => ({ type: r.event_type as string, detail: r.detail, occurredAt: r.occurred_at as Date }));
  }

  /**
   * Retention: a finished job past expires_at loses its result and checkpoints (status EXPIRED, kept as a tombstone so
   * an old link reads "expired" rather than "unknown"); a tombstone past twice its window is deleted with its journal
   * and events (ON DELETE CASCADE). Expired interpreted queries are deleted.
   */
  async sweep(): Promise<{ expired: number; deleted: number; queries: number }> {
    const expired = await this.pool.query("UPDATE agent_jobs SET status='EXPIRED', result=NULL, updated_at=now() WHERE expires_at < now() AND status NOT IN ('EXPIRED','QUEUED','RUNNING','RECOVERING')");
    await this.pool.query("DELETE FROM agent_checkpoints c USING agent_jobs j WHERE c.job_id=j.id AND j.status='EXPIRED'");
    const deleted = await this.pool.query("DELETE FROM agent_jobs WHERE status='EXPIRED' AND expires_at + (expires_at - finished_at) < now()");
    const queries = await this.pool.query("DELETE FROM agent_queries WHERE expires_at < now()");
    return { expired: expired.rowCount ?? 0, deleted: deleted.rowCount ?? 0, queries: queries.rowCount ?? 0 };
  }
}

function checkpointRow(r: Record<string, unknown>): CheckpointRow {
  return {
    id: Number(r.id),
    jobId: r.job_id as string,
    runId: r.run_id as string,
    seq: Number(r.seq),
    boundary: r.boundary as string,
    schemaVersion: r.schema_version as string,
    digest: r.digest as string,
    state: r.state,
    leaseEpoch: Number(r.lease_epoch),
    createdAt: r.created_at as Date,
  };
}
