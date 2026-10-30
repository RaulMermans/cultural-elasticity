import { QLOO_HACKATHON_ORIGIN, requireHackathonBaseUrl } from "../qloo/environment.js";

/** Keep in sync with `floorReserveUsd()` in ops/pricing.ts. Production config must not import the ledger. */
const MIN_PUBLIC_RESERVE_USD = 0.5;

export const INTERNAL_AUTH_HEADER = "x-ce-internal-auth";
export const VISITOR_HEADER = "x-ce-visitor";
export const OPERATOR_HEADER = "x-ce-operator";
/** Sprint 9J: authorizes paid dispatch only. Distinct from the internal secret and the diagnostics operator token. */
export const PAID_OPERATOR_HEADER = "x-ce-paid-operator";
export const MIN_INTERNAL_SECRET_LENGTH = 32;
export const MIN_VISITOR_LENGTH = 16;
export const MAX_VISITOR_LENGTH = 64;
export const DEFAULT_QLOO_SPACING_MS = 7_000;

export type ProductionIssue = {
  code: string;
  message: string;
};

export function publicRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production" || env.CE_PUBLIC_DEPLOYMENT === "1";
}

export function investigationsAccepted(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CE_ACCEPT_INVESTIGATIONS === "1";
}

export function configuredSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.CE_INTERNAL_API_SECRET?.trim();
  return value && value.length > 0 ? value : undefined;
}

export function operatorToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.CE_OPERATOR_TOKEN?.trim();
  return value && value.length > 0 ? value : undefined;
}

export function internalAuthRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return publicRuntime(env) || Boolean(configuredSecret(env));
}

export function paidOperatorToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.CE_PAID_OPERATOR_TOKEN?.trim();
  return value && value.length > 0 ? value : undefined;
}

/**
 * Internal auth proves the request came through the Next.js server, not who the visitor is. On a public
 * runtime every paid dispatch also needs the operator credential, so opening admissions never opens them
 * to anonymous visitors. A private process requires it once a token is configured.
 */
export function paidOperatorRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return publicRuntime(env) || Boolean(paidOperatorToken(env));
}

/** Expiry of the operator authorization in ms, or null when absent or unparseable. */
export function paidOperatorExpiry(env: NodeJS.ProcessEnv = process.env): number | null {
  const value = env.CE_PAID_OPERATOR_EXPIRES_AT?.trim();
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Sprint 9M public evaluation: anonymous visitors may start paid research without the operator credential, but
 * only while the evaluation is configured with an identifier and an expiry still in the future. The identifier
 * keys the durable ledger, so a new allowance needs a new identifier; a missing or past expiry closes it.
 */
export function publicEvaluationId(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.CE_PUBLIC_EVALUATION !== "1") return undefined;
  const value = env.CE_PUBLIC_EVALUATION_ID?.trim();
  return value && /^[A-Za-z0-9_.-]{4,64}$/u.test(value) ? value : undefined;
}

