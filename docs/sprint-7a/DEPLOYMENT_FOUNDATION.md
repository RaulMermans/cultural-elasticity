# Sprint 7A — Deployment foundation and competitive demo

Prepare the existing Living Atlas for a reliable public showcase. This sprint does not publish the product. External hosts, paid plans, DNS and credential updates need owner approval.

## 1. Executive Outcome

| Gate | Decision |
| --- | --- |
| Engineering | **ENGINEERING_COMPLETE.** Lint, typecheck, 631 backend + 13 frontend tests, build, secrets, offline evals, 16/16 browser E2E. |
| Deployment | **DEPLOYMENT_READY** for a single-replica persistent container. Docker image boots, `/health` lives, `/ready` distinguishes admission, harness `--help` and `exec --help` launch inside the image (`HARNESS_STARTS`). **Not published.** Railway/Vercel/Render activation needs owner approval. |
| Public safety | **PUBLIC_SAFETY_READY** for a one-process showcase: internal auth, visitor admission, closed sync routes, reservation spend, fail-closed public config. In-memory spend is not durable; Anthropic workspace limits are the backstop. |
| Demo | **DEMO_READY.** Recorded example rebuilt from the verified 23 October 2026 live parent/child artifact. Labelled `RECORDED_EXAMPLE`. Opens without provider calls. |
| Agent competence | Unchanged: **`AGENT_MODEL_NOT_READY`**. |

## 2. Starting Repository State

Branch `sprint/7a-deployment-foundation`, cut from `sprint/5b3-living-atlas-product-quality` at `0677762` (Sprint 5B.3). The worktree was clean. Sprint 5B.3 was already committed; no checkpoint was required. Local interactive Node was 20; CI and this sprint use Node 22.19+ and pnpm 10.26.0.

## 3. Architecture Decision

**Option A (chosen):** Next.js Living Atlas on a frontend host (Vercel or equivalent). Fastify + `JobManager` on a persistent container service.

The browser talks only to Next.js. Next.js proxies jobs to Fastify with a shared internal secret and a privacy-conscious visitor cookie. Fastify never trusts `X-Forwarded-For`. The Qloo harness stays a backend subprocess. Haiku 5.5, `ce-query/0.1` and `ce-agent-result/0.3` are unchanged.

## 4. Hosting Alternatives

| Option | Fit | Rejected because |
| --- | --- | --- |
| A. Vercel frontend + persistent container backend | Matches the 20-minute in-process job, Node 22, subprocess harness, separate origins | — |
| B. Frontend and backend on one container platform | Works as a fallback if Vercel is unavailable | More operational coupling; Next.js still must not become the agent runtime |
| C. Single VM | Compatible | Highest operator burden for the hackathon |

Ordinary serverless functions (Vercel Functions, typical lambdas) are **not** a valid backend host. They freeze after the HTTP response. `JobManager` requires a live process. Official Railway and Render docs describe always-running containers with health checks and SIGTERM. That is the requirement.

## 5. Chosen Hosting Architecture

**Primary:** Railway Web Service from `backend/Dockerfile` (repo-root `railway.json`), one replica. Frontend on Vercel, `BACKEND_URL` and `CE_INTERNAL_API_SECRET` server-only.

**Fallback:** Render Docker web service (`deploy/render.yaml`), `numInstances: 1`, `healthCheckPath: /health`, `maxShutdownDelaySeconds: 45`.

Expected hosting cost if the owner later activates it (estimates, not invoices): Railway Hobby or Render Starter in the low tens of USD per month for one small container, plus Vercel Hobby for the frontend. Model and Qloo usage are separate.

## 6. Docker Verification

Build from the monorepo root. The image is Node 22 slim, non-root `node`, `HOST=0.0.0.0`, no baked secrets, healthcheck hits `/health` only. `pnpm deploy --prod` includes `@qloo/qloo-harness`.

```sh
docker build -f backend/Dockerfile -t cultural-elasticity-api .
bash scripts/smoke-docker.sh
```

