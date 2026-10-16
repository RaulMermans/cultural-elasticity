import type { AgentRunResponse } from "@cultural-elasticity/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AgentInputError, AgentNotConfiguredError, RunNotFoundError, RunNotWaitingError } from "../agent/errors.js";
import { createAgentModel, createLiveToolProvider, type ModelChoice } from "../agent/factory.js";
import { RunStore } from "../agent/run-store.js";
import { AgentRuntime } from "../agent/runtime.js";
import type { AgentToolProvider } from "../agent/tool-provider.js";
import type { EvidenceIssue } from "../evidence/schema.js";

/** Builds (or reuses) the runtime for a model choice. Injected in tests; lazily wired to live Qloo otherwise. */
export type AgentRuntimeFactory = (model: ModelChoice) => AgentRuntime;

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
 *   POST /api/agent/analyze   { query, brand?, territories?, intent?, model? } → AgentAnalysisResult | NEEDS_INPUT
 *   POST /api/agent/continue  { runId, clarification }                       → AgentAnalysisResult | NEEDS_INPUT
 * A live run makes real Qloo calls (spaced to respect rate limits) and can take minutes.
 */
export function agentRoutes(factory: AgentRuntimeFactory = liveRuntimeFactory()) {
  return async function routes(app: FastifyInstance): Promise<void> {
    const handle = async (reply: { code: (n: number) => { send: (b: ErrorBody) => unknown } }, work: () => Promise<AgentRunResponse>) => {
      try {
        return await work();
      } catch (error) {
        if (error instanceof AgentInputError) return reply.code(400).send({ error: "invalid_agent_request", issues: error.issues });
        if (error instanceof AgentNotConfiguredError) return reply.code(503).send({ error: error.code, message: error.message });
        if (error instanceof RunNotFoundError) return reply.code(404).send({ error: "run_not_found", message: error.message });
        if (error instanceof RunNotWaitingError) return reply.code(409).send({ error: "run_not_waiting", message: error.message });
        throw error;
      }
    };

    app.post<{ Body: unknown }>("/api/agent/analyze", async (request, reply) => {
      const body = analyzeBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_agent_request", issues: issues(body.error) });
      const { query, model, ...fields } = body.data;
      return handle(reply, () => factory(model ?? "auto").run({ userQuery: query, ...fields }));
    });

    app.post<{ Body: unknown }>("/api/agent/continue", async (request, reply) => {
      const body = continueBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_agent_request", issues: issues(body.error) });
      return handle(reply, () => factory(body.data.model ?? "auto").continue(body.data.runId, body.data.clarification));
    });
  };
}
