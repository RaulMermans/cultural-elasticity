/**
 * Sprint 11 tier T2: paired A/B research runs on the pre-registered holdouts (evals/research-intelligence/cases.json).
 *
 *   A = research policy v0 (Sprint 10 interpreter prompt + runtime), B = research policy v1.
 * Both arms take the natural-language question through the real interpreter, the deterministic gate and the runtime,
 * with the production model and effort and the same budgets. Each case is recorded to <dir>/<case>.cassette.json and a
 * call already recorded is served from it, so both arms see identical Qloo answers. Live dispatches stop at the
 * approved Qloo allowance; a case starts only if its worst case still fits both allowances.
 *
 * Outputs: per-run results, deterministic grades, and a blinded rating sheet (arms shown as X/Y in a seeded order, with
 * policy, model and arm fields removed) for the owner's T3 rating. Labels: LIVE (recorded); never research quality
 * by itself — usefulness is the human rating.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentAnalysisResult, AgentRunResponse } from "@cultural-elasticity/shared";
import { createAgentModel, createLiveToolProvider } from "../../src/agent/factory.js";
import { DEFAULT_QLOO_CALLS } from "../../src/agent/contracts.js";
import { DEFAULT_AGENT_MODEL } from "../../src/agent/model/anthropic.js";
import { runGate } from "../../src/agent/query/gate.js";
import { AnthropicQueryInterpreter } from "../../src/agent/query/interpreter.js";
import { AgentRuntime } from "../../src/agent/runtime.js";
import { feasibilityPolicyFromEnv } from "../../src/api/agent.js";
import { DEFAULT_INVESTIGATION_RESERVE_USD, HAIKU_CONSERVATIVE, MODEL_PRICES } from "../../src/ops/pricing.js";
import { CachingRecorder, CASSETTE_SCHEMA, readCassette, writeCassette, type Cassette } from "../competence/cassette.js";
import { runMetrics } from "../d2d/harness.js";

export type PairedCase = { id: string; brand: string; query: string; structure?: string; acceptableApproaches: string[]; abstention: string; brandCore: boolean; concepts: { name: string; meaning: string; notEquivalent: string[] }[] };
type Arm = "A" | "B";
const POLICY: Record<Arm, "v0" | "v1"> = { A: "v0", B: "v1" };

/** Worst-case Qloo dispatches of one run: the operation's default ceiling (budgets are not raised by either arm). */
export function worstCaseQloo(c: PairedCase): number {
  const intent = c.acceptableApproaches.includes("explore") ? "explore_frontier" : c.acceptableApproaches.includes("compare") && !c.acceptableApproaches.includes("investigate") ? "compare_territories" : "analyze_move";
  return DEFAULT_QLOO_CALLS[intent];
}

/** The pre-call budget for a set of cases and arms (no provider call). */
export function pairedBudget(cases: readonly PairedCase[], arms: readonly Arm[] = ["A", "B"]) {
  const qloo = cases.reduce((n, c) => n + worstCaseQloo(c) * arms.length, 0);
  const runs = cases.length * arms.length;
  return { runs, worstCaseQloo: qloo, modelReserveUsd: Number((runs * (DEFAULT_INVESTIGATION_RESERVE_USD + 0.03)).toFixed(2)) };
}

function modelUsd(r: AgentRunResponse): number {
  const price = MODEL_PRICES[r.model.id] ?? HAIKU_CONSERVATIVE;
  return (r.metrics.model_input_tokens * price.input + r.metrics.model_output_tokens * price.output) / 1e6;
}

/** Deterministic grades only; cultural relevance, novelty and usefulness are rated blind by a human (T3). */
function grade(c: PairedCase, r: AgentRunResponse | null, error: string | null) {
  if (!r) return { status: "ERROR", error, evidenceIntegrityViolations: null, unsupportedClassifications: null, qlooCalls: null };
  const m = runMetrics(r);
  const a = "territories" in r ? (r as AgentAnalysisResult) : null;
  const targets = a?.territories.filter((t) => t.role === "target") ?? [];
  return {
    status: r.status,
    evidenceIntegrityViolations: (a && !a.summary.claimValidation.passed ? 1 : 0) + m.crossCallComparisons + m.cards.reduce((n, x) => n + x.violations.length, 0),
    unsupportedClassifications: m.unsupportedClassifications,
    brandCoreFlagged: c.brandCore ? targets.some((t) => t.brandCore) : null,
    conceptAlignments: targets.map((t) => (t.conceptAlignment ? `${t.label} → ${t.conceptAlignment.qlooConcept.label}: ${t.conceptAlignment.relation}` : `${t.label} → ${t.resolvedConcept?.label ?? "none"}: unassessed`)),
    approach: a?.researchApproach?.approach ?? null,
    routes: m.routes,
    qlooCalls: m.qlooCalls,
    iterations: m.iterations,
    insights: a?.insights?.length ?? 0,
    synthesisSource: a?.summary.source ?? null,
  };
}

/** What a blinded rater sees: the question, the answer and its evidence, without policy, model or arm fields. */
function blindView(r: AgentRunResponse | null) {
  if (!r || !("territories" in r)) return { status: r?.status ?? "ERROR", answer: null };
  const a = r as AgentAnalysisResult;
  return {
    summary: a.summary.text,
    territories: a.territories.map((t) => ({ label: t.label, qlooConcept: t.resolvedConcept?.label ?? null, route: t.analysisRoute, exemplars: t.representation.exemplars.map((e) => e.label), limitations: t.limitations.map((l) => l.detail) })),
    assessment: a.hypothesisAssessment ? { outcome: a.hypothesisAssessment.outcome, nextStep: a.hypothesisAssessment.nextStep } : null,
    interpretations: a.insights ?? [],
    followUps: a.followUpOptions,
  };
}

