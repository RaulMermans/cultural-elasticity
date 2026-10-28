# Sprint 9J: Spend and access safety

**Status (2026-10-27):** paid admission is **off** on every reachable environment. No Qloo or Anthropic call was made in Sprint 9J. Observed provider spend: **$0**. The authorized live run was **not executed** (see "Live run gate" below).

## 1. What the internal secret is, and is not

`CE_INTERNAL_API_SECRET` proves that a request to Railway came through the Next.js server. It says nothing about who the visitor is. The Next.js proxy injects it into **every** proxied request, including those from anonymous visitors.

Before Sprint 9J, the only other paid control was the admission switch (`CE_ACCEPT_INVESTIGATIONS`, `CE_BASELINE_LIVE_ENABLED`). So turning admissions on would have opened paid research to every anonymous visitor of the public site. 9J closes that gap.

## 2. Public / read-only versus paid routes (audited)

| Route (Next.js → Railway) | Provider cost | Gate after 9J |
| --- | --- | --- |
| `GET /`, recorded Loewe, recorded Jacquemus Atlas, `/api/demo/*` | none (bundled recorded evidence) | public |
| `GET /api/agent/admissions`, `GET /api/brands/status` | none | public; no secret, boot id or spend figure is forwarded |
| `GET /api/brands/baselines/:id[/territories\|/evidence]` | none | scan token (owner of the scan) |
| `POST /api/research/handoff/preview`, `/compare/options`, `/compare/preview` | none (server re-reads stored evidence) | scan token + job token |
| `GET /api/agent/jobs/:id`, `/compare/report/:id`, `POST …/cancel` | none | job token |
| `POST /api/brands/resolve` | Qloo `describe` | internal auth + baseline live admission + **operator** |
| `POST /api/brands/baselines` | ≤ 7 Qloo calls | internal auth + baseline live admission + **operator** |
| `POST /api/agent/jobs` | Haiku + Qloo | internal auth + admission + **operator** + spend reservation + rate limits |
| `POST /api/research/handoff/jobs` | Haiku + ≤ 12 Qloo | same, plus scan ownership and idempotency |
| `POST /api/research/compare/jobs` | Haiku + ≤ 32 Qloo | same, plus eligibility gate, job ownership and idempotency |
| Railway `/api/agent/analyze`, `/interpret`, `/query`, `/follow-up`, `/continue` | Haiku + Qloo | closed (404) on any public runtime, and operator-gated if opened in development |
| Railway `/ops/status`, `/ops/baselines`, `/ops/providers/probe` | probe only | diagnostics operator token (`CE_OPERATOR_TOKEN`), 404 otherwise |

Direct requests that bypass the UI were tested against the live deployment from a real browser context:

| Route | Status |
| --- | --- |
| `/api/agent/jobs` | 503 |
| `/api/brands/resolve` | 503 |
| `/api/brands/baselines` | 503 |
| `/api/research/handoff/jobs` | 404 |
| `/api/research/compare/jobs` | 404 |

A forged `x-ce-paid-operator` header from the browser is never forwarded.

Railway called directly, without the internal secret or with a wrong one, returns 401.

## 3. Operator authorization (new)

The smallest mechanism that is server-side, fails closed, is scoped and is enforced at the execution boundary:

- **Credential.** `CE_PAID_OPERATOR_TOKEN` (at least 32 characters) on Railway. A public runtime refuses to boot if it is weak, or if it equals the internal secret or the diagnostics token (`PAID_OPERATOR_WEAK`, `PAID_OPERATOR_REUSED`).
- **Expiry.** `CE_PAID_OPERATOR_EXPIRES_AT` (ISO time). On a public runtime a missing or past expiry refuses every paid start (`operator_expired`), so a forgotten token cannot keep authorizing spend.
- **Enforcement.** Railway checks it at the paid dispatch points only:
  - `admitCreate` in `backend/src/api/agent.ts`;
  - the baseline `admit(…, needsLive)` in `backend/src/brand-baseline/api.ts`.

  The check is a timing-safe comparison of the `x-ce-paid-operator` header.

  It is required on every public runtime whether or not admissions are open. On a private process it is required once a token is set.
- **Order.**
  1. Internal auth.
  2. Admission. Paused still wins: an operator cannot start work while admission is off.
  3. Operator.
  4. Rate limits.
  5. Spend reservation. Nothing is reserved for a refused request.
- **Transport from the browser.** `POST /api/operator/session` stores the credential in an HttpOnly cookie (`SameSite=Strict`, `Path=/api`, 4 hours, `Secure` in production); `DELETE` clears it. The Next.js server never validates the credential or echoes it back. It forwards it as `x-ce-paid-operator` only on the five paid POST routes above.
- **What visitors see.** `/ready` exposes `dependencies.paidOperatorRequired` (a boolean, never the token). The admission view shows *paused* to a visitor without the cookie, so a public page never shows an enabled paid button. An older backend without the field is treated as requiring the operator (fail closed).
- **Logs.** `x-ce-paid-operator` and `CE_PAID_OPERATOR_TOKEN` are redacted.

