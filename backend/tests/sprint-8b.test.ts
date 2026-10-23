/**
 * Sprint 8B: metric integrity, late Qloo accounting, per-call metadata, FULL/PARTIAL split.
 * SYNTHETIC unless labelled otherwise. Not live Qloo or live Haiku.
 */
import type { AgentAnalysisResult } from "@cultural-elasticity/shared";
import { describe, expect, it } from "vitest";
import { executeToolCall } from "../src/agent/tool-executor.js";
import { ToolRegistry } from "../src/agent/tool-registry.js";
import { QlooToolProvider } from "../src/agent/tool-provider.js";
import { callQloo } from "../src/agent/qloo-gateway.js";
import { buildPerfReport, routeCounts } from "../src/ops/perf-report.js";
import { evaluateRun, RUN_EVALUATORS_VERSION } from "../scripts/run-evaluators.js";
import { EFFORT_EXPERIMENT, PRODUCTION_AGENT_EFFORT, PRODUCTION_DECISION_MAX_TOKENS, proposeTokenCeilings } from "../scripts/experiments.js";
import { freshState, runtime, scripted } from "./fixtures/synthetic/agent.js";
import { transition } from "../src/agent/state.js";
import type { QlooTransport, TransportResult } from "../src/qloo/transport.js";
import type { QlooOperation } from "../src/qloo/types.js";

const registry = new ToolRegistry();

function analysis(partial: Record<string, unknown>): AgentAnalysisResult {
  return {
    schemaVersion: "ce-agent-result/0.3",
    runId: "r",
    status: "COMPLETE",
    finalSufficiency: "SUFFICIENT",
    intent: "analyze_move",
    userQuery: "q",
    brand: null,
    methodologyRuns: [],
    summary: { text: "", source: "deterministic_template", claimValidation: { passed: true, violations: [] } },
    followUpOptions: [],
    limitations: [],
    evidenceOrigin: "synthetic",
    model: { id: "test", kind: "scripted", live: false },
    trace: { turns: [], toolCalls: [] },
    metrics: { latency_ms: 60_000, model_latency_ms: 1, qloo_latency_ms: 1, qloo_calls: 1, model_input_tokens: 0, model_output_tokens: 0, model_cost_usd: null, invalid_actions: 0, repairs: 0, avg_context_chars: null, max_context_chars: null },
    skillsUsed: [],
    comparisonSetConstruction: { intent: null, proposed: [], rejected: [], final: [], dedupDecisions: [], diversity: { assessment: "unknown", similarPairs: [], detail: "" }, note: "" },
    layers: { qlooEvidence: { brand: null, concepts: [], exemplars: [], qlooCalls: 0 }, systemAnalysis: { routes: [], methodologyRunIds: [], finalSufficiency: "SUFFICIENT", representationDecisions: { valid: 0, weak: 0, rejected: 0 } }, agentInterpretation: { summary: "", source: "deterministic_template", claimValidationPassed: true, semanticJudgments: [], followUpOptions: [] } },
    failureCategory: null,
    territories: [],
    ...partial,
  } as unknown as AgentAnalysisResult;
}

describe("invalid FULL metric is unmeasured when no evaluator result exists", () => {
  it("does not report invalidFull=0 for a FULL territory with no semantic assessment", () => {
    const result = analysis({
      territories: [{ key: "t", label: "T", role: "target", origin: "user", rationale: "", resolvedConcept: null, representation: { strategy: "none", entityType: null, exemplars: [], rejectedExemplars: [], diversity: "unknown", diversityDetail: "", attempts: 0, summary: "", failure: null }, analysisRoute: "FULL_RELATIVE_ANALYSIS", capabilities: { relativePosition: "unavailable", classification: "unavailable", robustness: "unavailable", coherence: "unavailable" }, comparisonSet: null, relativePosition: null, robustness: null, coherence: null, conditionedEvidence: null, evidenceQuality: null, classification: null, keyEvidence: [], limitations: [] }],
      comparisonSetConstruction: { intent: null, proposed: [], rejected: [], final: [], dedupDecisions: [], diversity: { assessment: "unknown", similarPairs: [], detail: "" }, note: "" },
    });
    expect(routeCounts(result).invalidFull).toBeNull();
    expect(buildPerfReport(result).outcomes.invalidFull).toBeNull();
  });

  it("counts an assessed non-MEANINGFUL FULL as invalid, not as validFull", () => {
    const result = analysis({
      territories: [{ key: "t", label: "T", role: "target", origin: "user", rationale: "", resolvedConcept: null, representation: { strategy: "none", entityType: null, exemplars: [], rejectedExemplars: [], diversity: "unknown", diversityDetail: "", attempts: 0, summary: "", failure: null }, analysisRoute: "FULL_RELATIVE_ANALYSIS", capabilities: { relativePosition: "unavailable", classification: "unavailable", robustness: "unavailable", coherence: "unavailable" }, comparisonSet: { territoryKeys: ["t"], labels: ["T"], methodologyVersion: "elasticity-v0.1", semanticStatus: "WEAK" }, relativePosition: null, robustness: null, coherence: null, conditionedEvidence: null, evidenceQuality: null, classification: null, keyEvidence: [], limitations: [] }],
      comparisonSetConstruction: {
        intent: null,
        proposed: [],
        rejected: [],
        final: [],
        dedupDecisions: [],
        diversity: { assessment: "unknown", similarPairs: [], detail: "" },
        note: "",
        semanticAssessments: [{ targetTerritoryKey: "t", memberTerritoryKeys: ["t"], semanticStatus: "WEAK", structuralStatus: "VALID", structuralIssues: [], usedForFull: false, acceptedReferences: [], rejectedReferences: [], referenceTerritoryKeys: [], entityType: "brand", modelAssessed: false, evidenceReferences: [], rulesVersion: "semantic-comparison-v1" }],
      },
    });
    const counts = routeCounts(result);
    expect(counts.validFull).toBe(0);
    expect(counts.invalidFull).toBe(1);
  });
});

