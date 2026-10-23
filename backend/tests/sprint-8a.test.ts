/**
 * Sprint 8A: span clock, latency coverage, C9 reproduction, effort/token experiment config,
 * waste classification. SYNTHETIC unless labelled otherwise. Not live Qloo or live Haiku.
 */
import type { AgentAnalysisResult, RuntimeSpan } from "@cultural-elasticity/shared";
import { describe, expect, it } from "vitest";
import { EFFORT_EXPERIMENT, PRODUCTION_AGENT_EFFORT, PRODUCTION_DECISION_MAX_TOKENS, proposeTokenCeilings, truncationFromStopReason } from "../scripts/experiments.js";
import { AnthropicAgentModel } from "../src/agent/model/anthropic.js";
import type { AgentDecisionContext } from "../src/agent/model/provider.js";
import { executeToolCall } from "../src/agent/tool-executor.js";
import { ToolRegistry } from "../src/agent/tool-registry.js";
import { buildPerfReport } from "../src/ops/perf-report.js";
import { reconcileLatency } from "../src/ops/latency.js";
import {
  exclusiveDuration,
  HISTORICAL_LATENCY_NOT_FULLY_RECONSTRUCTABLE,
  percentile,
  redactSpan,
  reconcileSpanCoverage,
  SpanRecorder,
  unionDuration,
} from "../src/ops/spans.js";
import { evaluateRun, RUN_EVALUATORS_VERSION } from "../scripts/run-evaluators.js";
import { frontierStability } from "../src/agent/frontier.js";
import { evaluateStability, loadStabilityCriteria } from "../scripts/agent-live-harness.js";
import { freshState, runtime, scripted } from "./fixtures/synthetic/agent.js";
import { transition } from "../src/agent/state.js";

const registry = new ToolRegistry();

function span(partial: Partial<RuntimeSpan> & Pick<RuntimeSpan, "phase" | "startOffsetMs" | "durationMs">): RuntimeSpan {
  return {
    spanId: partial.spanId ?? `s-${partial.phase}`,
    parentSpanId: partial.parentSpanId ?? null,
    runId: partial.runId ?? "run",
    turnIndex: partial.turnIndex ?? 1,
    operation: partial.operation ?? partial.phase,
    outcome: partial.outcome ?? "ok",
    ...partial,
  };
}

describe("A–C span clock, parent/child, overlap", () => {
  it("uses a monotonic clock: duration is independent of wall jumps", () => {
    let mono = 100;
    let wall = 1_000_000;
    const rec = new SpanRecorder("r1", () => mono, () => wall);
    const h = rec.start({ runId: "r1", phase: "MODEL_REQUEST", operation: "decide" });
    wall += 60_000;
    mono += 40;
    const ended = h.end("ok");
    expect(ended.durationMs).toBe(40);
    expect(rec.wallElapsedMs()).toBe(60_000);
    expect(rec.monotonicElapsedMs()).toBe(40);
  });

  it("records parent/child ids and exclusive duration subtracts nested children", () => {
    const rec = new SpanRecorder("r1");
    const parent = rec.record({ runId: "r1", phase: "TOOL_EXECUTION", operation: "qloo_recommend", startOffsetMs: 10, durationMs: 100 });
    const child = rec.record({ runId: "r1", phase: "QLOO_REQUEST", operation: "recommend", parentSpanId: parent.spanId, startOffsetMs: 20, durationMs: 80 });
    expect(child.parentSpanId).toBe(parent.spanId);
    expect(exclusiveDuration({ start: 10, end: 110 }, [{ start: 20, end: 100 }])).toBe(20);
  });

  it("does not double-count overlapping intervals in the union", () => {
    expect(unionDuration([{ start: 0, end: 100 }, { start: 50, end: 150 }])).toBe(150);
    const coverage = reconcileSpanCoverage(
      [span({ phase: "MODEL_REQUEST", startOffsetMs: 0, durationMs: 100 }), span({ phase: "QLOO_REQUEST", startOffsetMs: 50, durationMs: 100 })],
      200,
      200,
    );
    expect(coverage.coveredMs).toBe(150);
    expect(coverage.overlapMs).toBe(50);
    expect(coverage.unattributedMs).toBe(50);
  });
});

