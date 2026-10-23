# Sprint 8B — Live agent optimization and Vercel proof

Evidence-producing execution sprint. Not a plan. Not a second agent. Not a Living Atlas redesign.

Frozen baseline remains `evals/perf/baseline-manifest.json` (`sprint-8a-baseline-v1`). Historical 810 s / 572 s residual numbers are not rewritten.

## 1. Executive Outcome

| Gate | Decision |
| --- | --- |
| Engineering | **ENGINEERING_COMPLETE** for metric integrity, late-Qloo accounting, derived-view memo, tests, and isolated Vercel proofs. Frontend E2E failed in this session (composer hydration timeouts); Living Atlas product source was not changed. |
| Performance | **PERFORMANCE_IMPROVED** on synthetic before/after. Live parent tracing met **95% wall-time coverage**. The 30–50% live latency target is **not** met. |
| Agent competence | **`AGENT_MODEL_NOT_READY`.** Focused live C9 on L-C2 and L-E1: `TAG_TYPE_EVIDENCE_VALID:pass` (0 evaluator failures). The prescribed 7-case gate was not repeated. |
| Vercel | **`VERCEL_ONLY_CONDITIONAL`.** Hobby, SSO-protected preview of an isolated feasibility app. Node 22 Functions and fake-MCP subprocess **PASS**. Official Workflow SDK compiles locally and `start()` runs hosted; hosted step registration **FAIL**. Real Qloo harness initialize **FAIL** (rpc timeout). No production DNS, no paid-plan upgrade, no provider secrets on the preview. |

Do not collapse these gates.

## 2. Starting State

- Previous checkpoint: `sprint/8a-agent-performance-vercel-feasibility` at `9d51332`. Working tree was clean.
- This sprint branch: `sprint/8b-live-agent-optimization` (uncommitted unless the owner later approves a commit).
- Node 22.23.2, pnpm 10.26.0.
- Production model unchanged: `claude-haiku-5-5`, effort `high`, decision/synthesis `max_tokens` 16_000, Qloo spacing 7000 ms, harness `0.1.26`.

## 3. Baseline

See `evals/perf/baseline-manifest.json`. Competence at freeze: SAFETY 13/13, COMPETENCE 8/9, blocker C9. Historical parent: wall 810 s, naive residual 572 s, `HISTORICAL_LATENCY_NOT_FULLY_RECONSTRUCTABLE`.

## 4. Metric Integrity Repairs

`backend/src/ops/perf-report.ts`:

- `invalidFull` is `number | null`. A FULL territory with no semantic assessment is **unmeasured**, not zero invalid FULL.
- Outcomes are split: `validFull`, `partial`, `descriptive`, `insufficient`, `unsupported`. FULL and PARTIAL are never one equivalent count.
- `supportedFindings` is removed from the report object (`supportedFindingCount` is deprecated).

Qloo call metadata: `QlooCallResult.callMeta` carries a per-call `operationId`. `lastCallMeta` is a copy of the last completed call and is not used for authoritative trace attribution.

## 5. Late Qloo Accounting

`backend/src/agent/qloo-gateway.ts`:

1. Reserve one budget unit at dispatch.
2. `settleAttempts` is once per `operationId` and never exceeds `maxQlooCalls`.
3. Abandoned / timed-out / post-finalization answers are discarded, never cached, never recorded as probe evidence.
4. Observed attempts are recorded; a cancelled provider call is not pretended to cost zero.
5. `state.finalized` is set at the start of `finish()`.

C9 grader `TAG_TYPE_EVIDENCE_VALID` (`run-evaluators-v2.1`) is unchanged.

## 6. Real Runtime Timeline

One fresh live investigation, frozen prompt “Where could Jacquemus expand?”, Haiku 5.5 effort high, live Qloo MCP, default 7000 ms spacing, host kept awake with `caffeinate`.

