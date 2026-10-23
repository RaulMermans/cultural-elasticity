/**
 * SYNTHETIC query-layer helpers (tests and `pnpm eval:query`). A QueryProposal here is what an interpreter COULD
 * answer; it is fed through the same strict validation and deterministic gate as a real model answer. Fictional
 * brands and territories only; nothing here is Qloo evidence.
 */
import type { QueryProposal } from "../../src/agent/query/contracts.js";

export function proposal(overrides: Partial<QueryProposal> = {}): QueryProposal {
  return {
    primaryIntent: "explore_frontier",
    secondaryIntents: [],
    brandsNamed: [],
    territories: [],
    contextRef: null,
    contextTerritoryKey: null,
    constraints: [],
    unresolvedReferences: [],
    systemDirectives: [],
    confidence: "HIGH",
    clarificationQuestion: null,
    refinement: null,
    ...overrides,
  };
}

/** Shorthand: territories named in the message. */
export const named = (...names: string[]) => names.map((name) => ({ name, fromContext: false }));
/** Shorthand: territories taken from the investigation context. */
export const inherited = (...names: string[]) => names.map((name) => ({ name, fromContext: true }));
