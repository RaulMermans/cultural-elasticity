# Sprint 7B — Controlled public launch

Release engineering only. Architecture, methodology, Haiku 5.5, `ce-query/0.1` and `ce-agent-result/0.3` are unchanged. This document is the canonical deployment runbook. Sprint 7A remains the foundation record; spend, visitor identity and readiness semantics here supersede the 7A defects.

This sprint does **not** publish a public URL. Owner actions are marked **Owner**.

## 1. Executive Outcome

| Gate | Decision |
| --- | --- |
| Engineering | **ENGINEERING_COMPLETE.** Node 22.23.2 / pnpm 10.26.0. Lint, typecheck, 648 backend + 14 frontend tests, build, secrets, offline evals, 16/16 E2E, `OFFLINE_SMOKE_PASS`, `DOCKER_SMOKE_PASS` + `HARNESS_STARTS`. |
| Production config | **PRODUCTION_CONFIG_READY** for a single-replica public process. Fail-closed checks include internal auth, budget, reserve floor, replica count, provider keys and hackathon origin. |
| Public safety | **PUBLIC_SAFETY_READY** for a one-process showcase: observed spend never truncated, concurrent reservation cannot oversubscribe remaining budget, one visitor identity per request, Fastify `trustProxy` false, sync expensive routes closed, operator surface 404 without token. In-memory spend is **not** durable. |
| Deployment | **DEPLOYMENT_VERIFIED = NOT_VERIFIED.** Local Docker and HTTP tests are not a public Railway/Vercel deployment. No host was created or published. |
| Live providers | **LIVE_QLOO_SMOKE_NOT_RUN / LIVE_HAIKU_SMOKE_NOT_RUN / LIVE_END_TO_END_NOT_RUN.** Local `backend/.env` is not authorization to spend or to publish. |
| Demo | **DEMO_READY.** Recorded example SHA-256 `064c7f6e87692a45cc5790cf4901b879dd75d8ecbb0b72ad2aee0a76e41d3f75`, parent `INVESTIGATION_INCOMPLETE`. |
| Agent competence | Unchanged: **`AGENT_MODEL_NOT_READY`.** Offline `eval:agent` PASS is not live-model evidence. Elasticity index remains **REJECTED_FOR_NOW**. |

Do not collapse these gates.

## 2. Starting State

- Previous checkpoint: `sprint/7a-deployment-foundation` at `be5077c` — *Sprint 7A: deployment foundation, spend controls, and recorded demo.*
- Worktree at 7A HEAD was clean. No checkpoint was required.
- This sprint branch: `sprint/7b-controlled-public-launch`.
- Runtime: Node `>=22.19.0`, pnpm `10.26.0`. Local interactive Node 20 is unsupported; verification uses Node 22.
- Local `backend/.env` may contain provider keys. Those values are never copied into docs, logs or fixtures.

## 3. Sprint 7A Defects Confirmed

Reproduced before fixing.

**A. Spend undercounting.** `SpendLedger.settle` used `Math.min(reserved, observed)`. Reserved `$0.50`, observed `$0.80` became recorded `$0.50`. Confirmed in the 7A ledger.

**B. Visitor identity inconsistency.** Next.js `visitorIdOf` and `withVisitor` each called `visitorFromRequest`, which minted a new id when the cookie was missing. Admission and `Set-Cookie` could disagree on the first request.

**C. Readiness ambiguity.** `GET /ready` checked credentials and admission. `qlooTransportInitialized` was always `false`, but a 200 ready response could be read as “Qloo/Haiku work.” Harness `--help` is `HARNESS_STARTS`, not connectivity.

## 4. Spend Accounting Repair

`backend/src/ops/spend.ts` and `backend/src/ops/pricing.ts`.

