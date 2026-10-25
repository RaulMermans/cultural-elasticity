import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { createBaselinePool } from "../brand-baseline/db.js";
import { BaselineRepository } from "../brand-baseline/repository.js";
import { buildDeepInvestigationRequest, HandoffError } from "./baseline-handoff.js";
import { admit, globalJobLimit, jobCreateLimit } from "./admission.js";
import { baselineAllowed, developmentRoutesOpen } from "./exposure.js";
import { AgentInputError, AgentNotConfiguredError, RunNotFoundError, RunNotWaitingError } from "../agent/errors.js";
import { createAgentModel, createLiveToolProvider, createQueryInterpreter, type ModelChoice } from "../agent/factory.js";
import { confirmBody, queryBody } from "../agent/query/contracts.js";
import type { QueryInterpreter } from "../agent/query/interpreter.js";
import { JobManager, JobRejectedError, type JobRequest } from "../agent/query/jobs.js";
import { QueryAlreadyExecutedError, QueryService, QueryStore } from "../agent/query/service.js";
import { RunStore } from "../agent/run-store.js";
import { AgentRuntime } from "../agent/runtime.js";
import type { AgentToolProvider } from "../agent/tool-provider.js";
import type { EvidenceIssue } from "../evidence/schema.js";
import { admitVisitor, verifyInternalAuth } from "../ops/identity.js";
import { canAcceptInvestigations } from "../ops/lifecycle.js";
import { opsMetrics } from "../ops/metrics.js";
import { registerJobManager } from "../ops/server.js";
import { spendLedger } from "../ops/spend.js";
import type { ObservedUsage } from "../ops/usage.js";

/** Builds (or reuses) the runtime for a model choice. Injected in tests; lazily wired to live Qloo otherwise. */
export type AgentRuntimeFactory = (model: ModelChoice) => AgentRuntime;
/** Sprint 5B.1: the query interpreter for a model choice. Injected in tests; Haiku (or structural for baseline) otherwise. */
export type QueryInterpreterFactory = (model: ModelChoice) => QueryInterpreter;

export function liveRuntimeFactory(): AgentRuntimeFactory {
  const store = new RunStore();
  const runtimes = new Map<ModelChoice, AgentRuntime>();
  let provider: AgentToolProvider | undefined;
  return (choice) => {
    const existing = runtimes.get(choice);
    if (existing) return existing;
    const model = createAgentModel(choice);
    provider ??= createLiveToolProvider();
    const runtime = new AgentRuntime({ model, provider, store });
    runtimes.set(choice, runtime);
    return runtime;
  };
}

const analyzeBody = z.strictObject({
  query: z.string().trim().min(1).max(2_000),
  brand: z.string().trim().min(1).max(200).optional(),
  territories: z.array(z.string().trim().min(1).max(200)).max(6).optional(),
  intent: z.enum(["analyze_move", "compare_territories", "explore_frontier"]).optional(),
  /** Development only: "baseline" runs the deterministic reference policy instead of the model. */
  model: z.enum(["auto", "baseline"]).optional(),
});
const continueBody = z.strictObject({ runId: z.string().uuid(), clarification: z.string().trim().min(1).max(1_000), model: z.enum(["auto", "baseline"]).optional() });
const continueJobBody = z.strictObject({ continueRunId: z.string().uuid(), clarification: z.string().trim().min(1).max(1_000), model: z.enum(["auto", "baseline"]).optional() });
const handoffBody = z.strictObject({ scanId: z.uuid(), territoryId: z.string().trim().min(1).max(120), idempotencyKey: z.uuid() });

type ErrorBody = { error: string; message?: string; issues?: EvidenceIssue[] };

function issues(error: z.ZodError): EvidenceIssue[] {
  return error.issues.map((i) => ({ path: i.path.map(String).join(".") || "(root)", message: i.message }));
}

