/**
 * Sprint 9N Discovery-to-Decision evaluation (`pnpm eval:d2d`): matched before/after measurement of the agent runtime.
 *
 *   runtime / scenario cases  run against the SYNTHETIC agent world twice, with identical fixtures, policy, budget and
 *                             methodology: arm "observe" (the Sprint 9M control flow) and arm "enforce" (Sprint 9N
 *                             default). Enforce-arm expectations are checked; a case that passed or reached FULL in
 *                             observe and not in enforce is a regression.
 *   recorded cases            live artefacts stored by earlier sprints, measured AS RUN (the pre-9N engine). They are a
 *                             baseline and a decision-card check; they are never replayed through a provider.
 *   live-target cases         hosted observations with no stored trace: NOT_RUN (Sprint 9O).
 *
 * Every number comes from a run's own trace and result. Nothing here calls Qloo or a model, and nothing is a live
 * validation. Direction is eval → product (this script imports the runtime and the shared projection only).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decisionCard, decisionCardViolations, type AgentAnalysisResult, type AgentRunResponse } from "@cultural-elasticity/shared";
import { runScenario, SCENARIOS_PATH, type Scenario } from "../agent-eval-harness.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const D2D_CASES_PATH = join(ROOT, "evals/discovery-decision/cases.json");
export const D2D_EVAL_VERSION = "discovery-decision-eval/v1";

type Arm = "observe" | "enforce";
type Expect = {
  routes?: Record<string, string>;
  notFull?: string[];
  maxEmptyProbes?: number;
  feasibility?: string;
  repeat?: string;
  nextActionNot?: string;
  noEvidenceFromFailedCalls?: boolean;
};
type Case = {
  id: string;
  kind: "runtime" | "scenario" | "recorded" | "live-target";
  dimension: "discovery" | "comparison" | "efficiency" | "decision";
  split: string;
  description: string;
  policy?: "baseline" | "scripted";
  wrap?: Scenario["wrap"];
  request?: Record<string, unknown>;
  faults?: Scenario["faults"];
  scenario?: string;
  artifact?: string;
  target?: string;
  syntheticAnalogue?: string | null;
  expect?: Expect;
};

/** Refusals that saved a reference or probe call (Sprint 5A–9N rules). */
const SAVING_CODES = new Set(["COMPARISON_INFEASIBLE", "REFERENCE_PROBE_LIMIT", "REFERENCE_TYPE_EVIDENCE_PENDING", "REFERENCE_DISCOVERY_PENDING", "REFERENCE_NAMESPACE_BARREN", "NAMESPACE_TYPE_BARREN", "PROBE_LIMIT_REACHED", "NO_VALUE_ACTION", "DUPLICATE_ACTION", "EARLY_STOP"]);

export type RunMetrics = {
  status: string;
  qlooCalls: number;
  iterations: number;
  /** Executed brand-independent probes that returned no member (an unproductive Qloo call). */
  emptyProbes: number;
  failedCalls: number;
  duplicateRefusals: number;
  callsAvoided: number;
  savingRefusals: number;
  fullTerritories: number;
  /** Territories with a class or position while their route is not FULL (must be 0). */
  unsupportedClassifications: number;
  /** FULL territories whose comparison set is not one methodology run (must be 0). */
  crossCallComparisons: number;
  feasibility: string | null;
  blocker: string | null;
  repeat: string | null;
  cards: { territory: string; implication: string; next: string[]; violations: string[] }[];
  /** Partial findings (target, not FULL) that state a limitation and a next action. */
  partialFindingsExplained: { total: number; explained: number };
  routes: Record<string, string>;
  /**
   * Discovery (frontier runs): candidates analyzed, grounded in a Qloo concept, distinct concepts, agent hypotheses
   * analyzed as real without Qloo support (must be 0). Non-obviousness is not scored: it is a qualitative reading.
   */
  discovery: { candidates: number; grounded: number; distinct: number; agentHypotheses: number; hypothesesAnalyzedUnsupported: number } | null;
};

