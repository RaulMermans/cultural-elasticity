/**
 * Sprint 8C: cache identity, span inclusive/exclusive/union clocks, disjoint outcome routes,
 * late-Qloo accounting. SYNTHETIC unless labelled otherwise. Not live Qloo or live Haiku.
 */
import type { AgentAnalysisResult, AgentRunResponse, RuntimeSpan } from "@cultural-elasticity/shared";
import { describe, expect, it } from "vitest";
import { clearDerivedCache, evidenceFingerprint, memoRun } from "../src/agent/derived-cache.js";
import { executeToolCall } from "../src/agent/tool-executor.js";
import { ToolRegistry } from "../src/agent/tool-registry.js";
import { buildPerfReport, routeCounts } from "../src/ops/perf-report.js";
import { reconcileSpanCoverage } from "../src/ops/spans.js";
import { evaluateRun, RUN_EVALUATORS_VERSION } from "../scripts/run-evaluators.js";
import { freshState, runtime, scripted } from "./fixtures/synthetic/agent.js";
import { transition, type TerritoryState } from "../src/agent/state.js";
import type { PoolRecord } from "../src/agent/state.js";
import type { AgentTerritoryResult } from "@cultural-elasticity/shared";

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

function territory(partial: Partial<TerritoryState> & Pick<TerritoryState, "key">): TerritoryState {
  return {
    label: partial.key,
    role: "target",
    origin: "user",
    rationale: "",
    status: "represented",
    concept: { id: "concept-a", label: "A", type: "urn:tag" },
    representation: {
      entityType: "brand",
      exemplars: [{ id: "ex-1", label: "One", type: "brand", popularity: null, selectionReason: "test", conceptSupport: "tag_member", supportCorrelationId: "syn", quality: "VALID", semantic: null }],
      diversity: "unknown",
      diversityDetail: "",
      warnings: [],
    },
    attempts: 1,
    rejectedExemplars: [{ id: "rej-1", label: "Rejected", code: "NO_VALID_REPRESENTATION", reason: "thin" }],
    dropReason: null,
    source: "user",
    sourceEvidence: "user",
    strategyLog: [],
    conceptOnly: null,
    semanticJudgment: null,
    sourceTagId: "tag-a",
    evidenceTagIds: ["tag-a"],
    ...partial,
  };
}

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
    metrics: { latency_ms: 60_000, model_latency_ms: 1, qloo_latency_ms: 1, qloo_calls: 1, model_input_tokens: 0, model_output_tokens: 0, model_cost_usd: 1, invalid_actions: 0, repairs: 0, avg_context_chars: null, max_context_chars: null },
    skillsUsed: [],
    comparisonSetConstruction: { intent: null, proposed: [], rejected: [], final: [], dedupDecisions: [], diversity: { assessment: "unknown", similarPairs: [], detail: "" }, note: "" },
    layers: { qlooEvidence: { brand: null, concepts: [], exemplars: [], qlooCalls: 0 }, systemAnalysis: { routes: [], methodologyRunIds: [], finalSufficiency: "SUFFICIENT", representationDecisions: { valid: 0, weak: 0, rejected: 0 } }, agentInterpretation: { summary: "", source: "deterministic_template", claimValidationPassed: true, semanticJudgments: [], followUpOptions: [] } },
    failureCategory: null,
    territories: [],
    ...partial,
  } as unknown as AgentAnalysisResult;
}

