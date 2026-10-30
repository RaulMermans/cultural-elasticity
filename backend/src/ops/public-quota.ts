import { publicEvaluationExpiry, publicEvaluationQuota } from "../config/production.js";
import { networkKeyOf, verifyPaidOperator } from "./identity.js";
import { runLedger } from "./run-ledger.js";

export type PublicQuotaKind = "resolve" | "scan" | "investigation" | "question";
export type PublicQuotaDecision =
  | { ok: true }
  | { ok: false; status: 403 | 429 | 503; error: "visitor_unattributed" | "visitor_quota_reached" | "quota_unavailable"; message: string };

/**
 * Sprint 9M: durable per-network quotas for callers admitted by a public evaluation. An operator (or a private
 * process) is not quota-limited here; it remains bound by the run-wide ceilings. A unit is taken before the
 * paid work starts, so a failed start still counts. Any doubt refuses. Hotfix (P0): an investigation unit is returned
 * by `returnPublicQuota` only when nothing paid started, or when the committed answer started no investigation.
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
    const limit = publicEvaluationQuota(kind, env);
    const [one, many] = { investigation: ["investigation", "investigations"], scan: ["brand research run", "brand research runs"], resolve: ["brand search", "brand searches"], question: ["question", "questions"] }[kind];
    const expiry = publicEvaluationExpiry(env);
    const until = expiry === null ? "" : `, which runs until ${formatEvaluationEnd(expiry)}`;
    return { ok: false, status: 429, error: "visitor_quota_reached", message: `This network has used its allowance of ${limit} ${limit === 1 ? one : many} for this evaluation${until}. Saved research and the recorded example remain available.` };
  }
  return { ok: false, status: 503, error: "quota_unavailable", message: "New research cannot start because the usage record is unavailable." };
}

/**
 * Hotfix: gives back the unit `takePublicQuota` took when the request was refused before anything paid could start
 * (no job was created, no scan was queued). Never called once work may have started; doubt keeps the unit.
 */
export async function returnPublicQuota(headers: Record<string, unknown>, kind: PublicQuotaKind, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const decision = verifyPaidOperator(headers, env);
  if (!decision.ok || decision.via !== "public_evaluation") return;
  const network = networkKeyOf(headers);
  const ledger = runLedger(env);
  if (network && ledger) await ledger.releaseQuota(`${kind}:${network}`, 1);
}

export type QuotaUse = { used: number; limit: number };
export type VisitorAllowance = { endsAt: string; searches: QuotaUse; scans: QuotaUse; investigations: QuotaUse };

/**
 * Hotfix: the caller's own network allowance, read without taking anything. The limit shown is the one the next
 * request would apply (a raised configuration wins). Null for an operator, outside an evaluation, or on any doubt;
 * the server still decides at start.
 */
export async function visitorAllowance(headers: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): Promise<VisitorAllowance | null> {
  const decision = verifyPaidOperator(headers, env);
  if (!decision.ok || decision.via !== "public_evaluation") return null;
  const network = networkKeyOf(headers);
  const ledger = runLedger(env);
  const expiry = publicEvaluationExpiry(env);
  if (!network || !ledger || expiry === null) return null;
  const read = async (kind: PublicQuotaKind): Promise<QuotaUse | null> => {
    const row = await ledger.peekQuota(`${kind}:${network}`);
    if (row === "unavailable") return null;
    const configured = publicEvaluationQuota(kind, env);
    return { used: row?.used ?? 0, limit: Math.max(row?.limit ?? 0, configured) };
  };
  const [searches, scans, investigations] = await Promise.all([read("resolve"), read("scan"), read("investigation")]);
  if (!searches || !scans || !investigations) return null;
  return { endsAt: new Date(expiry).toISOString(), searches, scans, investigations };
}

/** "6 Nov 2026, 05:00 UTC": fixed to UTC so the server and every visitor read the same moment. */
export function formatEvaluationEnd(ms: number): string {
  const d = new Date(ms);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
