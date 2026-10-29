# Sprint 9N — Discovery-to-Decision Intelligence Optimization

**Status:** `SPRINT_9N_COMPLETE_WITH_LIMITATIONS` · `AGENT_MODEL_NOT_READY` (unchanged; no live readiness run) · `LIVE_QLOO_VALIDATION_NOT_RUN` · `LIVE_AGENT_MODEL_VALIDATION_NOT_RUN`

| | |
|---|---|
| Starting point | `main` at `00cc28535cfca98886a8f13271c864a0e0c05239` (verified equal to `origin/main` on 2026-10-29) |
| Branch | `sprint/9n-discovery-decision-intelligence` (upstream unset so a bare push cannot reach `main`) |
| Provider use | none: no Qloo call, no model call, no deployment, no change to keys, billing, quotas or the public evaluation |
| Production | unchanged; `main` remains the fallback release |

## 1. What was diagnosed

### 1.1 The Uniqlo → Manga run cannot be replayed

Agent jobs are in-process (AGENTS.md, Living Atlas rule 4). The hosted run's trace exists only in the Railway process memory, not in PostgreSQL, the repository or a saved report. Its exact cause is therefore **not established**. What the code does establish:

- A representation with one VALID exemplar is accepted (`representation-planner.ts`), and a represented territory cannot be re-validated (`tool-registry.ts`, "already has a validated representation").
- A reference is MEANINGFUL only when its tag is on the brand's own profile or on **≥ 2 validated target-exemplar profiles** (`semantic-comparison.ts`, now `MEANINGFUL_EXEMPLAR_SUPPORT`).
- So with one validated exemplar (the reported "only Osamu Tezuka passed"), every exemplar-derived reference is at most WEAK. Only Uniqlo's own profile tags could have become references, and they then needed `artist` members.

That is a supported **hypothesis about the failure class**, not a finding about the run. It is reproduced synthetically (`d2d-thin-target-panel`) and listed as a Sprint 9O target.

### 1.2 The dominant waste in the traces we do have

The seven complete live agent results stored in `evals/qloo-value/artifacts/` (Haiku, pre-9N engine) were read as run:

| Run | Outcome | Empty brand-independent probes | What happened |
|---|---|---|---|
| L-M1 Aesop → coffee | PARTIAL | 7 | the 4 place-exemplar profiles were collected at iteration 5, then 7 **brand-profile** media/music/genre tags were probed with `place`; all empty |
| L-M2 Yeti → fly fishing | PARTIAL | 5 | brand-profile tags were probed with `place` **before** the exemplar profiles were collected |
| L-M3 Le Creuset → tea | PARTIAL | 4 (+2 timeouts) | the same pattern; then turns ran out |
| L-C2 Liquid Death compare | PARTIAL | 9 | target probes plus brand-profile genres |
| L-C1 Rapha compare | FULL | 2 | three named targets; no reference construction was needed |
| L-E1 / L-E2 frontier | PARTIAL | 9 / 6 | frontier runs (outside the comparison changes) |

Across the 7 artefacts: **42 empty probes, 4 Qloo-facing calls after completion had already turned infeasible, 10 tool timeouts** (`pnpm eval:d2d`, recorded baseline).

The root cause in code: `referenceCandidates` ranked a brand-profile genre (a tag carried by a *brand*) equally with a tag carried by the target's own *place* exemplars. Nothing in run state said which candidates had any evidence of applying to the comparison type, and the namespace rule needed two empty probes per namespace before it acted. The trace supports this; it does not claim the model chose badly for any other reason.

### 1.3 A second, latent cause found while building the eval

The structural deduplicator (`concept-dedup.ts`) counts concept co-occurrence across profiles. For a reference candidate found on the target's exemplar profiles, those are exactly the profiles that make it MEANINGFUL, so the same evidence also made it a NEAR_DUPLICATE whenever only the target's exemplars were profiled. AGENTS.md 5A.2 rule 4 already states the principle ("co-occurrence in the profiles a candidate was discovered from never makes two concepts duplicates"), but it was implemented for frontier discovery only.

### 1.4 The repeat-risk in the product

`measureQuestion` (frontend) offered "How far can {brand} extend into {target}?" whenever a run had no reference territory. For a comparative run that built no reference, as with Uniqlo → Manga, that is the same paid question again. The direction panel also offered "Investigate again".

## 2. Architecture decision

Reuse, do not add a planner. Comparison feasibility is a **named projection** of what the runtime already derives (readiness, `referencePlan` completion arithmetic, semantic candidates, the probe ledger), plus four evidence rules. See [ADR-001](ADR-001-comparison-feasibility.md).

