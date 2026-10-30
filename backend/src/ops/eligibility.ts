import { BASELINE_MAX_CALLS } from "../brand-baseline/research.js";
import { processDispatchCounter } from "../qloo/dispatch-limit.js";
import { canAcceptInvestigations } from "./lifecycle.js";
import { conservativeReserveUsd } from "./pricing.js";
import { visitorAllowance, type VisitorAllowance } from "./public-quota.js";
import { runLedger } from "./run-ledger.js";
import { spendLedger } from "./spend.js";

/**
 * Hotfix: what this caller could start right now, as states only. Shared budgets are never exposed as numbers; only
 * the caller's own network allowance is. A display hint: every start is still decided by the server. "unknown" (any
 * read failed) must not disable anything.
 */
export type Eligibility = "available" | "admissions_paused" | "operator_required" | "budget_exhausted" | "visitor_allowance_used" | "unknown";
export type ResearchEligibility = { newBrandResearch: Eligibility; investigations: Eligibility; allowance: VisitorAllowance | null };

export async function researchEligibility(input: {
  headers: Record<string, unknown>;
  callerAuthorized: boolean;
  baselineOpen: boolean;
  baselineBudget: (() => Promise<{ limitCalls: number; usedCalls: number }>) | null;
  env?: NodeJS.ProcessEnv;
}): Promise<ResearchEligibility> {
  const env = input.env ?? process.env;
  const allowance = await visitorAllowance(input.headers, env);
  const used = (quota: { used: number; limit: number }) => quota.used >= quota.limit;

  let newBrandResearch: Eligibility;
  if (!input.baselineOpen || !input.baselineBudget) newBrandResearch = "admissions_paused";
  else if (!input.callerAuthorized) newBrandResearch = "operator_required";
  else {
    const budget = await input.baselineBudget().catch(() => null);
    if (!budget) newBrandResearch = "unknown";
    else if (budget.limitCalls - budget.usedCalls < BASELINE_MAX_CALLS) newBrandResearch = "budget_exhausted";
    else if (allowance && (used(allowance.searches) || used(allowance.scans))) newBrandResearch = "visitor_allowance_used";
    else newBrandResearch = "available";
  }

  let investigations: Eligibility;
  if (!canAcceptInvestigations()) investigations = "admissions_paused";
  else if (!input.callerAuthorized) investigations = "operator_required";
  else {
    const exhausted = await sharedInvestigationBudgetSpent(env);
    if (exhausted === null) investigations = "unknown";
    else if (exhausted) investigations = "budget_exhausted";
    else if (allowance && used(allowance.investigations)) investigations = "visitor_allowance_used";
    else investigations = "available";
  }
  return { newBrandResearch, investigations, allowance };
}

/** True when the run-wide model or Qloo ceiling cannot cover another investigation; null when it cannot be read. */
async function sharedInvestigationBudgetSpent(env: NodeJS.ProcessEnv): Promise<boolean | null> {
  const spend = spendLedger();
  const budget = spend.configuredBudgetUsd();
  const reserveUsd = conservativeReserveUsd(env);
  if (budget !== null && spend.outstandingUsd() + reserveUsd > budget) return true;
  const ledger = runLedger(env);
  if (ledger) {
    const snapshot = await ledger.snapshot();
    if (!snapshot) return null;
    const model = snapshot.model_usd_cents;
    if (model && model.used + Math.ceil(reserveUsd * 100) > model.limit) return true;
    const qloo = snapshot.qloo_calls;
    if (qloo && qloo.used >= qloo.limit) return true;
    return false;
  }
  const counter = processDispatchCounter(env);
  return counter ? counter.snapshot().remaining <= 0 : false;
}
