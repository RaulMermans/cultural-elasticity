/**
 * Runtime control flow with the ScriptedAgentModel (a test tool): state transitions, invalid model
 * actions, budgets, ask_user/continue, Qloo status handling, fallback routes and the rule that the
 * model cannot change deterministic results. SYNTHETIC world only.
 */
import type { AgentAnalysisResult, AgentNeedsInputResponse } from "@cultural-elasticity/shared";
import { describe, expect, it } from "vitest";
import { AgentInputError, RunNotWaitingError } from "../src/agent/errors.js";
import { BaselinePolicyModel } from "../src/agent/model/baseline.js";
import type { AgentDecisionContext } from "../src/agent/model/provider.js";
import { ScriptedAgentModel, type ScriptStep } from "../src/agent/model/scripted.js";
import { call, runtime } from "./fixtures/synthetic/agent.js";

const TABLEWARE = "urn:tag:industry:syn:tableware";
const asResult = (r: unknown) => r as AgentAnalysisResult;

/** Script: interpret → resolve → tags+pool → anchor+represent → analyze → finish, for one move. */
function moveSteps(): ScriptStep[] {
  return [
    [call("interpret_request", { intent: "analyze_move", brand: "Saffron & Salt", territories: ["Tableware"] })],
    [call("qloo_resolve_entity", { name: "Saffron & Salt", type: "brand", role: "brand" })],
    [call("qloo_find_tags", { query: "Tableware", limit: 5 }), call("qloo_recommend", { targetType: "brand", tagIds: [TABLEWARE], conditionOnBrand: false, limit: 20 })],
    [
      call("anchor_territory", { territoryKey: "tableware", tagId: TABLEWARE }),
      call("validate_territory_representation", { territoryKey: "tableware", entityType: "brand", exemplars: [{ id: "SYN-BR-0201", reason: "craft studio" }, { id: "SYN-BR-0204", reason: "heritage house" }] }),
    ],
    [{ action: "analyze", targetIds: ["tableware"], reasonSummary: "evidence gathered" }],
    // Sprint 5A: a first early analyze of a target is deferred once (REFERENCES_PENDING) while references are
    // constructible; repeating it proceeds, and the result is an honest PARTIAL.
    [{ action: "analyze", targetIds: ["tableware"], reasonSummary: "accept a partial result" }],
    [{ action: "finish", resultIds: ["tableware"], reasonSummary: "done" }],
  ];
}

function moveScript(extra: { synthesis?: unknown[] } = {}) {
  return new ScriptedAgentModel(moveSteps(), extra.synthesis ?? [], "move");
}