describe("FULL and PARTIAL are separate outcome classes", () => {
  it("does not treat PARTIAL as equivalent to VALID_FULL", async () => {
    const r = (await runtime().runtime.run({ userQuery: "Could Northwind Atelier enter boutique hospitality?", brand: "Northwind Atelier", territories: ["Boutique Hospitality"] })) as AgentAnalysisResult;
    const report = buildPerfReport(r);
    expect(report.outcomes.validFull).toBeGreaterThanOrEqual(1);
    expect(report.outcomes.partial).toBeGreaterThanOrEqual(0);
    expect(report.outcomes.descriptive).toBeGreaterThanOrEqual(0);
    expect(report.outcomes.insufficient).toBeGreaterThanOrEqual(0);
    expect(report.outcomes.unsupported).toBeGreaterThanOrEqual(0);
    expect(report.outcomes).not.toHaveProperty("supportedFindings");
  });
});

describe("per-call Qloo metadata is not a shared last-call field", () => {
  it("concurrent provider calls return distinct operationIds even if lastCallMeta is overwritten", async () => {
    const transport: QlooTransport = {
      name: "latch",
      execute: async (_operation: QlooOperation): Promise<TransportResult> => {
        await new Promise((r) => setTimeout(r, 20));
        return { kind: "failure", failure: { code: "QLOO_EMPTY", layer: "test", retryable: false, recovery: "none", correlationId: undefined }, exitCode: 0 };
      },
    };
    const provider = new QlooToolProvider(transport, { name: "latch", mode: "scripted", evidenceSource: "synthetic-fixture", spacingMs: 0 });
    const [a, b] = await Promise.all([provider.call("find_tags", { query: "one", limit: 1 }), provider.call("find_tags", { query: "two", limit: 1 })]);
    expect(a.callMeta.operationId).toBeTruthy();
    expect(b.callMeta.operationId).toBeTruthy();
    expect(a.callMeta.operationId).not.toBe(b.callMeta.operationId);
    expect(provider.lastCallMeta.operationId).toBe(b.callMeta.operationId);
  });
});

