# Sprint 8C — Verified agent performance and Vercel recovery

Evidence-producing execution sprint. Not a Living Atlas redesign. Not a backend migration. Not Sprint 8D.

Frozen baseline remains `evals/perf/baseline-manifest.json` (`sprint-8a-baseline-v1`). Frozen competence remains `evals/agent/stability-criteria.json` (`frontier-stability-criteria-v1`) and `agent-readiness-gate-v3` / `run-evaluators-v2.1`. Historical 810 s parent numbers are not rewritten.

Production model unchanged: `claude-haiku-5-5`, effort `high`, decision/synthesis `max_tokens` 16_000, Qloo spacing 7000 ms, harness `@qloo/qloo-harness@0.1.26`.

## 1. Executive Outcome

| Gate | Decision |
| --- | --- |
| Engineering | **ENGINEERING_COMPLETE** for browser E2E, cache identity, span/outcome integrity, late-Qloo regressions, live after-memo parent, C9 grader freeze, and hosted MCP/Workflow diagnosis. The typebox-tracing redeploy did not become READY. |
| Browser | **BROWSER_E2E_PASS** — 16/16 twice (dev server, HTTP-ready webServer). |
| Performance | **LIVE_PERFORMANCE_IMPROVED** on one frozen live parent after derived-state memo, corroborated by synthetic replay. Not a 50% average claim. |
| Agent competence | **`AGENT_MODEL_NOT_READY`.** C9 targeted regressions pass. Focused 8B L-C2 / L-E1 evidence is retained. The prescribed 7-case gate was **not** re-run: `LIVE_GATE_BLOCKED_BY_APPROVAL`. |
| Vercel | **`VERCEL_ONLY_CONDITIONAL`.** Same protected Hobby project. Node 22 Functions and fake MCP **PASS**. Workflow step registration **PASS** on hosted preview `dpl_9XSHDYVGFhZeMuZqDwBSuizjonbc`. Real Qloo harness initialize **FAIL** — missing `typebox` in the function bundle, not an unexplained RPC timeout. A follow-up local-files deploy (`dpl_ATWBmFAo2tJHdMwpVqAj3imgPuy1`) **ERROR** on `start()` TypeScript overloads. |

Do not collapse these gates.

## 2. Starting State

- Previous checkpoint: `sprint/8b-live-agent-optimization` at `6e284e7` (`Sprint 8B: reserve Qloo budget at dispatch, cut duplicate context work, and record a protected Vercel preview as conditional.`). Working tree was clean.
- This sprint branch: `sprint/8c-verified-agent-performance` (uncommitted unless the owner later approves a commit). Not pushed.
- Node 22.23.2, pnpm 10.26.0.
- Sprint 8B uncommitted work had already been committed on `6e284e7` before this branch was created. No reset or discard.

## 3. Sprint 8B Baseline

Fresh live parent (before derived memo), frozen prompt “Where could Jacquemus expand?”, Haiku 5.5 effort high:

| Clock | Sprint 8B |
| --- | --- |
| Run id | `b76dd766-2136-43d5-a388-b3463bdd3bdc` |
| Wall | 641 130 ms |
| Coverage | 0.974 |
| Qloo | 27 calls |
| Model | 12 turns · 68 164 ms · 17 777 out tokens · $0.0184 |
| CONTEXT_ASSEMBLY exclusive | 354 099 ms |
| REPRESENTATION_SELECTION exclusive | 54 621 ms |
| Outcomes | validFull 0, invalidFull 0, partial 1, insufficient 3, unsupported 3 |
| Invalid actions | 3 |

Synthetic compare after memo (8B): 426 ms vs 1074–1138 ms before. Live after-memo parent was **NOT_RUN** in 8B.

E2E: 2/16 PASS, 14/16 FAIL (composer hydration timeouts). Treated as RED in 8B.

Vercel: Functions PASS, fake MCP PASS, real harness initialize FAIL (4 s RPC timeout), hosted Workflow `start()` returned a run id then `FatalError: Step validateRequest is not registered`.

