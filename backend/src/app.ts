import Fastify, { type FastifyInstance } from "fastify";
import { healthRoutes } from "./routes/health.js";

export type BuildAppOptions = {
  logLevel?: string;
};

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: {
      level: options.logLevel ?? "info",
      // Defence in depth: no route handles credentials, but never let one reach a log line.
      redact: {
        paths: ["req.headers.authorization", "req.headers['x-api-key']", "*.QLOO_API_KEY", "*.apiKey", "*.api_key"],
        censor: "[redacted]",
      },
    },
  });

  app.register(healthRoutes);
  return app;
}
