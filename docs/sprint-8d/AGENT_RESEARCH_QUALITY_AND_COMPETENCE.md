# Sprint 8D — Agent research quality and competence

Evidence-producing competence sprint. Not a deployment sprint. Not a multi-agent redesign. Not a methodology weakening.

Frozen competence remains `agent-readiness-gate-v3`, `run-evaluators-v2.1`, and `frontier-stability-criteria-v1`. Production model unchanged: `claude-haiku-5-5`, effort `high`, decision/synthesis `max_tokens` 16_000, Qloo spacing 7000 ms.

The Sprint 8C live parent (227 412 ms, 28 Qloo calls, 12 turns, ≈ $0.0179) is the performance baseline. It was **not** re-run. No hosting work.

## 1. Executive Outcome

| Gate | Decision |
| --- | --- |
| Engineering | **ENGINEERING_COMPLETE** for research-failure analysis, deterministic Channel A / quota / unproductive-probe rules, frozen synthetic evals, Living Atlas E2E, and honest live-gate blocking. |
| Research competence | **RESEARCH_COMPETENCE_IMPROVED** on demonstrated synthetic failure modes (ungrounded hypothesis probes, quota inflation, empty re-probes). **LIVE_RESEARCH_QUALITY_NOT_RERUN.** |
| Agent readiness | **`AGENT_MODEL_NOT_READY`.** C9 offline evaluators 0 failures. Focused 8B L-C2 / L-E1 live evidence is retained. The prescribed 7-case gate was **not** run: `LIVE_GATE_BLOCKED_BY_APPROVAL`. |
| Performance | **PERFORMANCE_REGRESSION_PASS** on synthetic `perf:agent` and unchanged Qloo spacing / turn / call budgets. Live 227 s parent **not** re-measured. |

Do not collapse these gates. Zero FULL on the 8C live parent is not treated as automatically incorrect.

## 2. Starting State

- Previous checkpoint: `sprint/8c-verified-agent-performance` at `c98dbe4` (`Sprint 8C: prove live after-memo latency, restore browser E2E, and diagnose hosted Vercel MCP.`). Already committed and pushed; the 8C brief's "uncommitted" note was stale.
- This sprint branch: `sprint/8d-agent-research-competence` created from that SHA. 8C work was not overwritten.
- Node 22.23.2, pnpm 10.26.0.
- Credentials present on disk in `backend/.env` (`QLOO_API_KEY`, `ANTHROPIC_API_KEY`). Presence is not spend authorization.

## 3. Current Baseline

Sprint 8C live parent, frozen prompt “Where could Jacquemus expand?”, Haiku 5.5 effort high:

| Clock | Sprint 8C |
| --- | --- |
| Run id | `775217fd-64af-4048-90a8-41042374b751` |
| Wall | 227 412 ms |
| Coverage | 0.992 |
| Context assembly | 1 427 ms exclusive |
| Qloo | 28 calls |
| Model | 12 turns · ≈ $0.0179 · 0 repairs |
| Invalid actions | 5 |
| Outcomes | validFull 0, invalidFull 0, partial 1, insufficient 3, unsupported 3 |
| Proposed / resolved | 4 / 1 |
| Empty probes | 12 |
| NO_VALUE_ACTION | 4 |

The full 8C turn trace and per-territory result payload were **not persisted** (only the perf summary). Territory names on that run cannot be reconstructed honestly. The recorded Living Atlas example (Sprint 5B.3, same prompt, different revision) is a different investigation path, not an expected answer.

## 4. Research Failure Taxonomy

Classified from the 8C live parent metrics, the 5B.3 recorded Channel A path, and synthetic replay — not from invented Qloo evidence.

