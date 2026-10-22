import type { AgentRunResponse, QueryResponse } from "@cultural-elasticity/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AgentInputError, AgentNotConfiguredError, RunNotFoundError, RunNotWaitingError } from "../agent/errors.js";
import { createAgentModel, createLiveToolProvider, createQueryInterpreter, type ModelChoice } from "../agent/factory.js";
import { confirmBody, queryBody, type QueryBody } from "../agent/query/contracts.js";
import type { QueryInterpreter } from "../agent/query/interpreter.js";
import { QueryAlreadyExecutedError, QueryService, QueryStore } from "../agent/query/service.js";
import { RunStore } from "../agent/run-store.js";
import { AgentRuntime } from "../agent/runtime.js";
import type { AgentToolProvider } from "../agent/tool-provider.js";
import type { EvidenceIssue } from "../evidence/schema.js";

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
    const handle = async (reply: { code: (n: number) => { send: (b: ErrorBody) => unknown } }, work: () => Promise<AgentRunResponse | QueryResponse>) => {
      try {
        return await work();
      } catch (error) {
        if (error instanceof AgentInputError) return reply.code(400).send({ error: "invalid_agent_request", issues: error.issues });
        if (error instanceof AgentNotConfiguredError) return reply.code(503).send({ error: error.code, message: error.message });
        if (error instanceof RunNotFoundError) return reply.code(404).send({ error: "run_not_found", message: error.message });
        if (error instanceof RunNotWaitingError) return reply.code(409).send({ error: "run_not_waiting", message: error.message });
        if (error instanceof QueryAlreadyExecutedError) return reply.code(409).send({ error: "query_already_executed", message: error.message });
        throw error;
      }
    };

    app.post<{ Body: unknown }>("/api/agent/analyze", async (request, reply) => {
      const body = analyzeBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_agent_request", issues: issues(body.error) });
      const { query, model, ...fields } = body.data;
      return handle(reply, () => factory(model ?? "auto").run({ userQuery: query, ...fields }));
    });

    const queryRoute = (mode: "interpret" | "query" | "follow-up") => async (request: { body: unknown }, reply: Parameters<typeof handle>[0]) => {
      const confirm = mode !== "interpret" ? confirmBody.safeParse(request.body) : null;
      if (confirm?.success) return handle(reply, () => service(confirm.data.model ?? "auto", log).confirm(confirm.data.confirmQueryId));
      const body = queryBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_query_request", issues: issues(body.error) });
      if (mode === "query" && body.data.context) return reply.code(400).send({ error: "invalid_query_request", message: "a query with an investigation context is a follow-up: use /api/agent/follow-up" });
      if (mode === "follow-up" && !body.data.context) return reply.code(400).send({ error: "invalid_query_request", message: "a follow-up needs context.runId" });
      const data: QueryBody = body.data;
      const svc = service(data.model ?? "auto", log);
      return handle(reply, () => (mode === "interpret" ? svc.interpret(data) : svc.execute(data)));
    };
    app.post<{ Body: unknown }>("/api/agent/interpret", queryRoute("interpret"));
    app.post<{ Body: unknown }>("/api/agent/query", queryRoute("query"));
    app.post<{ Body: unknown }>("/api/agent/follow-up", queryRoute("follow-up"));

    app.post<{ Body: unknown }>("/api/agent/continue", async (request, reply) => {
      const body = continueBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_agent_request", issues: issues(body.error) });
      return handle(reply, () => factory(body.data.model ?? "auto").continue(body.data.runId, body.data.clarification));
    });
  };
}
