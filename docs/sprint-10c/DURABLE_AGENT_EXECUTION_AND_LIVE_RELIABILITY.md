# Sprint 10C: Durable agent execution, recovery and live research reliability

**Status: `SPRINT_10C_COMPLETE_WITH_LIMITATIONS`.** The offline implementation and the real process-interruption acceptance pass. Genuine live research is **not run**: `LIVE_QLOO_VALIDATION_NOT_RUN` and `LIVE_AGENT_MODEL_VALIDATION_NOT_RUN`. The bounded live plan in §15 awaits owner approval. Agent-model readiness is unchanged: `AGENT_MODEL_NOT_READY`.

This is the canonical record for durable agent execution. Read it with `AGENTS.md`.

## 1. Starting state

| Item | Value |
| --- | --- |
| `main` | `c6a8ba4bac25347c707d1544a025f7579460fcda` (PR #51 merged). CI green on that commit. |
| Production | Vercel and Railway both serve `c6a8ba4`. `verify-production --public-mode --expect-admissions public --max-qloo 1000 --max-usd 5.00` returned `RELEASE_DEGRADED`; the only finding was `VERCEL_PREVIEW_ENV_MISSING:CE_INTERNAL_API_SECRET`. |
| Public evaluation | `qloo-hackathon-2026` is open until 2026-11-06T05:00Z (approved in Sprint 9M). It was not touched. |
| Devpost submission | **UNVERIFIED.** Nothing in the repository or the available tools confirms it. The deadline is 2026-10-30 23:45 EDT. **This is the immediate external priority.** |
| Workspace | Branch `sprint/10c-durable-agent-execution` in worktree `~/dev/ce-10c`, created from `origin/main`. The owner's `~/dev/cultural-elasticity` checkout and its dev servers were not touched. |
| Migrations | One migration before this sprint (`001_brand_baseline.sql`). Migrations are checksum-pinned, serialized by an advisory lock, and applied only by the operator command `pnpm db:migrate`. |

## 2. Architecture decision

**PostgreSQL-backed durable jobs inside the existing backend process, with deterministic replay of a provider-call journal.** There is no new service, queue or workflow engine.

- The runtime was not rewritten. A persistence boundary sits around it:
  - an execution scope carried by `AsyncLocalStorage` (`agent/durable/scope.ts`);
  - journaled wrappers for the three paid providers: Qloo, the agent model and the query interpreter (`agent/durable/decorators.ts`);
  - checkpoint hooks at runtime boundaries;
  - durable job ownership in `JobManager` (`agent/query/jobs.ts`).
- **Recovery replays the job.** Every provider call already committed for the job is answered from the journal and is never sent again. The first call with no committed answer is the frontier. If that call was never dispatched, it is sent. If it may have been dispatched, nothing is sent and the job is quarantined.
- **Checkpoints are snapshots, not the restart point.** They make waiting runs (`needs_input`) and finished runs durable, and they are the replay's divergence check: a replayed boundary must reproduce the stored evidence digest.
- **Why replay, not resume-from-checkpoint.** A mid-turn crash would otherwise need the model's partial turn persisted and resumed, and the query layer's gate result rebuilt. Replay reuses the existing control flow exactly, is order-independent (§8), and cannot apply a decision twice: the replayed state is rebuilt from committed answers, not patched.
- **Rejected:** LangGraph, Temporal, Redis and BullMQ. The baseline scan already proves PostgreSQL leases and reservations in this deployment. One replica does not need a broker.
- **Durable mode is opt-in** (`CE_DURABLE_AGENT=1` with `DATABASE_URL`). Without it, behaviour is byte-for-byte the previous in-process mode, and every existing test runs in that mode.

## 3. Persistence limitations found

| Area | Before | Now (durable mode) |
| --- | --- | --- |
| `JobManager` | Map in memory; a restart answered 404 | `agent_jobs` rows. Results are readable for the retention window across restarts. |
| `RunStore` (continuation, follow-up, navigation) | 100 runs in memory | `needs_input` and `final` checkpoints, restored at startup |
| `QueryStore` (confirm) | 200 records in memory; `executed` flag in memory | `agent_queries` table. Confirmation is single-use across processes. |
| Provider calls during a crash | lost; the state on restart was unknowable | journal with `RESERVED → DISPATCHING → COMPLETED/FAILED`, plus `OUTCOME_UNKNOWN` |
| Model reservation | taken durably (Sprint 9J), never released on restart | unchanged; it stays held, which is the conservative direction |
| Process Qloo ceiling | an in-memory counter (resets) plus the durable run ledger when a credential is set | unchanged. Replayed calls never reach the transport, so they are never counted twice. |
| Run deadline | in-memory timer | `deadline_at` is persisted and never reset |
| Handoff scan ↔ job links | Map in memory | `origin_scope` on the job. Comparison options find parent and sibling jobs after a restart. |
| Comparative report plan, handoff idempotency keys | Map in memory | **unchanged (limitation §19)** |

## 4. Database schema (`backend/migrations/002_durable_agent.sql`, additive)

- **`agent_jobs`**:
  - the request and the SHA-256 of the access token;
  - status and stage;
  - `run_id` and `parent_run_id`;
  - `base_checkpoint_id` (where a continuation starts);
  - `origin_scope`;
  - `attempt`;
  - the lease: `lease_owner`, `lease_epoch` and `lease_until`;
  - `deadline_at`, `cancel_requested` and `unknown_authorized_at`;
  - `spend_authorized_usd`;
  - the terminal `result`, the error, and `finished_at` / `expires_at`.

  It has partial indexes for recoverable and expiring jobs.
- **`agent_provider_calls`** has the primary key `(job_id, op_key)`. Each row carries provider, operation, fingerprint, status, attempt, `dispatch_count`, `lease_epoch`, correlation id, the committed answer, usage and `discarded`. It is the evidence ledger, and it cascades on job delete.
- **`agent_checkpoints`** holds `(job_id, run_id, seq)` unique, the boundary, `schema_version`, the digest, the state (jsonb) and the lease epoch. The last 3 intake/turn checkpoints per run are kept. Every `needs_input` and `final` checkpoint is kept.
- **`agent_queries`** holds the query record, `executed` and `executed_by_job`, and `expires_at`.
- **`agent_events`** records recovery decisions, quarantine and authorizations. It never holds a prompt, a token or provider output.

The evidence lives in one place: the journal holds provider answers, and checkpoints hold derived state. A job's result is the projection the user sees. No baseline table is altered.

## 5. State serialization (`agent/durable/checkpoint.ts`)

- **Schema version.** It is `agent-checkpoint/v1`. An unknown version raises `CheckpointVersionError` and is not restored; it is never guessed at.
- **Containers.** Maps and Sets are tagged (`{"$map": …}` / `{"$set": …}`) and keep their insertion order, which the runtime relies on. `undefined` and functions are dropped.
- **Process-bound objects are never in state.** Abort signals, span recorders, spend bounds, timers and clients live in WeakMaps keyed by the state. A resumed run rebuilds them: a new recorder, a new signal, and a new spend bound limited by the original authorization.
- **Evidence digest.** `evidenceDigest` hashes status, budgets, interpretation, brand, territories, the entity/tag/profile/pool ids, call-cache keys, results and the final analysis. Wall-clock fields are excluded. Equal digests mean the same validated research state.
- **Acceptance** (`tests/durable-checkpoint.test.ts`). A completed SYNTHETIC comparison is serialized, passed through JSON and hydrated. It gives:
  - an identical digest and identical re-serialization;
  - the same deterministic analysis when re-run on the hydrated state, with a provider that throws on any call (routes, classes, positions and correlation ids all equal).

## 6. Checkpoint lifecycle

| Boundary | When |
| --- | --- |
| `intake` | after the validated request and the gate-approved interpretation are applied |
| `turn` | after every model turn, and after the runtime's reference discovery |
| `needs_input` | before a clarification question is returned (the continuation point) |
| `final` | after finalization, before the terminal job commit |

Admission, accepted decisions and completed provider calls are made durable by the job row and the journal, not by an extra snapshot. A checkpoint write is fenced by the lease, so a stale worker cannot write one.

## 7. Worker ownership and leases

- `claim` sets `owner`, increments `lease_epoch` (the fencing token) and sets `lease_until = now + lease`. It applies only when the lease is free or expired. A heartbeat every lease/3 extends it.
- Every advancing write runs inside the same statement as `SELECT … FOR UPDATE` on the job row, checking owner, epoch and an unexpired lease. This covers status, progress, checkpoints, the journal and the terminal result. Zero rows means `LeaseLostError`. The worker then halts (`RunSuspendedError("lease_lost")`), drops the job from memory and commits nothing.
- The reservation for a provider call is itself fenced. A worker that lost its lease therefore halts **before** it can send anything.
- Graceful shutdown (SIGTERM, for example a Railway redeploy) suspends running jobs without a result and releases their leases. The next process recovers them immediately. It no longer marks them `BACKEND_RESTART`.
- **Validated:** one worker, plus a stalled worker that is fenced out (Test 7). **Not claimed:** distributed execution across several live replicas.

## 8. Provider-call durability

- **Operation key:** `opKey = <provider>:<sha256(operation, canonical request)>:<occurrence>`. It depends on the request and on how many identical requests the job made before it. It does not depend on timing or call order, so concurrent or reordered calls still map to the same rows.
- **Ordering:** `RESERVED` is written before anything else. `DISPATCHING` is written immediately before the request leaves the process, through the new `onDispatch` hook in `QlooToolProvider`, after spacing and rate-limit waits. The answer (`COMPLETED`, or `FAILED` including a thrown error) is committed **before** the runtime sees it. Usage and the correlation id are recorded with it.

| Case | Journal state at restart | Behaviour |
| --- | --- | --- |
| A: answered and committed | `COMPLETED` / `FAILED` | The committed answer is returned. Qloo or the model is never called again for it. |
| B: not dispatched | `RESERVED` | Re-reserved (`attempt + 1`) and sent normally. |
| C: dispatched, not committed | `DISPATCHING` becomes `OUTCOME_UNKNOWN` | The job is quarantined (`INTERRUPTED_UNCERTAIN`). Nothing is repeated without an operator decision. |
| D: provider failure | `FAILED` committed | Replayed as the same failure. Retries stay those of the existing provider policy, inside the run budget. |
| E: stale worker | its lease is lost | It halts before reserving anything, and every write is fenced. |

- **No exactly-once claim.** Neither Qloo nor Anthropic offers a verified idempotency contract to reconcile with, so case C is not reconciled automatically.
- **Operator decision for case C.** `pnpm agent:recovery -- authorize <jobId>` marks the unknown calls `UNKNOWN_ACCEPTED`. They stay charged, the job is re-queued, and the request may be sent once more. This is recorded as `UNKNOWN_OUTCOME_AUTHORIZED`.
- **Discarded answers.** A late answer the runtime discarded after a tool timeout is stored with `discarded = true`. It stays charged and is never evidence. A replay that reaches such a row is quarantined, because an instant replay cannot reproduce that timeout.
- **Replay divergence.** A recovered attempt may not reserve anything new while committed rows remain unreproduced. A fingerprint mismatch, or a replayed checkpoint digest that differs from the stored one, quarantines the job (`INVESTIGATION_REPLAY_DIVERGED`).
- **Local stateful policies.** The production Haiku adapter is stateless: one request per decision, built only from the context. The deterministic baseline policy and the scripted test models keep memory across turns. A new optional `AgentModel.replay()` lets them rebuild that memory locally when a committed decision is reused. It never calls a provider. This bug was found by Test 1 and fixed generally, with no case-specific rule.

## 9. Budget reconciliation

- **Qloo.** Per-run usage is rebuilt by the replay: each reused call re-applies its original charge, so final usage equals what was actually dispatched. The process ceiling and the durable run ledger are charged only at the transport, which a reused call never reaches. Nothing is counted twice and nothing resets.
- **Model.** The admission reservation stays held durably: it is never released by a restart, and an unknown usage keeps the whole reservation. A recovered job gets `fixedSpendBound(original authorization)`. The replay re-adds the journaled usage, so new calls are bounded by what remains of the **same** authorization.
- **Unknown calls.** They stay charged until an operator accepts them, and afterwards too.
- **Admission paths.** No new admission path was added. Recovery never takes a new reservation and never bypasses the operator gate or the public quota.

## 10. Recovery logic (`agent/durable/recovery.ts`)

Recovery runs at startup (`onReady`) and then every lease/2. The steps:

1. Check the schema. If migration 002 is missing, durable admission is refused with 503; the schema is never created implicitly.
2. Run the retention sweep.
3. List active jobs. A job never started is re-queued. A job with a live lease is skipped until the lease expires.
4. Claim the job (the epoch is bumped, which fences the previous owner).
5. Decide with fixed rules, in this order:
   1. cancellation requested → `CANCELLED`;
   2. any `DISPATCHING` or `OUTCOME_UNKNOWN` call → quarantine;
   3. deadline passed → `FAILED INVESTIGATION_TIMEOUT` (the deadline is never reset);
   4. attempts > 3 → `FAILED RECOVERY_LIMIT_REACHED`;
   5. otherwise resume by replay. Resumed jobs go to the front of the queue. A continuation is re-hydrated from its `needs_input` base checkpoint, never from state a failed attempt mutated.
6. Restore held runs and queries.
7. Record a `RECOVERY_DECISION` event (action, reason, attempt, unknown and committed counts, worker, decision time).

No model is asked how to recover. Every outcome preserves the journal and the checkpoints. Interrupted evidence is never presented as a finding.

## 11. Authorization and privacy

- Only the SHA-256 of an access token is stored, compared in constant time. After a restart, a wrong token and an unknown id still look the same (404); this is tested.
- `peekDurable` and `originJobs` exist only for server-linked scopes (one baseline scan), exactly as before.
- The run manifest and the events contain no token, credential, prompt or internal reasoning. Model decisions appear only as their validated action and one-line `reasonSummary`. A test checks that the manifest does not contain the access token.
- **Pre-existing, not changed:** a run id used as follow-up context is not token-protected. It is a server-generated UUID.
- **Retention:**
  - default 7 days (`CE_AGENT_RETENTION_HOURS`, or `CE_AGENT_RETENTION_MS` for tests);
  - expired jobs become tombstones (`EXPIRED`, no result, no checkpoints);
  - a tombstone is deleted with its journal after twice the window;
  - expired queries are deleted.

## 12. API compatibility

- Routes, bodies and views are unchanged.
- In durable mode, a job that this process does not hold is read from the database (`read`, `stop`), so a result survives a restart.
- Status mapping: `RECOVERING` shows as `running` with "Resuming after a restart". `INTERRUPTED_UNCERTAIN` shows as `failed` with `INVESTIGATION_INTERRUPTED_UNCERTAIN` and a message that says the outcome is unknown and is not evidence against the territory.
- New 503 code: `durability_unavailable`, when the job record cannot be written or the schema is missing.
- `JobManager.create` stays for in-process mode. `admit()` serves both modes and persists before queueing.
- The 59 browser end-to-end tests, the 1,008 backend tests and every eval are unchanged and green.

## 13. Migration and rollback

**Production status: NOT migrated, NOT enabled, NOT deployed.** Staged rollout, each step needing owner approval:

1. Back up the Railway PostgreSQL (procedure in `docs/sprint-9b/BRAND_INTELLIGENCE_AND_DURABLE_INFRASTRUCTURE.md`).
2. Apply `pnpm db:migrate` in a non-production database, then twice more; the third run must report `applied=0`. This is the CI `durable` job.
3. Run `pnpm test:durable` and `pnpm test:db` against it.
4. Deploy the release with `CE_DURABLE_AGENT` unset. It behaves exactly like today, and the new tables are unused.
5. Run the approved live acceptance (§15) locally.
6. Production cutover: `pnpm db:migrate` on production (explicit operator step), then `CE_DURABLE_AGENT=1`, with one replica. The judging window should end first (2026-11-05).

**Rollback:**

- Unset `CE_DURABLE_AGENT` and redeploy. Jobs return to in-process mode. Durable rows stay readable for audit but are no longer served.
- The migration is additive. Its tables can stay; dropping them is a separate, explicitly approved step. `001` is untouched.
- A rollback while durable jobs are active leaves them `RUNNING` in the database. Re-enabling recovers them. Leaving it disabled abandons them, and their evidence stays in the journal.

## 14. Process-interruption results (real processes, disposable PostgreSQL 16, SYNTHETIC provider)

`backend/tests/durable-process.db.test.ts` (`pnpm test:durable`):

- It spawns real `scripts/durable/worker.ts` processes and kills them with **SIGKILL**, pauses them with **SIGSTOP** and **SIGCONT**, and stops them with **SIGTERM**.
- It asserts on database rows, job state, an independent **dispatch oracle** (one line per Qloo attempt that reached the transport) and the final output.
- Every recovered result is compared with an uninterrupted reference run of the same question.

**12/12 passed, 3 consecutive runs locally** (Docker unavailable on this Mac; a local `postgres@16` cluster on 127.0.0.1:55433 was used). CI runs the same suite against a `postgres:16` service container (new `durable` job). That CI job has **not run yet**: the branch is not pushed.

| Test | Fault point | Result |
| --- | --- | --- |
| 1 Crash before dispatch | `qloo.before_dispatch:6` | Resumed. The oracle saw 30 = reference (no phantom or duplicate call). Every Qloo row was dispatched exactly once, and the result equals the reference. |
| 2 Crash after the dispatch mark | `qloo.after_dispatch_mark:6` | `INTERRUPTED_UNCERTAIN`, one `OUTCOME_UNKNOWN`, five committed rows kept, no further dispatch. The oracle shows it had not left, but the process could not know that. |
| 3 Crash after a commit | `qloo.after_commit:15` | 15 + 15 dispatches, all distinct requests, journal fingerprints equal to the reference, result equal. Every cited correlation id belongs to a committed journal row (provenance survives). |
| 4 Answered, uncommitted | `qloo.before_commit:6` | Quarantined, and nothing sent for 2.5 s. After `authorizeUnknown`, the job resumed and completed with one authorized re-dispatch (`attempt = 2`, `dispatch_count = 2`). Result equal. |
| 5 Crash during a model decision | `model.after_dispatch_mark:3` / `model.before_dispatch:3` | The unknown decision is quarantined (only a model row is unknown; committed Qloo evidence is kept). A decision not yet sent resumes, and the result equals the reference. |
| 6 Crash during finalization | `checkpoint.final.after:1`, `job.before_terminal_commit:1` | Exactly one `final` checkpoint and one terminal result, equal to the reference, 30 dispatches. |
| 7 Lease expiry | `qloo.after_commit:8` with a 6 s pause, plus SIGSTOP | Worker B claimed (epoch 2) and completed. Stalled worker A, resumed, sent nothing (8 dispatches from A, all before the stall) and was fenced (`job_lease_lost` / `job_commit_fenced`). |
| 8 Clarification pending | crash after `needs_input`, and a second crash during the continuation | The user answered after a restart. The crashed continuation was replayed from its base checkpoint and completed on the same run id with `SYN-BR-0006`; no request was sent twice. |
| 9 Cancel, then restart | `qloo.after_commit:5` | The cancel was recorded durably; after the restart the job is `CANCELLED`, with no dispatch after the cancel. |
| 10 Retention | 4 s window | The result was readable after a restart, wrong and guessed tokens got 404, and the manifest has no token. Expired → tombstone (no result, no checkpoints) → deleted → 404. |
| + SIGTERM | graceful shutdown mid-run | Suspended without a result; the next process finished it, equal to the reference, 30 dispatches. |
| + Confirmation | a dry-run `queryId` confirmed, then restart | The second confirmation after the restart is refused (`QUERY_ALREADY_EXECUTED`). |

**Measured (Test 3, 3 runs).** Kill → completed result: **2.48–2.61 s**. This includes `tsx` worker start-up and the 1.5 s test lease expiring; production uses a 30 s lease, so recovery waits up to that long. Checkpoint writes: 13 per run, **13–16 ms mean**. 20 committed provider operations were reused per recovery. Duplicate-dispatch attempts prevented: 1 per quarantine test (2, 4, 5).

Unit tests in the default suite (`tests/durable-checkpoint.test.ts`, 15 tests) cover:

- checkpoint round-trip and equivalence;
- version refusal;
- recovery-rule ordering;
- the journal protocol against an in-memory fake (reuse, occurrence keys, unknown outcome halts, divergence refuses new dispatch, lease loss halts before send, a stored failure replays as the same error, deterministic ids).

## 15. Live research plan (APPROVAL REQUIRED, not run)

Command (local only; refuses a non-local database, missing keys, or an approval below the worst case; exit 4):

```sh
pnpm durable:live -- --plan     # no process, no provider call
pnpm durable:live -- --approved-qloo 120 --approved-usd 1.00 \
  --env-file "<path to the backend .env holding QLOO_API_KEY and ANTHROPIC_API_KEY>" \
  --database-url postgresql://<user>@127.0.0.1:<port>/ce_durable_live
```

**Isolation:**

- one local worker (127.0.0.1, `NODE_ENV=development`), real Qloo (hackathon host, verified before any call) and the production Haiku model;
- its own local database (migrated by the script);
- a session credential kept in the session directory, which keys the durable run ledger, so a restart continues the same Qloo and USD ceilings;
- only the two keys are read from the env file, and neither is printed or written;
- no production service, quota, preview or migration is touched;
- outputs go to gitignored `backend/feasibility-output/sprint-10c/<session>/`: raw results for `pnpm eval:competence -- --audit <dir>`, run manifests, `summary.json` and `ledger.json`.

**Pre-registered assignments** (frozen 2026-10-30, before any live result; none is a benchmark, fixture or Sprint 10A holdout brand):

| id | kind | question |
| --- | --- | --- |
| L1 | open discovery | What unexpected cultural territories could Fjällräven credibly stretch into? |
| L2 | targeted | Is specialty coffee culture a defensible extension for Bodum? |
| L3 | comparative | For Diptyque, compare boutique hotels, ceramics and jazz as cultural territories. |
| L4 | recovery demonstration | Could Dyson credibly move into wellness retreats? It is stopped right after its 2nd committed turn checkpoint (no call in flight), killed with SIGKILL, and resumed by a fresh worker. |

**Worst case, from code:**

- **Qloo:** 32 + 24 + 32 + 24 = **112 calls**, plus 1 if an operator authorizes an unknown re-dispatch. Per-run budgets already include retries.
- **Model:** $0.40 reserved per investigation (`conservativeReserveUsd`). The unused part is returned after settlement. The interrupted L4 keeps its reservation, which is why it runs last.
- **Request:** **≤ 120 Qloo calls and ≤ $1.00 Haiku.** The durable ledger refuses any start the remaining authorization cannot cover. Recent live investigations cost about $0.04–$0.10 each, but that is an observation, not a bound.
- **Unchanged:** no provider retries beyond the existing limits; the public evaluation ledger is not touched.

## 16. Live research results

**Not run. Owner approval is required.** `LIVE_QLOO_VALIDATION_NOT_RUN`, `LIVE_AGENT_MODEL_VALIDATION_NOT_RUN`.

What is unverified until it runs:

- interpretation of real questions;
- real Haiku tool decisions under durable replay;
- recovery of a live run (real MCP transport, 7 s spacing, a 30 s-class lease);
- real costs and latency;
- the research quality of the four assignments.

## 17. Failure taxonomy and observations

No live run exists for Sprint 10C, so there are no live observations. For each live run, the analysis will use:

- the Sprint 10B taxonomy, via `pnpm eval:competence -- --audit <session dir>`;
- the manifest;
- one compact assessment per run that keeps infrastructure outcome (recovered, quarantined, reused calls) apart from research quality (Qloo data limitation, tool selection, context or skill, reference construction, representation, opportunity selection, premature stop, excess calls, classification, provider error, incomplete evidence).

Prompts and skills are not changed during the benchmark.

Infrastructure findings from this sprint's own tests (synthetic):

- **Stateful local policy.** A replay that skipped `decide()` left the baseline policy's memory empty: 16 instead of 30 calls, a different research route. The failure class is a stateful policy under replay. It was fixed by `AgentModel.replay()`, not by a case rule.
- **Per-process correlation ids.** The synthetic world numbers correlation ids per process, so result projections compare provenance against the journal instead. This is a fixture property, not a product change.

## 18. Cost and latency

- Offline work cost $0: no paid call was made.
- Durable overhead per synthetic run is 13 checkpoints at about 15 ms each, plus one journal write before and one after each provider call.
- Live cost and latency are not measured (§16).

## 19. Tests and CI

**Local results:**

- `pnpm lint`, `pnpm typecheck` and `pnpm build`: pass.
- `pnpm test`: 87 files, 1,008 tests, pass.
- Evals: `eval:methodology`, `eval:live`, `eval:elasticity`, `eval:agent`, `eval:d2d`, `eval:discovery`, `eval:query` and `eval:competence -- --decisions` all pass.
- `check:secrets`, `check:deployment-config` and `smoke:offline`: pass.
- `pnpm test:e2e`: 59 passed.
- `pnpm test:db`: 17 passed. The migration-count assertion now counts the shipped files instead of hardcoding 1.
- `pnpm test:durable`: 12 passed.

`pnpm smoke:docker` was **not run** (no Docker locally). CI runs it.

The new CI job `durable` has a `postgres:16` service, empty provider keys, migrates twice (the second run must apply 0), then runs `test:durable` and `test:db`. It is untested in Actions until the branch is pushed.

**Remaining limitations:**

1. Comparative report plans (`/compare/:id/report`) and handoff idempotency keys are still in memory. After a restart the report endpoint answers 404, while the job result itself stays readable.
2. A model call interrupted mid-flight always quarantines. Most live wall time is in model calls and Qloo spacing; spacing happens before the dispatch mark, so it is safe. A real crash therefore often needs an operator decision. This is deliberate.
3. Only a single worker plus a fenced stale one is validated; distribution is not claimed.
4. Spans and latencies of an interrupted attempt are not carried over. A recovered trace has the replayed decisions with new timings.
5. A process ceiling without a run credential (local development without a token) still resets on restart. With a credential, the durable ledger enforces it.
6. Durable mode is not deployed and the production schema is not migrated.
7. `INTERRUPTED_UNCERTAIN` jobs expire with the retention window if nobody reviews them. Their evidence is then deleted after twice the window.

## 20. Readiness

Agent-model readiness is unchanged: **`AGENT_MODEL_NOT_READY`**. Infrastructure recovery is not research competence; a recovered job is not evidence of useful research.

## 21. Sprint 10D handoff: real research evaluation and governed improvement

1. Run the approved §15 session and keep every artefact, including failures.
2. Audit each run (`eval:competence -- --audit`) and write one compact assessment per run. Keep recovery and research quality in separate tables.
3. Replay evaluators offline over the stored journal answers (`answer` in each manifest's `providerCalls.qloo`) instead of repeating paid calls. The manifest version is `ce-run-manifest/v1`.
4. For each recurring failure, ask: the failure class, the evidence, the owning component, the smallest change, unrelated-case tests and the regression risk. Promote a change only with holdout evidence; the Sprint 10A frozen holdouts remain untouched.
5. Decide production cutover (§13) after judging ends (2026-11-05).
6. Move comparative plans and handoff idempotency into `agent_jobs` (limitation 1).
