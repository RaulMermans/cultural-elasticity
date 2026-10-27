# Sprint 9I — Bounded live validation request (NOT AUTHORIZED, NOT RUN)

**Status:** `LIVE_QLOO_VALIDATION_NOT_RUN`, `LIVE_AGENT_MODEL_VALIDATION_NOT_RUN` for the comparative handoff.
Sprint approval does not authorize paid calls. Nothing in this document has been executed.

## Why it is needed

The stored live evidence cannot support a complete comparative example:

- The recorded Loewe baseline (live, 2026-10-25) has two directions, **Model** and **Fashion**. Both are tags with no evidence of a rankable entity type.
- The recorded Sprint 9G investigation of **Boutique hospitality** (live Haiku + Qloo) has a validated place representation. It keeps no exemplar tag profiles, though.
- No other investigation of Loewe was recorded.

The production gate therefore refuses the comparison (`REFERENCE_TYPE_UNVERIFIED`, see `frontend/src/demo/recorded-comparative.json`). No ranking was manufactured to fill the gap.

## Proposed run (one brand, one comparison)

All of this runs on an operator machine, not on the public Railway or Vercel deployment. It uses the hackathon host only (`QLOO_BASE_URL` = `QLOO_TRUSTED_BASE_URL` = `https://hackathon.api.qloo.com`).

| Step | Route | Qloo calls (max) | Model calls (max) | Reservation |
| --- | --- | --- | --- | --- |
| 1. Loewe baseline scan | `POST /api/brands/baselines` | 7 | 0 | none (baseline budget) |
| 2. Single-direction investigation: Boutique hospitality | `/api/agent/handoff/jobs` | 12 | 1 interpretation + 8 turns + ≤2 synthesis | $0.40 |
| 3. Two reference investigations, chosen by the owner (each must be expected to resolve to **place** exemplars) | `/api/agent/handoff/jobs` ×2 | 24 | 2 × (1 + 8 + 2) | $0.80 |
| 4. Comparison: Boutique hospitality vs the two references | `/api/agent/handoff/compare/jobs` | 32 | 1 + 12 turns + ≤2 synthesis | $0.40 |
| **Total ceiling** | | **75** | **≈ 47** | **$1.60** |

The model is Claude Haiku 5.5 (`claude-haiku-5-5`) only. Every Qloo dispatch is reserved before it leaves the process. Uncertain outcomes count against the budget and are never replayed.

## Preconditions (all required before the first call)

1. The owner writes an explicit authorization naming this plan, the brand, the reference names and the ceiling: **75 Qloo calls, $2.00 model spend**.
2. Provider-side caps have been checked by the owner:
   - an Anthropic workspace spend limit of $2.50 or less;
   - the Qloo hackathon key's rate limits (rank panel ≤ 6 options; known to be fine).
3. Local env:
   - `CE_ACCEPT_INVESTIGATIONS=1`, `CE_BASELINE_ENABLED=1`, `CE_BASELINE_LIVE_ENABLED=1`, `CE_BASELINE_TOTAL_QLOO_CALLS=7`;
   - `CE_SPEND_BUDGET_USD=2.00`, `CE_INVESTIGATION_RESERVE_USD=0.40`;
   - a local PostgreSQL for the baseline (`DATABASE_URL`).
   
   Public deployments keep every admission flag at 0.
4. `pnpm eval:agent:budget -- --approved-usd 2` preflight passes (no provider call).
5. `qloo doctor` (offline) prints the hackathon endpoint.

## Stop rules

- Stop after step 2 if Boutique hospitality no longer validates a place representation with ≥ 2 distinct exemplars (the gate would refuse anyway).
- Stop after step 3 if either reference fails to validate a place representation. Report it; do not substitute another reference without a new authorization.
- Stop at once on `QLOO_HOST_NOT_VERIFIED`, an unexpected brand id, or any spend refusal.

## What is recorded

- Each job's raw `QueryResponse` and the comparative report envelope, under `docs/sprint-9i/evidence/` as `*.live.json`, with correlation IDs, model id, token usage and observed cost.
- A rebuilt recorded demonstration (`backend/scripts/demo/build-recorded-comparative.ts`, extended to read the live comparative envelope). It is labelled recorded-live and never relabelled as synthetic or the reverse.
- Whether the outcome is `RELATIVE_POSITION_ESTABLISHED`, `NO_RELATIVE_POSITION` or `INTEGRITY_FAILED`, reported as it came out. An honest PARTIAL or no position is an acceptable result.