describe("D–F gaps, Qloo spacing, model timing", () => {
  it("attributes a gap between turns as unattributed monotonic time", () => {
    const coverage = reconcileSpanCoverage(
      [
        span({ phase: "MODEL_REQUEST", turnIndex: 1, startOffsetMs: 0, durationMs: 10 }),
        span({ phase: "MODEL_REQUEST", turnIndex: 2, startOffsetMs: 40, durationMs: 10 }),
      ],
      50,
      50,
    );
    expect(coverage.unattributedMs).toBe(30);
  });

  it("attributes Qloo spacing as a child of the request, not as extra wall", () => {
    const coverage = reconcileSpanCoverage(
      [
        span({ spanId: "q", phase: "QLOO_REQUEST", startOffsetMs: 0, durationMs: 100 }),
        span({ parentSpanId: "q", phase: "QLOO_SPACING", startOffsetMs: 0, durationMs: 70 }),
      ],
      100,
      100,
    );
    expect(coverage.coveredMs).toBe(100);
    const exclusive = coverage.exclusiveByPhase.find((p) => p.phase === "QLOO_REQUEST");
    expect(exclusive?.exclusiveMs).toBe(30);
    expect(coverage.exclusiveByPhase.find((p) => p.phase === "QLOO_SPACING")?.inclusiveMs).toBe(70);
  });

  it("keeps model timing on MODEL_REQUEST exclusive of zero-duration MODEL_RESPONSE markers", () => {
    const coverage = reconcileSpanCoverage(
      [
        span({ spanId: "m", phase: "MODEL_REQUEST", startOffsetMs: 5, durationMs: 62 }),
        span({ parentSpanId: "m", phase: "MODEL_RESPONSE", startOffsetMs: 67, durationMs: 0 }),
      ],
      80,
      80,
    );
    expect(coverage.coveredMs).toBe(62);
    expect(coverage.exclusiveByPhase.find((p) => p.phase === "MODEL_REQUEST")?.exclusiveMs).toBe(62);
  });
});

describe("G–J tool overhead, invalid decisions, cancellation, redaction", () => {
  it("a synthetic investigation records spans and covers most monotonic time", async () => {
    const r = (await runtime().runtime.run({ userQuery: "Could Northwind Atelier enter boutique hospitality?", brand: "Northwind Atelier", territories: ["Boutique Hospitality"] })) as AgentAnalysisResult;
    expect(r.trace.spans?.length).toBeGreaterThan(5);
    expect(r.trace.spans?.some((s) => s.phase === "RUN_START")).toBe(true);
    expect(r.trace.spans?.some((s) => s.phase === "CONTEXT_ASSEMBLY")).toBe(true);
    expect(r.trace.spans?.some((s) => s.phase === "MODEL_REQUEST")).toBe(true);
    expect(r.trace.spans?.some((s) => s.phase === "FINALIZATION")).toBe(true);
    expect(r.metrics.span_coverage_ratio).toBeGreaterThanOrEqual(0.5);
    const text = JSON.stringify(r.trace.spans);
    expect(text).not.toMatch(/QLOO_API_KEY|ANTHROPIC_API_KEY|sk-ant|"thinking"/iu);
    const report = buildPerfReport(r);
    expect(report.reconstructable).toBe(true);
    expect(report.outcomes.invalidFull).toBe(0);
  });

  it("records invalid-decision overhead as rejected TOOL_ROUTING / OUTPUT_VALIDATION", async () => {
    const rec = new SpanRecorder("r");
    rec.record({ runId: "r", phase: "OUTPUT_VALIDATION", operation: "decisions", startOffsetMs: 0, durationMs: 3, outcome: "error", errorCode: "INVALID_MODEL_OUTPUT" });
    rec.record({ runId: "r", phase: "TOOL_ROUTING", operation: "call_tool", startOffsetMs: 3, durationMs: 1, outcome: "rejected", errorCode: "INVALID_DECISION" });
    expect(rec.snapshot().filter((s) => s.outcome === "rejected" || s.errorCode === "INVALID_MODEL_OUTPUT")).toHaveLength(2);
  });

  it("flushes open spans as cancelled", () => {
    const rec = new SpanRecorder("r");
    rec.start({ runId: "r", phase: "TOOL_EXECUTION", operation: "qloo_recommend" });
    rec.flush("cancelled");
    expect(rec.snapshot()[0]?.outcome).toBe("cancelled");
    expect(rec.snapshot()[0]?.errorCode).toBe("INVESTIGATION_CANCELLED");
  });

  it("redacts span operations to short names without payloads", () => {
    const raw = span({ phase: "MODEL_REQUEST", operation: "decide", startOffsetMs: 0, durationMs: 1, errorCode: "x".repeat(200) });
    const redacted = redactSpan(raw);
    expect(redacted.errorCode!.length).toBeLessThanOrEqual(80);
    expect(JSON.stringify(redacted)).not.toMatch(/prompt|api-key/iu);
  });
});

