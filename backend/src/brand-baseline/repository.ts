import { createHash, randomUUID } from "node:crypto";
import { BRAND_BASELINE_SCHEMA_VERSION, BRAND_BASELINE_TEMPLATE_VERSION, type BrandBaselineResult, type BaselineStatus } from "@cultural-elasticity/shared";
import type { PoolClient } from "pg";
import type { ResolvedConcept } from "../contracts/qloo.js";
import type { Database } from "./db.js";
import { baselineObservationSchema, brandBaselineResultSchema } from "./schema.js";
import type { BaselineObservation } from "./research.js";

export const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");
export const payloadHash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class BaselineRepositoryError extends Error {
  constructor(readonly code: string) { super(code); }
}

export type ScanRow = {
  id: string;
  brand_id: string;
  status: BaselineStatus;
  provider_call_count: number;
  access_token_hash: string;
  request_hash: string;
  lease_owner: string | null;
  result_artifact_id: string | null;
};

export class BaselineRepository {
  constructor(readonly pool: Database) {}

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async setQlooCallLimit(limit: number): Promise<void> {
    if (!Number.isInteger(limit) || limit < 0) throw new BaselineRepositoryError("INVALID_CALL_LIMIT");
    const result = await this.pool.query("UPDATE baseline_budget_accounts SET limit_calls=$1,updated_at=now() WHERE budget_key='qloo' AND used_calls <= $1", [limit]);
    if (result.rowCount !== 1) throw new BaselineRepositoryError("CALL_LIMIT_BELOW_USAGE");
  }

  async createResolution(scope: string, accessToken: string, name: string, selectedQlooId?: string): Promise<string> {
    const id = randomUUID();
    await this.pool.query("INSERT INTO baseline_resolutions (id,access_scope,input_name,selected_qloo_id,status,access_token_hash) VALUES ($1,$2,$3,$4,'PENDING',$5)", [id, scope, name, selectedQlooId ?? null, tokenHash(accessToken)]);
    return id;
  }

  async reserveResolutionCall(resolutionId: string, attempt: number): Promise<string> {
    return this.transaction(async (client) => {
      const resolution = await client.query("SELECT id FROM baseline_resolutions WHERE id=$1 AND status='PENDING' FOR UPDATE", [resolutionId]);
      if (!resolution.rowCount) throw new BaselineRepositoryError("RESOLUTION_NOT_PENDING");
      const budget = await client.query("UPDATE baseline_budget_accounts SET used_calls=used_calls+1,updated_at=now() WHERE budget_key='qloo' AND used_calls < limit_calls RETURNING used_calls");
      if (!budget.rowCount) throw new BaselineRepositoryError("GLOBAL_CALL_LIMIT_EXHAUSTED");
      const id = randomUUID();
      await client.query("INSERT INTO baseline_provider_calls (id,resolution_id,stage,operation,attempt,status) VALUES ($1,$2,'identity','describe',$3,'DISPATCHING')", [id, resolutionId, attempt]);
      await client.query("INSERT INTO baseline_budget_reservations (id,provider_call_id,budget_key,reserved_calls,state) VALUES ($1,$2,'qloo',1,'RESERVED')", [randomUUID(), id]);
      return id;
    });
  }

  async finishResolution(id: string, resolution: { status: "RESOLVED"; entity: ResolvedConcept } | { status: "AMBIGUOUS"; candidates: object[] } | { status: "NOT_FOUND" | "TEMPORARILY_UNAVAILABLE" }, correlationId?: string): Promise<void> {
    await this.transaction(async (client) => {
      let brandId: string | null = null;
      if (resolution.status === "RESOLVED") {
        const confirmed = await client.query("SELECT id FROM baseline_provider_calls WHERE resolution_id=$1 AND provider_correlation_id=$2 AND status='COMPLETE' AND unknown_outcome=false LIMIT 1", [id, correlationId ?? null]);
        if (!confirmed.rowCount) throw new BaselineRepositoryError("UNRECORDED_IDENTITY_CALL");
        const entity = resolution.entity;
        const name = entity.label.trim();
        const brand = await client.query<{ id: string }>("INSERT INTO baseline_brands (id,qloo_id,name,lookup_name,qloo_type,resolution_state,verified_at) VALUES ($1,$2,$3,$4,$5,'RESOLVED',now()) ON CONFLICT (qloo_id) DO UPDATE SET name=excluded.name,lookup_name=excluded.lookup_name,qloo_type=excluded.qloo_type,verified_at=now(),updated_at=now() RETURNING id", [randomUUID(), entity.qlooId, name, name.toLocaleLowerCase(), entity.type]);
        brandId = brand.rows[0]!.id;
      }
      await client.query("UPDATE baseline_resolutions SET status=$2,brand_id=$3,candidates=$4,provider_correlation_id=$5,finished_at=now() WHERE id=$1 AND status='PENDING'", [id, resolution.status, brandId, resolution.status === "AMBIGUOUS" ? resolution.candidates : [], correlationId ?? null]);
    });
  }

