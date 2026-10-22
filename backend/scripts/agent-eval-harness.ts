/**
 * `pnpm eval:agent` harness: runs evals/agent/scenarios.json against the SYNTHETIC world with the
 * ScriptedAgentModel (scripted scenarios) or the baseline reference policy (policy scenarios), checks
 * each scenario's deterministic expectations, and reports run-level metrics against acceptance thresholds.
 *
 * Direction is eval → product: this script imports the runtime; the runtime never imports this script,
 * the scenarios or the benchmark. It reads benchmark.json ONLY to check that no benchmark name reaches a
 * model context (leakage check). It makes no network request and validates no live model.
 */
import { evaluatorFailures, RUN_EVALUATORS_VERSION } from "./run-evaluators.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentAnalysisResult, AgentFailureCategory, AgentNeedsInputResponse, AgentRunResponse } from "@cultural-elasticity/shared";
import type { SkillEvalOutcome } from "../src/agent/skills/contracts.js";
import { skillOutcomes } from "../src/agent/skills/outcomes.js";
import { SkillRegistry } from "../src/agent/skills/registry.js";
import { validateClaims } from "../src/agent/claim-validator.js";
import { hasModelCredential, LIVE_AGENT_MODEL_VALIDATION_NOT_RUN } from "../src/agent/factory.js";
import { BaselinePolicyModel } from "../src/agent/model/baseline.js";
import type { AgentDecisionContext, AgentModel } from "../src/agent/model/provider.js";
import { ScriptedAgentModel, type ScriptStep } from "../src/agent/model/scripted.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { createScriptedToolProvider, syntheticWorldSchema, type SyntheticFault } from "./synthetic/synthetic-world.js";
import { ELASTICITY_CAPTURE } from "./capture/elasticity-config.js";

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
  // Sprint 4
  primaryExemplars?: Record<string, string>;
  qualityFinal?: Record<string, string>;
  absentTerritories?: string[];
  semanticJudgments?: number;
  comparisonRejected?: Record<string, string>;
  dedupVerdicts?: Record<string, string>;
  modelDedupApplied?: number;
  sources?: Record<string, string>;
  minCallsAvoided?: number;
  // Sprint 5A
  /** Strings that must appear in at least one decision context the model saw (state-grounded guidance). */
  contextIncludes?: string[];
  /** Territory keys that must not have a FULL relative analysis. */
  notFull?: string[];
  findingsAccepted?: number;
  /** Sprint 5A.1: no concept was probed with more empty entity types than this. */
  maxEmptyTypeProbesPerConcept?: number;
  /** Sprint 5A.1: per-territory UI evidence status. */
  evidenceStatus?: Record<string, string>;
  /** Sprint 5A.1: the Qloo take used for the brand's related entities. */
  relatedTake?: number;
  /** Sprint 5A.1: every generated candidate carries a canonical key from its grounding tag, anchored to that concept. */
  allCandidatesCanonical?: boolean;
  /** Sprint 5A.2: candidates the runtime anchored to their grounding tag after it returned members. */
  sourceEvidenceAnchors?: number;
  /** Sprint 5A.2: no territory was dropped as a duplicate. */
  noDuplicateDrops?: boolean;
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
  /**
   * Sprint 5A test instrument: wraps the baseline policy to reproduce a failure behaviour observed in live model
   * traces (eager_analyze: analyze the targets as soon as they are ready, as Sprint 4's live model did).
   */
  wrap?: "eager_analyze";
  expect: Expect;
};

