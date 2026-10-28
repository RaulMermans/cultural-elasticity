# Sprint 9J: Live validation and release report

**Date:** 2026-10-27
**Branch:** `sprint/9j-live-validation-production-readiness`
**Start:** `origin/main` at `0b0f8cdc22d67c81c7cd68c46888eae49692d107` (Sprint 9I merged)
**Final SHA:** see §10.

**Decision: NO-GO for production readiness.** The integration, access-control and verification defects were fixed and verified. However, the genuine Qloo + Haiku journey (G7–G11) did **not** run. The session's permission policy refused the secret-store writes that the hosted run requires. That stop came before any paid dispatch.

| Evidence class | Result |
| --- | --- |
| Offline tests and evals | pass (§6) |
| Synthetic browser tests (`pnpm test:e2e`) | see §6 |
| Hosted real-browser, recorded evidence | **`HOSTED_RECORDED_PLAYWRIGHT_PASS`**, 15/15 |
| Genuine local live-provider E2E | **`LOCAL_LIVE_PROVIDER_E2E_NOT_RUN`** (the owner chose a hosted run) |
| Genuine hosted live-provider E2E | **`HOSTED_LIVE_PROVIDER_E2E_NOT_RUN`** |
| `LIVE_QLOO_VALIDATION` / `LIVE_AGENT_MODEL_VALIDATION` | **NOT_RUN**. Provider calls made: 0. Spend: $0. |

## 1. Production baseline (verified at the start)

| Condition | Verified state |
| --- | --- |
| Vercel production | READY, `0b0f8cd` from `main`, Git-connected, root `frontend`, `sourceFilesOutsideRootDirectory=true`, Ignored Build Step unset, Node 22.x |
| Vercel protection | `ssoProtection: null`: public, per the owner's temporary authorization |
| Vercel `/` | 200; recorded Loewe and the Jacquemus Atlas render |
| Vercel `/api/agent/admissions` | `{"status":"unavailable"}`: **failed** |
| Vercel `/api/brands/status` | 503 `baseline_unavailable`: **failed** |
| Vercel Production environment names | **none**. `BACKEND_URL` and `CE_INTERNAL_API_SECRET` existed only for **Preview**. Readable through the CLI; the earlier 403 was a connector limitation. |
| Railway | deployment `SUCCESS` at `0b0f8cd`, source `RaulMermans/cultural-elasticity@main`, not pinned, 1 replica (`us-east4-eqdc4a`) |
| Railway `/health` · `/ready` | 200 · 503 `ADMISSIONS_PAUSED` |
| Railway admission flags | `CE_ACCEPT_INVESTIGATIONS=0`, `CE_BASELINE_ENABLED=0`, `CE_BASELINE_LIVE_ENABLED=0`, `CE_BASELINE_TOTAL_QLOO_CALLS=0`, `CE_PUBLIC_DEPLOYMENT=1`, `QLOO_API_BASE_URL=https://hackathon.api.qloo.com` |
| Railway baseline DB | migrations 1/1 (matches the code), 0 scans, 0 baseline Qloo calls |
| GitHub Actions | every run fails in about 3 s: "job was not started because recent account payments have failed or your spending limit needs to be increased". **`CI_NOT_RUN`**. Billing was not changed. |

## 2. Vercel → Railway integration: `VERCEL_RAILWAY_CONNECTED`

**Root cause.** `backendBaseUrl()` returns `null` in production when `BACKEND_URL` is absent, so every proxy reported "unavailable". Both settings had been created for Preview only.

**Repair** (configuration only; no secret was printed, logged or committed):

1. Added `BACKEND_URL` (the Railway origin) to Production.
2. Added `CE_INTERNAL_API_SECRET` to Production as a **sensitive** variable. The value was read from Railway into a mode-600 temporary file, redirected into `vercel env add`, then deleted.
3. Redeployed the same reviewed revision to production (`vercel redeploy`, deployment `cultural-elasticity-p4mhyewpv`, aliased to `cultural-elasticity-raulmermans-projects.vercel.app`).

**Verified:**

| Check | Result |
| --- | --- |
| `/api/agent/admissions` | `{"status":"paused"}` (the real Railway state) |
| `/api/brands/status` | 200 `{"enabled":false,…}` |
| Internal auth from the frontend server | works: a proxied `POST /api/brands/resolve` reaches the admission check (`503 baseline_paused`, not 401) |
| Railway direct, with no or a wrong secret | 401 |
| Internal headers or secret in browser responses | none (curl, and Playwright with the real secret checked for absence) |

Railway's internal-auth validation was not weakened. No paid admission was enabled.

**Also found.** The Preview `CE_INTERNAL_API_SECRET` held an **empty value**, so preview deployments could never authenticate. During the hosted-run preparation it was removed; re-adding it was refused by the session's permission policy. Previews are therefore still unable to reach Railway, exactly as before. Owner action is in §9.

## 3. Safe public testing mode

Implemented an independent, scoped, expiring **operator authorization** for every paid dispatch, enforced on Railway. Added a **run-wide Qloo dispatch ceiling**. Full detail is in [SPEND_AND_ACCESS_SAFETY.md](SPEND_AND_ACCESS_SAFETY.md).

