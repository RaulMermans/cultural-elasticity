/**
 * Investigation plan: what still needs to be established for THIS request, derived from state.
 *
 * The plan is a checklist the model sees each turn, not a fixed sequence: the model chooses which open
 * item to pursue, with which tools, and may revise the territory set. Revisions are recorded whenever
 * the derived plan changes. No item names a specific brand or territory beyond the ones in the run.
 */
import { MIN_COMPARISON_SET } from "./router.js";
import { activeTerritories, type AgentRunState } from "./state.js";

export function derivePlan(state: AgentRunState): string[] {
  const mark = (done: boolean, item: string) => `[${done ? "x" : " "}] ${item}`;
  const items: string[] = [];
  items.push(mark(state.interpretation !== null, "interpret the goal (intent, brand, named territories)"));
  items.push(mark(state.brand.entity !== null, `resolve the brand${state.brand.ambiguity ? " (ambiguous: needs the user)" : ""}`));
  const intent = state.interpretation?.intent;
  if (intent === "explore_frontier") {
    const candidates = state.territories.filter((t) => t.role === "frontier_candidate").length;
    items.push(mark(state.related.length > 0 || state.profiles.size > 1, "gather Qloo evidence that suggests frontier concepts (brand profile, related entities and their profiles)"));
    items.push(mark(candidates > 0, `propose distinct frontier candidates grounded in that evidence (max ${state.limits.maxCandidateTerritories} territories)`));
  }
  if (intent === "analyze_move" || intent === "compare_territories") {
    const rankable = activeTerritories(state).filter((t) => t.representation !== null).length;
    items.push(mark(rankable >= MIN_COMPARISON_SET, `optional: reach ≥ ${MIN_COMPARISON_SET} represented territories of one entity type (add references) so a relative position is possible; otherwise analysis is partial`));
  }
  for (const t of state.territories) {
    if (t.status === "dropped") {
      items.push(`[-] ${t.label}: dropped (${t.dropReason?.code})`);
      continue;
    }
    items.push(mark(t.concept !== null, `${t.label}: anchor to a Qloo concept`));
    items.push(mark(t.representation !== null, `${t.label}: discover and validate exemplars (or accept concept-only evidence)`));
    items.push(mark(t.status === "analyzed", `${t.label}: analyze`));
  }
  items.push(mark(state.finishRequested, "finish when deterministic sufficiency allows"));
  return items;
}

/** Records a plan revision when the derived plan differs from the last recorded one. */
export function recordPlanRevision(state: AgentRunState, note: string | null): void {
  const items = derivePlan(state);
  const last = state.trace.planRevisions.at(-1);
  if (last && last.items.join("\n") === items.join("\n")) return;
  state.trace.planRevisions.push({ iteration: state.usage.iterations, items, note });
}