| Class | 8C evidence | This sprint |
| --- | --- | --- |
| **UNPRODUCTIVE_PROBING** | 12 empty probes; 4× `NO_VALUE_ACTION` retries | Second empty agent-hypothesis probe refused while unused `frontierConcepts` remain |
| **MODEL_DECISION_FAILURE** | 5 invalid actions / 12 turns | Prompts and outstanding now name `FRONTIER_EVIDENCE_PENDING` / `NO_VALUE` / `DUPLICATE` as do-not-retry |
| **REPRESENTATION_FAILURE** | 4 proposed, 1 resolved | In-flight Qloo-grounded candidates still count toward the quota so probing can continue |
| **REFERENCE_SELECTION_FAILURE** | Not isolable without the result payload | Unchanged reference plan / semantic MEANINGFUL filter |
| **INSUFFICIENT_COMPARABILITY** | 1 PARTIAL | Unchanged FULL requirements |
| **EVIDENCE_UNAVAILABLE** / **VALID_ABSTENTION** | 3 INSUFFICIENT + 3 UNSUPPORTED | Not optimized into FULL |
| **BUDGET_EXHAUSTION** | 12-turn cap | Budgets unchanged (12 turns, 32 Qloo) |
| **ENTITY_TYPE_MISMATCH** | Possible contributor to empty probes | Probe policy unchanged; Channel A first so type probes hit pool tags |
| **RUNTIME_FAILURE** | None identified on 8C | Finish blocker from HIGH evidence-base targets was a **new** 8D defect, fixed before evals |

Not grouped as generic “the agent failed.”

## 5. Territory-Level Analysis

Without the 8C result payload, per-territory rows cannot name original candidates.

Aggregate:

| Slot | Count | How discovered (inferred) | Why the class |
| --- | --- | --- | --- |
| Proposed | 4 | Mix of agent hypotheses and at most one grounded candidate | Hypotheses counted as viable, so Channel A stopped early |
| Resolved to a Qloo concept | 1 | The one non-empty probe path | The other three never got members |
| PARTIAL | 1 | The resolved candidate, comparison set incomplete | Valid PARTIAL > invalid FULL |
| INSUFFICIENT | 3 | Empty or unanchored hypotheses | Honest when Qloo returned no members |
| UNSUPPORTED family | 3 | Same | Not treated as missed FULL |

Counterfactual (recorded 5B.3 Channel A, **not** this runtime): related entities → related profiles → pool concepts yielded three FULL territories (Art and culture, Bohemian lifestyle, Avant-garde experimental fashion) and Japanese drama INSUFFICIENT, 32 Qloo, `BUDGET_EXHAUSTED`. That path was **legal inside the original 12-turn / 32-call budget**. It is not claimed as a guaranteed live 8D outcome.

## 6. Representation Failures

Root mechanism: `viableFrontierCandidates` previously counted unsupported `agent_hypothesis` shells. Four hypotheses filled `FRONTIER_TARGET` (4). The explore skill deactivated. Channel A related-entity profiles were never used as the candidate source.

Fix: a candidate counts only if it has `qlooSupport`, or it is in-flight `qloo_evidence` and not probe-exhausted. Empty hypotheses no longer fill the quota.

## 7. Tool Decision Quality

Sprint 8C live parent: 5 invalid actions across 12 turns.

| Class | Before | After |
| --- | --- | --- |
| VALID_FIRST_ATTEMPT | Baseline eval 0.957 first-attempt (synthetic; not live Haiku) | Unchanged measurement arm |
| INVALID_ACTIONS | Live 5; retries of `NO_VALUE` | `FRONTIER_EVIDENCE_PENDING` + `NO_VALUE` for unproductive hypothesis re-probes |
| DUPLICATE_ACTIONS | Repeated tag queries / profiles | Repeated `qloo_find_tags` is `NO_VALUE_ACTION`; identical calls remain `DUPLICATE_ACTION` |
| LOW_VALUE_REPEATED_PROBES | 12 empty probes | First empty hypothesis probe is exploration; a second is refused while unused pool entries remain |
| UNEXECUTABLE / BUDGET_REJECTED | Unchanged gates | Unchanged |

Invalid-action root causes on 8C, distinguished without the turn log:

- **inappropriate tool choice / stale plan** — hypothesized tags probed before related entities existed.
- **schema misunderstanding** — not isolable; no `INVALID_ARGUMENTS` count was reported.
- **unsupported tool arguments** — not isolable.
- **model reasoning failure** — 5 invalid / 12 turns; prompts now say do not retry refused codes.

Frozen scripted evals (`dtd-near-duplicate`) still probe already-proposed hypotheses before Channel A. In-flight candidates whose observed tags match the proposed label remain legal so those cases are not broken. That is not a benchmark-name shortcut.