## 4. Browser E2E Root Cause

**Cause:** Playwright `webServer` treated TCP listen as ready. Next.js 16 binds `127.0.0.1:3100` before the first route compiles. The first tests then raced a 30 s composer-hydration timeout against compilation. This is a readiness bug, not an unexplained flake and not a product hydration defect in the Living Atlas source.

**Fix:** wait on `url: http://127.0.0.1:3100/` (HTTP 200), bind `next dev --hostname 127.0.0.1`, and fail `open()` with status / `pageerror` / console if `data-hydrated` never appears. Timeouts were not globally raised to hide the failure.

**Not the cause:** application selectors, secret leakage, or Living Atlas layout. Unsetting `PLAYWRIGHT_BROWSERS_PATH` in a sandbox did send Chromium to an empty cache; that was a measurement artifact, restored, not the product fix.

**Result:** 16/16 PASS, twice, clean Playwright webServer (first run ~56.6 s including first compile, second ~40.6 s). Product regression gate **GREEN**.

Production `next start` mode is available via `E2E_MODE=production` and was not required once HTTP-ready dev was shown to be the 14-fail root cause.

## 5. Cache Invalidation

`backend/src/agent/derived-cache.ts` no longer keys on collection cardinalities.

Fingerprint identity now includes: run id, finalized bit, intent, brand entity id, usage counters, per-territory exemplar ids/types/quality, rejected exemplar ids/codes, source and evidence tag ids, pool member ids, entity ids, tag labels/types, profile tag ids, related member ids, result routes/status, candidate rejection identity, and semantic assessment status.

Invariants covered by `backend/tests/sprint-8c.test.ts`:

| Case | Result |
| --- | --- |
| Unchanged inputs reuse the derived object | hit |
| Same-type representation replacement | miss |
| Entity replacement at the same map size | miss |
| Pool member identity at the same length | miss |
| Candidate identity at the same related length | miss |
| Tag/profile content at the same map size | miss |
| Rejected exemplar content at the same count | miss |
| Reference-plan semantic input without territory-count change | miss |
| Territory supported-evidence change without status change | miss |
| New reference relationship | miss |
| Separate run objects never share a memo table (`WeakMap`) | isolated |
| `finish()` sets `finalized` then `clearDerivedCache()` | no retained mutable authority |

Cached views still cannot authorize Qloo calls, skip sufficiency, or change permitted tools. Methodology code is unchanged.

## 6. Metric Integrity

`reconcileSpanCoverage` now reports, separately:

- **inclusive** phase duration (sum of span durations)
- **exclusive-of-children** duration
- **wall union** per phase (`wallUnionMs`)
- **overlap duration**
- **unattributed gaps**
- **hierarchy** (parent/child, inclusive vs exclusive-of-children)
- `exclusiveSumExceedsCovered` when unparented overlapping spans make exclusive sums exceed union coverage

The honest wall clock remains **coveredMs / monotonicElapsedMs**. Exclusive sums are not rewritten to manufacture coverage.

`routeCounts()`:

- `FULL_RELATIVE_ANALYSIS`, `PARTIAL_CULTURAL_ANALYSIS`, `DESCRIPTIVE_ANALYSIS`, `INSUFFICIENT_EVIDENCE` stay disjoint analysis routes.
- `unsupported` is `evidenceStatus === "UNSUPPORTED"` only.
- `unsupportedOrInsufficientFamily` is an explicit labelled family of unique territory keys, not a fifth route.
- An invalid FULL is never a valid supported result.
- When the evaluator/semantic assessment has not run, `invalidFull = null` (missing evaluation is not zero errors).
- `NEEDS_INPUT` reports `invalidFull = null`.

The Sprint 8B live exclusive-phase list that summed above wall time was therefore **not mutually exclusive**. 8C reports that honestly.

## 7. Late Qloo Accounting

Unchanged policy, retested:

1. Reserve one budget unit at dispatch.
2. A late settlement does not increment `qlooCalls` a second time.
3. Timed-out completions are not cached.
4. Abandoned answers after `state.finalized` do not mutate pools or usage.
5. C9 grader `TAG_TYPE_EVIDENCE_VALID` remains `run-evaluators-v2.1`. A timed-out probe recorded as empty still fails the grader.

## 8. Controlled Replay Benchmark

`pnpm perf:agent` — synthetic world, scripted/baseline policy, spacing 0. **Not live Qloo. Not live Haiku.**

| Case | Sprint 8B after memo | Sprint 8C this session |
| --- | --- | --- |
| move | 106–117 ms | **117 ms** |
| compare | 426 ms (8B after; 1074–1138 ms before memo) | **231 ms** |
| frontier | 6 ms | **7 ms** |

Compare remains the workload that used to rebuild alignment/reference/probe views. Relative to the pre-memo 1074–1138 ms band this is still a large reduction. Sample size for this session is n=1 per case; 8B quoted an after-memo compare of 426 ms. Variance is real. Do not quote a single percentage as the optimization.

Replay purpose: isolate the software change. The cache is the causal explanation for the collapse of CONTEXT_ASSEMBLY / REPRESENTATION_SELECTION.

## 9. Fresh Live Benchmark

One frozen live parent **after** derived-state memo. Host kept awake. Same prompt, model, effort, spacing, budgets, evaluators, methodology.

| Clock | Value |
| --- | --- |
| Label | **LIVE Haiku + LIVE Qloo**. Not a full readiness gate. |
| Run id | `775217fd-64af-4048-90a8-41042374b751` |
| Prompt | Where could Jacquemus expand? |
| Status | COMPLETE |
| Wall | **227 412 ms** (observed 227 425 ms) |
| Monotonic | 227 409 ms |
| Span coverage | **0.992** (225 662 ms covered, 1 747 ms unattributed, skew 3 ms) |
| Spans | 341 |
| Model | 65 296 ms · 104 361 in / 17 640 out · **$0.0179** · effort high · 12 turns · 0 repairs |
| Qloo | 28 calls · 143 658 ms of which spacing 126 432 ms, active 17 226 ms, startup 553 ms |
| CONTEXT_ASSEMBLY exclusive | **1 427 ms** / 11 turns |
| REPRESENTATION_SELECTION exclusive | **1 017 ms** / 6 |
| TOOL_EXECUTION exclusive | 136 626 ms |
| FINALIZATION / SYNTHESIS / ANALYSIS | 10 831 / 10 765 / 7 781 ms |
| Outcomes | validFull 0, invalidFull 0, partial 1, descriptive 0, insufficient 3, unsupported 3, family 3 |
| Invalid actions | 5 |
| Artifact | `backend/feasibility-output/sprint8c-live-trace/report.json` |

`exclusiveSumExceedsCovered` is **true** (380 089 ms exclusive sum vs 225 662 ms union) because QLOO_SPACING and TOOL_EXECUTION overlap without parentage. Union coverage is the honest clock.

## 10. Before/After Latency

Versus the Sprint 8B live parent (same frozen prompt; **not** the 810 s Sprint 5B.3 run).

| Metric | 8B before memo | 8C after memo | Δ |
| --- | --- | --- | --- |
| Wall | 641 130 ms | 227 412 ms | **−413 718 ms (−64.5%)** |
| CONTEXT_ASSEMBLY exclusive | 354 099 ms | 1 427 ms | **−352 672 ms (−99.6%)** |
| REPRESENTATION_SELECTION exclusive | 54 621 ms | 1 017 ms | **−53 604 ms (−98.1%)** |
| Model latency | 68 164 ms | 65 296 ms | −2 868 ms (−4.2%) |
| Qloo calls | 27 | 28 | +1 |
| Qloo latency (incl. spacing) | 122 196 ms | 143 658 ms | +21 462 ms |
| Model out tokens | 17 777 | 17 640 | −137 |
| Model cost | $0.0184 | $0.0179 | −$0.0005 |
| Turns | 12 | 12 | 0 |
| Coverage | 0.974 | 0.992 | +0.018 |

