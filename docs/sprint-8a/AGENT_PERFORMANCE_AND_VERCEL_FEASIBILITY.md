# Sprint 8A — Agent performance, competence diagnostics, and Vercel-only feasibility

Evidence-driven optimization and architectural feasibility. Not a general refactor. Not an infrastructure rewrite. Not a public deployment.

Frozen baseline: `evals/perf/baseline-manifest.json` (`sprint-8a-baseline-v1`), commit `51c887c`.

## 1. Executive Outcome

| Gate | Decision |
| --- | --- |
| Engineering | **ENGINEERING_COMPLETE** for instrumentation, bounded optimizations, eval-only experiments, C9 reproduction, and isolated Vercel proofs. |
| Performance baseline | **PERFORMANCE_BASELINE_ESTABLISHED.** Historical 810 s parent is frozen and labelled `HISTORICAL_LATENCY_NOT_FULLY_RECONSTRUCTABLE`. |
| Agent competence | **`AGENT_MODEL_NOT_READY`.** Latest full live gate remains Sprint 5A.2 attempt 4: SAFETY 13/13, COMPETENCE 8/9, blocker C9. Remediation is tested offline; the full live gate was not repeated. `LIVE_AGENT_READINESS_PASS` was not claimed. |
| Vercel feasibility | **NOT `VERCEL_ONLY_READY`.** Recommended topology: **D. VERCEL_FRONTEND_PLUS_PERSISTENT_BACKEND.** |

Do not collapse these gates.

## 2. Starting State

- Previous checkpoint: `sprint/7b-controlled-public-launch` at `51c887c`. Working tree was clean. Sprint 7B was committed and pushed; no owner checkpoint was required.
- This sprint branch: `sprint/8a-agent-performance-vercel-feasibility`.
- Node `>=22.19.0`, pnpm `10.26.0`. Local verification uses Node 22.23.2.
- Production model unchanged: `claude-haiku-5-5`, effort `high`, decision/synthesis `max_tokens` 16_000.
- Qloo harness `0.1.26`, default MCP transport, 7 s spacing unchanged.

## 3. Frozen Baseline

See `evals/perf/baseline-manifest.json`. Frozen before instrumentation:

- Skills: interpret v1, brand v1, territory v5, representation v4, comparison v3, frontier v4, analyze v2.
- Evaluators `run-evaluators-v2.1`, stability metrics v3, criteria v1, gate v3.
- Recorded example SHA-256 `064c7f6e87692a45cc5790cf4901b879dd75d8ecbb0b72ad2aee0a76e41d3f75`.
- Historical parent clocks (Sprint 5B.3 live parent / 7B §14): wall 810 s, model 62 s, Qloo 119 s (spacing 95 s, active 24 s), analysis 21 s, synthesis 36 s, naive sum 238 s, residual **572 s**.

Those historical numbers are not rewritten.

## 4. Existing Performance Architecture

Stage clocks (`model_latency_ms`, `qloo_latency_ms`, `analysis_latency_ms`, `synthesis_latency_ms`) were independent `Date.now()` sums. `reconcileLatency` never adds them as exclusive parts of wall time. `turnTrace.latencyMs` measured **only** `model.decide()`. Tool execution, context assembly, validation, queue wait, and gaps between turns were outside the naive sum. That is why 572 s appeared as a residual, not as a named operation.

## 5. Runtime Timeline

New monotonic spans (`backend/src/ops/spans.ts`) on `trace.spans` (optional `ce-agent-result/0.3` field):

RUN_START, QUERY_INTERPRETATION, QUEUE_ADMISSION, CONTEXT_ASSEMBLY, MODEL_REQUEST, MODEL_RESPONSE, OUTPUT_VALIDATION, TOOL_ROUTING, TOOL_DISPATCH, TOOL_EXECUTION, QLOO_SPACING, QLOO_TRANSPORT_STARTUP, QLOO_REQUEST, QLOO_RESPONSE, RESULT_NORMALIZATION, EVIDENCE_SUFFICIENCY, REPRESENTATION_SELECTION, METHODOLOGY_ANALYSIS, SYNTHESIS, FINALIZATION, RUN_END.

QUEUE_ADMISSION and QUERY_INTERPRETATION are pre-run; they are stored but excluded from run-wall coverage. Spans never contain prompts, credentials, or raw Qloo payloads.

## 6. Latency Attribution

