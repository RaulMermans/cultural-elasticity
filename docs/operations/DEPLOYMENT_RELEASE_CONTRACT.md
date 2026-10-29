# Cultural Elasticity — Vercel & Railway release contract

**Canonical and permanent.** Read with `AGENTS.md`. Supersedes the dated deployment procedures in `docs/sprint-8f*` when they conflict with the currently intended `main` release workflow. Date recorded: 2026-10-27.

## Why this exists

Two real deployment regressions occurred:

1. **Vercel production Git deployments were repeatedly CANCELED** because a dashboard-level Ignored Build Step was configured to build only previews. The corresponding preview builds were READY; Next.js itself was not broken. The obsolete Ignore rule was removed and a protected production deployment from `main` reached READY on October 27.
2. **Railway stayed on the Sprint 9B branch and a pinned Sprint 9B commit** while GitHub `main` had advanced through Sprint 9H. Railway's source was switched to canonical `main`, the pin was removed, and a new deployment succeeded on October 27.

Neither an isolated successful provider build nor a healthy old backend proves the integrated product is ready for judging.

## Source of truth

| Surface | Expected contract |
| --- | --- |
| Git repository | `RaulMermans/cultural-elasticity` |
| Release branch | `main` |
| Frontend project | Vercel `cultural-elasticity` (`prj_AHQcMcLFwGUOpRmepvwcc89LyOYo`) |
| Framework/build | Next.js, Node 22, root `frontend`, `sourceFilesOutsideRootDirectory=true` |
| Vercel Ignored Build Step | **Unconfigured**: no rule that silently cancels `main` |
| Vercel access | `ssoProtection.deploymentType=all`, except while the owner's **public recorded-demo mode** is authorized (Sprint 9J: off since 2026-10-27, with paid admission off) |
| Frontend server env (production **and** preview) | `BACKEND_URL` and `CE_INTERNAL_API_SECRET` exist **for the Production target** (Sprint 9J found them Preview-only, which made production show "unavailable"); values must never be logged. `vercel env ls` lists names per target. |
| Backend project/service | Railway `cultural-elasticity` / `cultural-elasticity-api` |
| Backend source | Same canonical Git repository, `main`, **no pinned old SHA** |
| Backend build | `backend/Dockerfile` from monorepo root; shared workspace included |
| Health | `/health` and actual runtime readiness |
| Replicas | **One**: jobs and the in-process spend view are process-local (the operator-run ledger is durable, below) |
| Database | Existing PostgreSQL and volume; never recreate or migrate implicitly |
| Research spending | `CE_ACCEPT_INVESTIGATIONS=0` and baseline admission off by default, until independently approved |
| Paid operator gate (Sprint 9J) | Every paid start on a public runtime needs `CE_PAID_OPERATOR_TOKEN` (≥ 32 chars, distinct from other secrets) plus an unexpired `CE_PAID_OPERATOR_EXPIRES_AT`; absent on production except during an approved run |
| Run-wide ceilings (Sprint 9J) | `CE_PROCESS_QLOO_CALL_LIMIT` = the approved Qloo total. Qloo dispatches and model reservations are also taken durably in `baseline_budget_accounts`, keyed by the operator-token hash, so a restart never grants the same credential a fresh allowance. Model reservations are not returned: $2.00 at a $0.50 reserve allows at most 4 job starts per credential |

## Verification levels

**Offline, every release candidate**: `pnpm check:deployment-config` and repository lint, tests, typecheck, build, secrets scan, relevant evals. The command checks repository files and runs deliberately negative tests, without cloud access or paid provider calls. This is **not** a substitute for checking actual Vercel/Railway settings.

**Remote configuration, before any release claim**: inspect provider dashboards/API for the settings above. On Vercel, confirm the real Ignored Build Step field is cleared; GitHub-only tests cannot see this dashboard property. Confirm protected `READY` **production** deployment (not merely a `READY` preview). On Railway confirm `SUCCESS`, actual deployed Git SHA/branch, one replica, source not pinned, configured limits and paused admission. Confirm `main` and running frontend/backend code are compatible.

**Hosted integration, before publicizing**: exercise the protected frontend → Railway `/health` / admissions paths, baseline and recorded demo, a real source-grounded research result where authorized, source/provenance rendering and export. Use the existing remote smoke and Vercel protection probe, and explicitly note when paid live testing was not authorized. A 401 protected page is not a failure; an anonymously accessible supposedly protected page **is** a security failure.

## Automated release verification (Sprint 9L, every release)