/** Sprint 5A: reproduces the live "analyze too early" behaviour; defers to the inner policy once refused. */
class EagerAnalyze implements AgentModel {
  private refusedOnce = false;
  constructor(private readonly inner: AgentModel) {}
  get info() {
    return this.inner.info;
  }
  decide(context: AgentDecisionContext) {
    this.refusedOnce ||= [...(context.repair?.rejections ?? []), ...(context.lastTurn?.rejections ?? [])].some((r) => r.code === "REFERENCES_PENDING");
    const refused = this.refusedOnce;
    const ready = context.territories.filter((t) => t.role === "target" && t.status !== "analyzed" && t.readiness === "ready").map((t) => t.key);
    if (!refused && ready.length > 0 && context.actions.includes("analyze")) return Promise.resolve({ decisions: [{ action: "analyze", targetIds: ready, reasonSummary: "the target is represented; analyze it now" }] });
    return this.inner.decide(context);
  }
}

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
export function benchmarkNames(): string[] {
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
  if (e.minCallsAvoided !== undefined && response.metrics.calls_avoided < e.minCallsAvoided) f.push(`calls avoided ${response.metrics.calls_avoided} < ${e.minCallsAvoided}`);
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
  for (const [k, v] of Object.entries(e.primaryExemplars ?? {})) eq(`${k} primary exemplar`, t(k)?.representation.exemplars[0]?.label, v);
  for (const [scoped, v] of Object.entries(e.qualityFinal ?? {})) {
    const [key, label] = scoped.split(":") as [string, string];
    eq(`${scoped} quality`, [...trace.representationQuality].reverse().find((d) => d.territoryKey === key && d.label === label)?.final, v);
  }
  for (const k of e.absentTerritories ?? []) if (r.territories.some((x) => x.key === k && x.representation.failure?.code !== "DUPLICATE_TERRITORY")) f.push(`${k} should not be an in-scope territory`);
  if (e.semanticJudgments !== undefined) eq("semantic judgments", r.layers.agentInterpretation.semanticJudgments.length, e.semanticJudgments);
  for (const [k, v] of Object.entries(e.comparisonRejected ?? {})) eq(`${k} rejection stage`, r.comparisonSetConstruction.rejected.find((x) => x.key === k)?.stage, v);
  for (const [k, v] of Object.entries(e.dedupVerdicts ?? {})) eq(`${k} dedup verdict`, trace.conceptDedup.find((d) => d.dropped === k)?.verdict, v);
  if (e.modelDedupApplied !== undefined) eq("model dedup judgments applied", trace.conceptDedup.filter((d) => d.modelJudgment?.applied).length, e.modelDedupApplied);
  for (const [k, v] of Object.entries(e.sources ?? {})) eq(`${k} source`, r.comparisonSetConstruction.proposed.find((x) => x.key === k)?.source, v);
  if (e.claimViolations !== undefined) eq("claim violations recorded", r.summary.claimValidation.violations.length > 0, e.claimViolations);
  for (const k of e.notFull ?? []) if (t(k)?.analysisRoute === "FULL_RELATIVE_ANALYSIS") f.push(`${k} must not be FULL (its comparison set is not semantically meaningful)`);
  if (e.findingsAccepted !== undefined) eq("accepted grounded findings", r.layers.agentInterpretation.findings?.length ?? 0, e.findingsAccepted);
  if (e.maxEmptyTypeProbesPerConcept !== undefined && (r.metrics.max_empty_type_probes_per_concept ?? 0) > e.maxEmptyTypeProbesPerConcept) f.push(`a concept had ${r.metrics.max_empty_type_probes_per_concept} empty type probes (> ${e.maxEmptyTypeProbesPerConcept})`);
  for (const [k, v] of Object.entries(e.evidenceStatus ?? {})) eq(`${k} evidence status`, t(k)?.evidenceStatus, v);
  if (e.relatedTake !== undefined) {
    const related = r.trace.toolCalls.find((c) => c.tool === "qloo_related_entities" && c.status === "ok");
    eq("related take (members returned)", related ? Number(related.summary.split(" ")[0]) : null, e.relatedTake);
  }
  if (e.sourceEvidenceAnchors !== undefined) eq("source-evidence anchors", r.metrics.source_evidence_anchors ?? 0, e.sourceEvidenceAnchors);
  if (e.noDuplicateDrops) for (const d of trace.conceptDedup.filter((x) => x.dropped)) f.push(`${d.dropped} dropped as ${d.verdict} of ${d.a.key === d.dropped ? d.b.key : d.a.key} (${d.layer}: ${d.basis})`);
  if (e.allCandidatesCanonical) {
    const generated = r.territories.filter((x) => x.role === "frontier_candidate" && x.resolvedConcept);
    if (generated.length === 0) f.push("no anchored frontier candidate to check canonicalization");
    for (const x of generated) if (x.candidate?.normalizationReason !== "SOURCE_TAG_CANONICAL_NAME" || x.candidate.anchorRelation !== "SAME_CONCEPT") f.push(`${x.key}: canonicalization ${x.candidate?.normalizationReason}/${x.candidate?.anchorRelation}`);
  }
  return f;
}

