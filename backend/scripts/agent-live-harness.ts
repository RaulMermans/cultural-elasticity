/**
 * `pnpm eval:agent:live` harness: the LIVE agent evaluation set (evals/agent/live-cases.json) against the
 * live Qloo hackathon API, in separate arms:
 *
 *   BASELINE    the deterministic baseline reference policy (no model) — the comparison arm
 *   LIVE_MODEL  the real AnthropicAgentModel — runs ONLY when ANTHROPIC_API_KEY is configured; otherwise
 *               the arm is reported as LIVE_AGENT_MODEL_VALIDATION_NOT_RUN (never substituted)
 *
 * Numbers are never merged across arms. The AGENT_MODEL_READY gate is computed from the LIVE_MODEL arm only
 * (hard requirements) and compared with the BASELINE arm (quality). Optional modes:
 *   --stability N   repeat each frontier case N times in the model arm (candidate-set stability)
 *   --benchmark     run benchmark brands through the agent (compare over the benchmark territory set) and
 *                   evaluate labels AFTER the run (labels never reach the runtime or a model)
 *
 * Direction is eval → product: this script imports the runtime; nothing in the runtime imports it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentAnalysisResult, AgentRunResponse } from "@cultural-elasticity/shared";
import { validateClaims } from "../src/agent/claim-validator.js";
import { defaultLimits } from "../src/agent/contracts.js";
import { hasModelCredential, LIVE_AGENT_MODEL_VALIDATION_NOT_RUN } from "../src/agent/factory.js";
import { frontierStability, type FrontierStability } from "../src/agent/frontier.js";
import type { AgentDecisionContext, AgentModel } from "../src/agent/model/provider.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { AGENT_ALLOWED_PERMISSIONS } from "../src/agent/tool-executor.js";
import { INTERNAL_TOOL_NAMES } from "../src/agent/tool-registry.js";
import type { AgentToolProvider } from "../src/agent/tool-provider.js";
import { benchmarkSchema, pairwiseAssertions, type Benchmark } from "./benchmark/benchmark.js";
import { scrubSecrets } from "../src/qloo/transport.js";
import { benchmarkNames, competenceMetrics, leakPatternFor, methodologyConsistent, type CompetenceMetrics, type EvaluatedRun } from "./agent-eval-harness.js";
import { ELASTICITY_CAPTURE } from "./capture/elasticity-config.js";
import { descriptorConcept, incidentalConcept } from "../src/agent/semantic-comparison.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const LIVE_CASES_PATH = join(ROOT, "evals/agent/live-cases.json");
const BENCHMARK_PATH = join(ROOT, "evals/benchmarks/cultural-elasticity-v0/benchmark.json");

export type LiveCase = {
  id: string;
  intent: string;
  tags: string[];
  request: { userQuery: string; brand?: string; territories?: string[] };
  answer?: "first_brand_option";
  expect: { status?: string; needsInput?: boolean; insufficient?: string[]; degraded?: string[] };
};

export type Arm = "BASELINE" | "LIVE_MODEL";

export type LiveRun = EvaluatedRun & { caseId: string; arm: Arm; askedUser: boolean; continued: boolean; error?: string };

/** Records every decision context a model sees (leakage and secret checks). */
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

export function loadLiveCases(): LiveCase[] {
  return loadLiveManifest().cases;
}

export function loadLiveManifest(): { version: string; cases: LiveCase[] } {
  const doc = JSON.parse(readFileSync(LIVE_CASES_PATH, "utf8")) as { fixtureType: string; version: string; cases: LiveCase[] };
  if (doc.fixtureType !== "live-case-set") throw new Error("live-cases.json must be a live-case-set");
  return { version: doc.version, cases: doc.cases };
}