| Field | Meaning |
| --- | --- |
| `reservedUsd` | Conservative hold at job create (public floor ≥ `$0.50`, Haiku >100K-tier envelope). |
| `observedUsd` | Actual priced usage written down. **Never truncated to the reservation.** |
| `consumedUsd` | What remaining budget subtracts after settle. Equals observed when known; equals reserved when usage is missing. |
| `overageUsd` | `max(0, observed − reserved)`. |
| `chargedOrEstimatedUsd` | Alias of consumed (includes conservative missing-usage charges). |
| `unknownUsageReserveUsd` | Consumed amount from missing provider usage. |
| `remainingBudgetUsd` | `configured − outstanding`. Outstanding uses `max(reserved, observed)` for in-flight holds. |
| `durable` / `multiInstanceSafe` | Always `false`. |

Invariants:

1. Observed expense is never discarded.
2. Cancel before start releases `$0`. Cancel after start reconciles `recordProgress`.
3. Missing usage charges the full reserve (`provider_usage_missing`).
4. Concurrent `reserve()` cannot oversubscribe remaining budget; an in-flight overage blocks the next job.
5. Exhaustion returns `budget_exhausted` and stops new expensive jobs.
6. Public `CE_INVESTIGATION_RESERVE_USD < 0.5` is `RESERVE_TOO_LOW` at startup.
7. Snapshot distinguishes observed vs estimated vs unknown.
8. Anthropic workspace limits remain the durable backstop.
9. Restart resets the ledger. That is not restored billing history.
10. Public mode without `CE_SPEND_BUDGET_USD` fails closed.

Pricing dated **2026-10-07** from Anthropic list prices. Not invoices. Qloo hackathon calls have no published USD rate; they stay unit-capped.

## 5. Runtime Cost Boundaries

A reservation at create is not enough if a live run can exceed it.

- `QueryService` refuses interpretation when `authorizeNextCall(interpretCeilingUsd())` is false.
- `AgentRuntime` refuses the next decision call on the same bound, finishes with `BUDGET_EXHAUSTED` + `SPEND_LIMIT_REACHED`, and keeps already supported findings.
- Synthesis is skipped (`finalize({ skipSynthesis })`) when the synthesis ceiling does not fit; the deterministic template is used. No invented evidence.
- Ceilings use the conservative Haiku >100K tier, estimated input tokens and max output tokens (`16_000` decision/synthesis, `4_000` interpret).

**Limitation:** provider usage is known after a call completes. A call that was authorized on its ceiling can still overshoot. Overage is recorded. This is **not** a zero-overage guarantee.

## 6. Visitor Identity Repair

`frontend/src/lib/visitor.ts` keeps a `WeakMap<Request, identity>`. One request yields one id for admission (`visitorIdOf`) and `Set-Cookie` (`withVisitor`).

Verified paths:

- First visit, no cookie: one minted id, cookie matches admission.
- Returning visitor: existing cookie reused, no new `Set-Cookie`.
- Malformed cookie: treated as missing; one new id.
- Parallel requests: each `Request` object has its own identity; that is correct.
- Direct backend: Fastify does not mint cookies. After valid internal auth it uses `x-ce-visitor` or the shared `unattributed` bucket.
- Forged `X-Forwarded-For`: ignored (`trustProxy: false`). Direct job create without internal auth is 401.

The cookie is an admission key, not authentication. Internal secret, visitor admission and job capability tokens stay separate.

## 7. Readiness Semantics

Four different conditions:

| Condition | Where | Meaning |
| --- | --- | --- |
| Liveness | `GET /health` | Process responds. |
| Admission | `GET /ready` | Configured and can accept a job. 503 with reason codes otherwise. |
| Provider connectivity | Operator cache / `POST /ops/providers/probe` | A real bounded Qloo or Haiku call succeeded in this process, with timestamp and 10-minute TTL. |
| Agent competence | `agent-readiness-gate-v3` | Methodology and research-quality evaluations. Unchanged: `AGENT_MODEL_NOT_READY`. |

`/ready.semantics.providerConnectivity` is always `not_verified_by_this_endpoint`. `qlooTransportInitialized` is always `false` on that route. A harness binary that starts is not connectivity. Health and ready never call paid providers.

## 8. Hosting Architecture

Re-verified against official docs on 23 October 2026.

**Primary**