function checkContexts(s: Scenario, contexts: readonly AgentDecisionContext[]): string[] {
  const text = JSON.stringify(contexts);
  return (s.expect.contextIncludes ?? []).filter((needle) => !text.includes(needle)).map((needle) => `no decision context contained "${needle}"`);
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
  const policy = s.policy === "scripted" ? new ScriptedAgentModel(s.steps ?? [], s.synthesis ?? [], s.id) : new BaselinePolicyModel();
  const inner = s.wrap === "eager_analyze" ? new EagerAnalyze(policy) : policy;
  const model = new Recording(inner);
  const runtime = new AgentRuntime({ model, provider: createScriptedToolProvider(world, s.faults ?? []) });
  let response = await runtime.run(s.request);
  if (response.status === "NEEDS_INPUT" && s.answer) response = await runtime.continue(response.runId, s.answer);
  const failures = [...check(s, response), ...checkContexts(s, model.contexts)];
  return { id: s.id, category: s.category, passed: failures.length === 0, failures, response, contexts: model.contexts };
}

export type PolicyClass = "SCRIPTED" | "BASELINE" | "LIVE_MODEL";

export type AgentEvalReport = {
  scenarios: ScenarioResult[];
  /** Headline metrics per policy class. Never merged into one number. */
  byPolicy: Partial<Record<PolicyClass, CompetenceMetrics>>;
  metrics: Record<string, number | string | null>;
  context: ContextStats;
  skills: SkillAggregate[];
  failureTaxonomy: { runCategories: Record<string, number>; failedScenarios: { id: string; category: AgentFailureCategory }[] };
  /** Sprint 5A.1: failed targeted runtime evaluators ("scenario: EVALUATOR — detail"). */
  runtimeEvaluatorFailures: string[];
  thresholds: { name: string; value: number | null; required: string; passed: boolean }[];
  passed: boolean;
  liveModel: string;
};

const ratio = (a: number, b: number) => (b === 0 ? null : Math.round((a / b) * 1000) / 1000);
const percentile = (values: number[], p: number) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
};

/** Sprint 3 decision-context size, measured on the same synthetic scenarios at HEAD d7c67a9 before Sprint 4. */
export const SPRINT3_CONTEXT_REFERENCE = { scenarios: 28, turns: 161, avgChars: 7856, maxChars: 16329, avgTokensEstimate: 1964, avgToolsExposed: 7.38 };
/** The 28 Sprint 3 scenarios: context size is compared on exactly this set. */
export const SPRINT3_SCENARIO_IDS = ["ir-move", "ir-compare", "ir-frontier", "ir-explicit-intent-wins", "er-exact", "er-not-found", "er-type-evidence", "amb-ask", "amb-continue", "amb-no-silent-choice", "dtd-unsupported-hypothesis", "dtd-near-duplicate", "ex-quality-selection", "ex-single-member", "rv-brand-conditioned", "rv-fabricated-id", "rv-place-representation", "ts-benchmark-lookup", "ts-wrong-phase", "ts-move-script", "ie-unmeasurable", "ie-descriptive", "bc-qloo-budget", "bc-iterations", "bc-retry-once", "fs-invented-claims", "fs-faithful", "gen-unseen-brand-territory"];

export type ContextStats = { sprint3Set?: Omit<ContextStats, "sprint3Reference" | "sprint3Set">; turns: number; avgChars: number | null; maxChars: number | null; avgTokensEstimate: number | null; avgToolsExposed: number | null; sprint3Reference: typeof SPRINT3_CONTEXT_REFERENCE };