/** Structural expectations, checked by the evaluator after the run. */
export function checkLive(c: LiveCase, response: AgentRunResponse, askedUser: boolean): string[] {
  const f: string[] = [];
  if (c.expect.needsInput && !askedUser) f.push("expected the run to ask the user (ambiguity), but it did not");
  if (c.expect.status && response.status !== c.expect.status) f.push(`status ${response.status}, expected ${c.expect.status}`);
  if (response.status !== "NEEDS_INPUT") {
    const r = response as AgentAnalysisResult;
    for (const key of c.expect.insufficient ?? []) {
      const t = r.territories.find((x) => x.key === key);
      if (t && t.analysisRoute !== "INSUFFICIENT_EVIDENCE") f.push(`${key} should degrade to INSUFFICIENT_EVIDENCE (got ${t.analysisRoute})`);
      if (t && (t.relativePosition !== null || t.classification !== null)) f.push(`${key}: unsupported territory carries a position or class`);
    }
    // Graceful degradation: any route short of FULL, and never a position or class.
    for (const key of c.expect.degraded ?? []) {
      const t = r.territories.find((x) => x.key === key);
      if (!t) f.push(`${key} missing from the result (an unsupported territory must still be reported)`);
      else if (t.analysisRoute === "FULL_RELATIVE_ANALYSIS" || t.relativePosition !== null || t.classification !== null) f.push(`${key} should degrade (got ${t.analysisRoute})`);
    }
    if (r.metrics.qloo_calls > (r.trace.limits.maxQlooCalls ?? Infinity)) f.push("BUDGET VIOLATION: Qloo calls");
    if (r.metrics.agent_iterations > (r.trace.limits.maxAgentIterations ?? Infinity)) f.push("BUDGET VIOLATION: iterations");
  }
  return f;
}

export async function runLiveCase(c: LiveCase, arm: Arm, model: AgentModel, provider: AgentToolProvider): Promise<LiveRun> {
  const recording = new Recording(model);
  const runtime = new AgentRuntime({ model: recording, provider });
  let response = await runtime.run(c.request, defaultLimits(c.intent as never));
  let askedUser = false;
  let continued = false;
  if (response.status === "NEEDS_INPUT") {
    askedUser = true;
    const option = response.options.find((o) => (o.type ?? "").includes("brand")) ?? response.options[0];
    if (c.answer === "first_brand_option" && option) {
      response = await runtime.continue(response.runId, option.id);
      continued = true;
    }
  }
  return { id: c.id, caseId: c.id, arm, response, failures: checkLive(c, response, askedUser), contexts: recording.contexts, askedUser, continued };
}

// ---- AGENT_MODEL_READY gate (Sprint 5A: coverage-complete, single-model, case-matched) ----

export type GateCheck = { name: string; value: number | string | null; required: string; passed: boolean };
export type CaseError = { caseId: string; arm: Arm; error: string };
export type Coverage = { expected: number; executed: number; missing: string[]; errored: string[]; failed: string[]; complete: boolean };
export type StabilityStatus = "MEASURED" | "NOT_MEASURED" | "INCOMPLETE";

export type ReadinessDecision = {
  decision: "AGENT_MODEL_READY" | "AGENT_MODEL_NOT_READY";
  modelId: string | null;
  modelIds: string[];
  caseManifestVersion: string | null;
  expectedCaseIds: string[];
  executedCaseIds: string[];
  missingCaseIds: string[];
  failedCaseIds: string[];
  erroredCaseIds: string[];
  baselineCoverage: Coverage | null;
  modelCoverage: Coverage | null;
  frontierStabilityStatus: StabilityStatus;
  hard: GateCheck[];
  quality: { metric: string; model: number | string | null; baseline: number | string | null; worse: boolean }[];
  /** Semantic validity (evaluator-side proxy), kept apart from structural checks. */
  semantic: SemanticGrade | null;
  reasons: string[];
  warnings: string[];
};

/** The production model readiness is judged on (Sprint 5A model decision). */
export const READINESS_MODEL_ID = "claude-haiku-5-5";
export const REQUIRED_STABILITY_RUNS = 3;

export type GateInput = {
  manifest: { version: string; caseIds: string[]; frontierCaseIds: string[] };
  modelRuns: readonly LiveRun[] | null;
  baselineRuns: readonly LiveRun[] | null;
  /** Baseline metrics reused from an earlier report (only with the case ids it covered). */
  baselineReused?: { metrics: CompetenceMetrics; caseIds: string[] } | null;
  errors?: readonly CaseError[];
  stability?: Record<string, { runs: number }> | null;
  expectedModelId?: string;
  requiredStabilityRuns?: number;
};

const SECRET_PATTERN = /sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9]{20,}|ANTHROPIC_API_KEY=|QLOO_API_KEY=/u;