Procedure: the `/cultural-elasticity-release` skill (`.claude/skills/cultural-elasticity-release/SKILL.md`).

1. `node scripts/release/preflight.mjs` on the release SHA (on `main`): repository identity, clean tree, touched areas, migrations flagged for approval, and the full offline gate. It records `.release/preflight-<sha>.json`, the accepted local equivalent while GitHub Actions jobs cannot start (`CI_NOT_RUN`).
2. After both providers deploy: `node scripts/release/verify-production.mjs --public-mode --expect-admissions closed` (drop `--public-mode` if Vercel Authentication is back on; use `--expect-admissions open` only inside an approved window). It reads fresh Vercel and Railway metadata, the running revision, the cumulative baseline budget and the hosted endpoints, never prints a secret value, starts no paid work, and exits with `RELEASE_VERIFIED` (0), `RELEASE_DEGRADED` (3) or `RELEASE_FAILED` (1).
3. `E2E_HOSTED_URL=<production> pnpm --filter frontend exec playwright test -c playwright.hosted.config.ts acceptance`: the anonymous browser checks always run; the live journey only with owner approval.

The verdict rules (`scripts/release/classify.mjs`) are regression-tested in `scripts/release/classify.test.mjs`, which runs inside `pnpm check:deployment-config`. A frontend-only skew is accepted only when no file between Railway's serving SHA and the release matches `railway.json` watch patterns; paused admissions are never an infrastructure failure.

## Optional machine-checkable remote preflight

`node scripts/check-deployment-contract.mjs --snapshot /path/to/redacted-provider-snapshot.json`

The snapshot must come from **fresh actual provider metadata**, not guesses or documents describing a previous deployment. No API keys, secrets, auth headers, private URLs with tokens, raw environment-variable values, or customer data. The script does no network calls, prints only violation codes, and refuses absent verification data.

Expected structure (substitute the actual reviewed full Git SHA):

```json
{
  "releaseSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "publicReleaseApproved": false,
  "paidAdmissionsEnabled": false,
  "vercel": {
    "project": {
      "commandForIgnoringBuildStep": null,
      "rootDirectory": "frontend",
      "sourceFilesOutsideRootDirectory": true,
      "ssoProtection": { "deploymentType": "all" },
      "productionEnvNames": ["BACKEND_URL", "CE_INTERNAL_API_SECRET"]
    },
    "deployment": {
      "status": "READY",
      "target": "production",
      "gitSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  },
  "railway": {
    "service": {
      "source": { "repo": "RaulMermans/cultural-elasticity", "branch": "main", "commitSha": null },
      "numReplicas": 1
    },
    "deployment": { "status": "SUCCESS", "gitSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
  }
}
```

The script intentionally requires matching release SHAs. Railway watch paths can legitimately skip backend builds for frontend-only changes. In that case, compare the actual Git diffs since the last deployed Railway SHA and document that compatibility manually; **do not forge a matching SHA or mark the machine check PASS**. Escalate or rebuild reviewed code if that compatibility cannot be established.

A public-launch approval is a distinct change to the security contract: review access control before setting `publicReleaseApproved`. This flag in a snapshot is **documentation, not authorization** and cannot itself change any platform setting.

## Release sequence

1. Identify reviewed `main` SHA, repo/branch, and source changes; confirm `sprint/*` development is isolated.
2. Run offline gates; when GitHub Actions jobs cannot start due to billing, report **CI_NOT_RUN** and run the equivalent tests locally. Do not mistake a failed-to-start workflow for passing CI.
3. Inspect environment variables by **names only**. Missing access is `NOT_VERIFIED`, not evidence that values are correct or incorrect.
4. Verify Vercel build configuration (Ignored Build Step, monorepo root, protection) and Railway source/replicas.
5. Confirm backend database migration compatibility and limits. No schema changes without a backup/rollback plan and separate approval.
6. Build, inspect exact SHA/target, test protected frontend + backend together. If deployment is CANCELED, check the ignored-build policy before editing application code.
7. Complete the remote snapshot preflight; record the result and any manually reviewed frontend-only deployment skew.
8. Obtain explicit authorization before public exposure, paid provider admissions, payment/budget changes, database migration, or publication of private source. A release is not ready because deployment status alone is green.

## What not to do