## 8. Qloo Evidence Acquisition

Channel A remains: related take 8, first 6 related profiles in Qloo order, canonical `frontierConcepts`.

New rules:

1. Related entities must be fetched before ungrounded hypothesis probes (`FRONTIER_EVIDENCE_PENDING`).
2. Tags already in `frontierConcepts` may be probed as soon as they appear (partial evidence base is usable).
3. Remaining related profiles stay HIGH while viable candidates < target, **without** an entity-id target (that HIGH must not block `finish` — runtime finish treats HIGH+target as a territory blocker).
4. Canonical entity validation, comparable-evidence requirements, and 7000 ms spacing are unchanged.

No concept is preferred because it is likely to yield FULL.

## 9. Reference Selection

Unchanged. `build_comparison_set` v3, MEANINGFUL-only `referenceCandidates`, target entity type, `REFERENCES_PENDING` before target analysis. No new cultural compatibility score.

## 10. Investigation Stopping

| Behavior | Rule |
| --- | --- |
| Sufficient-evidence stop | Unchanged sufficiency v2/v3 |
| Premature stop from quota inflation | Closed: unsupported hypotheses do not fill `FRONTIER_TARGET` |
| Unproductive repeated probes | Second empty hypothesis probe → `NO_VALUE_ACTION` if unused pool remains |
| Last-two-turn completion reserve | Unchanged (candidates with members first) |
| Agent rewriting limits | Still impossible |

The agent may still spend turns on Channel B after the evidence base is complete. That is allowed lateral search, not a self-authored budget.

## 11. Context Improvements

Preserved Sprint 8C assembly (~1.4 s live). No new context-engineering subsystem.

Added only where 8C decisions failed:

- `focus.outstanding` leads with the evidence-base gap call.
- compact `evidence.alreadyCollected` (`profiledEntityIds`, `searchedQueries`) only when non-empty, bounded, < 800 chars in tests.
- prompts: fetch related first; probe pool tags; do not retry `NO_VALUE_ACTION` / `DUPLICATE_ACTION` / `FRONTIER_EVIDENCE_PENDING` / `FRONTIER_EVIDENCE_BASE`.

## 12. Runtime Skill Improvements

Seven skills. Only `explore_candidate_territories` changed, **v5** (already the 8D pin in `agent-sprint4.test.ts`).

| Skill | Change |
| --- | --- |
| interpret_request v1 | none |
| resolve_brand v1 | none |
| resolve_territory v5 | none |
| build_territory_representation v4 | none |
| build_comparison_set v3 | none |
| explore_candidate_territories **v5** | Channel A first; pool probes allowed; hypotheses do not fill quota; do not retry refused codes |
| analyze_territories v2 | none |

No eighth skill. Permissions unchanged.

Offline skill success for explore v5 is 0.273 across 11 synthetic runs (includes deliberately failing / sparse-frontier scripts). Not a live Haiku rate.

## 13. Before/After Competence

| Check | Before (8C) | After (8D) |
| --- | --- | --- |
| Synthetic agent eval | 53/53 | **53/53** |
| Runtime evaluators v2.1 | 0 failures | **0 failures** |
| Baseline valid-tool rate | ≥ 0.95 required | **0.976** |
| Benchmark leakage | 0 | **0** |
| G3 unseen brands | PASS | **PASS** (Saffron & Salt, Lumen Play, Kestrel Outfitters) |
| Hypotheses fill quota | yes | **no** |
| Ungrounded hypothesis probe before related | legal | **`FRONTIER_EVIDENCE_PENDING`** |
| Live parent FULL/PARTIAL | 0 / 1 | **not re-run** |

No invalid accepted FULL in synthetic evals. Evidence standards unchanged.

## 14. Research Consistency

Repeatability is **not** forced identity of candidate names.

Synthetic: `pnpm eval:agent` 53/53 twice in this sprint (test file + harness). Baseline frontier (`ir-frontier`, `s51-frontier-canonical-anchor`, `s5-frontier-incidental-excluded`) complete after the finish-blocker fix.

Live frontier-stability repetitions: **not run**.

## 15. Frontier Stability

Frozen `frontier-stability-criteria-v1` / metrics v3 **unchanged**. Thresholds not moved.

