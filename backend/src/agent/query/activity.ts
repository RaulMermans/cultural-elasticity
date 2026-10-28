/**
 * A readable, live projection of an agent run's trace for the person watching it. It shows what the agent chose to
 * do (its one-sentence reason summary, which is model text and never evidence) and what each tool call returned.
 * It never carries arguments, prompts, payloads, correlation IDs or numbers the methodology computed.
 */
import type { AgentTrace } from "@cultural-elasticity/shared";

export type JobActivity = { kind: "step" | "tool"; label: string; detail: string; status: "ok" | "empty" | "failed" | "info" };

const TOOL_LABEL: Record<string, string> = {
  interpret_request: "Read the question",
  propose_territory: "Proposed a territory",
  anchor_territory: "Anchored a territory in Qloo",
  validate_territory_representation: "Checked the territory's exemplars",
  declare_concept_only: "Chose concept-level evidence",
  assess_concept_duplicates: "Checked for duplicate concepts",
  drop_territory: "Dropped an unsupported territory",
  assess_evidence_sufficiency: "Checked whether the evidence is enough",
  qloo_resolve_entity: "Looked up an entity in Qloo",
  qloo_find_tags: "Searched Qloo tags",
  qloo_get_entity_tags: "Read an entity's Qloo tags",
  qloo_recommend: "Asked Qloo for associated entities",
  qloo_related_entities: "Asked Qloo for related entities",
};

const MAX_DETAIL = 220;
const MAX_ENTRIES = 40;

const clip = (text: string) => (text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 1).trimEnd()}…` : text);
const humanize = (tool: string) => tool.replace(/^qloo_/u, "Qloo ").replace(/_/gu, " ");

/** Entries in run order: each turn's accepted reasons, then that turn's tool calls. The newest entries are kept. */
export function jobActivity(trace: AgentTrace | null): JobActivity[] {
  if (!trace) return [];
  const out: JobActivity[] = [];
  const calls = new Map<number, AgentTrace["toolCalls"]>();
  for (const call of trace.toolCalls) calls.set(call.iteration, [...(calls.get(call.iteration) ?? []), call]);
  const iterations = [...new Set([...trace.turns.map((turn) => turn.iteration), ...calls.keys()])].sort((a, b) => a - b);
  for (const iteration of iterations) {
    for (const turn of trace.turns.filter((item) => item.iteration === iteration)) {
      for (const decision of turn.decisions) {
        if (!decision.accepted || !decision.reasonSummary.trim()) continue;
        out.push({ kind: "step", label: decision.tool ? TOOL_LABEL[decision.tool] ?? humanize(decision.tool) : "Decided the next step", detail: clip(decision.reasonSummary.trim()), status: "info" });
      }
    }
    for (const call of calls.get(iteration) ?? []) {
      if (call.status === "rejected") continue;
      const status = call.status === "failed" ? "failed" : call.status === "empty" ? "empty" : "ok";
      out.push({ kind: "tool", label: TOOL_LABEL[call.tool] ?? humanize(call.tool), detail: clip(call.summary || (status === "failed" ? "The call did not complete." : "")), status });
    }
  }
  return out.slice(-MAX_ENTRIES);
}