On the current production (`main`), paid starts are still gated only by admission flags, which are off. The operator gate takes effect when 9J is merged and deployed.

## 4. Verification defects fixed

**A. `eval:live` 19/21 → 27/27.**

- The two `loewe-baseline-canary-*.live.json` files are a valid, different artifact (`live_qloo_canary_record`: normalized baseline observations exported from the 9B canary database). The live harness assumed every `*.live.json` was an investigation `EvidencePacket`.
- The harness now dispatches on `fixtureType`. Canary records get their own checks:
  - LIVE notice, scan id, brand and `mcp-` describe correlation id, versioned observation schemas;
  - sanitized;
  - correlation ids on every 0.2 signal (0.1 records never stored them; this is reported, not repaired);
  - offline replay marked `derivedFrom` with the as-run result unchanged.
- **No fixture was edited.** Any unknown `fixtureType` still fails. Tests: `backend/tests/sprint-9j-live-eval.test.ts`.

**B. Benchmark reproducibility.**

- `qloo-value-benchmark.test.ts` read 7 live Haiku results from gitignored `backend/feasibility-output/`.
- They were scanned (no credentials, headers, personal fields or local paths) and copied **byte-for-byte** to the tracked `evals/qloo-value/artifacts/`.
- `cases.json` points there and keeps each original path as `conditionB.capturedAs`.
- **The sha256 pins are the originals and verify unchanged.**
- Verified twice:
  - with `feasibility-output` moved aside;
  - in a **fresh clone** of the pushed branch: backend 891/891, `eval:live` 27/27 + 3/3, frontend 79/79.

**C. PR #33 opt-in admission.** The 9I test-only repair still holds (#33's fail-closed tests pass). Two more public-runtime tests now present the 9J operator credential explicitly; production behaviour stays fail-closed.

## 5. Comparison integrity (§11)

| Known 9I limitation | 9J change |
| --- | --- |
| A reference-concept drift was only a limitation | A **ranked** reference whose Qloo concept differs from, or can no longer be verified against, the authorized one now blocks the result (`INTEGRITY_FAILED`): no position or class is shown. A drifted reference left out of the panel stays a non-blocking limitation. |
| Nothing checked that the panel was the authorized set | New blocking check `COMPARISON_SET_AUTHORIZED`: a panel that ranks any territory outside {target, authorized references} withholds every position. |
| Re-resolution by label | Unchanged. Drift is now caught by the checks above rather than pinned upstream. |
| Process-local plans, jobs and idempotency | Unchanged and documented. Single process, no automatic replay. No durable-workflow framework, since no live run demonstrated a need. |
| Report lost after navigation | Unchanged (UI state). |

One 9H test authorized no references but ranked two. Its plan now lists the references it ranks; the new check was not relaxed. Tests are the "9J comparison identity" cases in `comparative-elasticity.test.ts`.

## 6. Tests executed (local; Node 22.23.2)

| Command | Result | Kind |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | pass | |
| `pnpm lint` · `typecheck` · `build` | pass | |
| `pnpm test` | backend **891/891** (74 files), frontend **79/79** | offline, synthetic |
| `pnpm check:secrets` | pass: 694 repo files, 19 bundle files | |
| `pnpm check:deployment-config` | `OFFLINE_DEPLOYMENT_CONFIG_PASS`; remote state not verified by this command | offline |
| `pnpm eval:methodology` | 19/19 | SYNTHETIC |
| `pnpm eval:live` | 27/27 + 3/3 | recorded live fixtures, offline |
| `pnpm eval:elasticity` | 27/27 | offline |
| `pnpm eval:agent` | PASS | SYNTHETIC world |
| `pnpm eval:query` | PASS; ADVERSARIAL X06 9/10 (pre-existing, identical on `main` per 9I) | offline replay, not NLU evidence |
| `pnpm smoke:offline` | `OFFLINE_SMOKE_PASS` | |
| `pnpm test:e2e` (production mode) | **54/54 after fixes**: research and comparative specs 29/29; Living Atlas 22/25 in a full run, plus the 3 remaining tests 3/3 on rerun. Those 3 were timeouts at load average ~33 that pass in isolation. Two 9J regressions were found and fixed first (see the audit). | SYNTHETIC job API |
| `pnpm smoke:docker` | **NOT_RUN**: Docker daemon not running | |
| `pnpm smoke:remote` | **NOT_RUN** (superseded by the hosted Playwright audit plus direct probes, in the paused state) | |
| Hosted Playwright, recorded | **15/15** | real browser, recorded evidence |
| `pnpm eval:agent:budget -- --approved-usd 2` | refuses (`CEILING_BELOW_RESERVED_EXPOSURE`) | see note |

**Budget preflight.** This script models the frozen 7-case live readiness gate ($28.08 reserved exposure), not the 4-job journey. Its refusal is correct for that workload and is not a pass or fail of the journey.

The journey's own envelope:

- **Model:** 4 jobs × $0.50 public reserve = $2.00 ≤ the approved $2.00.
- **Qloo:** 7 + 12 + 12 + 12 + 32 = 75, enforced by the new process ceiling.

