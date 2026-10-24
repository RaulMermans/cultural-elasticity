# Sprint 8F — GitHub-connected deployments and release readiness

Execution sprint, 2026-10-24. No paid investigation. No public production publish. No repository-visibility change. Production model unchanged: `claude-haiku-5-5`.

Owner authorizations used in this sprint (and nothing beyond them):

1. **Vercel Authentication → All Deployments** on the existing product project (required before any new deploy).
2. **Inspect** GitHub, Vercel and Railway. **Do not** create replacement projects or services.
3. **Do not** run `vercel deploy --prod --skip-domain` until the owner explicitly authorizes that bootstrap.
4. **Do not** run a live Railway investigation. **Do not** run the full agent gate.

## 1. Executive Outcome

| Gate | Decision |
| --- | --- |
| Engineering | **ENGINEERING_COMPLETE** for the workflow that can be built without a new hosted frontend: All Deployments protection, CI, provenance, watch paths, docs. Connections that need owner GitHub App access or a bootstrap deploy remain open. |
| GitHub source | **GITHUB_SOURCE_NOT_CONNECTED.** Canonical repo verified. Sprint 8E is already on `main` (PR #18). Vercel Git is disconnected. Railway GitHub App still cannot see the private repo. |
| Vercel preview | **VERCEL_PROTECTED_PREVIEW_NOT_READY.** Protection is `all`. Zero deployments. Alias `cultural-elasticity.vercel.app` is `DEPLOYMENT_NOT_FOUND` (HTTP 404). Bootstrap is `BOOTSTRAP_AWAITING_APPROVAL`. |
| Railway Git | **RAILWAY_GIT_SOURCE_NOT_READY.** Existing service preserved. Staged `connect-service-source` returned `Repository "RaulMermans/cultural-elasticity" not found or is not accessible`. |
| Hosted integration | **VERCEL_RAILWAY_INTEGRATION_NOT_VERIFIED.** No Vercel-hosted Next.js. Local E2E and Railway remote smoke are not a hosted Vercel path. |
| Public release | **PUBLIC_RELEASE_NOT_READY.** |

## 2. Starting State

- Local branch `sprint/8e-live-validation-railway-launch` at `cae749d`, clean, tracking origin.
- GitHub default branch `main` is **not** the stale local `main` (`cc93778`, Sprint 0). GitHub `main` is merge `a4a7d5cc9bfe1ce8728054c96782070c9196af33` of PR #18 (Sprint 8E).
- New branch `sprint/8f-github-connected-deployments` from `cae749d`.
- Node 22.23.2, pnpm 10.26.0 used for verification.
- Railway MCP and Vercel MCP were connected in this session (unlike Sprint 8E).
- Agent: **`AGENT_MODEL_NOT_READY`**. Full gate not authorized.

## 3. GitHub Repository

| Item | Observed |
| --- | --- |
| Canonical remote | `https://github.com/RaulMermans/cultural-elasticity.git` |
| Owner/repo | `RaulMermans/cultural-elasticity` (from `git remote`, not the local folder name) |
| Visibility | **private** |
| Default branch | `main` |
| License | MIT (`LICENSE` + `package.json` `"license": "MIT"`) |
| Viewer permission | admin |
| Branch protection on `main` | **unavailable** on this private Free plan (`Upgrade to GitHub Pro or make this repository public`) |
| GitHub Actions | workflow exists; **jobs do not start** (account payments failed / spending limit) |

One repository. No second deploy repo. No ZIP-as-source.

## 4. Branch Strategy

```
main                 controlled release branch (GitHub; currently Sprint 8E via PR #18)
  └── sprint/*       development and (future) protected Vercel previews
```

Pull requests are mandatory before merging to `main`. GitHub branch-protection rules cannot be enabled on this private Free plan; the policy is documented here and in `AGENTS.md`, not enforced by GitHub.

Do **not** enable Vercel or Railway auto-deploy from `main` until:

1. All Deployments protection is verified on a real URL (not only project settings).
2. Railway GitHub App access is granted and auto-deploy is pinned or disabled.
3. The owner authorizes production promotion.

Sprint 8E is already reconciled onto GitHub `main`. This sprint’s code stays on `sprint/8f-github-connected-deployments` until review.

## 5. Current CI Review

Existing `.github/workflows/ci.yml` was extended, not replaced.

| Check | PR CI |
| --- | --- |
| `pnpm lint` / `typecheck` / `test` / `build` / `check:secrets` | yes (`verify`) |
| `pnpm eval:methodology` / `eval:live` / `eval:elasticity` / `eval:agent` | yes |
| `pnpm eval:query` | **added** |
| `pnpm test:e2e` | path-filtered job; Chromium only; skipped for fork PRs |
| `pnpm smoke:docker` | path-filtered job; skipped for fork PRs |
| `pnpm eval:agent:live` / `feasibility:qloo` | **never** |
| `pull_request_target` | **not used** |
| Provider / deploy secrets | **not interpolated** |
| Default permissions | `contents: read` |
| Concurrency | cancel in-progress runs on the same ref |

**GitHub Actions is unpaid.** Latest `main` run `40070743324` failed in 1s: “The job was not started because recent account payments have failed or your spending limit needs to be increased.” Local equivalent was run (below). Release stays blocked on GitHub-run evidence until billing is restored.

## 6. GitHub App Permissions

| App | Access to this private repo |
| --- | --- |
| Vercel GitHub App | Owner namespace `RaulMermans` is connected (`installationId` 118492494, `isAccessRestricted: false`). Other Vercel projects are Git-linked. **This product project’s `link` is `null`.** |
| Railway GitHub App | **No access.** Staged connect failed: repository not found or not accessible. |

Railway authorization screen (owner action, selected-repos only):

1. Open [github.com/apps/railway-app](https://github.com/apps/railway-app) (or [github.com/settings/installations](https://github.com/settings/installations) → Railway → Configure).
2. Repository access: **Only select repositories**.
3. Select **`RaulMermans/cultural-elasticity`**.
4. Save. Do not grant all-repositories access unless the owner explicitly chooses that.

The Cursor browser was not logged into GitHub, so this cannot be completed in-session. Do not pretend the connection succeeded.

## 7. Vercel Protection Fix

**Done before any new deployment.**

| Setting | Before | After (read back) |
| --- | --- | --- |
| Project | `cultural-elasticity` `prj_AHQcMcLFwGUOpRmepvwcc89LyOYo` | unchanged |
| Team | `raulmermans-projects` `team_XhPrQDNS4DIWblm4khq4VNU0` Hobby | unchanged |
| `ssoProtection.deploymentType` | `all_except_custom_domains` | **`all`** |
| Password protection | off | off |
| Git fork protection | on | on |
| `autoAssignCustomDomains` | (previous default) | **false** |
| `sourceFilesOutsideRootDirectory` | unset | **true** (monorepo `packages/shared`) |
| Ignored build step | unset | skip when `frontend/`, `packages/shared/`, root manifests, and `tsconfig.base.json` are unchanged |

Independent confirmation:

- Vercel MCP `get_project` after the update: `ssoProtection.deploymentType: "all"`.
- Vercel CLI `vercel project protection --format json`: `"deploymentType": "all"`.
- Current Vercel docs: `deploymentType` `all` is **All Deployments**, available on every plan including Hobby (“Protect production deployments for free on every plan”).

`all_except_custom_domains` is what left `cultural-elasticity.vercel.app` public in Sprint 8E. `all` is the setting that covers production aliases.

## 8. Vercel Bootstrap

**`BOOTSTRAP_AWAITING_APPROVAL`.** Not run.

Preconditions already true:

- All Deployments protection read back as `all`.
- Production env count: **0** (`hiddenProductionEnvCount: 0`). No paid-provider vars, no `BACKEND_URL` on production.
- Preview env names only: `BACKEND_URL`, `CE_INTERNAL_API_SECRET` (sensitive).
- Zero deployments. Alias exists but is not serving an app.
- Feasibility project was not used.

Approved command, when the owner says so, from a **committed** SHA:

```sh
vercel link --yes --scope raulmermans-projects --project cultural-elasticity
vercel deploy --prod --skip-domain --yes
```

This is still a **production-targeted** build. Do not label it preview. `--skip-domain` disables automatic domain promotion; it does not change the target. Verify the provider-reported `target` immediately. Then run `node scripts/vercel-protection-probe.mjs` on the unique URL and on `https://cultural-elasticity.vercel.app`. If either returns the Living Atlas anonymously: **`VERCEL_PROTECTION_GATE_FAILED`**, stop automation.

Do **not** use `create_git_project`: it does not reconnect this existing unlinked project and defaults to creating a deployment.

## 9. Vercel Git Integration

**Not connected.** `link: null`. Root Directory `frontend`. Framework Next.js. Node 22.x.

After a safe bootstrap, connect the **existing** project:

```sh
vercel git connect https://github.com/RaulMermans/cultural-elasticity.git --scope raulmermans-projects --yes
```

Then verify the first Git-triggered deployment’s **actual** `target`. If it is production unexpectedly: stop.

Production branch should remain `main`. Feature `sprint/*` and pull requests should be previews only, and only after a production deployment already exists (Sprint 8E root cause: Vercel’s first deployment is always production).

## 10. Vercel Preview Verification

| URL class | Anonymous result |
| --- | --- |
| Production alias `https://cultural-elasticity.vercel.app` | HTTP **404**, `x-vercel-error: DEPLOYMENT_NOT_FOUND`. Not a 200 of the app. |
| Unique deployment URL | **N/A** (zero deployments) |
| Branch URL | **N/A** |
| API routes | **N/A** |
| Authenticated owner session | **N/A** |

Settings-level protection is verified. URL-level protection of a live deployment is **not** verified. That is why preview remains NOT_READY.

## 11. Railway GitHub App Access

**Not corrected.** Owner must complete §6. This sprint did not grant all-repository access and did not create another service.

## 12. Railway Source Connection

Existing service **preserved**:

| Item | Value |
| --- | --- |
| Workspace | Raul Mermans's Projects `c0ab616f-9621-49ca-87d8-ca5c77e871da` |
| Project | `cultural-elasticity` `cf7fb87c-d2fe-4ae0-8cea-1e8dcd065298` |
| Environment | `production` `b6af0e24-636a-458e-b6b0-47aebc474464` |
| Service | `cultural-elasticity-api` `06b519c8-56a1-4e7d-99ea-358e03d69c16` |
| Latest deployment | `2e0628d5-b749-443f-a3fd-2f343db67e63` SUCCESS, 2026-10-24T05:27:01Z |
| Source | **no Git repo** (CLI upload of `1315bbf`) |
| Region / replicas | `us-east4-eqdc4a` × 1 |
| Caps | 0.5 vCPU, 1 GB |
| Sleep | off |
| Healthcheck | `/health`, 120 s |
| Restart | ON_FAILURE, 3 |
| Domain | `https://cultural-elasticity-api-production.up.railway.app` |

Staged connect (no live deploy) with `repo=RaulMermans/cultural-elasticity`, branch `sprint/8e-live-validation-railway-launch`, `commitSha=cae749d…` **failed** on repository access.

Preferred once the App can see the repo:

1. Stage source with `commitSha` of the reviewed SHA (pins the service; branch pushes do not auto-deploy).
2. Set watch paths from `railway.json`.
3. Do **not** `accept-deploy` until the staged config is inspected.
4. Keep PR environments off.
5. Enable branch auto-deploy only after owner approval.

## 13. Railway Build Configuration

`backend/Dockerfile` is unchanged. Build context is the **repository root** (copies `packages/shared`). Node 22-slim, frozen lockfile, `pnpm deploy --prod`, non-root `node`.

`railway.json` Config-as-Code is **deprecated** (hard cutoff **2026-12-01**) in favour of `.railway/railway.ts`. Official migration (`railway config migrate`) is supported but would rewrite project IaC and is not required before 30 Oct. **Kept `railway.json`.** Follow-up: migrate after the Git source works, with `railway config plan` showing no unexpected deletes.

Watch patterns added (gitignore-style, rooted):

```
/backend/**
/packages/shared/**
/package.json
/pnpm-lock.yaml
/pnpm-workspace.yaml
/tsconfig.base.json
/railway.json
```

`backend/tests/sprint-8f.test.ts` proves: frontend-only → no backend rebuild; backend, shared, lockfile, `railway.json` → rebuild. This is a matcher test against the committed patterns, not a live Railway skip/deploy observation.

## 14. Deployment Trigger Policy

```
BUILD → TEST → VERIFY SHA → PROTECTED PREVIEW → INTEGRATION TEST → OWNER APPROVAL → PRODUCTION
```

| Event | Intended action |
| --- | --- |
| Push to `sprint/*` | Vercel protected preview (after bootstrap + Git connect). No Railway deploy. |
| Pull request | Same Vercel preview. CI offline only. |
| Merge to `main` | Not automatic production publication. Railway stays pinned until auto-deploy is approved. |
| Public alias | Separate explicit approval. All Deployments stays on until then. |

Paid investigations stay `CE_ACCEPT_INVESTIGATIONS=0` across ordinary redeploys.

## 15. Source SHA Provenance

| Surface | SHA |
| --- | --- |
| Intended reviewed code (8E) | `1315bbf44a5e1bc39f2665f0ead6111f2a540fab` |
| 8E docs | `cae749d2280f8423965f1e929aab4095ca04193b` |
| GitHub `main` | `a4a7d5cc9bfe1ce8728054c96782070c9196af33` (merge of 8E) |
| Railway live | CLI upload of `1315bbf` (deployment `2e0628d5-…`). No `RAILWAY_GIT_COMMIT_SHA`. |
| Vercel | none |

Operator `GET /ops/status` now includes `revision: { repository, gitSha, gitBranch, source }` from Railway Git env or `CE_GIT_SHA`. No secrets, no commit message. Hidden without the operator token (404). Current Railway build predates this field (`[SKIP]` in remote smoke).

## 16. Secret Handling

Railway variable **names** unchanged: `ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID`, `QLOO_API_KEY`, `CE_INTERNAL_API_SECRET`, `CE_OPERATOR_TOKEN`, plus non-secrets `NODE_ENV`, `HOST`, `PORT`, `CE_PUBLIC_DEPLOYMENT`, `CE_ACCEPT_INVESTIGATIONS`, `CE_SPEND_BUDGET_USD`, `CE_INVESTIGATION_RESERVE_USD`, `CE_REPLICA_COUNT`, `QLOO_API_BASE_URL`, `QLOO_CALL_SPACING_MS`.

Vercel names: preview `BACKEND_URL`, `CE_INTERNAL_API_SECRET`. Production: none. No `NEXT_PUBLIC_` credentials.

`pnpm check:secrets`: 377 repo files + 19 bundle files, no leakage. Remote `/ops/status` with operator token: 200, no secret in body. Values were never printed.

## 17. Vercel/Railway Integration

Required path (not run):

Browser → Vercel Next.js (authenticated) → server route → Railway HTTPS → Fastify → JobManager (admissions paused).

Proven this sprint:

- Railway HTTPS: remote smoke **22/22**, admissions paused, wrong/missing secret 401, recorded-demo path not involved.
- Browser E2E **16/16** against a **synthetic** local job API (not Vercel, not Railway).

**`VERCEL_INTEGRATION_NOT_VERIFIED`.** Local Next → Railway from Sprint 8E is still not a hosted proof.

## 18. Provider Spending Safety

`CE_ACCEPT_INVESTIGATIONS=0` on Railway. No `/ops/providers/probe` with a token. No live Haiku/Qloo call. Full gate still needs ≥ $28.08 approved ceiling. **`LIVE_RAILWAY_TEST_BLOCKED_BY_APPROVAL`.** **`LIVE_GATE_BLOCKED_BY_APPROVAL`.**

## 19. Railway Costs

24h metrics: CPU max 0.007 vCPU; memory current 47 MB, max 53 MB; network ~0. Hard limit **$10** / soft **$5** unchanged. One service, one replica, no volume, no database. No new recurring cloud products. Hobby $5/month inclusion still covers idle.

## 20. CI Efficiency

pnpm cache on `verify` and `e2e`; concurrency cancellation; E2E/Docker skipped when their paths did not change; fork PRs do not run E2E/Docker; empty provider env vars; no live evals. This cannot reduce GitHub’s billing block.

## 21. Rollback

**Vercel (after a known-good protected deployment exists):** identify previous READY deployment, confirm `ssoProtection` still `all`, confirm SHA, `vercel rollback <id>` (Hobby: immediately previous production only). Do not assign the public alias.

**Railway (live now):** known-good deployment `2e0628d5-b749-443f-a3fd-2f343db67e63` (SHA `1315bbf`). Dashboard/CLI can roll back that deployment (`can roll back: true`). Confirm one replica, `CE_ACCEPT_INVESTIGATIONS=0`, `/health` 200, `/ready` 503. In-memory jobs are lost. Do not destroy the project to test rollback.

A rollback of a live paid service still needs operator approval; none was performed.

## 22. Public Demo Access

**MODE A (intended hackathon demo):** recorded Qloo-backed example, Living Atlas, evidence inspector. Zero model/Qloo calls. Requires a **public** frontend, which this sprint does not publish.

**MODE B (private live):** authenticated, admissions on, budgets. Not enabled. Not for strangers.

All Deployments stays on until public release is explicitly approved. Do not remove it to simplify testing.

## 23. Hackathon Requirements

Official rules reviewed at [qloo.devpost.com/rules](https://qloo.devpost.com/rules) and the submission page, 2026-10-24.

| Requirement | Status |
| --- | --- |
| Deadline | 30 Oct 2026, 11:45 pm ET |
| Working app integrating Qloo, agentic | Product exists; live hosted path incomplete |
| Functional demo URL | No public frontend |
| Public GitHub/GitLab/Bitbucket + license in About | Repo is **private**; MIT file is present |
| Text description | README header |
| External hosting / “fully published” | Homepage: local-only or private-only **do not qualify**. Official rules Testing: a private site may include login credentials for judges. Treat the stricter public-hosting line as the submission risk. |
| Visibility change | **not done** (needs owner approval + secrets review) |

## 24. Verification Results

| Command | Result |
| --- | --- |
| `pnpm lint` | PASS (Node 22.23.2) |
| `pnpm typecheck` | PASS |
| `pnpm test` | backend 60 files / **756** tests PASS; frontend **14/14** |
| `pnpm build` | PASS |
| `pnpm check:secrets` | PASS, 377 repo + 19 bundle |
| `pnpm eval:methodology` | 19/19, `LIVE_QLOO_VALIDATION_NOT_RUN` |
| `pnpm eval:agent` | 53/53, evaluator failures 0, `LIVE_AGENT_MODEL_VALIDATION_NOT_RUN` |
| `pnpm eval:live` | 19/19 + 3/3 recorded (offline) |
| `pnpm eval:query` | offline targets PASS; HELD_OUT 24/24; X06 for review (unchanged); `LIVE_HAIKU_QUERY_VALIDATION_NOT_RUN` |
| `pnpm eval:elasticity` | structural 27/27; index **REJECTED_FOR_NOW** |
| `pnpm test:e2e` | **16/16** (synthetic job API) |
| `pnpm smoke:offline` | OFFLINE_SMOKE_PASS |
| `pnpm smoke:docker` | DOCKER_SMOKE_PASS + `MCP_HANDSHAKE_OK tools=10` |
| `pnpm smoke:remote` | **22/22** Railway; revision field SKIP (8E image) |
| GitHub Actions CI | **FAIL to start** (billing). Not a test failure. |
| `pnpm eval:agent:live` | **NOT RUN** |
| `vercel deploy --prod --skip-domain` | **NOT RUN** (`BOOTSTRAP_AWAITING_APPROVAL`) |

## 25. Known Limitations

- GitHub private Free plan: no branch-protection rules.
- GitHub Actions unpaid; PR checks are not running on GitHub.
- Railway GitHub App still blocked.
- Vercel first-deploy-is-production behaviour is understood, not yet exercised under All Deployments.
- Watch-path tests are local matchers, not live Railway skip/deploy.
- `railway.json` must be migrated before 2026-12-01.
- Jobs/spend remain in-memory.
- Anthropic workspace limit and Qloo quota still UNVERIFIED.
- Feasibility project `prj_XW5QxClnn0w4egFdgR3YDC1wfOi7` returns 404 on today’s Vercel API; it was not modified here.

## 26. Remaining Release Blockers

1. Owner: GitHub Actions billing so CI actually runs.
2. Owner: Railway GitHub App access to **only** this repo, then staged pin + inspect.
3. Owner: explicit **yes** to the protected Vercel bootstrap (`vercel deploy --prod --skip-domain`) from a committed SHA.
4. Anonymous protection probe on a real deployment URL. If it 200s the app: stop.
5. Connect existing Vercel project to GitHub; verify first Git `target`.
6. Hosted Vercel → Railway smoke (correct secret → paused; wrong/missing → 401; recorded Atlas 200; no public access).
7. Public repo + public MODE A demo (hackathon), without enabling MODE B.
8. Full live agent gate (`AGENT_MODEL_NOT_READY`).

## 27. Recommended Next Step

Do not start Sprint 9 automatically. If approved, in this order: (1) restore GitHub Actions billing; (2) grant Railway the selected-repo App access; (3) authorize the protected Vercel bootstrap and run the anonymous probe; (4) connect GitHub to the existing Vercel project; (5) hosted paused integration test. Paid Railway investigation and the $28.08 gate stay separate decisions.

## 28. Git Status

Branch `sprint/8f-github-connected-deployments` (from `cae749d`). Worktree has Sprint 8F changes; **not committed** (no commit was requested). GitHub `main` = `a4a7d5c` (8E merge). Local `main` ref may still show Sprint 0 until `git fetch` (broken duplicate refs under iCloud `* 2` names currently interfere with fetch).