| Clock | Value |
| --- | --- |
| Run id | `b76dd766-2136-43d5-a388-b3463bdd3bdc` |
| Wall | 641 130 ms |
| Monotonic | 641 145 ms |
| Span coverage | **0.974** (624 332 ms covered, 16 813 ms unattributed, skew 0) |
| Spans | 329 |
| Model | 68 164 ms · 102 801 in / 17 777 out · **$0.0184** · effort high |
| Qloo | 27 calls · 122 196 ms of which spacing 98 722 ms, active 23 474 ms, startup 813 ms |
| Analysis / synthesis | 8 080 ms / 13 992 ms |
| Outcomes | validFull 0, invalidFull 0, partial 1, descriptive 0, insufficient 3, unsupported 3 |
| Iterations | 12 · 0 repairs · 3 invalid actions · 11 empty probes |

Label: **LIVE Haiku + LIVE Qloo**. Not a full readiness gate.

## 7. Bottleneck Root Causes

The historical 572 s residual cannot be reconstructed. Fresh tracing answers it with interval-union accounting (overlap counted once). Exclusive-by-phase sums can exceed wall when overlapping spans are not parented; union coverage is the honest clock.

Largest **measured** exclusive phases on the live parent:

1. **CONTEXT_ASSEMBLY — 354 099 ms / 11 turns** (`DUPLICATE_WORK`). `preferredTypeFor` recomputed `comparisonRepresentationPlan` per concept; `recordPlans` and context both rebuilt probe/reference/alignment views. ~32 s per context build on this live state.
2. **TOOL_EXECUTION / Qloo wait — ~116 s tools, of which ~99 s QLOO_SPACING** (`WAITING`). Policy-required 7 s spacing. Not removed.
3. **MODEL_REQUEST — 68 162 ms / 12 calls** (`MODEL_DECISION_OVERHEAD`). Effort stays `high` until a paired medium trial is non-inferior.

Also large: `REPRESENTATION_SELECTION` 54 621 ms (same duplicate plan work as (1)).

Unattributed after union: **16.8 s (2.6%)**. Target A (≥ 95% coverage) **met** on this run.

## 8. Performance Changes

Implemented after the live baseline (so the 641 s parent does **not** include them):

- Per-run memo of pure derived views (`backend/src/agent/derived-cache.ts`) wrapping alignment, reference plan, probe recommendations, and the frontier pool. Cache key is evidence identity.
- `recordPlans` no longer `JSON.stringify`s the full alignment plan on every loop.
- Context already reuses the turn’s sufficiency assessment (Sprint 8B pre-live).
- Cached tool JSON schemas remain from 8A.

Not changed: spacing, budgets, FULL rules, skills, probe caps, production effort/token ceilings.

## 9. Before/After Benchmarks

| Workload | Before | After | Notes |
| --- | --- | --- | --- |
| Historical live parent | 810 s wall, 572 s naive residual | same numbers, still not reconstructable | Frozen |
| Live frozen parent (this sprint, **before** derived memo) | — | 641 s wall, coverage **0.974**, context 354 s | n=1, LIVE |
| Synthetic move (`pnpm perf:agent`) | 116–117 ms | 106 ms | Offline, spacing 0, scripted |
| Synthetic compare | 1074–1138 ms | **426 ms** | Same scripted world; ~60% wall reduction |
| Synthetic frontier | 6 ms | 6 ms | Unchanged |
| Live parent **after** derived memo | — | **NOT_RUN** | One live diagnostic already used; not repeated |

TARGET C (30–50% live latency) is **not** claimed. Synthetic compare improvement is the measured optimization evidence.

## 10. Haiku Effort Results

Eval-only matrix `effort-experiment-v1` unchanged. Production default **high**.

| Sample | Result |
| --- | --- |
| Offline scripted `pnpm effort:compare` | Completes; the baseline policy does not consume the effort arm. **Not effort evidence.** |
| Live Haiku high vs medium, matched cases | **n=0.** `LIVE_HAIKU_EVAL_NOT_RUN`. |

Retain **HIGH**. Sample size is insufficient to change production.

## 11. Token Usage Analysis

Live parent (decision+synthesis aggregate): 17 777 output tokens, 12 model turns, 0 repairs, synthesis first-attempt valid, no `max_tokens` truncation.

Focused C9 (2 cases): 29 417 output tokens, 0 repairs, first-attempt valid-action rate 0.87 / after-repair 1.

