/**
 * Sprint 8E: deterministic budget preflight for the frozen live readiness gate (eval-only; product code never imports it).
 *
 * The Sprint 8D manifest proposed a $2.50 reserve next to 220 model calls / 3.52M output tokens, which no Haiku price can
 * fit. This module separates the figures the owner approves against:
 *
 *   EXPECTED_COST_USD               observed live cost per model run × planned model runs × variance margin
 *   RESERVED_BUDGET_USD             every model call of every planned model run at its conservative ceiling
 *                                   (decision turns + one repair each + synthesis attempts; Haiku >100K tier)
 *   MAX_THEORETICAL_EXPOSURE_USD    RESERVED × (1 + SDK transport retries): only if every retried attempt were billed
 *   PROVIDER_WORKSPACE_LIMIT_USD    the Anthropic workspace limit the owner reports (null = not verified)
 *   APP_ENFORCED_STOP_THRESHOLD_USD suite spend above which no further model run may start (approved − one run's ceiling)
 *
 * Qloo is a separate constraint: hackathon calls have no published USD rate, so they are reported as a call count and a
 * quota that is UNVERIFIED unless the owner supplies one. Never zero-cost by assumption.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_QLOO_CALLS, defaultLimits, type AgentIntent } from "../src/agent/contracts.js";
import { DECISION_MAX_OUTPUT_TOKENS, estimateCallCeilingUsd, HAIKU_CONSERVATIVE, MODEL_PRICES, PRICING_AS_OF, roundUsd, SYNTHESIS_MAX_OUTPUT_TOKENS } from "../src/ops/pricing.js";
import type { SpendBound } from "../src/ops/spend.js";

const evalsRoot = fileURLToPath(new URL("../../evals/agent/", import.meta.url));

export type GateManifest = {
  version: string;
  model: { id: string; effort: string; decisionMaxTokens: number };
  cases: {
    prescribedModel: string[];
    prescribedBaseline: string[];
    frontierStability: { cases: string[]; requiredRuns: number };
  };
  budgetAssumptions: {
    /** No hard context cap exists; this is the assumed per-call input ceiling (observed 8C mean ≈ 8.7K). */
    perCallInputTokensCeiling: number;
    maxRepairsPerTurn: number;
    maxSynthesisAttempts: number;
    /** Anthropic SDK default transport retries (connection errors, 408/409/429/5xx). */
    sdkMaxRetries: number;
    /** Observed model USD of one live frontier parent (Sprint 8C 775217fd: $0.0179–0.0184). */
    observedRunUsd: number;
    expectedVarianceMultiplier: number;
    /** Qloo controlled-case preflight calls (live, before the arms). */
    controlledPreflightQlooCalls: number;
  };
  approval: {
    approvedCeilingUsd: number | null;
    providerWorkspaceLimitUsd: number | null;
    qlooQuotaCalls: number | null;
  };
};

type CaseIntent = { intents: Record<string, AgentIntent>; controlledIds: string[] };

export function loadGateManifest(path = join(evalsRoot, "sprint-8e-live-gate-manifest.json")): GateManifest {
  return JSON.parse(readFileSync(path, "utf8")) as GateManifest;
}

/** Case id → intent from the frozen live and controlled case files. */
export function loadCaseIntents(): CaseIntent {
  const live = JSON.parse(readFileSync(join(evalsRoot, "live-cases.json"), "utf8")) as { cases: { id: string; intent: AgentIntent }[] };
  const controlled = JSON.parse(readFileSync(join(evalsRoot, "controlled-cases.json"), "utf8")) as { cases: { id: string; intent: AgentIntent }[] };
  const intents: Record<string, AgentIntent> = {};
  for (const c of [...live.cases, ...controlled.cases]) intents[c.id] = c.intent;
  return { intents, controlledIds: controlled.cases.map((c) => c.id) };
}

export type GateExposure = {
  pricingAsOf: string;
  modelId: string;
  listPrice: { inputPerMTok: number; outputPerMTok: number } | null;
  reservationPrice: { inputPerMTok: number; outputPerMTok: number };
  plan: { modelRuns: number; baselineRuns: number; modelRunCases: string[]; baselineRunCases: string[] };
  perCall: { inputTokensCeiling: number; outputTokensCeiling: number; ceilingUsd: number };
  perRun: { maxModelCalls: number; ceilingUsd: number };
  maxModelCalls: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  qloo: { maxCalls: number; quotaCalls: number | null; status: "WITHIN_QUOTA" | "EXCEEDS_QUOTA" | "QUOTA_UNVERIFIED"; usdRate: "NOT_PUBLISHED" };
  EXPECTED_COST_USD: number;
  RESERVED_BUDGET_USD: number;
  MAX_THEORETICAL_EXPOSURE_USD: number;
  PROVIDER_WORKSPACE_LIMIT_USD: number | null;
  APP_ENFORCED_STOP_THRESHOLD_USD: number | null;
};

