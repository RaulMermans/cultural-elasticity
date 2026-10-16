/**
 * `pnpm eval:agent` harness: runs evals/agent/scenarios.json against the SYNTHETIC world with the
 * ScriptedAgentModel (scripted scenarios) or the baseline reference policy (policy scenarios), checks
 * each scenario's deterministic expectations, and reports run-level metrics against acceptance thresholds.
 *
 * Direction is eval → product: this script imports the runtime; the runtime never imports this script,
 * the scenarios or the benchmark. It reads benchmark.json ONLY to check that no benchmark name reaches a
 * model context (leakage check). It makes no network request and validates no live model.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentAnalysisResult, AgentNeedsInputResponse, AgentRunResponse } from "@cultural-elasticity/shared";
import { validateClaims } from "../src/agent/claim-validator.js";
import { createScriptedToolProvider, hasModelCredential, LIVE_AGENT_MODEL_VALIDATION_NOT_RUN } from "../src/agent/factory.js";
import { BaselinePolicyModel } from "../src/agent/model/baseline.js";
import type { AgentDecisionContext, AgentModel } from "../src/agent/model/provider.js";
import { ScriptedAgentModel, type ScriptStep } from "../src/agent/model/scripted.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { syntheticWorldSchema, type SyntheticFault } from "../src/agent/synthetic-world.js";
import { ELASTICITY_CAPTURE } from "../src/capture/elasticity-config.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const SCENARIOS_PATH = join(ROOT, "evals/agent/scenarios.json");
const WORLD_PATH = join(ROOT, "evals/fixtures/synthetic/agent/world.json");
const BENCHMARK_PATH = join(ROOT, "evals/benchmarks/cultural-elasticity-v0/benchmark.json");

type Expect = {
  status?: string;
  intent?: string;
  finalSufficiency?: string;
  brandId?: string;
  brandResolution?: string;
  routes?: Record<string, string>;
  strategies?: Record<string, string>;
  classes?: Record<string, string>;
  robustness?: Record<string, string>;
  exemplars?: Record<string, string[]>;
  excludedExemplars?: Record<string, string[]>;
  exemplarCounts?: Record<string, number>;
  rejectedCodes?: Record<string, string[]>;
  failureCodes?: Record<string, string>;
  resolvedConcepts?: Record<string, string>;
  capabilities?: Record<string, Record<string, string>>;
  methodologyRuns?: number;
  minTerritories?: number;
  allOrigins?: string;
  toolsCalled?: string[];
  toolErrors?: string[];
  rejections?: string[];
  limitationCodes?: string[];
  options?: string[];
  maxQlooCalls?: number;
  maxIterations?: number;
  retries?: number;
  summarySource?: string;
  claimViolations?: boolean;
  generalization?: string;
};

export type Scenario = {
  id: string;
  category: string;
  description: string;
  policy: "baseline" | "scripted";
  request: Record<string, unknown>;
  steps?: ScriptStep[];
  synthesis?: unknown[];
  faults?: SyntheticFault[];
  answer?: string;
  expect: Expect;
};

/** Records every decision context a model sees (for leakage checks). */
class Recording implements AgentModel {
  readonly contexts: AgentDecisionContext[] = [];
  constructor(private readonly inner: AgentModel) {}
  get info() {
    return this.inner.info;
  }
  decide(context: AgentDecisionContext) {
    this.contexts.push(context);
    return this.inner.decide(context);
  }
  get synthesize() {
    return this.inner.synthesize?.bind(this.inner);
  }
}

export type ScenarioResult = { id: string; category: string; passed: boolean; failures: string[]; response: AgentRunResponse; contexts: AgentDecisionContext[] };

/**
 * Benchmark data a run was never given: benchmark brands and pinned exemplars (territory names are
 * generic words a user may type, so they are not leakage). Expected labels are checked separately.
 */
function benchmarkNames(): string[] {
  const benchmark = JSON.parse(readFileSync(BENCHMARK_PATH, "utf8")) as { brands: { label: string }[] };
  const names = new Set<string>(benchmark.brands.map((b) => b.label));
  for (const t of ELASTICITY_CAPTURE.territories) for (const e of t.exemplars) names.add(e.label);
  return [...names];
}

