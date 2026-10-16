/** In-memory run state for NEEDS_INPUT continuation (no database by design). Bounded; oldest runs evicted. */
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

  get size(): number {
    return this.runs.size;
  }
}