```
loop turn ─→ sufficiency ─→ recordPlans ─→ recordFeasibility (trace.feasibility, when it changes)
         └→ context: focus.feasibility (read-only view) + focus.outstanding[0] = its nextAction
tool call ─→ valueOfToolCall ─→ … REFERENCE_NAMESPACE_BARREN ─→ referenceProbeRefusal (new) ─→ …
analyze   ─→ snapshotFeasibilityBeforeAnalysis ─→ runAnalysis
finalize  ─→ result.comparisonFeasibility (the snapshot) ─→ decisionCard() in UI, report and evals
```

### 2.1 `comparison-feasibility/v1` (`backend/src/agent/feasibility.ts`)

- `FEASIBLE`: ≥ 3 meaningful represented territories of one type, or enough references already probed with members or proposed.
- `UNCERTAIN`: completion depends on uncollected evidence. Examples: the target is not anchored or not represented; profiles still to be collected; unprobed candidates; a thin target panel. **UNCERTAIN is never treated as INFEASIBLE.**
- `INFEASIBLE`: `referencePlan` is blocked (`TURN_BUDGET`, `QLOO_BUDGET`, `CANDIDATE_SLOTS`, `SKILL_BUDGET`, `NO_MEANINGFUL_REFERENCE_CANDIDATES`, `NO_REFERENCE_YIELD`), the target is unsupported, or the target has concept-only evidence.
- `repeat`: `LIKELY_REPEATS` when an INFEASIBLE blocker is Qloo's evidence, which does not change between runs. `MAY_CHANGE` when it was the run's own budget or progress.
- The model cannot write it: there is no tool, action or decision field for it (tested).

No methodology threshold changed: the minimum set of 3, `MIN_REFERENCE_POOL`, the semantic validator and representation quality are untouched.

### 2.2 Four evidence rules (enforce policy only)

1. **Type evidence.** A candidate observed on the tag profile of an entity of the comparison type (a member of a pool of that type, or an entity Qloo typed so) ranks first. A namespace's name never implies a type; only observed profiles count (AGENTS 5A.2 rule 2).
2. **Bounded reference probing.** After `REFERENCE_EMPTY_PROBE_LIMIT = 4` empty reference probes, while references are still missing and no usable probed candidate covers them, FULL is not feasible (`NO_REFERENCE_YIELD`).
3. **Thin-panel discovery.** With fewer than 2 validated exemplars, their profiles are not reference discovery, because they cannot produce a MEANINGFUL reference.
4. **Reference co-occurrence.** In the co-occurrence layer of `structuralDuplicate`, the target's exemplar profiles count as the reference's discovery source. Pool-overlap duplicates (Jaccard ≥ 0.6, containment ≥ 0.8) still apply unchanged.

The executor guard `referenceProbeRefusal` refuses only reference probes of the comparison type, never target, frontier or alignment probes:

- `COMPARISON_INFEASIBLE`: the plan is blocked, so no reference can complete the set.
- `REFERENCE_PROBE_LIMIT`: rule 2.
- `REFERENCE_DISCOVERY_PENDING` and `REFERENCE_TYPE_EVIDENCE_PENDING`: **deferrals, not bans.** A type-less candidate waits while the validated exemplars' profiles are uncollected, or while enough type-evidenced candidates are unprobed. Deferrals apply only with `DEFERRAL_TURN_SLACK = 2` turns beyond what completion needs. Without that slack, a deferral regressed `s51-references-late-still-feasible`, live class L-C2 (found during the sprint; see §5).

`build_comparison_set` is bumped v3 → v4 (procedure, stopping conditions, evalIds).

### 2.3 Rollback switch

`CE_FEASIBILITY_POLICY=observe` (backend env) restores the Sprint 9M control flow exactly: ranking, discovery, deduplication, context and refusals. Feasibility is still recorded in the trace. Any other value, or none, is `enforce`. The switch is read once per runtime in `liveRuntimeFactory`, and the eval uses it as its "before" arm.

### 2.4 Decision Card (`packages/shared/src/decision-card.ts`, `decision-card/v1`)

A pure projection of one territory of one stored result. It is used by the live reading (`territory-reading.ts` → `DecisionCardView`), the HTML/PDF report (`network-report.ts`) and the evals.