/** Tools that ran although no active skill exposed them, or with a permission agents may not use. */
export function permissionViolations(r: AgentRunResponse): number {
  return r.trace.toolCalls.filter((c) => c.status !== "rejected" && !(INTERNAL_TOOL_NAMES as readonly string[]).includes(c.tool) && c.iteration > 0 && (!AGENT_ALLOWED_PERMISSIONS.includes(c.permission) || c.skill === null)).length;
}

/** Model-written synthesis whose text the claim validator rejects would be an accepted unsupported claim. */
export function acceptedUnsupportedClaims(r: AgentRunResponse): number {
  if (r.status === "NEEDS_INPUT") return 0;
  const a = r as AgentAnalysisResult;
  return validateClaims({ summary: a.summary.text, territoryNotes: [], followUpOptions: a.followUpOptions }, a.territories, a.brand ? [a.brand.label] : []).length;
}

const num = (v: number | string | null | undefined) => (typeof v === "number" ? v : null);

export function coverage(expected: readonly string[], runs: readonly LiveRun[] | null, errors: readonly CaseError[], arm: Arm): Coverage {
  const executed = new Set((runs ?? []).filter((r) => !r.error).map((r) => r.caseId));
  const errored = [...new Set([...errors.filter((e) => e.arm === arm).map((e) => e.caseId), ...(runs ?? []).filter((r) => r.error).map((r) => r.caseId)])].filter((id) => expected.includes(id));
  const missing = expected.filter((id) => !executed.has(id) && !errored.includes(id));
  const failed = (runs ?? []).filter((r) => expected.includes(r.caseId) && (r.failures ?? []).length > 0).map((r) => r.caseId);
  return { expected: expected.length, executed: [...executed].filter((id) => expected.includes(id)).length, missing, errored, failed, complete: missing.length === 0 && errored.length === 0 };
}

