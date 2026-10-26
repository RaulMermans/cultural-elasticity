/** SYNTHETIC scripted runtime regression. These decisions are not live Haiku validation. */
import { describe, expect, it } from "vitest";
import { ScriptedAgentModel } from "../src/agent/model/scripted.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { queryBody } from "../src/agent/query/contracts.js";
import { createScriptedToolProvider } from "../scripts/synthetic/synthetic-world.js";
import { call, loadWorld, runtime } from "./fixtures/synthetic/agent.js";

const concept = "urn:tag:industry:syn:tableware";
const request = { userQuery: "Could Saffron & Salt investigate Tableware?", intent: "analyze_move" as const, brand: "Saffron & Salt", territories: ["Tableware"], researchMode: "single_hypothesis_v1" as const };

function steps() {
  return [
    [call("interpret_request", { intent: "analyze_move", brand: "Saffron & Salt", territories: ["Tableware"] })],
    [call("qloo_resolve_entity", { name: "Saffron & Salt", type: "brand", role: "brand" })],
    [call("qloo_find_tags", { query: "Tableware", limit: 5 }), call("qloo_recommend", { targetType: "brand", tagIds: [concept], conditionOnBrand: false, limit: 20 })],
    [call("anchor_territory", { territoryKey: "tableware", tagId: concept }), call("validate_territory_representation", { territoryKey: "tableware", entityType: "brand", exemplars: [{ id: "SYN-BR-0201", reason: "SYNTHETIC observed member" }] })],
    [{ action: "analyze", targetIds: ["tableware"], reasonSummary: "test the one hypothesis" }],
    [{ action: "finish", resultIds: ["tableware"], reasonSummary: "the target has been analyzed" }],
  ];
}

describe("single hypothesis v1, SYNTHETIC", () => {
  it("accepts the exact typed local job body and refuses a comparison-shaped mode", () => {
    const body = { query: request.userQuery, brand: request.brand, intent: request.intent, territories: request.territories, researchMode: request.researchMode };
    const parsed = queryBody.parse(body);
    expect("researchMode" in parsed ? parsed.researchMode : null).toBe("single_hypothesis_v1");
    expect(queryBody.safeParse({ ...body, intent: "compare_territories", territories: ["Tableware", "Books"] }).success).toBe(false);
  });

  it("analyzes one target without reference deferral and keeps a bounded qualitative contract", async () => {
    const model = new ScriptedAgentModel(steps());
    const { runtime: agent } = runtime(model);
    const result = await agent.run(request);
    expect(result.status, JSON.stringify({ errors: result.trace.errors, turns: result.trace.turns.map((turn) => turn.decisions), tools: result.trace.toolCalls })).toBe("COMPLETE");
    if (result.status !== "COMPLETE") return;
    expect(result.hypothesisAssessment?.version).toBe("single-hypothesis/v1");
    expect(result.trace.turns.flatMap((turn) => turn.decisions).some((decision) => decision.rejection?.startsWith("REFERENCES_PENDING"))).toBe(false);
    expect(result.trace.toolCalls.some((tool) => tool.tool === "propose_territory")).toBe(false);
    expect(result.trace.toolCalls.some((tool) => tool.tool === "analyze_evidence" && tool.qlooOperations.includes("recommend") && tool.correlationIds.length > 0)).toBe(true);
    expect(result.metrics.qloo_calls).toBeLessThanOrEqual(12);
    expect(result.territories).toHaveLength(1);
    expect(result.territories[0]!.analysisRoute).not.toBe("FULL_RELATIVE_ANALYSIS");
    expect(result.evidenceOrigin).toBe("synthetic");
  });

  it("rejects a request that tries to turn the single-hypothesis method into a comparison", async () => {
    const { runtime: agent } = runtime(new ScriptedAgentModel([]));
    await expect(agent.run({ ...request, intent: "compare_territories", territories: ["Tableware", "Books"] })).rejects.toThrow();
  });

  it("caps a caller-supplied provider budget at twelve dispatches", async () => {
    const model = new ScriptedAgentModel(steps());
    const { runtime: agent } = runtime(model);
    const result = await agent.run({ ...request, limits: { maxQlooCalls: 120, maxAgentIterations: 30 } });
    expect(result.trace.limits.maxQlooCalls).toBe(12);
    expect(result.trace.limits.maxAgentIterations).toBe(8);
  });

  it("counterfactual concept members change the scripted next action for the same question", async () => {
    const decide = (worldHasMembers: boolean) => {
      const world = loadWorld();
      if (!worldHasMembers) world.entities = world.entities.map((entity) => ({ ...entity, tags: entity.tags.filter((tag) => tag !== concept) }));
      const model = new ScriptedAgentModel([
        [call("interpret_request", { intent: "analyze_move", brand: "Saffron & Salt", territories: ["Tableware"] })],
        [call("qloo_resolve_entity", { name: "Saffron & Salt", type: "brand", role: "brand" })],
        [call("qloo_find_tags", { query: "Tableware", limit: 5 }), call("qloo_recommend", { targetType: "brand", tagIds: [concept], conditionOnBrand: false, limit: 20 })],
        (context) => {
          const members = context.evidence.recentConceptQueries?.find((query) => query.tagId === concept)?.members ?? 0;
          return members > 0
            ? [call("anchor_territory", { territoryKey: "tableware", tagId: concept }), call("validate_territory_representation", { territoryKey: "tableware", entityType: "brand", exemplars: [{ id: "SYN-BR-0201", reason: "SYNTHETIC observed member" }] })]
            : [call("anchor_territory", { territoryKey: "tableware", tagId: concept }), call("declare_concept_only", { territoryKey: "tableware", reason: "SYNTHETIC empty member pool" })];
        },
        [{ action: "analyze", targetIds: ["tableware"], reasonSummary: "analyze observed evidence" }],
        [{ action: "finish", resultIds: ["tableware"], reasonSummary: "no further useful call" }],
      ], [], "counterfactual-script");
      const agent = new AgentRuntime({ model, provider: createScriptedToolProvider(world) });
      return { agent, model };
    };
    const withMembers = decide(true);
    const withoutMembers = decide(false);
    const first = await withMembers.agent.run(request);
    const second = await withoutMembers.agent.run(request);
    const action = (result: typeof first) => result.trace.turns[3]?.decisions.filter((entry) => entry.accepted).map((entry) => entry.tool);
    expect(action(first)).toContain("validate_territory_representation");
    expect(action(second)).toContain("declare_concept_only");
    expect(withMembers.model.seen[3]?.evidence.recentConceptQueries?.[0]?.members).toBeGreaterThan(0);
    expect(withoutMembers.model.seen[3]?.evidence.recentConceptQueries?.[0]?.members).toBe(0);
    expect(first.status).not.toBe("NEEDS_INPUT");
    expect(second.status).not.toBe("NEEDS_INPUT");
    if (first.status !== "NEEDS_INPUT" && second.status !== "NEEDS_INPUT") {
      expect(first.evidenceOrigin).toBe("synthetic");
      expect(second.evidenceOrigin).toBe("synthetic");
    }
  });
});