export function contextStats(contexts: readonly AgentDecisionContext[]): ContextStats {
  const sizes = contexts.map((c) => JSON.stringify(c).length);
  return {
    turns: contexts.length,
    avgChars: sizes.length ? Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length) : null,
    maxChars: sizes.length ? Math.max(...sizes) : null,
    avgTokensEstimate: sizes.length ? Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length / 4) : null,
    avgToolsExposed: contexts.length ? Math.round((contexts.reduce((n, c) => n + c.tools.length, 0) / contexts.length) * 100) / 100 : null,
    sprint3Reference: SPRINT3_CONTEXT_REFERENCE,
  };
}

/** One evaluated run: the response, and (when the case has them) its expectations and expectation failures. */
export type EvaluatedRun = { id: string; response: AgentRunResponse; expect?: Expect; failures?: string[]; contexts?: AgentDecisionContext[] };

export type CompetenceMetrics = Record<string, number | string | null>;

const SELECTION_ERRORS = new Set(["UNKNOWN_TOOL", "NOT_EXPOSED", "WRONG_PHASE", "UNAUTHORIZED_TOOL"]);

/** Sprint 4 agent-competence metrics (spec §25) over a set of runs of ONE policy class. */
/**
 * Sprint 5A.1: rebuilds the claim scopes of a returned summary. The finalizer renders `summary` then one
 * "<territory label>: <note>" line per territory note; validating that flattened text as one summary judged a
 * territory's own note as an unattached run-level claim (live L-C2: "evidence quality is medium" in Heavy Metal's note,
 * whose evidence quality IS MEDIUM). A line is a note only when it starts with an exact territory label; every other line
 * stays in summary scope, so nothing is exempted from validation.
 */
export function splitRenderedSummary(a: AgentAnalysisResult): { summary: string; territoryNotes: { territoryKey: string; text: string }[]; followUpOptions: string[] } {
  const summary: string[] = [];
  const territoryNotes: { territoryKey: string; text: string }[] = [];
  const labels = [...a.territories].sort((x, y) => y.label.length - x.label.length);
  for (const line of a.summary.text.split("\n")) {
    const t = labels.find((x) => line.startsWith(`${x.label}: `));
    if (t && summary.length > 0) territoryNotes.push({ territoryKey: t.key, text: line.slice(t.label.length + 2) });
    else summary.push(line);
  }
  return { summary: summary.join("\n"), territoryNotes, followUpOptions: a.followUpOptions };
}