Verified locally on 23 October 2026 against Colima Docker 29.5.2: image `cultural-elasticity-api:smoke` (`sha256:47656b45…`), `GET /health` ok, `GET /ready` 503 `ADMISSIONS_PAUSED`, unauthenticated `POST /api/agent/jobs` 401, then `HARNESS_STARTS` for `qloo --help` and `qloo exec --help`. That is not `QLOO_CONNECTIVITY_WORKS` and not `LIVE_INVESTIGATION_COMPLETES`.

## 7. Qloo Harness Compatibility

The official hackathon host remains `https://hackathon.api.qloo.com`. `requireHackathonBaseUrl` still fails closed. Public processes refuse `QLOO_CALL_SPACING_MS` below 7000. The harness child still receives an isolated environment and never inherits Anthropic keys. Both `qloo mcp` (default) and `qloo exec` remain supported transports.

## 8. Frontend/Backend Networking

`BACKEND_URL` is server-only. In `NODE_ENV=production` there is no localhost default. The browser calls `/api/agent/jobs` and `/api/demo/recorded` only. Job create stays a short 202. Long work stays in Fastify. The recorded module is static and does not call a provider.

## 9. Reverse-Proxy Trust

Fastify `trustProxy` is **false**. `request.ip` is not an admission key. `X-Forwarded-For`, `X-Real-IP` and `Forwarded` are ignored. After a valid `x-ce-internal-auth` header, admission uses `x-ce-visitor` when it matches `[A-Za-z0-9_-]{16,64}`. Otherwise the visitor is `unattributed` (stricter shared bucket).

## 10. Public Access Boundaries

The backend is assumed publicly reachable. Direct expensive routes without the internal secret return 401. Next.js sets an HttpOnly `ce_visitor` cookie and forwards it. That cookie is an admission key, not an account. `/health` stays open. `/ops/status` requires `CE_OPERATOR_TOKEN` or it 404s.

## 11. Request and Cost Governance

Request-count limits remain (public default 24 creates / 10 minutes per visitor, global 4×). They are no longer the only ceiling.

Spend control (`backend/src/ops/spend.ts`) reserves a conservative Haiku maximum before a job starts, refuses when the remaining `CE_SPEND_BUDGET_USD` cannot cover it, then reconciles observed interpretation + model USD. Missing provider usage consumes the full reserve. Pricing is central (`backend/src/ops/pricing.ts`), dated **2026-10-07**, from Anthropic’s published Haiku 5.5 list prices. These figures are not invoices. Qloo hackathon calls have no published USD rate; they stay unit-capped, with Anthropic workspace limits as the durable backstop.

The ledger is **in-memory and single-process**. It is not durable and not multi-instance safe. Public deployment must run one backend replica.

## 12. Job Lifecycle

Still in-process: 2 running, 4 queued, 20-minute cap, 30-minute readable TTL. Tokens stay sha256 + timingSafeEqual. Cancel 60/minute per visitor. Queue saturation still 429 `too_many_investigations`.

## 13. Restart Semantics

`SIGTERM`/`SIGINT` pause admissions, abort running and queued jobs with `BACKEND_RESTART`, and close the server. Finished results are not persisted. Clients already treat a missing job as unresumable. A timeout keeps a prepared `QueryResponse` when one exists and says a time limit is not evidence against a territory. An unexpected process death looks like a 404 / recovery state, not an unsupported cultural opportunity.

## 14. Environment Configuration

See `deploy/env.public.example` and `.env.example`. Public startup (`assertPublicRuntimeSafe`) requires internal auth (≥32 chars), a numeric spend budget, both provider keys, the hackathon origin, and safe Qloo spacing. Invalid production config exits before listen.

## 15. Secrets

`QLOO_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID`, `CE_INTERNAL_API_SECRET` and `CE_OPERATOR_TOKEN` stay off `NEXT_PUBLIC_*`, responses, the recorded artifact, Docker layers and logs (Fastify redact paths include the new headers). `pnpm check:secrets` remains the leak gate.

## 16. Health and Readiness