const isAnalysis = (r: AgentRunResponse): r is AgentAnalysisResult => r.status !== "NEEDS_INPUT";

export function runMetrics(response: AgentRunResponse): RunMetrics {
  const trace = response.trace;
  const calls = trace.toolCalls;
  const recommends = calls.filter((c) => c.tool === "qloo_recommend" && c.status !== "rejected" && (c.arguments as { conditionOnBrand?: boolean })?.conditionOnBrand === false);
  const emptyProbes = recommends.filter((c) => c.status === "empty" || /^Qloo returned no /u.test(c.summary)).length;
  const failedCalls = calls.filter((c) => c.status === "failed").length;
  const base = {
    status: response.status,
    qlooCalls: response.metrics.qloo_calls,
    iterations: response.metrics.agent_iterations,
    emptyProbes,
    failedCalls,
    duplicateRefusals: trace.earlyStops.filter((e) => e.code === "DUPLICATE_ACTION").length,
    callsAvoided: response.metrics.calls_avoided,
    savingRefusals: trace.earlyStops.filter((e) => SAVING_CODES.has(e.code)).length,
  };
  if (!isAnalysis(response)) return { ...base, fullTerritories: 0, unsupportedClassifications: 0, crossCallComparisons: 0, feasibility: null, blocker: null, repeat: null, cards: [], partialFindingsExplained: { total: 0, explained: 0 }, routes: {}, discovery: null };
  const r = response;
  const full = r.territories.filter((t) => t.analysisRoute === "FULL_RELATIVE_ANALYSIS");
  const unsupported = r.territories.filter((t) => t.analysisRoute !== "FULL_RELATIVE_ANALYSIS" && (t.classification !== null || t.relativePosition?.position != null)).length;
  const cross = full.filter((t) => !r.methodologyRuns.some((m) => (t.comparisonSet?.territoryKeys ?? []).every((k) => m.territoryKeys.includes(k)))).length;
  const targets = r.territories.filter((t) => t.role === "target" || (r.intent === "explore_frontier" && t.role === "frontier_candidate"));
  const cards = targets.flatMap((t) => {
    const card = decisionCard(r, t.key, { otherDirections: r.territories.filter((x) => x.key !== t.key).map((x) => x.label) });
    return card ? [{ territory: t.key, implication: card.implication.code, next: card.nextActions.map((a) => a.kind), violations: decisionCardViolations(card, r) }] : [];
  });
  const partial = targets.filter((t) => t.analysisRoute !== "FULL_RELATIVE_ANALYSIS");
  const explained = partial.filter((t) => {
    const card = decisionCard(r, t.key);
    return card !== null && card.uncertain.length > 1 && card.nextActions.length > 0;
  }).length;
  let discovery: RunMetrics["discovery"] = null;
  if (r.intent === "explore_frontier") {
    const candidates = r.territories.filter((t) => t.role === "frontier_candidate" && t.analysisRoute !== "INSUFFICIENT_EVIDENCE");
    const concepts = candidates.flatMap((t) => (t.resolvedConcept ? [t.resolvedConcept.id] : []));
    discovery = {
      candidates: candidates.length,
      grounded: candidates.filter((t) => t.resolvedConcept !== null).length,
      distinct: new Set(concepts).size,
      agentHypotheses: candidates.filter((t) => t.origin === "agent_hypothesis").length,
      hypothesesAnalyzedUnsupported: candidates.filter((t) => t.origin === "agent_hypothesis" && !t.resolvedConcept).length,
    };
  }
  const f = r.comparisonFeasibility ?? null;
  return {
    ...base,
    fullTerritories: full.length,
    unsupportedClassifications: unsupported,
    crossCallComparisons: cross,
    feasibility: f?.status ?? null,
    blocker: f?.blocker?.code ?? null,
    repeat: f?.repeat ?? null,
    cards,
    partialFindingsExplained: { total: partial.length, explained },
    routes: Object.fromEntries(r.territories.map((t) => [t.key, t.analysisRoute])),
    discovery,
  };
}