export function competenceMetrics(runs: readonly EvaluatedRun[], leakPattern: RegExp | null): CompetenceMetrics {
  const responses = runs.map((r) => r.response);
  const analyses = responses.filter((r): r is AgentAnalysisResult => r.status !== "NEEDS_INPUT");
  const territories = analyses.flatMap((r) => r.territories);
  const turns = responses.flatMap((r) => r.trace.turns);
  const calls = turns.flatMap((t) => t.decisions.filter((d) => d.action === "call_tool"));
  const decisions = analyses.flatMap((r) => r.trace.representationQuality);
  const withModel = decisions.filter((d) => d.modelAssessment);
  const expectRate = (pick: (e: Expect) => Record<string, string> | undefined, got: (r: AgentAnalysisResult, k: string) => string | undefined) => {
    let total = 0;
    let ok = 0;
    for (const run of runs) {
      const map = run.expect ? pick(run.expect) : undefined;
      if (!map || run.response.status === "NEEDS_INPUT") continue;
      for (const [k, v] of Object.entries(map)) {
        total += 1;
        if (got(run.response as AgentAnalysisResult, k) === v) ok += 1;
      }
    }
    return ratio(ok, total);
  };
  const latencies = responses.map((r) => r.metrics.latency_ms);
  const claimConsistent = analyses.filter((r) => validateClaims(splitRenderedSummary(r), r.territories, r.brand ? [r.brand.label] : []).length === 0).length;
  const intentRuns = runs.filter((r) => r.expect?.intent !== undefined);
  const brandRuns = runs.filter((r) => r.expect?.brandId !== undefined && r.response.status !== "NEEDS_INPUT");
  const dedupRuns = runs.filter((r) => r.expect?.dedupVerdicts || r.expect?.modelDedupApplied !== undefined);
  const generalization = runs.filter((r) => r.expect?.generalization);
  const costs = responses.map((r) => r.metrics.model_cost_usd).filter((c): c is number => c !== null);
  return {
    runs: runs.length,
    runs_passed: runs.filter((r) => (r.failures ?? []).length === 0).length,
    intentAccuracy: ratio(intentRuns.filter((r) => r.response.trace.intent === r.expect!.intent).length, intentRuns.length),
    validActionRateFirstAttempt: ratio(turns.filter((t) => t.firstAttemptValid).length, turns.length),
    validActionRateAfterRepair: ratio(turns.filter((t) => t.decisions.some((d) => d.accepted)).length, turns.length),
    toolArgumentValidity: ratio(calls.filter((d) => !d.rejection?.startsWith("INVALID_ARGUMENTS")).length, calls.length),
    toolSelectionAccuracy: ratio(calls.filter((d) => !SELECTION_ERRORS.has(d.rejection?.split(":")[0] ?? "")).length, calls.length),
    entityResolutionSuccess: ratio(brandRuns.filter((r) => (r.response as AgentAnalysisResult).brand?.id === r.expect!.brandId).length, brandRuns.length),
    territoryResolutionSuccess: ratio(territories.filter((t) => t.resolvedConcept !== null).length, territories.length),
    representationSuccess: ratio(territories.filter((t) => t.representation.exemplars.length > 0).length, territories.filter((t) => t.resolvedConcept !== null).length),
    representationQualityAcceptRate: ratio(decisions.filter((d) => d.final !== "REJECT").length, decisions.length),
    semanticMismatchRate: ratio(withModel.filter((d) => d.modelAssessment!.relevance === "MISMATCH" || d.modelAssessment!.relevance === "WEAK").length, withModel.length),
    candidateDedupSuccess: ratio(dedupRuns.filter((r) => !(r.failures ?? []).some((f) => /dedup/u.test(f))).length, dedupRuns.length),
    analysisRouteAccuracy: expectRate((e) => e.routes, (r, k) => r.territories.find((t) => t.key === k)?.analysisRoute),
    evidenceSufficiencyAccuracy: ratio(runs.filter((r) => r.expect?.finalSufficiency && r.response.status !== "NEEDS_INPUT" && (r.response as AgentAnalysisResult).finalSufficiency === r.expect.finalSufficiency).length, runs.filter((r) => r.expect?.finalSufficiency).length),
    methodologyConsistency: ratio(analyses.filter(methodologyConsistent).length, analyses.length),
    claimConsistency: ratio(claimConsistent, analyses.length),
    budgetViolations: responses.filter((r) => r.metrics.qloo_calls > (r.trace.limits.maxQlooCalls ?? Infinity) || r.metrics.agent_iterations > (r.trace.limits.maxAgentIterations ?? Infinity)).length,
    benchmarkLeakage: leakPattern ? runs.filter((r) => leakedNames(r.contexts ?? [], benchmarkNames()).length > 0).length : null,
    benchmarkLeakNames: leakPattern ? [...new Set(runs.flatMap((r) => leakedNames(r.contexts ?? [], benchmarkNames())))].join(", ") || "none" : null,
    generalizationSuccess: generalization.length ? `${generalization.filter((r) => (r.failures ?? []).length === 0).length}/${generalization.length}` : null,
    fullAnalysisRate: ratio(territories.filter((t) => t.analysisRoute === "FULL_RELATIVE_ANALYSIS").length, territories.length),
    unsupportedRate: ratio(territories.filter((t) => t.analysisRoute === "INSUFFICIENT_EVIDENCE").length, territories.length),
    averageIterations: ratio(responses.reduce((n, r) => n + r.metrics.agent_iterations, 0), responses.length),
    averageQlooCalls: ratio(responses.reduce((n, r) => n + r.metrics.qloo_calls, 0), responses.length),
    callsAvoided: responses.reduce((n, r) => n + r.metrics.calls_avoided, 0),
    repairs: responses.reduce((n, r) => n + r.metrics.repairs, 0),
    unknownToolAttempts: responses.reduce((n, r) => n + r.metrics.unknown_tool_attempts, 0),
    invalidArgumentAttempts: responses.reduce((n, r) => n + r.metrics.invalid_argument_attempts, 0),
    unsupportedStateActions: responses.reduce((n, r) => n + r.metrics.unsupported_state_actions, 0),
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    modelInputTokens: responses.reduce((n, r) => n + r.metrics.model_input_tokens, 0),
    modelOutputTokens: responses.reduce((n, r) => n + r.metrics.model_output_tokens, 0),
    modelCostUsd: costs.length ? Math.round(costs.reduce((a, b) => a + b, 0) * 10_000) / 10_000 : null,
  };
}

