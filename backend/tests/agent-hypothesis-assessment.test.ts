/** Twenty focused SYNTHETIC counterfactuals for the deterministic qualitative outcome gate. */
import { expect, it } from "vitest";
import { assessSingleHypothesis } from "../src/agent/hypothesis-assessment.js";
import { syntheticHypothesisCase } from "./fixtures/synthetic/single-hypothesis.js";

type Case = ReturnType<typeof syntheticHypothesisCase>;
const cases: { name: string; change: (input: Case) => void; outcome: string }[] = [
  { name: "two distinct conditioned members and a shared signal", change: () => {}, outcome: "WORTH_FURTHER_INVESTIGATION" },
  { name: "concept already in the brand profile", change: ({ state, target }) => { state.profiles.get("SYN-BRAND-1")!.tagIds.push(target.resolvedConcept!.id); }, outcome: "INCONCLUSIVE" },
  { name: "no shared cultural signal", change: ({ target }) => { target.coherence!.consistentlyShared = []; }, outcome: "INCONCLUSIVE" },
  { name: "missing coherence view", change: ({ target }) => { target.coherence = null; }, outcome: "INCONCLUSIVE" },
  { name: "no validated exemplar", change: ({ target }) => { target.representation.exemplars = []; }, outcome: "INCONCLUSIVE" },
  { name: "no conditioned relationship query", change: ({ state }) => { state.pools = []; }, outcome: "INCONCLUSIVE" },
  { name: "query scoped to another concept", change: ({ state }) => { state.pools[0]!.tagIds = ["urn:tag:synthetic:other"]; }, outcome: "INCONCLUSIVE" },
  { name: "query scoped to another brand", change: ({ state }) => { state.pools[0]!.conditionedOn = "SYN-OTHER-BRAND"; }, outcome: "INCONCLUSIVE" },
  { name: "brand independent members are not a relationship", change: ({ state }) => { state.pools[0]!.conditionedOn = null; }, outcome: "INCONCLUSIVE" },
  { name: "partial provider response cannot support a positive verdict", change: ({ state }) => { state.pools[0]!.call.envelope.status = "partial"; }, outcome: "INCONCLUSIVE" },
  { name: "degraded provider response cannot support a positive verdict", change: ({ state }) => { state.pools[0]!.call.envelope.status = "degraded"; }, outcome: "INCONCLUSIVE" },
  { name: "verified empty relationship query", change: ({ state }) => { state.pools[0]!.memberIds = []; }, outcome: "NOT_SUPPORTED_BY_CURRENT_EVIDENCE" },
  { name: "a clean empty query cannot override another observed member pool", change: ({ state }) => { state.pools.unshift({ ...state.pools[0]!, memberIds: [], call: { ...state.pools[0]!.call, envelope: { ...state.pools[0]!.call.envelope, execution: { ...state.pools[0]!.call.envelope.execution, correlation_id: "SYN-CALL-EMPTY" } } } }); }, outcome: "WORTH_FURTHER_INVESTIGATION" },
  { name: "a chosen empty query with another nonempty pool stays inconclusive", change: ({ state, target }) => { state.pools.push({ ...state.pools[0]!, memberIds: ["SYN-PLACE-3"], call: { ...state.pools[0]!.call, envelope: { ...state.pools[0]!.call.envelope, execution: { ...state.pools[0]!.call.envelope.execution, correlation_id: "SYN-CALL-OTHER" } } } }); state.pools[0]!.memberIds = []; target.provenance.correlationIds.push("SYN-CALL-OTHER"); }, outcome: "INCONCLUSIVE" },
  { name: "a degraded query prevents a clean negative verdict", change: ({ state }) => { state.pools.push({ ...state.pools[0]!, memberIds: [], call: { ...state.pools[0]!.call, envelope: { ...state.pools[0]!.call.envelope, status: "degraded", execution: { ...state.pools[0]!.call.envelope.execution, correlation_id: "SYN-CALL-DEGRADED" } } } }); state.pools[0]!.memberIds = []; }, outcome: "INCONCLUSIVE" },
  { name: "duplicate members do not increase the observed count", change: ({ state }) => { state.pools[0]!.memberIds = ["SYN-PLACE-1", "SYN-PLACE-1"]; }, outcome: "WORTH_FURTHER_INVESTIGATION" },
  { name: "missing correlation in target provenance", change: ({ target }) => { target.provenance.correlationIds = []; }, outcome: "INCONCLUSIVE" },
  { name: "unrelated conditioned evidence correlation cannot support this claim", change: ({ target }) => { target.conditionedEvidence!.correlationId = "SYN-OTHER-CALL"; }, outcome: "INCONCLUSIVE" },
  { name: "failed run cannot make a research verdict", change: ({ state }) => { state.status = "FAILED"; }, outcome: "UNABLE_TO_COMPLETE_RESEARCH" },
  { name: "spent run cannot make a research verdict", change: ({ state }) => { state.status = "BUDGET_EXHAUSTED"; }, outcome: "UNABLE_TO_COMPLETE_RESEARCH" },
  { name: "unresolved brand", change: ({ state }) => { state.brand.entity = null; }, outcome: "UNABLE_TO_COMPLETE_RESEARCH" },
  { name: "unresolved concept without a verified empty search", change: ({ target }) => { target.resolvedConcept = null; }, outcome: "INCONCLUSIVE" },
  { name: "unresolved concept after verified empty search", change: ({ state, target }) => { target.resolvedConcept = null; state.trace.toolCalls.push({ tool: "qloo_find_tags", arguments: { query: "Ritual Design" }, status: "empty", correlationIds: ["SYN-CALL-EMPTY"] } as never); }, outcome: "NOT_SUPPORTED_BY_CURRENT_EVIDENCE" },
  { name: "unrelated empty concept search cannot reject this question", change: ({ state, target }) => { target.resolvedConcept = null; state.trace.toolCalls.push({ tool: "qloo_find_tags", arguments: { query: "Other concept" }, status: "empty", correlationIds: ["SYN-CALL-EMPTY"] } as never); }, outcome: "INCONCLUSIVE" },
  { name: "failed concept search is not an empty observation", change: ({ state, target }) => { target.resolvedConcept = null; state.trace.toolCalls.push({ tool: "qloo_find_tags", status: "failed", correlationIds: [] } as never); }, outcome: "INCONCLUSIVE" },
];

it.each(cases)("SYNTHETIC hypothesis assessment: $name", ({ change, outcome }) => {
  const input = syntheticHypothesisCase();
  change(input);
  const result = assessSingleHypothesis(input.state, input.target);
  expect(result.outcome).toBe(outcome);
  expect(result.correlationIds.every((id) => input.target.provenance.correlationIds.includes(id))).toBe(true);
  expect(result.unknowns.length).toBeGreaterThan(0);
  expect(result.nextStep.length).toBeGreaterThan(0);
  if (result.outcome === "WORTH_FURTHER_INVESTIGATION") expect(result.correlationIds).toContain("SYN-CALL-REL");
  if (result.outcome !== "WORTH_FURTHER_INVESTIGATION") expect(result.supports).toHaveLength(0);
});
