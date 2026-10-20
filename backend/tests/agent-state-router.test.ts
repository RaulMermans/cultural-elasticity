/** Agent state machine, intake, intent routing and analysis-route selection. SYNTHETIC inputs only. */
import type { CapabilityAvailability } from "@cultural-elasticity/shared";
import { describe, expect, it } from "vitest";
import { agentRequestSchema, defaultLimits, interpretationSchema } from "../src/agent/contracts.js";
import { MIN_COMPARISON_SET, resolveInterpretation, selectAnalysisRoute, structuralIntent } from "../src/agent/router.js";
import { addTerritory, canTransition, createRunState, derivePhase, InvalidTransitionError, slugify, transition } from "../src/agent/state.js";
import { freshState } from "./fixtures/synthetic/agent.js";

const caps = (over: Partial<CapabilityAvailability>): CapabilityAvailability => ({
  representation: "SUPPORTED",
  relativePosition: "UNAVAILABLE",
  robustness: "UNAVAILABLE",
  coherence: "UNAVAILABLE",
  conditionedEvidence: "UNAVAILABLE",
  classification: "UNAVAILABLE",
  ...over,
});

describe("agent state machine", () => {
  it("starts at INTAKE and records every transition", () => {
    const state = createRunState({ userQuery: "q" }, { id: "m", kind: "scripted", live: false }, { name: "p", mode: "scripted", evidenceSource: "s" });
    expect(state.status).toBe("INTAKE");
    transition(state, "PLANNING", "ok");
    transition(state, "RESOLVING", "ok");
    expect(state.trace.statusTransitions.map((t) => `${t.from}>${t.to}`)).toEqual(["INTAKE>PLANNING", "PLANNING>RESOLVING"]);
  });

  it("refuses transitions outside the table and out of terminal states", () => {
    const state = freshState();
    expect(() => transition(state, "INTAKE", "no")).toThrow(InvalidTransitionError);
    transition(state, "COMPLETE", "done");
    for (const to of ["PLANNING", "INVESTIGATING", "FAILED"] as const) expect(canTransition("COMPLETE", to)).toBe(false);
    expect(canTransition("NEEDS_INPUT", "PLANNING")).toBe(true);
    expect(canTransition("NEEDS_INPUT", "INVESTIGATING")).toBe(false);
  });

  it("derives the working phase from evidence, not from the model", () => {
    const state = freshState();
    expect(derivePhase(state)).toBe("PLANNING");
    state.interpretation = { intent: "explore_frontier", brand: "x", territories: [] };
    expect(derivePhase(state)).toBe("RESOLVING");
    state.pendingQuestion = { question: "?", ambiguity: "a", options: [] };
    expect(derivePhase(state)).toBe("NEEDS_INPUT");
  });

  it("keys territories deterministically and never collides", () => {
    const state = freshState();
    expect(slugify("Arts & Crafts!")).toBe("arts_crafts");
    const a = addTerritory(state, { label: "Arts & Crafts", role: "target", origin: "user", rationale: "r" });
    const b = addTerritory(state, { label: "arts crafts", role: "reference", origin: "agent_hypothesis", rationale: "r" });
    expect([a.key, b.key]).toEqual(["arts_crafts", "arts_crafts_2"]);
  });
});

describe("deterministic intake", () => {
  it("validates requests and limits", () => {
    expect(agentRequestSchema.safeParse({ userQuery: "  " }).success).toBe(false);
    expect(agentRequestSchema.safeParse({ userQuery: "q", extra: 1 }).success).toBe(false);
    expect(agentRequestSchema.safeParse({ userQuery: "q", limits: { maxAgentIterations: 0 } }).success).toBe(false);
    expect(agentRequestSchema.safeParse({ userQuery: "q", brand: "b", territories: ["a", "b"] }).success).toBe(true);
  });

  it("uses the spec's starting budgets per intent", () => {
    // Sprint 4 budgets (candidate-profile quality checks and smaller just-in-time turns; see contracts.ts).
    expect(defaultLimits("analyze_move")).toMatchObject({ maxAgentIterations: 12, maxQlooCalls: 24, maxRepresentationAttemptsPerTerritory: 3, maxCandidateTerritories: 6, maxExemplarsPerTerritory: 3, maxRetryPerToolCall: 1 });
    expect(defaultLimits("compare_territories").maxQlooCalls).toBe(32);
    expect(defaultLimits("explore_frontier").maxQlooCalls).toBe(32);
  });
});

describe("intent routing", () => {
  it("checks the interpretation's structure against its intent", () => {
    expect(interpretationSchema.safeParse({ intent: "analyze_move", brand: "b", territories: [] }).success).toBe(false);
    expect(interpretationSchema.safeParse({ intent: "compare_territories", brand: "b", territories: ["x"] }).success).toBe(false);
    expect(interpretationSchema.safeParse({ intent: "explore_frontier", brand: "b", territories: ["x"] }).success).toBe(false);
    expect(interpretationSchema.safeParse({ intent: "compare_territories", brand: "b", territories: ["x", "X"] }).success).toBe(false);
  });

  it("lets explicit request fields win over the model's interpretation", () => {
    const request = { userQuery: "q", intent: "compare_territories" as const, brand: "Brand A", territories: ["x", "y"] };
    expect(resolveInterpretation(request, { intent: "explore_frontier", brand: "Brand A", territories: [] })).toMatchObject({ ok: false });
    expect(resolveInterpretation(request, { intent: "compare_territories", brand: "Brand B", territories: ["x", "y"] })).toMatchObject({ ok: false });
    expect(resolveInterpretation(request, { intent: "compare_territories", brand: "brand a", territories: ["y", "x"] })).toMatchObject({ ok: true });
  });

  it("derives intent from structure only when unambiguous", () => {
    expect(structuralIntent({ userQuery: "q" })).toBeUndefined();
    expect(structuralIntent({ userQuery: "q", brand: "b", territories: [] })).toBe("explore_frontier");
    expect(structuralIntent({ userQuery: "q", brand: "b", territories: ["x"] })).toBe("analyze_move");
    expect(structuralIntent({ userQuery: "q", brand: "b", territories: ["x", "y"] })).toBe("compare_territories");
  });
});

describe("analysis route selection", () => {
  it("maps capabilities to exactly one route", () => {
    expect(selectAnalysisRoute(caps({ relativePosition: "AVAILABLE", coherence: "AVAILABLE" }))).toBe("FULL_RELATIVE_ANALYSIS");
    expect(selectAnalysisRoute(caps({ coherence: "AVAILABLE", conditionedEvidence: "AVAILABLE" }))).toBe("PARTIAL_CULTURAL_ANALYSIS");
    expect(selectAnalysisRoute(caps({ coherence: "AVAILABLE" }))).toBe("DESCRIPTIVE_ANALYSIS");
    expect(selectAnalysisRoute(caps({ conditionedEvidence: "AVAILABLE" }))).toBe("DESCRIPTIVE_ANALYSIS");
    expect(selectAnalysisRoute(caps({ conditionedEvidence: "EMPTY" }))).toBe("INSUFFICIENT_EVIDENCE");
    expect(selectAnalysisRoute(caps({ coherence: "NOT_COLLECTED" }))).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("requires three territories for a relative position", () => {
    expect(MIN_COMPARISON_SET).toBe(3);
  });
});