function checkExpect(e: Expect, m: RunMetrics, response: AgentRunResponse): string[] {
  const f: string[] = [];
  for (const [k, v] of Object.entries(e.routes ?? {})) if (m.routes[k] !== v) f.push(`${k} route: expected ${v}, got ${m.routes[k] ?? "missing"}`);
  for (const k of e.notFull ?? []) if (m.routes[k] === "FULL_RELATIVE_ANALYSIS") f.push(`${k} must not be FULL`);
  if (e.maxEmptyProbes !== undefined && m.emptyProbes > e.maxEmptyProbes) f.push(`empty probes ${m.emptyProbes} > ${e.maxEmptyProbes}`);
  if (e.feasibility && m.feasibility !== e.feasibility) f.push(`feasibility: expected ${e.feasibility}, got ${m.feasibility}`);
  if (e.repeat && m.repeat !== e.repeat) f.push(`repeat: expected ${e.repeat}, got ${m.repeat}`);
  if (e.nextActionNot && m.cards.some((c) => c.next.includes(e.nextActionNot!))) f.push(`a card suggests ${e.nextActionNot}`);
  if (e.noEvidenceFromFailedCalls && isAnalysis(response)) {
    const failedTags = new Set(response.trace.toolCalls.filter((c) => c.status === "failed").flatMap((c) => ((c.arguments as { tagIds?: string[] })?.tagIds ?? []).map(String)));
    for (const t of response.territories) if (t.resolvedConcept && failedTags.has(t.resolvedConcept.id) && t.representation.exemplars.length > 0) f.push(`${t.key} is represented from a failed call's tag`);
  }
  return f;
}

/** Invariants every run must satisfy, in both arms. */
function invariants(m: RunMetrics): string[] {
  const f: string[] = [];
  if (m.unsupportedClassifications > 0) f.push(`${m.unsupportedClassifications} unsupported classification(s)`);
  if (m.crossCallComparisons > 0) f.push(`${m.crossCallComparisons} cross-call comparison(s)`);
  for (const c of m.cards) for (const v of c.violations) f.push(`decision card ${c.territory}: ${v}`);
  if (m.partialFindingsExplained.explained < m.partialFindingsExplained.total) f.push(`${m.partialFindingsExplained.total - m.partialFindingsExplained.explained} partial finding(s) without limitation and next action`);
  if (m.discovery && m.discovery.hypothesesAnalyzedUnsupported > 0) f.push(`${m.discovery.hypothesesAnalyzedUnsupported} unsupported hypothesis(es) analyzed as real`);
  return f;
}

export type CaseResult = {
  id: string;
  kind: Case["kind"];
  dimension: Case["dimension"];
  split: string;
  status: "PASS" | "FAIL" | "NOT_RUN";
  failures: string[];
  regression: string[];
  arms?: Record<Arm, RunMetrics>;
  asRun?: RunMetrics & { callsAfterInfeasible: number; timeouts: number };
  note?: string;
};

function loadCases(): Case[] {
  const doc = JSON.parse(readFileSync(D2D_CASES_PATH, "utf8")) as { fixtureType: string; version: string; cases: Case[] };
  if (doc.fixtureType !== "synthetic" || doc.version !== D2D_EVAL_VERSION) throw new Error("discovery-decision cases must be labelled synthetic and versioned");
  return doc.cases;
}

function scenarioFor(c: Case, scenarios: Map<string, Scenario>): Scenario {
  if (c.kind === "scenario") {
    const s = scenarios.get(c.scenario!);
    if (!s) throw new Error(`unknown scenario ${c.scenario}`);
    // The arm is set per run; a scenario pinned to one arm is still measured in both.
    const { feasibilityPolicy: _pinned, ...rest } = s;
    return rest;
  }
  return { id: c.id, category: "D2D", description: c.description, policy: c.policy ?? "baseline", ...(c.wrap && { wrap: c.wrap }), request: c.request ?? {}, ...(c.faults && { faults: c.faults }), expect: {} };
}

