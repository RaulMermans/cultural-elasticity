/**
 * Investigation context for follow-up queries, built ONLY from runs this process holds in its RunStore.
 *
 * The client sends a run id and optionally a territory key; everything else (brand, territories, lineage, evidence
 * status) is read from the server's own state. A run that was evicted, belongs to another process or predates a
 * restart is unavailable: nothing is reconstructed or assumed. The RunStore is in memory and bounded; it is not
 * durable storage.
 */
import type { InvestigationContextView, InvestigationNode } from "@cultural-elasticity/shared";
import type { RunStore } from "../run-store.js";
import { TERMINAL_STATUSES, type AgentRunState } from "../state.js";

/** Deepest lineage the query layer follows (and the depth at which follow-ups are refused). */
export const MAX_LINEAGE_DEPTH = 12;

export type ResolvedContext = {
  /** Lineage handles: L0 = the run the user is looking at, L1 its parent, and so on (only runs still held). */
  nodes: { ref: string; state: AgentRunState }[];
  selectedTerritoryKey: string | null;
  view: InvestigationContextView;
};

export type ContextFailure = { code: "PARENT_NOT_FOUND" | "PARENT_AWAITING_INPUT" | "PARENT_RUNNING" | "SELECTED_TERRITORY_UNKNOWN"; detail: string };

export function resolveContext(store: RunStore, runId: string, selectedTerritoryKey?: string): { ok: true; context: ResolvedContext } | { ok: false; failure: ContextFailure } {
  const current = store.get(runId);
  if (!current) return { ok: false, failure: { code: "PARENT_NOT_FOUND", detail: `run ${runId} is not held by this process (evicted, restarted or unknown); its context cannot be recovered` } };
  if (current.status === "NEEDS_INPUT") return { ok: false, failure: { code: "PARENT_AWAITING_INPUT", detail: `run ${runId} is waiting for a clarification; answer it with /api/agent/continue` } };
  if (!TERMINAL_STATUSES.includes(current.status)) return { ok: false, failure: { code: "PARENT_RUNNING", detail: `run ${runId} is still ${current.status}` } };
  if (selectedTerritoryKey && !current.territories.some((t) => t.key === selectedTerritoryKey)) {
    return { ok: false, failure: { code: "SELECTED_TERRITORY_UNKNOWN", detail: `run ${runId} has no territory "${selectedTerritoryKey}"` } };
  }
  const nodes: ResolvedContext["nodes"] = [{ ref: "L0", state: current }];
  let truncated = false;
  for (let s = current; s.link?.parentRunId && nodes.length < MAX_LINEAGE_DEPTH; ) {
    const parent = store.get(s.link.parentRunId);
    if (!parent) {
      truncated = true;
      break;
    }
    nodes.push({ ref: `L${nodes.length}`, state: parent });
    s = parent;
  }
  const view: InvestigationContextView = {
    current: nodeOf(current),
    lineage: nodes.map((n) => nodeOf(n.state)),
    lineageTruncated: truncated,
    children: store.children(runId),
  };
  return { ok: true, context: { nodes, selectedTerritoryKey: selectedTerritoryKey ?? null, view } };
}

export function nodeOf(state: AgentRunState): InvestigationNode {
  const results = new Map((state.final?.territories ?? []).map((t) => [t.key, t]));
  return {
    runId: state.runId,
    parentRunId: state.link?.parentRunId ?? null,
    operation: state.link?.operation ?? "NEW_INVESTIGATION",
    selectedTerritoryKey: state.link?.selectedTerritoryKey ?? null,
    intent: state.interpretation?.intent ?? null,
    status: state.status,
    brand: state.brand.entity ? { id: state.brand.entity.id, label: state.brand.entity.label } : null,
    territories: state.territories.map((t) => ({ key: t.key, label: t.label, role: t.role, evidenceStatus: results.get(t.key)?.evidenceStatus ?? null, analysisRoute: results.get(t.key)?.analysisRoute ?? null })),
  };
}

/**
 * What the interpreter model sees: labels, keys, lineage handles and evidence status. No run ids (a model cannot
 * echo or invent one) and no Qloo entity ids.
 */
export function interpreterContextView(context: ResolvedContext) {
  return {
    selectedTerritoryKey: context.selectedTerritoryKey,
    nodes: context.nodes.map(({ ref, state }) => {
      const node = nodeOf(state);
      return {
        ref,
        operation: node.operation,
        intent: node.intent,
        status: node.status,
        brand: node.brand?.label ?? state.interpretation?.brand ?? null,
        territories: node.territories.map((t) => ({ key: t.key, label: t.label, role: t.role, evidenceStatus: t.evidenceStatus })),
      };
    }),
    lineageTruncated: context.view.lineageTruncated,
  };
}
export type InterpreterContextView = ReturnType<typeof interpreterContextView>;
