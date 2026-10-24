# Sprint 8E — Live agent validation and Railway deployment

Execution sprint, 2026-10-24. Production model unchanged: `claude-haiku-5-5`, effort `high`, decision/synthesis `max_tokens` 16 000, Qloo hackathon host, 7000 ms spacing, 12 turns / 32 Qloo calls for frontier. Frozen gate `agent-readiness-gate-v3`, `run-evaluators-v2.1`, `frontier-stability-criteria-v1` unchanged.

Owner authorizations given in this sprint (and nothing beyond them):

1. **One live parent investigation**, hard ceiling **$2.34** (one run's conservative ceiling). The full readiness gate was **not** authorized.
2. **Railway:** commit + push the 8E branch, create one project / one service, copy provider keys from `backend/.env` without printing them.
3. **Vercel:** a new product project, **protected preview only**, no production promotion. Later: connect GitHub to obtain a branch preview.

## 1. Executive Outcome

| Gate | Decision |
| --- | --- |
| Engineering | **ENGINEERING_COMPLETE** — brand-scoping fix, budget preflight + suite guard, MCP-startup smoke, remote smoke, all offline checks green. |
| A. Research quality | **RESEARCH_COMPETENCE_IMPROVED** on one live run (n = 1, directional): 0 invalid actions (8C: 5), 3/4 candidates resolved (8C: 1/4), 3 PARTIAL (8C: 1), 8 empty probes (8C: 12). FULL unchanged at 0. Not variance-controlled. |
| B. Agent competence | **`AGENT_MODEL_NOT_READY`** — **`LIVE_GATE_BLOCKED_BY_APPROVAL`**. Gate needs a ≥ $28.08 approved ceiling (reserved exposure); the owner approved one parent only. |
| C. Railway | **RAILWAY_DEPLOYMENT_VERIFIED** for the controlled, admissions-off backend: one service, one region, one replica, 0.5 vCPU / 1 GB cap, sleep off, remote smoke 22/22, restart verified. Live provider calls **from Railway** not run (not authorized). |
| D. Vercel | **VERCEL_INTEGRATION_NOT_VERIFIED.** Project created and protected; Vercel forces a project's first deployment to production (three attempts); each was removed/cancelled within ~1 min. Server-to-server contract proven with a **local** production Next server → Railway over HTTPS. |
| E. Cost and security | Railway hard limit **$10** / soft **$5** (pre-existing, verified, unchanged); Railway Agent hard limit **$5**. Model spend bounded per run by `SpendBound`. Anthropic workspace limit and Qloo quota **UNVERIFIED** (no access). |
| Public release | **PUBLIC_RELEASE_NOT_READY.** |

## 2. Starting State

- Branch `sprint/8d-agent-research-competence` at `dd77e7b`, clean, **already pushed** (`origin` = same SHA). The brief's "uncommitted" note was stale; nothing was at risk.
- New branch `sprint/8e-live-validation-railway-launch` from `dd77e7b`. Code commit `1315bbf` pushed (owner-approved). Docs committed separately.
- Node 22.23.2, pnpm 10.26.0, Docker running, Railway CLI 5.71.0 and Vercel CLI 51.7.0 authenticated as the owner.
- **Railway MCP and Vercel MCP were not connected in this session.** The Railway CLI and GraphQL API (`railway api`) and the Vercel CLI/API were used instead, as the owner's authenticated tools. Recorded as a substitution, not as MCP verification.

## 3. Sprint 8D Research Changes (validated here)

- Phase 1 defect fixed: `frontierEvidenceBaseGap()` (`backend/src/agent/frontier.ts`) checked `state.related.length === 0`. A related-entity call about another entity, or an earlier canonical brand id, therefore closed the Channel A gap with an **empty** evidence base (`relatedOrder()` returned `[]`, so no profiles were "missing"). Now only a related call whose `subjectId` is the current brand id counts.
- Regressions: `backend/tests/sprint-8e.test.ts` (8 tests, SYNTHETIC): unrelated related call, re-anchor to a different canonical id, empty related answer (collected, no phantom blocker), HIGH action targeted at the brand, incomplete Channel A pool probes vs. hypothesized tags, in-flight hypothesis probed once then `NO_VALUE_ACTION`, finish without evidence-base blocker. Three fail on the pre-fix source; all pass after.
- No budget, skill version, prompt, or methodology change. `explore_candidate_territories` stays v5.

## 4. Live Agent Comparison

Frozen prompt "Where could Jacquemus expand?", live Haiku + live Qloo (MCP transport), local machine, same script family as 8C (`pnpm perf:live-trace`). Evidence: `docs/sprint-8e/evidence/live-parent-30de49f7.json`.

| Measure | 8C `775217fd` | 8E `30de49f7` |
| --- | --- | --- |
| Wall | 227 412 ms | **255 901 ms** |
| Span coverage | 0.992 | 0.992 |
| Context assembly (exclusive) | 1 427 ms | **839 ms** (11 turns) |
| Model turns / repairs | 12 / 0 | 11 / 0 (11/11 first-attempt valid) |
| Model latency | 65 296 ms | 58 920 ms |
| Qloo calls | 28 | **32** (budget exhausted) |
| Qloo spacing | — | 139 370 ms (26 gaps) |
| Tokens in / out | 104 361 / 17 640 | 106 213 / 16 315 |
| Model cost | $0.0179 | **$0.0172** |
| Invalid actions | 5 | **0** |
| `NO_VALUE_ACTION` / early stops | 4 | **0** |
| Proposed / resolved | 4 / 1 | 4 / **3** |
| Empty / successful type probes | 12 / — | 8 / 3 |
| validFull / invalidFull | 0 / 0 | 0 / 0 |
| PARTIAL | 1 | **3** |
| insufficient / unsupported (perf report) | 3 / 3 | 1 / 1 |
| Status | — | `BUDGET_EXHAUSTED` |

Territories (all `origin: qloo_evidence`, from the Channel A pool):

| Candidate | Route | Qloo concept |
| --- | --- | --- |
| Avant-Garde | PARTIAL_CULTURAL_ANALYSIS | `urn:tag:keyword:qloo:avant_garde` |
| Bohemian Lifestyle | PARTIAL_CULTURAL_ANALYSIS | `urn:tag:lifestyle:qloo:bohemian_lifestyle` |
| Hip Hop | PARTIAL_CULTURAL_ANALYSIS | `urn:tag:genre:music:hip_hop` |
| Art and Culture | INSUFFICIENT_EVIDENCE | not anchored |

Channel A order (turn: tool): 2 resolve brand → 3 brand profile + related entities → 4–5 seven related profiles (one empty, so the base extended by one, as designed) → 6 four proposals from the pool, then probes → 7–10 probes, profiles, two tag searches → 11 representation, analysis, panel. No ungrounded hypothesis was proposed or probed, and no call was refused.

## 5. Research Failure Analysis

| Class | Attribution on 8E run |
| --- | --- |
| RUNTIME_POLICY_EFFECT | Evidence base collected before proposals; every candidate came from the pool; 0 refused calls. Directly visible in the trace. |
| BUDGET_EXHAUSTION | The 32-call budget ran out in turn 11 with representations still pending for references. Channel A cost ≈ 9 calls (brand profile, related, 7 profiles). This is why the run ended at PARTIAL, not a methodology change. |
| REFERENCE_AVAILABILITY | No FULL: the comparison set was never completed inside the budget. FULL requirements unchanged; PARTIAL is the honest result. |
| REPRESENTATION_FAILURE | "Art and Culture" never anchored → INSUFFICIENT. |
| REAL_EVIDENCE_ABSENCE | 8 empty type probes; spread across candidates, none repeated a refused type (probe-limit refusals 0). |
| MODEL_DECISION_VARIANCE / QLOO_PROVIDER_VARIANCE | **Not separable at n = 1.** 8C's turn trace was not persisted, so no controlled replay of 8C decisions is possible. |

A higher PARTIAL count is not treated as proof of better research; the attributable improvements are the zero invalid/refused actions and the grounded candidate source.

## 6. C9 / Readiness Evaluation

- C9 = `run-evaluators-v2.1` with 0 failures on the prescribed live cases. Offline: **0 failures over 53 synthetic scenarios** (unchanged).
- Prescribed 7-case gate (L-M1, L-M2, L-M3, L-C1, L-C2, L-E1, L-E2; model + baseline; L-E1/L-E2 × 3 stability; plus controlled C-FULL-1): **not run**.
- **`LIVE_GATE_BLOCKED_BY_APPROVAL`.** Last full gate evidence remains SAFETY 13/13, COMPETENCE 8/9 (C9 blocking). **`AGENT_MODEL_NOT_READY`.**

## 7. Research Usefulness

Three Qloo-supported PARTIAL territories (avant-garde, bohemian lifestyle, hip hop) with provenance, one honest INSUFFICIENT. No FULL relative positions, so no ranking claim can be made. Useful as a grounded short-list for follow-up investigations; not a recommendation. Cost per useful (PARTIAL) result ≈ $0.0057 (8C ≈ $0.0179).

## 8. Performance Regression

- Wall +28.5 s (+12.5 %). The 4 extra Qloo calls × 7 s spacing ≈ 28 s explain it; model latency fell by 6.4 s and context assembly by 0.6 s.
- Accepted: the extra calls are Channel A evidence collection that produced 2 more supported candidates. Not a major regression; derived-state caching preserved (context 839 ms).
- Synthetic `perf:agent`: move 120 ms, compare 241 ms, frontier 7 ms (8D: 102 / 200 / 6). Measured while a Docker build ran in parallel; not read as a regression.

## 9. Evaluation Spending Controls

The 8D manifest's $2.50 reserve sat beside 220 model calls / 3.52 M output tokens: not credible at any Haiku price. New: `evals/agent/sprint-8e-live-gate-manifest.json` + `backend/scripts/live-gate-budget.ts` (`pnpm eval:agent:budget`).

| Figure | Value | Basis |
| --- | --- | --- |
| Planned runs | 12 model, 8 baseline | 7 prescribed + 1 controlled + 4 extra stability; baseline makes no model call |
| Per call ceiling | $0.09 | 100 K input (assumed; no hard context cap; 8C mean ≈ 8.7 K) + 16 K output at the conservative Haiku tier $0.50/$2.50 per MTok |
| Per run max calls | 26 | 12 decisions + 12 repairs + 2 synthesis attempts (`continue()` shares the run's turns) |
| Per run ceiling | $2.34 | |
| **EXPECTED_COST_USD** | **$0.33** | 12 × observed $0.0184 × 1.5 |
| **RESERVED_BUDGET_USD** | **$28.08** | every call of every run at ceiling |
| **MAX_THEORETICAL_EXPOSURE_USD** | **$84.24** | reserved × (1 + 2 SDK transport retries), only if every retried attempt were billed |
| PROVIDER_WORKSPACE_LIMIT_USD | null (UNVERIFIED) | owner must report it |
| APP_ENFORCED_STOP_THRESHOLD_USD | approved − $2.34 | no model run starts past it |
| Qloo | ≤ 602 calls, no published USD rate, quota UNVERIFIED | |

Enforcement: `pnpm eval:agent:live` and `pnpm perf:live-trace` exit **4** with no model or Qloo call unless `--approved-usd` covers the reserved exposure (gate) or one run's ceiling (parent). Each model run gets a `SpendBound` of one run's ceiling (never refuses a call the run's own limits allow); unknown usage and errored runs are charged at ceiling (fail closed). Verified: no approval → `LIVE_GATE_BLOCKED_BY_APPROVAL`; `--approved-usd 2.5` → `CEILING_BELOW_RESERVED_EXPOSURE`. Tests: `backend/tests/live-gate-budget.test.ts` (10). The in-memory guard is not a financial authority.

## 10. Railway Account Verification

| Item | Observed |
| --- | --- |
| User | Raul Mermans (owner) |
| Workspace | Raul Mermans's Projects `c0ab616f-9621-49ca-87d8-ca5c77e871da` |
| Plan | **HOBBY** (`subscriptionModel` USER); not upgraded |
| Projects before | 0 (re-verified) |
| Billing period | 2026-10-20 → 2026-11-20; $0.00 before deploy |
| Usage limits | soft **$5**, hard **$10** (pre-existing); Railway Agent hard **$5** |
| Regions offered | US West (Oregon, California), US East (Virginia), EU West (Amsterdam), Singapore |

## 11. Railway Cost Model

Verified at railway.com/pricing on 2026-10-24: Hobby $5/month including $5 usage; RAM $0.00000386/GB-s (≈ $10/GB-month); CPU $0.00000772/vCPU-s (≈ $20/vCPU-month); egress $0.05/GB; volume ≈ $0.15/GB-month. **Build pricing is not stated on the page** (not assumed free). Usage is metered on actual consumption, not the cap.

Projections (forecasts, not bills; before tax):

| Scenario | Assumption | Resource usage / month | Bill |
| --- | --- | --- | --- |
| A. Low-traffic private dev | idle 24/7 at observed 49 MB, < 0.01 vCPU | ≈ $0.49 RAM + ≈ $0.10 CPU + ~$0 egress ≈ **$0.6** | $5 minimum (inside included usage) |
| B. Frequent demos | A + 50 investigations; peak RAM per job **not measured**; assume ≤ 300 MB and 0.25 vCPU for 5 min each | ≈ $0.6 + ≈ $0.05 | $5 minimum |
| C. Continuous at cap | 1 GB and 0.5 vCPU saturated 24/7 (upper bound, not expected) | ≈ $10 + $10 = $20 | ≈ $20; the **$10 hard limit would stop the service** first |

Model (Anthropic) and Qloo are billed outside Railway: ≈ $0.017 Haiku per frontier investigation observed.

## 12. Hidden-Cost Audit

| # | Item | Finding |
| --- | --- | --- |
| 1 | Subscription minimum | $5/month Hobby (existing plan) |
| 2 | CPU metering | per second of use; idle < 0.01 vCPU |
| 3 | Idle memory | 49 MB (max 54 MB) on Railway |
| 4 | Egress | ≈ 0 MB after smoke; Qloo/Anthropic responses are ingress |
| 5 | Persistent storage | none (no volume) |
| 6 | Duplicate environments | one (`production`) |
| 7 | PR preview deploys | `prDeploys: false`, `botPrEnvironments: false` |
| 8 | Replicas | **found a default second replica in `europe-west4`** after scaling; removed → `us-east4-eqdc4a: 1` only |
| 9 | Deployment overlap | Railway default overlap on redeploy (brief two-container window); `overlapSeconds` unset |
| 10 | Health polling | Railway healthcheck only during deploy; the Dockerfile `HEALTHCHECK` is ignored by Railway; nothing external polls |
| 11 | Repeated restarts | `ON_FAILURE`, max 3 retries |
| 12 | Memory leaks | not observed in < 1 h; not tested under load |
| 13 | Telemetry | request logs only (pino); no tracing add-on enabled |
| 14 | Railway Agent tokens | not used; hard limit $5 |
| 15 | Custom networking | none; Railway-provided `*.up.railway.app` only |
| 16 | Tax/VAT | may apply on top; not computed |
| 17 | Anthropic spend | outside Railway; workspace limit UNVERIFIED |
| 18 | Qloo | outside Railway; no USD rate; quota UNVERIFIED |

## 13. Resource Sizing

Cap **0.5 vCPU / 1 GB** (provisional, kept). Observed idle 49–54 MB / < 0.01 vCPU on Railway; locally 44–51 MB idle, MCP subprocess initialize 0.7–4.9 s. **Peak memory during an investigation (agent + MCP child) was not measured on Railway** (a live run from Railway was not authorized; my local MCP-child memory sample was invalid and is discarded). Downsizing to 0.25 / 0.5 GB is therefore **not** justified yet.

## 14. Railway Project Configuration

| Item | Value |
| --- | --- |
| Project | `cultural-elasticity` `cf7fb87c-d2fe-4ae0-8cea-1e8dcd065298` |
| Environment | `production` `b6af0e24-636a-458e-b6b0-47aebc474464` (only one) |
| Service | `cultural-elasticity-api` `06b519c8-56a1-4e7d-99ea-358e03d69c16` |
| Region / replicas | `us-east4-eqdc4a` (Virginia), 1 |
| Limits | 0.5 vCPU, 1 GB, pid 1000 |
| Sleep | `sleepApplication: false` |
| Restart | ON_FAILURE, 3 |
| Healthcheck | `/health`, 120 s (deploy-time) |
| Build | `backend/Dockerfile` (`railway.json`) |
| Domain | `https://cultural-elasticity-api-production.up.railway.app` (Railway-provided, port 4000) |

Region choice: US East is next to Vercel's default Function region (iad1). Anthropic/Qloo latency from Railway was **not measured**; recorded as an assumption.

`railway.json` (Config as Code) is deprecated by Railway in favour of `.railway/railway.ts`; existing files work until 2026-12-01. Not migrated this sprint.

## 15. Backend Docker Deployment

- Source: exact commit `1315bbf44a5e1bc39f2665f0ead6111f2a540fab`, uploaded with `railway up` from a clean `git worktree` (no `.env`, no untracked files). The Railway GitHub App has **no access** to the private repo (`User does not have access to the repo`), so the service has no GitHub source; redeploys must repeat the worktree upload, or the owner grants the app access.
- Deployment `2e0628d5-b749-443f-a3fd-2f343db67e63`: **SUCCESS**.
- Image: `node:22-slim`, multi-stage, `pnpm --frozen-lockfile`, `pnpm deploy --prod`, non-root `node`, no baked secrets, 106 MB (local build). Node **v22.23.4** in the identical local image; not read inside the Railway container (`railway ssh` would need an SSH key added to the account — not authorized).
- Listening on `0.0.0.0:4000` (logs show container IP and loopback).
- `pnpm smoke:docker`: **DOCKER_SMOKE_PASS**, now including `MCP_HANDSHAKE_OK tools=10` (initialize + tools/list of the `qloo mcp` subprocess with `--network none`, proving no Qloo call).

## 16. Deployment Security

Remote smoke (`pnpm smoke:remote`, evidence `docs/sprint-8e/evidence/railway-remote-smoke.txt`): **22/22 PASS**, run twice (before and after restart).

- `/health` 200; `/ready` 503 `ADMISSIONS_PAUSED` with `providerConnectivity: not_verified_by_this_endpoint`, `agentCompetence: not_this_endpoint`.
- Jobs without auth or with a wrong `x-ce-internal-auth` → 401; client `x-ce-visitor` / `x-forwarded-for` do not authenticate.
- Authenticated job while paused → 503 (no provider call); baseline override → refused.
- `/api/agent/{query,interpret,analyze,follow-up,continue}` without auth → 404; job poll/cancel without auth → 401.
- `/ops/status` and `/ops/providers/probe` without operator token → 404; with token, status 200 and contains no secret.
- Development routes `/api/methodology/analyze`, `/api/analysis/ingredients` → 404 in public mode.
- Oversized body → 413 (server log `Request body is too large`).
- TLS via Railway edge. The URL is not treated as a secret.

## 17. Secrets and Permissions

Railway variables (names only): `ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID`, `QLOO_API_KEY`, `CE_INTERNAL_API_SECRET`, `CE_OPERATOR_TOKEN` (secrets, set via `--stdin`, never echoed); `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=4000`, `CE_PUBLIC_DEPLOYMENT=1`, `CE_ACCEPT_INVESTIGATIONS=0`, `CE_SPEND_BUDGET_USD=2.5`, `CE_INVESTIGATION_RESERVE_USD=1`, `CE_REPLICA_COUNT=1`, `QLOO_API_BASE_URL=https://hackathon.api.qloo.com`, `QLOO_CALL_SPACING_MS=7000`.

`CE_INTERNAL_API_SECRET` and `CE_OPERATOR_TOKEN` were freshly generated (32 random bytes each), kept only in a mode-600 scratch file, and are not in git, logs, or this document. Railway logs were scanned: neither value appears. `pnpm check:secrets`: 369 repo files + 19 browser bundle files, no leakage.

## 18. Vercel Integration

- New project `cultural-elasticity` `prj_AHQcMcLFwGUOpRmepvwcc89LyOYo` (team `raulmermans-projects`). `cultural-elasticity-feasibility` untouched.
- Settings: root `frontend`, framework Next.js, Node 22.x, Vercel Authentication `all_except_custom_domains`, Git fork protection on.
- Env (preview target only): `BACKEND_URL` = Railway origin; `CE_INTERNAL_API_SECRET` as **sensitive**. No `NEXT_PUBLIC_` variables.
- **Incident:** Vercel made each of three first deployments `target: production` (CLI default, CLI with `--target preview`, Git-ref API deployment from a non-production branch). The first two were aliased to **`cultural-elasticity.vercel.app`, which returned 200 publicly** (the per-deployment URL was SSO-protected). Each was removed within ~1 minute; the third was cancelled while initializing and never aliased. Exposure: the Living Atlas frontend only, without `BACKEND_URL` or the internal secret (production env is empty), job route 503; no backend or provider path. Alias verified 404 afterwards; project has 0 deployments.
- Git connection was made (owner choice) and then **disconnected**, because any push would auto-create another forced-production deployment.
- Builds succeeded on Vercel (both deployments reached READY): frontend builds on Vercel.
- **`VERCEL_INTEGRATION_NOT_VERIFIED`.** Getting a protected preview requires an owner decision: allow one non-aliased production deployment (`vercel deploy --prod --skip-domain`, SSO-protected, empty env) so later deployments can be true previews, or accept the production alias behind protection changes.

Substitute evidence (labelled **local Next server, not Vercel**): `next start` (production build) with `BACKEND_URL` = Railway: correct secret → backend 503 `admissions_paused` relayed (auth accepted, no paid call); wrong secret → 401; `/api/demo/recorded` → 200 with no backend call (route has no fetch).

## 19. Provider Smoke Tests

- Live Haiku + Qloo: the one approved parent run (local machine, §4). `LIVE_QLOO` and `LIVE_HAIKU` for that run only.
- From Railway: **no provider call** was made (`qlooTransportInitialized: false`). `/ops/providers/probe` (paid) was not invoked. `LIVE_PROVIDER_SMOKE_FROM_RAILWAY_NOT_RUN`.

## 20. End-to-End Tests

| Path | Status |
| --- | --- |
| Browser → Next (local) → Railway Fastify → admission | verified (paused 503 / 401) |
| Railway JobManager → AgentRuntime → Qloo/Haiku → Living Atlas | **not run** (needs admissions open + spend approval) |
| Browser E2E against synthetic job API | **16/16** |
| Vercel → Railway | **not verified** (no preview) |

## 21. CPU/RAM Metrics (Railway, `railway metrics`, last 1 h)

CPU current 0, avg < 0.01, max 0.01 vCPU (limit 0.5). Memory current 49 MB, max 54 MB (limit 1024 MB). Egress max 0.01 MB, ingress 0.02 MB. Disk 0. HTTP 42 requests: 2xx 4, 4xx 32, 5xx 6 (all deliberate 503 `ADMISSIONS_PAUSED`), p50 3 ms, p99 8 ms. Measurement points C (harness init) and D/E (synthetic/live investigation) on Railway: **not measured**.

## 22. Real and Projected Costs

| Item | Observed |
| --- | --- |
| Railway billing-cycle usage | **$0.00016** (memory $0.00015, CPU $0.000008, egress $0.0000014); estimated bill $0.0003 + plan minimum |
| Anthropic | $0.0172 (live parent; provider-reported usage × list price) |
| Qloo | 32 calls (live parent); no USD rate |
| Vercel | Hobby; three short builds |

Projection: §11 scenario A/B — inside the $5 Hobby inclusion.

## 23. Spending Limits

| Layer | Control | Status |
| --- | --- | --- |
| 1 Per investigation | runtime `SpendBound` (reserve $1 in the deployed backend; $2.34 in evals) | active |
| 2 Admission / concurrency | `CE_ACCEPT_INVESTIGATIONS=0`; 2 running / 4 queued defaults | active, paused |
| 3 User/allowlist | internal-auth only; no per-user allowlist | **NOT_CONFIGURED** (needed before private live use) |
| 4 Railway workspace | soft $5 / hard $10 (pre-existing) | **verified** |
| 5 Anthropic workspace | unknown | **UNVERIFIED** |
| 6 Qloo | spacing 7000 ms, 32-call run budget | quota UNVERIFIED |

At the Railway hard limit, Railway stops **all** workloads in the workspace. Recommendation kept as-is: the workspace only contains this project, so $10 hard / $5 soft is already the brief's proposal (soft could be $7.50; not changed without approval). The in-memory spend ledger is not a durable financial authority.

## 24. Restart and Recovery

Verified restart: graceful `SIGTERM` logged ("shutting down"), new `bootId` (`f7df442d…` → `81fe7505…`), ready in ≈ 1.5 s, back to `ADMISSIONS_PAUSED`. In-memory jobs, run store and spend ledger are lost on any restart/redeploy/crash; this is **not durable execution**.

Runbook:

1. **Disable investigations:** `railway variable set --service cultural-elasticity-api CE_ACCEPT_INVESTIGATIONS=0` (redeploys; in-flight jobs are interrupted).
2. **Recorded demo** stays available from the frontend; it never calls the backend.
3. **Restart:** `railway service restart --service cultural-elasticity-api --yes`. **Redeploy:** from a clean worktree at the reviewed SHA, `railway up --service cultural-elasticity-api --ci`.
4. **Lost jobs:** compare `bootId` before/after; any job id from an earlier boot is gone (poll → 404).
5. **Provider usage:** Anthropic console and Qloo dashboard (outside Railway); `/ops/status` with operator token shows in-process spend since boot only.
6. **No blind retries** of paid calls after an uncertain failure.
7. **Teardown (stop all Railway cost):** `railway down` or delete the service in the dashboard.

## 25. Hackathon Demo

Judge journey (90-second outline):

1. (0–10 s) Open the Living Atlas: "How far can a brand stretch before it stops feeling like itself?"
2. (10–25 s) Ask "Where could Jacquemus expand?" — show the recorded example (labelled `RECORDED_EXAMPLE`, zero provider calls).
3. (25–45 s) Walk the Atlas: edges are investigation lineage, not distance or score.
4. (45–60 s) Open a territory's evidence inspector: Qloo tags, members, correlation ids.
5. (60–70 s) Explain PARTIAL vs FULL and why an honest PARTIAL beats a misleading FULL.
6. (70–80 s) Narrow into one territory (follow-up child investigation).
7. (80–90 s) Why agentic: the agent chooses what to investigate, the runtime refuses ungrounded probes, deterministic code owns every number — unlike an LLM suggestion list.

Live demo status: recorded journey ready; live investigations through the hosted stack not enabled.

## 26. Submission Readiness

| Item | Status |
| --- | --- |
| Concise description | README header |
| Architecture overview | `docs/architecture.md` |
| Methodology explanation | `docs/methodology/` |
| Live execution evidence | §4 + `docs/sprint-8e/evidence/` |
| Recorded journey / 90 s outline | §25 |
| README onboarding, run instructions, `.env.example` | present |
| Limitations | §28 |
| Official hackathon requirements | **NOT_REVIEWED** this sprint (no source available to me); owner must check before submitting |
| Public repo / license change | not done (needs owner approval) |
| Submitted | **no** |

## 27. All Test Results

| Command | Result |
| --- | --- |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS (after removing iCloud `.next/* 2.*` duplicates in generated output) |
| `pnpm test` | backend 59 files / **747** tests PASS; frontend **14/14** |
| `pnpm build` | PASS |
| `pnpm check:secrets` | PASS, 369 repo + 19 bundle files |
| `pnpm eval:methodology` | 19/19, `LIVE_QLOO_VALIDATION_NOT_RUN` |
| `pnpm eval:agent` | 53/53, evaluator failures 0, leakage 0, `LIVE_AGENT_MODEL_VALIDATION_NOT_RUN` |
| `pnpm eval:elasticity` | structural 27/27; index **REJECTED_FOR_NOW** |
| `pnpm eval:live` | 19/19 live-fixture + 3/3 recorded (offline) |
| `pnpm eval:query` | offline targets PASS; HELD_OUT 24/24, hash `ad051836dac7`; X06 for review (unchanged); `LIVE_HAIKU_QUERY_VALIDATION_NOT_RUN` |
| `pnpm perf:agent` | move 120 / compare 241 / frontier 7 ms (synthetic) |
| `pnpm test:e2e` | **16/16** |
| `pnpm smoke:offline` | OFFLINE_SMOKE_PASS |
| `pnpm smoke:docker` | DOCKER_SMOKE_PASS + MCP_HANDSHAKE_OK |
| `pnpm smoke:remote` | 22/22 (Railway, twice) |
| `pnpm eval:agent:budget` | `LIVE_GATE_BLOCKED_BY_APPROVAL` (exit 2, by design) |
| `pnpm perf:live-trace -- --approved-usd 2.34` | LIVE run `30de49f7`, §4 |
| `pnpm eval:agent:live` | **NOT RUN** (refused without approval, exit 4 verified) |
| `pnpm eval:query -- --live`, `pnpm feasibility:qloo` | NOT RUN |

## 28. Risks and Limitations

- Live research evidence is a single run; variance not controlled; 8C trace not persisted, so no decision replay.
- Frontier runs exhaust the 32-call budget; FULL requires references the budget did not reach. Budgets unchanged by rule.
- In-memory jobs/spend: restarts lose state; one replica only.
- Railway source is a CLI upload, not GitHub (app lacks repo access).
- Investigation peak memory on Railway unmeasured; cap not right-sized.
- Anthropic workspace limit and Qloo quota unverified.
- No per-user allowlist for private live use.
- `railway.json` deprecation deadline 2026-12-01.
- Vercel first-deployment behaviour blocks a preview-only start.

## 29. Remaining Release Blockers

1. Full live readiness gate (needs ≥ $28.08 approved ceiling, ~2–3 h): `AGENT_MODEL_NOT_READY`.
2. Vercel preview (owner decision on a non-aliased first production deployment).
3. Live investigation from Railway (admissions on + spend approval) and its CPU/RAM peak.
4. Per-user allowlist + Anthropic workspace limit verification before any private live access.
5. Official hackathon requirements review and submission.

## 30. Recommended Next Sprint

Do not start automatically. If approved: (1) run the frozen gate with `--approved-usd ≥ 28.08` and an owner-reported Anthropic workspace limit; (2) unlock a protected Vercel preview and run one authorized live investigation Browser → Vercel → Railway → Living Atlas, measuring Railway peak RAM/CPU; (3) only then consider right-sizing and a private-live allowlist. Durable persistence only if public live access is required.