export type SkillAggregate = { skillId: string; version: number; runs: number; successRate: number | null; metrics: Record<string, number | string | null> };

/** Skill-level evaluation: SkillEvalOutcome per run, aggregated per skill version. */
export function aggregateSkills(analyses: readonly AgentAnalysisResult[]): SkillAggregate[] {
  const byKey = new Map<string, SkillEvalOutcome[]>();
  for (const r of analyses) for (const o of skillOutcomes(r)) byKey.set(`${o.skillId}@${o.version}`, [...(byKey.get(`${o.skillId}@${o.version}`) ?? []), o]);
  return [...byKey.values()].map((outcomes) => {
    const metrics: Record<string, number | string | null> = {};
    const keys = [...new Set(outcomes.flatMap((o) => Object.keys(o.metrics)))];
    for (const k of keys) {
      const nums = outcomes.map((o) => o.metrics[k]).filter((v): v is number => typeof v === "number");
      metrics[k] = nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1000) / 1000 : null;
    }
    return { skillId: outcomes[0]!.skillId, version: outcomes[0]!.version, runs: outcomes.length, successRate: ratio(outcomes.filter((o) => o.success).length, outcomes.length), metrics };
  });
}

/** Primary taxonomy category of a FAILED eval case, from what its expectations caught (evaluator-side). */
export function expectationFailureCategory(failures: readonly string[], response: AgentRunResponse): AgentFailureCategory {
  const text = failures.join(" | ");
  if (/BUDGET VIOLATION/u.test(text)) return "BUDGET_EXHAUSTED";
  if (/benchmark label|expected_(strong|mid|weak)/u.test(text)) return "BENCHMARK_LABEL_ERROR";
  if (/brand/u.test(text)) return "ENTITY_RESOLUTION_ERROR";
  if (/concept|should not be an in-scope/u.test(text)) return "TERRITORY_RESOLUTION_ERROR";
  if (/dedup|DUPLICATE_TERRITORY/u.test(text)) return "CONCEPT_DUPLICATION_ERROR";
  if (/quality|SEMANTIC|primary exemplar/u.test(text)) return "EXEMPLAR_SEMANTIC_ERROR";
  if (/exemplar|strategy/u.test(text)) return "REPRESENTATION_ERROR";
  if (/route|class|robustness/u.test(text)) return "ANALYSIS_ROUTE_ERROR";
  if (/finalSufficiency/u.test(text)) return "EVIDENCE_SUFFICIENCY_ERROR";
  if (/methodology/u.test(text)) return "METHODOLOGY_ERROR";
  if (/claim|summary/u.test(text)) return "CLAIM_VALIDATION_ERROR";
  if (/tool|rejection/u.test(text)) return "TOOL_SELECTION_ERROR";
  return (response.status !== "NEEDS_INPUT" && (response as AgentAnalysisResult).failureCategory) || "MODEL_DECISION_ERROR";
}

/**
 * Benchmark names a run's model contexts contain WITHOUT Qloo having returned them in that run. Live Qloo can
 * legitimately return a benchmark brand as evidence (e.g. as a related entity); that is evidence, not
 * leakage, and neither is a name the user typed in the request. Expected labels (expected_*) are always leakage.
 */
