import { publicEvaluationQuota } from "../config/production.js";
import { networkKeyOf, verifyPaidOperator } from "./identity.js";
import { runLedger } from "./run-ledger.js";

export type PublicQuotaKind = "resolve" | "scan" | "investigation";
export type PublicQuotaDecision =
  | { ok: true }
  | { ok: false; status: 403 | 429 | 503; error: "visitor_unattributed" | "visitor_quota_reached" | "quota_unavailable"; message: string };

/**
 * Sprint 9M: durable per-network quotas for callers admitted by a public evaluation. An operator (or a private
 * process) is not quota-limited here; it remains bound by the run-wide ceilings. A unit is taken before the
 * paid work starts and is never returned, so a refused or failed start still counts. Any doubt refuses.
 */
export async function takePublicQuota(headers: Record<string, unknown>, kind: PublicQuotaKind, env: NodeJS.ProcessEnv = process.env): Promise<PublicQuotaDecision> {
  const decision = verifyPaidOperator(headers, env);
  if (!decision.ok || decision.via !== "public_evaluation") return { ok: true };
  const network = networkKeyOf(headers);
  if (!network) return { ok: false, status: 403, error: "visitor_unattributed", message: "This request could not be attributed to a visitor, so it cannot use the public research allowance." };
  const ledger = runLedger(env);
  const taken = ledger ? await ledger.takeQuota(`${kind}:${network}`, 1, publicEvaluationQuota(kind, env)) : ({ ok: false, code: "ledger_unavailable" } as const);
  if (taken.ok) return { ok: true };
  if (taken.code === "limit_reached") {
    const what = kind === "investigation" ? "investigations" : kind === "scan" ? "brand research runs" : "brand searches";
    return { ok: false, status: 429, error: "visitor_quota_reached", message: `You have used this evaluation's allowance of ${what}. Saved research and the recorded example remain available.` };
  }
  return { ok: false, status: 503, error: "quota_unavailable", message: "New research cannot start because the usage record is unavailable." };
}