describe("runtime control flow", () => {
  it("runs a scripted move end to end through the expected states", async () => {
    const { runtime: rt, provider } = runtime(moveScript());
    const result = asResult(await rt.run({ userQuery: "Could Saffron & Salt enter tableware?" }));
    expect(result.status).toBe("COMPLETE");
    expect(result.trace.statusTransitions.map((t) => t.to)).toEqual(["PLANNING", "RESOLVING", "INVESTIGATING", "ANALYZING", "INVESTIGATING", "COMPLETE"]);
    const t = result.territories[0]!;
    // One rankable territory: no comparison set, so the methodology is not forced; the route degrades.
    expect(t.analysisRoute).toBe("PARTIAL_CULTURAL_ANALYSIS");
    expect(t.relativePosition).toBeNull();
    expect(t.classification).toBeNull();
    expect(t.limitations.map((l) => l.code)).toContain("COMPARISON_SET_TOO_SMALL");
    expect(result.metrics.qloo_calls).toBe(provider.world.requests.length);
    expect(result.evidenceOrigin).toBe("synthetic");
    expect(result.limitations.map((l) => l.code)).toEqual(expect.arrayContaining(["SYNTHETIC_EVIDENCE", "AGENT_POLICY_NOT_LLM", "NOT_A_SUCCESS_PREDICTION"]));
  });

  it("rejects invalid model output and fails after the consecutive-invalid limit", async () => {
    // Each invalid turn gets exactly one bounded repair attempt (the second script step answers it).
    const model = new ScriptedAgentModel([{ invalid: "not json" }, [{ action: "dance" }], { invalid: "still not json" }, [{ action: "dance" }], [call("interpret_request", { intent: "explore_frontier", brand: "Lumen Play", territories: [] })]]);
    const result = asResult(await runtime(model).runtime.run({ userQuery: "q" }));
    expect(result.status).toBe("FAILED");
    expect(result.trace.turns[0]!.decisions[0]).toMatchObject({ accepted: false, rejection: expect.stringMatching(/^INVALID_MODEL_OUTPUT: not json/u) });
    expect(result.trace.turns[0]!.decisions[1]).toMatchObject({ accepted: false, rejection: expect.stringMatching(/^INVALID_DECISION/u) });
    expect(result.trace.turns[0]).toMatchObject({ modelAttempts: 2, firstAttemptValid: false, repairReason: expect.stringMatching(/INVALID_MODEL_OUTPUT/u) });
    expect(result.metrics).toMatchObject({ repairs: 2, model_attempts: 4, first_attempt_valid_turns: 0, valid_after_repair_turns: 0 });
    expect(result.metrics.agent_iterations).toBe(2);
    expect(result.metrics.qloo_calls).toBe(0);
  });

  it("rejects unknown and unauthorized tools, and terminal actions that are not last", async () => {
    const model = new ScriptedAgentModel([
      [call("interpret_request", { intent: "analyze_move", brand: "Lumen Play", territories: ["Esports"] }), call("write_file", { path: "/etc/passwd" }), { action: "finish", resultIds: [], reasonSummary: "too early" }, call("qloo_find_tags", { query: "x" })],
    ]);
    const result = asResult(await runtime(model).runtime.run({ userQuery: "q" }));
    const decisions = result.trace.turns[0]!.decisions;
    expect(decisions.find((d) => d.tool === "write_file")).toMatchObject({ accepted: false, rejection: expect.stringMatching(/^UNKNOWN_TOOL/u) });
    // finish is not offered by the skills active at this point (interpretation / brand resolution).
    expect(decisions.find((d) => d.action === "finish")).toMatchObject({ accepted: false, rejection: expect.stringMatching(/^NOT_EXPOSED/u) });
    expect(decisions.find((d) => d.action === "ignored")).toBeUndefined();
  });

  it("enforces the per-turn action limit", async () => {
    const many = Array.from({ length: 14 }, (_, i) => call("qloo_find_tags", { query: `q${i}` }));
    const model = new ScriptedAgentModel([[call("interpret_request", { intent: "explore_frontier", brand: "Lumen Play", territories: [] })], many]);
    const result = asResult(await runtime(model).runtime.run({ userQuery: "q" }));
    const rejected = result.trace.turns[1]!.decisions.filter((d) => d.rejection?.startsWith("TOO_MANY_ACTIONS"));
    expect(rejected).toHaveLength(14 - result.trace.limits.maxActionsPerTurn!);
  });

  it("stops at the iteration budget (BUDGET_EXHAUSTED), never loops", async () => {
    const forever: ScriptStep = () => [call("qloo_find_tags", { query: `x${Math.random()}` })];
    const model = new ScriptedAgentModel([[call("interpret_request", { intent: "explore_frontier", brand: "Lumen Play", territories: [] })], [call("qloo_resolve_entity", { name: "Lumen Play", type: "brand", role: "brand" })], ...Array.from({ length: 50 }, () => forever)]);
    const result = asResult(await runtime(model).runtime.run({ userQuery: "q", limits: { maxAgentIterations: 4 } }));
    expect(result.status).toBe("BUDGET_EXHAUSTED");
    expect(result.metrics.agent_iterations).toBe(4);
    expect(result.metrics.budget_exhausted).toBe(true);
  });

  it("stops at the Qloo budget and analyzes nothing it cannot pay for", async () => {
    const result = asResult(await runtime(new BaselinePolicyModel()).runtime.run({ userQuery: "q", brand: "Northwind Atelier", territories: ["Boutique Hospitality"], limits: { maxQlooCalls: 4 } }));
    expect(result.metrics.qloo_calls).toBeLessThanOrEqual(4);
    expect(["BUDGET_EXHAUSTED", "COMPLETE"]).toContain(result.status);
  });

  it("asks the user on a real ambiguity and resumes with the clarification", async () => {
    const { runtime: rt } = runtime(new BaselinePolicyModel());
    const first = (await rt.run({ userQuery: "Could Meridian enter skincare?", brand: "Meridian", territories: ["Skincare"] })) as AgentNeedsInputResponse;
    expect(first.status).toBe("NEEDS_INPUT");
    expect(first.options.map((o) => o.id)).toEqual(["SYN-BR-0005", "SYN-BR-0006"]);
    // No silent choice: nothing beyond the ambiguous describe call was made.
    expect(first.metrics.qloo_calls).toBe(1);
    await expect(rt.continue(first.runId, "  ")).rejects.toBeInstanceOf(AgentInputError);
  });

  it("continues a NEEDS_INPUT run with a scripted model that resolves the chosen candidate", async () => {
    const model = new ScriptedAgentModel([
      [call("interpret_request", { intent: "analyze_move", brand: "Meridian", territories: ["Skincare"] })],
      [call("qloo_resolve_entity", { name: "Meridian", type: "brand", role: "brand" })],
      // Trying to resolve a candidate before the user answers is refused.
      [call("qloo_resolve_entity", { name: "SYN-BR-0005", type: "brand", role: "brand" }), { action: "ask_user", question: "Which Meridian?", ambiguity: "two Qloo brands" }],
      (ctx: AgentDecisionContext) => [call("qloo_resolve_entity", { name: /audio/iu.test(ctx.clarifications[0]!) ? "SYN-BR-0005" : "SYN-BR-0006", type: "brand", role: "brand" })],
      [{ action: "finish", resultIds: [], reasonSummary: "stop" }],
    ]);
    const { runtime: rt } = runtime(model);
    const first = (await rt.run({ userQuery: "q" })) as AgentNeedsInputResponse;
    expect(first.status).toBe("NEEDS_INPUT");
    expect(first.trace.turns[2]!.decisions[0]).toMatchObject({ accepted: false, rejection: expect.stringMatching(/^NEEDS_USER_INPUT|^PRECONDITION/u) });
    const second = asResult(await rt.continue(first.runId, "The audio company"));
    expect(second.brand).toMatchObject({ id: "SYN-BR-0005", resolution: "confirmed" });
    expect(second.trace.userClarifications).toEqual(["The audio company"]);
    await expect(rt.continue(first.runId, "again")).rejects.toBeInstanceOf(RunNotWaitingError);
  });

  it("retries a retryable Qloo error exactly once and flags degraded results", async () => {
    const faults = [
      { operation: "find_tags", whenInputContains: "Tableware", status: "error" as const, code: "QLOO_RATE_LIMIT", retryable: true, times: 1 },
      { operation: "recommend", whenInputContains: "tableware", status: "degraded" as const, times: 1 },
    ];
    const { runtime: rt } = runtime(moveScript(), faults);
    const result = asResult(await rt.run({ userQuery: "q" }));
    expect(result.metrics.retry_count).toBe(1);
    expect(result.trace.toolCalls.find((c) => c.tool === "qloo_find_tags")).toMatchObject({ status: "ok", attempts: 2 });
    expect(result.limitations.map((l) => l.code)).toContain("QLOO_DEGRADED");
  });

  it("does not retry a non-retryable error and degrades instead of inventing evidence", async () => {
    const faults = [{ operation: "recommend", whenInputContains: "tableware", status: "error" as const, code: "QLOO_UPSTREAM", retryable: false, times: 5 }];
    const result = asResult(await runtime(moveScript(), faults).runtime.run({ userQuery: "q" }));
    expect(result.metrics.retry_count).toBe(0);
    const t = result.territories[0]!;
    expect(t.representation.exemplars).toHaveLength(0);
    // The pool call failed, so the proposed ids were never observed in a Qloo response: unresolved, not assumed.
    expect(t.representation.rejectedExemplars.map((r) => r.code)).toContain("ENTITY_UNRESOLVED");
    expect(["DESCRIPTIVE_ANALYSIS", "INSUFFICIENT_EVIDENCE"]).toContain(t.analysisRoute);
  });

  it("finalizes on deterministic sufficiency when the model keeps calling tools", async () => {
    const steps: ScriptStep[] = [...moveSteps().slice(0, 6), [call("qloo_find_tags", { query: "more please" })], [call("qloo_find_tags", { query: "even more" })]];
    const result = asResult(await runtime(new ScriptedAgentModel(steps)).runtime.run({ userQuery: "q" }));
    expect(result.status).toBe("COMPLETE");
    expect(result.trace.toolCalls.filter((c) => c.status === "rejected").map((c) => c.error)).toContain("EVIDENCE_SUFFICIENT");
    expect(result.trace.errors.map((e) => e.code)).toContain("RUNTIME_FINALIZED_ON_SUFFICIENCY");
  });
});

