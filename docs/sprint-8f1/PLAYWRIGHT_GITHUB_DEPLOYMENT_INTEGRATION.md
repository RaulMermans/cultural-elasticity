# Sprint 8F.1 — Playwright GitHub deployment integration

Execution sprint, 2026-10-24. No paid investigation. No public production publish. No repository-visibility change. Production model unchanged: `claude-haiku-5-5`. No new Railway or Vercel project. No `accept-deploy`. No `vercel deploy`.

Owner actions used in this sprint (and nothing beyond them):

1. Authenticate GitHub and Vercel in the headed Playwright MCP browser (passkey completed by the owner; credentials were never requested in chat).
2. Grant the existing Railway GitHub App selected-repository access to `RaulMermans/cultural-elasticity` (GEO-AEO-auditor preserved; All repositories not selected).
3. Connect the existing Vercel project to that GitHub repository through the official Git settings UI.

Stopped at explicit gates:

- Railway **Deploy / accept-deploy** of the staged Git source (would replace the running service).
- Vercel bootstrap `vercel deploy --prod --skip-domain --yes`.
- GitHub Actions payment or spending-limit changes.

## 1. Executive Outcome

| Gate | Decision |
| --- | --- |
| GitHub App (Railway) | **RAILWAY_GITHUB_APP_HAS_REPO.** Installation `101602702`, selected-repos only, includes `RaulMermans/cultural-elasticity`. |
| Railway Git source | **RAILWAY_GIT_SOURCE_STAGED_NOT_LIVE.** Existing service kept. Staged patch `ee68ad23-525b-4acf-82ef-db48ad5db98e` points at `main@4c35a203814a5960fee4d08cf83d4f418a55a16f`. Live deployment is still CLI upload `2e0628d5-b749-443f-a3fd-2f343db67e63`. `accept-deploy` not executed. |
| Vercel Git source | **VERCEL_GITHUB_CONNECTED.** Existing project `prj_AHQcMcLFwGUOpRmepvwcc89LyOYo` `link.type=github`, `RaulMermans/cultural-elasticity`, production branch `main`. Zero deployments. Git connect did not create a first production deploy. |
| Vercel protection | **ALL_DEPLOYMENTS** (`ssoProtection.deploymentType: "all"`). Alias `cultural-elasticity.vercel.app` remains HTTP 404 `DEPLOYMENT_NOT_FOUND`. |
| Protected preview | **VERCEL_PROTECTED_PREVIEW_NOT_READY.** No deployment URL exists to probe. |
| Hosted integration | **VERCEL_RAILWAY_INTEGRATION_NOT_VERIFIED.** No hosted Next.js. |
| GitHub Actions | **GITHUB_ACTIONS_BILLING_BLOCKED.** |
| Public release | **PUBLIC_RELEASE_NOT_READY.** |

## 2. Starting Repository State

Verified at sprint start (local worktree clean; Sprint 8F already merged):

```
branch: sprint/8f-github-connected-deployments
HEAD:   46c98fdedfadaabcd3134fb5601c111086f08ee2
remote: https://github.com/RaulMermans/cultural-elasticity.git (origin)
```