/**
 * Development endpoints for the Agentic Investigation Runtime. Runs are kept in memory only.
 *   POST /api/agent/analyze    { query, brand?, territories?, intent?, model? } → AgentAnalysisResult | NEEDS_INPUT
 *   POST /api/agent/continue   { runId, clarification }                       → AgentAnalysisResult | NEEDS_INPUT
 * Sprint 5B.1 query layer (one interpretation policy, see agent/query/service.ts):
 *   POST /api/agent/interpret  { query, brand?, territories?, intent?, context? } → QueryResponse (dry run, no Qloo call)
 *   POST /api/agent/query      { query, ... } | { confirmQueryId }              → QueryResponse (new investigation)
 *   POST /api/agent/follow-up  { query, ..., context: { runId, selectedTerritoryKey? } } | { confirmQueryId }
 *                                                                              → QueryResponse (new child run, linked)
 * /continue answers a NEEDS_INPUT run (budgets already spent stay spent); /follow-up starts a new bounded run.
 * Sprint 5B.2 asynchronous investigations (same service, detached from the HTTP request; in-memory only):
 *   POST /api/agent/jobs        the query body, { confirmQueryId }, or { continueRunId, clarification }
 *   GET  /api/agent/jobs/:id    header x-job-token. 404 when the token is missing, wrong, or the job is gone.
 *   POST /api/agent/jobs/:id/cancel
 * A live run makes real Qloo calls (spaced to respect rate limits) and can take minutes.
 */
