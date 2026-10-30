# Sprint 10B: agent research competence

**Status: `SPRINT_10B_COMPLETE_WITH_LIMITATIONS`. Readiness: `AGENT_MODEL_NOT_READY`. Model validation: `LIVE_AGENT_MODEL_VALIDATION_NOT_RUN`.**

- The diagnosis, the evaluation and one narrowly targeted context change are implemented and validated offline.
- No improvement in Haiku's decisions is claimed. The paired Haiku decision run is pre-registered and costs about $0.81 with no Qloo calls, but it was not authorized in this sprint.

## 1. Starting state

| Item | Value |
|---|---|
| Base | `main` at `62ca552` (Sprint 10A merged, PR #50), verified against `origin/main` on 2026-10-30 |
| Branch | `sprint/10b-agent-research-competence` |
| Isolation | Separate worktree `~/dev/ce-10b`. The owner's dev servers (:3000, :4000) and the `~/dev/cultural-elasticity` checkout were not touched. |
| Devpost submission | **UNVERIFIED.** Nothing in the repository or the available tools confirms it. Deadline: 2026-10-30 23:45 EDT. |

## 2. Architecture decision

**No new planner, agent, tool or prompt section.** The audit (§4) shows that most wasted calls come from Qloo's sparse coverage and from deterministic probe and reference policy, not from model choices.

The largest model-side error class has one specific cause in the context. When a skill closes, `focus.nextAllowed` loses its tools without saying why, and the model keeps doing what it did on the previous turn.

The sprint therefore does three things:

1. **Measures decisions**, which no existing eval did: `eval:competence --decisions` and `--audit`.
2. **Fixes that context gap**: `focus.withdrawn`.
3. **Records the focus behind every decision in the trace**: `turn.focus`.

**Rejected alternatives:**

- **Re-ranking `COMPARISON_TYPE` probes.** The evidence shows a data limit, not a ranking error (§5).
- **Refusing probes the model chooses that differ from `nextProbe`.** That would remove model judgement for a 33-call class.
- **Prompt additions.** Unmeasurable offline, and the brief rules out prompt accumulation.

## 3. Failure taxonomy

These are evaluation labels only; no API enums were added. Mapping in `backend/scripts/competence/audit.ts`.

| Label | Observed as |
|---|---|
| `BAD_TOOL_SELECTION` | `NOT_EXPOSED`, `UNKNOWN_TOOL`, `WRONG_PHASE` refusals |
| `INVALID_ENTITY_TYPE` | Empty probe of a (tag, type) the runtime did not recommend; `PROBE_LIMIT_REACHED`; `NAMESPACE_TYPE_BARREN` |
| `UNPRODUCTIVE_REFERENCE` | Empty reference probe; `REFERENCE_NAMESPACE_BARREN`; `REFERENCE_PROBE_LIMIT` |
| `SEMANTIC_MISMATCH` | `ALTERNATE_ANCHOR_REFUSED`; reference outside the MEANINGFUL list (decision cases) |
| `MISSED_AVAILABLE_EVIDENCE` | Decision cases: evidence the context lists as usable was not used |
| `PREMATURE_STOP` | `FINISH_BEFORE_SUFFICIENCY`, `NOTHING_ANALYZED`, `REFERENCES_PENDING`; a non-FULL target stopped while completion still said FULL was feasible |
| `UNNECESSARY_CONTINUATION` | `DUPLICATE_ACTION`, `NO_VALUE_ACTION`, `EARLY_STOP`, `COMPARISON_INFEASIBLE` |
| `INEFFICIENT_RECOVERY` | Decision cases: an empty or exhausted strategy repeated, or a recovery path ignored |
| `CONTEXT_MISINTERPRETATION` | Decision cases: a refusal the model was shown is repeated |
| `MODEL_OUTPUT_INVALID` | `INVALID_MODEL_OUTPUT`, `INVALID_ARGUMENTS`, `INVALID_DECISION` |
| `QLOO_DATA_INSUFFICIENT` | Empty probe that followed the runtime's evidence-ranked `nextProbe` |
| `PROVIDER_FAILURE` | Tool call with status `failed` |
| `BUDGET_EXHAUSTED` | Run or skill budget spent |
| `INFRASTRUCTURE_FAILURE` | Harness or environment errors. These are excluded from agent outcomes, as with the 9O `live-0-harness-error` case. |

Each count is attributed to a cause: model decision, context, deterministic policy, Qloo data or infrastructure. **A failed comparison is not an agent failure by itself.**

## 4. Baseline competence findings (stored live Haiku runs, as run)

Command:

```
pnpm eval:competence -- --audit <dirs>
```

Output:

- all runs: `evaluation/decision-audit.{txt,json}`
- Sprint 5A.2 onward: `evaluation/decision-audit-5a2-onward.txt`

These are runs of earlier engines, read as they ran. Nothing was replayed through a provider.

| | All engines, 84 runs | Sprint 5A.2 onward, 33 runs |
|---|---|---|
| Valid-action rate | 2036/2189 (93%) | 800/867 (92%) |
| First-attempt-valid turns | 780/868 (90%) | 319/359 (89%) |
| Empty: probes that followed `nextProbe` | 87/126 (69%) | 87/126 (69%) |
| Empty: probes that deviated from `nextProbe` | 28/33 (85%) | 28/33 (85%) |
| Empty: probes with no ranked recommendation that turn | 80/103 (78%) | 80/103 (78%) |
| Non-FULL targets stopped while FULL was feasible | 0/19 | 0/14 |

**Count by cause, Sprint 5A.2 onward:**

| Cause | Count |
|---|---|
| Qloo data | 87 |
| Deterministic policy | 82 |
| Model decision | 54 |
| Context | 39 |
| Infrastructure | 22 |

The newest engine's trace (9O, Carhartt → Blue Collar) shows Haiku following `nextProbe` on every turn. All five probes were empty, and the territory was dropped honestly. That is `QLOO_DATA_INSUFFICIENT`, plus the handoff grounding gap that 9O fixed.

## 5. Root-cause analysis

1. **Qloo data is the largest single cause.**
   - Probes the runtime itself ranked were empty 69% of the time.
   - By priority:
     - `NAMESPACE_MEMBERS`: 10/10 productive.
     - `EXPLORATION`: 27/65.
     - `STRUCTURAL`: 2/17.
     - `COMPARISON_TYPE`: 0/36.
   - 33 of those 36 were the first probe of that type in their namespace, and the runs had seen members of the type elsewhere.
   - They were music and genre concepts probed for `book`, `place` or `brand` so that a comparison could share a type, and Qloo holds no such members.
   - Avoiding them would require inferring entity types from namespace names, which AGENTS.md forbids. **Not changed. This is a Qloo coverage limit on cross-domain type alignment.**
2. **Deterministic reference policy, pre-9N** (80 empty reference probes). This is the class 9N (type evidence) and 9O (runtime reference discovery, `build_comparison_set` v5) were built to address. **Its live effect is still unmeasured.**
3. **Context gap: tools withdrawn without a reason** (39 refusals since 5A.2; 66 across all runs).
   - `qloo_recommend` was called after `build_comparison_set` closed: 32 times. Some of those sets were already complete (C-FULL-1, L-C1); others were infeasible (L-C2, L-M1, L-M2).
   - `propose_territory` was called after `explore_candidate_territories` closed with proposed candidates still pending: 26 times (L-E1, L-E2).
   - Each refusal cost a decision and sometimes a repair call, but no Qloo call.
   - 9N's `focus.feasibility` already states FEASIBLE/INFEASIBLE for comparisons. The frontier case had no equivalent.
4. **Model deviation from `nextProbe`**: 33 calls, 85% empty. It is real but small, and the deviations were mostly `keyword`/genre tags never recommended. **Not refused.** The concept choice belongs to the model, and the decision cases now measure it (`followsNextProbe`).
5. **Stopping:** no premature stop in any stored run.

## 6. Modified skills and tools

None. Skill procedures, tools, stopping conditions and output semantics are unchanged, so no skill version was bumped. Tool descriptions were not edited: the audit shows no misunderstanding traceable to a description.

## 7. Context engineering changes

**`focus.withdrawn`** (`backend/src/agent/context.ts`, `withdrawnTools`):

- **What it says.** One line per closed skill: the tools it no longer offers, the skill's current `focus` state, then its declared `preconditions` (or "turn budget N spent"). Each line ends "Do not call them."
- **When it appears.** Only for tools of a skill active on the previous turn, or tools the model already tried after they were withdrawn (`NOT_EXPOSED`). Each tool is named once.
- **What it does not change.** Exposure and validation are unchanged; the executor still refuses unexposed tools.
- **Example** (synthetic):

  ```
  propose_territory, …: not offered — explore_candidate_territories closed (now viable 4, target 4; it needs …). Do not call them.
  ```

- **Arm switch.** `AgentRuntimeDeps.withdrawnToolNotes` (default on). `false` is the matched "before" arm.
- **Cost.** Across all 55 synthetic scenarios (406 turns):
  - average context grows from 9,920 to 10,042 characters (+1.2%);
  - the maximum grows from 28,164 to 28,403;
  - a note appears on 188 turns, usually once per phase transition.
- **Outcomes.** Identical in both arms for the deterministic policies.
- **System prompt.** Unchanged, so the arms differ only in this field.

## 8. Adaptive strategy behaviour

No new strategy state, deliberately.

- Strategy changes are already derived from evidence: probe ranking (`probe-policy-v2`), recovery guidance (`readiness.ts`), the reference plan, feasibility and runtime reference discovery.
- A second persisted plan could contradict that derived state.
- Strategy changes are now visible per turn through `turn.focus` (below), and decision cases d04, d06, d09–d12 measure recovery choices.

**Observability: `AgentTurnTrace.focus`** (`packages/shared/src/agent.ts`). Each turn records the deterministic focus its first attempt saw:

- stage;
- blocker;
- first three outstanding items;
- feasibility status;
- names of closed skills.

A trace can then answer "what did the agent know, and did it follow it?" without storing full contexts. The field is optional; saved results stay compatible.

## 9. Comparison-selection improvements

**No runtime change.**

- 9O's runtime reference discovery and `build_comparison_set` v5 are preserved unchanged.
- The semantic validator and the minimum comparison size are untouched.

**Measured:**

| Decision class | Cases |
|---|---|
| Propose listed references when FEASIBLE | d13, d14 |
| Never use unlisted or rejected candidates | d15–d17 |
| Respect reference refusals | d18, d19 |
| Do not stop while references are obtainable | d27–d29 |

## 10. Seed-selection competence (Sprint 10A)

- **Unchanged.** At most 3 seeds are profiled, and seeds are never support.
- **No live trace of a 10A seed choice exists,** so there is no evidence on which to change the explore skill's guidance. d35 measures the mechanics: no duplicate profiles, no unexposed tool, no early finish.
- **Seed-choice quality is still unmeasured.** It needs the Haiku decision run plus owner rating, or the 10A holdouts after judging.
- The 12 Sprint 10A holdout brands were not read, run or tuned on.

## 11. Stopping and recovery

- **No threshold changed.**
- **9O's fix is preserved:** a type-evidenced candidate stays probeable after the empty-probe bound.
- **Existing tests cover each case the brief lists:**

| Case | Test |
|---|---|
| Empty probes followed by a valid candidate | `agent-sprint9o.test.ts` |
| Weak reference with better alternatives | `agent-sprint9n` / 9O reference tests |
| Near-budget downgrade and reserved last turn | `agent-sprint5a1.test.ts` (honest PARTIAL; `COMPLETION_RESERVE`) |
| Insufficient target representation, honest degradation | `agent-sprint5a1.test.ts` (6 empty probes → unsupported) |
| Known-barren namespaces | `agent-sprint5a2.test.ts` |
| Repeated suggestions | `DUPLICATE_ACTION` scenarios |
| Provider timeouts and late answers | `agent-sprint5a2.test.ts` |
| Valid partial findings | d2d "partial findings explained" 21/21 |

- **New decision cases:**

| Decision | Cases |
|---|---|
| Analyze or finish when sufficient | d20–d26 |
| Continue while obtainable | d27–d30 |
| Recover rather than stop | d09–d12 |

## 12. Evaluation design

`pnpm eval:competence -- --decisions` (`backend/scripts/competence/decisions.ts`). Cases are in `evals/competence/decisions.json`, **pre-registered** in commit `4327e89` before any change (`PREREGISTRATION.md`).

- **38 cases:** 22 dev, 16 holdout.
  - Dimensions: decision, comparison, recovery, stopping, discovery, efficiency.
  - Each case carries the taxonomy label it tempts.
  - Both continue cases and stop or abstain cases are included.
  - Adversarial cases tempt a forced comparison: meaningless references (d16), hypotheses for an unmeasurable territory (d10).
- **Mechanics.**
  - The scenario's own policy drives a synthetic run to the decision point, a predicate on the context.
  - The policy under test takes that turn, including its bounded repair attempt.
  - The reference policy finishes the run.
- **Scoring.**
  - From the runtime's trace (accepted or refused, the Qloo answer it got), never from the model's prose.
  - Generic predicates only: `followsNextProbe`, `reprobesEmptyType`, `repeatsRefusal`, `proposesListedReference`, `usesUnlistedReference`, `duplicateCollection`, `profilesSeed`, `qlooCall`, `unexposedTool`, `hypothesis`.
  - No case names a brand, territory or id (tested).
- **Policies.**
  - `reference`: the deterministic ceiling for the scorer, not ground truth.
  - Two trace-derived instruments: `eager-finish` and `ignore-guidance`. Each must score below the reference (sensitivity).
  - `haiku`: the paid step.
- **Pass bar:** safety, sensitivity, reachability ≥ 90%, and (Haiku only) holdout improvement with Wilson 95% intervals.

## 13. Matched before and after results

Offline, synthetic, identical world, budgets and methodology:

| Policy | Arm | Dev correct | Holdout correct | Safety violations |
|---|---|---|---|---|
| reference | before | 20/22 (72–97%) | 14/16 (64–97%) | 0 |
| reference | new | 20/22 | 14/16 | 0 |
| eager-finish | either | 10/22 | 5/16 | 0 |
| ignore-guidance | either | 15/22 | 10/16 | 0 |

- **Reachability:** 76/76. **Sensitivity:** 30 < 68 and 50 < 68 (PASS).
- The arms are identical for these policies because they never read `focus.withdrawn`.
- **What this shows:** the change is safe and does not regress. **What it cannot show:** whether Haiku decides better. That is the paid step below.
- `eval:agent` and `eval:d2d` are unchanged: same passes, same matched metrics.

## 14. Independent holdout status

| Holdout | Status |
|---|---|
| Sprint 10B decision holdout (16 cases) | Frozen. Its only use so far is the offline reference and instrument runs. **Haiku: NOT_RUN.** |
| Sprint 10A discovery holdouts (12 brands) | Untouched. |
| 9O competence cases | Diagnostics only. |

## 15. Cost and latency

- **This sprint spent nothing:** no Qloo call and no model call.
- **Paid step proposed** (needs explicit owner approval):

  ```
  ANTHROPIC_API_KEY=… pnpm eval:competence -- --decisions --policy haiku --arms before,new --repeats 3 --approved-usd 1.00
  ```

  - It reserves **$0.814** (38 cases × 2 arms × 3 repeats, a repair attempt allowed per turn).
  - It makes **0 Qloo calls** (synthetic world) and refuses to start below the reserve.
  - Report label: `LIVE_HAIKU_DECISIONS on a SYNTHETIC world`. It is never Qloo validation.
- A matched live Qloo comparison (9O cassettes, `eval:competence --live`) stays separately unapproved.

## 16. Safety and provenance

Unchanged:

- Zod contracts;
- permissions and skill allowlists;
- budgets and spend accounting;
- duplicate prevention;
- deterministic classification;
- semantic validation;
- claim validation;
- provenance and correlation ids.

`focus.withdrawn` is read-only context and cannot authorize a tool. The audit and the decision harness read files or the synthetic world only. No secrets were added (`check:secrets` passes), and absolute local paths were stripped from the stored audit JSON.

## 17. CI and test outcomes (local, Node 22, worktree)

| Check | Result |
|---|---|
| `pnpm lint`, `typecheck` | pass |
| `pnpm test` | pass (backend 993, including 11 new in `agent-sprint10b.test.ts`) |
| `eval:methodology` | 19/19 |
| `eval:live` | 3/3 |
| `eval:elasticity` | 27/27 |
| `eval:agent` | PASS |
| `eval:d2d` | PASS |
| `eval:query` | PASS |
| `eval:discovery` | PASS (suite R; H and holdouts NOT_RUN) |
| `eval:competence --decisions` | PASS (offline bar) |
| `pnpm build` | pass |
| `test:e2e` (`E2E_MODE=production`, port 3100, synthetic API) | 59 passed |
| `check:secrets` | pass |
| `check:deployment-config` | `OFFLINE_DEPLOYMENT_CONFIG_PASS` (`REMOTE_PLATFORM_STATE_NOT_VERIFIED`) |
| `smoke:offline` | `OFFLINE_SMOKE_PASS` |
| `smoke:docker` | **NOT_RUN** locally (Docker unavailable); covered by the CI docker job |

`eval:competence --replay` was not run: the only stored cassette is the 9O harness-error case, which is excluded from agent outcomes.

CI (`.github/workflows/ci.yml`) now also runs `pnpm eval:competence -- --decisions`. It is offline and needs no provider key.

## 18. Remaining limitations

- **Haiku improvement is unverified.** `focus.withdrawn` targets a measured class (39–66 refusals), but only a model run can show an effect.
- **Haiku's decision competence on the 38 cases is unmeasured.**
- The decision cases use the fictional synthetic world, so a Haiku result there is not live research competence.
- Qloo coverage (§5.1) caps FULL yield for many territories, and no context change can lift that cap.
- The reference policy misses d05, d09, d19 and d36. It ignores `nextProbe` ranking, analyzes while a recovery path remains, repeats a deferred probe, and searches tags instead of probing pending candidates. These are candidate improvements to the baseline policy, which is not production behaviour.
- Notes appear on 46% of synthetic turns (one per phase transition). If a Haiku run shows no effect, the next step is to show them only after a refusal.
- **Stronger-model comparison:** not prepared beyond the harness (`--policy` accepts a model factory). No other model's availability or price was verified in this sprint, and no escalation is authorized.

## 19. Production and rollback

- **Not merged; not deployed.** Production stays on `main` at `62ca552`, with the public evaluation open.
- Pushing the branch may make Vercel build a protected preview, as it did for earlier sprint branches. That is not production, and Railway does not deploy branch pushes.
- **Rollback:**
  - do not merge, or revert the merge;
  - or set `withdrawnToolNotes: false` in `AgentRuntimeDeps`;
  - `turn.focus` is optional and additive.

## 20. Sprint 10C handoff (durable execution)

- **Agent jobs are still in-process** (AGENTS.md, Living Atlas §4). Sprint 10C should make investigation jobs and their traces durable, so that:
  - a live decision run or competence run survives a restart;
  - `turn.focus` traces persist for audit.
- **Then run, after approval:**
  1. the Haiku decision run above ($0.81, no Qloo);
  2. after judging (2026-11-05), the 10A holdouts and the 9O live competence cases, so that `eval:competence --audit` covers the 9N/9O engine live.
- **Candidates for Sprint 10D** (lessons, not changes):
  - show `focus.withdrawn` only after a refusal if notes on every transition add noise;
  - teach the reference policy to follow `nextProbe` (d05) and recovery guidance (d09).