| Item | Observed |
| --- | --- |
| Canonical repo | `RaulMermans/cultural-elasticity` (private) |
| Default branch | `main` |
| GitHub `main` | `4c35a203814a5960fee4d08cf83d4f418a55a16f` (merge of PR #19) |
| Local branch HEAD | `46c98fd` (the 8F commit; merge commit is on GitHub `main` only) |
| Sprint 8F uncommitted work | **none.** 8F was committed and merged before 8F.1. |
| Reviewed SHA for both platforms | **`4c35a203814a5960fee4d08cf83d4f418a55a16f`** |
| Local `origin/main` | may be stale; GitHub MCP `list_commits` is the source of truth (`git fetch` can fail on iCloud duplicate refs named `* 2`) |
| Node / pnpm | 22.23.2 / 10.26.0 |

Do not treat local `main` as the release SHA. The approved revision is GitHub `main` `4c35a20`.

## 3. Playwright MCP Setup

| Item | Value |
| --- | --- |
| Server | Official Microsoft Playwright MCP via Cursor plugin `plugin-playwright-playwright` |
| Command | `npx @playwright/mcp@latest` |
| Tested version | **`@playwright/mcp@0.0.83`** (`~/.npm/_npx/9833c18b2d85bc59/node_modules/@playwright/mcp`) |
| Session | Headed Chromium, existing authenticated plugin tabs |
| Auth | Owner completed GitHub login and Vercel passkey in the browser |
| Auth state | **not committed.** `.playwright-mcp/` is gitignored |

This sprint uses Playwright MCP for dashboards. Repository Playwright Test (`pnpm test:e2e`) is a separate synthetic suite and is not MCP browser control.

## 4. GitHub Permission Changes

Installation: [Railway App](https://github.com/settings/installations/101602702) (installed 2025-12-28; not duplicated).

| Setting | Before 8F.1 | After 8F.1 |
| --- | --- | --- |
| Repository access | Only select repositories | **Only select repositories** (unchanged) |
| Selected repos | `RaulMermans/GEO-AEO-auditor` only | `GEO-AEO-auditor` **and** `RaulMermans/cultural-elasticity` |
| All repositories | not selected | **not selected** |
| Permissions | existing Railway App scopes | unchanged (no extra scope requested) |

Evidence: `docs/sprint-8f1/github-railway-app-selected-repos.png`. Save was disabled after the repo was already included.

Vercel Git linking used the official Vercel Git UI (owner passkey). The existing product project was not replaced. `create_git_project` was not used.

## 5. Railway Connection

| Item | Value |
| --- | --- |
| Project | `cultural-elasticity` `cf7fb87c-d2fe-4ae0-8cea-1e8dcd065298` |
| Service | `cultural-elasticity-api` `06b519c8-56a1-4e7d-99ea-358e03d69c16` (**same ID**) |
| Environment | `production` `b6af0e24-636a-458e-b6b0-47aebc474464` |
| Extra services | **none** |
| Volumes / databases | **none** |
| Method | Railway MCP `connect-service-source` with `staged: true`, `repo: RaulMermans/cultural-elasticity`, `branch: main`, `commitSha: 4c35a203814a5960fee4d08cf83d4f418a55a16f` |
| Staged patch | `ee68ad23-525b-4acf-82ef-db48ad5db98e` |
| Service state | `live-with-staged-changes` |
| Dashboard | Source repo linked; **Auto deploy unavailable** (commit pin); **Deploy** banner present and **not clicked** |

First staged connect failed with `Repository "RaulMermans/cultural-elasticity" not found or is not accessible` before the GitHub App grant. After selected-repo access, the same staged connect succeeded.

Evidence: `docs/sprint-8f1/railway-source-settings.png`.

## 6. Railway Service State (live vs staged)

Live (still serving traffic):

| Field | Value |
| --- | --- |
| Deployment ID | `2e0628d5-b749-443f-a3fd-2f343db67e63` |
| Status | SUCCESS (2026-10-24T05:27:01Z) |
| Source | Sprint 8E **manual Git commit upload** of `1315bbf` |
| Region | `us-east4-eqdc4a` |
| Replicas | **1** |
| CPU / RAM | 0.5 vCPU / 1 GB |
| Builder | DOCKERFILE `backend/Dockerfile` (monorepo root context, Node 22-slim, frozen lockfile, `packages/shared`) |
| Sleep | not enabled |
| Investigations | **disabled.** `/ready` → 503 `ADMISSIONS_PAUSED`, `acceptingInvestigations: false` |
| Domain | `https://cultural-elasticity-api-production.up.railway.app` |
| `/health` | 200 `{"status":"ok","service":"cultural-elasticity-api"}` |
| 24h metrics | CPU max 0.0071; memory max 0.0532 GB; network ~0 |

Staged (not applied):

| Field | Value |
| --- | --- |
| Repo | `RaulMermans/cultural-elasticity` |
| Branch | `main` |
| Commit | `4c35a203814a5960fee4d08cf83d4f418a55a16f` |
| Effect of accept-deploy | **would rebuild and replace** the running in-memory job/run/spend process |

Railway GitHub connection is therefore proven at the source-config layer. It is **not** yet the live runtime source.

## 7. Vercel Connection

| Item | Value |
| --- | --- |
| Team | `raulmermans-projects` `team_XhPrQDNS4DIWblm4khq4VNU0` |
| Project | `cultural-elasticity` `prj_AHQcMcLFwGUOpRmepvwcc89LyOYo` (**same ID**) |
| Feasibility project | `cultural-elasticity-feasibility` **untouched** |
| Framework | Next.js |
| Node | **22.x** |
| Root | `frontend` |
| Files outside root | **enabled** (`sourceFilesOutsideRootDirectory: true`) |
| Git | `type=github`, org `RaulMermans`, repo `cultural-elasticity`, productionBranch `main` |
| Connected | dashboard: “Connected 10m ago” at time of capture |
| Deployments | **0** (`live: false`, `latestDeployment: null`) |
| Deploy hooks | none created |
| Auto-assign custom domains | **false** |

Evidence: `docs/sprint-8f1/vercel-github-connected.png`.

Git connect did **not** trigger a first production deployment.

## 8. Vercel Protection and Preview Policy

| Control | Observed |
| --- | --- |
| Standard Protection | **All Deployments** |
| Password protection | off |
| Directory listing / shareable links / REST API / toolbar | off |
| Protection bypass | off |
| Alias `cultural-elasticity.vercel.app` | HTTP **404** `DEPLOYMENT_NOT_FOUND` (verified unassigned; not the app) |

Evidence: `docs/sprint-8f1/vercel-all-deployments-protection.png`. API: `ssoProtection.deploymentType: "all"`.

Preview env **names** (values not displayed, not overwritten):

| Name | Target | Production |
| --- | --- | --- |
| `BACKEND_URL` | preview | none (`hiddenProductionEnvCount: 0`) |
| `CE_INTERNAL_API_SECRET` | preview | none |

No `NEXT_PUBLIC_` variants. No production provider credentials on the Vercel project.

After Git linking, Ignored Build Step was still a custom diff that would build **production** on `main` when frontend/shared files changed. That is production automation before a protected URL exists. It was changed to Vercel’s **Only build pre-production** preset and saved:

```
if [ "$VERCEL_ENV" == "preview" ]; then exit 1; else exit 0; fi
```

API re-read: `commandForIgnoringBuildStep` matches that script. Git pushes to `main` skip. Git pushes to non-production branches may still create **protected previews**. CLI `vercel deploy --prod` is unaffected and remains unauthorized.

Evidence: `docs/sprint-8f1/vercel-ignored-build-preproduction.png` (section after save).

Anonymous probe of a unique deployment URL: **not possible** (zero deployments). Alias 404 is not a protection-bypass failure.

## 9. Bootstrap Deployment

**Not executed.** Prepared only:

```
vercel deploy --prod --skip-domain --yes
```

Preconditions still required before that command: All Deployments (met), no production provider credentials (met), reviewed SHA (met), domain assignment disabled (met), admissions paused on Railway (met), separate owner **yes**.

## 10. Hosted Preview Result

No Vercel deployment. No unique URL. No branch URL. Authenticated Living Atlas on Vercel: **not verified**. Unauthenticated unique-URL probe: **not verified**. Recorded demo on hosted Vercel: **not verified**.

## 11. Frontend/Backend Integration

Desired path (Browser → Vercel Next.js → Railway Fastify → AgentRuntime) is **not** proven from a hosted frontend.

Independent Railway checks on the **existing** authorized deployment `2e0628d5`:

| Check | Result |
| --- | --- |
| Anonymous `/health` | 200 |
| Anonymous `/ready` | 503 `ADMISSIONS_PAUSED` |
| Authenticated `pnpm smoke:remote` this sprint | **not re-run** (`CE_INTERNAL_API_SECRET` not present in the agent environment; values were not fetched from Railway) |
| Prior 8E/8F remote smoke on this same live deployment | 22/22 (admissions paused) |

Correct/incorrect/missing secret behavior from a Vercel preview: **not verified**.

## 12. Source SHA Provenance

| Surface | Repo | Branch | SHA | Deployment | Target | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GitHub default | `RaulMermans/cultural-elasticity` | `main` | `4c35a203814a5960fee4d08cf83d4f418a55a16f` | n/a | n/a | merged PR #19 |
| Railway **live** | CLI upload (not Git) | n/a | `1315bbf` (8E image) | `2e0628d5-b749-443f-a3fd-2f343db67e63` | production | SUCCESS, serving |
| Railway **staged** | `RaulMermans/cultural-elasticity` | `main` | `4c35a203814a5960fee4d08cf83d4f418a55a16f` | none yet | would be production | pending accept-deploy |
| Vercel project | `RaulMermans/cultural-elasticity` | `main` (production branch) | no deployment SHA | none | none | Git linked, 0 deploys |

`GITHUB_CONNECTED` is **not** claimed from a dashboard button alone. Railway MCP staged `source.repo` / `commitSha` and Vercel API `link.type=github` + `link.repo` were both re-read after the UI changes.

## 13. GitHub Actions Billing

**GITHUB_ACTIONS_BILLING_BLOCKED.**

Run [40072609609](https://github.com/RaulMermans/cultural-elasticity/actions/runs/40072609609) (`main` / `4c35a20`, push, 3s):

> The job was not started because recent account payments have failed or your spending limit needs to be increased.

`verify` failed to start; `e2e` and `docker` skipped. Payment methods and spending limits were **not** changed. This does not block Git source configuration. It does mean GitHub CI has **not** validated `4c35a20`.

Evidence: `docs/sprint-8f1/github-actions-billing-blocked.png`.

## 14. Verification Results

Local suite on this SHA (8F.1 session; no production code change in 8F.1):

| Command | Result |
| --- | --- |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS (after removing iCloud-duplicated `frontend/.next` `* 2` artifacts) |
| `pnpm test` | backend **756** PASS; frontend **14/14** |
| `pnpm build` | PASS |
| `pnpm check:secrets` | PASS, **385** repo + 19 bundle (after this sprint’s docs/screenshots) |
| `pnpm eval:methodology` | 19/19, `LIVE_QLOO_VALIDATION_NOT_RUN` |
| `pnpm eval:agent` | 53/53, `LIVE_AGENT_MODEL_VALIDATION_NOT_RUN` |
| `pnpm eval:live` | 19/19 + 3/3 recorded (offline) |
| `pnpm eval:query` | offline targets PASS; HELD_OUT 24/24; X06 for review; `LIVE_HAIKU_QUERY_VALIDATION_NOT_RUN` |
| `pnpm eval:elasticity` | structural 27/27; index **REJECTED_FOR_NOW** |
| `pnpm test:e2e` | **16/16** synthetic job API (not live Qloo/Haiku) |
| `pnpm smoke:offline` | OFFLINE_SMOKE_PASS |
| `pnpm smoke:docker` | DOCKER_SMOKE_PASS + `MCP_HANDSHAKE_OK tools=10` |
| `pnpm eval:agent:live` | **NOT RUN** |
| `pnpm feasibility:qloo` | **NOT RUN** |
| `CE_ACCEPT_INVESTIGATIONS` | **not enabled** |

Remote: unauthenticated Railway health/ready reconfirmed in 8F.1. Full authenticated `smoke:remote` not repeated without loading secrets into the agent.

## 15. Cloud Changes Made

1. Railway GitHub App: added `RaulMermans/cultural-elasticity` to selected repositories.
2. Railway service source: **staged** GitHub `main@4c35a20` on the existing API service.
3. Vercel existing project: Git linked to `RaulMermans/cultural-elasticity`.
4. Vercel Ignored Build Step: **Only build pre-production**.

Not done: new projects, new services, extra replicas, volumes, databases, region change, `accept-deploy`, Vercel deploy, env value overwrites, payments, visibility, admissions.

## 16. Unexpected Side Effects

- Linking GitHub did **not** create a Railway replica or change region.
- Linking GitHub did **not** create a Vercel deployment.
- Railway dashboard showed “Could not load branches” while the commit remained pinned and Auto deploy unavailable. Non-blocking; SHA is explicit.
- Vercel’s default after Git connect would have built production on later `main` pushes; that was closed by the ignored-build change.
- Dashboard “Apply 3 changes / Deploy” is live on Railway. Accidental accept-deploy would interrupt in-memory jobs.

## 17. Costs

No new paid host, replica, volume, or evaluation. Railway 24h usage stayed near idle under the existing 0.5 vCPU / 1 GB cap. Vercel deployment count remains 0. GitHub Actions jobs did not start (billing), so they did not consume minutes.

## 18. Remaining Blockers

1. Owner: restore GitHub Actions billing (do not treat CI as green until a job actually runs).
2. Owner: **yes or no** to Railway `accept-deploy` of staged `main@4c35a20` (replaces running `2e0628d5`).
3. Owner: **yes or no** to protected Vercel bootstrap `vercel deploy --prod --skip-domain --yes` from `4c35a20`, **or** a push to a non-`main` branch to create a protected preview under the new ignored-build policy.
4. After a real Vercel URL exists: two-context protection probe (authenticated Living Atlas vs fresh anonymous context). Anonymous HTTP 200 of the app is `VERCEL_PROTECTION_GATE_FAILED`.
5. Hosted Vercel → Railway paused integration (correct secret refused admission; missing/wrong 401; recorded demo without paid calls).
6. Public repo + public demo (hackathon), separately.
7. Full live agent gate (`AGENT_MODEL_NOT_READY`).

## 19. Exact Next Steps

Do **not** start Sprint 9 automatically.

If approved, in this order:

1. Fix GitHub Actions billing so `verify` actually runs.
2. Authorize Railway `accept-deploy` **only if** replacing the live 8E process with GitHub `4c35a20` is intended. Keep investigations disabled. Confirm still 1 replica.
3. Authorize a protected Vercel preview (CLI bootstrap **or** a non-production branch push). Probe anonymous access from a **fresh** browser context.
4. Run hosted paused integration against that preview.
5. Only then consider production Git deploys (would require changing Ignored Build Step back from pre-production-only).

## 20. Git Status at End of Sprint

Uncommitted documentation and screenshots on `sprint/8f-github-connected-deployments` (plus `.gitignore` / README / architecture status lines). No commit was requested. No push to `main`.