`proposeTokenCeilings` still refuses to lower 16_000 when samples are sparse or truncated. **Production ceilings unchanged.** Truncation guard preserved.

## 12. C9 Revalidation

Original live failures (Sprint 5A.2 attempt 4, unchanged grader):

- L-C2 `TAG_TYPE_EVIDENCE_VALID`: `interests:qloo:heavy_metal` reported successful; recommend had TIMED OUT.
- L-E1 `TAG_TYPE_EVIDENCE_VALID`: `genre:music:folk` brand reported empty; call had TIMED OUT.

Offline: still reproduced (`sprint-8a.test.ts`, `sprint-8b.test.ts`, `agent-sprint5a2.test.ts`). Grader version **run-evaluators-v2.1** intact.

Focused live, model arm only, `pnpm eval:agent:live -- --arms model --cases L-C2,L-E1`:

| Case | Status | `TAG_TYPE_EVIDENCE_VALID` | Other evaluator failures |
| --- | --- | --- | --- |
| L-C2 | COMPLETE · DESCRIPTIVE + INSUFFICIENT | **pass** | none |
| L-E1 | COMPLETE · two PARTIAL + two INSUFFICIENT | **pass** | none |

Gate print: **C9 targeted runtime evaluators: 0 failures (required = 0)** on this two-case subset.

This is **not** `LIVE_PASS` of the prescribed 7-case competence gate. Full suite, baseline, and 3-run frontier stability were not repeated.

## 13. Agent Readiness

`agent-readiness-gate-v3` on the focused run: **`AGENT_MODEL_NOT_READY`** because 2/7 prescribed cases, no case-matched baseline, stability NOT_MEASURED, C3/C4/C5 incomplete.

Safety on the two runs: 0 permission violations, 0 benchmark leakage, 0 invalid FULL, 0 unsupported accepted claims, 0 budget violations, 0 secret leakage.

## 14. Frontier Stability

Frozen criteria `frontier-stability-criteria-v1` unchanged. Required 3 repeats **not collected**. L-E1 ran once (COMPLETE, mixed PARTIAL/INSUFFICIENT). Do not substitute raw candidate overlap. Last PASS numbers remain Sprint 5A.2.

## 15. Safety and Methodology

- Invalid FULL on the live parent: 0 (semantic assessments present; no FULL route).
- Hallucinated claims: 0 accepted unsupported numerical claims on C9 runs.
- Tool argument validity on C9: 1.0.
- Methodology consistency: 1. Elasticity score gate unchanged (not re-opened).

## 16. Vercel Account Discovery

Connected Vercel MCP, read-only then limited deploy.

| Field | Value |
| --- | --- |
| User | `raulmermans` |
| Plan | **Hobby** (`billing.plan=hobby`) |
| Team | `team_XhPrQDNS4DIWblm4khq4VNU0` / `raulmermans-projects` |
| Project | `cultural-elasticity-feasibility` `prj_XW5QxClnn0w4egFdgR3YDC1wfOi7` |
| SSO protection | enabled, `deploymentType: all` |
| Password protection | off |
| Env vars | **none** (no Anthropic/Qloo secrets) |
| Project nodeVersion | 24.x default; deployments overridden to **22.x** (`process.version` observed `v22.23.2`) |
| 1800 s beta | **not assumed / not evidenced** |
| Workflow Hobby allowance | 50k events / 1 GB written included; Data Retained is Pro |

Unrelated projects were not modified. No DNS, no production domain, no plan upgrade.

## 17. Private Preview