- **Sections:** finding · why it is interesting · what the evidence supports · what remains uncertain · implication · next useful step.
- **Implication codes:** `SUPPORTED_FOR_EXPLORATION` (natural fit or credible stretch, robustness HIGH/MEDIUM), `PRELIMINARY_HYPOTHESIS`, `RELATIVE_FIT_NOT_SUPPORTED` (robust cultural break), `INCONCLUSIVE` (unmeasured, or class "insufficient evidence").
- **No numbers of its own:** every number shown is a recorded value. `decisionCardViolations` rejects other digits, raw codes and commercial wording.
- **Next actions follow `repeat`:** a card never suggests asking again when Qloo's evidence blocked the question. It offers a named comparison with two other baseline directions (a different question) or qualitative research with people.

### 2.5 Product

- `measureQuestion` treats `comparisonFeasibility.repeat === "LIKELY_REPEATS"` as "compared", so the one-click follow-up becomes "Compare {target} with {A} and {B}" or the composer, never the same move.
- **Direction panel:** "Measure cultural fit" (was "Investigate this direction"; `data-testid` unchanged). A short "Two ways to go further" block explains that Explore uses the recorded, free scan connections and that Measure starts a live, paid investigation that can honestly end not measured. When the last measurement `LIKELY_REPEATS`, the "Measure again" button is replaced by an explanation, and the card's named comparison stays available.
- **Guided entry:** the home page links two authentic recorded reports. One is the existing Patagonia report. The other, Crocs 2026-10-29, is a byte-identical copy of `docs/sprint-9l/evidence/live-report.html` (sha256 `ab01e2f2…30cc03`), showing one validated finding (fine dining, steady credible stretch) and one unmeasured direction (fiction). No new provider call was made, and nothing is presented as newly generated.

## 3. Modified files

| Area | Files | Why |
|---|---|---|
| Contract | `packages/shared/src/agent.ts`, `decision-card.ts`, `index.ts` | `ComparisonFeasibility`, `trace.feasibility`, `result.comparisonFeasibility` (optional, backward compatible); the shared card |
| Runtime | `backend/src/agent/feasibility.ts` (new), `reference-strategy.ts`, `semantic-comparison.ts`, `concept-dedup.ts`, `tool-executor.ts`, `context.ts`, `model/provider.ts`, `runtime.ts`, `finalizer.ts`, `state.ts`, `skills/definitions.ts`, `api/agent.ts` | §2.1–2.3 |
| Frontend | `lib/territory-reading.ts`, `lib/network-report.ts`, `lib/research-network.ts`, `components/research/{DecisionCard,TerritoryReading,ResearchNetwork,BrandDiscovery}.tsx`, `app/globals.css`, `public/examples/crocs-2026-10-29.html` | §2.4–2.5 |
| Evals | `evals/discovery-decision/cases.json` (new), `backend/scripts/d2d/harness.ts`, `backend/scripts/eval-d2d.ts`, `agent-eval-harness.ts` (per-run arm, `brand_tags_first` instrument), `evals/agent/scenarios.json` (+1 twin, 1 pinned), `evals/fixtures/synthetic/agent/world.json` (append-only SYN-…-9Nxx entities) | §4 |
| Tests | `backend/tests/agent-sprint9n.test.ts`, `decision-card.test.ts`, `d2d-eval.test.ts`, `agent-sprint4.test.ts` (version pin), `frontend/src/lib/{research-network,network-report}.test.ts` | §4 |

## 4. Evaluation

### 4.1 Discovery-to-Decision suite (`pnpm eval:d2d`)

38 cases: 8 new synthetic runtime cases, 17 existing agent scenarios by reference, 7 recorded live artefacts as run, and 6 named live targets reported `NOT_RUN`.

- Runtime and scenario cases run twice on identical fixtures, policy, budget and methodology: arm **observe** (Sprint 9M) and arm **enforce** (9N default).
- A case that reached FULL or passed in observe but not in enforce is a regression.
- `brand_tags_first` is a documented test instrument. It reproduces the L-M1/L-M2 behaviour (brand-profile candidates first) and, like a model reading `rejectedApproaches`, stops proposing a refused candidate.

**There is no independent holdout.** Every runtime case was written in this sprint after the live traces were read. Sprint 9O live runs are the first independent test.

Matched results (25 cases):

| Metric | observe (9M) | enforce (9N) | Change |
|---|---|---|---|
| Qloo calls | 411 | 400 | −2.7% |
| Agent iterations | 221 | 219 | −0.9% |
| Empty brand-independent probes | 52 | 38 | **−26.9%** (15 applicable cases; target ≥ 20%) |
| Refusals that saved a call | 11 | 13 | +2 |
| FULL territories | 36 | 36 | no change |
| Partial findings with limitation + next action | 21/21 | 21/21 | — |
| Regressions | — | 0 | — |
| Unsupported classifications · cross-call comparisons · decision-card violations (all runs, both arms, recorded) | 0 · 0 · 0 | 0 · 0 · 0 | — |