**CI:** `CI_NOT_RUN` (billing). No green CI is claimed.

## 7. Live execution

| Item | Value |
| --- | --- |
| Authorization | The owner authorized the bounded run (Loewe; Boutique hospitality; 75 Qloo calls; $2.00 Haiku), chose a hosted run, and left the references and deploy method to engineering. |
| References | **Luxury hotels** and **Fine dining**: place-typed concepts best supported by the recorded live Loewe place recommendations (5 of 10 luxury hotels, 3 restaurants). |
| Provider-side cap | Not verified. The owner waived it explicitly; in-app guards only. |
| Deploy plan | Temporary branch deploy. Production Vercel and `main` untouched; Railway returned to `main` afterwards. |
| Preconditions met | DB migrations 1/1, 0 prior usage; hackathon origin configured; one replica; operator gate and Qloo ceiling tested; the live spec ready; branch pushed. |
| **Stopped at** | Giving the branch preview its internal secret. The session's permission policy denied the secret-store write, and the Railway variable changes would need the same kind of write. |
| Provider calls | 0. Spend $0. No job created. |
| G7–G11 | **NOT RUN.** Not a capability failure; the run did not start. |

## 8. Acceptance gates

| Gate | Result |
| --- | --- |
| G1 Vercel ↔ Railway connected | **PASS** |
| G2 Public routes cannot start paid jobs | **PASS** on production (admission off, probes refused). The independent operator gate is implemented and tested; it is deployed only after merge. |
| G3 Recorded Loewe in real Playwright | **PASS**, 3 viewports |
| G4 Living Atlas browser checks | **PASS**, 3 viewports |
| G5 Clean clone and evaluator defects | **PASS** |
| G6 Provider host and spend controls verified | **PARTIAL**: host lock and in-app controls verified; provider cap unverified (owner waived) |
| G7 Live Loewe baseline | **NOT RUN** |
| G8 Haiku + Qloo single direction | **NOT RUN** |
| G9 Two reference investigations | **NOT RUN** |
| G10 Live comparison | **NOT RUN** |
| G11 Report and export of a live result | **NOT RUN**. Recorded export verified (G3). |
| G12 Usage within ceilings | **PASS** (0 calls, $0) |
| G13 Paid admission off, environment reconciled | **PASS**: never opened |
| G14 Hosted production safe for recorded-demo users | **PASS** |

## 9. Owner actions needed to complete G7–G11

Either grant this session permission for these secret-store writes, or make them in the dashboards. Then rerun `hosted-live.spec.ts`.

1. **Vercel → Settings → Environment Variables:** add `CE_INTERNAL_API_SECRET` for **Preview**, with the same value as Railway's (sensitive).
2. **Railway → `cultural-elasticity-api` → Variables**, for the run only:

   | Variable | Value |
   | --- | --- |
   | `CE_PAID_OPERATOR_TOKEN` | new random value, ≥ 32 chars, distinct from the other secrets |
   | `CE_PAID_OPERATOR_EXPIRES_AT` | now + 3 h |
   | `CE_PROCESS_QLOO_CALL_LIMIT` | 75 |
   | `CE_SPEND_BUDGET_USD` | 2.00 |
   | `CE_INVESTIGATION_RESERVE_USD` | 0.5 |
   | `CE_BASELINE_ENABLED` / `CE_BASELINE_LIVE_ENABLED` | 1 / 1 |
   | `CE_BASELINE_TOTAL_QLOO_CALLS` | 7 |
   | `CE_ACCEPT_INVESTIGATIONS` | 1 |

   Deploy the reviewed branch SHA with `railway up` (or merge 9J first).
3. **Afterwards:**
   - set all admission flags to 0 and delete `CE_PAID_OPERATOR_TOKEN`;
   - redeploy Railway from `main`;
   - confirm `/ready` returns `ADMISSIONS_PAUSED` and `/ops/status` shows 0 jobs.

Alternatively, `LOCAL_LIVE_PROVIDER_E2E` needs only local environment variables (no secret-store write), if the owner prefers it.

## 10. Commits

| Commit | Content |
| --- | --- |
| `62fbc48` | Operator-gated paid dispatch, run-wide Qloo ceiling, comparison identity checks, `eval:live` canary class, tracked benchmark artifacts, hosted Playwright specs |
| `23694a7` | The synthetic backend declares `paidOperatorRequired: false` |
| final | Docs, evidence and runbook (this commit) |

Nothing was merged to `main`. The branch is pushed. Railway and Vercel production still run `0b0f8cd`.

## 11. Remaining risks

- No authentic live comparative result exists yet, for any brand.
- The model spend ledger, the Qloo dispatch counter, jobs and idempotency are process-local. A restart resets the limits. Do not open public paid research until accounting is durable and a provider-side hard cap is confirmed.
- The public site is unauthenticated by the owner's choice. That is safe only while admission flags stay at 0 (on `main`), or behind the 9J operator gate (after merge).
- CI does not run (billing). Merges rely on local evidence.
- Vercel previews cannot authenticate to Railway (empty, now absent, Preview secret).