export function leakedNames(contexts: readonly AgentDecisionContext[], names: readonly string[]): string[] {
  const text = JSON.stringify(contexts);
  // Text that legitimately carries names: what Qloo returned, and what the user asked (a user may name any brand).
  const qlooText = JSON.stringify(contexts.map((c) => [c.lastTurn, c.evidence, c.territories, c.brand, c.userQuery, c.requestFields])).toLowerCase();
  const out: string[] = [];
  const labels = text.match(/expected_(strong|mid|weak)/u);
  if (labels) out.push(labels[0]);
  for (const name of names) {
    const re = new RegExp(`(^|[^\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}([^\\p{L}]|$)`, "iu");
    if (re.test(text) && !qlooText.includes(name.toLowerCase())) out.push(name);
  }
  return out;
}

export function leakPatternFor(names: readonly string[]): RegExp {
  return new RegExp(`expected_(strong|mid|weak)|(^|[^\\p{L}])(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|")})([^\\p{L}]|$)`, "iu");
}

export async function runAgentEval(): Promise<AgentEvalReport> {
  const doc = JSON.parse(readFileSync(SCENARIOS_PATH, "utf8")) as { fixtureType: string; scenarios: Scenario[] };
  if (doc.fixtureType !== "synthetic") throw new Error("agent scenarios must be labelled synthetic");
  const results: ScenarioResult[] = [];
  for (const s of doc.scenarios) results.push(await runScenario(s));

  const leakPattern = leakPatternFor(benchmarkNames());
  const evaluated = (policy: Scenario["policy"]): EvaluatedRun[] =>
    results.filter((r) => doc.scenarios.find((s) => s.id === r.id)!.policy === policy).map((r) => ({ id: r.id, response: r.response, expect: doc.scenarios.find((s) => s.id === r.id)!.expect, failures: r.failures, contexts: r.contexts }));
  const byPolicy: AgentEvalReport["byPolicy"] = { SCRIPTED: competenceMetrics(evaluated("scripted"), leakPattern), BASELINE: competenceMetrics(evaluated("baseline"), leakPattern) };
  const analyses = results.map((r) => r.response).filter((r): r is AgentAnalysisResult => r.status !== "NEEDS_INPUT");
  const leaks = results.filter((r) => leakPattern.test(JSON.stringify(r.contexts))).map((r) => r.id);
  const budgetViolations = results.filter((r) => r.failures.some((f) => f.startsWith("BUDGET VIOLATION"))).length;
  const baselineDecisions = results.filter((r) => r.response.model.kind === "baseline").flatMap((r) => r.response.trace.turns.flatMap((t) => t.decisions.filter((d) => d.action === "call_tool")));
  const all = [...evaluated("scripted"), ...evaluated("baseline")];
  const pooled = competenceMetrics(all, leakPattern);
  const skillEvalIds = new SkillRegistry().list().flatMap((s) => s.evalIds.map((id) => ({ skill: s.id, id })));
  const missingEvalIds = skillEvalIds.filter((x) => !doc.scenarios.some((s) => s.id === x.id));
  const evaluatorFailed = evaluatorFailures(results);
  const runCategories: Record<string, number> = {};
  for (const r of analyses) if (r.failureCategory) runCategories[r.failureCategory] = (runCategories[r.failureCategory] ?? 0) + 1;

  const metrics: AgentEvalReport["metrics"] = {
    scenarios: results.length,
    scenarios_passed: results.filter((r) => r.passed).length,
    intent_routing_accuracy: pooled.intentAccuracy!,
    valid_tool_call_rate_baseline: ratio(baselineDecisions.filter((d) => d.accepted).length, baselineDecisions.length),
    methodology_consistency: pooled.methodologyConsistency!,
    final_claim_consistency: pooled.claimConsistency!,
    budget_violations: budgetViolations,
    benchmark_leakage: leaks.length,
    skill_eval_ids_missing: missingEvalIds.length,
    runtime_evaluator_failures: evaluatorFailed.length,
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
    threshold("every skill evalId names a scenario", missingEvalIds.length, "= 0", missingEvalIds.length === 0),
    // Sprint 5A.1 targeted runtime evaluators (run-evaluators.ts), over every scenario run.
    threshold(`runtime evaluator failures (${RUN_EVALUATORS_VERSION})`, evaluatorFailed.length, "= 0", evaluatorFailed.length === 0),
  ];
  return {
    scenarios: results,
    byPolicy,
    metrics,
    context: { ...contextStats(results.flatMap((r) => r.contexts)), sprint3Set: (({ sprint3Reference: _r, ...rest }) => rest)(contextStats(results.filter((r) => SPRINT3_SCENARIO_IDS.includes(r.id)).flatMap((r) => r.contexts))) },
    skills: aggregateSkills(analyses),
    failureTaxonomy: { runCategories, failedScenarios: results.filter((r) => !r.passed).map((r) => ({ id: r.id, category: expectationFailureCategory(r.failures, r.response) })) },
    runtimeEvaluatorFailures: evaluatorFailed,
    thresholds,
    passed: thresholds.every((t) => t.passed),
    liveModel: hasModelCredential() ? "model credential present (eval:agent itself runs scripted/baseline only; see eval:agent:live)" : LIVE_AGENT_MODEL_VALIDATION_NOT_RUN,
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
  lines.push("", "Gate metrics");
  for (const [k, v] of Object.entries(report.metrics)) lines.push(`  ${k.padEnd(32)} ${v ?? "n/a"}`);
  for (const [policy, m] of Object.entries(report.byPolicy)) {
    lines.push("", `Competence metrics — ${policy} (${policy === "SCRIPTED" ? "ScriptedAgentModel test scripts" : "deterministic baseline reference policy"}; not a live model)`);
    for (const [k, v] of Object.entries(m!)) lines.push(`  ${k.padEnd(32)} ${v ?? "n/a"}`);
  }
  const c = report.context;
  lines.push("", "Decision context (just-in-time)", `  turns ${c.turns} · avg ${c.avgChars} chars (~${c.avgTokensEstimate} tokens est.) · max ${c.maxChars} · avg tools exposed ${c.avgToolsExposed}`);
  if (c.sprint3Set) lines.push(`  same 28 Sprint 3 scenarios now: turns ${c.sprint3Set.turns} · avg ${c.sprint3Set.avgChars} chars · max ${c.sprint3Set.maxChars} · avg tools exposed ${c.sprint3Set.avgToolsExposed}`);
  lines.push(`  Sprint 3 reference (28 scenarios at d7c67a9): avg ${c.sprint3Reference.avgChars} chars · max ${c.sprint3Reference.maxChars} · avg tools exposed ${c.sprint3Reference.avgToolsExposed}`);
  lines.push("", "Skill-level evaluation (per skill version, all synthetic runs)");
  for (const s of report.skills) lines.push(`  ${`${s.skillId} v${s.version}`.padEnd(36)} runs ${String(s.runs).padEnd(3)} success ${s.successRate ?? "n/a"}  ${Object.entries(s.metrics).map(([k, v]) => `${k}=${v ?? "n/a"}`).join(" ")}`);
  lines.push("", "Failure taxonomy");
  lines.push(`  run categories (deliberately failing scenarios included): ${Object.entries(report.failureTaxonomy.runCategories).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);
  lines.push(`  failed eval cases: ${report.failureTaxonomy.failedScenarios.map((f) => `${f.id} → ${f.category}`).join(", ") || "none"}`);
  for (const f of report.runtimeEvaluatorFailures) lines.push(`  runtime evaluator ✗ ${f}`);
  lines.push("", "Acceptance thresholds");
  for (const t of report.thresholds) lines.push(`  [${t.passed ? "PASS" : "FAIL"}] ${t.name}: ${t.value ?? "n/a"} (required ${t.required})`);
  lines.push("", `Live/model status: ${report.liveModel}`, `RESULT: ${report.passed ? "PASS" : "FAIL"}`);
  return lines.join("\n");
}