This is not a user-account system. It authorizes one operator for a bounded, time-limited run.

## 4. Budgets and replay protection

| Control | Where | Survives restart? |
| --- | --- | --- |
| Model spend: `CE_SPEND_BUDGET_USD`, per-job reserve `CE_INVESTIGATION_RESERVE_USD` (public floor $0.50; computed Haiku ceiling $0.40) | in-memory ledger (`ops/spend.ts`) | **No** |
| Per-run Qloo budget (12 for a single direction, 32 for a comparison), retries and timed-out calls included | agent gateway | n/a (per run) |
| **New: run-wide Qloo ceiling** `CE_PROCESS_QLOO_CALL_LIMIT`. One counter across baseline and agent phases. A unit is taken before every upstream attempt, failed and uncertain attempts included, and never returned. An invalid value refuses every dispatch. | transport wrapper (`qloo/dispatch-limit.ts`); usage shown in `/ops/status` as `qlooDispatch` | **No** |
| Baseline Qloo calls: `CE_BASELINE_TOTAL_QLOO_CALLS`, at most 7 per scan, resolution included | PostgreSQL `baseline_budget_accounts` | Yes |
| Idempotent starts (handoff and comparison keys) | in-memory maps | No |
| Repeated click or refresh | UI disables the start after the first click; an uncertain start is never re-sent ("start could not be confirmed") | per page |

Because the model ledger, the run-wide Qloo counter and idempotency keys are process-local, a **restart resets them**. That is acceptable for a single supervised run on one replica with no automatic replay. It is **not** a financial guarantee for an unattended or public paid launch. Before hosted paid research is opened beyond one supervised run, it needs:

- a durable admission and accounting record (the existing PostgreSQL), and
- a provider-side hard cap.

## 5. Live run gate

The owner authorized the bounded run (75 Qloo calls, $2.00 Haiku) and asked for it to run on the deployment. The owner explicitly waived verification of the Anthropic provider-side cap ("do not over expend"). The in-app guards would therefore have been the only financial control.

Planned hosted configuration (not applied):

| Variable | Value | Effect |
| --- | --- | --- |
| `CE_SPEND_BUDGET_USD` | 2.00 | 4 jobs × $0.50 reserve |
| `CE_INVESTIGATION_RESERVE_USD` | 0.50 | |
| `CE_PROCESS_QLOO_CALL_LIMIT` | 75 | run-wide ceiling |
| `CE_BASELINE_ENABLED` / `CE_BASELINE_LIVE_ENABLED` | 1 / 1 | |
| `CE_BASELINE_TOTAL_QLOO_CALLS` | 7 | |
| `CE_ACCEPT_INVESTIGATIONS` | 1 | |
| `CE_PAID_OPERATOR_TOKEN` | fresh random value | |
| `CE_PAID_OPERATOR_EXPIRES_AT` | now + 3 h | |

The branch SHA would have been deployed to the one Railway replica with `railway up`, the frontend run as the Vercel preview of the branch, and Railway redeployed from `main` with every admission flag at 0 afterwards.

**Blocker.** The session's permission policy refused secret-store writes. It refused a Vercel environment-variable write, and the Railway variable changes above are the same kind of write, so they were not attempted. This was refused at the step that would have given the branch preview its internal secret. The run therefore stopped **before any paid dispatch**.

Side effect: the Preview-scoped `CE_INTERNAL_API_SECRET` on Vercel had already been removed by that step. It contained an empty value, so preview deployments could never authenticate to Railway either before or after. Production variables are unaffected. Restoring it is listed under owner actions.

Results: `LIVE_QLOO_VALIDATION_NOT_RUN`, `LIVE_AGENT_MODEL_VALIDATION_NOT_RUN`, `HOSTED_LIVE_PROVIDER_E2E_NOT_RUN`, `LOCAL_LIVE_PROVIDER_E2E_NOT_RUN`.

## 6. Final access and admission state (verified 2026-10-27)

- **Railway** `cultural-elasticity-api`:
  - deployment `0b0f8cd` (`main`), `SUCCESS`, one replica in us-east4;
  - `/health` 200, `/ready` 503 `ADMISSIONS_PAUSED`;
  - `CE_ACCEPT_INVESTIGATIONS=0`, `CE_BASELINE_ENABLED=0`, `CE_BASELINE_LIVE_ENABLED=0`, `CE_BASELINE_TOTAL_QLOO_CALLS=0`;
  - no paid operator token is set;
  - spend ledger: $0 reserved and consumed, 0 jobs;
  - baseline DB: 1 of 1 migrations, 0 scans, 0 Qloo calls used.
- **Vercel production:**
  - alias `cultural-elasticity-raulmermans-projects.vercel.app`, rebuilt from `0b0f8cd` with the Production `BACKEND_URL` and `CE_INTERNAL_API_SECRET` added in this sprint;
  - SSO protection off, by the owner's temporary public-demo authorization;
  - no paid action enabled.
- The Sprint 9J operator gate is on the sprint branch only. Production still runs `main`, where paid starts are gated by the admission flags alone. **Do not open admissions on `main` before the 9J gate is merged and deployed.**