/** Runs the frozen command executes: model = prescribed + controlled + extra stability runs; baseline = prescribed + controlled. */
export function gatePlan(manifest: GateManifest, cases: CaseIntent) {
  const controlled = cases.controlledIds;
  const extraStability = manifest.cases.frontierStability.cases.flatMap((id) => Array.from({ length: Math.max(0, manifest.cases.frontierStability.requiredRuns - 1) }, () => id));
  const modelRunCases = [...manifest.cases.prescribedModel, ...controlled, ...extraStability];
  const baselineRunCases = [...manifest.cases.prescribedBaseline, ...controlled];
  return { modelRuns: modelRunCases.length, baselineRuns: baselineRunCases.length, modelRunCases, baselineRunCases };
}

export function computeGateExposure(manifest: GateManifest, cases: CaseIntent = loadCaseIntents()): GateExposure {
  const a = manifest.budgetAssumptions;
  const plan = gatePlan(manifest, cases);
  const turns = defaultLimits(undefined).maxAgentIterations;
  const outputCeiling = Math.max(manifest.model.decisionMaxTokens, DECISION_MAX_OUTPUT_TOKENS, SYNTHESIS_MAX_OUTPUT_TOKENS);
  const perCallUsd = estimateCallCeilingUsd(a.perCallInputTokensCeiling, outputCeiling);
  const callsPerRun = turns * (1 + a.maxRepairsPerTurn) + a.maxSynthesisAttempts;
  const perRunUsd = roundUsd(perCallUsd * callsPerRun);
  const reserved = roundUsd(perRunUsd * plan.modelRuns);
  const theoretical = roundUsd(reserved * (1 + a.sdkMaxRetries));
  const qlooOf = (id: string) => DEFAULT_QLOO_CALLS[cases.intents[id] ?? "explore_frontier"];
  const qlooMax = [...plan.modelRunCases, ...plan.baselineRunCases].reduce((sum, id) => sum + qlooOf(id), 0) + a.controlledPreflightQlooCalls;
  const quota = manifest.approval.qlooQuotaCalls;
  const approved = manifest.approval.approvedCeilingUsd;
  const list = MODEL_PRICES[manifest.model.id];
  return {
    pricingAsOf: PRICING_AS_OF,
    modelId: manifest.model.id,
    listPrice: list ? { inputPerMTok: list.input, outputPerMTok: list.output } : null,
    reservationPrice: { inputPerMTok: HAIKU_CONSERVATIVE.input, outputPerMTok: HAIKU_CONSERVATIVE.output },
    plan,
    perCall: { inputTokensCeiling: a.perCallInputTokensCeiling, outputTokensCeiling: outputCeiling, ceilingUsd: perCallUsd },
    perRun: { maxModelCalls: callsPerRun, ceilingUsd: perRunUsd },
    maxModelCalls: callsPerRun * plan.modelRuns,
    maxInputTokens: callsPerRun * plan.modelRuns * a.perCallInputTokensCeiling,
    maxOutputTokens: callsPerRun * plan.modelRuns * outputCeiling,
    qloo: { maxCalls: qlooMax, quotaCalls: quota, status: quota === null ? "QUOTA_UNVERIFIED" : qlooMax <= quota ? "WITHIN_QUOTA" : "EXCEEDS_QUOTA", usdRate: "NOT_PUBLISHED" },
    EXPECTED_COST_USD: roundUsd(a.observedRunUsd * plan.modelRuns * a.expectedVarianceMultiplier),
    RESERVED_BUDGET_USD: reserved,
    MAX_THEORETICAL_EXPOSURE_USD: theoretical,
    PROVIDER_WORKSPACE_LIMIT_USD: manifest.approval.providerWorkspaceLimitUsd,
    APP_ENFORCED_STOP_THRESHOLD_USD: approved === null ? null : roundUsd(Math.max(0, approved - perRunUsd)),
  };
}

export type BudgetVerdict = { allowed: boolean; code: "BUDGET_PREFLIGHT_PASS" | "LIVE_GATE_BLOCKED_BY_APPROVAL" | "CEILING_BELOW_RESERVED_EXPOSURE" | "WORKSPACE_LIMIT_BELOW_CEILING" | "QLOO_QUOTA_EXCEEDED"; reasons: string[]; warnings: string[] };

/**
 * Refuses the run unless an approved ceiling covers RESERVED_BUDGET_USD (every call of every planned run at its
 * conservative ceiling). A workspace limit below the ceiling would stop the suite mid-gate, so it is refused too.
 */