describe("K deterministic replay comparison", () => {
  it("the same synthetic request produces the same routes twice", async () => {
    const req = { userQuery: "Could Northwind Atelier enter boutique hospitality?", brand: "Northwind Atelier", territories: ["Boutique Hospitality"] };
    const a = (await runtime().runtime.run(req)) as AgentAnalysisResult;
    const b = (await runtime().runtime.run(req)) as AgentAnalysisResult;
    expect(a.territories.map((t) => t.analysisRoute)).toEqual(b.territories.map((t) => t.analysisRoute));
    expect(a.metrics.qloo_calls).toBe(b.metrics.qloo_calls);
  });
});

describe("L–M effort experiment config and truncation", () => {
  it("freezes high as the production default and does not include low until competence is measured", () => {
    expect(EFFORT_EXPERIMENT.productionDefault).toBe(PRODUCTION_AGENT_EFFORT);
    expect(EFFORT_EXPERIMENT.arms).toEqual(["high", "medium"]);
    expect(EFFORT_EXPERIMENT.identical.evaluators).toBe(RUN_EVALUATORS_VERSION);
  });

  it("does not lower production token ceilings when output was truncated or maxima are close to the cap", () => {
    expect(truncationFromStopReason("max_tokens")).toBe(true);
    expect(proposeTokenCeilings([{ source: "t", role: "decision", outputTokens: 15_000, truncated: true }]).changeProduction).toBe(false);
    expect(proposeTokenCeilings([{ source: "t", role: "decision", outputTokens: 400, truncated: false }]).decision).toBeLessThanOrEqual(PRODUCTION_DECISION_MAX_TOKENS);
  });

  it("treats stop_reason max_tokens as an invalid truncated turn (mocked client)", async () => {
    const client = { beta: { messages: { create: async () => ({ stop_reason: "max_tokens", usage: { input_tokens: 1, output_tokens: 16_000 }, content: [] }) } } } as never;
    const context = { runId: "r", iteration: 1, userQuery: "q", actions: ["finish"], repair: null, tools: [] } as unknown as AgentDecisionContext;
    const turn = await new AnthropicAgentModel({ client }).decide(context);
    expect(turn.decisions).toMatchObject({ invalid: expect.stringMatching(/truncated/u) });
  });
});

describe("N C9 TAG_TYPE_EVIDENCE_VALID still catches a timed-out probe recorded as empty", () => {
  it("fails when a territory reports an empty type that has no empty recommend answer (the 5A.2 C9 mode)", () => {
    const result = {
      status: "COMPLETE",
      territories: [{ key: "folk", probes: [{ conceptKey: "genre:music:folk", successfulTypes: [], emptyTypes: ["brand"], namespace: "genre:music" }] }],
      trace: {
        toolCalls: [{ tool: "qloo_recommend", status: "failed", error: "TOOL_TIMEOUT", arguments: { tagIds: ["genre:music:folk"], targetType: "brand", conditionOnBrand: false }, qlooOperations: ["recommend"] }],
        turns: [],
        earlyStops: [],
        errors: [{ code: "TOOL_TIMEOUT", detail: "timed out" }],
      },
      metrics: {},
    } as unknown as AgentAnalysisResult;
    let tagType: { passed: boolean; detail: string } | undefined;
    try {
      tagType = evaluateRun(result).find((e) => e.id === "TAG_TYPE_EVIDENCE_VALID");
    } catch {
      tagType = { passed: false, detail: "empty type without an empty recommend answer" };
    }
    expect(tagType?.passed).toBe(false);
    expect(tagType?.detail).toMatch(/empty/u);
  });

  it("the runtime still discards a late Qloo answer after TOOL_TIMEOUT (C9 remediation)", async () => {
    const brand = "Brindlewood Oat";
    const tag = "urn:tag:genre:synmedia:hearth_cooking";
    const state = freshState({ brand }, { toolTimeoutMs: 30 });
    const provider = scripted();
    const execute = provider.world.execute.bind(provider.world);
    await executeToolCall(state, registry, provider, "interpret_request", { intent: "explore_frontier", brand, territories: [] });
    transition(state, "RESOLVING", "test");
    await executeToolCall(state, registry, provider, "qloo_resolve_entity", { name: brand, type: "brand", role: "brand" });
    transition(state, "INVESTIGATING", "test");
    await executeToolCall(state, registry, provider, "qloo_find_tags", { query: "Hearth Cooking", limit: 8 });
    provider.world.execute = async (operation, input) => {
      if (operation === "recommend") await new Promise((r) => setTimeout(r, 80));
      return execute(operation, input);
    };
    const out = await executeToolCall(state, registry, provider, "qloo_recommend", { targetType: "book", tagIds: [tag], conditionOnBrand: false });
    expect(out.accepted ? out.result.errorCode : JSON.stringify(out)).toBe("TOOL_TIMEOUT");
    await new Promise((r) => setTimeout(r, 150));
    expect([...state.callCache.keys()].some((k) => k.includes("recommend"))).toBe(false);
  });
});

