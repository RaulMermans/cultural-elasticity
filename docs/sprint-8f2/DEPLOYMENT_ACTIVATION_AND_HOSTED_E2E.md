# Sprint 8F.2 — Deployment activation and hosted E2E

Execution sprint, 2026-10-24. No paid investigation. No public production publish. No repository-visibility change. Production model unchanged: `claude-haiku-5-5`. No new Railway or Vercel project. No production-targeted Vercel bootstrap.

Owner-authorized actions used in this sprint:

1. Apply the existing staged Railway GitHub source (`accept-deploy`).
2. Create a protected Vercel preview from a non-`main` Git reference.
3. Use Playwright MCP and provider APIs to inspect and verify.
4. Run required deployment tests (including `pnpm smoke:remote` while admissions stayed paused).
5. Minimal reversible probe correction (404 `DEPLOYMENT_NOT_FOUND` is a pass).
6. Document and push a tested sprint branch.

## 1. Starting State

| Surface | Observed at sprint start |
| --- | --- |
| GitHub repo | `RaulMermans/cultural-elasticity` (private) |
| GitHub `main` | `47a20fd31be7f9bd8fe6f4b8c2af4d7789d8f8c1` (merge of PR #20) |
| Previous reviewed `main` | `4c35a203814a5960fee4d08cf83d4f418a55a16f` (PR #19) |
| Local branch | `sprint/8f-github-connected-deployments` at `45e5b46` (PR #20 content; working tree clean) |
| Railway live | CLI upload `2e0628d5-b749-443f-a3fd-2f343db67e63` of `1315bbf` |
| Railway staged | patch `ee68ad23-525b-4acf-82ef-db48ad5db98e`: `source.repo`, `source.branch`, `source.commitSha` only |
| Vercel | Git-linked, Authentication **All Deployments**, two cancelled production-targeted Git builds, `live: false` |
| GitHub Actions | **GITHUB_ACTIONS_BILLING_BLOCKED** |

Local `git fetch origin` still fails on iCloud-duplicated refs named `* 2`. GitHub MCP `list_commits` is the source of truth for remote `main`.

## 2. Reviewed Commits

`4c35a20` → `47a20fd` is documentation and supporting artifacts only:

- `45e5b46` (PR #20 body) vs `4c35a20`: 11 files, all under `.gitignore`, `README.md`, `docs/`.
- No `backend/src`, `backend/Dockerfile`, `railway.json`, `packages/shared`, lockfile, or CI workflow changes.

The Railway staged pin `4c35a20` was therefore preserved. It was not restaged onto the newer docs-only SHA.

The live Git deploy that Railway built after `accept-deploy` is **`47a20fd`** (current `main` HEAD). Runtime code is identical to the pin. Operator `/ops/status` reports that SHA.

## 3. Railway Staged Patch

Inspected immediately before apply:

| Field | Value |
| --- | --- |
| Patch | `ee68ad23-525b-4acf-82ef-db48ad5db98e` |
| Service | `cultural-elasticity-api` `06b519c8-56a1-4e7d-99ea-358e03d69c16` |
| Changes | 3: `source.repo=RaulMermans/cultural-elasticity`, `source.branch=main`, `source.commitSha=4c35a203814a5960fee4d08cf83d4f418a55a16f` |
| Destructive | no |
| Extra services / volumes / regions / replicas | none |

Matched the Sprint 8F.1 expected patch. Applied with Railway MCP `accept-deploy`.

## 4. Railway Deployment Result

**RAILWAY_GIT_DEPLOYMENT_VERIFIED.**

| Field | Value |
| --- | --- |
| Project | `cultural-elasticity` `cf7fb87c-d2fe-4ae0-8cea-1e8dcd065298` |
| Environment | production `b6af0e24-636a-458e-b6b0-47aebc474464` |
| Service | `cultural-elasticity-api` `06b519c8-56a1-4e7d-99ea-358e03d69c16` (same ID) |
| Deployment | `77b42d21-939d-4dc9-9fde-f3ba3fc3a65a` **SUCCESS** |
| Trigger | GitHub (`accept-deploy` of the staged source) |
| Built commit | `47a20fd31be7f9bd8fe6f4b8c2af4d7789d8f8c1` |
| Config pin still stored | `4c35a20` on `main` (docs-only vs live SHA) |
| Domain | `https://cultural-elasticity-api-production.up.railway.app` |
| Previous CLI upload | `2e0628d5` replaced (dashboard: Removing at apply time; remains a rollback candidate) |

Evidence: `docs/sprint-8f2/railway-git-deployment-success.png`. Healthcheck `/health` succeeded during deploy. Runtime: `Server listening` then `cultural-elasticity-api ready`. Image digest `sha256:1d1cd314ea8cbbb2a45b4ed9b509477738e061145d42308c8cdec2e0025fc886`.

## 5. Railway Runtime Verification

Anonymous:

| Check | Result |
| --- | --- |
| `GET /health` | 200 `{"status":"ok","service":"cultural-elasticity-api"}` |
| `GET /ready` | 503 `ADMISSIONS_PAUSED`, `acceptingInvestigations: false` |
| `POST /api/agent/jobs` no auth | 401 |
| `POST /api/agent/jobs` wrong secret | 401 |
| `GET /ops/status` no token | 404 |
| `POST /ops/providers/probe` no token | 404 |

Authenticated `pnpm smoke:remote` (secrets read from Railway CLI into a local subprocess; **not printed**): **REMOTE_SMOKE PASS 23/23**.

Operator `/ops/status` revision:

```
source: railway_git
repository: RaulMermans/cultural-elasticity
gitSha: 47a20fd31be7f9bd8fe6f4b8c2af4d7789d8f8c1
gitBranch: main
acceptingInvestigations: false
jobs: running 0, queued 0, held 0
```

Caps unchanged: 1 replica, `us-east4-eqdc4a` (Virginia), 0.5 vCPU, 1 GB, sleep off, no volume, no database. Investigations remain disabled. Hosted Vercel job later hit this process as `POST /api/agent/jobs → 503` (4 ms).

24h metrics after apply: CPU max 0.0071, memory max 0.0532 GB, network ~0.

## 6. Vercel Preview Strategy

Existing project reused. Ignored Build Step still **Only build pre-production**:

```
if [ "$VERCEL_ENV" == "preview" ]; then exit 1; else exit 0; fi
```

That is why the two earlier Git-triggered deployments (`dpl_8cj3QW2MwmaZVUzw8tMum2TkhXgv`, `dpl_3gkKHJco5f2Av6wcEYduiRGWWbne`) were **CANCELED** with `target: production` and `errorLink` pointing at ignored-build-step. They were not previews.

Creating GitHub branch `deploy/8f2-protected-preview` from `main@47a20fd` via the GitHub API did **not** emit a push webhook, so Vercel did not auto-deploy. A Vercel MCP `create_deployment` with `gitSource.ref=deploy/8f2-protected-preview` and **no** `target: production` created a real preview.

`--prod` was not used. Production branch was not changed. Feasibility project untouched.

## 7. Vercel Deployment Result

**VERCEL_PROTECTED_PREVIEW_READY.**

| Field | Value |
| --- | --- |
| Project | `cultural-elasticity` `prj_AHQcMcLFwGUOpRmepvwcc89LyOYo` |
| Team | `raulmermans-projects` `team_XhPrQDNS4DIWblm4khq4VNU0` |
| Deployment | `dpl_9vEPhuFS1P9XuXWnKSJfSCcsQuQ6` |
| readyState | READY |
| CLI `target` | **preview** |
| API `target` | `null` (Vercel preview; production entries are `"production"`) |
| Project `live` | **false** |
| Auto-assign custom domains | false |
| Source | GitHub `RaulMermans/cultural-elasticity` |
| Ref | `deploy/8f2-protected-preview` |
| SHA | `47a20fd31be7f9bd8fe6f4b8c2af4d7789d8f8c1` |
| Unique URL | `https://cultural-elasticity-pw7bhjnb3-raulmermans-projects.vercel.app` |
| Branch alias | `https://cultural-elasticity-git-deploy-8f2-49ce8c-raulmermans-projects.vercel.app` |
| Production alias | `https://cultural-elasticity.vercel.app` unassigned |
| Framework / root / Node | Next.js / `frontend` / 22.x |
| Protection | `ssoProtection.deploymentType: "all"` |
| Preview env names | `BACKEND_URL`, `CE_INTERNAL_API_SECRET` (preview only; no `NEXT_PUBLIC_`; `hiddenProductionEnvCount: 0`) |

Evidence: `docs/sprint-8f2/vercel-preview-deployment-ready.png`.

## 8. Anonymous Access Probe

**Not** `VERCEL_PROTECTION_GATE_FAILED`.

| URL | Anonymous result |
| --- | --- |
| Unique preview | HTTP 401 (`redirect: manual`) / 302 SSO. Playwright fresh context → Vercel login. `servedApp=false` |
| Branch alias | same |
| Production alias | HTTP 404, `x-vercel-error: DEPLOYMENT_NOT_FOUND` |
| `GET /api/demo/recorded` | 302 SSO |
| `GET /api/agent/jobs` | 302 SSO |
| `POST /api/agent/jobs` | 401 JSON `vercel_auth_enabled: true` |

`node scripts/vercel-protection-probe.mjs` now treats 404 `DEPLOYMENT_NOT_FOUND` as a pass (unassigned alias is not app exposure). After that correction: **VERCEL_PROTECTION_PROBE_PASS**.

Authenticated owner Playwright loaded the Living Atlas. Evidence: `docs/sprint-8f2/vercel-protected-preview-authenticated.png`.

## 9. Hosted Integration Test

**HOSTED_INTEGRATION_VERIFIED.**

Path exercised: browser → protected Vercel Next.js → Railway Fastify → JobManager, with admissions paused.

| Check | Result |
| --- | --- |
| Recorded example `/api/demo/recorded` | Loaded for the authenticated viewer. Labelled recorded. No Qloo call |
| Correct preview secret | `POST /api/agent/jobs` → **503** `New investigations are not being accepted right now.` Next.js mapped Railway's pause. Railway HTTP log: `POST /api/agent/jobs → 503 (4ms)` at 09:39:25Z |
| Wrong / missing secret | Direct Railway 401 (smoke 23/23). Anonymous Vercel never reached Railway |
| Admissions | remain paused. `acceptingInvestigations: false`. Jobs 0/0/0 |
| Paid providers | **zero** Qloo/Anthropic investigation calls |

UI showed the admissions-paused alert on mobile and desktop. Evidence: `docs/sprint-8f2/vercel-preview-mobile-admissions-paused.png`, `docs/sprint-8f2/vercel-preview-recorded-atlas.png`.

Vercel runtime-log API returned no function lines for this Hobby preview (empty window). The Playwright network capture and Railway HTTP log are the integration evidence.

## 10. Playwright E2E

Hosted (Playwright MCP, owner profile + a fresh anonymous context):

- Homepage / Living Atlas composer
- Recorded Jacquemus investigation, territory selection, evidence inspector
- Navigation, “No usable evidence”, Partial evidence
- New question → admissions refused
- Mobile 390×844
- Console: favicon 404 and the expected 503 on `/api/agent/jobs`. No application JS crash
- Anonymous context never received the app

Local synthetic `pnpm test:e2e` (not hosted, not live Qloo/Haiku): 16 tests. Full run 15/16 once (`stopping an investigation` missed “was stopped” under leftover port/`PORT` pollution from an earlier env source). Isolated retry of that test **PASS**. Treat as 16/16 after clean ports and `PORT` unset.

## 11. CI Status

**GITHUB_ACTIONS_BILLING_BLOCKED.** Unchanged. Run [40075860816](https://github.com/RaulMermans/cultural-elasticity/actions/runs/40075860816) (`main` / `47a20fd`, push, 2s):

> The job was not started because recent account payments have failed or your spending limit needs to be increased.

`verify` failed to start; `e2e` and `docker` skipped. Payment methods were not changed. Cloud CI is **not** verified. Evidence: `docs/sprint-8f2/github-actions-billing-blocked.png`, `docs/sprint-8f2/github-actions-verify-job-billing.png`.

Local Node **22.23.2** (required; Node 20 cannot run frontend `--experimental-strip-types` tests):

| Command | Result |
| --- | --- |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | frontend **14/14**; backend **756/756** (one contended run had 7 subprocess timeouts; isolated retry 18/18 then full 756/756) |
| `pnpm build` | PASS |
| `pnpm check:secrets` | PASS, 385 repo + 19 bundle |
| `pnpm eval:methodology` | 19/19, `LIVE_QLOO_VALIDATION_NOT_RUN` |
| `pnpm eval:agent` | 53/53, `LIVE_AGENT_MODEL_VALIDATION_NOT_RUN` |
| `pnpm eval:live` | 19/19 + 3/3 recorded (offline) |
| `pnpm eval:query` | offline targets PASS; HELD_OUT 24/24; X06 for review; `LIVE_HAIKU_QUERY_VALIDATION_NOT_RUN` |
| `pnpm eval:elasticity` | structural 27/27; index **REJECTED_FOR_NOW** |
| `pnpm smoke:offline` | OFFLINE_SMOKE_PASS |
| `pnpm smoke:docker` | DOCKER_SMOKE_PASS + `MCP_HANDSHAKE_OK tools=10` |
| `pnpm smoke:remote` | REMOTE_SMOKE PASS 23/23 on Git-deployed Railway |
| `pnpm eval:agent:live` | **NOT RUN** |
| `pnpm eval:query -- --live` | **NOT RUN** |
| `pnpm feasibility:qloo` | **NOT RUN** |

## 12. Infrastructure Cost

Hobby. One Railway service, one replica, one region. Soft $5 / hard $10 workspace limits unchanged. No plan upgrade. No extra replica, volume, or database. Railway 24h usage stayed near idle under the existing cap. Vercel: one protected preview build (plus two historical cancelled Git production skips). No paid research tests.

## 13. Cloud Changes

1. Railway `accept-deploy` of staged GitHub source on the existing API service.
2. GitHub branch `deploy/8f2-protected-preview` at `47a20fd`.
3. Vercel preview deployment `dpl_9vEPhuFS1P9XuXWnKSJfSCcsQuQ6` on the existing project.
4. Protection-probe script: 404 `DEPLOYMENT_NOT_FOUND` is a pass.

Not done: new projects, new services, production Vercel deploy, `--prod`, production credentials on Vercel, admissions on, payments, visibility, protection removal.

## 14. Recovery Actions

- Railway Git deploy succeeded. Rollback of `2e0628d5` was **not** executed (the new deploy is healthy). Railway still lists that ID as a rollback candidate.
- Vercel production bootstrap was **not** required. A genuine preview exists.
- Local E2E webServer timeout: persistent `PORT=4000` from an earlier `.env` source made the synthetic backend bind 4000 instead of 4100. Fixed for the rerun by unsetting `PORT` and freeing 3100/4100. No product change.
- Contended backend MCP tests: isolated rerun passed; full suite 756/756.

**Operational incident (not written to the repo):** a Railway CLI JSON pipe was accidentally fed to `node --input-type=module` stdin, so variable JSON entered the agent log. Values were not copied into git, docs, or chat replies. Rotate Anthropic and Qloo keys when convenient. Internal API secret and operator token were not printed.

## 15. Known Limitations

1. GitHub-hosted CI remains billing-blocked.
2. Public production frontend is intentionally unpublished (`live: false`, production alias 404).
3. Investigations remain paused. Hosted Ask is a refused admission, not a live result.
4. A refused live question on top of an open recorded atlas can shrink the visible recorded tree. Recorded evidence remains; this is a product UX issue, not a deployment blocker.
5. Favicon 404 on the preview.
6. Vercel Hobby runtime-log API was empty for this preview; Railway HTTP logs plus Playwright network are the hosted-job evidence.
7. Local `git fetch` of all refs still breaks on iCloud `* 2` duplicates.
8. Relative Elasticity Index remains **REJECTED_FOR_NOW**.
9. Agent remains **`AGENT_MODEL_NOT_READY`**.

## 16. Sprint 9 Release Readiness

Do **not** start public hackathon publish from this sprint.

Ready for Sprint 9 to consume:

- GitHub-deployed Railway backend (admissions off, 1 replica).
- Protected Vercel preview with proven anonymous denial and hosted paused integration.
- Recorded Living Atlas on that preview.

Still required before **PUBLIC_RELEASE_READY**:

1. Restore GitHub Actions billing so `verify` actually runs.
2. Separate owner decision to allow production Git builds (would require changing Ignored Build Step).
3. Separate owner decision to attach a public domain under All Deployments, or a reviewed protection exception.
4. Separate owner decision to enable investigations (`CE_ACCEPT_INVESTIGATIONS`) with a spend ceiling.
5. Full live agent gate (`eval:agent:live`) if the submission claims agent readiness.
6. Key rotation after the Railway CLI stdin incident.