Per case (Qloo calls / empty probes / FULL territories):

| Case | observe | enforce | enforce feasibility |
|---|---|---|---|
| `d2d-live-type-evidence` (L-M pattern, instrument) | 23 / 4 / 3 | 21 / 1 / 3 | FEASIBLE |
| `d2d-type-evidence-plain` | 23 / 4 / 3 | 21 / 1 / 3 | FEASIBLE |
| `d2d-thin-target-panel` (Uniqlo → Manga class, instrument) | 12 / 6 / 0 | 11 / 5 / 0 | INFEASIBLE / NO_REFERENCE_YIELD · LIKELY_REPEATS |
| `d2d-thin-target-panel-plain` | 12 / 6 / 0 | 11 / 5 / 0 | INFEASIBLE / NO_REFERENCE_YIELD · LIKELY_REPEATS |
| `d2d-named-comparison` (the card's suggested next step) | 26 / 3 / 3 | 26 / 3 / 3 | FEASIBLE |
| `d2d-budget-exhausted` | 9 / 1 / 0 | 9 / 1 / 0 | INFEASIBLE / QLOO_BUDGET · MAY_CHANGE |
| `d2d-provider-error-reference` (failed calls are not evidence) | 23 / 3 / 3 | 21 / 1 / 3 | FEASIBLE |
| `d2d-partial-provider-reference` | 23 / 4 / 3 | 21 / 1 / 3 | FEASIBLE |
| `ref:rv-place-representation` | 16 / 3 / 0 | 15 / 2 / 0 | INFEASIBLE / NO_REFERENCE_YIELD · LIKELY_REPEATS |
| the other 16 existing scenarios | identical in both arms | | |

**Contribution of each rule (measured).** Disabling rule 4 (reference co-occurrence) alone:

- the type-evidence cases fall back to 4 empty brand-tag probes;
- the matched reduction drops from −26.9% to −9.6%;
- two expectations fail.

The rule is therefore kept as load-bearing.

**Corrected during the sprint.** A first version of the synthetic fixture showed +12 FULL territories in enforce. That came from a fixture artefact: a coffee place also carried the tea-salon tag and was used to represent the reference. Once the artefact was removed, observe also reaches FULL. The reported FULL yield is therefore unchanged, not improved.

### 4.2 All gates (local, 2026-10-29, Node 22.23.2)

| Command | Result |
|---|---|
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | backend 933 tests (81 files) pass; frontend 110 pass |
| `pnpm eval:methodology` | pass |
| `pnpm eval:live` | pass (27/27 replay, 3/3 historical) |
| `pnpm eval:elasticity` | pass (27/27) |
| `pnpm eval:agent` | pass, 54/54 scenarios (53 + 1 new twin); `LIVE_AGENT_MODEL_VALIDATION_NOT_RUN` |
| `pnpm eval:query` | pass |
| `pnpm eval:d2d` | pass (above) |
| `pnpm build` | pass |
| `pnpm check:deployment-config` | `OFFLINE_DEPLOYMENT_CONFIG_PASS; REMOTE_PLATFORM_STATE_NOT_VERIFIED` |
| `pnpm check:secrets` | pass |
| `E2E_MODE=production pnpm test:e2e` | 58/58 pass (synthetic job API; `docs/` untouched) |
| `pnpm smoke:offline` | `OFFLINE_SMOKE_PASS` |
| `pnpm smoke:docker` | NOT_RUN locally (no Docker daemon); the CI `docker` job on PR #47 passed (run 40909549775), as did CI `verify` and `e2e` |

`pnpm eval:live` checks recorded captures only; it is not a live Qloo run.

## 5. Failures found and fixed during the sprint (each has a regression test)

| Failure | Fix | Test |
|---|---|---|
| The observe-arm context compared candidate objects across two calls, giving an empty list | compare by `tagId` | `ref:*` cases identical in both arms |
| The probe limit counted near-duplicate pools as "productive", so 6 empty probes still ran | count missing references, not productive pools | `agent-sprint9n` "NO_REFERENCE_YIELD" |
| A deferral without turn slack regressed `s51-references-late-still-feasible` (FULL → none) | `DEFERRAL_TURN_SLACK` | the scenario, plus `agent-sprint9n` "never defers without slack" |
| `s51-reference-namespace-barren` asserted a 5A.1 refusal that enforce now pre-empts | pinned to observe (5A.1 rule tested in isolation, assertion unchanged); new twin `s9n-reference-probes-deferred` (8 Qloo calls vs 10) | both scenarios |
| The eval checked status `"error"`, but the trace uses `"failed"`, so the failed-call check was vacuous | `"failed"` (caught by typecheck) | `d2d-provider-error-reference` now records 2 failed calls |
| A card with a FULL route but no class stated no reason | route-based reason | property test over 200 route × class × robustness × position combinations |
| Digits inside venue names were flagged as invented numbers | longest-label-first stripping | recorded-artefact card test |

## 6. Known limitations

- **Live behaviour is unmeasured.** Every improvement above is synthetic or recorded-as-run. Whether Haiku follows `focus.feasibility` and type evidence live is for Sprint 9O.
- **No independent holdout** (§4.1).
- **Discovery (Workstream A) logic is unchanged.** Frontier selection was already grounded (5A.1–8D). 9N adds discovery invariants to the eval (grounded, distinct, no unsupported hypothesis analyzed: all pass) and the card's "why it is interesting" (the baseline's own observation, closest matches, shared signals). Non-obviousness is a qualitative reading, never scored.
- **Same-brand comparison presentation (Workstream G)** relies on the existing ranked list in the reading, plus the card's comparison-scope sentence. No new comparison view was built.
- **Pre-existing:** a reference exemplar may also be a member of the target's tag pool (seen in the first fixture). No rule forbids it, and it is not changed here.
- **Older results** (no `comparisonFeasibility`) get route-based reasons and no `repeat` advice.
- **Docker smoke** was not run locally; it passed in CI on PR #47.

