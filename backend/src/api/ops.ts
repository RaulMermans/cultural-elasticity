import { API_SERVICE_NAME } from "@cultural-elasticity/shared";
import type { FastifyInstance } from "fastify";
import { operatorToken } from "../config/production.js";
import { verifyOperator } from "../ops/identity.js";
import { lifecycle } from "../ops/lifecycle.js";
import { opsMetrics } from "../ops/metrics.js";
import { registeredJobs } from "../ops/server.js";
import { spendLedger } from "../ops/spend.js";
import { readiness } from "./health.js";

export async function opsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/ops/status", async (request, reply) => {
    if (!operatorToken() || !verifyOperator(request.headers as Record<string, unknown>)) {
      return reply.code(404).send({ error: "not_found", message: "This route is not available." });
    }
    const jobs = registeredJobs()?.counts();
    if (jobs) opsMetrics().setQueue(jobs.queued, jobs.running);
    return {
      service: API_SERVICE_NAME,
      bootId: lifecycle().bootId,
      startedAt: lifecycle().startedAt,
      shuttingDown: lifecycle().shuttingDown,
      readiness: readiness(),
      spend: spendLedger().snapshot(),
      metrics: opsMetrics().snapshot(),
      jobs: jobs ?? { running: 0, queued: 0, held: 0 },
    };
  });
}