Coverage = union of activity intervals (overlap counted once). Nested children contribute to inclusive time; exclusive time subtracts children.

| Clock | Meaning |
| --- | --- |
| `latency_ms` | Wall (`Date.now() - startedAt`) |
| `monotonic_elapsed_ms` | `performance.now()` since recorder origin |
| `wall_clock_skew_ms` | max(0, wall − monotonic). Host sleep between operations appears here |
| `span_covered_ms` / `span_unattributed_ms` / `span_coverage_ratio` | Interval union vs monotonic elapsed |
| `unattributed_ms` | **Unchanged** naive residual (model+Qloo+analysis+synthesis vs wall) |

`pnpm perf:agent` prints a per-run report (synthetic only).

## 7. Bottleneck Root Causes

**The 572-second question.** The residual is not proof that 572 s were spent on one function.

What is now explained:

1. The naive sum omitted context assembly, output validation, tool routing/dispatch, local tools, sufficiency/plan recording, and inter-turn gaps.
2. `Date.now()` stage clocks inflate if the host sleeps **during** an in-flight call; sleep **between** calls inflates wall without inflating those clocks. Sprint 5A.2 already observed laptop-sleep timeouts on the same machine class.
3. Historical traces have no span timestamps, so the 810 s parent cannot be reconstructed interval-by-interval.

What remains unknown without a fresh **live** traced run: how much of *that* 572 s was host sleep vs turn overhead vs MCP startup vs serialization. Label: `HISTORICAL_LATENCY_NOT_FULLY_RECONSTRUCTABLE`.

Fresh synthetic runs (spacing 0, scripted model) show span coverage of the monotonic timeline. That is not a live 30–50% latency claim.

## 8. Redundant Tool Work

Classified from traces (`buildPerfReport` / `classifyWaste`):

| Kind | Class |
| --- | --- |
| Empty exploratory Qloo probe | NECESSARY_INVESTIGATION (unless it repeats a refused type) |
| Run-cache hit | NECESSARY_INVESTIGATION |
| Identical executed call more than once | AVOIDABLE_EXECUTION_WASTE |
| Same rejection repeated | AVOIDABLE_EXECUTION_WASTE |
| Late Qloo answer discarded after TOOL_TIMEOUT | AVOIDABLE_EXECUTION_WASTE (budget still charged) |
| One bounded repair | NECESSARY_INVESTIGATION |

Qloo minimum spacing is unchanged. Failed first probes are not labelled waste.

## 9. Model Effort Comparison

Configurable eval-only matrix: `backend/scripts/experiments.ts` (`effort-experiment-v1`). Not imported by production runtime source.

Arms: `high` (production default) vs `medium`. `low` is optional only after high-vs-medium preserves competence.

**Sample size for live Haiku effort: 0.** `LIVE_HAIKU_EVAL_PASS` was not run. Production stays `high`. A scripted-model comparison would not measure effort.

## 10. Token Ceiling Analysis

Observed `max_tokens` is a ceiling. Truncation (`stop_reason === max_tokens`) is now an invalid turn, not silent partial JSON.

`proposeTokenCeilings` refuses to lower production caps when any sample is truncated or when observed maxima are not well below 16_000.

**Production ceilings unchanged** (decision/repair/synthesis 16_000, interpret 4_000). AnthropicAgentModel accepts eval-only overrides. No live output-token distribution was collected this sprint (`LIVE_HAIKU_EVAL_NOT_RUN`).

## 11. Safe Runtime Optimizations

Implemented, one class at a time, after the baseline freeze:

1. Monotonic span clock (`performance.now`) for activity; wall remains `Date.now`.
2. Cache `toolJsonSchema` on immutable registry tool objects (avoid `z.toJSONSchema` every turn).
3. MCP handshake duration recorded (`startupDurationMs` / `lastStartupMs`); spacing of the current call in `lastCallMeta`.
4. Truncation detection.

Not changed: Qloo 7 s spacing, evidence comparability, skill permissions, FULL requirements, claim validation, probe caps.

## 12. Before/After Benchmarks