export function validateGateBudget(exposure: GateExposure, approvedCeilingUsd: number | null): BudgetVerdict {
  const warnings: string[] = [];
  if (exposure.PROVIDER_WORKSPACE_LIMIT_USD === null) warnings.push("PROVIDER_WORKSPACE_LIMIT_UNVERIFIED: the Anthropic workspace spend limit was not reported; it is an independent control");
  if (exposure.qloo.status === "QUOTA_UNVERIFIED") warnings.push(`QLOO_QUOTA_UNVERIFIED: up to ${exposure.qloo.maxCalls} Qloo calls; no published USD rate and no quota was supplied`);
  if (approvedCeilingUsd === null || !Number.isFinite(approvedCeilingUsd) || approvedCeilingUsd <= 0) {
    return { allowed: false, code: "LIVE_GATE_BLOCKED_BY_APPROVAL", reasons: ["no owner-approved model spend ceiling"], warnings };
  }
  if (approvedCeilingUsd < exposure.RESERVED_BUDGET_USD) {
    return { allowed: false, code: "CEILING_BELOW_RESERVED_EXPOSURE", reasons: [`approved $${approvedCeilingUsd} < reserved exposure $${exposure.RESERVED_BUDGET_USD} (${exposure.plan.modelRuns} model runs × $${exposure.perRun.ceilingUsd})`], warnings };
  }
  if (exposure.PROVIDER_WORKSPACE_LIMIT_USD !== null && exposure.PROVIDER_WORKSPACE_LIMIT_USD < approvedCeilingUsd) {
    return { allowed: false, code: "WORKSPACE_LIMIT_BELOW_CEILING", reasons: [`Anthropic workspace limit $${exposure.PROVIDER_WORKSPACE_LIMIT_USD} < approved $${approvedCeilingUsd}: the provider could stop the suite mid-gate`], warnings };
  }
  if (exposure.qloo.status === "EXCEEDS_QUOTA") {
    return { allowed: false, code: "QLOO_QUOTA_EXCEEDED", reasons: [`up to ${exposure.qloo.maxCalls} Qloo calls > quota ${exposure.qloo.quotaCalls}`], warnings };
  }
  return { allowed: true, code: "BUDGET_PREFLIGHT_PASS", reasons: [], warnings };
}

/**
 * Suite-level stop: each model run gets a SpendBound of one run's ceiling (it never refuses a call the run's own limits
 * allow) and no run starts once observed + unknown spend exceeds APP_ENFORCED_STOP_THRESHOLD_USD. In-memory only.
 */
export class SuiteSpendGuard {
  private spentUsd = 0;
  private runs = 0;
  constructor(
    private readonly approvedUsd: number,
    private readonly perRunCeilingUsd: number,
  ) {}

  spent(): number {
    return roundUsd(this.spentUsd);
  }

  /** A bound for the next model run, or null when starting it could exceed the approved ceiling. */
  nextRun(): SpendBound | null {
    if (roundUsd(this.spentUsd + this.perRunCeilingUsd) > roundUsd(this.approvedUsd)) return null;
    this.runs += 1;
    const authorized = this.perRunCeilingUsd;
    let observed = 0;
    const charge = (usd: number) => {
      const delta = Math.max(0, usd);
      observed = roundUsd(observed + delta);
      this.spentUsd += delta;
    };
    return {
      reservationId: `live-gate-run-${this.runs}`,
      authorizedUsd: authorized,
      observedUsd: () => observed,
      remainingUsd: () => roundUsd(Math.max(0, authorized - observed)),
      authorizeNextCall: (estimateUsd: number) => Number.isFinite(estimateUsd) && estimateUsd >= 0 && roundUsd(estimateUsd) <= roundUsd(authorized - observed),
      addObserved: charge,
      markUnknownCall: charge,
    };
  }

  /** A run that threw has unknown spend: charge its whole ceiling minus what the bound already counted. */
  chargeErroredRun(bound: SpendBound): void {
    this.spentUsd += Math.max(0, bound.authorizedUsd - bound.observedUsd());
  }
}

// `pnpm eval:agent:budget [-- --approved-usd N --workspace-limit-usd N --qloo-quota N --manifest <file>]`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2).filter((x) => x !== "--");
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const num = (v: string | undefined) => (v === undefined ? null : Number(v));
  const manifest = loadGateManifest(flag("--manifest"));
  manifest.approval.approvedCeilingUsd = num(flag("--approved-usd")) ?? manifest.approval.approvedCeilingUsd;
  manifest.approval.providerWorkspaceLimitUsd = num(flag("--workspace-limit-usd")) ?? manifest.approval.providerWorkspaceLimitUsd;
  manifest.approval.qlooQuotaCalls = num(flag("--qloo-quota")) ?? manifest.approval.qlooQuotaCalls;
  const exposure = computeGateExposure(manifest);
  const verdict = validateGateBudget(exposure, manifest.approval.approvedCeilingUsd);
  console.log(JSON.stringify({ manifest: manifest.version, exposure, verdict }, null, 2));
  process.exitCode = verdict.allowed ? 0 : 2;
}