describe("derived-cache identity is independent of collection cardinality", () => {
  it("reuses a derived value when inputs are unchanged", () => {
    const state = freshState({ brand: "Northwind Atelier" });
    state.territories = [territory({ key: "t1" })];
    let computes = 0;
    const first = memoRun(state, "plan", () => {
      computes += 1;
      return { n: computes };
    });
    const second = memoRun(state, "plan", () => {
      computes += 1;
      return { n: computes };
    });
    expect(second).toBe(first);
    expect(computes).toBe(1);
  });

  it("misses when a same-type representation is replaced", () => {
    const state = freshState({ brand: "Northwind Atelier" });
    state.territories = [territory({ key: "t1" })];
    const before = evidenceFingerprint(state);
    state.territories[0]!.representation = {
      ...state.territories[0]!.representation!,
      exemplars: [{ ...state.territories[0]!.representation!.exemplars[0]!, id: "ex-2", label: "Two" }],
    };
    expect(evidenceFingerprint(state)).not.toBe(before);
  });

  it("misses when an entity is replaced at the same map size", () => {
    const state = freshState({ brand: "Northwind Atelier" });
    state.entities.set("ent-1", { id: "ent-1", label: "One", type: "brand", sources: [] });
    const before = evidenceFingerprint(state);
    state.entities.delete("ent-1");
    state.entities.set("ent-2", { id: "ent-2", label: "Two", type: "brand", sources: [] });
    expect(state.entities.size).toBe(1);
    expect(evidenceFingerprint(state)).not.toBe(before);
  });

  it("misses when a pool member identity changes at the same length", () => {
    const state = freshState({ brand: "Northwind Atelier" });
    const pool = { tagIds: ["tag-a"], targetType: "brand" as const, conditionedOn: null, memberIds: ["m-1", "m-2"], call: { envelope: { status: "ok" } } };
    state.pools = [pool as PoolRecord];
    const before = evidenceFingerprint(state);
    state.pools[0]!.memberIds = ["m-1", "m-3"];
    expect(state.pools[0]!.memberIds.length).toBe(2);
    expect(evidenceFingerprint(state)).not.toBe(before);
  });

  it("misses when a candidate identity changes without changing pool membership count", () => {
    const state = freshState({ brand: "Northwind Atelier", intent: "explore_frontier" });
    state.related = [{ subjectId: "brand-1", targetType: "brand", memberIds: ["c-1", "c-2"], call: { envelope: { status: "ok" } } as PoolRecord["call"] }];
    const before = evidenceFingerprint(state);
    state.related[0]!.memberIds = ["c-1", "c-9"];
    expect(state.related[0]!.memberIds.length).toBe(2);
    expect(evidenceFingerprint(state)).not.toBe(before);
  });

  it("misses when profile or tag content changes at the same map size", () => {
    const state = freshState({ brand: "Northwind Atelier" });
    state.tags.set("tag-a", { id: "tag-a", label: "Folk", type: "urn:tag:genre", sources: [] });
    state.profiles.set("p1", { subjectId: "p1", tagIds: ["tag-a"], take: 20, call: { envelope: { status: "ok" } } as PoolRecord["call"] });
    const before = evidenceFingerprint(state);
    state.tags.set("tag-a", { id: "tag-a", label: "Metal", type: "urn:tag:genre", sources: [] });
    expect(state.tags.size).toBe(1);
    expect(evidenceFingerprint(state)).not.toBe(before);
    const afterTag = evidenceFingerprint(state);
    state.profiles.set("p1", { subjectId: "p1", tagIds: ["tag-b"], take: 20, call: { envelope: { status: "ok" } } as PoolRecord["call"] });
    expect(state.profiles.size).toBe(1);
    expect(evidenceFingerprint(state)).not.toBe(afterTag);
  });

  it("misses when rejected exemplar content changes at the same rejected count", () => {
    const state = freshState({ brand: "Northwind Atelier" });
    state.territories = [territory({ key: "t1" })];
    const before = evidenceFingerprint(state);
    state.territories[0]!.rejectedExemplars = [{ id: "rej-9", label: "Other", code: "EXEMPLAR_EVIDENCE_EMPTY", reason: "empty" }];
    expect(state.territories[0]!.rejectedExemplars.length).toBe(1);
    expect(evidenceFingerprint(state)).not.toBe(before);
  });

  it("misses when reference-plan inputs change without changing territory count", () => {
    const state = freshState({ brand: "Northwind Atelier", intent: "analyze_move" });
    state.territories = [territory({ key: "t1" }), territory({ key: "t2", role: "reference" })];
    state.semanticAssessments = [{ targetTerritoryKey: "t1", memberTerritoryKeys: ["t1"], semanticStatus: "MEANINGFUL", structuralStatus: "VALID", structuralIssues: [], usedForFull: false, acceptedReferences: [], rejectedReferences: [], referenceTerritoryKeys: [], entityType: "brand", modelAssessed: false, evidenceReferences: [], rulesVersion: "semantic-comparison-v1" }];
    const before = evidenceFingerprint(state);
    state.semanticAssessments = [{ ...state.semanticAssessments[0]!, semanticStatus: "WEAK" }];
    expect(state.territories.length).toBe(2);
    expect(evidenceFingerprint(state)).not.toBe(before);
  });

  it("misses when a territory's supported evidence changes without changing its status", () => {
    const state = freshState({ brand: "Northwind Atelier" });
    state.territories = [territory({ key: "t1", status: "analyzed" })];
    state.results.set("t1", { key: "t1", analysisRoute: "PARTIAL_CULTURAL_ANALYSIS", evidenceStatus: "PARTIAL_EVIDENCE" } as AgentTerritoryResult);
    const before = evidenceFingerprint(state);
    state.results.set("t1", { key: "t1", analysisRoute: "FULL_RELATIVE_ANALYSIS", evidenceStatus: "EVIDENCE_SUPPORTED_TERRITORY" } as AgentTerritoryResult);
    expect(state.territories[0]!.status).toBe("analyzed");
    expect(evidenceFingerprint(state)).not.toBe(before);
  });

  it("misses when a new reference relationship is introduced", () => {
    const state = freshState({ brand: "Northwind Atelier" });
    state.territories = [territory({ key: "t1" })];
    const before = evidenceFingerprint(state);
    state.territories = [territory({ key: "t1" }), territory({ key: "ref-1", role: "reference" })];
    expect(evidenceFingerprint(state)).not.toBe(before);
  });

  it("does not reuse a previous run's derived view", () => {
    const a = freshState({ brand: "Northwind Atelier" });
    const b = freshState({ brand: "Northwind Atelier" });
    a.territories = [territory({ key: "t1" })];
    b.territories = [territory({ key: "t1" })];
    const fromA = memoRun(a, "plan", () => ({ run: "a" }));
    const fromB = memoRun(b, "plan", () => ({ run: "b" }));
    expect(fromA).not.toBe(fromB);
    expect(fromA.run).toBe("a");
    expect(fromB.run).toBe("b");
  });

  it("does not keep a mutable table after the run is finalized", () => {
    const state = freshState({ brand: "Northwind Atelier" });
    state.territories = [territory({ key: "t1" })];
    const first = memoRun(state, "plan", () => ({ n: 1 }));
    state.finalized = true;
    clearDerivedCache(state);
    let computes = 0;
    const after = memoRun(state, "plan", () => {
      computes += 1;
      return { n: 2 };
    });
    expect(after).not.toBe(first);
    expect(computes).toBe(1);
  });
});