| Workload | Sample | Before | After | Notes |
| --- | --- | --- | --- | --- |
| Historical live parent | n=1, untraced | 810 s wall, 572 s naive residual | same numbers, now labelled not reconstructable | Not re-run live |
| Synthetic move (Northwind / Boutique Hospitality) | n=1 `pnpm perf:agent` | untraced naive residual  | wall 116 ms; span coverage **0.652**; covered 75 ms; unattributed 40 ms; supported 3 | Offline, spacing 0, scripted/baseline policy |
| Synthetic compare (Saffron & Salt) | n=1 | untraced | wall 1138 ms; coverage **0.387**; avoidable waste: 1 repeated identical executed call, 3× DUPLICATE_ACTION | Offline |
| Synthetic frontier (Brindlewood Oat) | n=1 | untraced | wall 6 ms; coverage **0.286**; 4 empty exploratory probes classified necessary | Offline |
| Live representative 30–50% latency | n=0 | — | **NOT DEMONSTRATED** | `LIVE_QLOO_EVAL_NOT_RUN` |

TARGET C (30–50% live latency) is not claimed. TARGET A (95% span coverage on fresh instrumented wall time) is **not met on these sub-second synthetic runs**: inter-span JavaScript gaps dominate when Qloo spacing is 0 and the model is scripted. Live 95% still needs a traced live investigation. The union math itself is tested (overlap counted once).

## 13. Agent Competence Review

Latest **artifact-backed** full live gate: Sprint 5A.2 attempt 4 (`docs/sprint-5a2/FRONTIER_RELIABILITY.md`, local `backend/feasibility-output/sprint5a2-live/final`).

- SAFETY 13/13.
- COMPETENCE 8/9. C9 failed.
- Subsequent sprints did not repeat the full live readiness suite.
- Offline `pnpm eval:agent` remains synthetic and is not live-model evidence.

## 14. C9 Readiness Analysis

C9 = targeted runtime evaluators (`run-evaluators-v2.1`) must have 0 failures on prescribed live cases.

As-run (v2, 3 failures):

1. L-C2 `TAG_TYPE_EVIDENCE_VALID`: `interests:qloo:heavy_metal` reported successful; recommend had TIMED OUT.
2. L-E1 `TAG_TYPE_EVIDENCE_VALID`: `genre:music:folk` brand reported empty; call had TIMED OUT.
3. L-C2 `RECOVERY_WITHIN_BUDGET`: grader false positive (accepted re-proposal after the refusal condition lifted). Fixed in v2.1.

Replay v2.1: 2 real failures remain. Decision unchanged.

Root cause of the two real failures: a Qloo answer arriving after `TOOL_TIMEOUT` was recorded as probe evidence. Runtime fix: `abandonedToolCalls` discards late answers, counts them against the budget, never caches them. Tested in `agent-sprint5a2.test.ts` and `sprint-8a.test.ts`. **Not live-validated.** The grader is not weakened. Historical failed C9 is not reinterpreted as a pass.

## 15. Frontier Stability

Frozen criteria `frontier-stability-criteria-v1` unchanged. Empty supported overlap scores 0 (`frontier-stability-metrics-v3`). No new live stability sample this sprint (`requiredRuns: 3` not collected). Sprint 5A.2 L-E1/L-E2 PASS numbers remain the last live measurement.

## 16. Evaluation Results

| Command | Status | Label |
| --- | --- | --- |
| `pnpm lint` | PASS | Offline |
| `pnpm typecheck` | PASS | Offline |
| `pnpm test` | PASS 676 backend + 14 frontend | Offline |
| `pnpm build` | PASS | Offline |
| `pnpm check:secrets` | PASS (336 repo + 19 bundle files) | Offline |
| `pnpm eval:methodology` | PASS 19/19 | SYNTHETIC; `LIVE_QLOO_VALIDATION_NOT_RUN` |
| `pnpm eval:elasticity` | structural 27/27 PASS; score gate FAIL / index REJECTED_FOR_NOW (unchanged methodology decision) | LIVE fixtures replayed offline; not a new live validation |
| `pnpm eval:live` | PASS | Offline structural checks on captured live/recorded fixtures |
| `pnpm eval:query` | PASS (held-out 24/24; adversarial review X06 listed, acceptance gates pass) | `LIVE_HAIKU_QUERY_VALIDATION_NOT_RUN` |
| `pnpm eval:agent` | PASS 53/53 scenarios; runtime evaluators v2.1 failures 0 | SYNTHETIC scripted + baseline; `LIVE_AGENT_MODEL_VALIDATION_NOT_RUN` |
| `pnpm perf:agent` | PASS (diagnostic) | SYNTHETIC; coverages 0.652 / 0.387 / 0.286 |
| `pnpm test:e2e` | PASS 16/16 | SYNTHETIC job API; never live Qloo or Haiku |
| `pnpm smoke:offline` | PASS | Recorded example SHA-256 matches freeze |
| Full live readiness | **NOT RUN** | `LIVE_AGENT_READINESS_PASS` absent |
| Effort high vs medium live | **NOT RUN** | sample size 0 |
| Hosted Vercel | **NOT RUN** | no public or preview deploy |
| `pnpm smoke:docker` | **NOT RUN** | unchanged host image; not required for this sprint |