- Do not restore `Only build pre-production` and assume canceled `main` builds are Next.js failures.
- Do not leave Railway tied to `sprint/*` or an old pinned SHA after declaring a `main` release.
- Do not automatically remove Vercel Authentication for troubleshooting.
- Do not print Vercel/Railway environment values to logs or code-agent context.
- Do not allow backend auto-deploy from `main` to substitute for release validation. Until GitHub CI billing is repaired, the owner/operator must use verified local test evidence before merge.
- Do not equate the PostgreSQL baseline persistence with durable agent jobs. The running JobManager and spend ledger remain process-local.
- Do not silently retry an uncertain paid request after restart.

## Rollback

Vercel: use a previously verified `READY` deployment only if rollback is necessary and explicitly authorized; preserve auth protection and check the resulting alias/target. Railway: use a verified prior SUCCESS deployment on the same service, retaining the existing database, region and one-replica policy. Record deployed SHA and reconcile the source configuration afterward. Neither rollback can restore in-memory agent jobs.

**Known limits at creation:** Vercel's current latest production deployment was READY and All Deployments protection remained enabled; Railway's latest `main` deployment was SUCCESS. The production Vercel environment-variable metadata endpoint returned 403, so complete hosted integration and remote release preflight are still **NOT_VERIFIED**. GitHub Actions jobs remained billing-blocked.

## Public recorded-demo mode versus a paid launch (Sprint 9J)

**Public recorded-demo mode.** The owner temporarily authorized it. Vercel Authentication is off, and every admission flag is 0.

- Anyone can browse the recorded Loewe research and the Jacquemus Atlas, inspect evidence and export recorded briefs.
- Every paid route answers 503 (paused) or 404.
- The Vercel protection probe will report the app as anonymously reachable. That is expected in this mode, and a failure in any other.

**Approved operator run.** This is not a public launch.

1. Merge or deploy code that contains the 9J operator gate. Never open admission on a build without it.
2. Set `CE_PAID_OPERATOR_TOKEN` with an expiry of at most a few hours, the approved `CE_SPEND_BUDGET_USD`, `CE_INVESTIGATION_RESERVE_USD` (public floor $0.50), `CE_PROCESS_QLOO_CALL_LIMIT` and baseline limits. Then open admission.
3. The operator stores the credential through `POST /api/operator/session`, which sets an HttpOnly cookie. Anonymous visitors keep seeing *paused*, and Railway answers 403 to any paid start without the credential.
4. Afterwards:
   - set every admission flag to 0;
   - delete the operator token;
   - redeploy from `main`;
   - confirm `/ready` returns `ADMISSIONS_PAUSED` and `/ops/status` shows 0 jobs and 0 reserved;
   - record `/ops/status` `spend`, `qlooDispatch` and `runLedger` before closing: the in-process view resets on restart, while the durable `runLedger` rows remain.

**Public paid launch.** This remains **not approved**. It additionally needs:

- durable admission and spend accounting per user (the operator-run ledger is durable per credential, but jobs are in memory);
- a verified provider-side hard cap;
- per-user authorization;
- a separate security review.

## Public evaluation (Sprint 9M)

The Devpost rules require the project to be "available free of charge and without any restriction" for judges until judging ends (2026-11-05, 23:45 ET). A **public evaluation** admits anonymous visitors to paid research without the operator credential, under durable caps. It needs a separate owner approval of the total exposure. The approval of 2026-10-29 covers:

- 1,000 Qloo calls (400 for the baseline);
- $5.00 of model spend;
- per visitor network: 10 searches, 4 scans and 4 investigations;
- expiry 2026-11-06T05:00:00Z.

- **Open:** `CE_APPROVED_QLOO_CALLS=<n> CE_APPROVED_USD=<usd> scripts/public-evaluation-open.sh`. Both approvals are required, and there is no default spend.
- **Verify:** `node scripts/release/verify-production.mjs --public-mode --expect-admissions public --max-qloo <n> --max-usd <usd>`. Its probes are malformed, so Railway admits and refuses them with 400 before any quota, model or Qloo call. Never verify an open evaluation with `--expect-admissions closed` or `open`, because those modes send a well-formed anonymous resolution.
- **Kill switch:** `scripts/public-evaluation-close.sh` sets every admission flag to 0 and redeploys. The evaluation also closes by itself at `CE_PUBLIC_EVALUATION_EXPIRES_AT`.
- **Durability:**
  - The run ledger is keyed by `CE_PUBLIC_EVALUATION_ID`. Reopening the same id continues the same counters; a new id is a new allowance and needs a new approval.
  - Per-network quotas live in `baseline_budget_accounts`, keyed by an HMAC of the Vercel client address. The address itself never reaches Railway.
  - An unused model reservation is returned only after the provider reported usage.
- **Still in process:** running jobs. A restart interrupts them, but budgets and quotas survive.