- Frontend: Vercel, Next.js app, root `frontend/`. `BACKEND_URL` and `CE_INTERNAL_API_SECRET` are server-only. Do not prefix them `NEXT_PUBLIC_`. [Next.js env docs](https://nextjs.org/docs/app/guides/environment-variables).
- Backend: Railway Web Service from `backend/Dockerfile` via `railway.json`. Persistent container. Listen on `0.0.0.0` and `PORT`. Healthcheck path `/health` is **deploy-time 2xx only**, not continuous monitoring. [Railway healthchecks](https://docs.railway.com/deployments/healthchecks), [Dockerfiles](https://docs.railway.com/builds/dockerfiles).
- Replica count: **1**. Jobs and spend are in-memory. Do not autoscale. Do not attach a volume to enable replicas; volumes cannot be used with replicas anyway. `CE_REPLICA_COUNT` other than `1` fails closed. `railway.json` does not pin a region; the owner sets replica count in the dashboard. Do not invent a region in config-as-code.

**Fallback:** Render Docker web (`deploy/render.yaml`): `numInstances: 1`, `healthCheckPath: /health`, `maxShutdownDelaySeconds: 45` (allowed 1–300). [Blueprint spec](https://render.com/docs/blueprint-spec).

**Rejected for JobManager:** Vercel Functions / ordinary serverless freeze-after-response.

Cost estimate (not an invoice): one small persistent container on Railway Hobby or Render Starter in the low tens of USD per month, plus Vercel Hobby for the frontend. Model and Qloo usage are separate.

## 9. Docker Validation

Build from the repository root:

```sh
docker build -f backend/Dockerfile -t cultural-elasticity-api .
bash scripts/smoke-docker.sh
```

Image: Node 22 slim, `pnpm deploy --prod` including `@qloo/qloo-harness`, non-root `node`, `HOST=0.0.0.0`, no baked secrets, healthcheck hits `/health` only.

Verified in this sprint on 23 October 2026: `pnpm smoke:docker` → image `cultural-elasticity-api:smoke` (`sha256:a138a4a4…`), `HARNESS_STARTS`, `DOCKER_SMOKE_PASS`. Transient `curl: (52)` during the boot wait is not a failed smoke; `/health` succeeded afterwards.

Smoke proves:

- `GET /health` ok
- `GET /ready` 503 `ADMISSIONS_PAUSED` when `CE_ACCEPT_INVESTIGATIONS=0`
- unauthenticated `POST /api/agent/jobs` 401
- `HARNESS_STARTS` (`qloo --help` and `qloo exec --help`)

That is **not** `QLOO_CONNECTIVITY_WORKS` and **not** `LIVE_AGENT_INVESTIGATION_COMPLETES`.

## 10. Frontend/Backend Security

```
Browser → Next.js route handler → x-ce-internal-auth + x-ce-visitor → Fastify → JobManager
```

- Job create returns 202 promptly. Work continues in Fastify.
- Production Next.js has no localhost `BACKEND_URL` default.
- Job tokens: `x-job-token`, sha256 + timingSafeEqual. Wrong token → 404 `job_not_found`, not a cultural finding.
- Baseline / debug / sync analyze routes stay closed in public mode.
- No provider secrets in the browser bundle. Recorded demo route does not call Qloo or Haiku.

## 11. Production Configuration

Audit (`deploy/env.public.example`, `.env.example`):

`CE_PUBLIC_DEPLOYMENT`, `CE_ACCEPT_INVESTIGATIONS`, `CE_INTERNAL_API_SECRET` (≥32), `CE_OPERATOR_TOKEN`, `CE_SPEND_BUDGET_USD`, `CE_INVESTIGATION_RESERVE_USD` (≥0.5 public), `CE_REPLICA_COUNT=1`, `ANTHROPIC_API_KEY`, `QLOO_API_KEY`, `ANTHROPIC_WORKSPACE_ID` (optional), `BACKEND_URL` (frontend, server-only), `QLOO_API_BASE_URL=https://hackathon.api.qloo.com`, `PORT`, `HOST=0.0.0.0`, `QLOO_CALL_SPACING_MS≥7000`.

`assertPublicRuntimeSafe` exits before listen on `PUBLIC_RUNTIME_UNSAFE`. Issue codes never include secret values.

## 12. Job Lifecycle

Unchanged defaults: **2** running, **4** queued, **20-minute** run cap, **30-minute** readable TTL.

Restart: `SIGTERM`/`SIGINT` record `backend_shutdown`, pause admissions, abort jobs with `BACKEND_RESTART`, close the server. In-memory jobs are gone. A later GET is `job_not_found` / recovery copy, not “unsupported territory.” Parent context the process no longer holds is `CONTEXT_UNAVAILABLE`, never reconstructed.

## 13. Provider Connectivity

| Claim | What it is |
| --- | --- |
| `HARNESS_STARTS` | Binary launches `--help` in the image. |
| Operator probe | One-shot `find_tags` (limit 1) and a 1-token Haiku ping. Cached 10 minutes. Registered from `index.ts` only so unit tests never pay. |
| `QLOO_CONNECTIVITY_WORKS` | A real hackathon-host answer in that probe or an authorized smoke. |
| `LIVE_AGENT_INVESTIGATION_COMPLETES` | One bounded job through the public path. Not inferred from the others. |

`POST /ops/providers/probe` requires `x-ce-operator`. Without `CE_OPERATOR_TOKEN` the route 404s.

## 14. Latency Breakdown

Sprint 5B.3 live parent (recorded example source), not estimates:

| Clock | Parent |
| --- | --- |
| Wall | 810 s |
| Model | 62 s |
| Qloo including spacing | 119 s (spacing 95 s, active 24 s) |
| Analysis | 21 s |
| Synthesis | 36 s |
| Naive sum | 238 s |
| Unattributed | **572 s** |
| Overlap | 0 s (these stage clocks did not overlap past wall) |

`backend/src/ops/latency.ts` `reconcileLatency` writes `metrics.unattributed_ms`. Do not add overlapping stage clocks as independent parts of wall time.

Unattributed time is turn overhead, context assembly, waits between decisions, retries/recovery, scheduling, and queue/interpretation outside agent stage clocks. Client polling (~1.5 s) does not explain 572 s.

No investigation-agent redesign in this sprint. Progressive UI stays coarse truthful stages (`Waiting to start`, `Interpreting question`, `Investigating available evidence`, `Preparing findings`). `onPreview` is `INVESTIGATION_STARTED` without validated territories. No fabricated percentages.

## 15. Operational Telemetry

Events: `job_accepted`, `job_queued`, `job_started`, `job_completed`, `job_failed`, `job_cancelled`, `job_expired`, `admission_rejected`, `provider_call_failed`, `budget_reserved`, `budget_exceeded`, `budget_reconciled`, `backend_restart`, `backend_shutdown`, `result_unavailable`.

Snapshot also tracks concurrent jobs, queue depth, durations, estimated model USD, **overageUsd**, tokens, Qloo calls and failure/cancel rates.

Not logged: secrets, access tokens, prompts. Not exposed on ordinary user APIs. `GET /ops/status` is operator-only.

## 16. Demo Artifact Validation

| Field | Value |
| --- | --- |
| File | `frontend/src/demo/recorded-example.json` |
| Kind | `RECORDED_EXAMPLE` |
| Recorded at | `2026-10-23T06:28:19.052Z` |
| Model | `claude-haiku-5-5` |
| Source SHA-256 | `064c7f6e87692a45cc5790cf4901b879dd75d8ecbb0b72ad2aee0a76e41d3f75` |
| Parent | Jacquemus · `INVESTIGATION_INCOMPLETE` · 32 Qloo calls |
| Parent territories | Art and culture, Bohemian lifestyle, Avant-garde experimental fashion: `FULL_RELATIVE_ANALYSIS`. Japanese drama: `UNSUPPORTED` |
| Child | design-led boutique hospitality · `PARTIAL_EVIDENCE` / `PARTIAL_CULTURAL_ANALYSIS` · 19 Qloo calls |

The incomplete parent is **not** promoted to complete. Opening `/api/demo/recorded` does not call a provider. Jacquemus appears because it was the live question, not because of product routing.

## 17. Product UX Verification

Living Atlas design skill **version 2** is unchanged: warm ivory, botanical greens, editorial type, organic nodes, evidence inspector, natural-language input, reduced motion, keyboard access. Geometry is investigation lineage, not cultural distance.

First-use copy states what the product does, that findings are grounded in observed cultural affinities rather than model guesses, that the map is not distance, and how to open the recorded example or ask a question. The browser bundle still must not mention `QLOO` (`pnpm check:secrets`). Qloo is named in operator docs, not in client JavaScript. No UI redesign.

## 18. Security Tests

Covered in `backend/tests/sprint-7a.test.ts` and `backend/tests/sprint-7b*.test.ts`:

- Observed spend > reservation and overage accounting
- Missing usage charged conservatively
- Cancellation expense
- Concurrent reservation / in-flight overage
- Budget exhaustion 429
- Invalid / too-low reserve; replica ≠ 1
- Runtime budget-limited incomplete result
- One visitor identity per request
- Forged forwarded headers / unauthenticated direct job 401
- Operator probe vs `/ready`
- Restart 404 is not “unsupported”
- Unsupported `model: baseline` on public jobs 403
- Recorded SHA and incomplete parent

## 19. Browser E2E

`pnpm test:e2e` against the SYNTHETIC job API. Not live Qloo or Haiku. Journeys: first-use, recorded example, territory inspect, parent/child navigation, composer, honest incomplete/unsupported states.

## 20. Live Qloo/Haiku Smoke

Default for this sprint unless a later verification pass records otherwise:

| Check | Status |
| --- | --- |
| `LIVE_QLOO_SMOKE` | `NOT_RUN` without an authorized process-level probe |
| `LIVE_HAIKU_SMOKE` | `NOT_RUN` |
| `LIVE_END_TO_END` | `NOT_RUN` (no 20-minute public investigation in this sprint) |

A present `backend/.env` is not a published deployment. Cheap probes, when authorized: operator `POST /ops/providers/probe` or `backend/src/ops/live-probes.ts` (find_tags limit 1, Haiku `max_tokens: 1`).

## 21. Deployment Procedure

**Owner actions are marked. Do not perform them without approval.**

A. **Owner:** create a Railway project and one Web Service. Confirm a paid plan if required.

B. Replica count **1**. Do not enable multi-region replicas. Do not autoscale.

C. Point the service at this repository. `railway.json` selects `backend/Dockerfile` and healthcheck `/health` (timeout 120 s). Build context is the repo root.

D. **Owner:** set backend secrets from `deploy/env.public.example`. Generate `CE_INTERNAL_API_SECRET` and `CE_OPERATOR_TOKEN` (≥32 chars). Never paste them into git.

E. **Owner:** create a Vercel project with root `frontend/`. Node 22.

F. **Owner:** set Vercel server env `BACKEND_URL` to the Railway HTTPS origin (no trailing path that breaks `/api/...`) and the same `CE_INTERNAL_API_SECRET`. No `NEXT_PUBLIC_` secrets. No localhost fallback.

G. Internal auth is the only server-to-server hop. Fastify ignores forwarded client IPs.

H. Public admission: `CE_PUBLIC_DEPLOYMENT=1`, `CE_ACCEPT_INVESTIGATIONS=1`, `CE_SPEND_BUDGET_USD` (example 25), `CE_INVESTIGATION_RESERVE_USD` (example 1, not below 0.5), `CE_REPLICA_COUNT=1`.

I. `GET https://<backend>/health` → `{"status":"ok","service":"cultural-elasticity-api"}`. `GET /ready` → 200 only when admission allows. That is not provider proof.

J. Open the frontend. Open the recorded investigation. Confirm it is labelled recorded. Confirm no provider logs.

K. **Owner:** `POST /ops/providers/probe` with `x-ce-operator`. Expect `providerConnectivity.qloo/haiku` with timestamps. Re-check `/ready` still says `not_verified_by_this_endpoint`.

L. **Owner:** one bounded live question only after K and a budget review. Do not loop 20-minute evals.

M. `GET /ops/status` with operator token: queue, spend (`durable: false`, `overageUsd`), boot id, probe cache.

N. Emergency disable: set `CE_ACCEPT_INVESTIGATIONS=0` and redeploy the backend (or restart with that value).

O. Rollback: see §24.

P. Post-deploy: health, ready, recorded demo, one 401 to the backend without the secret, operator status, one live question if authorized.

## 22. Owner Approval Gates

Unexecuted without explicit approval:

- Create paid Railway / Render / Vercel projects
- Publish a public URL or change DNS
- Write secrets into a host
- Raise Anthropic or Qloo spending limits
- `git push` / merge
- A full live investigation beyond a cheap probe

## 23. Release Checklist

- [ ] Approved git checkpoint of this branch
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm check:secrets`
- [ ] Offline evals: methodology, agent, elasticity, live (captured), query
- [ ] `pnpm test:e2e` and `pnpm smoke:offline` and `pnpm smoke:docker`
- [ ] Production-mode HTTP tests (`sprint-7b-http.test.ts`)
- [ ] Spend overage and visitor identity tests
- [ ] Recorded demo SHA and incomplete parent
- [ ] Public config fail-closed
- [ ] Provider smoke performed **or** explicitly `NOT_RUN`
- [ ] Rollback procedure understood
- [ ] **Owner** activates hosts only after the above

## 24. Rollback Procedure

1. Immediate stop: `CE_ACCEPT_INVESTIGATIONS=0` on the backend and redeploy/restart.
2. Railway: redeploy the previous successful deployment. In-memory jobs on the outgoing process are lost.
3. Vercel: revert the frontend deployment. Frontend rollback does not restore backend jobs.
4. There is no durable job replay and no reconstructed evidence.
5. Anthropic workspace limit remains the financial backstop if the in-memory ledger is gone.

## 25. Known Limitations

- One process: restart drops jobs, lineage, confirmations and the spend ledger.
- Spend control is not billing and not multi-instance safe.
- Pre-call ceilings cannot guarantee zero provider overage.
- Anonymous visitor cookies can be cleared; that is a new admission key.
- Live investigations can still approach 14–20 minutes; 572 s of the recorded parent is unattributed turn/scheduling time.
- `/ready` 200 is not Qloo or Haiku proof.
- Railway healthchecks are deploy-time only.
- Agent competence remains red.
- Hackathon Qloo quota is a provider-side limit.

## 26. Agent Readiness

The Sprint 5A.2 gate remains **`AGENT_MODEL_NOT_READY`**. This sprint does not rerun `pnpm eval:agent:live -- --arms baseline,model --stability 3`. Offline `pnpm eval:agent` is not live-model evidence. `REJECTED_FOR_NOW` on the 0–100 elasticity index stays rejected.

## 27. Sprint 6 Compatibility

Yes, without starting Sprint 6. Competitor comparison, whitespace and bridges remain deferred operations behind the same query gate, jobs, admission and spend controls. Adding them later must not bypass 7B safety. Do not implement them here.

## 28. Final Hackathon Submission Blockers

Deadline: **30 October 2026**. Before a credible public submission, the owner still must:

1. Checkpoint and (if desired) push this branch.
2. Activate Railway (one replica) and Vercel with real secrets.
3. Confirm `/health`, `/ready`, recorded demo, 401 on direct backend jobs.
4. Run the operator provider probe (`QLOO_CONNECTIVITY_WORKS` / Haiku ping).
5. Run one bounded live investigation through the job path.
6. State honestly that `AGENT_MODEL_NOT_READY` and that the recorded example is recorded.
7. Keep `CE_ACCEPT_INVESTIGATIONS` and spend budget under operator control.

Until those owner steps happen: **DEPLOYMENT_VERIFIED = NOT_VERIFIED.**