| Item | Value |
| --- | --- |
| Isolated app | `apps/vercel-feasibility` (not the Living Atlas) |
| Preview URL | `https://cultural-elasticity-feasibility-ki5cfsltc-raulmermans-projects.vercel.app` (deployment `dpl_GKxqDw94FzTKG2tTgkpUdGpbHfn7`, target `null` = preview) |
| Earlier preview | `dpl_FKzA48H33beWuLoRZFJTNnfcum5L` (Function/MCP proof without Workflow SDK) |
| Failed first deploy | `dpl_2JxbjahGYV3EidGBExkZitCZdopv` — Vercel assigned `target: production` on the first project deploy; `pnpm install` hit `ERR_INVALID_THIS`; **ERROR**. Isolated app only; SSO still covers `deploymentType: all`. |
| Unauthenticated GET `/api/health` | **302** to Vercel SSO |
| Unauthenticated POST `/api/poc` | **401** `Protected by Vercel Authentication` |
| Operator GET `/api/health` | 200, Node 22.23.2, `hosted: true` |
| Paid providers | disabled; no credentials |
| Operator share links | MCP `web_fetch_vercel_url` / `get_access_to_vercel_url` create expiring share cookies. **Not a security boundary.** Tokens are not published here. |
| Rollback | delete the deployment or the isolated project in the Vercel dashboard; no DNS to unwind |

## 18. Function Runtime Proof

Hosted POST `/api/poc` (SSO): Node `v22.23.2`, `hosted: true`, RSS 74.6 MB, duration 138–4156 ms.

| Gate | Outcome | Evidence |
| --- | --- | --- |
| FUNCTION_BUILD_COMPATIBLE | **PASS** | Hosted Next build, Node 22 |
| FUNCTION_RUNTIME_COMPATIBLE | **PASS** | `process.env.VERCEL`, nodejs22.x logs |
| MCP_SUBPROCESS_COMPATIBLE | **PASS** | fake MCP initialize + `tools/call` |
| ACTUAL_QLOO_HARNESS_COMPATIBLE | **FAIL** | First preview: bin not in bundle. Workflow preview: bin resolved, **initialize rpc timeout** (4 s). No live `tools/call`. |
| LIVE_QLOO_CONNECTIVITY | **NOT_TESTED** | No Qloo credential on the preview |

A `--help` invocation was not used as the gate.

## 19. Qloo Harness Proof

Local `pnpm poc:vercel`: fake MCP PASS (92 ms); harness spawn+initialize CONDITIONAL (1063 ms, no live tools/call).

Hosted: fake MCP PASS; actual harness initialize **FAIL** (`rpc timeout`). Distinct from local. **Do not mark hosted harness PASS from local evidence.**

## 20. Official Workflow SDK Proof

Package: **`workflow@5.2.3`**. `next.config.ts` wrapped with `withWorkflow` from `workflow/next`. Journey in `apps/vercel-feasibility/workflows/synthetic-investigation.ts` (`"use workflow"` / `"use step"` / `FatalError` for unsafe retry).

| Gate | Outcome | Evidence |
| --- | --- | --- |
| WORKFLOW_COMPILER_PASS | **PASS** | Local `next build`: “Compiled workflows in 632ms (23 steps, 1 workflow)”; routes `/.well-known/workflow/v1/flow` |
| WORKFLOW_HOSTED_EXECUTION | **FAIL** | Hosted `start()` returned `wrun_41M5ME8HHJ0GXC6TH516PVMTAC`; runtime log: `FatalError: Step validateRequest is not registered in the current deployment` |
| WORKFLOW_REPLAY_PASS | **NOT_TESTED** | Hosted run never committed a step |
| WORKFLOW_RETRY_SAFETY | **CONDITIONAL** | `FatalError` used so an uncertain external call is not retried; hosted step never ran |

A home-built simulator is not this evidence. Local TypeScript calling the functions without `withWorkflow` is labelled `NOT_TESTED (ordinary TypeScript)`.

## 21. Durability Requirements

Minimum for a Vercel-only product (not migrated this sprint):

| State | Today | Vercel-only need |
| --- | --- | --- |
| Active run / working context | in-process `RunStore` | durable store keyed by `runId` |
| Validated evidence / artifacts | memory | durable, provenance-preserving |
| Parent-child lineage | process memory | durable foreign keys |
| Checkpoints / traces | memory + optional files | durable blob/log |
| Monetary reservations | in-process spend bound | durable reservation **before** provider dispatch |
| Final results | memory | durable, immutable after finalize |

## 22. Retry and Idempotency