async function runCase(c: Case, scenarios: Map<string, Scenario>): Promise<CaseResult> {
  const head = { id: c.id, kind: c.kind, dimension: c.dimension, split: c.split };
  if (c.kind === "live-target") return { ...head, status: "NOT_RUN", failures: [], regression: [], note: `LIVE_QLOO_VALIDATION_NOT_RUN: ${c.target} has no stored trace; synthetic analogue ${c.syntheticAnalogue ?? "none"}` };
  if (c.kind === "recorded") {
    const response = JSON.parse(readFileSync(join(ROOT, c.artifact!), "utf8")) as AgentAnalysisResult;
    if (response.evidenceOrigin !== "live") throw new Error(`${c.artifact} is not a recorded live result`);
    const m = runMetrics(response);
    const infeasibleAt = (response.trace.completion ?? []).find((x) => !x.fullAnalysisFeasible)?.iteration ?? null;
    const callsAfterInfeasible = infeasibleAt === null ? 0 : response.trace.toolCalls.filter((x) => x.iteration > infeasibleAt && x.status !== "rejected" && x.qlooOperations.length > 0).length;
    const timeouts = response.trace.toolCalls.filter((x) => /TOOL_TIMEOUT/u.test(x.summary)).length;
    // Recorded results predate decision cards; only wording and grounding invariants apply (no feasibility record).
    const failures = invariants(m);
    return { ...head, status: failures.length ? "FAIL" : "PASS", failures, regression: [], asRun: { ...m, callsAfterInfeasible, timeouts } };
  }
  const scenario = scenarioFor(c, scenarios);
  const arms = {} as Record<Arm, RunMetrics>;
  const passed = {} as Record<Arm, boolean>;
  const failures: string[] = [];
  for (const arm of ["observe", "enforce"] as const) {
    const run = await runScenario(scenario, { feasibilityPolicy: arm });
    arms[arm] = runMetrics(run.response);
    passed[arm] = run.passed;
    for (const v of invariants(arms[arm])) failures.push(`${arm}: ${v}`);
    if (c.kind === "scenario" && arm === "enforce" && !run.passed) failures.push(...run.failures.map((x) => `enforce: ${x}`));
    if (c.kind === "runtime" && arm === "enforce") failures.push(...checkExpect(c.expect ?? {}, arms[arm], run.response));
  }
  const regression: string[] = [];
  if (arms.observe.fullTerritories > arms.enforce.fullTerritories) regression.push(`FULL territories ${arms.observe.fullTerritories} → ${arms.enforce.fullTerritories}`);
  if (c.kind === "scenario" && passed.observe && !passed.enforce) regression.push("scenario expectations held in observe, not in enforce");
  return { ...head, status: failures.length || regression.length ? "FAIL" : "PASS", failures, regression, arms };
}

export type D2DReport = {
  version: string;
  evidence: "SYNTHETIC_AND_RECORDED_ONLY";
  liveStatus: "LIVE_QLOO_VALIDATION_NOT_RUN";
  modelStatus: "LIVE_AGENT_MODEL_VALIDATION_NOT_RUN";
  cases: CaseResult[];
  matched: { cases: number; observe: Totals; enforce: Totals; deltas: Record<string, string> };
  applicable: { cases: string[]; observeEmptyProbes: number; enforceEmptyProbes: number; reductionPct: number | null };
  recordedBaseline: { cases: number; emptyProbes: number; callsAfterInfeasible: number; timeouts: number; qlooCalls: number | null };
  targets: { name: string; value: string; pass: boolean }[];
  passed: boolean;
};
type Totals = { qlooCalls: number; iterations: number; emptyProbes: number; savingRefusals: number; fullTerritories: number; partialFindings: number; partialExplained: number };