## 7. Safety and spending

- **No provider call of any kind.** Evals read the synthetic world or stored artefacts. CI stays provider-free (the workflow is untouched).
- **Unchanged:** public evaluation id, expiry, per-network quotas, global caps, kill switch, idempotency, provider-call accounting, the one-replica contract, migrations (none added), claim validation, evidence sufficiency and every methodology threshold.
- **New flag:** only `CE_FEASIBILITY_POLICY`. It defaults safely to `enforce`, and `observe` is the rollback. It is not added to any deployment.

## 8. Rollback

1. Set `CE_FEASIBILITY_POLICY=observe` on Railway, then redeploy or restart. This restores the 9M agent control flow; the decision card and UI copy remain.
2. Or do not merge the branch: production stays on `00cc285`.
3. Or revert the merge commit. There is no data migration, and the result field is optional.

## 9. Model quality framework (offline, not run)

The production model stays `claude-haiku-5-5`. A controlled comparison would:

1. run `pnpm eval:agent:live -- --arms baseline,model --stability 3 --approved-usd <N>` once per model, with `AGENT_MODEL` (dev-only override) on the same cases, tools and budgets;
2. score both output directories offline with `pnpm eval:d2d -- --score <dirA> <dirB>` (same per-run metrics as this sprint).

An upgrade is justified only if, on matched cases with no regression in unsupported classifications, claim violations or budget use, the stronger model shows **all** of:

- fewer empty or refused reference probes per run;
- more semantically valid FULL comparisons;
- no rise in cost per defensible finding that the owner does not accept.

A higher FULL rate alone is not a reason (AGENTS 5A rule 3). **No paid comparison was run, and none should be without approval.**

## 10. Sprint 9O live-test recommendations

All need explicit owner approval of Qloo and USD caps. Use `pnpm eval:agent:budget` first.

1. **Uniqlo → Manga** (hosted direction handoff). Expect `comparisonFeasibility` with blocker `THIN_TARGET_PANEL` or `NO_REFERENCE_YIELD` if the class hypothesis holds, and a card offering a named comparison instead of "measure again". Record the full trace this time (save the job result JSON).
2. **Crocs → Fine dining** and **Crocs → Fiction**: regression (is the credible stretch preserved?) and partial explanation.
3. **Patagonia → Ethical Consumption, Luxury jewelry, Nightclubs**: repeat-risk wording, plus Qloo calls before abstention, versus the 9M evidence.
4. **One controlled L-M-class move** (e.g. Aesop → coffee): count empty brand-profile probes against L-M1's 7.
5. Check desktop and mobile journeys, HTML/PDF export parity with the live card, saved research, and judge access. Confirm `CE_FEASIBILITY_POLICY` is unset (enforce) on the deployed backend.
6. Re-run the readiness gate only if competence criteria are pre-registered (AGENTS 5A.1 rule 5).

## 11. Unresolved questions

- Should a one-exemplar target panel steer representation toward another entity type *before* the panel is accepted? That changes the representation skill and would need its own eval evidence.
- Is `REFERENCE_EMPTY_PROBE_LIMIT = 4` right live? It is a bound on calls, not on evidence, chosen from L-M1–L-M3 (4–7 empty probes before infeasibility). Revisit with 9O traces, not after seeing results.