Last live stability evidence remains Sprint 5A.2 / 8B. Empty supported overlap is still not counted as success (metrics v3). This sprint does not claim a new stability pass.

## 16. Held-Out Generalization

No hold-out brand or territory name was added to `backend/src/agent`.

| Set | Result | Label |
| --- | --- | --- |
| `gen-unseen-brand-territory` | PASS | synthetic eval |
| G3 Saffron & Salt / Lumen Play / Kestrel Outfitters | COMPLETE with supported evidence | synthetic, not live |
| Query eval HELD_OUT | 24/24 vs freeze hash `ad051836dac7` | offline gate replay, not Haiku LU |
| Live unseen brands | **not run** | |

## 17. C9 Validation

C9 = `run-evaluators-v2.1` must have 0 failures on prescribed live cases.

| Evidence | Status |
| --- | --- |
| Offline 53 synthetic scenarios | **0 evaluator failures** |
| Grader `TAG_TYPE_EVIDENCE_VALID` | **unchanged** |
| Sprint 8B focused live L-C2 / L-E1 | retained; **not re-spent** |
| Prescribed seven-case live C9 | **not run** |

Current C9 live evidence is **not** the full gate.

## 18. Full Live Readiness Gate

Manifest: `evals/agent/sprint-8d-live-gate-manifest.json` (`sprint-8d-live-gate-manifest-v1`).

- Gate `agent-readiness-gate-v3`
- Evaluators `run-evaluators-v2.1`
- Stability `frontier-stability-metrics-v3` + `frontier-stability-criteria-v1`
- Prescribed model and baseline: L-M1, L-M2, L-M3, L-C1, L-C2, L-E1, L-E2
- Frontier stability: L-E1, L-E2 × 3
- Conservative reserve: **$2.50** (proposed test budget, not authorization)

Authorization checklist:

1. Manifest verified.
2. Keys present on disk.
3. Maximum planned exposure $2.50 as written.
4. **User-approved spending: no.**
5. Frozen cases/evaluators confirmed.
6. No unbounded repetitions in the manifest.

**Status: `LIVE_GATE_BLOCKED_BY_APPROVAL`.**

Credentials on disk are not this authorization. Do not claim readiness from partial evaluations.

## 19. Effort Comparison

Production remains effort **high**.

Paired live medium vs high: **not run** (would require approved spend). Sample size inadequate → retain high.

No other model family.

## 20. Latency Regression

| Arm | 8C | 8D | Notes |
| --- | --- | --- | --- |
| Live parent wall | 227 412 ms | **not re-run** | budgets/spacing unchanged |
| Synthetic move | 117 ms | 102 ms | `perf:agent`, spacing 0 |
| Synthetic compare | 231 ms | 200 ms | same |
| Synthetic frontier | 7 ms | 6 ms | shared-provider quirk, pre-existing |
| Context assembly live | 1 427 ms | not re-run | assembly code not rebuilt |

Added Qloo calls: none required by the new refusals (they **save** ungrounded calls). Channel A HIGH may add related-profile calls on live frontier runs; that is justified evidence-base collection, not measured live this sprint.

## 21. Cost Per Useful Outcome

| Run | Model USD | Qloo calls | Useful (FULL+PARTIAL, invalid FULL=0) | Cost / useful |
| --- | --- | --- | --- | --- |
| 8C live parent | ≈ $0.0179 | 28 | 1 PARTIAL | ≈ $0.0179 / useful result |
| 8D live | **not run** | — | — | — |
| Synthetic eval | n/a | — | — | scripted/baseline, $0 |

No new live model spend this sprint.

## 22. Evidence Methodology

Preserved:

- Qloo provenance and within-call comparisons
- Canonical entity identities
- Valid reference evidence
- Honest INSUFFICIENT / UNSUPPORTED / PARTIAL
- `REJECTED_FOR_NOW` for the unapproved numerical elasticity index (`pnpm eval:elasticity` structural 27/27; index not accepted)

Rejected: fabricated relationships, incomparable rankings, unsupported superiority, arbitrary elasticity, invented distances, business-success predictions.

## 23. Product Regression

Frontend product source was not changed.

