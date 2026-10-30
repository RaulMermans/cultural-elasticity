import Fastify, { type FastifyInstance } from "fastify";
import { agentRoutes, type AgentRuntimeFactory, type BaselineReader, type QueryInterpreterFactory } from "./api/agent.js";
import { analysisRoutes } from "./api/analysis.js";
import { healthRoutes } from "./api/health.js";
import { methodologyRoutes } from "./api/methodology.js";
import { opsRoutes } from "./api/ops.js";
import { brandBaselineRoutes } from "./brand-baseline/api.js";
import type { DurableJobOptions } from "./agent/query/jobs.js";
import type { RunStore } from "./agent/run-store.js";

export type BuildAppOptions = {
  logLevel?: string;
  /** Agent runtime wiring; defaults to live Qloo (MCP) + the configured model, created on first use. */
  agentRuntimeFactory?: AgentRuntimeFactory;
  /** Sprint 5B.1 query interpreter; defaults to Haiku (structural for the baseline policy), created on first use. */
  queryInterpreterFactory?: QueryInterpreterFactory;
  /** Baseline scan reader for the research handoff routes; PostgreSQL by default. Injected in tests. */
  baselineReader?: BaselineReader;
  /** Sprint 10C durable agent jobs; defaults to CE_DURABLE_AGENT / DATABASE_URL. null forces in-process jobs. */
  durableAgent?: DurableJobOptions | null;
  /** The run store shared by the injected runtime and durable recovery (restored runs land here). */
  runStore?: RunStore;
};

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    // Do not trust X-Forwarded-For / Forwarded. Admission uses a visitor id only after
    // server-to-server authentication. A reverse proxy is not an identity provider.
    trustProxy: false,
    logger: {
      level: options.logLevel ?? "info",
      // Defence in depth: no route handles credentials, but never let one reach a log line.
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers['x-job-token']",
          "req.headers['x-api-key']",
          "req.headers['x-ce-internal-auth']",
          "req.headers['x-ce-operator']",
          "req.headers['x-ce-paid-operator']",
          "req.headers['x-baseline-token']",
          "*.headers['x-api-key']",
          "*.headers['X-Api-Key']",
          "*.headers['x-ce-internal-auth']",
          "*.QLOO_API_KEY",
          "*.ANTHROPIC_API_KEY",
          "*.CE_INTERNAL_API_SECRET",
          "*.CE_OPERATOR_TOKEN",
          "*.CE_PAID_OPERATOR_TOKEN",
          "*.apiKey",
          "*.api_key",
        ],
        censor: "[redacted]",
      },
    },
  });

  app.register(healthRoutes);
  app.register(opsRoutes);
  app.register(analysisRoutes);
  app.register(methodologyRoutes);
  app.register(agentRoutes(options.agentRuntimeFactory, options.queryInterpreterFactory, { ...(options.baselineReader ? { baselines: options.baselineReader } : {}), ...(options.durableAgent !== undefined && { durable: options.durableAgent }), ...(options.runStore && { runStore: options.runStore }) }));
  app.register(brandBaselineRoutes);
  return app;
}