The wall reduction is almost entirely the disappearance of duplicate derived-view work. Qloo wait was not improved (spacing policy unchanged; this run spent more time in spacing). Model time is comparable.

**Limitations:** n=1 live pair. Qloo’s response surface can change. Do not claim a stable 64% average. Causal isolation is the synthetic replay; the live run shows the same bottleneck no longer dominates wall time.

## 11. Evidence Quality Comparison

| Outcome | 8B live parent | 8C live parent |
| --- | --- | --- |
| valid FULL | 0 | 0 |
| invalid FULL | 0 | 0 |
| PARTIAL | 1 | 1 |
| INSUFFICIENT | 3 | 3 |
| unsupported evidence | 3 | 3 |
| invalid actions | 3 | 5 |

Research quality is **not** substantially degraded. An honest PARTIAL plus INSUFFICIENT/UNSUPPORTED abstentions is the same shape. Invalid FULL remains 0. The rise in invalid actions (3→5) is a competence cost, not a cache-correctness failure, and is not treated as an improvement.

## 12. Full vs Partial Stability

The recorded Living Atlas Jacquemus example contains FULL territories. That recording is a different code revision and a different investigation path (Sprint 5B.3 / recorded example), not an expected answer for this runtime.

Categories for 0 FULL on both 8B and 8C live parents:

- **QLOO_OBSERVATION_VARIATION** — live related/recommend membership can differ.
- **MODEL_DECISION_VARIATION** — 12-turn path, 5 invalid actions on 8C.
- **METHODOLOGY_VALIDATION** — FULL requires a semantically valid comparison set; PARTIAL/INSUFFICIENT is preferred to a misleading FULL.

Not classified as **RUNTIME_REGRESSION** of the memo cache: outcome routes match 8B, and invalid FULL is 0. Not forced to match the recorded example.

## 13. C9 Revalidation

Grader **unchanged**: `TAG_TYPE_EVIDENCE_VALID`, `run-evaluators-v2.1`.

Offline: `backend/tests/sprint-8c.test.ts` still fails a timed-out probe recorded as empty.

Sprint 8B focused live (retained, not re-spent):

| Case | Result |
| --- | --- |
| L-C2 | `TAG_TYPE_EVIDENCE_VALID:pass` |
| L-E1 | `TAG_TYPE_EVIDENCE_VALID:pass` |

This is not the prescribed seven-case competence gate.

## 14. Live Readiness Gate

Manifest: `evals/agent/sprint-8c-live-gate-manifest.json` (`sprint-8c-live-gate-manifest-v1`).

- Prescribed model: L-M1, L-M2, L-M3, L-C1, L-C2, L-E1, L-E2
- Case-matched baseline: same seven
- Frontier stability: L-E1, L-E2 × 3
- Conservative reserve: $2.50 model; Qloo unit-capped separately
- Command: `pnpm eval:agent:live -- --arms baseline,model --stability 3 --out backend/feasibility-output/sprint8c-live-gate`

**Not executed.** Credentials on disk are not this authorization. Status: **`LIVE_GATE_BLOCKED_BY_APPROVAL`.**

Therefore:

- SAFETY_GATE — last full-gate evidence remains Sprint 5A.2 / 8B focused subset; full 13/13 not re-measured
- COMPETENCE_GATE — still 8/9 on the last full gate; C9 targeted live pass is not the seven-case gate
- STABILITY_GATE — required 3-run frontier **NOT_MEASURED** this sprint
- METHODOLOGY_GATE — offline elasticity structural checks pass; index remains `REJECTED_FOR_NOW`

`AGENT_MODEL_READY` is not declared.

## 15. Model Effort Experiment

Live Haiku high vs medium matched trials: **n=0.** `LIVE_HAIKU_EVAL_NOT_RUN`.

Retain production **HIGH**. No LOW trial. Offline `effort:compare` is not effort evidence.

## 16. Token Usage

Live parent: 17 640 output tokens across 12 decision turns + synthesis, 0 repairs, synthesis first-attempt valid, no `max_tokens` truncation reported.