| Route | Meaning |
| --- | --- |
| `GET /health` | Liveness. `{ status: "ok", service: "cultural-elasticity-api" }`. |
| `GET /ready` | Can this process accept a new investigation? 503 with reason codes if not. |
| `GET /ops/status` | Operator snapshot: spend, metrics, job counts, boot id. |

No health path calls Qloo. None of these claim `AGENT_MODEL_READY`.

## 17. Observability

In-process counters: job accepted/queued/started/completed/failed/cancelled/expired, admission rejected, budget exceeded, backend restart, result unavailable, plus duration, interpretation latency, Qloo calls, tokens and estimated model USD. Access tokens and prompts are not logged.

## 18. Operator Controls

| Control | How |
| --- | --- |
| Stop new investigations | `CE_ACCEPT_INVESTIGATIONS=0` and restart, or deploy that value |
| Inspect health | `GET /health`, `GET /ready` |
| Inspect spend and queue | `GET /ops/status` with `x-ce-operator` |
| Rollback | Redeploy the previous Railway/Vercel deployment; see §26 |

No admin dashboard.

## 19. Recorded Demo Provenance

Rebuilt with `backend/scripts/demo/build-recorded-example.ts` from the gitignored live artifact `backend/feasibility-output/sprint5b3-living-atlas/parent-child.json`.

| Field | Value |
| --- | --- |
| Recorded at | 2026-10-23T06:28:19.052Z |
| Origin | live Qloo, `claude-haiku-5-5` |
| Source SHA-256 | `064c7f6e87692a45cc5790cf4901b879dd75d8ecbb0b72ad2aee0a76e41d3f75` |
| Parent | `75e24386-3071-4798-a62a-544d2bd6734f` · Jacquemus · 32 Qloo calls · `INVESTIGATION_INCOMPLETE` |
| Parent territories | Art and culture, Bohemian lifestyle, Avant-garde experimental fashion: `FULL_RELATIVE_ANALYSIS`. Japanese drama: `UNSUPPORTED` |
| Child | `b75fa354-116e-4c68-83c9-09072c2054a1` · design-led boutique hospitality · `PARTIAL_EVIDENCE` / `PARTIAL_CULTURAL_ANALYSIS` · 19 Qloo calls |

The parent run is **not** presented as a complete investigation. PARTIAL stays PARTIAL. The Jacquemus name appears in the artifact because it was the live question. It is not product routing.

## 20. Demo User Journey

1. Open the Living Atlas. The lede states that this is a cultural investigation environment.
2. Open the recorded investigation. No Haiku or Qloo call.
3. See a frontier with supported, unsupported and (on the child) partial territories.
4. Select a territory. Inspect evidence and limitations.
5. Follow the child branch. Return is local focus.
6. Ask a new live question in the composer when ready.

The banner remains `Recorded example`.

## 21. Live Investigation Latency Analysis

Measured from the 5B.3 live artifact (not estimates):

| Stage | Parent | Child |
| --- | --- | --- |
| Wall time | 810 s | 160 s |
| Model | 62 s | 43 s |
| Qloo (includes spacing) | 119 s (spacing 95 s) | 98 s (spacing 86 s) |
| Analysis | 21 s | 5 s |
| Synthesis | 36 s | 19 s |
| Reported model USD | $0.0207 | $0.0129 |
| Qloo calls | 32 | 19 |

The parent approached 14 minutes. The remainder of wall time is not a client-polling problem (1.5 s). Mandatory 7 s Qloo spacing is preserved. No frontier redesign was done. The bounded repair in this sprint is timeout honesty: a time limit keeps prepared findings and does not mark a territory unsupported.

Interactive latency is **not** solved. Job acceptance is still prompt (202). Live investigations can still approach the 20-minute cap.

## 22. Production-Like Validation

