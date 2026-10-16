/**
 * Live model provider: Claude via the official Anthropic SDK (Messages API, beta surface for the
 * server-side refusal fallback). Selected only when ANTHROPIC_API_KEY is configured.
 *
 * Each decision is ONE stateless request: system prompt + the current AgentDecisionContext (built from
 * run state by code). The model answers with tool_use blocks; analyze / ask_user / finish are offered
 * as tools too, so every decision is structured. Tool choice is `auto` (forced tool choice is rejected
 * by the current models); a turn without tool calls is an invalid turn. The runtime validates every
 * decision; nothing the model returns is trusted as-is. The key is read from the environment by the
 * SDK and never logged or placed in a prompt.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AgentModelInfo } from "@cultural-elasticity/shared";
import type { ModelTurn } from "../contracts.js";
import { AGENT_SYSTEM_PROMPT, SYNTHESIS_SYSTEM_PROMPT } from "../prompts.js";
import type { AgentDecisionContext, AgentModel, FinalizationContext, SynthesisTurn } from "./provider.js";

export const DEFAULT_AGENT_MODEL = "claude-opus-5-5";

const REASON = { type: "string", description: "One short factual sentence: why this action now." };

const DECISION_TOOLS = [
  {
    name: "analyze",
    description: "Run the deterministic analysis (evidence collection, rank panels where a comparison set of ≥3 rankable territories exists, methodology) for these territory keys.",
    input_schema: { type: "object", properties: { targetIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 }, reasonSummary: REASON }, required: ["targetIds", "reasonSummary"], additionalProperties: false },
  },
  {
    name: "ask_user",
    description: "Ask the user to resolve an ambiguity that Qloo evidence cannot settle. Ends the turn.",
    input_schema: { type: "object", properties: { question: { type: "string" }, ambiguity: { type: "string" } }, required: ["question", "ambiguity"], additionalProperties: false },
  },
  {
    name: "finish",
    description: "Finish the investigation with these analyzed territory keys.",
    input_schema: { type: "object", properties: { resultIds: { type: "array", items: { type: "string" } }, reasonSummary: REASON }, required: ["resultIds", "reasonSummary"], additionalProperties: false },
  },
] as const;

const SYNTHESIS_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    territoryNotes: { type: "array", items: { type: "object", properties: { territoryKey: { type: "string" }, text: { type: "string" } }, required: ["territoryKey", "text"], additionalProperties: false } },
    followUpOptions: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "territoryNotes", "followUpOptions"],
  additionalProperties: false,
};

export type AnthropicAgentModelOptions = {
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Injected in tests; otherwise the SDK client reads ANTHROPIC_API_KEY from the environment. */
  client?: Pick<Anthropic, "beta">;
};

type Usage = { input_tokens: number; output_tokens: number } | null | undefined;
const usageOf = (usage: Usage) => (usage ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } : undefined);

export class AnthropicAgentModel implements AgentModel {
  readonly info: AgentModelInfo;
  private readonly client: Pick<Anthropic, "beta">;
  private readonly model: string;
  private readonly effort: NonNullable<AnthropicAgentModelOptions["effort"]>;

  constructor(options: AnthropicAgentModelOptions = {}) {
    this.model = options.model ?? DEFAULT_AGENT_MODEL;
    this.effort = options.effort ?? "high";
    this.client = options.client ?? new Anthropic();
    this.info = { id: this.model, kind: "llm", live: true };
  }

  async decide(context: AgentDecisionContext): Promise<ModelTurn> {
    const { tools: specs, ...view } = context;
    const tools = [
      ...specs.map((spec) => {
        const schema = spec.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
        return {
          name: spec.name,
          description: spec.description,
          input_schema: { ...schema, type: "object" as const, properties: { ...(schema.properties ?? {}), reasonSummary: REASON } },
        };
      }),
      ...DECISION_TOOLS.map((t) => ({ ...t, input_schema: { ...t.input_schema } })),
    ];
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16_000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: this.effort },
      system: [{ type: "text", text: AGENT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: tools as never,
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: `Current investigation state (JSON). Decide the next actions.\n${JSON.stringify(view)}` }],
    });
    const usage = usageOf(response.usage as Usage);
    if (response.stop_reason === "refusal") return { decisions: { invalid: "model refused" }, ...(usage && { usage }) };
    const decisions: unknown[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const input = (block.input ?? {}) as Record<string, unknown>;
      if (block.name === "analyze") decisions.push({ action: "analyze", targetIds: input.targetIds, reasonSummary: input.reasonSummary });
      else if (block.name === "ask_user") decisions.push({ action: "ask_user", question: input.question, ambiguity: input.ambiguity });
      else if (block.name === "finish") decisions.push({ action: "finish", resultIds: input.resultIds ?? [], reasonSummary: input.reasonSummary });
      else {
        const { reasonSummary, ...args } = input;
        decisions.push({ action: "call_tool", tool: block.name, arguments: args, reasonSummary: typeof reasonSummary === "string" && reasonSummary.trim() ? reasonSummary : "no reason given" });
      }
    }
    if (decisions.length === 0) return { decisions: { invalid: `no tool call (stop_reason ${response.stop_reason})` }, ...(usage && { usage }) };
    return { decisions, ...(usage && { usage }) };
  }

  async synthesize(context: FinalizationContext, feedback: string[]): Promise<SynthesisTurn> {
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16_000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: this.effort, format: { type: "json_schema", schema: SYNTHESIS_SCHEMA } },
      system: SYNTHESIS_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Deterministic results (JSON):\n${JSON.stringify(context)}${feedback.length ? `\n\nYour previous answer was rejected by the claim validator:\n- ${feedback.join("\n- ")}\nFix every point.` : ""}`,
        },
      ],
    });
    const usage = usageOf(response.usage as Usage);
    if (response.stop_reason === "refusal") return { invalid: "model refused", ...(usage && { usage }) };
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    try {
      return { output: JSON.parse(text), ...(usage && { usage }) };
    } catch {
      return { invalid: "synthesis is not valid JSON", ...(usage && { usage }) };
    }
  }
}