| Check | Result |
| --- | --- |
| Frontend unit tests | 14/14 |
| Living Atlas E2E | **16/16** (Chromium 1248 installed locally; first attempt failed because the Playwright browser binary was missing, not because of product changes) |
| Parent/child query tests | PASS (`query-intelligence`, contextual C01/C15) |
| Evidence attribution | unchanged contracts |

No Jacquemus-specific production logic in `backend/src/agent` (G2 / `ts-benchmark-lookup` / leakage 0).

## 24. Verification

Node 22.23.2, pnpm 10.26.0.

| Command | Result |
| --- | --- |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS — backend 57 files / **729** tests; frontend 14/14 |
| Sprint 8D focused tests | PASS — 11 tests in `backend/tests/sprint-8d.test.ts` |
| `pnpm build` | PASS |
| `pnpm check:secrets` | PASS — 364 repo files, 19 browser bundle files |
| `pnpm eval:methodology` | PASS 19/19, `LIVE_QLOO_VALIDATION_NOT_RUN` |
| `pnpm eval:agent` | PASS 53/53, runtime evaluators 0, `LIVE_AGENT_MODEL_VALIDATION_NOT_RUN` |
| `pnpm eval:elasticity` | structural 27/27; **Relative Elasticity Index `REJECTED_FOR_NOW`** |
| `pnpm eval:live` | PASS 19/19 live-fixture + 3/3 recorded, offline |
| `pnpm eval:query` | offline gate PASS vs targets; `LIVE_HAIKU_QUERY_VALIDATION_NOT_RUN`; X06 listed for review |
| `pnpm perf:agent` | move 102 ms, compare 200 ms, frontier 6 ms (synthetic) |
| `pnpm test:e2e` | 16/16 |
| `pnpm smoke:offline` | `OFFLINE_SMOKE_PASS` |
| `pnpm eval:agent:live` | **NOT RUN** — `LIVE_GATE_BLOCKED_BY_APPROVAL` |
| `pnpm eval:query -- --live` | **NOT RUN** |
| Railway / Vercel | **NOT TOUCHED** |

Command exit 0 is not treated as an accepted evaluator gate when the underlying gate reports failure. Elasticity index remains rejected. Agent live readiness remains not ready.

## 25. Known Limitations

- 8C live parent per-territory names were not persisted.
- Live 8D parent / full gate / effort comparison / frontier-stability repeats were not run.
- Channel A HIGH may add related-profile Qloo calls on live frontier; wall impact unmeasured.
- Explore skill synthetic success 0.273 includes sparse and failing scripts; it is not a live competence rate.
- In-flight hypothesis probes that match a proposed label are still allowed before the evidence base (required by frozen scripted cases). Haiku can still waste a first empty probe on a proposed hypothesis; the second is refused once the pool exists.
- `exclusiveSumExceedsCovered` on live traces is unchanged.

## 26. Remaining Agent Weaknesses

1. Live Haiku may still propose Channel B before Channel A; the runtime now refuses **unproposed** hypothesized probes and does not fill the quota with empty shells, but it cannot force the model to follow HIGH.
2. Representation recovery and type selection are unchanged; 8C’s 1-of-4 resolved rate is untested live after this sprint.
3. C9 full live gate is still the readiness blocker.
4. Frontier stability live S1/S2/S3 remain historically weak (5A criteria).
5. Medium effort is uncompared.

## 27. Deployment Readiness

**Not this sprint.** Railway MCP not called. Vercel not migrated, not promoted, protection unchanged. Fastify backend compatibility preserved. Feasibility artifacts intact.

Agent readiness: **`AGENT_MODEL_NOT_READY`.**

## 28. Recommended Next Sprint

Do not start Railway deployment automatically. Do not publish.

1. If the owner authorizes the $2.50 reserve, run `evals/agent/sprint-8d-live-gate-manifest.json` exactly (7 model + 7 baseline + L-E1/L-E2 × 3). That is the only path to `AGENT_MODEL_READY`.
2. On that live parent, report Channel A call order, invalid-action codes, viable-candidate counts, and FULL/PARTIAL/INSUFFICIENT with attribution — persist the investigation summary (`perf-live-trace` now writes `investigation`).
3. Only then consider hosting.

Until the frozen live gate passes, keep the Living Atlas on the persistent backend and do not claim research readiness from synthetic 53/53.
