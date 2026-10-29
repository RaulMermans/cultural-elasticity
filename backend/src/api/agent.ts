import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { projectCulturalConnections, type AgentAnalysisResult, type AgentRunResponse, type AgentTerritoryResult, type AnyBrandBaselineResult, type ComparativeReferenceCandidate } from "@cultural-elasticity/shared";
import { createBaselinePool } from "../brand-baseline/db.js";
import { BaselineRepository } from "../brand-baseline/repository.js";
import { buildDeepInvestigationRequest, buildProposedInvestigationRequest, directionGrounding, HandoffError } from "./baseline-handoff.js";
import { admit, globalJobLimit, jobCreateLimit } from "./admission.js";
import { baselineAllowed, developmentRoutesOpen } from "./exposure.js";
import { buildComparativeHandoffRequest, collectReferenceCandidates, projectComparativeStrategicReport, representationProblem, validateComparativeOutcome, type ComparativePlan, type ExemplarProfileEvidence } from "../agent/comparative-bridge.js";
import { defaultLimits } from "../agent/contracts.js";
import { AgentInputError, AgentNotConfiguredError, RunNotFoundError, RunNotWaitingError } from "../agent/errors.js";
import { DEFAULT_AGENT_MODEL } from "../agent/model/anthropic.js";
import { MAX_PANEL_OPTIONS } from "../methodology/contracts.js";
import { conservativeReserveUsd } from "../ops/pricing.js";
import { createAgentModel, createLiveToolProvider, createQueryInterpreter, type ModelChoice } from "../agent/factory.js";
import { confirmBody, queryBody } from "../agent/query/contracts.js";
import type { QueryInterpreter } from "../agent/query/interpreter.js";
import { JobManager, JobRejectedError, type JobRequest } from "../agent/query/jobs.js";
import { QueryAlreadyExecutedError, QueryService, QueryStore } from "../agent/query/service.js";
import { RunStore } from "../agent/run-store.js";
import { AgentRuntime } from "../agent/runtime.js";
import type { AgentToolProvider } from "../agent/tool-provider.js";
import type { EvidenceIssue } from "../evidence/schema.js";
import { admitVisitor, verifyInternalAuth, verifyPaidOperator } from "../ops/identity.js";
import { canAcceptInvestigations } from "../ops/lifecycle.js";
import { opsMetrics } from "../ops/metrics.js";
import { registerJobManager } from "../ops/server.js";
import { spendLedger, type SpendReservation } from "../ops/spend.js";
import { takePublicQuota } from "../ops/public-quota.js";
import { runLedger, unusedReservationCents } from "../ops/run-ledger.js";
import type { ObservedUsage } from "../ops/usage.js";

/** Builds (or reuses) the runtime for a model choice. Injected in tests; lazily wired to live Qloo otherwise. */
export type AgentRuntimeFactory = (model: ModelChoice) => AgentRuntime;
/** Sprint 5B.1: the query interpreter for a model choice. Injected in tests; Haiku (or structural for baseline) otherwise. */
export type QueryInterpreterFactory = (model: ModelChoice) => QueryInterpreter;
/** Reads an authorized baseline scan. PostgreSQL in production; injected in tests. */
export type BaselineReader = Pick<BaselineRepository, "readScan">;

/**
 * Sprint 9N rollback switch: CE_FEASIBILITY_POLICY=observe restores the Sprint 9M reference-construction control flow
 * (feasibility is still recorded). Any other value, or none, is the default "enforce".
 */
export function feasibilityPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): "enforce" | "observe" {
  return env.CE_FEASIBILITY_POLICY === "observe" ? "observe" : "enforce";
}

