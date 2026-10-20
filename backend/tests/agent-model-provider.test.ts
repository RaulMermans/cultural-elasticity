/**
 * AnthropicAgentModel against a MOCKED client (no network, no key) and model selection. A live model run
 * is a separate, credentialed step (LIVE_AGENT_MODEL_VALIDATION_NOT_RUN when no key is configured).
 */
import { describe, expect, it } from "vitest";
import { AgentNotConfiguredError } from "../src/agent/errors.js";
import { createAgentModel, hasModelCredential } from "../src/agent/factory.js";
import { AnthropicAgentModel, DEFAULT_AGENT_MODEL } from "../src/agent/model/anthropic.js";
import type { AgentDecisionContext, FinalizationContext } from "../src/agent/model/provider.js";

type Request = Record<string, unknown>;

function mockClient(response: unknown) {
  const requests: Request[] = [];
  const client = { beta: { messages: { create: async (request: Request) => (requests.push(request), response) } } };
  return { client: client as never, requests };
}

const context = { runId: "r", iteration: 1, userQuery: "q", actions: ["analyze", "ask_user", "finish"], repair: null, tools: [{ name: "qloo_find_tags", description: "d", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } }] } as unknown as AgentDecisionContext;

describe("AnthropicAgentModel (mocked client)", () => {
  it("defaults to the current Opus model with auto tool choice, adaptive effort and refusal fallbacks", async () => {
    const { client, requests } = mockClient({ stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 }, content: [] });
    await new AnthropicAgentModel({ client }).decide(context);
    expect(DEFAULT_AGENT_MODEL).toBe("claude-opus-5-5");
    expect(requests[0]).toMatchObject({ model: "claude-opus-5-5", tool_choice: { type: "auto" }, fallbacks: "default", output_config: { effort: "high" } });
    const toolNames = (requests[0]!.tools as { name: string }[]).map((t) => t.name);
    expect(toolNames).toEqual(["qloo_find_tags", "analyze", "ask_user", "finish"]);
    expect(JSON.stringify(requests[0])).not.toMatch(/API_KEY|x-api-key/iu);
  });

  it("sends the server-side refusal fallback only to models that support it (not Haiku 5.5)", async () => {
    const opus = mockClient({ stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 }, content: [] });
    await new AnthropicAgentModel({ client: opus.client }).decide(context);
    expect(opus.requests[0]).toMatchObject({ fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
    const haiku = mockClient({ stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 }, content: [] });
    await new AnthropicAgentModel({ client: haiku.client, model: "claude-haiku-5-5" }).decide(context);
    expect(haiku.requests[0]).toMatchObject({ model: "claude-haiku-5-5" });
    expect(haiku.requests[0]).not.toHaveProperty("fallbacks");
    expect(haiku.requests[0]).not.toHaveProperty("betas");
  });

  it("maps tool_use blocks to structured decisions and strips reasonSummary from arguments", async () => {
    const { client } = mockClient({
      stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 20 },
      content: [
        { type: "text", text: "thinking out loud is ignored" },
        { type: "tool_use", id: "1", name: "qloo_find_tags", input: { query: "pottery", reasonSummary: "need a concept" } },
        { type: "tool_use", id: "2", name: "analyze", input: { targetIds: ["pottery"], reasonSummary: "ready" } },
      ],
    });
    const turn = await new AnthropicAgentModel({ client }).decide(context);
    expect(turn.decisions).toEqual([
      { action: "call_tool", tool: "qloo_find_tags", arguments: { query: "pottery" }, reasonSummary: "need a concept" },
      { action: "analyze", targetIds: ["pottery"], reasonSummary: "ready" },
    ]);
    expect(turn.usage).toEqual({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0 });
  });

  it("treats prose-only answers and refusals as invalid turns", async () => {
    expect((await new AnthropicAgentModel({ client: mockClient({ stop_reason: "end_turn", content: [{ type: "text", text: "I think..." }] }).client }).decide(context)).decisions).toMatchObject({ invalid: expect.stringMatching(/no tool call/u) });
    expect((await new AnthropicAgentModel({ client: mockClient({ stop_reason: "refusal", content: [] }).client }).decide(context)).decisions).toEqual({ invalid: "model refused" });
  });

  it("parses structured synthesis and reports invalid JSON", async () => {
    const fin = { userQuery: "q" } as FinalizationContext;
    const ok = await new AnthropicAgentModel({ client: mockClient({ stop_reason: "end_turn", content: [{ type: "text", text: '{"summary":"s","territoryNotes":[],"followUpOptions":[]}' }] }).client }).synthesize(fin, ["previous violation"]);
    expect(ok).toMatchObject({ output: { summary: "s" } });
    const bad = await new AnthropicAgentModel({ client: mockClient({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }).client }).synthesize(fin, []);
    expect(bad).toMatchObject({ invalid: expect.any(String) });
  });
});

describe("model selection", () => {
  it("never silently substitutes the baseline policy for the agent model", () => {
    expect(hasModelCredential({})).toBe(false);
    expect(() => createAgentModel("auto", {})).toThrow(AgentNotConfiguredError);
    expect(() => createAgentModel("auto", {})).toThrow(/LIVE_AGENT_MODEL_VALIDATION_NOT_RUN/u);
    expect(createAgentModel("baseline", {}).info).toMatchObject({ kind: "baseline", live: false });
  });
});