Mean ≈ 1 470 output tokens per model call if spread evenly; per-call maxima were not separately exported. That distribution does **not** justify lowering the 16 000 decision/synthesis ceiling. Truncation guard preserved.

## 17. Provider Costs

This sprint’s additional live parent: **$0.0179** model, **28** Qloo calls.

Sprint 8B parent + focused C9 costs are already recorded in the 8B report and were not repeated.

No Vercel plan upgrade. No public paid investigations.

## 18. Vercel Project Verification

Connected Vercel MCP, existing project only.

| Field | Value |
| --- | --- |
| Project | `cultural-elasticity-feasibility` `prj_XW5QxClnn0w4egFdgR3YDC1wfOi7` |
| Team | `raulmermans-projects` `team_XhPrQDNS4DIWblm4khq4VNU0` |
| SSO protection | **enabled**, `deploymentType: all` |
| Password protection | off |
| Env vars | **none** (no Anthropic/Qloo secrets) |
| Plan | Hobby (runtime-log retention 1 hour; 1800 s duration **not** evidenced) |
| Hosted Node observed | **v22.23.2** (`/api/health`) |
| Project nodeVersion field | 24.x default in the API; functions ran 22.x |
| Unrelated projects | not modified |
| Production / DNS / domains | not touched |

## 19. Hosted MCP Root Cause

Sprint 8B’s “RPC timeout” was a **symptom**.

On protected preview `dpl_9XSHDYVGFhZeMuZqDwBSuizjonbc` (8C diagnostics, SSO on, paid providers disabled), POST `/api/poc`:

| Stage | Result |
| --- | --- |
| FUNCTION_RUNTIME_COMPATIBLE | **PASS** `v22.23.2` hosted |
| HARNESS_BINARY_RESOLVED | **PASS** `./node_modules/@qloo/qloo-harness/dist/bin.js` |
| HARNESS_PROCESS_STARTED | **PASS** pid 33 |
| MCP_INITIALIZE_COMPLETED (fake) | **PASS** 75 ms |
| MCP_FAKE_TOOL_CALL_COMPLETED | **PASS** |
| ACTUAL_QLOO_HARNESS_COMPATIBLE | **FAIL** |
| LIVE_QLOO_CONNECTIVITY / ACTUAL_QLOO_TOOL_CALL | **NOT_TESTED** (no credential on the preview) |

Harness stderr (redacted in the client; no secret present):

```text
qloo: unexpected failure: Cannot find package 'typebox' imported from
/var/task/node_modules/@qloo/qloo-harness/dist/artifact-tool.js
```

Child exit code 1. The 12 s initialize timeout is the client waiting on a process that already crashed because Next file tracing included the harness `dist/` but not its runtime dependency `typebox@1.3.7`.

A longer timeout is not a fix. Local change: add `typebox` as a direct feasibility dependency and trace `node_modules/typebox/**` plus the pnpm nested path. That revision is **not** on a READY preview (see §21).

Diagnostics added: `LineBuffer`, stable JSON-RPC ids, separate startup/request deadlines (clamped), redacted stderr, child termination, hang-init fake MCP, cold/warm slots, staged lifecycle.

## 20. Hosted MCP Retest

Retest against `dpl_9XSHDYVGFhZeMuZqDwBSuizjonbc`: fake MCP **PASS**; real harness initialize **FAIL** with the typebox error above. `--help` was not used as MCP evidence.

A follow-up deploy intended to carry the typebox tracing fix did not reach READY (`dpl_ATWBmFAo2tJHdMwpVqAj3imgPuy1`, ERROR). Hosted harness initialize after the tracing fix is **not proven**.

## 21. Workflow Registration Failure

Sprint 8B: `FatalError: Step validateRequest is not registered in the current deployment` after `start()` returned a run id.

8C local compiler: `withWorkflow(nextConfig)`, named `"use step"` exports, generated manifest lists `validateRequest` under `workflows/synthetic-investigation.ts`.

Hosted on `dpl_9XSHDYVGFhZeMuZqDwBSuizjonbc`:

- GET `/api/workflow` lists `validateRequest`, `syntheticAgentDecision`, `mockedQlooTool`, `persistStep`, `resumeCommitted`, `uncertainExternal`.
- POST `start()` returned `wrun_41M5N1J1EB0GW34PJN7W6JSBVW`.
- Runtime log: step **`uncertainExternal` executed** (`FatalError: retrying qloo_find_tags is unsafe`).

That is the last step of the then-current workflow. **Step registration is no longer the 8B failure.** Official SDK (`workflow@5.2.3`) only.

`FatalError` is not catchable inside the workflow; the runtime bubbles it and fails the run. That is correct “do not retry a paid-looking call” semantics, so the happy-path COMPLETE artifact was split locally into `syntheticInvestigationWorkflow` vs `refusedRetryWorkflow`. That split did not land on a READY preview: `dpl_ATWBmFAo2tJHdMwpVqAj3imgPuy1` failed TypeScript because `start(unionOfTwoWorkflows, …)` is not a valid overload. Fixed locally by calling `start()` on one function.

## 22. Hosted Workflow Retest

| Check | Result |
| --- | --- |
| Local compiler | PASS (2 workflows after the split; 8C preview compiled 1 workflow + 6 steps) |
| Hosted start() run id | PASS `wrun_41M5N1J1EB0GW34PJN7W6JSBVW` |
| Hosted step registration | **PASS** (last step ran) |
| Hosted happy-path COMPLETE | **NOT_PROVEN** (FatalError aborted that run; split workflow not on READY) |
| Replay without duplicating committed ops | **NOT_PROVEN** on hosted |
| FatalError refuse-retry | **PASS** (run failed, no retry loop observed) |
| Follow-up deploy | ERROR `dpl_ATWBmFAo2tJHdMwpVqAj3imgPuy1` (`start()` TS2769) |

A local compiler PASS is still not by itself a hosted COMPLETE.

## 23. Replay and Retry Safety

Specified, only partly hosted-proven:

- Stable operation ids on the mocked Qloo step (`qloo_find_tags:synthetic`).
- `FatalError` for uncertain paid-looking retries — hosted, the SDK failed the run rather than retrying.
- No uncontrolled automatic retry of paid providers (preview has no provider secrets).
- Workflow step log is **not** the application’s query/run store.

## 24. Durability Requirements

Minimum durable application state, kept separate:

| Store | Role |
| --- | --- |
| RUN STATE | phase, budgets, finalized |
| WORKING CONTEXT | turn context, not evidence |
| INVESTIGATION LINEAGE | parent/child geometry |
| EVIDENCE | Qloo envelopes with correlation ids |
| CHECKPOINTS | resume points |
| FINAL ARTIFACTS | validated analysis results |
| TRACES | spans, tokens, cost |
| SPEND RESERVATIONS | atomic holds |

Workflow’s step log does not replace these. Smallest Vercel-compatible mechanism remains a durable store (KV or SQL) beside Workflow — **not implemented this sprint**.

## 25. Spend Protection

The in-memory spend ledger cannot be authoritative across Vercel invocations.

Required, specified, not implemented:

- atomic reservation with unique operation identity
- charged-usage reconciliation
- uncertain provider completion
- duplicate-dispatch prevention
- budget exhaustion and crash recovery
- refund of unused reserved capacity
- immutable usage history

Exactly-once external API execution is **not** claimed. Public live investigations stay disabled until this exists.

## 26. Vercel Architecture Decision

Selected: **C is the intended future candidate; the present decision remains `VERCEL_ONLY_CONDITIONAL`.** Option letters:

- A `VERCEL_FUNCTIONS_ONLY` — rejected for a 227 s investigation on Hobby Function duration (30 s PoC ceiling observed; 1800 s not available).
- B `VERCEL_WORKFLOW` — insufficient without a durable application/spend store.
- **C `VERCEL_WORKFLOW_PLUS_DURABLE_STORE`** — preferred Vercel-only path **after** (1) hosted harness initialize with traced `typebox`, (2) hosted happy-path COMPLETE + replay, (3) durable spend reservations.
- D `VERCEL_FRONTEND_PLUS_PERSISTENT_BACKEND` — remains the **current product host**. Do not migrate the Living Atlas this sprint.

