# ADR-001 (Sprint 9N): Comparison feasibility is a projection, not a planner

**Status:** accepted for the Sprint 9N branch; live validation pending (Sprint 9O).

## Context

Comparative investigations ended "not measured" after many calls. Live traces (L-M1, L-M2, L-M3, L-C2) show the agent probing brand-profile media and music tags with the target's entity type while candidates with direct evidence of that type were waiting. The runtime already computed most of what a feasibility check needs (`referencePlan` with completion arithmetic, territory readiness, semantic verdicts, a probe ledger), but:

- the model saw it spread across free-text `outstanding` lines;
- the result kept none of it;
- the product could not tell a budget stop from an evidence stop.

## Decision

1. Add `comparison-feasibility/v1` (`backend/src/agent/feasibility.ts`) as a deterministic, memoized projection of existing state. It has three statuses: FEASIBLE, UNCERTAIN and INFEASIBLE (UNCERTAIN is never treated as INFEASIBLE). It names one blocker, one next action and a `repeat` verdict.
2. Add four evidence rules behind one policy switch: type evidence, bounded reference probing, thin-panel discovery and reference co-occurrence. Methodology thresholds stay as they are.
3. Show the projection read-only in `focus.feasibility`, record it in `trace.feasibility`, and snapshot it into `result.comparisonFeasibility` before target analysis.
4. Project results for people with one shared, pure function (`decisionCard`) used by the UI, the report and the evals.
5. Keep `CE_FEASIBILITY_POLICY=observe` as the rollback and as the "before" arm of the evaluation.

## Alternatives rejected

- **A separate feasibility planner or evaluator LLM.** It would duplicate `referencePlan`, add a second model and let a model own a decision (AGENTS rules 4.1 and 4.12).
- **Hard-coding barren namespaces** (e.g. "genres never have places"). AGENTS 5A.2 rule 2 forbids it, and it would not generalize.
- **Lowering the comparison minimum or the MEANINGFUL tie** to raise the FULL rate. AGENTS 5A rule 3 forbids it.
- **A tool the model calls to "assess feasibility".** That adds a turn and a call surface for something the runtime can show every turn for free.

## Consequences

- On matched synthetic cases: 26.9% fewer empty probes, 2.7% fewer Qloo calls, identical FULL yield, zero regressions. Live effect unknown until Sprint 9O.
- `build_comparison_set` v4. The agent-facing context grows by one compact object on comparative runs only.
- Deferrals cost a turn, so they apply only with turn slack. Refusals (`COMPARISON_INFEASIBLE`, `REFERENCE_PROBE_LIMIT`) apply always, because those probes cannot change the outcome.