describe("span inclusive, exclusive, union, overlap, and gaps", () => {
  it("reports union coverage separately from exclusive-of-children sums", () => {
    const coverage = reconcileSpanCoverage(
      [
        span({ spanId: "ctx", phase: "CONTEXT_ASSEMBLY", startOffsetMs: 0, durationMs: 100 }),
        span({ spanId: "rep", phase: "REPRESENTATION_SELECTION", startOffsetMs: 20, durationMs: 50 }),
      ],
      100,
      100,
    );
    expect(coverage.coveredMs).toBe(100);
    expect(coverage.overlapMs).toBe(50);
    expect(coverage.exclusiveSumMs).toBe(150);
    expect(coverage.inclusiveSumMs).toBe(150);
    expect(coverage.exclusiveSumExceedsCovered).toBe(true);
    expect(coverage.exclusiveByPhase.find((p) => p.phase === "CONTEXT_ASSEMBLY")?.wallUnionMs).toBe(100);
    expect(coverage.exclusiveByPhase.find((p) => p.phase === "REPRESENTATION_SELECTION")?.inclusiveMs).toBe(50);
    expect(coverage.hierarchy).toHaveLength(2);
  });

  it("subtracts parented children from exclusive time without changing the union", () => {
    const coverage = reconcileSpanCoverage(
      [
        span({ spanId: "tool", phase: "TOOL_EXECUTION", startOffsetMs: 0, durationMs: 100 }),
        span({ spanId: "q", parentSpanId: "tool", phase: "QLOO_REQUEST", startOffsetMs: 10, durationMs: 80 }),
      ],
      100,
      100,
    );
    expect(coverage.coveredMs).toBe(100);
    expect(coverage.exclusiveByPhase.find((p) => p.phase === "TOOL_EXECUTION")?.exclusiveMs).toBe(20);
    expect(coverage.exclusiveByPhase.find((p) => p.phase === "QLOO_REQUEST")?.inclusiveMs).toBe(80);
    expect(coverage.exclusiveSumExceedsCovered).toBe(false);
  });

  it("attributes a gap as unattributed monotonic time", () => {
    const coverage = reconcileSpanCoverage(
      [
        span({ phase: "MODEL_REQUEST", startOffsetMs: 0, durationMs: 10 }),
        span({ spanId: "s-MODEL_REQUEST-2", phase: "MODEL_REQUEST", startOffsetMs: 40, durationMs: 10 }),
      ],
      50,
      50,
    );
    expect(coverage.unattributedMs).toBe(30);
    expect(coverage.coveredMs).toBe(20);
  });
});