function check(s: Scenario, response: AgentRunResponse): string[] {
  const f: string[] = [];
  const e = s.expect;
  const eq = (what: string, got: unknown, want: unknown) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) f.push(`${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };
  const trace = response.trace;
  const limits = trace.limits as Record<string, number>;
  if (e.status) eq("status", response.status, e.status);
  if (e.intent) eq("intent", trace.intent, e.intent);
  if (e.maxQlooCalls !== undefined && response.metrics.qloo_calls > e.maxQlooCalls) f.push(`qloo calls ${response.metrics.qloo_calls} > ${e.maxQlooCalls}`);
  if (e.maxIterations !== undefined && response.metrics.agent_iterations > e.maxIterations) f.push(`iterations ${response.metrics.agent_iterations} > ${e.maxIterations}`);
  if (response.metrics.qloo_calls > limits.maxQlooCalls!) f.push("BUDGET VIOLATION: Qloo calls");
  if (response.metrics.agent_iterations > limits.maxAgentIterations!) f.push("BUDGET VIOLATION: iterations");
  if (e.retries !== undefined) eq("retries", response.metrics.retry_count, e.retries);
  const toolErrors = trace.toolCalls.flatMap((c) => (c.error ? [c.error] : []));
  const rejections = trace.turns.flatMap((t) => t.decisions.flatMap((d) => (d.rejection ? [d.rejection.split(":")[0]!] : [])));
  for (const tool of e.toolsCalled ?? []) if (!trace.toolCalls.some((c) => c.tool === tool && c.status !== "rejected")) f.push(`tool ${tool} not called`);
  for (const code of e.toolErrors ?? []) if (!toolErrors.includes(code)) f.push(`tool error ${code} missing (got ${toolErrors.join(",")})`);
  for (const code of e.rejections ?? []) if (!rejections.includes(code)) f.push(`rejection ${code} missing (got ${rejections.join(",")})`);
  if (response.status === "NEEDS_INPUT") {
    if (e.options) eq("options", (response as AgentNeedsInputResponse).options.map((o) => o.id), e.options);
    return f;
  }
  const r = response as AgentAnalysisResult;
  const by = new Map(r.territories.map((t) => [t.key, t]));
  const t = (key: string) => {
    const x = by.get(key);
    if (!x) f.push(`territory ${key} missing (have ${[...by.keys()].join(",")})`);
    return x;
  };
  if (e.finalSufficiency) eq("finalSufficiency", r.finalSufficiency, e.finalSufficiency);
  if (e.brandId) eq("brand", r.brand?.id, e.brandId);
  if (e.brandResolution) eq("brand resolution", r.brand?.resolution, e.brandResolution);
  for (const [k, v] of Object.entries(e.routes ?? {})) eq(`${k} route`, t(k)?.analysisRoute, v);
  for (const [k, v] of Object.entries(e.strategies ?? {})) eq(`${k} strategy`, t(k)?.representation.strategy, v);
  for (const [k, v] of Object.entries(e.classes ?? {})) eq(`${k} class`, t(k)?.classification?.label, v);
  for (const [k, v] of Object.entries(e.robustness ?? {})) eq(`${k} robustness`, t(k)?.robustness?.level, v);
  for (const [k, v] of Object.entries(e.exemplars ?? {})) eq(`${k} exemplars`, t(k)?.representation.exemplars.map((x) => x.label), v);
  for (const [k, v] of Object.entries(e.excludedExemplars ?? {})) for (const label of v) if (t(k)?.representation.exemplars.some((x) => x.label === label)) f.push(`${k}: ${label} must not be an exemplar`);
  for (const [k, v] of Object.entries(e.exemplarCounts ?? {})) eq(`${k} exemplar count`, t(k)?.representation.exemplars.length, v);
  for (const [k, v] of Object.entries(e.rejectedCodes ?? {})) for (const code of v) if (!t(k)?.representation.rejectedExemplars.some((x) => x.code === code)) f.push(`${k}: rejection ${code} missing`);
  for (const [k, v] of Object.entries(e.failureCodes ?? {})) eq(`${k} failure`, t(k)?.representation.failure?.code, v);
  for (const [k, v] of Object.entries(e.resolvedConcepts ?? {})) eq(`${k} concept`, t(k)?.resolvedConcept?.id, v);
  for (const [k, caps] of Object.entries(e.capabilities ?? {})) for (const [cap, v] of Object.entries(caps)) eq(`${k} ${cap}`, (t(k)?.capabilities as Record<string, string> | undefined)?.[cap], v);
  if (e.methodologyRuns !== undefined) eq("methodology runs", r.methodologyRuns.length, e.methodologyRuns);
  if (e.minTerritories !== undefined && r.territories.length < e.minTerritories) f.push(`only ${r.territories.length} territories`);
  if (e.allOrigins && !r.territories.every((x) => x.origin === e.allOrigins)) f.push(`origins ${r.territories.map((x) => x.origin).join(",")}`);
  for (const code of e.limitationCodes ?? []) if (!r.limitations.some((l) => l.code === code) && !r.territories.some((x) => x.limitations.some((l) => l.code === code))) f.push(`limitation ${code} missing`);
  if (e.summarySource) eq("summary source", r.summary.source, e.summarySource);
  if (e.claimViolations !== undefined) eq("claim violations recorded", r.summary.claimValidation.violations.length > 0, e.claimViolations);
  return f;
}

/** Recomputes, independently of the runtime, that every FULL territory restates its methodology run exactly. */
export function methodologyConsistent(r: AgentAnalysisResult): boolean {
  for (const t of r.territories.filter((x) => x.analysisRoute === "FULL_RELATIVE_ANALYSIS")) {
    const run = r.methodologyRuns.find((m) => m.territoryKeys.includes(t.key));
    const view = run?.result.territories.find((x) => x.territory.id === t.key);
    if (!view) return false;
    if (view.classification.label !== t.classification?.label || view.relativePosition.position !== t.relativePosition?.position || view.relativePosition.medianPercentile !== t.relativePosition?.medianPercentile || view.robustness.level !== t.robustness?.level || view.evidenceQuality.level !== t.evidenceQuality?.level) return false;
  }
  for (const t of r.territories.filter((x) => x.analysisRoute !== "FULL_RELATIVE_ANALYSIS")) if (t.classification !== null || t.relativePosition !== null) return false;
  return true;
}

export async function runScenario(s: Scenario): Promise<ScenarioResult> {
  const world = syntheticWorldSchema.parse(JSON.parse(readFileSync(WORLD_PATH, "utf8")));
  const inner = s.policy === "scripted" ? new ScriptedAgentModel(s.steps ?? [], s.synthesis ?? [], s.id) : new BaselinePolicyModel();
  const model = new Recording(inner);
  const runtime = new AgentRuntime({ model, provider: createScriptedToolProvider(world, s.faults ?? []) });
  let response = await runtime.run(s.request);
  if (response.status === "NEEDS_INPUT" && s.answer) response = await runtime.continue(response.runId, s.answer);
  const failures = check(s, response);
  return { id: s.id, category: s.category, passed: failures.length === 0, failures, response, contexts: model.contexts };
}

export type AgentEvalReport = {
  scenarios: ScenarioResult[];
  metrics: Record<string, number | string | null>;
  thresholds: { name: string; value: number | null; required: string; passed: boolean }[];
  passed: boolean;
  liveModel: string;
};

const ratio = (a: number, b: number) => (b === 0 ? null : Math.round((a / b) * 1000) / 1000);

export async function runAgentEval(): Promise<AgentEvalReport> {
  const doc = JSON.parse(readFileSync(SCENARIOS_PATH, "utf8")) as { fixtureType: string; scenarios: Scenario[] };
  if (doc.fixtureType !== "synthetic") throw new Error("agent scenarios must be labelled synthetic");
  const results: ScenarioResult[] = [];
  for (const s of doc.scenarios) results.push(await runScenario(s));

  const names = benchmarkNames();
  const leakPattern = new RegExp(`expected_(strong|mid|weak)|(^|[^\\p{L}])(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|")})([^\\p{L}]|$)`, "iu");
  const analyses = results.map((r) => r.response).filter((r): r is AgentAnalysisResult => r.status !== "NEEDS_INPUT");
  const territories = analyses.flatMap((r) => r.territories);
  const baselineDecisions = results.filter((r) => r.id && r.response.model.kind === "baseline").flatMap((r) => r.response.trace.turns.flatMap((t) => t.decisions.filter((d) => d.action === "call_tool")));
  const allCalls = results.flatMap((r) => r.response.trace.turns.flatMap((t) => t.decisions.filter((d) => d.action === "call_tool")));
  const intentScenarios = results.filter((r) => (doc.scenarios.find((s) => s.id === r.id)!.expect.intent !== undefined));
  const brandScenarios = results.filter((r) => doc.scenarios.find((s) => s.id === r.id)!.expect.brandId !== undefined);
  const generalization = doc.scenarios.filter((s) => s.expect.generalization);
  const leaks = results.filter((r) => leakPattern.test(JSON.stringify(r.contexts))).map((r) => r.id);
  const budgetViolations = results.filter((r) => r.failures.some((f) => f.startsWith("BUDGET VIOLATION"))).length;
  const claimConsistent = analyses.filter((r) => validateClaims({ summary: r.summary.text, territoryNotes: [], followUpOptions: r.followUpOptions }, r.territories, r.brand ? [r.brand.label] : []).length === 0).length;

  const metrics: AgentEvalReport["metrics"] = {
    scenarios: results.length,
    scenarios_passed: results.filter((r) => r.passed).length,
    intent_routing_accuracy: ratio(intentScenarios.filter((r) => r.response.trace.intent === doc.scenarios.find((s) => s.id === r.id)!.expect.intent).length, intentScenarios.length),
    valid_tool_call_rate_baseline: ratio(baselineDecisions.filter((d) => d.accepted).length, baselineDecisions.length),
    valid_tool_call_rate_all: ratio(allCalls.filter((d) => d.accepted).length, allCalls.length),
    tool_argument_validity: ratio(allCalls.filter((d) => !d.rejection?.startsWith("INVALID_ARGUMENTS")).length, allCalls.length),
    entity_resolution_success: ratio(brandScenarios.filter((r) => (r.response as AgentAnalysisResult).brand?.id === doc.scenarios.find((s) => s.id === r.id)!.expect.brandId).length, brandScenarios.length),
    territory_resolution_success: ratio(territories.filter((t) => t.resolvedConcept !== null).length, territories.length),
    representation_success: ratio(territories.filter((t) => t.representation.exemplars.length > 0).length, territories.filter((t) => t.resolvedConcept !== null).length),
    full_analysis_rate: ratio(territories.filter((t) => t.analysisRoute === "FULL_RELATIVE_ANALYSIS").length, territories.length),
    partial_analysis_rate: ratio(territories.filter((t) => t.analysisRoute === "PARTIAL_CULTURAL_ANALYSIS").length, territories.length),
    descriptive_analysis_rate: ratio(territories.filter((t) => t.analysisRoute === "DESCRIPTIVE_ANALYSIS").length, territories.length),
    unsupported_rate: ratio(territories.filter((t) => t.analysisRoute === "INSUFFICIENT_EVIDENCE").length, territories.length),
    methodology_consistency: ratio(analyses.filter(methodologyConsistent).length, analyses.length),
    final_claim_consistency: ratio(claimConsistent, analyses.length),
    budget_violations: budgetViolations,
    benchmark_leakage: leaks.length,
    generalization_passed: `${generalization.filter((s) => results.find((r) => r.id === s.id)!.passed).length}/${generalization.length}`,
    average_agent_iterations: ratio(results.reduce((n, r) => n + r.response.metrics.agent_iterations, 0), results.length),
    average_qloo_calls: ratio(results.reduce((n, r) => n + r.response.metrics.qloo_calls, 0), results.length),
  };
  const threshold = (name: string, value: number | null, required: string, ok: boolean) => ({ name, value, required, passed: ok });
  const thresholds = [
    threshold("all scenarios pass", metrics.scenarios_passed as number, `= ${results.length}`, metrics.scenarios_passed === results.length),
    threshold("intent routing accuracy", metrics.intent_routing_accuracy as number, "= 1", metrics.intent_routing_accuracy === 1),
    threshold("valid tool-call rate (baseline policy)", metrics.valid_tool_call_rate_baseline as number, "≥ 0.95", ((metrics.valid_tool_call_rate_baseline as number) ?? 0) >= 0.95),
    threshold("methodology consistency", metrics.methodology_consistency as number, "= 1", metrics.methodology_consistency === 1),
    threshold("final-claim consistency", metrics.final_claim_consistency as number, "= 1", metrics.final_claim_consistency === 1),
    threshold("budget violations", budgetViolations, "= 0", budgetViolations === 0),
    threshold("benchmark leakage", leaks.length, "= 0", leaks.length === 0),
  ];
  return {
    scenarios: results,
    metrics,
    thresholds,
    passed: thresholds.every((t) => t.passed),
    liveModel: hasModelCredential() ? "model credential present (eval:agent itself runs scripted/baseline only)" : LIVE_AGENT_MODEL_VALIDATION_NOT_RUN,
  };
}

export function formatAgentEval(report: AgentEvalReport): string {
  const lines = ["Cultural Elasticity — agent evaluation (SYNTHETIC world, scripted model + baseline reference policy)", "Offline: no Qloo call, no model call. Not a live Qloo validation, not a live model validation.", ""];
  const byCategory = new Map<string, ScenarioResult[]>();
  for (const s of report.scenarios) byCategory.set(s.category, [...(byCategory.get(s.category) ?? []), s]);
  for (const [category, items] of byCategory) {
    lines.push(category);
    for (const s of items) {
      lines.push(`  [${s.passed ? "PASS" : "FAIL"}] ${s.id}  (${s.response.status}; ${s.response.metrics.agent_iterations} it, ${s.response.metrics.qloo_calls} Qloo)`);
      for (const f of s.failures) lines.push(`         ${f}`);
    }
  }
  lines.push("", "Metrics");
  for (const [k, v] of Object.entries(report.metrics)) lines.push(`  ${k.padEnd(32)} ${v ?? "n/a"}`);
  lines.push("", "Acceptance thresholds");
  for (const t of report.thresholds) lines.push(`  [${t.passed ? "PASS" : "FAIL"}] ${t.name}: ${t.value ?? "n/a"} (required ${t.required})`);
  lines.push("", `Live/model status: ${report.liveModel}`, `RESULT: ${report.passed ? "PASS" : "FAIL"}`);
  return lines.join("\n");
}
