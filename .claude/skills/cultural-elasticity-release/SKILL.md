---
name: cultural-elasticity-release
description: Release, deploy and verify Cultural Elasticity production (Vercel frontend + Railway backend + PostgreSQL), repair Vercel/Railway drift, open or close a bounded live operator test, and decide RELEASE_VERIFIED / RELEASE_DEGRADED / RELEASE_FAILED. Use whenever asked to deploy, release, ship, verify production, check Railway or Vercel, fix environment variables, run a live Qloo/Haiku test on the deployment, or validate that the hosted product works.
---

# Cultural Elasticity release

Production is a Vercel frontend (`frontend/`) calling a Railway backend (`backend/Dockerfile`) with PostgreSQL. Both
auto-deploy GitHub `main`. Read `AGENTS.md` (Deployment provenance) and `docs/operations/DEPLOYMENT_RELEASE_CONTRACT.md`
first; this skill is the procedure, the contract is the policy. A green deployment is not a working product.

Work in the canonical clone (`~/dev/cultural-elasticity`), on Node 22 (`source ~/.nvm/nvm.sh && nvm use 22`).

## Hard rules

- Never print, log, commit or paste a secret value. Inspect variables by **name**; reduce values to booleans or
  lengths in-process (`scripts/release/verify-production.mjs` does this and scans its own report for leaks).
- Ask the owner before: any production variable write, merge to `main`, redeploy, opening admissions, any paid
  provider call, database migration, Vercel protection change. Read-only diagnostics need no approval.
- Never set `NODE_ENV=development`, `CE_PUBLIC_DEPLOYMENT=0` or remove the operator gate to make production behave
  like localhost. Never reset `baseline_budget_accounts` or mint a new credential to escape an exhausted limit.
- Never retry a paid start whose outcome is uncertain. Never call fixture or recorded results live.
- No duplicate Railway services, no history rewrites, no `railway up` of local files for a `main` release.

## A. Pre-deployment (offline, no providers)

```sh
git fetch origin && git status --short --untracked-files=no   # must be empty
node scripts/release/preflight.mjs            # on main HEAD: full gate, records .release/preflight-<sha>.json
node scripts/release/preflight.mjs --allow-branch --quick   # on a PR branch, before merge
```

Preflight refuses the wrong repository, a checkout that is not `origin/main` (unless `--allow-branch`) and tracked
changes; it prints the touched areas (frontend / backend / shared), flags migrations for separate approval, and runs
`check:deployment-config`, `check:secrets`, lint, typecheck, tests, build, offline evals and synthetic browser tests.

GitHub Actions has been billing-blocked (jobs "not started"). That is `CI_NOT_RUN`, never a pass. The recorded local
preflight for the same SHA is the accepted equivalent; still say `CI_NOT_RUN` in the report.

## B + C. Environment and deployment verification (read-only)

```sh
node scripts/release/verify-production.mjs --public-mode --expect-admissions closed --out .release/verify-<sha>.json
```

- `--public-mode` only while the owner keeps Vercel Authentication off (current choice). Without it, an anonymously
  reachable app is `VERCEL_PROTECTION_GATE_FAILED`.
- `--expect-admissions open` only during an approved operator window.
- Exit 0 `RELEASE_VERIFIED`, 3 `RELEASE_DEGRADED`, 1 `RELEASE_FAILED`. Each code prints its recovery.

It gathers fresh metadata (Vercel REST via the CLI login, Railway CLI/GraphQL, `gh` for CI), the running revision
from `/ops/status`, the cumulative baseline budget from `/ops/baselines`, and HTTP evidence: `/health`, `/ready`,
home, `/api/agent/admissions`, `/api/brands/status` and one **anonymous** `POST /api/brands/resolve`, which Railway
refuses (503 paused / 403 operator_required) before any Qloo call. Its rules live in `scripts/release/classify.mjs`
with regression tests in `classify.test.mjs`.

Interpretation that has gone wrong before:
- `/ready` 503 with only `ADMISSIONS_PAUSED` is the intended closed state, not an outage. Any other reason fails.
- Railway `SKIPPED` ("no changes detected in watch paths") is fine **only** if nothing between the serving SHA and
  the release matches `railway.json` watch patterns (`RAILWAY_FRONTEND_ONLY_SKEW_ACCEPTED`). Otherwise
  `RAILWAY_STALE_FOR_BACKEND_CHANGE`.
- Vercel variables must exist for the **Production** target. Preview-only variables broke production in Sprint 9J.
- Railway `SUCCESS` with a dead API, or a frontend showing "unavailable", is still `RELEASE_FAILED`.

## D. Recovery (least disruptive first)