const totals = (ms: RunMetrics[]): Totals => ({
  qlooCalls: ms.reduce((n, m) => n + m.qlooCalls, 0),
  iterations: ms.reduce((n, m) => n + m.iterations, 0),
  emptyProbes: ms.reduce((n, m) => n + m.emptyProbes, 0),
  savingRefusals: ms.reduce((n, m) => n + m.savingRefusals, 0),
  fullTerritories: ms.reduce((n, m) => n + m.fullTerritories, 0),
  partialFindings: ms.reduce((n, m) => n + m.partialFindingsExplained.total, 0),
  partialExplained: ms.reduce((n, m) => n + m.partialFindingsExplained.explained, 0),
});

export async function runD2DEval(): Promise<D2DReport> {
  const scenarios = new Map((JSON.parse(readFileSync(SCENARIOS_PATH, "utf8")) as { scenarios: Scenario[] }).scenarios.map((s) => [s.id, s]));
  const results: CaseResult[] = [];
  for (const c of loadCases()) results.push(await runCase(c, scenarios));
  const matched = results.filter((r) => r.arms);
  const observe = totals(matched.map((r) => r.arms!.observe));
  const enforce = totals(matched.map((r) => r.arms!.enforce));
  const pct = (a: number, b: number) => (a === 0 ? "n/a" : `${Math.round(((b - a) / a) * 1000) / 10}%`);
  // Applicable replay scenarios: matched cases where the observe arm spent at least one empty probe.
  const applicable = matched.filter((r) => r.arms!.observe.emptyProbes > 0);
  const ae = applicable.reduce((n, r) => n + r.arms!.observe.emptyProbes, 0);
  const ee = applicable.reduce((n, r) => n + r.arms!.enforce.emptyProbes, 0);
  const recorded = results.filter((r) => r.asRun);
  const all = [...matched.flatMap((r) => [r.arms!.observe, r.arms!.enforce]), ...recorded.map((r) => r.asRun!)];
  const targets = [
    { name: "unsupported classifications (all runs)", value: String(all.reduce((n, m) => n + m.unsupportedClassifications, 0)), pass: all.every((m) => m.unsupportedClassifications === 0) },
    { name: "cross-call numerical comparisons (all runs)", value: String(all.reduce((n, m) => n + m.crossCallComparisons, 0)), pass: all.every((m) => m.crossCallComparisons === 0) },
    { name: "decision-card violations (all runs)", value: String(all.reduce((n, m) => n + m.cards.reduce((k, c) => k + c.violations.length, 0), 0)), pass: all.every((m) => m.cards.every((c) => c.violations.length === 0)) },
    { name: "partial findings with limitation + next action (enforce)", value: `${enforce.partialExplained}/${enforce.partialFindings}`, pass: enforce.partialExplained === enforce.partialFindings },
    { name: "regressions on matched cases", value: String(matched.filter((r) => r.regression.length).length), pass: matched.every((r) => r.regression.length === 0) },
    { name: "FULL territories on matched cases (enforce ≥ observe)", value: `${observe.fullTerritories} → ${enforce.fullTerritories}`, pass: enforce.fullTerritories >= observe.fullTerritories },
    { name: "Qloo calls on matched cases (enforce ≤ observe)", value: `${observe.qlooCalls} → ${enforce.qlooCalls}`, pass: enforce.qlooCalls <= observe.qlooCalls },
    { name: "empty probes on applicable cases (proposed target: ≥ 20% fewer)", value: `${ae} → ${ee} (${pct(ae, ee)}, ${applicable.length} case(s))`, pass: ee <= ae },
  ];
  return {
    version: D2D_EVAL_VERSION,
    evidence: "SYNTHETIC_AND_RECORDED_ONLY",
    liveStatus: "LIVE_QLOO_VALIDATION_NOT_RUN",
    modelStatus: "LIVE_AGENT_MODEL_VALIDATION_NOT_RUN",
    cases: results,
    matched: { cases: matched.length, observe, enforce, deltas: { qlooCalls: pct(observe.qlooCalls, enforce.qlooCalls), iterations: pct(observe.iterations, enforce.iterations), emptyProbes: pct(observe.emptyProbes, enforce.emptyProbes), fullTerritories: `${observe.fullTerritories} → ${enforce.fullTerritories}` } },
    applicable: { cases: applicable.map((r) => r.id), observeEmptyProbes: ae, enforceEmptyProbes: ee, reductionPct: ae === 0 ? null : Math.round(((ae - ee) / ae) * 1000) / 10 },
    recordedBaseline: {
      cases: recorded.length,
      emptyProbes: recorded.reduce((n, r) => n + r.asRun!.emptyProbes, 0),
      callsAfterInfeasible: recorded.reduce((n, r) => n + r.asRun!.callsAfterInfeasible, 0),
      timeouts: recorded.reduce((n, r) => n + r.asRun!.timeouts, 0),
      qlooCalls: null,
    },
    targets,
    passed: results.every((r) => r.status !== "FAIL") && targets.every((t) => t.pass),
  };
}

