# Sprint 9L: hosted live acceptance evidence

**Live, real providers.** A real browser used the production Vercel frontend, which called the Railway backend, which called Qloo (hackathon host) and Claude Haiku. Nothing was stubbed or recorded. The procedure is the `/cultural-elasticity-release` skill. The release contract is `docs/operations/DEPLOYMENT_RELEASE_CONTRACT.md`.

| | |
| --- | --- |
| Release under test | `3d41fea` (PR #40) on Vercel and Railway; `main` moved to `c2c32aa` (PR #41, scripts/tests only, Railway correctly skipped) during the window |
| Window | Owner-approved: 75 Qloo calls, $2.00 model, 3-hour operator token, one replica. Opened 05:42Z, closed 05:49Z on 2026-10-29 with `scripts/live-test-close.sh` |
| Brand | Crocs, Qloo id `454B31CB-594B-4EF3-AF9D-EDC56E89E25E` (resolved unambiguously, twice identical) |
| Spec | `frontend/e2e-hosted/acceptance.spec.ts`, desktop 1440×900: **passed in 4.9 min**, no page errors, console errors or 5xx |

## Journey

1. The operator link authorized the browser. The token never stayed in the URL.
   - Anonymous visitors saw research *paused* while admissions were open.
   - An anonymous `POST /api/brands/resolve` returned 403.
2. Find brand resolved Crocs, and the baseline completed.
   - Qloo returned 10 artists, 10 places, 10 films, 10 books and 14 tags.
   - The brand core is Slippers.
   - There are 5 directions: practical-minded individuals, Fiction, Gender Neutrality, Hip Hop, casual footwear.
3. **Investigate Fiction** (Haiku job `5e54e7fe…`, 75 s): **Inconclusive**.
   - It found 3 brand-conditioned exemplars (Welcome to Night Vale, Макс Фрай, Trudi Canavan).
   - It found no shared cultural signal and no comparison set, so no position is claimed.
4. **"How far can Crocs extend into fine dining?"** (Haiku job `3ef2633e…`, 3.5 min): **Credible stretch, provisional, steady**.
   - Within the set {Colorful, fine dining, Relaxed Living}, fine dining sits in the middle, with high representation robustness.
   - The top and bottom placements have low robustness.
   - Some evidence was not collected because the investigation reached its budget.
   - We expected inelasticity. Qloo's evidence did not support that expectation, and the result is reported as found.
5. HTML report (13.7 KB) and PDF report (29.6 KB, 5 pages) were exported and inspected. The PDF header overlapped the title; that is fixed in `report-download.ts`.
6. *Save and go back*, then reopening from the library, restored both investigations.

## Usage (from `/ops/status` and `/ops/baselines` before closing)

- Qloo: **35 dispatches**: 1 brand resolution and 34 agent calls. All were counted durably (`runLedger.qloo_calls` 35 / 75). The cumulative baseline account is at 8 / 28 used.
- Haiku: **2 jobs, both completed**. 145,524 input and 20,766 output tokens. **$0.0215 observed**, $0.0431 estimated. The durable model ledger reserved $1.00 of $2.00. Reservations are never returned.
- No job was running or queued at close. After closing, `/ready` returns 503 `ADMISSIONS_PAUSED`, the operator token is removed, and `verify-production` reports no failure.

## Earlier attempts in the same sprint (not counted as success)

| Window | Attempt | What happened |
| --- | --- | --- |
| First window, 2026-10-29 00:00–02:59Z | 1 | The test Mac slept on battery. The scan completed server-side (6 Qloo calls), but the browser's poll timer stalled for 16 minutes. |
| First window | 2 | The floating network cards never became "stable" for a click. Fixed with `reducedMotion` in the hosted config (PR #41). |
| First window | 3 | Started after the window had expired. The authorized browser correctly showed *paused*. |

The first window used 7 Qloo calls and no model calls.

## Not verified

- Tablet and mobile viewports for the live journey. Anonymous checks passed at all three viewports.
- GitHub Actions: `CI_NOT_RUN` (billing).
- Agent readiness: it is not established by two investigations.