- Stable `operationId` per Qloo dispatch; settle once.
- A committed tool result must not be re-executed on workflow replay.
- A started-but-uncommitted provider request must **not** be retried blindly (late answers discarded).
- `FatalError` on uncertain externals: refuse retry rather than duplicate spend.
- Provider calls are at-least-once at the network; the runtime treats them as **at-most-once for evidence**.

## 23. Access Control

Preview: Vercel Authentication on **all** deployments. Application paid routes are not deployed on this app. Hiding the query box is not the control. Visitor cookies/IPs are not identity. Operator share URLs expire and are not the product ACL.

## 24. Spend Controls

Preview has no provider keys. Live local runs used existing project credentials after presence checks (values never printed). Observed model USD this sprint: **$0.0184** (parent) + **$0.03** (C9 two cases) ≈ **$0.048**. Qloo calls: 27 + 17 + 32 = 76 spaced calls. Full 7-case gate was **not** launched (additional spend beyond this focused set).

## 25. Architecture Decision

**Product (Living Atlas + agent):** **D. VERCEL_FRONTEND_PLUS_PERSISTENT_BACKEND** remains the correct hosting for correctness. Jobs, spend reservations, Qloo spacing, and 10-minute investigations are incompatible with freeze-after-response Functions without a durable workflow+store that actually works.

**Vercel-only hypothesis (C. VERCEL_WORKFLOW_PLUS_DURABLE_STORE):** still a hypothesis. This sprint proved Function Node 22 + child_process + fake MCP, and official SDK compilation. It did **not** prove hosted step registration, harness initialize, durable spend, or 1800 s runs.

Do not migrate the AgentRuntime onto Workflow this sprint.

## 26. Regression Tests

Added/extended: `backend/tests/sprint-8b.test.ts` (unmeasured invalidFull, FULL/PARTIAL split, per-call metadata, reserve-at-dispatch, post-finalization, C9 grader intact, derived-view memo identity, effort/token defaults).

Backend: **689 passed**. Frontend unit: **14 passed**. E2E this session: **2 passed / 14 failed** (Playwright composer hydration timeouts on `127.0.0.1:3100`; Living Atlas source not edited). Offline smoke: **PASS**, recorded example SHA-256 `064c7f6e87692a45cc5790cf4901b879dd75d8ecbb0b72ad2aee0a76e41d3f75`.

## 27. Live Provider Usage

| Run | Model | Qloo | Wall | Model USD |
| --- | --- | --- | --- | --- |
| Frozen parent trace | Haiku 5.5 high | 27 | 641 s | 0.0184 |
| L-C2 | Haiku 5.5 high | 17 | 141 s | 0.0141 |
| L-E1 | Haiku 5.5 high | 32 | 255 s | 0.0159 |

Secrets never written to traces (`scrubSecrets`). Preview had none.

## 28. Known Limitations

- Live after-memo parent was not re-run.
- Effort medium live n=0.
- Full readiness gate 7/7 not repeated.
- Hosted Qloo harness initialize timed out; no live hosted Qloo.
- Hosted Workflow steps not registered on the file-based deploy.
- E2E suite failed this session; treat as unverified browser harness, not a proven Atlas regression.
- `invalidFull` for `NEEDS_INPUT` reports 0 (no FULL territories), which is not an evaluator result.

## 29. Sprint 8C Recommendations

1. Repeat the frozen live parent **after** the derived-view memo; report context exclusive ms.
2. If coverage stays high, consider paired **medium** effort on two frozen cases (not production change without non-inferior C9).
3. Full live gate v3 only with explicit budget (7 cases + baseline + stability×3).
4. Fix hosted Workflow step registration (include generated `.well-known/workflow` in the Vercel build) and lengthen harness initialize timeout; re-test on the same protected project.
5. Do not put production secrets on the feasibility project.
6. Repair or quarantine the Playwright webServer flake separately from agent work.

## 30. Deployment Migration Plan

Keep the product on a persistent Node 22 backend until: hosted Workflow steps replay, durable run state, durable spend reservation, Qloo spacing preserved, Function duration covers a full investigation or steps suspend across waits, and the prescribed live gate is green. The isolated feasibility project can stay as a protected laboratory. No production promotion.
