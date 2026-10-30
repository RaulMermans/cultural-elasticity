import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { verifyInternalAuth, admitVisitor, verifyOperator, verifyPaidOperator } from "../ops/identity.js";
import { operatorToken } from "../config/production.js";
import { researchEligibility, type ResearchEligibility } from "../ops/eligibility.js";
import { returnPublicQuota, takePublicQuota, type PublicQuotaKind } from "../ops/public-quota.js";
import { createBaselinePool, databaseReady } from "./db.js";
import { BaselineRepository, BaselineRepositoryError, payloadHash } from "./repository.js";
import { resolveBrand } from "./research.js";
import { createBaselineBody, resolveBrandBody } from "./schema.js";
import { BaselineWorker, createLiveBaselineCallGate } from "./worker.js";

export type BrandStatus = {
  /** True only when this caller could start a scan now: admissions open and, where required, a valid operator credential. */
  enabled: boolean;
  admissionsOpen: boolean;
  operator: "authorized" | "operator_required" | "operator_expired";
  semantics: "baseline_admission_for_caller";
  /** Hotfix: what this caller could start now (states only) and, for a public-evaluation visitor, their own allowance. */
  research?: ResearchEligibility;
};

/**
 * Sprint 9L: availability for the caller, not the process. A visitor without a valid paid-operator credential
 * must not see an enabled brand search that Railway then refuses. The credential is evaluated only on a request
 * that passed internal auth, so a direct anonymous probe learns nothing about it. A free read: no Qloo call.
 */
export function brandStatusForCaller(admissionsOpen: boolean, headers: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): BrandStatus {
  const decision = verifyInternalAuth(headers, env) ? verifyPaidOperator(headers, env) : { ok: false as const, code: "operator_required" as const };
  const operator = decision.ok ? "authorized" : decision.code;
  return { enabled: admissionsOpen && decision.ok, admissionsOpen, operator, semantics: "baseline_admission_for_caller" };
}

const idParams = z.strictObject({ id: z.uuid() });
const REFUSED_BEFORE_QUEUE = new Set(["IDEMPOTENCY_CONFLICT", "RESOLUTION_INVALID_OR_STALE", "SCAN_IN_PROGRESS"]);
const tokenHeader = "x-baseline-token";