Offline: `pnpm smoke:offline` → `OFFLINE_SMOKE_PASS`. Container: `pnpm smoke:docker` → `DOCKER_SMOKE_PASS` plus `HARNESS_STARTS` on the same image (no paid calls). Public admission, spend, proxy spoofing and recorded provenance are unit-tested in `backend/tests/sprint-7a.test.ts`. Browser journeys: `pnpm test:e2e` 16/16 against the SYNTHETIC job API. Unit suite: 631 backend + 13 frontend.

## 23. Security Tests

Covered: forged forwarded headers, direct backend access, per-visitor and global limits, queue saturation, missing/exhausted budget, missing public config, baseline and legacy routes, invalid tokens, expiry, cancellation, restart-loss, operator 404, secret-pattern checks on the recorded artifact.

## 24. Smoke Tests

| Suite | Command | Providers |
| --- | --- | --- |
| Offline | `pnpm smoke:offline` | none |
| Docker | `pnpm smoke:docker` | none |
| Browser | `pnpm test:e2e` | SYNTHETIC |
| Live Qloo/Haiku | owner-authorized only | paid |

## 25. Deployment Runbook

**Owner actions are marked.** Do not perform them in this sprint.

1. **Owner:** create a Railway project and one service. Confirm a paid plan if required.
2. Point the service at this repository. `railway.json` selects `backend/Dockerfile` and `/health`.
3. **Owner:** set backend secrets from `deploy/env.public.example`. Generate `CE_INTERNAL_API_SECRET` and `CE_OPERATOR_TOKEN` (≥32 chars). Do not paste them into git.
4. Confirm `num replicas = 1`. Do not autoscale this service.
5. Confirm outbound access to `hackathon.api.qloo.com` and `api.anthropic.com`.
6. **Owner:** create a Vercel project for `frontend/`. Set server env `BACKEND_URL` to the Railway HTTPS origin and the same `CE_INTERNAL_API_SECRET`. No `NEXT_PUBLIC_*` secrets.
7. `GET https://<backend>/health` → `{"status":"ok","service":"cultural-elasticity-api"}`.
8. `GET https://<backend>/ready` → 200 only when admissions and budget allow.
9. `pnpm smoke:offline`. Optionally `pnpm smoke:docker` before the first push.
10. Open the frontend. Open the recorded investigation. Confirm no provider logs.
11. **Owner:** one bounded live question only after smoke and budget review.
12. Confirm a second visitor cannot exhaust the first visitor’s per-key limit, and that a direct backend POST without the secret is 401.
13. To suspend creation: set `CE_ACCEPT_INVESTIGATIONS=0` and redeploy the backend.

## 26. Rollback Runbook

1. Railway: redeploy the previous successful deployment. In-memory jobs on the outgoing process are lost.
2. Vercel: revert the frontend deployment. The recorded module is static; a frontend rollback does not restore backend jobs.
3. If spend or auth is wrong, set `CE_ACCEPT_INVESTIGATIONS=0` first.
4. There is no durable job replay.

## 27. Release Readiness

Independent of agent competence. A limited public showcase can be considered once the owner activates hosts and secrets. In-memory jobs, one replica, and `AGENT_MODEL_NOT_READY` stay explicit.

## 28. Agent Readiness Limitations

The Sprint 5A.2 gate remains **`AGENT_MODEL_NOT_READY`**. This sprint does not rerun `pnpm eval:agent:live -- --arms baseline,model --stability 3` unless authorized. Offline `pnpm eval:agent` is not live-model evidence.

## 29. Known Risks

- One process: restart drops jobs, lineage and confirmations.
- In-memory spend is not a bill.
- Anonymous visitor cookies can be cleared; that creates a new admission key.
- Live investigations can still take ~15–20 minutes.
- Agent competence is not ready.
- Hackathon Qloo quota is a provider-side limit, not a dollar ledger.

## 30. Sprint 6 Compatibility

Yes. Competitor comparison can later become a new executable intent behind the same gate, jobs, admission and spend controls. Do not start Sprint 6 from this document.

## 31. Final Submission Requirements

Still needed for a credible public submission, after owner approval: activate the hosts, load real secrets, run the container smoke on the chosen platform, one bounded live investigation, and an honest limitation note that the agent competence gate is red.