| Symptom | Category | Recovery |
| --- | --- | --- |
| Build log `failed to fetch snapshot` | Railway transient | `railway redeploy --yes` (same commit). No code change. |
| `SKIPPED` / no changes in watch paths | Expected for frontend-only | Confirm with the verifier. If backend files changed, trigger a build of the `main` commit from the Railway dashboard or an empty backend-touching commit via PR. |
| BUILDING / DEPLOYING / INITIALIZING | In progress | Wait; rerun the verifier. |
| FAILED (real build error) | Code | `railway logs --build <id>`; fix on a branch → PR. The previous SUCCESS keeps serving. |
| Vercel CANCELED production build | Ignored Build Step | Clear `commandForIgnoringBuildStep`; never "fix" Next.js for it. |
| Wrong branch / pinned SHA | Source drift | Railway source back to `main`, no pin; Vercel `productionBranch=main`. |
| Missing Production variable | Env drift | Add for the right target (value piped from the other provider through a mode-600 file, never echoed), then redeploy that side. |
| `OPERATOR_AUTHORIZATION_EXPIRED` / token left configured | Window over | `scripts/live-test-close.sh`. A new window needs new approval. |
| `/ready` `MISSING_*_CREDENTIAL`, provider 401/403 | Provider auth | Owner rotates the key; never paste it into the session. |
| `BASELINE_QUOTA_AT_OR_BELOW_USAGE` | Budget | Limit = used (from `/ops/baselines`) + approved allocation. Never reset counters. |
| `BASELINE_DATABASE_UNAVAILABLE` at boot, migration error | PostgreSQL | Stop. No auto-migrate or reset; restore per `docs/sprint-9b`. |
| Frontend/backend contract mismatch | Skew | Both must serve compatible SHAs; redeploy the stale side from `main`. |

Operations are not interchangeable: **restart** reuses the container (no new env); **redeploy** (`railway redeploy`)
re-runs the latest deployment with current variables; a **new build** of a commit comes from GitHub `main`;
`railway up` uploads local files and is not a `main` release.

## E. Production acceptance (the product must be usable)

```sh
cd frontend && E2E_HOSTED_URL=https://cultural-elasticity-raulmermans-projects.vercel.app \
  pnpm exec playwright test -c playwright.hosted.config.ts acceptance
```

Without authorization this runs only the anonymous tests: home renders, **Find brand** is disabled for a visitor
without the operator credential, nothing paid is sent, anonymous paid routes are refused. The LIVE journey
(brand → Qloo resolution → baseline → network → Haiku investigation → HTML/PDF → save → reopen) runs only with
owner approval inside an open window:

```sh
scripts/live-test-open.sh ~/.ce-operator-token --no-open      # approved: 75 Qloo, $2.00 Haiku, 3 h, one replica
E2E_LIVE_AUTHORIZED=1 E2E_OPERATOR_TOKEN="$(cat ~/.ce-operator-token)" E2E_BRAND=Zara E2E_HOSTED_URL=… \
  pnpm exec playwright test -c playwright.hosted.config.ts acceptance --project desktop-1440x900
```

Report live and mocked results separately. A run that stopped on budget, identity drift or a provider failure is a
genuine partial result: record it, do not rerun it to get a better one.

## E2. Public evaluation (Sprint 9M, judging period)

Anonymous visitors may run paid research only inside an owner-approved public evaluation, with a fixed total and an expiry. Open, verify and close it like this:

```sh
CE_APPROVED_QLOO_CALLS=1000 CE_APPROVED_USD=5.00 scripts/public-evaluation-open.sh
node scripts/release/verify-production.mjs --public-mode --expect-admissions public --max-qloo 1000 --max-usd 5.00
scripts/public-evaluation-close.sh        # kill switch
```

- While it is open, **never** run the verifier with `--expect-admissions closed` or `open`: their anonymous probe is well formed and would be admitted.
- The anonymous-judge hosted journey is `E2E_PUBLIC_EVALUATION=1 E2E_LIVE_AUTHORIZED=1 …`. It spends from the shared allowance and this machine's network quota.
- `E2E_SKIP_DIRECTION=1` asks only the composer question.
- Do not run synthetic `pnpm test:e2e` at the same time: it clears the shared `frontend/test-results/`, and a running hosted test then fails when it saves its trace.

## F. Post-test safety

1. Record `/ops/status` (`spend`, `qlooDispatch`, `runLedger`, `jobs`) and `/ops/baselines`.
2. Confirm no job is running or queued; never cancel someone else's work silently.
3. `scripts/live-test-close.sh` (admissions 0, operator token and expiry removed, redeploy).
4. `node scripts/release/verify-production.mjs --public-mode --expect-admissions closed` → no
   `OPERATOR_TOKEN_LEFT_CONFIGURED`, `/ready` only `ADMISSIONS_PAUSED`, anonymous resolve 503.
5. The durable run ledger rows stay in PostgreSQL (keyed by the old token's hash); never delete them.
6. Keep evidence (ids, statuses, costs; never tokens) and state exactly what was not verified.
