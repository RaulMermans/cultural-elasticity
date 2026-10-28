import { API_SERVICE_NAME } from "@cultural-elasticity/shared";
import type { FastifyInstance } from "fastify";
import { operatorToken } from "../config/production.js";
import { verifyOperator } from "../ops/identity.js";
import { lifecycle } from "../ops/lifecycle.js";
import { opsMetrics } from "../ops/metrics.js";
import { probeProviders, providerConnectivity, type ProviderName } from "../ops/providers.js";
import { registeredJobs } from "../ops/server.js";
import { deploymentRevision } from "../ops/revision.js";
import { spendLedger } from "../ops/spend.js";
import { readiness } from "./health.js";
import { processDispatchCounter } from "../qloo/dispatch-limit.js";
import { runLedger } from "../ops/run-ledger.js";

function operatorDenied(request: { headers: unknown }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }): boolean {
  if (!operatorToken() || !verifyOperator(request.headers as Record<string, unknown>)) {
    void reply.code(404).send({ error: "not_found", message: "This route is not available." });
    return true;
  }
  return false;
}

export async function opsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/ops/status", async (request, reply) => {
    if (operatorDenied(request, reply)) return;
    const jobs = registeredJobs()?.counts();
    if (jobs) opsMetrics().setQueue(jobs.queued, jobs.running);
    return {
      service: API_SERVICE_NAME,
      bootId: lifecycle().bootId,
      startedAt: lifecycle().startedAt,
      shuttingDown: lifecycle().shuttingDown,
      revision: deploymentRevision(),
      readiness: readiness(),
      providerConnectivity: providerConnectivity(),
      spend: spendLedger().snapshot(),
      qlooDispatch: processDispatchCounter()?.snapshot() ?? null,
      runLedger: (await runLedger()?.snapshot()) ?? null,
      metrics: opsMetrics().snapshot(),
      jobs: jobs ?? { running: 0, queued: 0, held: 0 },
    };
  });

  app.post("/ops/providers/probe", async (request, reply) => {
    if (operatorDenied(request, reply)) return;
    const body = request.body as { providers?: unknown } | undefined;
    const requested = Array.isArray(body?.providers)
      ? body.providers.filter((name): name is ProviderName => name === "qloo" || name === "haiku")
      : (["qloo", "haiku"] as ProviderName[]);
    const result = await probeProviders(requested.length > 0 ? requested : ["qloo", "haiku"]);
    return { service: API_SERVICE_NAME, providerConnectivity: result };
  });
}