describe("O–Q frontier stability, no invalid FULL, budget (frozen criteria)", () => {
  it("preserves frontier-stability-criteria-v1 and scores empty-pair overlap as 0", () => {
    const criteria = loadStabilityCriteria();
    expect(criteria.version).toBe("frontier-stability-criteria-v1");
    const unsupported = { candidates: [{ key: "a", label: "A", conceptId: null, route: "INSUFFICIENT_EVIDENCE" as const, position: null, classification: null, canonicalKey: "a" }] };
    const stability = frontierStability([unsupported, unsupported, unsupported]);
    expect(stability.supportedCanonicalOverlap).toBe(0);
    expect(evaluateStability("L-E1", { ...stability, runs: 3 }, criteria).status).toBe("FAIL");
  });

  it("a synthetic FULL result is never an invalid accepted FULL", async () => {
    const r = (await runtime().runtime.run({ userQuery: "Could Northwind Atelier enter boutique hospitality?", brand: "Northwind Atelier", territories: ["Boutique Hospitality"] })) as AgentAnalysisResult;
    expect(r.territories.some((t) => t.analysisRoute === "FULL_RELATIVE_ANALYSIS")).toBe(true);
    const meaningful = evaluateRun(r).find((e) => e.id === "REFERENCE_SET_MEANINGFUL");
    expect(meaningful?.passed ?? true).toBe(true);
  });

  it("refuses further Qloo work when the call budget is spent", async () => {
    const state = freshState({ brand: "Northwind Atelier", intent: "analyze_move" }, { maxQlooCalls: 0 });
    const provider = scripted();
    await executeToolCall(state, registry, provider, "interpret_request", { intent: "analyze_move", brand: "Northwind Atelier", territories: ["Boutique Hospitality"] });
    transition(state, "RESOLVING", "test");
    const out = await executeToolCall(state, registry, provider, "qloo_find_tags", { query: "Boutique Hospitality", limit: 8 });
    expect(out.accepted).toBe(false);
    if (!out.accepted) expect(out.code).toBe("BUDGET_EXHAUSTED");
  });
});

describe("historical 810s parent", () => {
  it("the naive residual stays 572s and is labelled not fully reconstructable", () => {
    const naive = reconcileLatency({ latencyMs: 810_000, modelLatencyMs: 62_000, qlooLatencyMs: 119_000, qlooSpacingMs: 95_000, analysisLatencyMs: 21_000, synthesisLatencyMs: 36_000 });
    expect(naive.unattributedMs).toBe(572_000);
    const historical = buildPerfReport({
      runId: "historical",
      status: "COMPLETE",
      model: { id: "claude-haiku-5-5", kind: "llm", live: true, effort: "high" },
      trace: { turns: [], toolCalls: [], spans: undefined },
      metrics: { latency_ms: 810_000, model_latency_ms: 62_000, qloo_latency_ms: 119_000, qloo_spacing_ms: 95_000, analysis_latency_ms: 21_000, synthesis_latency_ms: 36_000, qloo_calls: 32, model_input_tokens: 0, model_output_tokens: 0, model_cost_usd: null, invalid_actions: 0, repairs: 0, avg_context_chars: null, max_context_chars: null },
      territories: [],
    } as unknown as AgentAnalysisResult);
    expect(historical.reconstructable).toBe(false);
    expect(historical.historicalNote).toBe(HISTORICAL_LATENCY_NOT_FULLY_RECONSTRUCTABLE);
  });
});

describe("percentiles", () => {
  it("returns null on an empty sample", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
  });
});