## 17. Cost Per Valid Outcome

Last live cost picture remains Sprint 5A.2 attempt 3/4 (docs/sprint-5a2 §17): about $0.084–$0.097 for 7 Haiku cases; useful investigations ~123 per dollar on attempt 4. This sprint did not spend live providers. Synthetic `validOutcomesPerDollar` is null (scripted model has no USD).

## 18. Vercel Official Limits

Documented 23 October 2026 from Vercel docs (not assumed for the owner’s account):

| Item | Official |
| --- | --- |
| Fluid compute duration | Hobby 300 s; Pro/Ent default 300 s, max 800 s; 1800 s beta (nodejs22.x), function-level only |
| Memory | Hobby 2 GB; Pro/Ent 4 GB |
| Bundle | 250 MB uncompressed; 5 GB large-functions beta |
| File descriptors | 1_024 shared |
| Node.js runtime | Claims all Node.js APIs, including `child_process` |
| Workflows | `"use workflow"` / `"use step"`; default 3 step retries; completed steps checkpointed; no duration limit while suspended |
| Extended 1800 s / Workflows / large functions | Do **not** assume enabled on the owner account |

Sources: [Configuring Maximum Duration](https://vercel.com/docs/functions/configuring-functions/duration), [Functions Limits](https://vercel.com/docs/functions/limitations), [Workflow Concepts](https://vercel.com/docs/workflows/concepts), [Workflow SDK retries](https://workflow-sdk.dev/docs/foundations/errors-and-retries).

## 19. Vercel Function Compatibility

| Gate | Outcome |
| --- | --- |
| FUNCTION_BUILD_COMPATIBLE | **CONDITIONAL** locally (Node 22 + harness resolve). Hosted bundle of `@qloo/qloo-harness` **NOT_TESTED**. |
| FUNCTION_RUNTIME_COMPATIBLE | **NOT_TESTED** on Vercel. Ordinary freeze-after-response still incompatible with `JobManager`. Fluid 800 s (or 1800 s beta) is shorter than the 14–20 minute live parent and the 20 minute job cap. |

## 20. Qloo Harness/MCP Feasibility

Local fake-MCP PoC (`backend/scripts/vercel-feasibility/mcp-poc.ts`): spawn, initialize handshake, stdio `tools/call`, timeout, termination, secret scrubbing. **Not** `qloo --help`.

| Gate | Outcome |
| --- | --- |
| QLOO_MCP_SUBPROCESS_COMPATIBLE | **PASS** locally against the fake server. **NOT_TESTED** on hosted Vercel. |
| QLOO_TOOL_CALL_COMPATIBLE | **PASS** locally (structuredContent). **NOT_TESTED** hosted. |

Exec transport also uses `child_process.spawn` per call (worse cold-start). No unverified custom HTTP Qloo client was added. Official harness MCP/exec remain the only transports.

## 21. Vercel Workflow PoC

Local semantic equivalent (`backend/scripts/vercel-feasibility/durable-workflow.ts`), not the Vercel compiler:

Eight-step synthetic investigation: structured query → deterministic validation → mocked decision → mocked Qloo tool call → persist → simulated retry → resumption → final result.

| Gate | Outcome |
| --- | --- |
| WORKFLOW_COMPILATION_PASS | **CONDITIONAL** (local semantic PoC). Official `"use workflow"` compiler **NOT_TESTED**. |
| WORKFLOW_REPLAY_PASS | **PASS** locally: committed steps are not re-executed. |
| WORKFLOW_RETRY_SAFE | **PASS** locally for the model: external started-but-uncommitted steps are `uncertain` and refused (`UnsafeRetryError`). Not exactly-once. |
| WORKFLOW_STATE_DURABLE | **FAIL** for the current app: in-memory `RunStore` / `SpendLedger` are not a Workflow event log. |

## 22. State and Checkpoints

Required durable classes (not one JSON blob, not vector memory):

| Kind | Why |
| --- | --- |
| RUN_STATE | phase, limits, usage, status |
| SHORT_TERM_WORKING_MEMORY | evidence and decision context |
| INVESTIGATION_LINEAGE | parent/child; browser must not reconstruct |
| CHECKPOINTS | after a committed step |
| ARTIFACTS | evidence packets and final reports |
| LOGS | traces and ops metrics |
| SPEND_STATE | reservations and observed usage; in-memory is not financial authority |

Minimum serverless persistence: a durable store for those seven classes plus step operation ids. Workflow checkpoints alone do not make `RunStore` durable.

## 23. Retry and Idempotency

Every external step needs a stable `operationId`. Track started / completed / committed / charged. Retrying a Qloo or Haiku call after an uncertain failure can duplicate spend and evidence. The PoC refuses that retry. Providers do not give exactly-once. Duplicate accounting must be prevented by committed results + spend reservations, not by hoping the step runtime is unique.

## 24. Private Live Access

Keep public recorded exploration vs private live investigation.

Public: Living Atlas, recorded example, recorded evidence. No Anthropic/Qloo spend.

Authorized live: server-side authorization (existing internal secret is for Next.js→Fastify, not for strangers). Prefer Vercel Deployment Protection + a small allowlist / invitation, plus application-level checks and per-user + global spend. Hidden buttons, cookies, and IP throttles are not sufficient.

A system directive cannot be confirmed (unchanged).

## 25. Spend and Admission

Current `SpendLedger` is in-memory, `durable: false`, `multiInstanceSafe: false`. Restart zeros it. Workflow retries require atomic reservation + commit of observed usage. Design (not implemented): compare-and-set on a durable reservation row keyed by `operationId`; missing usage still charges the reserve. Anthropic workspace limits remain the backstop. This sprint did not build a billing service.

## 26. Recommended Vercel Architecture

**D. VERCEL_FRONTEND_PLUS_PERSISTENT_BACKEND**

Preference for Vercel-only does not override reliability.

| Option | Why not now |
| --- | --- |
| A. Functions only | 800 s / 1800 s beta < observed 810 s parent and 20 min cap; freeze-after-response kills `JobManager`; hosted MCP untested |
| B. Workflow only | Does not persist RunStore/spend; default step retries are unsafe for Qloo/Haiku; compiler untested |
| C. Workflow + durable store | Correct *future* Vercel-only shape, but requires MCP-or-HTTP proof on the hosted runtime, durable spend, and a real Workflow compile. Not this sprint. |
| **D. Vercel frontend + persistent backend** | Matches JobManager, MCP child, 7 s spacing, in-process jobs, current spend ledger. Railway/Render one replica as prepared in 7A/7B. |

Qloo compatibility confidence: **high locally**, **unknown on Vercel**. What was tested: local fake MCP, local workflow semantics, official docs. What remains: hosted spawn, harness binary size, Fluid/Workflow account features, live traced parent.

## 27. Migration Scope

If C is later authorized: durable store for the seven state classes; wrap decide/Qloo as non-retrying external steps; keep spacing; do not migrate AgentRuntime in one cut; private live auth; no public deploy without approval. Not started.

## 28. Product Regressions

Living Atlas UI was not redesigned. No new progress percentages. Existing stages remain coarse and truthful. Atlas E2E is unchanged in intent (run with verification).

## 29. Known Limitations

- Historical 572 s not reconstructable.
- TARGET C live latency not demonstrated.
- Effort/token live experiments not run.
- Full live C9 gate not repeated.
- Hosted Vercel MCP/Workflow not tested.
- In-memory spend still not durable.

## 30. Sprint 8B Recommendations

1. One authorized, traced live parent (same prompt as the recorded example) to close the 572 s question and test 95% span coverage on real Qloo/Haiku.
2. Repeat gate v3 only if budget allows; C9 is the remaining competence blocker.
3. Controlled high-vs-medium effort on a small frozen case set; keep production `high` unless competence holds.
4. Do not lower `max_tokens` without output-token histograms from live traces.
5. If Vercel-only is still desired: owner-approved private preview that only tests MCP spawn + handshake, still not a public launch.
6. Do not begin a backend migration automatically.