Owner preference for Vercel-only is respected as the target, not as a reason to run paid investigations on an in-memory ledger or a missing harness dependency.

## 27. Product Regressions

Living Atlas product source was not redesigned. Composer, recorded example, evidence inspector, parent/child navigation, narrowing, clarification, unsupported intent, mobile, keyboard, reduced motion, cancellation, missing investigation, and secret sentinels are covered by the restored 16/16 E2E suite.

No Jacquemus-specific production logic. No new scoring methodology. No unsupported FULL accepted on the live parent.

## 28. Verification Results

Node 22.23.2, pnpm 10.26.0.

| Command | Result |
| --- | --- |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS after deleting iCloud duplicate files under `frontend/.next/types/* 2.ts` (generated, not source) |
| `pnpm test` | PASS — backend 56 files / 717 tests; frontend 14/14; feasibility placeholder |
| Sprint 8C focused tests | PASS — 28 tests (`sprint-8c.test.ts`, `sprint-8c-vercel.test.ts`) |
| `pnpm build` | PASS (frontend Next 16.4.2, backend, shared). Feasibility app excluded from the workspace build as before |
| `pnpm check:secrets` | PASS — 361 repo files, 19 production bundle files, no leakage |
| `pnpm eval:methodology` | PASS 19/19, `LIVE_QLOO_VALIDATION_NOT_RUN` |
| `pnpm eval:agent` | PASS 53/53 synthetic, `LIVE_AGENT_MODEL_VALIDATION_NOT_RUN` |
| `pnpm eval:elasticity` | structural 27/27 PASS, process exit 0; **Score gate FAIL**; **Relative Elasticity Index `REJECTED_FOR_NOW`** (not an accepted index) |
| `pnpm eval:live` | PASS 19/19 live-fixture + 3/3 recorded, offline |
| `pnpm eval:query` | offline gate PASS vs targets; `LIVE_HAIKU_QUERY_VALIDATION_NOT_RUN`; X06 listed for review |
| `pnpm perf:agent` | move 117 ms, compare 231 ms, frontier 7 ms (synthetic) |
| `pnpm test:e2e` | 16/16 twice (this sprint, HTTP-ready webServer) |
| `pnpm smoke:offline` | `OFFLINE_SMOKE_PASS` |
| `pnpm eval:agent:live` full gate | **NOT RUN** — `LIVE_GATE_BLOCKED_BY_APPROVAL` |
| `pnpm eval:query -- --live` | **NOT RUN** |
| Docker smoke | **NOT RUN** (not required for this evidence) |

## 29. Known Limitations

- Live after-memo sample size n=1.
- Full readiness gate not executed.
- Effort medium live n=0.
- Hosted real Qloo harness still FAIL on the READY preview (typebox).
- Hosted happy-path Workflow COMPLETE not proven.
- Follow-up preview ERROR on `start()` overloads; fix is local only.
- In-memory spend ledger unchanged.
- Hobby Function duration cannot host a 227 s investigation as one Function.
- `exclusiveSumExceedsCovered` remains true when overlapping spans are unparented; do not “fix” that by changing the union algorithm.
- iCloud duplicate `* 2.ts` files under `.next` can fail frontend typecheck until removed.

## 30. Sprint 8D or Deployment Recommendation

**Do not start Sprint 8D automatically. Do not publish. Do not migrate the backend.**

Recommended next work, when authorized:

1. Redeploy the isolated feasibility app from **local files** (do not git-push to satisfy Vercel) with the typebox trace + `start()` overload fix; retest harness initialize and happy-path Workflow COMPLETE.
2. Run the frozen full live readiness gate under the $2.50 reserve in the 8C manifest.
3. Only then consider a durable spend store as the first C-path slice.

Until (1) and durable spend exist, keep the Living Atlas on the persistent backend.
