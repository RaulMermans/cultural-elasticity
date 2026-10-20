/**
 * Failure taxonomy (Sprint 4): the primary category of a run that did not produce measurable evidence,
 * derived deterministically from the result and its trace. Eval code extends this with categories only an
 * evaluator can see (e.g. BENCHMARK_LABEL_ERROR, EXEMPLAR_SEMANTIC_ERROR judged against expectations).
 *
 * Order matters: the first matching cause is the primary one.
 */
import type { AgentAnalysisResult, AgentFailureCategory } from "@cultural-elasticity/shared";

type RunView = Pick<AgentAnalysisResult, "status" | "brand" | "territories" | "finalSufficiency" | "summary" | "trace">;

const rejectionCodes = (r: RunView) => r.trace.turns.flatMap((t) => t.decisions.flatMap((d) => (d.rejection ? [d.rejection.split(":")[0]!] : [])));

export function classifyRunFailure(r: RunView): AgentFailureCategory | null {
  if (!r.summary.claimValidation.passed) return "CLAIM_VALIDATION_ERROR";
  if (r.status === "FAILED") {
    const codes = rejectionCodes(r);
    const count = (set: string[]) => codes.filter((c) => set.includes(c)).length;
    if (r.trace.errors.some((e) => e.code === "RUNTIME_ERROR")) return r.trace.toolCalls.some((c) => c.tool === "run_elasticity_methodology" && c.status === "failed") ? "METHODOLOGY_ERROR" : "QLOO_TOOL_ERROR";
    const selection = count(["UNKNOWN_TOOL", "NOT_EXPOSED", "WRONG_PHASE", "UNAUTHORIZED_TOOL"]);
    const args = count(["INVALID_ARGUMENTS", "INVALID_DECISION"]);
    if (selection > 0 && selection >= args) return "TOOL_SELECTION_ERROR";
    if (args > 0) return "TOOL_ARGUMENT_ERROR";
    return "MODEL_DECISION_ERROR";
  }
  if (r.status === "BUDGET_EXHAUSTED") return "BUDGET_EXHAUSTED";
  if (!r.brand) return "ENTITY_RESOLUTION_ERROR";
  // A run that ends with no territory at all (e.g. no Qloo-supported frontier candidate) produced nothing measurable.
  if (r.territories.length === 0) return "QLOO_DATA_LIMIT";
  if (r.finalSufficiency !== "INSUFFICIENT") {
    if (r.territories.some((t) => t.limitations.some((l) => l.code === "METHODOLOGY_NOT_APPLICABLE"))) return "METHODOLOGY_ERROR";
    return null;
  }
  const inScope = r.territories.filter((t) => t.representation.failure?.code !== "DUPLICATE_TERRITORY");
  if (inScope.length > 0 && inScope.every((t) => t.resolvedConcept === null)) return "TERRITORY_RESOLUTION_ERROR";
  const qlooError = r.trace.toolCalls.some((c) => c.qlooOperations.length > 0 && c.status === "failed" && c.error && /^QLOO_/u.test(c.error));
  if (qlooError) return "QLOO_TOOL_ERROR";
  const qlooEmpty = inScope.every((t) => t.resolvedConcept === null || t.representation.strategy === "DESCRIPTIVE_ONLY" || t.conditionedEvidence?.entityCount === 0 || t.capabilities.conditionedEvidence === "EMPTY");
  if (qlooEmpty) return "QLOO_DATA_LIMIT";
  if (inScope.some((t) => t.representation.rejectedExemplars.some((x) => x.code === "EXEMPLAR_SEMANTIC_MISMATCH" || x.code === "REPRESENTATION_QUALITY_WEAK"))) return "EXEMPLAR_SEMANTIC_ERROR";
  return "REPRESENTATION_ERROR";
}
