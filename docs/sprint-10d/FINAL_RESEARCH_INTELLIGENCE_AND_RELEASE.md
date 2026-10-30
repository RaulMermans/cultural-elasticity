# Sprint 10D: Final research intelligence, live competence and product completion

**Final status: `CULTURAL_ELASTICITY_V1_RELEASE_CANDIDATE`.** It is not `V1_COMPLETE`.

- **Engineering, safety and offline acceptance pass.**
- **One approved live session ran:** real Qloo plus `claude-haiku-5-5`, 69 Qloo calls, about $0.05 of Haiku.
  - It found and fixed a research-integrity defect.
  - It proved durable recovery on real investigations.
- **The research-value gate is not met:**
  - no supported, non-obvious direction was found;
  - no human has reviewed the findings.
- **Still open:**
  - live re-validation of the fix;
  - the independent holdouts;
  - owner review, merge and release.
- **Devpost: NOT SUBMITTED.** On 2026-10-30 the owner said not to submit anything yet. The deadline is 2026-10-30 23:45 EDT. This is the top external blocker, and nothing was submitted on the owner's behalf.

Canonical record for Sprint 10D. Read it with `AGENTS.md`.

## 1. Starting SHA and branch

| Item | Value |
| --- | --- |
| `main` | `e9f2c2dac15b037b0a1259d549613b78365d2d5f` (PRs #50, #51 and #52 merged). CI green. No open PRs. |
| Branch | `sprint/10d-final-research-intelligence`, in worktree `~/dev/ce-10d`, created from `origin/main` |
| Live code | detached worktree `~/dev/ce-10d-live` at `f349195`; frozen during the session (§5.3) |
| Owner checkout | `~/dev/cultural-elasticity` and its `:3000`/`:4000` dev servers were not touched |
| Commits | `872e8ad`, `4f40f42`, `f349195`, `25cdf0c`, plus this report. Local only, **not pushed**: a push builds a Vercel preview that Sprint 10B found publicly reachable. |

## 2. Initial release and submission verification

- **`release:verify`** (read-only, `--public-mode --expect-admissions public --max-qloo 1000 --max-usd 5.00`) returned **`RELEASE_DEGRADED`**:
  - Vercel serves `e9f2c2d` and is READY;
  - `/ready` returns 200 and admissions are accepting (the public evaluation `qloo-hackathon-2026` is open until 2026-11-06T05:00Z);
  - CI passed;
  - findings: `RAILWAY_METADATA_NOT_VERIFIED` (no Railway CLI session here) and `VERCEL_PREVIEW_ENV_MISSING:CE_INTERNAL_API_SECRET`. The running backend revision is unknown without the operator token.
- **Devpost:** owner-reported NOT SUBMITTED, with the instruction to submit nothing yet. It is not independently verifiable.
- **Durable execution:** not enabled in production. Migration 002 has not been applied in production.
- **Provider credentials:**
  - both keys are present in the owner's local `backend/.env` (presence checked only; values never printed);
  - Qloo account-level quotas are not observable through any endpoint, so local runs may share an allowance with the public demo. This is unverified.
- **Untracked files** in the owner's checkout (`docs/sprint-9f/screenshots/*`, `docs/media/01-home.png`) were left alone.

## 3. Live harness defects found and fixed first (Phase A)

`pnpm durable:live` from Sprint 10C could not have produced a live run. Every defect below was found before any paid call, through code reading and a provider-free rehearsal (`--rehearse`, the same harness on the synthetic worker).

| # | Defect | Effect | Fix |
| --- | --- | --- | --- |
| H1 | No `x-ce-paid-operator` header on job creation | Every admission returned 403 `operator_required` | The session credential is sent |
| H2 | The worst case ignored `--only` | Wrong approval arithmetic | `worstCase(selected)`. The model minimum is one open reservation plus one per interrupted run. |
| H3 | Durable reservation release was fire-and-forget; the harness stopped the worker right after | Unused reservations stayed charged, so later approved runs were refused (the rehearsal reproduced L3/L4 `budget_exhausted`) | Releases are tracked and awaited in `onClose` (`api/agent.ts`). This also covers a Railway SIGTERM. |
| H4 | Artefacts were written only on success | A failure lost its manifest | Every run writes manifest, view and result in `finally`. The summary is written after every run. |
| H5 | A re-run without `--session` opened a fresh allowance on the same database | Silent budget reset | `ALLOWANCE_ALREADY_OPEN` (exit 4) unless `--session` or an explicit `--new-allowance` |
| H6 | No detection of a dead worker | Found live: the harness polled a dead worker for 25 minutes | The job is recorded at admission. On resume an orphaned job is **adopted, never resubmitted**. A dead worker is replaced (at most twice) and durable recovery resumes the job. |
| H7 | A resumed session was checked from zero | The resume was refused | Ledger usage plus the worst case of unfinished runs |
| H8 | Adopted jobs reported the DB status `COMPLETED`, but the retry check expected the API's `completed` | Found live: an unneeded `L2#retry` ran (within the ceiling) | Lower-cased. `--retry` now runs only after an incomplete original. |

**Ledger contract, verified:**

- Unknown usage keeps the whole reservation; known usage returns the unused part.
- Limits are fixed when their row is first written.
- A restart continues the same counters.
- Final ledger: `qloo_calls` 69/120 and `model_usd_cents` 84/100. Of those 84¢, 40¢ is the reservation held by the worker that crashed (never released, which is the conservative direction). Actual Haiku spend was about $0.05.

## 4. Research-quality rubric (Phase B)

- **Four dimensions, assessed per run:** research correctness, research competence, cultural insight and strategic usefulness.
- **The six 1–5 dimensions** (relevance, non-obviousness, grounding, actionability, clarity, efficiency) were **not scored by a human**. No blinded reviewer was available in this sprint.
  - The assessments below are the engineer's trace-based judgments, labelled as such.
  - They are not independent ratings.
  - The Sprint 10A rating sheet (`docs/sprint-10a/evaluation/rating-sheet.md`) remains the vehicle for owner rating.
- **"Valuable insight" criteria** (observation, inspectable evidence, interpretation, evidence status, next action, limitation) are checked per run in §6.

## 5. Run and evidence manifest

### 5.1 Session

| Item | Value |
| --- | --- |
| Approval | Owner, 2026-10-30: ≤ 120 Qloo calls and ≤ $1.00 Haiku; L1–L4; local worker; isolated local PostgreSQL 16 (`127.0.0.1:55434/ce_durable_live`) |
| Provider | Qloo hackathon host via `qloo mcp` (harness 0.1.26); `claude-haiku-5-5` |
| Raw artefacts | `backend/feasibility-output/durable-live/sprint-10d-diagnostic/` (gitignored): per-run manifests (`ce-run-manifest/v1`), results, views, `summary.json`, `ledger.json` |
| Committed digest | [`evaluation/live-session-digest.json`](evaluation/live-session-digest.json): territories, anchors, limitations, summaries, 69 correlation ids, recovery events. No tokens, no raw payloads. |
| Audit | [`evaluation/decision-audit.txt`](evaluation/decision-audit.txt) (`eval:competence -- --audit`) |

### 5.2 Runs

| Run | Question | Outcome | Qloo calls | Model $ | Wall time |
| --- | --- | --- | --- | --- | --- |
| L1 | Fjällräven, open discovery | `NEEDS_INPUT`: two Qloo brand entities share the name and type | 1 | 0.0007 | 10 s |
| L2 | Bodum, specialty coffee | PARTIAL, `NO_REFERENCE_YIELD`; recovered after an unplanned worker crash (attempt 2) | 12 | 0.0109 | 34 s after resume |
| L2#retry | same question | PARTIAL, same blocker (repeatability sample; see H8) | 12 | 0.0087 | 95 s |
| L3 | Diptyque: boutique hotels, ceramics, jazz | Relative panel built; **semantically invalid ceramics representation**; jazz dropped (`QLOO_EMPTY`) | 30 | 0.0189 | 266 s |
| L4 | Dyson, wellness retreats (planned kill) | PARTIAL; recovered after SIGKILL at checkpoint 2 | 14 | 0.0085 | 116 s |

### 5.3 Process incident (engineer error, disclosed)

- **What happened:** the first L2 worker died about 1 minute into L2, after 11 committed Qloo calls.
- **Probable cause:** I was editing and rebuilding source files in the worktree the live worker was running from. The worker died with nothing in flight: the next call was `RESERVED`, not dispatched. The exact crash output was not captured; finding H6 records that gap.
- **Recovery:** a fresh worker adopted the job (attempt 2), replayed the 11 committed calls from the journal without re-sending them, sent the reserved call normally, and completed.
- **New rule:** `AGENTS.md` now requires live sessions to run from a frozen worktree.

## 6. Baseline real research results (Phase B)

**L1 Fjällräven: correct abstention, unusable question.**

- *Correctness:* right. Qloo returned `needs_input` with two `urn:entity:brand` candidates named "Fjällräven". Choosing one silently would violate the resolution rules.
- *Competence:* 2 turns, 1 call.
- *Usefulness:* poor. The user was shown two bare IDs and asked for "country, product line or a website". Yet Qloo's answer carried each candidate's popularity (0.95 and 0.88) and description ("…sustainable backpacks, clothing…" and "…the iconic Kånken bag"). Our normalizer dropped both. This is an **evidence-usability defect** (fixed: C2).
- *Insight:* none; the run never reached research.
- *Continuation:* not live-tested. The remaining 16¢ is below the 40¢ reservation.

**L2 Bodum, specialty coffee: grounded diagnosis, low strategic value.**

- *Correctness:* the anchor is valid (`interests:qloo:specialty_coffee_culture`, café members).
  - The brand-conditioned list is labelled truncated and association-only.
  - No unsupported number or class.
- *Competence:*
  - 4 brand-independent reference probes returned no eligible place member, so a FULL comparison was infeasible (`NO_REFERENCE_YIELD`). The agent stopped with 13 calls unspent instead of continuing.
  - Two runs reached the same verdict; secondary exemplars differed (Ubuntu Café vs Akwarela Café and Julice Boulangère).
- *Insight:* thin.
  - The obvious question (does Qloo tie Bodum itself to coffee culture?) was not asked: the brand profile was not compared with the territory's tags.
  - The conditioned list (led by Fauna & Flora – Santos, b Café Pastelaria) hints at a geographic skew that is not interpreted.
- *Usefulness:* it says honestly "not established, and here is why it cannot be measured". That meets the brief's weakest form of useful outcome (a clear diagnosis), not a decision.

**L3 Diptyque, comparison: research-integrity failure (fixed: C1).**

- *What happened:*
  - Qloo's tag search for "ceramics" returned eight concepts, including `culture:qloo:ceramics`, `industry:qloo:ceramics` and `culture:qloo:ceramic_craftsmanship`.
  - The model probed `material:qloo:ceramic`. Its brand pool (20 members) made the runtime anchor the territory to it (`LABEL_TAG_MEMBERS`, decided by the runtime).
  - Representation then accepted three luxury watch brands: by Qloo's data, ceramic is a watch-case material.
  - The panel placed "ceramics" 1st of 3 against "boutique hotels" (one exemplar) and "Horology", a reference the agent added after jazz returned no brand members on 6 probes.
- *Safeguards that held:* classes are `PROVISIONAL / UNCERTAIN_REPRESENTATION_SENSITIVE`; robustness is LOW/INSUFFICIENT; `TERRITORY_APPROXIMATION` is flagged.
- *What failed:* the summary leads with "ceramics ranks highest". A strategist would read a craft territory as Diptyque's strongest, on watch-brand evidence.
- *Grounded negative:* jazz has no brand-type Qloo members in any of 6 namespaces probed (`genre`, `genre:music`, `music`, `genre_category`, `subgenre`), so it is correctly dropped.
- *Audit blind spot:* the decision audit does not detect this failure class.

**L4 Dyson, wellness retreats: honest PARTIAL, questionable representation.**

- Anchored to `lifestyle:qloo:wellness_retreats` (20 brand members).
- Exemplars: Lululemon, Alo Yoga, Fitvia. These are athleisure and fitness brands, not retreats. They are Qloo-tagged with the concept, and the model judged them acceptable.
- No reference attempt, no position, coherence NONE. The summary says it does not settle the question.
- This is a weak-representation case, not fabricated support. It is recorded rather than "fixed": the members are Qloo's own evidence, and the model's veto only removes support.

**Net research value.**

- 0 supported non-obvious directions.
- 1 grounded negative (jazz for brand-type comparison).
- 2 grounded "cannot be measured" diagnoses (L2, L4).
- 1 correct abstention with a defective question (L1).
- 1 misleading relative reading (L3).

## 7. Failure taxonomy and root causes (Phase C)

Decision audit over the 5 stored runs (41 turns; Sprint 10B taxonomy):

- **Validity:** valid-action rate 92%, first-attempt-valid 90%.
- **Waste by cause:** DETERMINISTIC_POLICY 12 (unproductive reference probes), QLOO_DATA 8, CONTEXT 4, MODEL_DECISION 3, INFRASTRUCTURE 1.
- **Stops:** non-FULL targets stopped while FULL was still feasible: 0/3.

| ID | Run, trace | Expected | Actual | Root cause, evidence | Owner | Severity | Generalizable | Smallest correction | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | L3, anchorDecisions iteration 4, `mcp-473ed809…` | A craft territory is anchored to a cultural concept | Anchored to a product-material tag; watch brands ranked as "ceramics" | Runtime same-name anchoring accepted any namespace; `material` was not an incidental namespace | `frontier.ts`, `semantic-comparison.ts`, `tool-registry.ts` | **Critical** (misleading relative reading) | Yes: any territory whose name is also a material or attribute tag | C1 | Fixed offline; live re-validation NOT_RUN |
| F2 | L1, `mcp-df25cf69…` | A clarification the user can answer | Bare IDs; Qloo's popularity and description dropped | `toResolutionIssues` kept only id, name and type | `qloo/normalize.ts` and the path to `NEEDS_INPUT` | High (blocks the first step for any duplicated brand) | Yes | C2 | Fixed offline |
| F3 | L2, L2#retry | A comparison set, or a grounded PARTIAL | Grounded PARTIAL; 4/4 reference probes empty | Qloo data: place-type references for this concept return no eligible members | Qloo coverage | n/a (correct negative) | n/a | None | Recorded |
| F4 | L3 jazz | Drop jazz if unsupported | Dropped after 6 empty probes (bounded) | Qloo data: music tags have no brand members | Qloo coverage | n/a | n/a | None | Recorded |
| F5 | L4 | A representation that is the territory | Lifestyle brands represent "retreats" | Qloo tags brands with the lifestyle concept; brand is the only type with members | Qloo data and representation semantics | Medium | Yes | Candidate lesson CL3 (not promoted) | Open |
| F6 | L2 | Ask whether Qloo ties the brand to the concept | Not asked | No skill step compares the brand profile with the target's tags | `analyze_move` skill | Medium | Yes | Candidate lesson CL4 (not promoted) | Open |
| F7 | all | — | The audit cannot see semantic failures | The taxonomy measures probe efficiency only | `scripts/competence/audit.ts` | Medium (evaluation) | Yes | A representation review per run (AGENTS.md 10D.4) | Process change |
| F8 | session | — | Harness defects H1–H8 | §3 | `scripts/durable/*` | High (blocked live evidence) | Yes | §3 | Fixed and exercised live |

## 8. Implemented corrections (Phase D)

| ID | Change | Priority | Tests |
| --- | --- | --- | --- |
| C1 | `material` joins `INCIDENTAL_ATTRIBUTE_NAMESPACES`. `incidentalAnchorRefusal` stops runtime auto-anchoring, and `anchor_territory` refuses an incidental tag **while the territory's own search returned a non-incidental concept**. With no alternative, the anchor remains possible. | P1 / correctness | `tests/agent-sprint10d.test.ts` (4, SYNTHETIC ids); `agent-generalization` guard |
| C2 | Resolution candidates keep Qloo's `popularity` and a 200-character description. The model context, the `NEEDS_INPUT.options` (`NeedsInputOption`) and the brand chooser show them. They are never used to choose. | P1 / usability | `qloo-normalize.test.ts`; E2E brand chooser |
| C3 | Handoff idempotency and comparative report plans are stored with the durable job request (no migration). After a restart, the report rebuilds from the stored plan, and a repeated key returns 409 `idempotency_unavailable` with the job id, never a second paid job. | P5 / reliability (10C limitation 1) | `tests/durable-handoff.db.test.ts` (real PostgreSQL, two app instances) |
| C4 | Awaited durable releases on shutdown | P5 | rehearsal and live ledger (§3) |
| C5 | Live harness H1–H8 | Phase A | `tests/durable-live-plan.test.ts`; rehearsal; live session |

**Not changed:**

- the methodology;
- the thresholds;
- the claim validator;
- prompts;
- skill procedures.

No skill version was bumped, because no skill's procedure changed. C1 is a runtime and tool precondition rule.

## 9. Before/after evidence

- **C1, traced replay:**
  - in L3's recorded state, the search tags were `material:…:ceramic` plus seven non-material concepts;
  - before: the runtime anchored the material tag;
  - after: `incidentalAnchorRefusal` refuses it, citing the culture and industry concepts.
  - A full replay is impossible: the corrected run needs Qloo answers the session never fetched. **LIVE_QLOO_VALIDATION_NOT_RUN for C1.**
- **C2:** the L1 recorded answer now normalizes to candidates with popularity 0.955 and 0.879 and both descriptions. The question remains a question.
- **Unrelated regressions** (offline, all pass):
  - `eval:methodology` 19/19;
  - `eval:agent` PASS;
  - `eval:d2d` PASS (empty probes 52 → 38, unchanged);
  - `eval:discovery` PASS (suite R);
  - `eval:query` PASS;
  - `eval:elasticity` 27/27;
  - `eval:competence -- --decisions` PASS (live arms NOT_RUN).

## 10. Independent holdout results

**NOT RUN.**

- The owner delegated the decision. I did not spend the separate Sprint 10A allowance (12 frozen brands, about 500–852 Qloo calls and about $1.50). The brief forbids silently spending it, and 10A scheduled it for after judging (2026-11-05).
- The holdouts remain untouched and untuned.
- **Research generalization: 0 independent cases tested.**
- The 4 diagnostic cases are diagnostic only. They were used to find C1 and C2 and are not evidence of improvement.

## 11. Agent tool use and cost

- **Decision quality** (§7): 41 turns, 92% valid actions; 3 waste events caused by the model, 12 by deterministic reference policy, 8 by Qloo data.
- **Cost:**
  - 69 Qloo calls for 5 runs;
  - about $0.048 of Haiku decisions plus about $0.002 of interpretation;
  - the largest run was L3: 30 calls, $0.019, 4.4 minutes.
- **Qloo calls per useful finding:** undefined, because there was no supported direction. Per grounded diagnosis: about 14.

## 12. Durable recovery acceptance (live)

| Case | Kill | Committed before | Restart | Replayed | Re-sent | Dispatches = committed | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| L4 (planned) | SIGKILL after turn checkpoint 2 | 5 | 1.2 s | 5 | 0 | 14 = 14 | COMPLETE (attempt 2), `RECOVERY_DECISION resume` |
| L2 (unplanned) | worker death, 1 call `RESERVED` | 11 | harness resume | 11 | 1 (never dispatched: case B) | 12 = 12 | COMPLETE (attempt 2) |

- 0 `OUTCOME_UNKNOWN`.
- 0 duplicate dispatches.
- The ledger was not reset.
- First live evidence that 10C recovery works on the real MCP transport.

## 13. User journey validation (Phase G)

- **Synthetic browser E2E:** 59/59 pass (`E2E_MODE=production`, ports 3100/4100).
  - The brand chooser change kept the existing accessible name.
  - This covers brand scan, investigation, clarification, comparison, cancellation, a lost job and retry, the saved library and export.
- **Not done:**
  - a hosted or live end-to-end journey with a real brand;
  - a mobile visual review.
- **Live product finding:** a real user typing "Fjällräven" hits the ambiguous path. C2 makes it answerable.

## 14. Final report and export verification

- Export and report parity rest on the existing synthetic E2E assertions.
- The comparative report now survives a restart (C3).
- The L3 live summary shows the report risk precisely. Classes were provisional, but the opening sentence ranked a semantically invalid territory first. C1 removes the cause. No report-wording change was made, because the claim validator held.

## 15. Security and spending controls

- No key was printed, logged or written.
- The live worker received only the two keys.
- `check:secrets`: no leakage (818 files, 26 bundle files).
- Paid admission required the operator credential (H1).
- The durable ledger enforced both ceilings across 3 harness processes and 6 workers.
- No production service, ledger, preview, migration or quota was touched. No push was made.

## 16. CI and integration tests (local, provider-free)

- `pnpm lint`, `pnpm typecheck`, `pnpm build`: pass.
- `pnpm test`: backend 89 files and 1,016 tests; frontend suite pass.
- `test:durable` (real processes plus C3, disposable PostgreSQL 16): pass.
  - Test 9 (cancellation and restart) failed once and passed on rerun, both with and without the changes. It is a timing flake, recorded rather than retried away.
- `test:db`: 17 pass.
- `check:secrets` and `check:deployment-config` (`OFFLINE_DEPLOYMENT_CONFIG_PASS; REMOTE_PLATFORM_STATE_NOT_VERIFIED`): pass.
- `smoke:docker`: not run (no Docker locally); CI runs it.
- GitHub CI on this branch: not run, because the branch is not pushed.

## 17. Production release verification

**Not performed.** There was no merge, deploy, migration or tag. Production remains `e9f2c2d` with the C1-class defect live. Releasing the fix requires, in order:

1. owner review;
2. a protected preview (fix `VERCEL_PROTECTION_GATE_FAILED`, or push without a preview);
3. a merge;
4. a deploy through the existing workflow;
5. `release:verify`;
6. a tag.

Durable-mode cutover (migration 002, `CE_DURABLE_AGENT=1`) is a separate approval, planned after judging.

## 18. Remaining limitations

1. **Research value is not demonstrated.** Use the live findings as diagnostics, not as product claims.
2. No human review of any finding.
3. C1 and C2 are not live re-validated.
4. 0 independent holdouts.
5. L4-style representations: concept-tagged brands of the wrong kind (CL3).
6. The brand-to-concept tie is not checked in single-move investigations (CL4).
7. The decision audit is blind to semantic failures.
8. Qloo account quota is unobservable.
9. Durable mode is not in production.
10. Devpost is not submitted.

## 19. Final completion status

**`CULTURAL_ELASTICITY_V1_RELEASE_CANDIDATE`**

| Gate | State |
| --- | --- |
| Engineering | Pass offline. Recovery is proven live. Production configuration was not re-verified (Railway metadata). |
| Agent competence | Real Haiku and Qloo decisions evaluated and classified. One critical error found and fixed offline. Reproducible from the recorded journal. |
| Research value | **Not met**: no supported non-obvious direction; no human review. |
| Product | Synthetic journey passes; hosted live journey not run. |
| Release | Not started (owner approval). |
| Generalization | 0 independent cases. |

**Exact remaining actions:**

- Devpost decision (owner, before 23:45 EDT).
- Owner review of this branch.
- A live re-run of L3 alone to validate C1: ≤ 32 Qloo calls, ≤ $0.40 reservation, a new allowance.
- Owner rating of the portfolio below.
- Holdouts after judging (separate approval).
- Release.

## 20. Recommended maintenance policy

**The loop:** real run → trace → audit plus a representation and claim review → failure record (§7 format) → candidate lesson → failing test → smallest general fix → unrelated and holdout regression → **human approval** → promotion (skill version bump if a procedure changes).

- Nothing is promoted automatically.
- Future work is classified as one of:
  - critical blocker (none open besides release approvals);
  - confirmed research defect: CL3, CL4;
  - operational maintenance: durable cutover, Railway metadata, preview protection;
  - optional enhancement.

No Sprint 10E is opened.

---

## A. Research portfolio (live, real findings)

| Run | Finding | Evidence | Status | Limitation | Next action |
| --- | --- | --- | --- | --- | --- |
| L1 | Qloo holds two Fjällräven brand entities with the same name and type | `mcp-df25cf69…`; popularity 0.955 vs 0.879; descriptions differ | Observed | Which entity carries the brand's real taste graph is unknown | Pick the entity in the chooser (now informed), then re-run |
| L2 | Specialty coffee culture exists as a Qloo concept with café members, and a Bodum-conditioned association list exists | 12 correlation ids; tag `interests:qloo:specialty_coffee_culture` | Supported as a concept; **position not measurable** | No place-type references yield members; truncated list | Test whether Bodum's own profile carries the concept (CL4) before any comparison |
| L3 | Jazz cannot be compared as a brand-type territory in Qloo | 6 empty probes across 5 namespaces | Grounded negative | Other entity types not tried for a brand comparison | Treat jazz as artist or venue culture, not a brand panel |
| L3 | "Ceramics ranks first" | Watch-brand exemplars | **Invalid**; withdrawn | — | Re-run after C1 |
| L4 | Wellness-retreat concept is tagged on athleisure and fitness brands; no comparison | `lifestyle:qloo:wellness_retreats`; 14 calls | Partial; representation questionable | Exemplars are not retreats | Probe place-type members of the concept |

## B. Research failure analysis

What limits the agent is mostly not Haiku's decision-making (92% valid; 3 waste events). It is:

1. **Qloo coverage at the comparison step.** Reference probes for a shared entity type return nothing (L2, and earlier 9O traces: 45/65).
2. **Representation semantics.** Same-named tags in attribute namespaces (L3) and concept-tagged entities of the wrong kind (L4) pass structural checks.
3. **Missing brand-to-concept questions.** The agent measures the territory, rarely the brand's tie to it.
4. **Evidence dropped at boundaries** (L1).

## C. Evaluated improvement record

| Change | Decision | Reason |
| --- | --- | --- |
| C1 incidental-anchor refusal | **Retained** | Fixes a proven live false anchor. Offline evals unchanged. Live validation pending. |
| C2 candidate detail | **Retained** | Uses Qloo evidence that was already returned. Never auto-selects. |
| C3 durable handoff state | **Retained** | Closes 10C limitation 1 without a migration |
| C4 and C5 harness and release | **Retained** | Exercised live |
| Candidate lesson CL3: refuse representations whose exemplars are not the territory's kind | **Not promoted** | Needs a rule that does not override Qloo membership. Model veto only. Needs eval evidence. |
| Candidate lesson CL4: check the brand profile against the target concept in `analyze_move` | **Not promoted** | It is a skill procedure change, so it needs a version bump, eval evidence and owner approval |
| Raise or adjust `--retry` beyond one attempt | Rejected | The ceilings, not retries, bound the evidence |

## D. Product release checklist

- [x] Provider-free CI-equivalent checks (§16)
- [x] Live diagnostic session, with artefacts (§5)
- [x] Durable recovery verified live (§12)
- [ ] Devpost submission (owner)
- [ ] Owner review of `sprint/10d-final-research-intelligence`
- [ ] Vercel preview protection fixed, or a push strategy agreed
- [ ] GitHub CI on the pushed branch
- [ ] Live re-validation of C1 (L3 only)
- [ ] Human rating of the portfolio
- [ ] Holdouts (after 2026-11-05, separate approval)
- [ ] Merge, deploy, `release:verify`, tag
- [ ] Durable cutover: production DB backup, then migration 002, then `CE_DURABLE_AGENT=1` (separate approval)
- [x] Rollback: revert the merge commit and redeploy the previous Vercel and Railway revisions. Migration 002 is additive, and the durable flag defaults off.

## E. Project handoff

- **Run a live research session:**
  1. `pnpm durable:live -- --rehearse …` (free);
  2. owner approval;
  3. `pnpm durable:live -- --approved-qloo N --approved-usd X --env-file <backend .env> --database-url <local>`, from a frozen worktree;
  4. resume with `--session <dir>`.
- **Evaluate:**
  - `pnpm eval:competence -- --audit <session dir>`;
  - read each `*-manifest.json` for anchors and representations (the audit does not);
  - add the run to a digest like [`evaluation/live-session-digest.json`](evaluation/live-session-digest.json).
- **Improve:** follow §20. Never tune on the L1–L4 brands or the 10A holdouts.
- **Operate:** `release:verify`; `public-evaluation-close.sh` after judging; `pnpm agent:recovery` for quarantined jobs.