/** Seeded order so the blind assignment is reproducible from the seed alone. */
function seededFlip(seed: string): boolean {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 2 === 1;
}

export async function runPaired(options: { cases: readonly PairedCase[]; out: string; approvedQloo: number; approvedUsd: number; seed: string }): Promise<number> {
  const { cases, out, approvedQloo, approvedUsd, seed } = options;
  mkdirSync(out, { recursive: true });
  const liveProvider = createLiveToolProvider();
  let dispatches = 0;
  let usd = 0;
  const rows: Record<string, unknown>[] = [];
  const sheet: Record<string, unknown>[] = [];
  const key: Record<string, { X: Arm; Y: Arm }> = {};
  for (const c of cases) {
    const needQloo = worstCaseQloo(c) * 2;
    const needUsd = 2 * (DEFAULT_INVESTIGATION_RESERVE_USD + 0.03);
    if (approvedQloo - dispatches < needQloo || approvedUsd - usd < needUsd) {
      rows.push({ caseId: c.id, status: "NOT_RUN", reason: `remaining allowance (${approvedQloo - dispatches} Qloo, $${(approvedUsd - usd).toFixed(2)}) below the case worst case (${needQloo} Qloo, $${needUsd.toFixed(2)})` });
      continue;
    }
    const path = join(out, `${c.id}.cassette.json`);
    const cassette: Cassette = existsSync(path) ? readCassette(path) : { schema: CASSETTE_SCHEMA, caseId: c.id, recordedWith: { engineRevision: process.env.CE_ENGINE_REVISION ?? "local", model: "anthropic" }, entries: [] };
    const results: Partial<Record<Arm, AgentRunResponse | null>> = {};
    for (const arm of ["A", "B"] as const) {
      const provider = new CachingRecorder(liveProvider, cassette, { maxLiveCalls: approvedQloo, used: () => dispatches, onLive: (n) => { dispatches += n; } });
      const interpreter = new AnthropicQueryInterpreter({ researchPolicy: POLICY[arm] });
      let r: AgentRunResponse | null = null;
      let error: string | null = null;
      const started = Date.now();
      try {
        const interpreted = await interpreter.interpret({ query: c.query, explicit: {}, context: null });
        usd += ((interpreted.usage.inputTokens + (interpreted.usage.cacheReadTokens ?? 0)) * HAIKU_CONSERVATIVE.input + interpreted.usage.outputTokens * HAIKU_CONSERVATIVE.output) / 1e6;
        if (!interpreted.ok) throw new Error(`interpretation ${interpreted.code}: ${interpreted.detail}`);
        const gate = runGate({ query: c.query, explicit: {}, proposal: interpreted.proposal, context: null, interpreter: interpreter.info });
        if (!gate.plan) throw new Error(`gate ${gate.interpretation.disposition}: ${gate.interpretation.reasonCodes.map((x) => x.code).join(", ")}`);
        const runtime = new AgentRuntime({ model: createAgentModel("anthropic"), provider, feasibilityPolicy: feasibilityPolicyFromEnv(), researchPolicy: POLICY[arm] });
        r = await runtime.run(gate.plan.request, undefined, { interpretation: gate.plan.interpretation });
        usd += r.model.kind === "llm" ? modelUsd(r) : 0;
      } catch (e) {
        error = e instanceof Error ? e.message.slice(0, 300) : String(e);
      } finally {
        writeCassette(path, cassette);
      }
      results[arm] = r;
      if (r) writeFileSync(join(out, `${c.id}.${arm}.json`), `${JSON.stringify(r, null, 2)}\n`);
      rows.push({ caseId: c.id, arm, policy: POLICY[arm], latencyMs: Date.now() - started, ...grade(c, r, error) });
      console.log(`${c.id} ${arm}: ${r?.status ?? `ERROR ${error}`} | ${dispatches} Qloo dispatched so far | $${usd.toFixed(3)} so far`);
    }
    const flip = seededFlip(`${seed}:${c.id}`);
    key[c.id] = flip ? { X: "B", Y: "A" } : { X: "A", Y: "B" };
    sheet.push({ caseId: c.id, brand: c.brand, question: c.query, X: blindView(results[key[c.id]!.X] ?? null), Y: blindView(results[key[c.id]!.Y] ?? null), rate: { intentFidelity: { X: null, Y: null }, culturalUnderstanding: { X: null, Y: null }, researchJudgment: { X: null, Y: null }, strategicUsefulness: { X: null, Y: null }, discoveryQuality: { X: null, Y: null } } });
  }
  const label = { evidence: "LIVE_QLOO (recorded)", model: DEFAULT_AGENT_MODEL, note: "Deterministic grades only. Research quality is the blinded human rating (T3); this file is not that rating." };
  writeFileSync(join(out, "t2-grades.json"), `${JSON.stringify({ label, dispatches, observedUsd: Number(usd.toFixed(4)), rows }, null, 2)}\n`);
  writeFileSync(join(out, "t3-rating-sheet.json"), `${JSON.stringify({ instructions: "Rate X and Y per dimension 0–2 (rubric in evals/research-intelligence/cases.json) WITHOUT opening t3-key.json. Then read the gold sheet.", seed, cases: sheet }, null, 2)}\n`);
  writeFileSync(join(out, "t3-key.json"), `${JSON.stringify(key, null, 2)}\n`);
  console.log(`T2 done: ${dispatches} live Qloo dispatches, $${usd.toFixed(3)} observed. Rating sheet: ${join(out, "t3-rating-sheet.json")}`);
  return 0;
}