  async readResolution(id: string, token: string): Promise<{ id: string; status: string; brandId: string | null; qlooId: string | null; name: string | null; candidates: object[] } | null> {
    const result = await this.pool.query<{ id: string; status: string; brand_id: string | null; qloo_id: string | null; name: string | null; candidates: object[] }>("SELECT r.id,r.status,r.brand_id,b.qloo_id,b.name,r.candidates FROM baseline_resolutions r LEFT JOIN baseline_brands b ON b.id=r.brand_id WHERE r.id=$1 AND r.access_token_hash=$2", [id, tokenHash(token)]);
    const row = result.rows[0];
    return row ? { id: row.id, status: row.status, brandId: row.brand_id, qlooId: row.qloo_id, name: row.name, candidates: row.candidates } : null;
  }

  async createScan(input: { resolutionId: string; scope: string; accessToken: string; idempotencyKey: string; requestHash: string }): Promise<{ id: string; status: BaselineStatus; reused: boolean; cached: boolean }> {
    return this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`baseline:${input.scope}:${input.idempotencyKey}`]);
      const existing = await client.query<ScanRow>("SELECT * FROM baseline_scans WHERE access_scope=$1 AND idempotency_key=$2", [input.scope, input.idempotencyKey]);
      if (existing.rows[0]) {
        if (existing.rows[0].request_hash !== input.requestHash || existing.rows[0].access_token_hash !== tokenHash(input.accessToken)) throw new BaselineRepositoryError("IDEMPOTENCY_CONFLICT");
        return { id: existing.rows[0].id, status: existing.rows[0].status, reused: true, cached: false };
      }
      const resolution = await client.query<{ brand_id: string }>("SELECT brand_id FROM baseline_resolutions WHERE id=$1 AND access_scope=$2 AND access_token_hash=$3 AND status='RESOLVED' AND finished_at > now() - interval '24 hours' FOR UPDATE", [input.resolutionId, input.scope, tokenHash(input.accessToken)]);
      if (!resolution.rows[0]?.brand_id) throw new BaselineRepositoryError("RESOLUTION_INVALID_OR_STALE");
      const brandId = resolution.rows[0].brand_id;
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`baseline-brand:${brandId}`]);
      const id = randomUUID();
      const cached = await client.query<{ id: string; payload: unknown }>(
        "SELECT s.id,a.payload FROM baseline_scans s JOIN baseline_artifacts a ON a.id=s.result_artifact_id WHERE s.brand_id=$1 AND s.status IN ('COMPLETE','PARTIAL','INSUFFICIENT_EVIDENCE') AND s.finished_at > now() - interval '24 hours' AND s.template_version=$2 AND s.schema_version=$3 ORDER BY s.finished_at DESC LIMIT 1",
        [brandId, BRAND_BASELINE_TEMPLATE_VERSION, BRAND_BASELINE_SCHEMA_VERSION],
      );
      const cachedResult = cached.rows[0] ? brandBaselineResultSchema.safeParse(cached.rows[0].payload) : null;
      const cachedData = cachedResult?.success ? cachedResult.data : null;
      const useCache = cachedData !== null;
      if (!useCache) {
        const active = await client.query("SELECT id FROM baseline_scans WHERE brand_id=$1 AND status IN ('QUEUED','RUNNING') LIMIT 1", [brandId]);
        if (active.rowCount) throw new BaselineRepositoryError("SCAN_IN_PROGRESS");
      }
      await client.query(
        "INSERT INTO baseline_scans (id,brand_id,resolution_id,template_version,schema_version,status,access_scope,access_token_hash,idempotency_key,request_hash,started_at,finished_at,cache_source_scan_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12)",
        [id, brandId, input.resolutionId, BRAND_BASELINE_TEMPLATE_VERSION, BRAND_BASELINE_SCHEMA_VERSION, cachedData?.scanStatus ?? "QUEUED", input.scope, tokenHash(input.accessToken), input.idempotencyKey, input.requestHash, useCache ? new Date() : null, useCache ? cached.rows[0]?.id : null],
      );
      if (cachedData) {
        const artifactId = randomUUID();
        const result: BrandBaselineResult = { ...cachedData, scanId: id, brand: { ...cachedData.brand, id: brandId }, execution: { ...cachedData.execution, recordedOrLive: "recorded", providerCallCount: 0, cacheSourceScanId: cached.rows[0]!.id } };
        await client.query("INSERT INTO baseline_artifacts (id,scan_id,schema_version,artifact_type,payload,source_correlation_ids) VALUES ($1,$2,$3,'result',$4,$5)", [artifactId, id, BRAND_BASELINE_SCHEMA_VERSION, result, [...new Set(result.fingerprint.provenance.map((ref) => ref.correlationId))]]);
        await client.query("UPDATE baseline_scans SET result_artifact_id=$2 WHERE id=$1", [id, artifactId]);
      }
      await client.query("INSERT INTO baseline_execution_events (id,scan_id,event_type,metadata) VALUES ($1,$2,$3,$4)", [randomUUID(), id, useCache ? "cache_hit" : "queued", {}]);
      return { id, status: cachedData?.scanStatus ?? "QUEUED", reused: false, cached: useCache };
    });
  }

  async readScan(id: string, accessToken: string): Promise<{ status: BaselineStatus; providerCallCount: number; result: BrandBaselineResult | null; stages: { stage: string; status: string }[] } | null> {
    const scan = await this.pool.query<ScanRow>("SELECT * FROM baseline_scans WHERE id=$1 AND access_token_hash=$2", [id, tokenHash(accessToken)]);
    if (!scan.rows[0]) return null;
    const stages = await this.pool.query<{ stage: string; status: string }>("SELECT stage,status FROM baseline_stages WHERE scan_id=$1 ORDER BY started_at,stage", [id]);
    let result: BrandBaselineResult | null = null;
    if (scan.rows[0].result_artifact_id) {
      const artifact = await this.pool.query<{ payload: unknown }>("SELECT payload FROM baseline_artifacts WHERE id=$1 AND scan_id=$2", [scan.rows[0].result_artifact_id, id]);
      if (!artifact.rows[0]) throw new BaselineRepositoryError("RESULT_ARTIFACT_MISSING");
      const parsed = brandBaselineResultSchema.safeParse(artifact.rows[0].payload);
      if (!parsed.success) throw new BaselineRepositoryError("RESULT_ARTIFACT_CORRUPT");
      result = parsed.data;
    }
    return { status: scan.rows[0].status, providerCallCount: scan.rows[0].provider_call_count, result, stages: stages.rows };
  }

  async claim(id: string, owner: string): Promise<boolean> {
    const result = await this.pool.query("UPDATE baseline_scans SET status='RUNNING',lease_owner=$2,lease_until=now()+interval '2 minutes',heartbeat_at=now(),started_at=coalesce(started_at,now()) WHERE id=$1 AND status='QUEUED' RETURNING id", [id, owner]);
    return result.rowCount === 1;
  }

  async heartbeat(id: string, owner: string): Promise<boolean> {
    const result = await this.pool.query("UPDATE baseline_scans SET heartbeat_at=now(),lease_until=now()+interval '2 minutes' WHERE id=$1 AND status='RUNNING' AND lease_owner=$2 RETURNING id", [id, owner]);
    return result.rowCount === 1;
  }

  async stage(id: string, owner: string, stage: string, status: "RUNNING" | "COMPLETE" | "SKIPPED" | "FAILED", outcome: object = {}, correlationId?: string): Promise<void> {
    await this.transaction(async (client) => {
      const scan = await client.query("SELECT id FROM baseline_scans WHERE id=$1 AND status='RUNNING' AND lease_owner=$2 FOR UPDATE", [id, owner]);
      if (!scan.rowCount) throw new BaselineRepositoryError("LEASE_LOST");
      await client.query(
        "INSERT INTO baseline_stages (scan_id,stage,status,attempt,outcome,qloo_correlation_id,finished_at) VALUES ($1,$2,$3,1,$4,$5,$6) ON CONFLICT (scan_id,stage,attempt) DO UPDATE SET status=excluded.status,outcome=excluded.outcome,qloo_correlation_id=excluded.qloo_correlation_id,finished_at=excluded.finished_at",
        [id, stage, status, outcome, correlationId ?? null, status === "RUNNING" ? null : new Date()],
      );
      await client.query("INSERT INTO baseline_execution_events (id,scan_id,event_type,stage,metadata) VALUES ($1,$2,$3,$4,$5)", [randomUUID(), id, `stage_${status.toLowerCase()}`, stage, {}]);
    });
  }

  /** The normalized observation and stage completion commit together. No raw provider response is stored. */
  async recordObservation(scanId: string, owner: string, observation: BaselineObservation): Promise<void> {
    const outcome = observation.outcome;
    const signals = outcome.kind === "ok"
      ? observation.domain === "tags" ? (outcome.data as { tags: { qlooId: string; label: string; kind: "tag" | "entity"; type?: string; sourceCorrelationId: string }[] }).tags : (outcome.data as { entities: { qlooId: string; label: string; kind: "tag" | "entity"; type?: string; sourceCorrelationId: string }[] }).entities
      : [];
    const payload = baselineObservationSchema.parse({
      domain: observation.domain,
      capturedAt: observation.capturedAt,
      kind: outcome.kind,
      operation: observation.domain === "tags" ? "entity_tags" : "recommend",
      correlationId: outcome.provenance.correlationId,
      sourceStatus: outcome.provenance.status,
      signals: signals.slice(0, 10).map((signal) => ({ id: signal.qlooId, name: signal.label, kind: signal.kind, type: signal.type, sourceCorrelationId: signal.sourceCorrelationId })),
    });
    await this.transaction(async (client) => {
      const scan = await client.query("SELECT id FROM baseline_scans WHERE id=$1 AND status='RUNNING' AND lease_owner=$2 FOR UPDATE", [scanId, owner]);
      if (!scan.rowCount) throw new BaselineRepositoryError("LEASE_LOST");
      const providerCall = await client.query("SELECT id FROM baseline_provider_calls WHERE scan_id=$1 AND stage=$2 AND provider_correlation_id=$3 AND status='COMPLETE' AND unknown_outcome=false LIMIT 1", [scanId, observation.domain, outcome.provenance.correlationId]);
      if (!providerCall.rowCount) throw new BaselineRepositoryError("UNRECORDED_PROVIDER_CALL");
      await client.query("INSERT INTO baseline_artifacts (id,scan_id,stage,schema_version,artifact_type,payload,source_correlation_ids) VALUES ($1,$2,$3,$4,'observation',$5,$6) ON CONFLICT (scan_id,artifact_type,stage) DO NOTHING", [randomUUID(), scanId, observation.domain, "ce-brand-baseline-observation/0.2", payload, [outcome.provenance.correlationId]]);
      await client.query("INSERT INTO baseline_stages (scan_id,stage,status,attempt,outcome,qloo_correlation_id,finished_at) VALUES ($1,$2,'COMPLETE',1,$3,$4,now()) ON CONFLICT (scan_id,stage,attempt) DO UPDATE SET status='COMPLETE',outcome=excluded.outcome,qloo_correlation_id=excluded.qloo_correlation_id,finished_at=now()", [scanId, observation.domain, { kind: outcome.kind }, outcome.provenance.correlationId]);
      await client.query("INSERT INTO baseline_execution_events (id,scan_id,event_type,stage,metadata) VALUES ($1,$2,'stage_complete',$3,$4)", [randomUUID(), scanId, observation.domain, { kind: outcome.kind }]);
    });
  }

  /** Reservations and the call record commit BEFORE any external dispatch. Unknown calls never refund quota. */
  async reserveCall(scanId: string, owner: string, stage: string, operation: "describe" | "entity_tags" | "recommend", attempt: number): Promise<string> {
    return this.transaction(async (client) => {
      const scan = await client.query<ScanRow>("SELECT * FROM baseline_scans WHERE id=$1 FOR UPDATE", [scanId]);
      if (scan.rows[0]?.status !== "RUNNING" || scan.rows[0].lease_owner !== owner) throw new BaselineRepositoryError("LEASE_LOST");
      if (scan.rows[0].provider_call_count >= 7) throw new BaselineRepositoryError("SCAN_CALL_LIMIT_EXHAUSTED");
      const budget = await client.query("UPDATE baseline_budget_accounts SET used_calls=used_calls+1,updated_at=now() WHERE budget_key='qloo' AND used_calls < limit_calls RETURNING used_calls");
      if (!budget.rowCount) throw new BaselineRepositoryError("GLOBAL_CALL_LIMIT_EXHAUSTED");
      const id = randomUUID();
      await client.query("INSERT INTO baseline_provider_calls (id,scan_id,stage,operation,attempt,status) VALUES ($1,$2,$3,$4,$5,'DISPATCHING')", [id, scanId, stage, operation, attempt]);
      await client.query("INSERT INTO baseline_budget_reservations (id,scan_id,provider_call_id,budget_key,reserved_calls,state) VALUES ($1,$2,$3,'qloo',1,'RESERVED')", [randomUUID(), scanId, id]);
      await client.query("UPDATE baseline_scans SET provider_call_count=provider_call_count+1 WHERE id=$1", [scanId]);
      return id;
    });
  }

  async settleCall(callId: string, outcome: { status: "COMPLETE" | "FAILED" | "UNKNOWN"; correlationId?: string; category: string; durationMs: number }): Promise<void> {
    await this.transaction(async (client) => {
      const updated = await client.query("UPDATE baseline_provider_calls SET status=$2,provider_correlation_id=$3,outcome_category=$4,unknown_outcome=$5,finished_at=now(),duration_ms=$6 WHERE id=$1 AND status='DISPATCHING' RETURNING id", [callId, outcome.status, outcome.correlationId ?? null, outcome.category.slice(0, 80), outcome.status === "UNKNOWN", Math.round(outcome.durationMs)]);
      if (updated.rowCount) await client.query("UPDATE baseline_budget_reservations SET observed_calls=$2,state=$3,settled_at=now() WHERE provider_call_id=$1 AND state='RESERVED'", [callId, outcome.status === "UNKNOWN" ? 0 : 1, outcome.status === "UNKNOWN" ? "UNCERTAIN" : "SETTLED"]);
    });
  }

  async complete(id: string, owner: string, result: BrandBaselineResult): Promise<boolean> {
    const validated = brandBaselineResultSchema.parse(result);
    return this.transaction(async (client) => {
      const scan = await client.query<{ id: string; brand_id: string; qloo_id: string; provider_correlation_id: string; provider_call_count: number }>("SELECT s.id,s.brand_id,b.qloo_id,r.provider_correlation_id,s.provider_call_count FROM baseline_scans s JOIN baseline_brands b ON b.id=s.brand_id JOIN baseline_resolutions r ON r.id=s.resolution_id WHERE s.id=$1 AND s.status='RUNNING' AND s.lease_owner=$2 FOR UPDATE OF s", [id, owner]);
      if (!scan.rowCount) return false;
      const current = scan.rows[0]!;
      if (validated.scanId !== id || validated.brand.id !== current.brand_id || validated.brand.qlooId !== current.qloo_id || validated.brand.source.correlationId !== current.provider_correlation_id || validated.brand.source.sourceId !== current.qloo_id || validated.execution.providerCallCount !== current.provider_call_count) throw new BaselineRepositoryError("RESULT_SCOPE_MISMATCH");
      const artifacts = await client.query<{ payload: unknown }>("SELECT payload FROM baseline_artifacts WHERE scan_id=$1 AND artifact_type='observation'", [id]);
      const observed = new Set<string>();
      for (const artifact of artifacts.rows) {
        const parsed = baselineObservationSchema.safeParse(artifact.payload);
        if (!parsed.success) throw new BaselineRepositoryError("OBSERVATION_ARTIFACT_CORRUPT");
        for (const signal of parsed.data.signals) observed.add(`${parsed.data.correlationId}\0${signal.id}`);
      }
      for (const signal of validated.fingerprint.signals) {
        if (!observed.has(`${signal.source.correlationId}\0${signal.source.sourceId}`) || signal.id !== signal.source.sourceId) throw new BaselineRepositoryError("UNRECORDED_EVIDENCE");
      }
      for (const territory of validated.territories) for (const ref of territory.supportingReferences) {
        if (!observed.has(`${ref.correlationId}\0${ref.sourceId}`)) throw new BaselineRepositoryError("UNRECORDED_EVIDENCE");
      }
      for (const ref of validated.fingerprint.provenance) {
        if (ref.operation === "describe") {
          if (ref.correlationId !== current.provider_correlation_id || ref.sourceId !== current.qloo_id) throw new BaselineRepositoryError("UNRECORDED_EVIDENCE");
        } else if (!observed.has(`${ref.correlationId}\0${ref.sourceId}`)) throw new BaselineRepositoryError("UNRECORDED_EVIDENCE");
      }
      const artifactId = randomUUID();
      await client.query("INSERT INTO baseline_artifacts (id,scan_id,schema_version,artifact_type,payload,source_correlation_ids) VALUES ($1,$2,$3,'result',$4,$5)", [artifactId, id, BRAND_BASELINE_SCHEMA_VERSION, validated, [...new Set(validated.fingerprint.provenance.map((ref) => ref.correlationId))]]);
      await client.query("UPDATE baseline_scans SET status=$2,result_artifact_id=$3,finished_at=now(),lease_owner=NULL,lease_until=NULL WHERE id=$1", [id, validated.scanStatus, artifactId]);
      await client.query("INSERT INTO baseline_execution_events (id,scan_id,event_type,metadata) VALUES ($1,$2,'completed',$3)", [randomUUID(), id, { status: validated.scanStatus }]);
      return true;
    });
  }

  async fail(id: string, owner: string, status: "FAILED" | "INTERRUPTED", code: string): Promise<void> {
    await this.pool.query("UPDATE baseline_scans SET status=$3,partial_failure_summary=$4,finished_at=now(),lease_owner=NULL,lease_until=NULL WHERE id=$1 AND lease_owner=$2 AND status='RUNNING'", [id, owner, status, code.slice(0, 80)]);
  }

  /** A stale lease is interrupted. An in-flight provider call becomes UNKNOWN and is never replayed automatically. */
  async recoverStale(): Promise<number> {
    return this.transaction(async (client) => {
      const stale = await client.query<{ id: string }>("UPDATE baseline_scans SET status='INTERRUPTED',partial_failure_summary='STALE_WORKER_LEASE',finished_at=now(),lease_owner=NULL,lease_until=NULL WHERE status='RUNNING' AND lease_until < now() RETURNING id");
      for (const row of stale.rows) {
        await client.query("UPDATE baseline_provider_calls SET status='UNKNOWN',unknown_outcome=true,outcome_category='WORKER_INTERRUPTED',finished_at=now() WHERE scan_id=$1 AND status='DISPATCHING'", [row.id]);
        await client.query("UPDATE baseline_budget_reservations SET state='UNCERTAIN',settled_at=now() WHERE scan_id=$1 AND state='RESERVED'", [row.id]);
        await client.query("INSERT INTO baseline_execution_events (id,scan_id,event_type,error_class) VALUES ($1,$2,'interrupted','STALE_WORKER_LEASE')", [randomUUID(), row.id]);
      }
      return stale.rowCount ?? 0;
    });
  }

  async nextQueued(): Promise<string | null> {
    const result = await this.pool.query<{ id: string }>("SELECT id FROM baseline_scans WHERE status='QUEUED' ORDER BY requested_at,id LIMIT 1");
    return result.rows[0]?.id ?? null;
  }

  async scanBrand(id: string): Promise<{ id: string; qlooId: string; name: string; correlationId: string; capturedAt: string } | null> {
    const result = await this.pool.query<{ id: string; qloo_id: string; name: string; provider_correlation_id: string; finished_at: Date }>("SELECT b.id,b.qloo_id,b.name,r.provider_correlation_id,r.finished_at FROM baseline_scans s JOIN baseline_brands b ON b.id=s.brand_id JOIN baseline_resolutions r ON r.id=s.resolution_id WHERE s.id=$1", [id]);
    return result.rows[0] ? { id: result.rows[0].id, qlooId: result.rows[0].qloo_id, name: result.rows[0].name, correlationId: result.rows[0].provider_correlation_id, capturedAt: result.rows[0].finished_at.toISOString() } : null;
  }

  async budgetSnapshot(): Promise<{ limitCalls: number; usedCalls: number }> {
    const result = await this.pool.query<{ limit_calls: number; used_calls: number }>("SELECT limit_calls,used_calls FROM baseline_budget_accounts WHERE budget_key='qloo'");
    if (!result.rows[0]) throw new BaselineRepositoryError("BUDGET_MISSING");
    return { limitCalls: result.rows[0].limit_calls, usedCalls: result.rows[0].used_calls };
  }
}