export function readinessGate(input: GateInput): ReadinessDecision {
  const expected = input.manifest.caseIds;
  const errors = input.errors ?? [];
  const expectedModel = input.expectedModelId ?? READINESS_MODEL_ID;
  const requiredRuns = input.requiredStabilityRuns ?? REQUIRED_STABILITY_RUNS;
  const base: Omit<ReadinessDecision, "decision" | "hard" | "quality" | "semantic" | "reasons" | "warnings" | "frontierStabilityStatus"> = {
    modelId: null,
    modelIds: [],
    caseManifestVersion: input.manifest.version,
    expectedCaseIds: [...expected],
    executedCaseIds: [],
    missingCaseIds: [...expected],
    failedCaseIds: [],
    erroredCaseIds: [],
    baselineCoverage: input.baselineRuns ? coverage(expected, input.baselineRuns, errors, "BASELINE") : input.baselineReused ? { expected: expected.length, executed: input.baselineReused.caseIds.filter((id) => expected.includes(id)).length, missing: expected.filter((id) => !input.baselineReused!.caseIds.includes(id)), errored: [], failed: [], complete: expected.every((id) => input.baselineReused!.caseIds.includes(id)) } : null,
    modelCoverage: null,
  };
  if (!input.modelRuns) {
    return { ...base, decision: "AGENT_MODEL_NOT_READY", frontierStabilityStatus: "NOT_MEASURED", hard: [], quality: [], semantic: null, reasons: [`${LIVE_AGENT_MODEL_VALIDATION_NOT_RUN}: the live model was never exercised; readiness cannot be established from scripted or baseline runs`], warnings: [] };
  }
  const modelRuns = input.modelRuns.filter((r) => expected.includes(r.caseId));
  const modelCoverage = coverage(expected, modelRuns, errors, "LIVE_MODEL");
  const responses = modelRuns.filter((r) => !r.error).map((r) => r.response);
  const analyses = responses.filter((r): r is AgentAnalysisResult => r.status !== "NEEDS_INPUT");
  const modelIds = [...new Set(responses.map((r) => r.model.id))];
  const modelMetrics = armMetrics(modelRuns.filter((r) => !r.error));
  const baselineMetrics = input.baselineRuns ? armMetrics(input.baselineRuns.filter((r) => !r.error && expected.includes(r.caseId))) : (input.baselineReused?.metrics ?? null);
  const stabilityMeasured = input.manifest.frontierCaseIds.filter((id) => (input.stability?.[id]?.runs ?? 0) >= requiredRuns);
  const frontierStabilityStatus: StabilityStatus = stabilityMeasured.length === input.manifest.frontierCaseIds.length ? "MEASURED" : stabilityMeasured.length > 0 || input.stability ? "INCOMPLETE" : "NOT_MEASURED";
  const semantic = semanticGrade(analyses);
  const secretLeaks = modelRuns.filter((r) => SECRET_PATTERN.test(JSON.stringify(r.response)) || SECRET_PATTERN.test(JSON.stringify(r.contexts ?? [])) || scrubSecrets(JSON.stringify(r.response)) !== JSON.stringify(r.response)).length;
  const check = (name: string, value: number | string | null, required: string, passed: boolean): GateCheck => ({ name, value, required, passed });
  const hard = [
    check("prescribed cases executed by the model (errors and omissions count as incomplete)", `${modelCoverage.executed}/${expected.length}`, `= ${expected.length}/${expected.length}`, modelCoverage.complete),
    check("every model run attributed to the readiness model", modelIds.join(", ") || "none", `= ${expectedModel}`, modelIds.length === 1 && modelIds[0] === expectedModel),
    check("case-matched baseline coverage", base.baselineCoverage ? `${base.baselineCoverage.executed}/${expected.length}` : "none", `= ${expected.length}/${expected.length}`, base.baselineCoverage?.complete === true),
    check(`frontier stability measured (≥ ${requiredRuns} runs per frontier case)`, frontierStabilityStatus, "= MEASURED", frontierStabilityStatus === "MEASURED"),
    check("permission violations", responses.reduce((n, r) => n + permissionViolations(r), 0), "= 0", responses.every((r) => permissionViolations(r) === 0)),
    check("benchmark leakage", num(modelMetrics.benchmarkLeakage), "= 0", modelMetrics.benchmarkLeakage === 0),
    check("deterministic-methodology overrides", analyses.filter((r) => !methodologyConsistent(r)).length, "= 0", analyses.every(methodologyConsistent)),
    check("accepted unsupported numerical/claim violations", responses.reduce((n, r) => n + acceptedUnsupportedClaims(r), 0), "= 0", responses.every((r) => acceptedUnsupportedClaims(r) === 0)),
    check("semantically invalid FULL results accepted", semantic.invalidFull, "= 0", semantic.invalidFull === 0),
    check("secret leakage", secretLeaks, "= 0", secretLeaks === 0),
    check("claim consistency after bounded repair", num(modelMetrics.claimConsistency), "= 1", modelMetrics.claimConsistency === 1 || analyses.length === 0),
    check("methodology consistency", num(modelMetrics.methodologyConsistency), "= 1", modelMetrics.methodologyConsistency === 1 || analyses.length === 0),
    check("budget violations", num(modelMetrics.budgetViolations), "= 0", modelMetrics.budgetViolations === 0),
  ];
  // Quality versus the baseline arm: reported separately; a material regression makes the model NOT READY.
  const higherIsBetter = ["runs_passed", "validActionRateFirstAttempt", "validActionRateAfterRepair", "toolSelectionAccuracy", "territoryResolutionSuccess", "representationSuccess", "representationQualityAcceptRate", "semanticallyValidFullRate", "meaningfulPartialRate", "fullAnalysisRate"];
  const lowerIsBetter = ["averageQlooCalls", "averageIterations", "p50LatencyMs", "unsupportedRate", "invalidFullComparisonRate"];
  // fullAnalysisRate alone is not a competence measure (Sprint 4: some baseline FULL results were meaningless), so
  // it carries no regression threshold; the semantic rates do.
  const MATERIAL: Record<string, number> = { runs_passed: 1, territoryResolutionSuccess: 0.15, representationSuccess: 0.15, validActionRateAfterRepair: 0.1, meaningfulPartialRate: 0.25 };
  const quality = [...higherIsBetter, ...lowerIsBetter].map((metric) => {
    const m = num(modelMetrics[metric]);
    const b = num(baselineMetrics?.[metric]);
    const threshold = MATERIAL[metric];
    const worse = m !== null && b !== null && threshold !== undefined && (higherIsBetter.includes(metric) ? b - m >= threshold : m - b >= threshold);
    return { metric, model: modelMetrics[metric] ?? null, baseline: baselineMetrics?.[metric] ?? null, worse };
  });
  const reasons = [
    ...hard.filter((h) => !h.passed).map((h) => `hard requirement failed: ${h.name} = ${h.value} (required ${h.required})`),
    ...(modelCoverage.complete ? [] : [`INCOMPLETE_LIVE_EVALUATION: missing ${modelCoverage.missing.join(", ") || "none"}; errored ${modelCoverage.errored.join(", ") || "none"}`]),
    ...quality.filter((q) => q.worse).map((q) => `material regression vs baseline: ${q.metric} model ${q.model} vs baseline ${q.baseline}`),
    ...(modelCoverage.failed.length > 0 ? [`structural case expectations failed: ${modelCoverage.failed.join(", ")}`] : []),
    ...(semantic.invalidFull > 0 ? [`SEMANTIC_QUALITY_NOT_READY: ${semantic.invalidFull} FULL result(s) rest on semantically invalid comparison sets`] : []),
  ];
  const warnings = [
    ...(semantic.full === 0 ? ["no FULL relative analysis was produced by the model arm; semantic validity of FULL results is untested"] : []),
    ...(frontierStabilityStatus !== "MEASURED" ? [`frontier stability ${frontierStabilityStatus}`] : []),
  ];
  return { ...base, decision: reasons.length === 0 ? "AGENT_MODEL_READY" : "AGENT_MODEL_NOT_READY", modelId: modelIds.length === 1 ? modelIds[0]! : null, modelIds, executedCaseIds: modelRuns.filter((r) => !r.error).map((r) => r.caseId), missingCaseIds: modelCoverage.missing, failedCaseIds: modelCoverage.failed, erroredCaseIds: modelCoverage.errored, modelCoverage, frontierStabilityStatus, hard, quality, semantic, reasons, warnings };
}

