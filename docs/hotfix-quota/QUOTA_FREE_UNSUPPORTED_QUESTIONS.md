# P0 Hotfix: unsupported questions no longer use investigation allowance

**Status:** fixed offline, and every check passes. Not merged, not deployed. No provider call was made.

## 1. Root cause

Before this fix, `POST /api/agent/jobs` (`backend/src/api/agent.ts`, `enqueue`) did three things in order:

1. Reserved the global spend.
2. **Took one investigation unit** (`backend/src/ops/public-quota.ts`, `takePublicQuota`).
3. Admitted a durable job.

Only *inside* that job (`backend/src/agent/query/jobs.ts` → `query/service.ts`) did Haiku interpret the question and the deterministic gate (`query/gate.ts`) decide whether it could run.

The unit was returned only when admission itself failed (`JobRejectedError`). A job that completed as `UNSUPPORTED_OPERATION`, `NEEDS_CLARIFICATION` or `INTERPRETATION_FAILED` kept its unit, and `public-quota.ts` documented that policy ("a refused or failed start still counts").

**LOEWE × BLACKPINK.** "What connects Loewe with BLACKPINK?" is classified `bridge_builder`. The interpreter prompt defines that as "territories that connect or link two territories", and it is a deferred operation, so the gate returns `UNSUPPORTED_OPERATION` ("Not run"). On that code path the request **did consume one investigation unit**. The new test reproduces it.

**Whether that request took this visitor's *last* unit is unverified.** The per-network ledger is in the production database (`baseline_budget_accounts`, key `run:<evaluation hash>:quota:investigation:<network key>`). This session's permission policy refuses production reads, and I did not try to bypass it.

## 2. Fix (smallest change compatible with durability)

A full interpretation preflight would move the journaled interpreter out of the durable job and risk interpreting the question twice. Instead:

| Piece | Change |
|---|---|
| `packages/shared/src/query.ts` | `startedNewInvestigation(response)`: true only when the response carries a run that is not `reused`. Unknown counts as started. |
| `backend/src/agent/query/jobs.ts` | The terminal job event carries `startedInvestigation`. |
| `backend/src/api/agent.ts` | Keeps the request headers of public jobs that hold a unit, **in memory only** (no visitor identity is written). When `job_completed` reports no investigation started and no Qloo call, the unit is returned **once**: the entry is deleted on use. Failed, cancelled and expired jobs keep the unit. |
| `backend/src/ops/public-quota.ts`, `config/production.ts` | A new **question** quota bounds interpretation spend. Each admitted question takes one question unit, which is never returned. Default is 3 × the investigation quota (36 at today's 12). Override with `CE_PUBLIC_QUOTA_QUESTIONS`. When the investigation quota refuses, the question unit is returned. |
| Frontend | A question that started no investigation says it used no investigation credit. Unsupported answers say an unchanged retry gives the same answer. The allowance is re-read when a job settles. The bridge copy points to "Explore these signals with the agent" or a territory question. |

How each outcome is charged:

| Outcome | Investigation unit | Question unit |
|---|---|---|
| Unsupported operation, clarification, interpretation failure, partially supported, returning to an existing run | returned (0) | 1 |
| Investigation started (completed, failed, cancelled, incomplete) | 1 | 1 |
| Refused before job creation (budget, quota, queue, duplicate confirm) | 0 | 0 |
| Handoff with an existing idempotency key | not re-charged (unchanged) | not re-charged |
| Process restart before the return | **kept** (conservative; never returned twice) | 1 |

The global Qloo and USD ceilings, spend reservations, durability, idempotency, operator bypass and budgets are unchanged.

## 3. Tests (SYNTHETIC; no provider call)

`backend/tests/hotfix-quota-free-questions.test.ts` (10 tests) covers:

- LOEWE × BLACKPINK → `UNSUPPORTED_OPERATION`, 0 investigation units, spend hold released;
- clarification 0;
- a started investigation costs exactly 1;
- one unit left: an unsupported question keeps it and the next supported question runs;
- the question quota bounds interpretation, and its refusal holds nothing;
- an investigation refusal returns the question unit;
- 6 concurrent requests against a quota of 2 admit exactly 2;
- an operator is never quota-counted;
- the predicate (navigation, i.e. a reused run, is not new);
- the question-quota default.

Elsewhere:

- E2E: the unsupported answer shows "used no investigation credit" and re-reads the allowance.
- `sprint-9m-public-evaluation.test.ts` used a query that the structural interpreter turns into a clarification. Those tests now send a request that starts an investigation, so they still test what their names say.

| Check | Result |
|---|---|
| lint, typecheck, build, check:secrets | pass |
| backend 1,064 / frontend 118 | pass |
| `test:durable` (disposable PostgreSQL) | 19/19 |
| `test:e2e` | 65/65 |
| `eval:query`, `eval:agent`, `eval:research-intelligence` | pass (offline; `LIVE_*_NOT_RUN`) |

## 4. P1: brand–entity connection (LOEWE × BLACKPINK)

**Not supported after this fix; it is now quota-free and points to a supported path.**

**What exists today:**

- `qloo_resolve_entity` can resolve an artist.
- `qloo_get_entity_tags` returns both tag profiles, and their intersection is computable deterministically.
- The brand scan already holds BLACKPINK as a brand-conditioned artist observation, with its correlation ID.
- Sprint 10A's "Explore these signals" already uses those scan entities as discovery seeds.

**What is missing:**

- a gate operation and handoff for brand × entity;
- a runtime route whose target is an entity, not a territory: today's representation, analysis and assessment are all territory-shaped;
- claim-validation rules for "observed together in a brand-conditioned list ≠ partnership";
- the UI.

That is a feature, not a hotfix. It belongs in its own sprint with a pre-registered evaluation, and it must not delay the P0 fix.

## 5. Limitations

1. A unit is returned in the process that admitted the job. If that process restarts before the job settles, the unit is kept. It is conservative and never double-returned.
2. A visitor with **no** investigation unit left is still refused before interpretation (429). The fix keeps units from being spent; it does not let an exhausted visitor ask unsupported questions. A capability preflight would be needed for that.
3. Each question still costs one Haiku interpretation (about $0.002), bounded per network by the question quota and globally by the spend ledger.
4. Units already consumed in production before this fix are not restored automatically.

## 6. Restoring the affected tester

No production change has been made. Options for the owner:

- **Continue testing now:** use the existing `/operator` route with the paid-operator token. Operator requests skip per-network quotas and stay inside the global Qloo and USD ceilings.
- **Narrow compensation (needs explicit approval and a production read):** identify the tester's network key from their own browser. It is a hash, never an IP, so don't share raw addresses. Confirm the `bridge_builder` job in `agent_jobs`, then decrement only that row:
  `UPDATE baseline_budget_accounts SET used_calls = GREATEST(used_calls - 1, 0), updated_at = now() WHERE budget_key = 'run:<evaluation hash>:quota:investigation:<network key>';`
- **Broad (affects everyone):** raise `CE_PUBLIC_QUOTA_INVESTIGATIONS`. Quotas only rise; nobody's usage resets.

## 7. Deployment and rollback

1. Review and merge the PR. `main` auto-deploys Vercel and Railway.
2. Optionally set `CE_PUBLIC_QUOTA_QUESTIONS` on Railway; the default is 3 × investigations.
3. Run `pnpm release:verify -- --release <sha> --public-mode --expect-admissions public --max-qloo 1000 --max-usd 5.00` from the Railway-linked checkout.
4. Smoke test as a public visitor: ask an unsupported question and confirm the investigation count is unchanged after it settles.

**Rollback:** revert the merge commit. There is no migration. The `question:` quota rows are additive and are ignored by the previous code.