describe("the model cannot change deterministic results", () => {
  it("rejects a synthesis that invents a class, a number and a success claim; falls back to the template", async () => {
    const lying = { summary: "Tableware is a natural adjacency with an 82% chance of success.", territoryNotes: [{ territoryKey: "tableware", text: "Robustness is high." }], followUpOptions: [] };
    const model = moveScript({ synthesis: [lying, lying] });
    const result = asResult(await runtime(model).runtime.run({ userQuery: "q" }));
    expect(result.summary.source).toBe("deterministic_template");
    expect(result.summary.claimValidation.passed).toBe(true);
    expect(result.summary.claimValidation.violations.join(" ")).toMatch(/NATURAL_ADJACENCY|82|chance|robustness/u);
    expect(result.trace.synthesis).toMatchObject({ source: "deterministic_template", attempts: 2 });
    expect(result.summary.text).not.toMatch(/82|chance|natural adjacency/iu);
  });

  it("accepts a faithful synthesis but still copies every value from deterministic code", async () => {
    const honest = { summary: "Tableware has partial cultural evidence only: shared signals and a brand-conditioned Qloo list, but no relative position.", territoryNotes: [], followUpOptions: ["Add reference territories."] };
    const result = asResult(await runtime(moveScript({ synthesis: [honest] })).runtime.run({ userQuery: "q" }));
    expect(result.summary.source).toBe("model");
    expect(result.territories[0]!.analysisRoute).toBe("PARTIAL_CULTURAL_ANALYSIS");
    expect(result.followUpOptions).toEqual(["Add reference territories."]);
  });

  it("never shows the model benchmark labels or hidden data", async () => {
    const model = moveScript();
    await runtime(model).runtime.run({ userQuery: "q" });
    const seen = JSON.stringify([model.seen, model.seenFinalization]);
    expect(seen).not.toMatch(/expected_(strong|mid|weak)|benchmark|QLOO_API_KEY|ANTHROPIC_API_KEY/iu);
  });
});