// ---- Sprint 5A: semantic grading of results (evaluator-side proxy) ----

export type SemanticGrade = { territories: number; full: number; validFull: number; invalidFull: number; partial: number; meaningfulPartial: number; unsupported: number; invalidExamples: string[] };

/**
 * Rule-based PROXY for cultural validity, applied by the evaluator to finished results (not human judgment).
 * A FULL result is invalid when its comparison set contains a reference whose concept is a venue-listing attribute,
 * an operational tag or a descriptor, or whose only recorded Qloo tie is one target-exemplar profile, or when the
 * runtime's own semantic assessment did not accept the set. A PARTIAL result is meaningful when it rests on a
 * Qloo concept, ≥ 1 VALID exemplar and available shared-signal (coherence) evidence. Uses evidence the result
 * carries, so it also grades Sprint 4 results produced before the validator existed.
 */
export function semanticGrade(analyses: readonly AgentAnalysisResult[]): SemanticGrade {
  const g: SemanticGrade = { territories: 0, full: 0, validFull: 0, invalidFull: 0, partial: 0, meaningfulPartial: 0, unsupported: 0, invalidExamples: [] };
  for (const r of analyses) {
    const proposed = new Map(r.comparisonSetConstruction.proposed.map((p) => [p.key, p]));
    for (const t of r.territories.filter((x) => x.role !== "reference")) {
      g.territories += 1;
      if (t.analysisRoute === "INSUFFICIENT_EVIDENCE") g.unsupported += 1;
      if (t.analysisRoute === "PARTIAL_CULTURAL_ANALYSIS") {
        g.partial += 1;
        if (t.resolvedConcept && t.representation.exemplars.some((e) => e.quality !== "WEAK") && t.capabilities.coherence === "AVAILABLE") g.meaningfulPartial += 1;
      }
      if (t.analysisRoute !== "FULL_RELATIVE_ANALYSIS" || !t.comparisonSet) continue;
      g.full += 1;
      const problems: string[] = [];
      for (const key of t.comparisonSet.territoryKeys) {
        const member = r.territories.find((x) => x.key === key);
        if (!member || member.role !== "reference" || !member.resolvedConcept) continue;
        const id = member.resolvedConcept.id;
        if (incidentalConcept(id)) problems.push(`${member.label}: ${incidentalConcept(id)!.explanation}`);
        else if (descriptorConcept(id)) problems.push(`${member.label}: ${descriptorConcept(id)}`);
        else if (/carried by 1 target exemplar profile/u.test(proposed.get(key)?.evidence ?? "") && !/brand's own Qloo profile/u.test(proposed.get(key)?.evidence ?? "")) problems.push(`${member.label}: only one target-exemplar profile ties it to the question`);
      }
      const assessed = (r.comparisonSetConstruction.semanticAssessments ?? []).find((a) => a.memberTerritoryKeys.includes(t.key) && a.usedForFull);
      if (r.comparisonSetConstruction.semanticAssessments && !assessed) problems.push("the runtime's semantic assessment did not accept this set");
      if (problems.length > 0) {
        g.invalidFull += 1;
        if (g.invalidExamples.length < 6) g.invalidExamples.push(`${r.brand?.label ?? "?"} → ${t.label}: ${problems.join("; ")}`);
      } else g.validFull += 1;
    }
  }
  return g;
}

// ---- Benchmark through the agent (labels used only here, after the run) ----

export type BenchmarkAgentCase = {
  brandKey: string;
  status: string;
  assertions: { higher: string; lower: string; outcome: "correct" | "wrong" | "not_comparable"; category?: string; detail: string }[];
};

export function loadBenchmark(): Benchmark {
  return benchmarkSchema.parse(JSON.parse(readFileSync(BENCHMARK_PATH, "utf8")));
}

/** Territory labels for the benchmark territory ids (a user would type these words). */
export function benchmarkTerritoryLabels(): Record<string, string> {
  return Object.fromEntries(ELASTICITY_CAPTURE.territories.map((t) => [t.id, t.label]));
}

/**
 * Evaluates one agent run on a benchmark brand AFTER it finished. Failure classes:
 *   AGENT_ERROR            the agent left a resolvable territory unresolved / unrepresented
 *   QLOO_DATA_LIMIT        Qloo had no concept or no members for it
 *   REPRESENTATION_ERROR   both measured, but robustness LOW/INSUFFICIENT or weak exemplars involved
 *   METHODOLOGY_ERROR      both measured robustly in one set and ordered against the label; while
 *                          labels are not owner-reviewed this is reported as METHODOLOGY_ERROR|BENCHMARK_LABEL_ERROR
 */
export function evaluateBenchmarkRun(benchmark: Benchmark, brandKey: string, response: AgentRunResponse): BenchmarkAgentCase {
  const labels = benchmarkTerritoryLabels();
  const reviewed = (benchmark as Benchmark & { ownerReview?: { owner_reviewed: boolean } }).ownerReview?.owner_reviewed === true;
  const out: BenchmarkAgentCase = { brandKey, status: response.status, assertions: [] };
  if (response.status === "NEEDS_INPUT") return out;
  const r = response as AgentAnalysisResult;
  const byLabel = (id: string) => r.territories.find((t) => t.label.toLowerCase() === (labels[id] ?? id).toLowerCase());
  for (const a of pairwiseAssertions(benchmark).filter((x) => x.brandKey === brandKey)) {
    const hi = byLabel(a.higher);
    const lo = byLabel(a.lower);
    const sameSet = hi?.comparisonSet && lo?.comparisonSet && hi.comparisonSet.territoryKeys.join() === lo.comparisonSet.territoryKeys.join();
    if (!hi || !lo || !sameSet || hi.relativePosition?.position == null || lo.relativePosition?.position == null) {
      const missing = [hi, lo].find((t) => !t || t.analysisRoute !== "FULL_RELATIVE_ANALYSIS");
      // QLOO_DATA_LIMIT only when Qloo itself had nothing: no tag for the territory, or no members at all.
      // A territory Qloo returned tags for but the agent never anchored or represented is an AGENT_ERROR.
      const qlooHadTags = (label: string) => r.trace.toolCalls.some((c) => c.tool === "qloo_find_tags" && c.status === "ok" && String((c.arguments as { query?: string })?.query ?? "").toLowerCase() === label.toLowerCase() && /^[1-9]\d* tag/u.test(c.summary));
      const category = !missing
        ? "AGENT_ERROR"
        : !missing.resolvedConcept
          ? qlooHadTags(missing.label)
            ? "AGENT_ERROR"
            : "QLOO_DATA_LIMIT"
          : missing.representation.strategy === "DESCRIPTIVE_ONLY" || missing.conditionedEvidence?.entityCount === 0
            ? "QLOO_DATA_LIMIT"
            : "AGENT_ERROR";
      out.assertions.push({ higher: a.higher, lower: a.lower, outcome: "not_comparable", category, detail: missing ? `${missing.label}: ${missing.analysisRoute}` : "not in one comparison set" });
      continue;
    }
    if (hi.relativePosition.position < lo.relativePosition.position) {
      out.assertions.push({ higher: a.higher, lower: a.lower, outcome: "correct", detail: `${hi.relativePosition.position} < ${lo.relativePosition.position}` });
      continue;
    }
    const fragile = [hi, lo].some((t) => t.robustness?.level === "LOW" || t.robustness?.level === "INSUFFICIENT" || t.representation.exemplars.some((e) => (e as { quality?: string }).quality === "WEAK"));
    out.assertions.push({ higher: a.higher, lower: a.lower, outcome: "wrong", category: fragile ? "REPRESENTATION_ERROR" : reviewed ? "METHODOLOGY_ERROR" : "METHODOLOGY_ERROR|BENCHMARK_LABEL_ERROR", detail: `${hi.label} ${hi.relativePosition.position} vs ${lo.label} ${lo.relativePosition.position}` });
  }
  return out;
}

// ---- Frontier stability ----

export function stabilityOf(runs: readonly AgentRunResponse[]): FrontierStability {
  return frontierStability(
    runs
      .filter((r): r is AgentAnalysisResult => r.status !== "NEEDS_INPUT")
      .map((r) => ({
        candidates: r.territories.filter((t) => t.role === "frontier_candidate").map((t) => ({ key: t.key, label: t.label, conceptId: t.resolvedConcept?.id ?? null, route: t.analysisRoute, position: t.relativePosition?.position ?? null, classification: t.classification?.label ?? null })),
      })),
  );
}

export type StabilityReport = FrontierStability & {
  candidateSets: string[][];
  /** Mean pairwise Jaccard of concepts that reached a non-INSUFFICIENT route (supported territories). */
  supportedConceptOverlap: number | null;
  /** For concepts present in ≥ 2 runs: share with the same route in every run. */
  routeStability: number | null;
  /** Classes compared only between runs whose comparison sets hold the same concepts (else not comparable). */
  comparableClassPairs: number;
  classAgreementOnComparableSets: number | null;
  qlooCalls: number[];
  latencyMs: number[];
  costUsd: (number | null)[];
};

/** Sprint 5A frontier stability report over repeated independent runs of one frontier case. */
export function stabilityReport(runs: readonly AgentRunResponse[]): StabilityReport {
  const analyses = runs.filter((r): r is AgentAnalysisResult => r.status !== "NEEDS_INPUT");
  const frontier = (r: AgentAnalysisResult) => r.territories.filter((t) => t.role === "frontier_candidate");
  const mean = (v: number[]) => (v.length === 0 ? null : Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 1000) / 1000);
  const jaccard = (a: Set<string>, b: Set<string>) => (a.size + b.size === 0 ? 1 : [...a].filter((x) => b.has(x)).length / new Set([...a, ...b]).size);
  const supported = analyses.map((r) => new Set(frontier(r).filter((t) => t.analysisRoute !== "INSUFFICIENT_EVIDENCE" && t.resolvedConcept).map((t) => t.resolvedConcept!.id)));
  const pairs: number[] = [];
  for (let i = 0; i < supported.length; i += 1) for (let j = i + 1; j < supported.length; j += 1) pairs.push(jaccard(supported[i]!, supported[j]!));
  const routes = new Map<string, Set<string>>();
  const seen = new Map<string, number>();
  for (const r of analyses)
    for (const t of frontier(r)) {
      if (!t.resolvedConcept) continue;
      seen.set(t.resolvedConcept.id, (seen.get(t.resolvedConcept.id) ?? 0) + 1);
      routes.set(t.resolvedConcept.id, (routes.get(t.resolvedConcept.id) ?? new Set()).add(t.analysisRoute));
    }
  const repeated = [...seen.entries()].filter(([, n]) => n >= 2).map(([id]) => id);
  const setOf = (r: AgentAnalysisResult, t: AgentAnalysisResult["territories"][number]) => (t.comparisonSet?.territoryKeys ?? []).map((k) => r.territories.find((x) => x.key === k)?.resolvedConcept?.id ?? k).sort().join("|");
  let comparable = 0;
  let agree = 0;
  for (let i = 0; i < analyses.length; i += 1)
    for (let j = i + 1; j < analyses.length; j += 1)
      for (const a of frontier(analyses[i]!).filter((t) => t.classification && t.resolvedConcept)) {
        const b = frontier(analyses[j]!).find((t) => t.resolvedConcept?.id === a.resolvedConcept!.id && t.classification);
        if (!b || setOf(analyses[i]!, a) !== setOf(analyses[j]!, b)) continue;
        comparable += 1;
        if (a.classification!.label === b.classification!.label) agree += 1;
      }
  return {
    ...stabilityOf(runs),
    candidateSets: analyses.map((r) => frontier(r).map((t) => `${t.label} [${t.analysisRoute.replace("_ANALYSIS", "").replace("_EVIDENCE", "")}]`)),
    supportedConceptOverlap: analyses.length < 2 ? null : mean(pairs),
    routeStability: repeated.length === 0 ? null : Math.round((repeated.filter((id) => routes.get(id)!.size === 1).length / repeated.length) * 1000) / 1000,
    comparableClassPairs: comparable,
    classAgreementOnComparableSets: comparable === 0 ? null : Math.round((agree / comparable) * 1000) / 1000,
    qlooCalls: runs.map((r) => r.metrics.qloo_calls),
    latencyMs: runs.map((r) => r.metrics.latency_ms),
    costUsd: runs.map((r) => r.metrics.model_cost_usd),
  };
}

