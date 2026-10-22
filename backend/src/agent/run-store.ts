/**
 * In-memory run state for NEEDS_INPUT continuation and follow-up context (no database by design). Bounded; oldest
 * runs evicted. Not durable: a restart loses every run, and the query layer then reports CONTEXT_UNAVAILABLE.
 */
import type { AgentRunState } from "./state.js";

export class RunStore {
  private readonly runs = new Map<string, AgentRunState>();
  constructor(private readonly capacity = 100) {}

  put(state: AgentRunState): void {
    this.runs.set(state.runId, state);
    while (this.runs.size > this.capacity) this.runs.delete(this.runs.keys().next().value as string);
  }

  get(runId: string): AgentRunState | undefined {
    return this.runs.get(runId);
  }

  /** Sprint 5B.1: held runs whose recorded parent is `runId`. */
  children(runId: string): string[] {
    return [...this.runs.values()].filter((s) => s.link?.parentRunId === runId).map((s) => s.runId);
  }

  get size(): number {
    return this.runs.size;
  }
}