export function agentRoutes(factory: AgentRuntimeFactory = liveRuntimeFactory(), interpreters: QueryInterpreterFactory = createQueryInterpreter) {
  const queries = new QueryStore();
  const services = new Map<ModelChoice, QueryService>();
  const service = (choice: ModelChoice, log: (t: unknown) => void) => {
    let existing = services.get(choice);
    if (!existing) {
      existing = new QueryService({ runtime: factory(choice), interpreter: interpreters(choice), queries, log });
      services.set(choice, existing);
    }
    return existing;
  };
  return async function routes(app: FastifyInstance): Promise<void> {
    // Query-layer telemetry carries no raw query text (length + hash only), no prompt and no credential.
    const log = (telemetry: unknown) => app.log.info({ queryTelemetry: telemetry }, "query");
    const reservations = new Map<string, { id: string; started: boolean }>();
    const handoffJobs = new Map<string, { territoryId: string; pending: Promise<unknown> }>();
    const baselinePool = process.env.CE_BASELINE_ENABLED === "1" && process.env.DATABASE_URL ? createBaselinePool(process.env.DATABASE_URL) : null;
    const baselines = baselinePool ? new BaselineRepository(baselinePool) : null;
    const jobs = new JobManager({
      runnerFor: (model) => service(model === "baseline" ? "baseline" : "auto", log),
      log: (event) => {
        log(event);
        const name = typeof event.event === "string" ? event.event : undefined;
        const usage = event.usage as ObservedUsage | undefined;
        if (name === "job_started") {
          const hold = typeof event.jobId === "string" ? reservations.get(event.jobId) : undefined;
          if (hold) {
            spendLedger().markStarted(hold.id);
            hold.started = true;
          }
        }
        if (name === "job_completed" || name === "job_failed" || name === "job_cancelled" || name === "job_expired") {
          const jobId = typeof event.jobId === "string" ? event.jobId : "";
          const hold = reservations.get(jobId);
          if (hold) {
            const settled = spendLedger().settle(hold.id, {
              observedUsd: usage?.observedUsd ?? null,
              started: hold.started,
              cancelledBeforeStart: name === "job_cancelled" && !hold.started,
            });
            opsMetrics().record("budget_reconciled", {
              estimatedModelCostUsd: settled?.consumedUsd,
              overageUsd: settled?.overageUsd,
            });
            if (settled && settled.overageUsd > 0) opsMetrics().record("budget_exceeded", { overageUsd: settled.overageUsd });
            reservations.delete(jobId);
          }
        }
        if (name === "job_queued" || name === "job_started" || name === "job_completed" || name === "job_failed" || name === "job_cancelled" || name === "job_expired") {
          opsMetrics().record(name, {
            durationMs: event.durationMs,
            interpretationLatencyMs: usage?.interpretationLatencyMs ?? undefined,
            qlooCalls: usage?.qlooCalls,
            inputTokens: usage?.inputTokens,
            outputTokens: usage?.outputTokens,
            estimatedModelCostUsd: usage?.observedUsd ?? undefined,
          });
        }
      },
    });
    registerJobManager(jobs);
    app.addHook("onClose", async () => {
      jobs.shutdown("The investigation service is stopping.");
      await baselinePool?.end();
    });
    const modelChoice = (model: string | undefined) => (model === "baseline" ? "baseline" : "auto");
    const headersOf = (request: FastifyRequest) => request.headers as Record<string, unknown>;
    const rejectUnauthenticated = (request: FastifyRequest, reply: FastifyReply) => {
      if (verifyInternalAuth(headersOf(request))) return false;
      opsMetrics().record("admission_rejected");
      void reply.code(401).send({ error: "unauthorized", message: "This investigation service is not available from that origin." });
      return true;
    };
    const rejectBaseline = (model: string | undefined, reply: FastifyReply) => {
      if (model !== "baseline" || baselineAllowed()) return false;
      void reply.code(403).send({ error: "baseline_disabled", message: "The reference policy is not available here." });
      return true;
    };
    const admitCreate = (request: FastifyRequest, reply: FastifyReply) => {
      if (rejectUnauthenticated(request, reply)) return false;
      if (!canAcceptInvestigations()) {
        opsMetrics().record("admission_rejected");
        void reply.code(503).send({ error: "admissions_paused", message: "New investigations are not being accepted right now." });
        return false;
      }
      const visitor = admitVisitor(headersOf(request), true);
      if (admit(`create:${visitor.visitorId}`, jobCreateLimit(), 10 * 60_000) && admit("create:global", globalJobLimit(), 10 * 60_000)) return true;
      opsMetrics().record("admission_rejected");
      void reply.code(429).send({ error: "too_many_requests", message: "Too many investigations were requested. Wait a moment and try again." });
      return false;
    };
    const reserveSpend = (reply: FastifyReply) => {
      const reserved = spendLedger().reserve();
      if (reserved.ok) return reserved.reservation;
      opsMetrics().record(reserved.code === "budget_exhausted" ? "budget_exceeded" : "admission_rejected");
      void reply.code(reserved.code === "budget_unavailable" ? 503 : 429).send({ error: reserved.code, message: reserved.message });
      return null;
    };
    const closed = (reply: FastifyReply) => {
      if (developmentRoutesOpen()) return false;
      void reply.code(404).send({ error: "not_found", message: "This route is not available." });
      return true;
    };
    const handle = async (reply: { code: (n: number) => { send: (b: ErrorBody) => unknown } }, work: () => Promise<unknown>) => {
      try {
        return await work();
      } catch (error) {
        if (error instanceof AgentInputError) return reply.code(400).send({ error: "invalid_agent_request", issues: error.issues });
        if (error instanceof AgentNotConfiguredError) return reply.code(503).send({ error: error.code, message: error.message });
        if (error instanceof RunNotFoundError) return reply.code(404).send({ error: "run_not_found", message: error.message });
        if (error instanceof RunNotWaitingError) return reply.code(409).send({ error: "run_not_waiting", message: error.message });
        if (error instanceof QueryAlreadyExecutedError) return reply.code(409).send({ error: "query_already_executed", message: error.message });
        if (error instanceof JobRejectedError) return reply.code(error.statusCode).send({ error: error.code, message: error.message });
        throw error;
      }
    };
    const enqueue = (jobRequest: JobRequest, reply: FastifyReply) => {
      const hold = reserveSpend(reply);
      if (!hold) return;
      opsMetrics().record("budget_reserved");
      return handle(reply, async () => {
        try {
          const bound = spendLedger().bound(hold.id) ?? undefined;
          const created = jobs.create(jobRequest, bound ? { spend: bound } : undefined);
          spendLedger().attach(hold.id, created.jobId);
          const started = created.status === "running";
          reservations.set(created.jobId, { id: hold.id, started });
          if (started) spendLedger().markStarted(hold.id);
          opsMetrics().record("job_accepted");
          reply.code(202);
          return created;
        } catch (error) {
          spendLedger().settle(hold.id, { observedUsd: 0, started: false, cancelledBeforeStart: true });
          throw error;
        }
      });
    };

    app.post<{ Body: unknown }>("/api/agent/analyze", { bodyLimit: 32_768 }, async (request, reply) => {
      if (closed(reply)) return;
      const body = analyzeBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_agent_request", issues: issues(body.error) });
      if (rejectBaseline(body.data.model, reply) || !admitCreate(request, reply)) return;
      const { query, model, ...fields } = body.data;
      return handle(reply, () => factory(modelChoice(model)).run({ userQuery: query, ...fields }));
    });

    const queryRoute = (mode: "interpret" | "query" | "follow-up") => async (request: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      if (closed(reply)) return;
      if (!admitCreate(request, reply)) return;
      const confirm = mode !== "interpret" ? confirmBody.safeParse(request.body) : null;
      if (confirm?.success) {
        if (rejectBaseline(confirm.data.model, reply)) return;
        return handle(reply, () => service(modelChoice(confirm.data.model), log).confirm(confirm.data.confirmQueryId));
      }
      const body = queryBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_query_request", issues: issues(body.error) });
      if (rejectBaseline(body.data.model, reply)) return;
      if ("query" in body.data && mode === "query" && body.data.context) return reply.code(400).send({ error: "invalid_query_request", message: "a query with an investigation context is a follow-up: use /api/agent/follow-up" });
      if ("query" in body.data && mode === "follow-up" && !body.data.context) return reply.code(400).send({ error: "invalid_query_request", message: "a follow-up needs context.runId" });
      const data = body.data;
      const svc = service(modelChoice(data.model), log);
      return handle(reply, () => (mode === "interpret" ? svc.interpret(data) : svc.execute(data)));
    };
    app.post<{ Body: unknown }>("/api/agent/interpret", { bodyLimit: 32_768 }, queryRoute("interpret"));
    app.post<{ Body: unknown }>("/api/agent/query", { bodyLimit: 32_768 }, queryRoute("query"));
    app.post<{ Body: unknown }>("/api/agent/follow-up", { bodyLimit: 32_768 }, queryRoute("follow-up"));

    const tokenOf = (header: unknown) => (typeof header === "string" ? header : "");
    app.post<{ Body: unknown }>("/api/agent/jobs", { bodyLimit: 16_384 }, async (request, reply) => {
      if (!admitCreate(request, reply)) return;
      const confirm = confirmBody.safeParse(request.body);
      const continued = continueJobBody.safeParse(request.body);
      const query = queryBody.safeParse(request.body);
      let jobRequest: JobRequest;
      if (confirm.success) {
        if (rejectBaseline(confirm.data.model, reply)) return;
        jobRequest = { kind: "confirm", queryId: confirm.data.confirmQueryId, model: modelChoice(confirm.data.model) };
      } else if (continued.success) {
        if (rejectBaseline(continued.data.model, reply)) return;
        jobRequest = { kind: "continue", runId: continued.data.continueRunId, clarification: continued.data.clarification, model: modelChoice(continued.data.model) };
      } else if (query.success) {
        if (rejectBaseline(query.data.model, reply)) return;
        jobRequest = { kind: "execute", body: query.data, model: modelChoice(query.data.model) };
      } else return reply.code(400).send({ error: "invalid_job_request", message: "The question could not be accepted." });
      return enqueue(jobRequest, reply);
    });
    /** Structured baseline handoff. The client cannot provide brand, evidence, objective, tools or budgets. */
    const handoff = async (request: FastifyRequest<{ Body: unknown }>, reply: FastifyReply, execute: boolean) => {
      if (rejectUnauthenticated(request, reply)) return;
      const parsed = handoffBody.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_handoff_request" });
      const token = tokenOf(request.headers["x-baseline-token"]);
      if (!baselines || !token) return reply.code(404).send({ error: "baseline_not_found" });
      const scan = await baselines.readScan(parsed.data.scanId, token);
      if (!scan?.result) return reply.code(404).send({ error: "baseline_not_found" });
      let prepared;
      try { prepared = buildDeepInvestigationRequest(scan.result, parsed.data.territoryId); }
      catch (error) { if (error instanceof HandoffError) return reply.code(422).send({ error: error.code.toLowerCase() }); throw error; }
      if (!execute) return prepared;
      if (!admitCreate(request, reply)) return;
      const key = `${parsed.data.scanId}:${parsed.data.idempotencyKey}`;
      const existing = handoffJobs.get(key);
      if (existing) {
        if (existing.territoryId !== parsed.data.territoryId) return reply.code(409).send({ error: "idempotency_conflict" });
        const prior = await existing.pending;
        if (!prior || typeof prior !== "object" || !("jobId" in prior)) return reply.code(409).send({ error: "idempotency_unavailable" });
        return reply.code(200).send(prior);
      }
      const body = queryBody.parse({ query: prepared.agentRequest.userQuery, brand: prepared.brand.name, intent: "analyze_move", territories: [prepared.territory.name] });
      const pending = Promise.resolve(enqueue({ kind: "execute", body, model: "auto", expectedBrandId: prepared.brand.qlooId }, reply));
      handoffJobs.set(key, { territoryId: parsed.data.territoryId, pending });
      if (handoffJobs.size > 200) handoffJobs.delete(handoffJobs.keys().next().value!);
      const created = await pending;
      if (!created || typeof created !== "object" || !("jobId" in created)) handoffJobs.delete(key);
      return created;
    };
    app.post<{ Body: unknown }>("/api/agent/handoff/preview", { bodyLimit: 4096 }, (request, reply) => handoff(request, reply, false));
    app.post<{ Body: unknown }>("/api/agent/handoff/jobs", { bodyLimit: 4096 }, (request, reply) => handoff(request, reply, true));
    app.get<{ Params: { id: string } }>("/api/agent/jobs/:id", async (request, reply) => {
      if (rejectUnauthenticated(request, reply)) return;
      const view = jobs.get(request.params.id, tokenOf(request.headers["x-job-token"]));
      if (!view) {
        opsMetrics().record("result_unavailable");
        return reply.code(404).send({ error: "job_not_found", message: "This investigation is not available. It may have expired, or the server may have restarted." });
      }
      return view;
    });
    app.post<{ Params: { id: string } }>("/api/agent/jobs/:id/cancel", async (request, reply) => {
      if (rejectUnauthenticated(request, reply)) return;
      const visitor = admitVisitor(headersOf(request), true);
      if (!admit(`cancel:${visitor.visitorId}`, 60, 60_000)) return reply.code(429).send({ error: "too_many_requests", message: "Too many stop requests. Wait a moment and try again." });
      const view = jobs.cancel(request.params.id, tokenOf(request.headers["x-job-token"]));
      if (!view) {
        opsMetrics().record("result_unavailable");
        return reply.code(404).send({ error: "job_not_found", message: "This investigation is not available. It may have expired, or the server may have restarted." });
      }
      return view;
    });

    app.post<{ Body: unknown }>("/api/agent/continue", { bodyLimit: 16_384 }, async (request, reply) => {
      if (closed(reply)) return;
      const body = continueBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_agent_request", issues: issues(body.error) });
      if (rejectBaseline(body.data.model, reply) || !admitCreate(request, reply)) return;
      return handle(reply, () => factory(modelChoice(body.data.model)).continue(body.data.runId, body.data.clarification));
    });
  };
}