export function liveRuntimeFactory(): AgentRuntimeFactory {
  const store = new RunStore();
  const runtimes = new Map<ModelChoice, AgentRuntime>();
  let provider: AgentToolProvider | undefined;
  return (choice) => {
    const existing = runtimes.get(choice);
    if (existing) return existing;
    const model = createAgentModel(choice);
    provider ??= createLiveToolProvider();
    const runtime = new AgentRuntime({ model, provider, store, feasibilityPolicy: feasibilityPolicyFromEnv() });
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
const handoffBody = z.strictObject({ scanId: z.uuid(), territoryId: z.string().trim().min(1).max(120).optional(), proposedDirection: z.string().trim().min(1).max(120).optional(), idempotencyKey: z.uuid() }).refine((value) => Boolean(value.territoryId) !== Boolean(value.proposedDirection));
/** Sprint 9I comparative handoff. Identifiers only: target, references, evidence, types and budgets come from the server. */
const compareBody = z.strictObject({
  scanId: z.uuid(),
  parentJobId: z.uuid(),
  referenceIds: z.array(z.string().trim().min(1).max(240)).max(MAX_PANEL_OPTIONS).optional(),
  idempotencyKey: z.uuid().optional(),
});
const MAX_RUN_MINUTES = 20;

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
export function agentRoutes(factory: AgentRuntimeFactory = liveRuntimeFactory(), interpreters: QueryInterpreterFactory = createQueryInterpreter, injected: { baselines?: BaselineReader } = {}) {
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
    const reservations = new Map<string, { id: string; started: boolean; durableCents: number }>();
    const handoffJobs = new Map<string, { directionKey: string; pending: Promise<unknown> }>();
    /** Investigations started from a baseline scan (job id → scan). Scan ownership is how siblings are found. */
    const handoffOrigins = new Map<string, { scanId: string }>();
    /** Comparative jobs and the plan the server authorized for each (in memory, like the jobs themselves). */
    const comparativeJobs = new Map<string, { scanId: string; plan: ComparativePlan; baseline: AnyBrandBaselineResult; parentRunId: string }>();
    const comparativeKeys = new Map<string, { referenceKey: string; pending: Promise<unknown> }>();
    const baselinePool = !injected.baselines && process.env.CE_BASELINE_ENABLED === "1" && process.env.DATABASE_URL ? createBaselinePool(process.env.DATABASE_URL) : null;
    const baselines: BaselineReader | null = injected.baselines ?? (baselinePool ? new BaselineRepository(baselinePool) : null);
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
            // Sprint 9M: once the provider reported usage, the unused part of the durable reservation is returned,
            // so a long public evaluation is bounded by real spend. Unknown usage keeps the whole reservation.
            const unused = unusedReservationCents(hold.durableCents, settled);
            if (unused > 0) void runLedger()?.release("model_usd_cents", unused);
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
      const operator = verifyPaidOperator(headersOf(request));
      if (!operator.ok) {
        opsMetrics().record("admission_rejected");
        void reply.code(403).send({ error: operator.code, message: "Paid research is restricted to an authorized operator." });
        return false;
      }
      const visitor = admitVisitor(headersOf(request), true);
      if (admit(`create:${visitor.visitorId}`, jobCreateLimit(), 10 * 60_000) && admit("create:global", globalJobLimit(), 10 * 60_000)) return true;
      opsMetrics().record("admission_rejected");
      void reply.code(429).send({ error: "too_many_requests", message: "Too many investigations were requested. Wait a moment and try again." });
      return false;
    };
    const reserveSpend = async (reply: FastifyReply): Promise<{ reservation: SpendReservation; durableCents: number } | null> => {
      const reserved = spendLedger().reserve();
      if (!reserved.ok) {
        opsMetrics().record(reserved.code === "budget_exhausted" ? "budget_exceeded" : "admission_rejected");
        void reply.code(reserved.code === "budget_unavailable" ? 503 : 429).send({ error: reserved.code, message: reserved.message });
        return null;
      }
      // Sprint 9J: the same reservation is also taken durably for the operator run and never returned, so a
      // restart cannot reopen a model budget the in-memory ledger forgot.
      const ledger = runLedger();
      const budget = spendLedger().configuredBudgetUsd();
      const durableCents = ledger ? Math.ceil(reserved.reservation.reservedUsd * 100) : 0;
      if (ledger) {
        const durable = budget === null ? ({ ok: false, code: "ledger_unavailable" } as const) : await ledger.take("model_usd_cents", durableCents, Math.floor(budget * 100));
        if (!durable.ok) {
          spendLedger().settle(reserved.reservation.id, { observedUsd: 0, started: false, cancelledBeforeStart: true });
          opsMetrics().record(durable.code === "limit_reached" ? "budget_exceeded" : "admission_rejected");
          if (durable.code === "limit_reached") void reply.code(429).send({ error: "budget_exhausted", message: "The available investigation budget cannot cover another run." });
          else void reply.code(503).send({ error: "budget_unavailable", message: "Investigations cannot start because the spend record is unavailable." });
          return null;
        }
      }
      return { reservation: reserved.reservation, durableCents };
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
    const enqueue = async (jobRequest: JobRequest, request: FastifyRequest, reply: FastifyReply) => {
      const quota = await takePublicQuota(headersOf(request), "investigation");
      if (!quota.ok) {
        opsMetrics().record("admission_rejected");
        return reply.code(quota.status).send({ error: quota.error, message: quota.message });
      }
      const held = await reserveSpend(reply);
      if (!held) return;
      const hold = held.reservation;
      opsMetrics().record("budget_reserved");
      return handle(reply, async () => {
        try {
          const bound = spendLedger().bound(hold.id) ?? undefined;
          const created = jobs.create(jobRequest, bound ? { spend: bound } : undefined);
          spendLedger().attach(hold.id, created.jobId);
          const started = created.status === "running";
          reservations.set(created.jobId, { id: hold.id, started, durableCents: held.durableCents });
          if (started) spendLedger().markStarted(hold.id);
          opsMetrics().record("job_accepted");
          reply.code(202);
          return created;
        } catch (error) {
          spendLedger().settle(hold.id, { observedUsd: 0, started: false, cancelledBeforeStart: true });
          if (held.durableCents > 0) void runLedger()?.release("model_usd_cents", held.durableCents);
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
      return enqueue(jobRequest, request, reply);
    });
    /**
     * Structured baseline handoff. The client cannot provide brand, evidence, objective, tools or budgets.
     * Sprint 9L: a direction is investigated comparatively (the runtime builds its own Qloo-validated reference set),
     * so it can be placed and classed; the single-hypothesis check could only ever say "inconclusive" for thin evidence.
     */
    const handoff = async (request: FastifyRequest<{ Body: unknown }>, reply: FastifyReply, execute: boolean) => {
      if (rejectUnauthenticated(request, reply)) return;
      const parsed = handoffBody.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_handoff_request" });
      const token = tokenOf(request.headers["x-baseline-token"]);
      if (!baselines || !token) return reply.code(404).send({ error: "baseline_not_found" });
      const scan = await baselines.readScan(parsed.data.scanId, token);
      if (!scan?.result) return reply.code(404).send({ error: "baseline_not_found" });
      let prepared;
      try { prepared = parsed.data.proposedDirection ? buildProposedInvestigationRequest(scan.result, parsed.data.proposedDirection) : buildDeepInvestigationRequest(scan.result, parsed.data.territoryId!); }
      catch (error) { if (error instanceof HandoffError) return reply.code(422).send({ error: error.code.toLowerCase() }); throw error; }
      if (!execute) return prepared;
      if (!admitCreate(request, reply)) return;
      const key = `${parsed.data.scanId}:${parsed.data.idempotencyKey}`;
      const existing = handoffJobs.get(key);
      if (existing) {
        if (existing.directionKey !== prepared.territory.id) return reply.code(409).send({ error: "idempotency_conflict" });
        const prior = await existing.pending;
        if (!prior || typeof prior !== "object" || !("jobId" in prior)) return reply.code(409).send({ error: "idempotency_unavailable" });
        return reply.code(200).send(prior);
      }
      const body = queryBody.parse({ query: prepared.agentRequest.userQuery, brand: prepared.brand.name, intent: "analyze_move", territories: [prepared.territory.name] });
      const grounding = parsed.data.proposedDirection ? null : directionGrounding(scan.result, parsed.data.territoryId!);
      const pending = Promise.resolve(enqueue({ kind: "execute", body, model: "auto", expectedBrandId: prepared.brand.qlooId, ...(grounding && { territoryGrounding: grounding }) }, request, reply));
      handoffJobs.set(key, { directionKey: prepared.territory.id, pending });
      if (handoffJobs.size > 200) handoffJobs.delete(handoffJobs.keys().next().value!);
      const created = await pending;
      if (!created || typeof created !== "object" || !("jobId" in created)) handoffJobs.delete(key);
      else remember(handoffOrigins, String(created.jobId), { scanId: parsed.data.scanId });
      return created;
    };

    // ---- Sprint 9I: comparative handoff from a completed single-direction investigation ----

    const remember = <V>(map: Map<string, V>, key: string, value: V) => {
      map.set(key, value);
      if (map.size > 200) map.delete(map.keys().next().value!);
    };
    const completedResult = (view: { status: string; response: { investigation: { runId: string; result: unknown } | null } | null } | null): AgentAnalysisResult | null => {
      const result = view?.status === "completed" ? view.response?.investigation?.result : null;
      return result && typeof result === "object" && (result as AgentAnalysisResult).status === "COMPLETE" ? (result as AgentAnalysisResult) : null;
    };
    /** Tag profiles the parent run fetched for the target's exemplars, read from server-held run state. */
    const exemplarProfiles = (runId: string, target: AgentTerritoryResult): ExemplarProfileEvidence[] => {
      let state;
      try { state = factory("auto").store.get(runId); } catch { return []; }
      if (!state) return [];
      return target.representation.exemplars.flatMap((exemplar) => {
        const profile = state.profiles.get(exemplar.id);
        if (!profile) return [];
        const status = profile.call.envelope.status === "ok" ? "ok" as const : profile.call.envelope.status === "partial" ? "partial" as const : "degraded" as const;
        const tags = profile.tagIds.flatMap((id) => { const tag = state.tags.get(id); return tag ? [{ id, label: tag.label }] : []; });
        return [{ subjectId: exemplar.id, subjectType: exemplar.type, tags, correlationId: profile.call.envelope.execution.correlation_id, status }];
      });
    };
    const limits = () => {
      const base = defaultLimits("compare_territories");
      return { maxQlooCalls: base.maxQlooCalls, maxAgentTurns: base.maxAgentIterations, maxRunMinutes: MAX_RUN_MINUTES, maxPanelOptions: MAX_PANEL_OPTIONS, model: DEFAULT_AGENT_MODEL, reservedUsd: conservativeReserveUsd(), unknownOutcomes: "An uncertain provider call counts against the budget and is never replayed automatically." };
    };
    type CompareContext = { scan: AnyBrandBaselineResult; parentRunId: string; parent: AgentAnalysisResult; target: AgentTerritoryResult; candidates: ComparativeReferenceCandidate[]; siblings: AgentAnalysisResult[] };
    /** Everything is re-read on the server: the scan by its token, the parent job by its token, siblings by scan ownership. */
    const compareContext = async (request: FastifyRequest<{ Body: unknown }>, reply: FastifyReply): Promise<{ body: z.output<typeof compareBody>; context: CompareContext } | null> => {
      if (rejectUnauthenticated(request, reply)) return null;
      const parsed = compareBody.safeParse(request.body);
      if (!parsed.success) { void reply.code(400).send({ error: "invalid_comparison_request" }); return null; }
      const scanToken = tokenOf(request.headers["x-baseline-token"]);
      const jobToken = tokenOf(request.headers["x-job-token"]);
      if (!baselines || !scanToken || !jobToken) { void reply.code(404).send({ error: "investigation_not_found" }); return null; }
      const scan = await baselines.readScan(parsed.data.scanId, scanToken);
      const origin = handoffOrigins.get(parsed.data.parentJobId);
      const view = jobs.get(parsed.data.parentJobId, jobToken);
      // Unknown scan, wrong token, a job from another scan or a job that is gone all look the same.
      if (!scan?.result || !view || origin?.scanId !== parsed.data.scanId) { void reply.code(404).send({ error: "investigation_not_found" }); return null; }
      const parent = completedResult(view);
      if (!parent) { void reply.code(409).send({ error: "investigation_not_complete", status: view.status, message: "Only a completed investigation can start a comparison." }); return null; }
      if (parent.brand?.id !== scan.result.brand.qlooId) { void reply.code(409).send({ error: "brand_mismatch", message: "The investigation resolved a different Qloo brand than this research scan." }); return null; }
      const target = parent.territories.find((t) => t.role === "target") ?? null;
      if (!target) { void reply.code(409).send({ error: "target_not_found" }); return null; }
      const siblings = [...handoffOrigins.entries()].filter(([jobId, item]) => item.scanId === parsed.data.scanId && jobId !== parsed.data.parentJobId).flatMap(([jobId]) => {
        const result = completedResult(jobs.peek(jobId));
        return result ? [{ jobId, result }] : [];
      });
      const parentRunId = view.response!.investigation!.runId;
      const candidates = collectReferenceCandidates({ brandId: scan.result.brand.qlooId, target, exemplarProfiles: exemplarProfiles(parentRunId, target), siblings, baseline: scan.result });
      return { body: parsed.data, context: { scan: scan.result, parentRunId, parent, target, candidates, siblings: siblings.map((s) => s.result) } };
    };
    const selected = (context: CompareContext, ids: readonly string[]) => {
      const unknown = ids.filter((id) => !context.candidates.some((c) => c.id === id));
      return unknown.length ? null : ids.map((id) => context.candidates.find((c) => c.id === id)!);
    };
    const planFor = (context: CompareContext, request: ReturnType<typeof buildComparativeHandoffRequest> & { ok: true }): ComparativePlan => ({
      brandId: context.scan.brand.qlooId,
      brandLabel: context.parent.brand!.label,
      target: { label: context.target.label, conceptId: context.target.resolvedConcept?.id ?? null, entityType: request.eligibility.target!.entityType, ...(context.parent.hypothesisAssessment ? { singleHypothesisOutcome: context.parent.hypothesisAssessment.outcome } : {}) },
      references: (request.eligibility.validatedReferences ?? []).map((ref) => ({ id: ref.key, label: ref.label, conceptId: ref.conceptId ?? null, entityType: ref.entityType, typeBasis: ref.typeBasis ?? "UNKNOWN" })),
    });

    app.post<{ Body: unknown }>("/api/agent/handoff/compare/options", { bodyLimit: 4096 }, async (request, reply) => {
      const loaded = await compareContext(request, reply);
      if (!loaded) return;
      const { context } = loaded;
      const problem = representationProblem(context.target);
      return {
        version: "ce-comparative-options/0.1",
        brand: { name: context.scan.brand.name, qlooId: context.scan.brand.qlooId },
        target: {
          label: context.target.label,
          conceptId: context.target.resolvedConcept?.id ?? null,
          entityType: context.target.representation.entityType,
          exemplars: context.target.representation.exemplars.map((e) => ({ label: e.label, type: e.type })),
          correlationIds: context.target.provenance.correlationIds,
          singleHypothesisOutcome: context.parent.hypothesisAssessment?.outcome ?? null,
          canAnchor: problem === null,
          problem,
        },
        references: context.candidates,
        limits: limits(),
        admission: { accepting: canAcceptInvestigations() },
        connections: projectCulturalConnections({ brand: { id: context.scan.brand.qlooId, name: context.scan.brand.name }, evidenceOrigin: context.parent.evidenceOrigin, baseline: context.scan, runs: [context.parent, ...context.siblings] }),
      };
    });

    const compare = async (request: FastifyRequest<{ Body: unknown }>, reply: FastifyReply, execute: boolean) => {
      const loaded = await compareContext(request, reply);
      if (!loaded) return;
      const { body, context } = loaded;
      const references = selected(context, body.referenceIds ?? []);
      if (!references) return reply.code(422).send({ error: "reference_not_offered", message: "A selected reference is not one the server offered for this investigation." });
      const handoff = buildComparativeHandoffRequest(context.parent.brand, context.target, references, { expectedBrandId: context.scan.brand.qlooId });
      if (!execute) return { version: "ce-comparative-preview/0.1", eligibility: handoff.eligibility, territories: handoff.ok ? handoff.request.territories : null, limits: limits(), admission: { accepting: canAcceptInvestigations() } };
      if (!body.idempotencyKey) return reply.code(400).send({ error: "invalid_comparison_request", message: "A start needs an idempotency key." });
      // A repeated start returns the job it already created; the key never authorizes a different request.
      const key = `${body.scanId}:${body.parentJobId}:${body.idempotencyKey}`;
      const referenceKey = references.map((r) => r.id).sort().join("|");
      const existing = comparativeKeys.get(key);
      if (existing) {
        if (existing.referenceKey !== referenceKey) return reply.code(409).send({ error: "idempotency_conflict" });
        const prior = await existing.pending;
        if (!prior || typeof prior !== "object" || !("jobId" in prior)) return reply.code(409).send({ error: "idempotency_unavailable" });
        return reply.code(200).send(prior);
      }
      if (!handoff.ok) return reply.code(422).send({ error: "comparison_not_eligible", eligibility: handoff.eligibility });
      // Paid admission is decided here, at dispatch, never by the eligibility gate or the browser.
      if (!admitCreate(request, reply)) return;
      const plan = planFor(context, handoff);
      const queryBodyValue = queryBody.parse({ query: handoff.request.userQuery, brand: handoff.request.brand, intent: "compare_territories", territories: handoff.request.territories });
      const pending = Promise.resolve(enqueue({ kind: "execute", body: queryBodyValue, model: "auto", expectedBrandId: context.scan.brand.qlooId }, request, reply));
      remember(comparativeKeys, key, { referenceKey, pending });
      const created = await pending;
      if (!created || typeof created !== "object" || !("jobId" in created)) comparativeKeys.delete(key);
      else remember(comparativeJobs, String(created.jobId), { scanId: body.scanId, plan, baseline: context.scan, parentRunId: context.parentRunId });
      return created;
    };
    app.post<{ Body: unknown }>("/api/agent/handoff/compare/preview", { bodyLimit: 4096 }, (request, reply) => compare(request, reply, false));
    app.post<{ Body: unknown }>("/api/agent/handoff/compare/jobs", { bodyLimit: 4096 }, (request, reply) => compare(request, reply, true));

    /** The validated comparative report for a comparative job. Recomputed from the held result on every read. */
    app.get<{ Params: { id: string } }>("/api/agent/handoff/compare/:id/report", async (request, reply) => {
      if (rejectUnauthenticated(request, reply)) return;
      const view = jobs.get(request.params.id, tokenOf(request.headers["x-job-token"]));
      const entry = comparativeJobs.get(request.params.id);
      if (!view || !entry) return reply.code(404).send({ error: "job_not_found", message: "This comparison is not available. It may have expired, or the server may have restarted." });
      const result = view.response?.investigation?.result;
      const analysis = result && typeof result === "object" && (result as AgentRunResponse).status !== "NEEDS_INPUT" ? (result as AgentAnalysisResult) : null;
      if (view.status !== "completed" || !analysis) {
        return { version: "ce-comparative-report-envelope/0.1", status: view.status, error: view.error, report: null, connections: null };
      }
      const verdict = validateComparativeOutcome(entry.plan, analysis);
      return {
        version: "ce-comparative-report-envelope/0.1",
        status: view.status,
        error: view.error,
        report: projectComparativeStrategicReport(analysis, entry.plan, verdict),
        connections: projectCulturalConnections({ brand: { id: entry.plan.brandId, name: entry.plan.brandLabel }, evidenceOrigin: analysis.evidenceOrigin, baseline: entry.baseline, runs: [analysis] }),
      };
    });
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
