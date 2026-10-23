import { API_SERVICE_NAME, type HealthResponse } from "@cultural-elasticity/shared";
import type { FastifyInstance } from "fastify";
import { publicRuntime } from "../config/production.js";
import { canAcceptInvestigations, lifecycle } from "../ops/lifecycle.js";
import { spendLedger } from "../ops/spend.js";

export type ReadyReason =
  | "ADMISSIONS_PAUSED"
  | "SHUTTING_DOWN"
  | "BUDGET_UNAVAILABLE"
  | "BUDGET_EXHAUSTED"
  | "MISSING_QLOO_CREDENTIAL"
  | "MISSING_MODEL_CREDENTIAL"
  | "MISSING_INTERNAL_AUTH";

export type ReadyResponse = {
  status: "ready" | "not_ready";
  service: typeof API_SERVICE_NAME;
  bootId: string;
  acceptingInvestigations: boolean;
  publicRuntime: boolean;
  reasons: ReadyReason[];
  dependencies: {
    qlooCredential: boolean;
    modelCredential: boolean;
    internalAuth: boolean;
    spendConfigured: boolean;
    qlooTransportInitialized: false;
  };
};

export function readiness(env: NodeJS.ProcessEnv = process.env): ReadyResponse {
  const reasons: ReadyReason[] = [];
  if (lifecycle().shuttingDown) reasons.push("SHUTTING_DOWN");
  if (!canAcceptInvestigations()) reasons.push("ADMISSIONS_PAUSED");
  const qlooCredential = Boolean(env.QLOO_API_KEY?.trim());
  const modelCredential = Boolean(env.ANTHROPIC_API_KEY?.trim());
  const internalAuth = Boolean(env.CE_INTERNAL_API_SECRET?.trim()) || !publicRuntime(env);
  const spend = spendLedger();
  const spendConfigured = spend.configuredBudgetUsd() !== null || !publicRuntime(env);
  if (publicRuntime(env) && !qlooCredential) reasons.push("MISSING_QLOO_CREDENTIAL");
  if (publicRuntime(env) && !modelCredential) reasons.push("MISSING_MODEL_CREDENTIAL");
  if (publicRuntime(env) && !internalAuth) reasons.push("MISSING_INTERNAL_AUTH");
  if (publicRuntime(env) && spend.configuredBudgetUsd() === null) reasons.push("BUDGET_UNAVAILABLE");
  if (spend.configuredBudgetUsd() !== null && (spend.snapshot().availableUsd ?? 0) <= 0) reasons.push("BUDGET_EXHAUSTED");
  return {
    status: reasons.length === 0 ? "ready" : "not_ready",
    service: API_SERVICE_NAME,
    bootId: lifecycle().bootId,
    acceptingInvestigations: canAcceptInvestigations(),
    publicRuntime: publicRuntime(env),
    reasons,
    dependencies: {
      qlooCredential,
      modelCredential,
      internalAuth,
      spendConfigured,
      qlooTransportInitialized: false,
    },
  };
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async (): Promise<HealthResponse> => ({ status: "ok", service: API_SERVICE_NAME }));
  app.get("/ready", async (_request, reply) => {
    const body = readiness();
    if (body.status !== "ready") reply.code(503);
    return body;
  });
}
