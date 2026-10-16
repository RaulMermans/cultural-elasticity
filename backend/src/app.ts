import Fastify, { type FastifyInstance } from "fastify";
import { agentRoutes, type AgentRuntimeFactory } from "./api/agent.js";
import { analysisRoutes } from "./api/analysis.js";
import { healthRoutes } from "./api/health.js";
import { methodologyRoutes } from "./api/methodology.js";

export type BuildAppOptions = {
  logLevel?: string;
  /** Agent runtime wiring; defaults to live Qloo (MCP) + the configured model, created on first use. */
  agentRuntimeFactory?: AgentRuntimeFactory;
};

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: {
      level: options.logLevel ?? "info",
      // Defence in depth: no route handles credentials, but never let one reach a log line.
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers['x-api-key']",
          "*.headers['x-api-key']",
          "*.headers['X-Api-Key']",
          "*.QLOO_API_KEY",
          "*.ANTHROPIC_API_KEY",
          "*.apiKey",
          "*.api_key",
        ],
        censor: "[redacted]",
      },
    },
  });

  app.register(healthRoutes);
  app.register(analysisRoutes);
  app.register(methodologyRoutes);
  app.register(agentRoutes(options.agentRuntimeFactory));
  return app;
}
