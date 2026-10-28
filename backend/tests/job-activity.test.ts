/** SYNTHETIC trace: the live activity view of a job shows reasons and tool outcomes, never arguments or payloads. */
import { describe, expect, it } from "vitest";
import type { AgentTrace } from "@cultural-elasticity/shared";
import { jobActivity } from "../src/agent/query/activity.js";

const trace = {
  turns: [
    { iteration: 1, decisions: [{ action: "call_tool", tool: "qloo_resolve_entity", arguments: { query: "SYN-SECRET-ARG" }, reasonSummary: "Resolve the SYNTHETIC brand first.", accepted: true }], usage: null, latencyMs: 0 },
    { iteration: 2, decisions: [{ action: "call_tool", tool: "qloo_recommend", reasonSummary: "rejected idea", accepted: false, rejection: "NOT_EXPOSED: x" }], usage: null, latencyMs: 0 },
  ],
  toolCalls: [
    { id: "tc-1", iteration: 1, tool: "qloo_resolve_entity", permission: "read_only_external", arguments: { query: "SYN-SECRET-ARG" }, status: "ok", summary: "resolved SYNTHETIC brand", qlooOperations: [], correlationIds: ["syn-corr"], attempts: 1, latencyMs: 5 },
    { id: "tc-2", iteration: 2, tool: "qloo_recommend", permission: "read_only_external", arguments: {}, status: "rejected", summary: "refused", qlooOperations: [], correlationIds: [], attempts: 0, latencyMs: 0 },
    { id: "tc-3", iteration: 2, tool: "qloo_find_tags", permission: "read_only_external", arguments: {}, status: "empty", summary: "no SYNTHETIC tags", qlooOperations: [], correlationIds: [], attempts: 1, latencyMs: 5 },
  ],
} as unknown as AgentTrace;

describe("job activity", () => {
  it("lists accepted reasons and executed tool calls in run order, without arguments or correlation ids", () => {
    const activity = jobActivity(trace);
    expect(activity).toEqual([
      { kind: "step", label: "Looked up an entity in Qloo", detail: "Resolve the SYNTHETIC brand first.", status: "info" },
      { kind: "tool", label: "Looked up an entity in Qloo", detail: "resolved SYNTHETIC brand", status: "ok" },
      { kind: "tool", label: "Searched Qloo tags", detail: "no SYNTHETIC tags", status: "empty" },
    ]);
    expect(JSON.stringify(activity)).not.toMatch(/SYN-SECRET-ARG|syn-corr/u);
  });

  it("is empty before a run has a trace", () => {
    expect(jobActivity(null)).toEqual([]);
  });
});