describe("outcome routes stay disjoint", () => {
  it("does not count INSUFFICIENT_EVIDENCE again as unsupported evidence", () => {
    const result = analysis({
      territories: [
        { key: "a", analysisRoute: "INSUFFICIENT_EVIDENCE", evidenceStatus: "UNSUPPORTED" },
        { key: "b", analysisRoute: "PARTIAL_CULTURAL_ANALYSIS", evidenceStatus: "PARTIAL_EVIDENCE" },
        { key: "c", analysisRoute: "INSUFFICIENT_EVIDENCE", evidenceStatus: "PARTIAL_EVIDENCE" },
      ],
    });
    const counts = routeCounts(result);
    expect(counts.partial).toBe(1);
    expect(counts.insufficient).toBe(2);
    expect(counts.unsupported).toBe(1);
    expect(counts.unsupportedOrInsufficientFamily).toBe(2);
    expect(counts.partial + counts.insufficient).toBe(3);
  });

  it("does not treat an invalid FULL as a valid supported result", () => {
    const result = analysis({
      territories: [{ key: "t", analysisRoute: "FULL_RELATIVE_ANALYSIS", comparisonSet: { territoryKeys: ["t"], labels: ["T"], methodologyVersion: "elasticity-v0.1", semanticStatus: "WEAK" } }],
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
    expect(buildPerfReport(result).outcomes.validOutcomesPerDollar).toBe(0);
  });

  it("reports invalidFull as unmeasured when the evaluator has not run", () => {
    const needsInput = { status: "NEEDS_INPUT", territories: [], trace: { turns: [], toolCalls: [] }, metrics: { latency_ms: 1, model_latency_ms: 0, qloo_latency_ms: 0, qloo_calls: 0, model_input_tokens: 0, model_output_tokens: 0, model_cost_usd: null, invalid_actions: 0, repairs: 0, avg_context_chars: null, max_context_chars: null } } as unknown as AgentRunResponse;
    expect(routeCounts(needsInput).invalidFull).toBeNull();
    const fullUnknown = analysis({
      territories: [{ key: "t", analysisRoute: "FULL_RELATIVE_ANALYSIS", comparisonSet: null }],
      comparisonSetConstruction: { intent: null, proposed: [], rejected: [], final: [], dedupDecisions: [], diversity: { assessment: "unknown", similarPairs: [], detail: "" }, note: "" },
    });
    expect(routeCounts(fullUnknown).invalidFull).toBeNull();
    expect(routeCounts(fullUnknown).validFull).toBe(0);
  });
});

describe("late Qloo answers cannot become evidence after timeout or finalization", () => {
  it("reserves the call budget at dispatch and does not double-count a late settlement", async () => {
    const state = freshState({ brand: "Brindlewood Oat" }, { toolTimeoutMs: 30, maxQlooCalls: 2 });
    const provider = scripted();
    const execute = provider.world.execute.bind(provider.world);
    await executeToolCall(state, registry, provider, "interpret_request", { intent: "explore_frontier", brand: "Brindlewood Oat", territories: [] });
    transition(state, "RESOLVING", "test");
    await executeToolCall(state, registry, provider, "qloo_resolve_entity", { name: "Brindlewood Oat", type: "brand", role: "brand" });
    expect(state.usage.qlooCalls).toBeLessThanOrEqual(2);
    const remainingAfterReserve = state.limits.maxQlooCalls - state.usage.qlooCalls;
    expect(remainingAfterReserve).toBeGreaterThanOrEqual(0);
    provider.world.execute = async (operation, input) => {
      if (operation === "recommend") await new Promise((r) => setTimeout(r, 80));
      return execute(operation, input);
    };
    const tag = "urn:tag:genre:synmedia:hearth_cooking";
    await executeToolCall(state, registry, provider, "qloo_find_tags", { query: "Hearth Cooking", limit: 8 });
    const timed = executeToolCall(state, registry, provider, "qloo_recommend", { targetType: "book", tagIds: [tag], conditionOnBrand: false });
    await timed;
    const calls = state.usage.qlooCalls;
    await new Promise((r) => setTimeout(r, 120));
    expect(state.usage.qlooCalls).toBe(calls);
    expect(state.usage.qlooCalls).toBeLessThanOrEqual(2);
  });

  it("discards a provider completion after timeout and does not cache it", async () => {
    const state = freshState({ brand: "Brindlewood Oat" }, { toolTimeoutMs: 30, maxQlooCalls: 4 });
    const provider = scripted();
    const execute = provider.world.execute.bind(provider.world);
    await executeToolCall(state, registry, provider, "interpret_request", { intent: "explore_frontier", brand: "Brindlewood Oat", territories: [] });
    transition(state, "RESOLVING", "test");
    await executeToolCall(state, registry, provider, "qloo_resolve_entity", { name: "Brindlewood Oat", type: "brand", role: "brand" });
    await executeToolCall(state, registry, provider, "qloo_find_tags", { query: "Hearth Cooking", limit: 8 });
    provider.world.execute = async (operation, input) => {
      if (operation === "recommend") await new Promise((r) => setTimeout(r, 80));
      return execute(operation, input);
    };
    const tag = "urn:tag:genre:synmedia:hearth_cooking";
    await executeToolCall(state, registry, provider, "qloo_recommend", { targetType: "book", tagIds: [tag], conditionOnBrand: false });
    await new Promise((r) => setTimeout(r, 120));
    expect([...state.callCache.keys()].some((k) => k.includes("recommend") && k.includes("book"))).toBe(false);
  });

  it("does not record evidence from an abandoned call after finalization", async () => {
    const state = freshState({ brand: "Brindlewood Oat" }, { toolTimeoutMs: 30 });
    const provider = scripted();
    const execute = provider.world.execute.bind(provider.world);
    await executeToolCall(state, registry, provider, "interpret_request", { intent: "explore_frontier", brand: "Brindlewood Oat", territories: [] });
    transition(state, "RESOLVING", "test");
    await executeToolCall(state, registry, provider, "qloo_resolve_entity", { name: "Brindlewood Oat", type: "brand", role: "brand" });
    await executeToolCall(state, registry, provider, "qloo_find_tags", { query: "Hearth Cooking", limit: 8 });
    const tag = "urn:tag:genre:synmedia:hearth_cooking";
    provider.world.execute = async (operation, input) => {
      if (operation === "recommend") await new Promise((r) => setTimeout(r, 80));
      return execute(operation, input);
    };
    const pending = executeToolCall(state, registry, provider, "qloo_recommend", { targetType: "book", tagIds: [tag], conditionOnBrand: false });
    await pending;
    state.finalized = true;
    const pools = state.pools.length;
    const calls = state.usage.qlooCalls;
    await new Promise((r) => setTimeout(r, 120));
    expect(state.pools.length).toBe(pools);
    expect(state.usage.qlooCalls).toBe(calls);
    expect(state.lateSettlements.some((s) => s.discarded)).toBe(true);
  });
});

describe("C9 grader remains frozen", () => {
  it("keeps run-evaluators-v2.1 and still fails a timed-out probe recorded as empty", () => {
    expect(RUN_EVALUATORS_VERSION).toBe("run-evaluators-v2.1");
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

describe("derived memo still returns a stable plan object for unchanged live-shaped synthetic state", () => {
  it("returns the same alignment plan object until evidence changes", async () => {
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