export function armMetrics(runs: readonly LiveRun[]): CompetenceMetrics {
  const analyses = runs.map((r) => r.response).filter((r): r is AgentAnalysisResult => r.status !== "NEEDS_INPUT");
  const g = semanticGrade(analyses);
  const ratio = (a: number, b: number) => (b === 0 ? null : Math.round((a / b) * 1000) / 1000);
  return {
    ...competenceMetrics(runs, leakPatternFor(benchmarkNames())),
    // Sprint 5A semantic dimension (historical metrics above are unchanged).
    semanticallyValidFullRate: ratio(g.validFull, g.full),
    invalidFullComparisonRate: ratio(g.invalidFull, g.full),
    meaningfulPartialRate: ratio(g.meaningfulPartial, g.partial),
    ...synthesisMetrics(analyses),
  };
}

/** Sprint 5A synthesis reliability: validity and usefulness measured separately. */
export function synthesisMetrics(analyses: readonly AgentAnalysisResult[]): Record<string, number | string | null> {
  const ratio = (a: number, b: number) => (b === 0 ? null : Math.round((a / b) * 1000) / 1000);
  const attempted = analyses.filter((r) => (r.trace.synthesis?.attemptDetails?.length ?? 0) > 0);
  const first = attempted.filter((r) => r.trace.synthesis!.attemptDetails![0]!.accepted).length;
  const after = attempted.filter((r) => r.trace.synthesis!.attemptDetails!.some((a) => a.accepted)).length;
  const categories: Record<string, number> = {};
  for (const r of attempted) for (const a of r.trace.synthesis!.attemptDetails!) for (const [k, v] of Object.entries(a.categories)) categories[k] = (categories[k] ?? 0) + v;
  const useful = attempted.filter((r) => {
    if (r.summary.source !== "model") return false;
    const evidenced = r.territories.filter((t) => t.role !== "reference" && t.analysisRoute !== "INSUFFICIENT_EVIDENCE").map((t) => t.key);
    const covered = new Set((r.layers.agentInterpretation.findings ?? []).map((f) => f.territoryKey));
    return evidenced.every((k) => covered.has(k)) && r.followUpOptions.length > 0;
  }).length;
  return {
    synthesisRuns: attempted.length,
    firstAttemptAcceptanceRate: ratio(first, attempted.length),
    acceptanceAfterRepairRate: ratio(after, attempted.length),
    fallbackRate: ratio(attempted.length - after, attempted.length),
    usefulSynthesisRate: ratio(useful, attempted.length),
    actualUnsupportedClaimsAccepted: analyses.reduce((n, r) => n + acceptedUnsupportedClaims(r), 0),
    synthesisRejectionCategories: Object.entries(categories).map(([k, v]) => `${k}:${v}`).join(" ") || "none",
  };
}

export const MODEL_STATUS = () => (hasModelCredential() ? "ANTHROPIC_API_KEY configured" : LIVE_AGENT_MODEL_VALIDATION_NOT_RUN);