export function formatD2D(report: D2DReport): string {
  const lines = [`Discovery-to-Decision evaluation (${report.version}) — ${report.evidence}; ${report.liveStatus}; ${report.modelStatus}`, ""];
  for (const r of report.cases) {
    const arms = r.arms ? ` observe: ${r.arms.observe.qlooCalls}q ${r.arms.observe.emptyProbes}e ${r.arms.observe.fullTerritories}F | enforce: ${r.arms.enforce.qlooCalls}q ${r.arms.enforce.emptyProbes}e ${r.arms.enforce.fullTerritories}F${r.arms.enforce.feasibility ? ` ${r.arms.enforce.feasibility}${r.arms.enforce.blocker ? `/${r.arms.enforce.blocker}` : ""}` : ""}` : r.asRun ? ` as run: ${r.asRun.emptyProbes} empty probes, ${r.asRun.callsAfterInfeasible} calls after infeasible, ${r.asRun.timeouts} timeouts` : ` ${r.note}`;
    lines.push(`  [${r.status}] ${r.id} (${r.dimension}, ${r.split})${arms}`);
    for (const f of [...r.failures, ...r.regression.map((x) => `REGRESSION ${x}`)]) lines.push(`      - ${f}`);
  }
  const { observe: o, enforce: e } = report.matched;
  lines.push("", `Matched cases: ${report.matched.cases} (same fixtures, policy, budget, methodology)`);
  lines.push(`  Qloo calls        ${o.qlooCalls} → ${e.qlooCalls} (${report.matched.deltas.qlooCalls})`);
  lines.push(`  agent iterations  ${o.iterations} → ${e.iterations} (${report.matched.deltas.iterations})`);
  lines.push(`  empty probes      ${o.emptyProbes} → ${e.emptyProbes} (${report.matched.deltas.emptyProbes})`);
  lines.push(`  saving refusals   ${o.savingRefusals} → ${e.savingRefusals}`);
  lines.push(`  FULL territories  ${o.fullTerritories} → ${e.fullTerritories}`);
  lines.push(`  partial findings explained  ${o.partialExplained}/${o.partialFindings} → ${e.partialExplained}/${e.partialFindings}`);
  const rb = report.recordedBaseline;
  lines.push("", `Recorded live baseline (pre-9N engine, as run, ${rb.cases} artefacts): ${rb.emptyProbes} empty probes, ${rb.callsAfterInfeasible} Qloo-facing calls after completion turned infeasible, ${rb.timeouts} tool timeouts`);
  lines.push("", "Quality targets");
  for (const t of report.targets) lines.push(`  [${t.pass ? "PASS" : "FAIL"}] ${t.name}: ${t.value}`);
  lines.push("", `RESULT: ${report.passed ? "PASS" : "FAIL"}`);
  return lines.join("\n");
}
