# Sprint 9O: live competence and release report

**Status: IN PROGRESS. The offline phases are complete. The live phases are blocked on owner approval of the budget and of one production variable write.** This file is the canonical record. Sections marked `NOT_RUN` have not been executed. They are not failures and not passes.

Status key:

- `PASS`: run, and met its pre-registered criterion.
- `FAIL`: run, and did not meet it.
- `NOT_RUN`: not executed.
- `UNVERIFIED`: executed, but the evidence is incomplete.

## 1. Starting commits and deployed versions

| Item | Value |
| --- | --- |
| `origin/main` | `c39b978` (merge of PR #47, Sprint 9N) |
| Vercel production | `c39b978` READY |
| Railway backend (latest SUCCESS and running revision) | `c39b978` |
| Branch | `sprint/9o-live-competence-acceptance`, from `origin/main` |

## 2. Production preflight (read-only, 2026-10-29)

Source: `node scripts/release/verify-production.mjs --public-mode --expect-admissions public --max-qloo 1000 --max-usd 5.00`. The probes ran twice: before and after the anonymous hosted tests.

| Check | Result |
| --- | --- |
| Vercel, Railway and running revision all equal `main` | PASS |
| GitHub `main` CI on `c39b978` (verify, docker, browser E2E) | PASS |
| `/health`, `/ready` (200, no reasons), admissions `accepting` | PASS |
| Database ready, job queue empty (0 running, 0 queued, 0 held) | PASS |
| Durable ledger | 142 / 1,000 Qloo calls; 13 / 500 model cents |
| Baseline account | 27 / 408 calls |
| Public evaluation | `qloo-hackathon-2026`, expires 2026-11-06T05:00:00Z |
| Per-network quotas | 10 resolves, 4 scans, 4 investigations. They are durable for the evaluation and never returned. |
| Replicas | 1 |
| Feasibility policy in production | `enforce`. `CE_FEASIBILITY_POLICY` is unset and defaults to `enforce`. |
| Anonymous malformed resolve | Refused 400 before any quota or provider call |
| Verifier classification | `RELEASE_DEGRADED`, caused only by `VERCEL_PREVIEW_ENV_MISSING:CE_INTERNAL_API_SECRET`. This is a known Preview-only gap and does not affect production. |
| Rollback readiness | Two rollback routes exist. Behaviour: `CE_FEASIBILITY_POLICY=observe` (verified offline, §11). Release: the previous `main` SUCCESS deployment stays available on Railway and Vercel. |
| Devpost submission | **UNVERIFIED.** The copy is ready in `docs/submission/DEVPOST.md`. Nothing in the repository or the tools available here can confirm that it was submitted. |

## 3. Budgets

| | Qloo calls | Anthropic |
| --- | --- | --- |
| Proposed Sprint 9O ceiling (not yet approved) | 120 | $0.50 |
| Remaining in the public evaluation | 858 | $4.87 |
| Consumed by Sprint 9O so far | 0 | $0 |

The anonymous hosted tests and the verifier made no paid call. The ledger was unchanged before and after.

## 4. Pre-registered case manifest

See [PREREGISTRATION.md](PREREGISTRATION.md). It was committed in `7fccfe6`, before any live result. The four cases run in this order:

1. Uniqlo → Manga.
2. Holdout discovery (Carhartt, fallback Birkenstock).
3. Crocs → Fine dining.
4. Aesop → Coffee.

There is a stopping rule per case.

## 5. Live test results

| Case | Status |
| --- | --- |
| `9o-c1-uniqlo-manga` | NOT_RUN (awaiting approval) |
| `9o-c4-holdout-discovery` | NOT_RUN (awaiting approval) |
| `9o-c2-crocs-fine-dining` | NOT_RUN (awaiting approval) |
| `9o-c3-aesop-coffee` | NOT_RUN (awaiting approval) |

`LIVE_QLOO_VALIDATION_NOT_RUN` and `LIVE_AGENT_MODEL_VALIDATION_NOT_RUN` apply to Sprint 9O so far.

## 6. Evidence and trace inventory

The capture procedure is in place, but no live artefact exists yet.

- **Harness capture.** `frontend/e2e-hosted/acceptance.spec.ts` saves files on every browser poll:
  - each job poll to `jobs/<jobId>.json`, keeping the last state seen, even when a run never settles;
  - the agent result to `results/<jobId>.json`, which `pnpm eval:d2d -- --score` reads;
  - comparative reports to `reports/`.

  The ledger carries the pre-registered `E2E_CASE_ID`. The Next.js proxy already strips job access tokens, and the operator token is redacted.
- **Manifest.** `scripts/evidence-manifest.mjs <root> --revision <deployed sha> --ledger-before q,c --ledger-after q,c` writes `manifest.json`. For every artefact it records the case, model, engine revision, feasibility, Qloo calls, latency and checksum. It refuses to write if a file looks like it contains a credential; that refusal was tested.
- **Location.** `docs/sprint-9o/evidence/<case-id>/`.
- **Output isolation.** Hosted output now goes to `frontend/test-results-hosted/` (configurable with `E2E_OUTPUT_DIR`). The synthetic suite clears `test-results/` and broke a concurrent hosted run in Sprint 9M.

## 7. Discovery quality

NOT_RUN (Case 4).

## 8. Comparison and representation quality

NOT_RUN (Cases 1–3).

## 9. Decision usefulness

NOT_RUN. The rubric is in PREREGISTRATION §5.

## 10. Performance and cost

NOT_RUN.

## 11. Feasibility-policy findings (Phase D, offline)

**A counterexample confirmed a premature stop.**

`REFERENCE_EMPTY_PROBE_LIMIT = 4` made `referencePlan` report `NO_REFERENCE_YIELD` after four empty reference probes whenever no probed candidate was usable. Two things followed:

- feasibility became `INFEASIBLE` with `repeat: LIKELY_REPEATS`;
- the executor refused every further reference probe (`COMPARISON_INFEASIBLE`).

This happened even when unprobed candidates **observed on profiles of the comparison type** remained, and those candidates would complete a FULL comparison.

The synthetic counterexample is in `backend/tests/agent-sprint9o.test.ts`. In it, the target's three validated exemplars carry four tags that no other place carries. Those tags have the most type evidence of any candidate (3 each), yet their brand-independent pools return only the exemplars, so every probe is empty. Two genuine references, carried by two exemplars each, have members of their own. Before the fix, the test failed with `expected 'NO_REFERENCE_YIELD' to be null`.

The ranking would put the two genuine references first in this world (same tag namespace as the target), so a model that follows it avoids the problem. The defect is that the bound made the outcome **depend on the order in which the model probes**.

**Fix (smallest general change, no threshold changed):**

- An unprobed MEANINGFUL candidate with observed type evidence counts as realistically obtainable, both in the `NO_REFERENCE_YIELD` blocker and in the executor's `REFERENCE_PROBE_LIMIT` refusal.
- Candidates without type evidence are still refused past the limit. The Sprint 5A.2 / 9N live failure class, brand-profile genres probed with `place`, stays blocked.
- Turn, call and slot budgets still cap the probes.

| Required check | Result | Evidence |
| --- | --- | --- |
| 1. Avoids known-unproductive probes | PASS | 9N tests: type-less probes deferred or refused. 9O test 3: a type-less probe past the limit is refused. |
| 2. Does not block valid target representation | PASS | `referenceProbeRefusal` never applies to target tags or other types (9N test) |
| 3. Does not interfere with frontier discovery | PASS | Feasibility is null for `explore_frontier` (9N test); d2d discovery cases unchanged |
| 4. Does not treat uncollected evidence as impossible | PASS | `REFERENCE_DISCOVERY_PENDING` defers rather than bans (9N tests) |
| 5. Does not stop early when a valid reference remains obtainable | **FAIL before the fix, PASS after** | 9O test 2 |
| 6. Preserves comparisons near the turn limit | PASS | No deferral without 2 turns of slack (9N test, live L-C2) |
| 7. Preserves honest abstention | PASS | Thin panel → `NO_REFERENCE_YIELD`, `LIKELY_REPEATS` (9N test, still passing) |

**Effect on matched offline evaluations.** These are synthetic results and must not be read as live improvements.

- `eval:d2d`: identical before and after the fix. Empty probes 52 → 38, Qloo calls 411 → 400, FULL 36 → 36, 0 regressions.
- `eval:agent`: 54/54 scenarios, with identical per-skill metrics.

The bound never fired wrongly on the existing fixtures. The counterexample is new coverage.

**Rollback.** `feasibilityPolicyFromEnv({CE_FEASIBILITY_POLICY: "observe"})` returns `observe`. Under `observe` there is no probe limit and no refusal (9N tests, re-run). The production value was not changed.

**Deployment.** The fix is on this branch only. The live cases measure the deployed engine (`c39b978`). Deploying the fix needs a merge to `main`, which needs owner approval.

## 12. Bugs and fixes

| # | Defect | Evidence | Fix | Status |
| --- | --- | --- | --- | --- |
| 1 | The probe bound blocks an obtainable FULL comparison (§11) | Failing synthetic test | `reference-strategy.ts`, `feasibility.ts` | Fixed on the branch; not deployed |
| 2 | `scripts/live-test-open.sh` rewrites the run-wide ceilings to 75 Qloo / $2.00. With the durable ledger at 142, using it during the public evaluation would shut admissions for every judge. | Script read against production flags | Refuses when `CE_PUBLIC_EVALUATION=1` | Fixed on the branch |
| 3 | Hosted job results were not persisted, so the Uniqlo trace was lost in Sprint 9N | Sprint 9N report | Harness capture plus manifest (§6) | Fixed on the branch |
| 4 | The synthetic E2E clears the hosted output (Sprint 9M) | Sprint 9M note | Separate output directory | Fixed on the branch |

## 13. Desktop and mobile results

| Test | Status |
| --- | --- |
| Hosted anonymous tests: desktop 1440×900, tablet 768×1024, mobile 390×844 (home renders, nothing paid on load, malformed paid requests refused before any provider call) | PASS, 6/6 |
| Desktop live journey (Case 4) | NOT_RUN |
| Mobile 390×844 journey on recorded research | NOT_RUN |

## 14. HTML and PDF parity

| Check | Status |
| --- | --- |
| Offline: the report prints the same `decisionCard` as the live reading (`network-report.test.ts`) | PASS |
| Published recorded example `/examples/patagonia-2026-10-29.html`: fetched and read | Shows evidence, uncertainty ("not settled") and next steps. It **predates the 9N decision card** (no finding, why or implication sections), so it cannot test card parity. |
| Live export content parity | NOT_RUN (Case 4) |

## 15. Security and reliability checks

| Check | Status |
| --- | --- |
| `pnpm check:secrets` | PASS |
| Anonymous access and refusal of malformed paid requests | PASS |
| No provider call from read-only probes (ledger unchanged) | PASS |
| Live global caps, admission failure, idempotency | NOT_RUN live. Covered by existing offline tests only. |

## 16. CI results (local, branch)

| Check | Status |
| --- | --- |
| lint, typecheck | PASS |
| `pnpm test` (backend: 936 tests in 82 files; frontend unit) | PASS |
| `eval:methodology`, `eval:live`, `eval:elasticity`, `eval:agent`, `eval:d2d`, `eval:query` | PASS |
| build, `check:deployment-config`, `check:secrets`, `smoke:offline` | PASS |
| `test:e2e` | PASS, 58/58, run with `E2E_MODE=production`. The dev mode was blocked by the owner's running `next dev`; that server was left untouched. |
| `smoke:docker` | NOT_RUN locally (no Docker daemon). CI runs it. |
| `eval:d2d` | Now its own CI step (`.github/workflows/ci.yml`). It makes no provider call. |
| GitHub Actions on this branch | Pending the push |

## 17. Deployment and rollback state

Production is unchanged at `c39b978`. No variable write, merge or redeploy happened in Sprint 9O.

## 18. Devpost and video

- `DEVPOST.md` was updated for discovery-first positioning, the decision card and measurement-first feasibility. No new performance claim was added.
- `VIDEO_PLAN.md` was rebuilt on the brief's seven beats. Its footage comes from the acceptance run (`E2E_VIDEO=1`), so no credits are spent only for filming.
- **The submission is not confirmed. The video is not recorded.**

## 19. Agent readiness

`AGENT_MODEL_NOT_READY` is unchanged. The canonical live gate (`eval:agent:live`: 7 cases, case-matched baseline, frontier stability, about $28 reserved) is outside the proposed budget and was not run.

## 20. Release recommendation

Provisional, pending the live phases:

- Keep production on `c39b978`.
- Merge this branch after review. It carries one targeted policy fix with a failing-then-passing regression test, evidence capture and a release-script safety guard.
- Keep `CE_FEASIBILITY_POLICY=enforce`.

The sprint state cannot be decided before the live phases run or are formally declined.