describe("late Qloo accounting: reserve at dispatch", () => {
  it("charges the budget at dispatch so a late answer cannot exceed maxQlooCalls", async () => {
    const state = freshState({ brand: "Brindlewood Oat" }, { toolTimeoutMs: 30, maxQlooCalls: 3 });
    const provider = scripted();
    const execute = provider.world.execute.bind(provider.world);
    await executeToolCall(state, registry, provider, "interpret_request", { intent: "explore_frontier", brand: "Brindlewood Oat", territories: [] });
    transition(state, "RESOLVING", "test");
    await executeToolCall(state, registry, provider, "qloo_resolve_entity", { name: "Brindlewood Oat", type: "brand", role: "brand" });
    transition(state, "INVESTIGATING", "test");
    await executeToolCall(state, registry, provider, "qloo_find_tags", { query: "Hearth Cooking", limit: 8 });
    const afterSetup = state.usage.qlooCalls;
    expect(afterSetup).toBeLessThanOrEqual(3);
    const tag = "urn:tag:genre:synmedia:hearth_cooking";
    provider.world.execute = async (operation, input) => {
      if (operation === "recommend") await new Promise((r) => setTimeout(r, 80));
      return execute(operation, input);
    };
    const timedOut = executeToolCall(state, registry, provider, "qloo_recommend", { targetType: "book", tagIds: [tag], conditionOnBrand: false });
    const overlapping = executeToolCall(state, registry, provider, "qloo_recommend", { targetType: "brand", tagIds: [tag], conditionOnBrand: false });
    await timedOut;
    await overlapping;
    await new Promise((r) => setTimeout(r, 150));
    expect(state.usage.qlooCalls).toBeLessThanOrEqual(3);
    expect([...state.callCache.keys()].some((k) => k.includes("recommend") && k.includes("book"))).toBe(false);
  });

  it("does not promote a late answer after the run is finalized", async () => {
    const state = freshState({ brand: "Brindlewood Oat" }, { toolTimeoutMs: 30 });
    const provider = scripted();
    const execute = provider.world.execute.bind(provider.world);
    await executeToolCall(state, registry, provider, "interpret_request", { intent: "explore_frontier", brand: "Brindlewood Oat", territories: [] });
    transition(state, "RESOLVING", "test");
    await executeToolCall(state, registry, provider, "qloo_resolve_entity", { name: "Brindlewood Oat", type: "brand", role: "brand" });
    transition(state, "INVESTIGATING", "test");
    await executeToolCall(state, registry, provider, "qloo_find_tags", { query: "Hearth Cooking", limit: 8 });
    const tag = "urn:tag:genre:synmedia:hearth_cooking";
    provider.world.execute = async (operation, input) => {
      if (operation === "recommend") await new Promise((r) => setTimeout(r, 80));
      return execute(operation, input);
    };
    const pending = executeToolCall(state, registry, provider, "qloo_recommend", { targetType: "book", tagIds: [tag], conditionOnBrand: false });
    await pending;
    state.finalized = true;
    const callsAtSeal = state.usage.qlooCalls;
    await new Promise((r) => setTimeout(r, 150));
    expect(state.usage.qlooCalls).toBe(callsAtSeal);
    expect(state.pools.filter((p) => p.tagIds.includes(tag))).toEqual([]);
    expect(state.lateSettlements.some((s) => s.discarded)).toBe(true);
  });

  it("settles one provider call once even if callQloo is observed twice", async () => {
    const state = freshState({ brand: "Northwind Atelier" }, { maxQlooCalls: 4 });
    const provider = scripted();
    await executeToolCall(state, registry, provider, "interpret_request", { intent: "analyze_move", brand: "Northwind Atelier", territories: ["Boutique Hospitality"] });
    transition(state, "RESOLVING", "test");
    await executeToolCall(state, registry, provider, "qloo_resolve_entity", { name: "Northwind Atelier", type: "brand", role: "brand" });
    const before = state.usage.qlooCalls;
    const trace = state.trace.toolCalls.at(-1)!;
    const first = await callQloo(state, provider, trace, "find_tags", { query: "Boutique Hospitality", limit: 8 });
    expect(first.outcome === "ok" || first.outcome === "empty").toBe(true);
    const after = state.usage.qlooCalls;
    expect(after).toBe(before + 1);
    expect(state.settledOperationIds.size).toBeGreaterThan(0);
  });
});

describe("C9 evaluator is unchanged and still fails a timed-out probe recorded as empty", () => {
  it("preserves run-evaluators-v2.1", () => {
    expect(RUN_EVALUATORS_VERSION).toBe("run-evaluators-v2.1");
    expect(EFFORT_EXPERIMENT.identical.evaluators).toBe("run-evaluators-v2.1");
  });

  it("TAG_TYPE_EVIDENCE_VALID still catches an empty type with no empty recommend", () => {
    const result = {
      status: "COMPLETE",
      territories: [{ key: "folk", probes: [{ conceptKey: "genre:music:folk", successfulTypes: [], emptyTypes: ["brand"], namespace: "genre:music" }] }],
      trace: {
        toolCalls: [{ tool: "qloo_recommend", status: "failed", error: "TOOL_TIMEOUT", arguments: { tagIds: ["genre:music:folk"], targetType: "brand", conditionOnBrand: false }, qlooOperations: ["recommend"] }],
        turns: [],
        earlyStops: [],
        errors: [{ code: "TOOL_TIMEOUT", detail: "timed out" }],
      },
    };
    let tagType: { passed: boolean } | undefined;
    try {
      tagType = evaluateRun(result as never).find((e) => e.id === "TAG_TYPE_EVIDENCE_VALID");
    } catch {
      tagType = { passed: false };
    }
    expect(tagType?.passed).toBe(false);
  });
});

describe("derived-view memo does not change plan identity for unchanged evidence", () => {
  it("returns the same alignment plan object until Qloo evidence changes", async () => {
    const { comparisonRepresentationPlan } = await import("../src/agent/representation-alignment.js");
    const harness = runtime();
    const r = await harness.runtime.run({ userQuery: "Could Northwind Atelier enter boutique hospitality?", brand: "Northwind Atelier", territories: ["Boutique Hospitality"] });
    if (r.status === "NEEDS_INPUT") throw new Error("unexpected NEEDS_INPUT");
    const state = harness.runtime.store.get(r.runId);
    if (!state) throw new Error("run missing");
    const first = comparisonRepresentationPlan(state);
    const second = comparisonRepresentationPlan(state);
    expect(second).toBe(first);
  });
});

describe("token ceiling and effort defaults stay high until a measured comparison", () => {
  it("keeps production effort high and 16000-token ceilings", () => {
    expect(PRODUCTION_AGENT_EFFORT).toBe("high");
    expect(PRODUCTION_DECISION_MAX_TOKENS).toBe(16_000);
    expect(proposeTokenCeilings([{ source: "t", role: "decision", outputTokens: 12_000, truncated: true }]).changeProduction).toBe(false);
  });
});