export function publicEvaluationExpiry(env: NodeJS.ProcessEnv = process.env): number | null {
  const value = env.CE_PUBLIC_EVALUATION_EXPIRES_AT?.trim();
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function publicEvaluationActive(env: NodeJS.ProcessEnv = process.env, now = Date.now()): boolean {
  const expiry = publicEvaluationExpiry(env);
  return Boolean(publicEvaluationId(env)) && expiry !== null && expiry > now;
}

/** Durable quotas per visitor network during a public evaluation. Defaults are deliberately small. */
export function publicEvaluationQuota(kind: "resolve" | "scan" | "investigation", env: NodeJS.ProcessEnv = process.env): number {
  const raw = { resolve: env.CE_PUBLIC_QUOTA_RESOLVES, scan: env.CE_PUBLIC_QUOTA_SCANS, investigation: env.CE_PUBLIC_QUOTA_INVESTIGATIONS }[kind];
  const fallback = { resolve: 10, scan: 4, investigation: 4 }[kind];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function positiveNumber(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Fail-closed checks for a public process. Safe to call from tests: it never prints secret values.
 */
export function validatePublicRuntime(env: NodeJS.ProcessEnv = process.env): ProductionIssue[] {
  if (!publicRuntime(env)) return [];
  const issues: ProductionIssue[] = [];
  const secret = configuredSecret(env);
  if (!secret) {
    issues.push({ code: "INTERNAL_AUTH_MISSING", message: "CE_INTERNAL_API_SECRET is required for a public process." });
  } else if (secret.length < MIN_INTERNAL_SECRET_LENGTH) {
    issues.push({ code: "INTERNAL_AUTH_WEAK", message: `CE_INTERNAL_API_SECRET must be at least ${MIN_INTERNAL_SECRET_LENGTH} characters.` });
  }
  const paid = paidOperatorToken(env);
  if (paid && paid.length < MIN_INTERNAL_SECRET_LENGTH) {
    issues.push({ code: "PAID_OPERATOR_WEAK", message: `CE_PAID_OPERATOR_TOKEN must be at least ${MIN_INTERNAL_SECRET_LENGTH} characters.` });
  }
  if (paid && (paid === secret || paid === operatorToken(env))) {
    issues.push({ code: "PAID_OPERATOR_REUSED", message: "CE_PAID_OPERATOR_TOKEN must differ from the internal secret and the diagnostics operator token." });
  }
  if (env.CE_PUBLIC_EVALUATION === "1") {
    if (!publicEvaluationId(env)) issues.push({ code: "PUBLIC_EVALUATION_ID_INVALID", message: "CE_PUBLIC_EVALUATION_ID must be 4-64 letters, digits, '.', '_' or '-'." });
    if (publicEvaluationExpiry(env) === null) issues.push({ code: "PUBLIC_EVALUATION_EXPIRY_MISSING", message: "CE_PUBLIC_EVALUATION_EXPIRES_AT must be an ISO timestamp." });
    const limit = Number(env.CE_PROCESS_QLOO_CALL_LIMIT ?? "");
    if (!env.CE_PROCESS_QLOO_CALL_LIMIT?.trim() || !Number.isInteger(limit) || limit < 0) {
      issues.push({ code: "PUBLIC_EVALUATION_QLOO_LIMIT_MISSING", message: "A public evaluation needs an explicit CE_PROCESS_QLOO_CALL_LIMIT." });
    }
    if (!env.DATABASE_URL?.trim()) issues.push({ code: "PUBLIC_EVALUATION_LEDGER_MISSING", message: "A public evaluation needs DATABASE_URL for durable quotas." });
  }
  if (positiveNumber(env.CE_SPEND_BUDGET_USD) === null) {
    issues.push({ code: "SPEND_BUDGET_MISSING", message: "CE_SPEND_BUDGET_USD must be a non-negative number." });
  }
  if (env.CE_INVESTIGATION_RESERVE_USD !== undefined && env.CE_INVESTIGATION_RESERVE_USD !== "") {
    const reserve = Number(env.CE_INVESTIGATION_RESERVE_USD);
    if (!Number.isFinite(reserve) || reserve <= 0) {
      issues.push({ code: "RESERVE_INVALID", message: "CE_INVESTIGATION_RESERVE_USD must be a positive number." });
    } else if (reserve < MIN_PUBLIC_RESERVE_USD) {
      issues.push({
        code: "RESERVE_TOO_LOW",
        message: `CE_INVESTIGATION_RESERVE_USD must be at least ${MIN_PUBLIC_RESERVE_USD} USD so a low reserve cannot disable spend protection.`,
      });
    }
  }
  if (env.CE_REPLICA_COUNT !== undefined && env.CE_REPLICA_COUNT !== "" && env.CE_REPLICA_COUNT !== "1") {
    issues.push({
      code: "REPLICA_COUNT_UNSUPPORTED",
      message: "This process keeps jobs and spend in memory. CE_REPLICA_COUNT must be 1.",
    });
  }
  if (!env.QLOO_API_KEY?.trim()) {
    issues.push({ code: "QLOO_CREDENTIAL_MISSING", message: "QLOO_API_KEY is required for a public process." });
  }
  if (!env.ANTHROPIC_API_KEY?.trim()) {
    issues.push({ code: "MODEL_CREDENTIAL_MISSING", message: "ANTHROPIC_API_KEY is required for a public process." });
  }
  try {
    requireHackathonBaseUrl(env.QLOO_API_BASE_URL);
  } catch {
    issues.push({
      code: "QLOO_HOST_UNSAFE",
      message: `QLOO_API_BASE_URL must be ${QLOO_HACKATHON_ORIGIN}.`,
    });
  }
  if (env.QLOO_CALL_SPACING_MS !== undefined && env.QLOO_CALL_SPACING_MS !== "") {
    const spacing = Number(env.QLOO_CALL_SPACING_MS);
    if (!Number.isFinite(spacing) || spacing < DEFAULT_QLOO_SPACING_MS) {
      issues.push({
        code: "QLOO_SPACING_UNSAFE",
        message: `QLOO_CALL_SPACING_MS must be at least ${DEFAULT_QLOO_SPACING_MS} in a public process.`,
      });
    }
  }
  if (env.CE_ACCEPT_INVESTIGATIONS !== undefined && env.CE_ACCEPT_INVESTIGATIONS !== "0" && env.CE_ACCEPT_INVESTIGATIONS !== "1") {
    issues.push({ code: "ACCEPT_FLAG_INVALID", message: "CE_ACCEPT_INVESTIGATIONS must be 0 or 1 when set." });
  }
  return issues;
}

export function assertPublicRuntimeSafe(env: NodeJS.ProcessEnv = process.env): void {
  const issues = validatePublicRuntime(env);
  if (issues.length === 0) return;
  const codes = issues.map((issue) => issue.code).join(", ");
  throw new Error(`PUBLIC_RUNTIME_UNSAFE: ${codes}`);
}