export async function brandBaselineRoutes(app: FastifyInstance): Promise<void> {
  const enabled = process.env.CE_BASELINE_ENABLED === "1";
  const liveEnabled = process.env.CE_BASELINE_LIVE_ENABLED === "1";
  const pool = enabled ? createBaselinePool(process.env.DATABASE_URL) : null;
  const repository = pool ? new BaselineRepository(pool) : null;
  let worker: BaselineWorker | null = null;
  let callGate: ReturnType<typeof createLiveBaselineCallGate> | null = null;
  if (repository) {
    if (!(await databaseReady(pool!))) throw new Error("BASELINE_DATABASE_UNAVAILABLE");
    const limit = Number(process.env.CE_BASELINE_TOTAL_QLOO_CALLS ?? 0);
    await repository.setQlooCallLimit(limit);
    if (liveEnabled) {
      callGate = createLiveBaselineCallGate(repository);
      worker = new BaselineWorker(repository, callGate);
      await worker.start();
    }
    app.addHook("onClose", async () => { worker?.stop(); await pool!.end(); });
  }

  const admit = (request: FastifyRequest, reply: FastifyReply, needsLive = false): boolean => {
    if (!verifyInternalAuth(request.headers as Record<string, unknown>)) {
      void reply.code(401).send({ error: "unauthorized" });
      return false;
    }
    if (!enabled || !repository || (needsLive && !liveEnabled)) {
      void reply.code(503).send({ error: "baseline_paused" });
      return false;
    }
    // Resolution and scans dispatch Qloo calls: the same operator authorization as an agent start.
    const operator = needsLive ? verifyPaidOperator(request.headers as Record<string, unknown>) : { ok: true as const };
    if (!operator.ok) {
      void reply.code(403).send({ error: operator.code });
      return false;
    }
    return true;
  };
  /** Sprint 9M: a paid start by a public-evaluation visitor also spends that visitor network's durable quota. */
  const quota = async (request: FastifyRequest, reply: FastifyReply, kind: PublicQuotaKind): Promise<boolean> => {
    const decision = await takePublicQuota(request.headers as Record<string, unknown>, kind);
    if (decision.ok) return true;
    void reply.code(decision.status).send({ error: decision.error, message: decision.message });
    return false;
  };
  const scopeOf = (request: FastifyRequest) => admitVisitor(request.headers as Record<string, unknown>, true).visitorId;
  const tokenOf = (request: FastifyRequest) => typeof request.headers[tokenHeader] === "string" ? request.headers[tokenHeader] : "";
  const errorResponse = (error: unknown, reply: FastifyReply) => {
    if (error instanceof BaselineRepositoryError) {
      const code = error.code;
      const status = code === "IDEMPOTENCY_CONFLICT" || code === "SCAN_IN_PROGRESS" ? 409 : code === "RESOLUTION_INVALID_OR_STALE" ? 422 : code.includes("LIMIT") ? 429 : 503;
      return reply.code(status).send({ error: code.toLowerCase() });
    }
    return reply.code(503).send({ error: "baseline_unavailable" });
  };

  app.get("/api/brands/status", async (request) => {
    const headers = request.headers as Record<string, unknown>;
    const status = brandStatusForCaller(enabled && liveEnabled && Boolean(repository), headers);
    const research = await researchEligibility({
      headers,
      callerAuthorized: status.operator === "authorized",
      baselineOpen: status.admissionsOpen,
      baselineBudget: repository ? () => repository.budgetSnapshot() : null,
    });
    return { ...status, research };
  });

  app.get("/ops/baselines", async (request, reply) => {
    if (!operatorToken() || !verifyOperator(request.headers as Record<string, unknown>)) return reply.code(404).send({ error: "not_found" });
    const diagnosticPool = pool ?? (process.env.DATABASE_URL ? createBaselinePool(process.env.DATABASE_URL) : null);
    if (!diagnosticPool) return { enabled: false, liveEnabled: false, databaseReady: false };
    try {
      const [migrations, budget, scans, calls] = await Promise.all([
        diagnosticPool.query<{ count: string }>("SELECT count(*)::text AS count FROM baseline_schema_migrations"),
        diagnosticPool.query<{ limit_calls: number; used_calls: number }>("SELECT limit_calls,used_calls FROM baseline_budget_accounts WHERE budget_key='qloo'"),
        diagnosticPool.query<{ status: string; count: string }>("SELECT status, count(*)::text AS count FROM baseline_scans GROUP BY status"),
        diagnosticPool.query<{ status: string; count: string }>("SELECT status, count(*)::text AS count FROM baseline_provider_calls GROUP BY status"),
      ]);
      return {
        enabled, liveEnabled,
        databaseReady: true,
        migrationCount: Number(migrations.rows[0]?.count ?? 0),
        qlooCallBudget: { limitCalls: budget.rows[0]?.limit_calls ?? 0, usedCalls: budget.rows[0]?.used_calls ?? 0 },
        scansByStatus: Object.fromEntries(scans.rows.map((row) => [row.status, Number(row.count)])),
        callsByStatus: Object.fromEntries(calls.rows.map((row) => [row.status, Number(row.count)])),
      };
    } catch { return reply.code(503).send({ error: "baseline_database_unavailable" }); }
    finally { if (diagnosticPool !== pool) await diagnosticPool.end(); }
  });

  app.post<{ Body: unknown }>("/api/brands/resolve", { bodyLimit: 4096 }, async (request, reply) => {
    if (!admit(request, reply, true)) return;
    const parsed = resolveBrandBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_brand_request" });
    if (!(await quota(request, reply, "resolve"))) return;
    const accessToken = randomBytes(32).toString("base64url");
    try {
      const id = await repository!.createResolution(scopeOf(request), accessToken, parsed.data.name, parsed.data.selectedQlooId);
      const resolution = await resolveBrand(callGate!.scoped({ resolutionId: id }), parsed.data.name, parsed.data.selectedQlooId);
      await repository!.finishResolution(id, resolution.status === "RESOLVED" ? { status: "RESOLVED", entity: resolution.entity } : resolution.status === "AMBIGUOUS" ? { status: "AMBIGUOUS", candidates: resolution.candidates } : { status: resolution.status }, resolution.status === "RESOLVED" ? resolution.entity.provenance[0]?.correlationId : undefined);
      return reply.code(resolution.status === "RESOLVED" ? 200 : resolution.status === "TEMPORARILY_UNAVAILABLE" ? 503 : 200).send({ resolutionId: id, accessToken, ...resolution });
    } catch (error) { return errorResponse(error, reply); }
  });

  app.post<{ Body: unknown }>("/api/brands/baselines", { bodyLimit: 4096 }, async (request, reply) => {
    if (!admit(request, reply, true)) return;
    const parsed = createBaselineBody.safeParse(request.body);
    if (!parsed.success || !tokenOf(request)) return reply.code(400).send({ error: "invalid_baseline_request" });
    if (!(await quota(request, reply, "scan"))) return;
    try {
      const created = await repository!.createScan({ resolutionId: parsed.data.resolutionId, scope: scopeOf(request), accessToken: tokenOf(request), idempotencyKey: parsed.data.idempotencyKey, requestHash: payloadHash({ resolutionId: parsed.data.resolutionId }) });
      // Hotfix: a replayed request or a stored result queues no Qloo call, so it costs the visitor nothing.
      if (created.cached || created.reused) await returnPublicQuota(request.headers as Record<string, unknown>, "scan");
      void worker?.tick();
      return reply.code(created.cached || created.reused ? 200 : 202).send({ scanId: created.id, scanStatus: created.status, reused: created.reused, cached: created.cached });
    } catch (error) {
      // Refused inside the rolled-back transaction, before any scan was queued.
      if (error instanceof BaselineRepositoryError && REFUSED_BEFORE_QUEUE.has(error.code)) await returnPublicQuota(request.headers as Record<string, unknown>, "scan");
      return errorResponse(error, reply);
    }
  });

  const read = async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!admit(request, reply)) return null;
    const params = idParams.safeParse(request.params);
    if (!params.success || !tokenOf(request)) { void reply.code(404).send({ error: "not_found" }); return null; }
    try {
      const scan = await repository!.readScan(params.data.id, tokenOf(request));
      if (!scan) { void reply.code(404).send({ error: "not_found" }); return null; }
      return scan;
    } catch (error) { errorResponse(error, reply); return null; }
  };
  app.get<{ Params: { id: string } }>("/api/brands/baselines/:id", async (request, reply) => {
    const scan = await read(request, reply);
    if (!scan) return;
    return { scanStatus: scan.status, providerCallCount: scan.providerCallCount, stages: scan.stages, result: scan.result };
  });
  app.get<{ Params: { id: string } }>("/api/brands/baselines/:id/territories", async (request, reply) => {
    const scan = await read(request, reply);
    if (!scan) return;
    return { scanStatus: scan.status, territories: scan.result?.territories ?? [] };
  });
  app.get<{ Params: { id: string } }>("/api/brands/baselines/:id/evidence", async (request, reply) => {
    const scan = await read(request, reply);
    if (!scan) return;
    return { scanStatus: scan.status, signals: scan.result?.fingerprint.signals ?? [], provenance: scan.result?.fingerprint.provenance ?? [] };
  });
}
