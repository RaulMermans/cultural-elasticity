# Sprint 5A.2: Frontier Reliability and Agent Readiness

Sprint 5A.2 (2026-10-21/22) ran on branch `sprint/5a2-frontier-reliability`, from Sprint 5A.1 at `dce40ef`.

- **Changed runtime:** `probe-policy.ts` (`probe-policy-v2`), `frontier.ts`, `concept-dedup.ts` (`concept-dedup-v2`), `analysis-runner.ts`, `readiness.ts`, `representation-alignment.ts`, `tool-executor.ts`, `tool-registry.ts`, `context.ts`.
- **Contract:** `packages/shared/src/agent.ts` stays `ce-agent-result/0.3`; the changes are additive and optional.
- **Evals:**
  - `run-evaluators-v2.1`: 13 evaluators;
  - `frontier-stability-metrics-v3`;
  - `pnpm eval:agent:replay`;
  - scenario `s52-frontier-namespace-type-evidence`;
  - `backend/tests/agent-sprint5a2.test.ts`: 23 tests.

> **Result: ENGINEERING_COMPLETE. Readiness: `AGENT_MODEL_NOT_READY`**, decided by the automated gate v3 on the final run (attempt 4), with no manual override.
> - SAFETY passes 13/13.
> - COMPETENCE passes 8/9. **C5 frontier reproducibility now passes for L-E1 and L-E2**; it failed in 5A and 5A.1.
> - The only blocker is C9: 3 runtime-evaluator failures as run.
> - The replay with the corrected evaluator (v2.1, one false positive removed) leaves 2 real failures, so the decision is the same either way.

## 1. Executive Outcome

- **Engineering:** complete. Offline: tests 543/543, eval:agent 53/53 with 0 runtime-evaluator failures. lint, typecheck, build and `check:secrets` pass.
- **Live (Haiku, live Qloo):** the frontier failures of 5A.1 are fixed in the observed runs:
  - L-E1 Oatly went from 0 supported candidates (5A.1) to 2–3 supported, anchored to their own grounding tags;
  - L-E2 keeps its supported candidates with consistent anchors;
  - L-C1 Rapha stays 3 × FULL with fewer calls (24–26, 5A.1: 30).
- **Three further defects were found live and fixed:** an incomplete optional rank panel failing the methodology, contradictory probe guidance, and support lost to the resolution budget.
- **Readiness (gate v3, final run):** `AGENT_MODEL_NOT_READY`.
  - SAFETY 13/13.
  - COMPETENCE 8/9: C1–C8 pass, including no regression versus the baseline, the controlled scenario at 3 × FULL, 6 valid / 0 invalid FULL results, and frontier criteria PASS for both cases.
  - C9 fails. Two of the three evaluator failures are a real defect: a Qloo answer that arrived **after** its tool call had timed out (the laptop slept mid-run) was still recorded as probe evidence. It is fixed after the run: late answers are discarded and counted against the budget. The third is an evaluator false positive, fixed in `run-evaluators-v2.1` and recorded as a replay.

## 2. Starting State

| | |
|---|---|
| Branch / HEAD | `sprint/5a1-investigation-reliability` at `dce40ef`. Sprint 5A.1 was **committed and pushed**, so the "stop if uncommitted" condition did not apply. The worktree was clean. New branch: `sprint/5a2-frontier-reliability` (local, not pushed) |
| Secrets | `.env` is untracked; `pnpm check:secrets` is clean |
| Baseline checks | lint, typecheck and build pass; tests 521/521; eval:agent 52/52; methodology 19/19; eval:live 3/3; elasticity 27/27 |
| Readiness | `AGENT_MODEL_NOT_READY` (gate v3: safety 13/13; competence failed C1/C6 and C5) |
| Traces reviewed | `backend/feasibility-output/sprint5a1-live/final` (20 results), `sprint5a-live/final` (18 results) |

## 3. Root Cause Analysis

Every Haiku turn of the stored 5A.1 frontier runs was reconstructed: the concept chosen, its source tag and namespace, the type tried and why, the probe outcomes, the anchors, and the stop reason. The numbers below are as run.

| # | Mechanism | Evidence (5A.1 final) | Fix |
|---|---|---|---|
| 1 | **Blind type order.** Probes ranked types globally: run-wide yield first, then place and brand. A concept's three empty-type slots went to place, brand and artist, even when the same namespace already showed the right type | L-E1 run 3: `genre:media:cooking` was exhausted on place, brand and artist. Book had returned 10 members for that tag in run 1. L-E2 run 3: `keyword:media:female_protagonist` was exhausted on place, book and brand; movie had returned 10 in run 1. 4 to 5 empty probes per run were avoidable in hindsight (namespace evidence) | §4, §5 |
| 2 | **Supported concepts never anchored.** A candidate whose grounding tag returned members stayed unanchored when the turns ran out | L-E1 run 1: Cooking and Feminism found 10 book members each at T10 of 12. At T11, `analyze` failed with `NOTHING_TO_ANALYZE`. Both ended INSUFFICIENT | §9 |
| 3 | **find_tags results detached from the candidate.** Queries were keyed by the territory label only. Haiku searched the canonical name ("Cooking" for "Cooking and food culture") | L-E1 run 1: T9 was 4 `DUPLICATE_ACTION` refusals, a wasted turn | §9 |
| 4 | **Discovery co-occurrence taken for duplication.** The structural dedup rule counted tag co-occurrence in all profiles, including the six evidence-base profiles the candidates were *selected from* | L-E2 run 1: Female-led friendship and NYC (10 movie members each) were dropped as "near-duplicates of Folk music" (no members). L-E2 run 3: Female-led storytelling, the same way | §9 |
| 5 | **Grader: empty sets count as stable.** `supportedCanonicalOverlap` scored two runs with no supported candidate as 1 | Applied to S1, "nothing supported twice" could look stable | §16 |
| 6 | **Null popularity.** This was already fixed in 5A.1 | Replay: 7 popularity contract failures in the Sprint 5A final run, 0 in 5A.1 | §7 |

**Anchoring drift** (S3) was already small in 5A.1: L-E2 scored 0.75. The remaining drift came from free `find_tags` anchors after an empty grounding probe (L-E1 run 2: Cooking was anchored to `lifestyle:qloo:cooking`).

Found **live this sprint** (§14, §15):

| # | Mechanism | Fix |
|---|---|---|
| 7 | An optional rank panel whose Qloo answer missed an assigned exemplar invalidated the whole methodology input. L-E1 focused run: 3 movie candidates on a semantically accepted set fell to DESCRIPTIVE | The optional panel is excluded with a `PANEL_RANKING_INCOMPLETE` limitation. The primary panel is never dropped |
| 8 | Contradictory guidance. `nextProbe` recommended the comparison's shared type (place) after the barren-probe rule had refused it, and Haiku re-proposed the refused probe for 3 turns (full run attempt 1, L-C2) | A recommendation never names a type the executor would refuse (exhausted, namespace-barren or territory-barren). Alignment no longer counts a territory-barren type as a probe path |
| 10 | A tool call that timed out (the laptop slept during the final run) kept running, and its late Qloo answer was recorded as a pool. A failed call became probe evidence. Caught by `TAG_TYPE_EVIDENCE_VALID` | `abandonedToolCalls`: a late answer is discarded, never cached or recorded, and counted against the budget. Fixed after the final run, so not live-validated |
| 9 | Support lost to the resolution budget. Heavy Metal found 20 place members on its own same-named tag (`interests:qloo:heavy_metal`) in the turn that spent its 8-call resolution budget. It was then "unsupported" and dropped (attempt 3, L-C2) | `LABEL_TAG_MEMBERS` anchoring (§9) |

## 4. Type-Priority Policy (`probe-policy-v2`)

`rankProbeTypes(state, concept, preferred)` ranks the untried types of one concept:

| Priority | Rule | Reason shown |
|---|---|---|
| 1 `CONCEPT_MEMBERS` | the type returned members for this concept | member count |
| 2 `NAMESPACE_MEMBERS` | it returned members for other concepts of the same tag namespace (`genre:media`) | concepts with members / empty, member total |
| 3 `COMPARISON_TYPE` | the comparison's preferred common type, unless the namespace is barren for it | shared type |
| 4 `STRUCTURAL` | a same-canonical-name concept in another namespace returned members of it, or observed non-brand profiles of that type carry the concept | the observation |
| 5 `EXPLORATION` | the rest: types not yet empty in the namespace first, then run-wide yield, then place, brand, … | "untested in N" / "no members for k other concepts" |

`probeRecommendations` turns this into one `nextProbe` per territory without members:
- the territory's own concept;
- the type, its priority and reason;
- the namespace evidence;
- what was tested and the empty slots left;
- the exact call.

Territories that share a namespace with no evidence get **different** exploration types, so one turn of parallel probes tests several types. A recommendation is never a type the executor refuses.

Executor rules:
- **`NAMESPACE_TYPE_BARREN`**: a type that returned nothing for 2 other concepts of the namespace (and members for none) is deferred while the concept has another option. It is deferral, not a ban. It is checked after the more specific `REFERENCE_NAMESPACE_BARREN`.
- **The limits are unchanged:** 3 empty types per concept and 6 empty probes per territory. A type with members is never refused. A partial or degraded empty answer is unreliable, never empty.

Recovery guidance now starts with that line, for example: `next probe: qloo_recommend book on Quiet Activism [...] — NAMESPACE_MEMBERS: 1 other concept(s) of genre:synmedia returned book members (tested place:0; 2 empty probe(s) left; 7 turn(s), 19 Qloo call(s) left)`.

## 5. Namespace-Specific Evidence

`namespaceProbeEvidence(state, namespace, exclude)` is derived from `state.pools`; there is no second store:

```
NamespaceProbeEvidence { namespace, scope: { concepts, excluded },
  observedEntityTypes: { type, successfulProbes, emptyProbes, unreliableProbes, memberCount }[], provenance: correlationId[] }
```

- **Scope.** The namespace is the tag's category and source (`genre:media`), the same scope as the reference strategy's namespace yield (one definition, `tagNamespace`). It is evidence about this run only. It is never inferred from a namespace's English name and never carried across runs. A concept is never its own namespace evidence.
- **Structural metadata that does not reach the runtime.** Qloo tag records carry `parents[].type`, the entity types a tag applies to. Harness 0.1.26 `compactTag` drops that field from `find_tags` and `entity_tags` output, so the runtime cannot observe it, and nothing is inferred in its place.

Findings per namespace and concept, across the 5A.1 and 5A.2 live runs. These are observations, not rules:

| Namespace | Types with members | Types empty |
|---|---|---|
| `genre:media` (cooking, feminism, self_help) | book | place, brand, artist |
| `keyword:media` (friendship, england, teenage_girl, female_protagonist, new_york_city) | movie | place, brand, book (friendship, female_protagonist) |
| `genre:music` (alternative_rock, electronic, metalcore, british) | artist | place; folk: no members for any type tried |
| `cultural_relevance:qloo`, `aesthetic_property:qloo`, `influencer_appeal:qloo` | brand | place |
| `activity_type:qloo`, `cuisine:qloo`, `interests:qloo` (heavy_metal) | place | — |

## 6. Oatly Regression

This is the Sprint 5A.1 failure, fixed generically:
- a grounding tag of a media namespace was probed place-first and brand-first;
- three empty types exhausted it;
- concepts that did have members were never anchored.

Regression evidence:
- **Scenario `s52-frontier-namespace-type-evidence`** (SYNTHETIC, fictional "Brindlewood Oat"). The world field `profileOnlyTags` reproduces the live quirk: brand profiles carry media tags, but brand pools for them are empty. Three sibling concepts get three different first types. The third place probe in the namespace is deferred. Siblings are recommended book after one returns book members. Three candidates are anchored on their grounding tag and reach FULL. The music concept is INSUFFICIENT. Members include `popularity: null`.
- **Mutation check.** The scenario fails under the v1 dedup rule: Quiet Activism is dropped and the FULL set is lost.
- **Tests:** concept-type reuse, namespace evidence, no cross-namespace generalization, empty / degraded counting, limits, sibling diversification, the source-anchoring regression.
- **Live:** §14 (L-E1).

## 7. Null Popularity

**Observed contract.** Harness 0.1.26 passes `popularity` through raw: `compactEntity` and `compactTag` both use `entity.popularity` / `tag.popularity`. Live Qloo returned `popularity: null` for some recommend members. This caused 7 contract failures in the Sprint 5A final run (`results[i] … expected number, received null → at popularity`).

**Fix.**
- Entities: `z.number().nullable().optional()`, already in 5A.1.
- Tags (Sprint 5A.2): the same treatment. A null on a tag was not observed live, but the harness code path is identical.
- Null is normalized to absent: the signal carries no `popularity`, and the `EntitySource` keeps `popularity: null` with its correlation id. It is never converted to 0 and never ranked. Exemplar candidates with unknown popularity sort after known ones, then by label and id.

**Tests:**
- normalization of entity and tag nulls;
- an end-to-end synthetic pool containing null members, with deterministic sort and kept provenance;
- the `NULL_POPULARITY_HANDLED` evaluator. The replay finds the 7 Sprint 5A failures, and 0 in 5A.1 and 5A.2.

## 8. Anchor Consistency

Every anchoring of a generated candidate is recorded in `trace.anchorDecisions` (`AnchorDecision`):

| Basis | When |
|---|---|
| `SOURCE_TAG_MEMBERS` (runtime) | a brand-independent probe of a frontier candidate's grounding tag returned members |
| `LABEL_TAG_MEMBERS` (runtime) | a tag the territory's own search returned, whose canonical name is the territory's name, returned members. In a comparison, only of the planned shared type |
| `MODEL_ANCHOR` | the agent anchored the candidate to one of its evidence tags |
| `ALTERNATE_WITH_MEMBERS` | an accepted alternate (see below) |
| `REFUSED` | an alternate the runtime refused, with `reasonCode` |

An alternate anchor for a grounded frontier candidate is accepted only when all of these hold:
1. It is the same concept: the same canonical name, or a token alias recorded as uncertain.
2. Qloo returned brand-independent members for it.
3. The grounding tag was probed and returned none.

Otherwise it is refused (`ALTERNATE_ANCHOR_REFUSED`):
- `UNRELATED`: a different concept is a different candidate, with its own provenance;
- `SOURCE_SUPPORTED`;
- `SOURCE_UNTESTED`;
- `UNSUPPORTED`.

No two distinct concepts are merged to raise stability. Live (§14): Haiku's unsupported alternates (`music:qloo:folk`, `keyword:media:self_help`) were refused, and the candidates stayed honestly INSUFFICIENT.

## 9. Frontier Candidate Support

The two-channel design is unchanged: `frontierEvidenceBase`, `frontierCandidatePool` and `candidateCanonicalization` are used as before. Support is kept by:
- **Source and label anchoring** (§8). Members observed for a territory's own concept are never lost to turns or budgets (live mechanisms 2 and 9).
- **Query association.** `territoryQueryTags` attaches find_tags results for the label and for the grounding tag's canonical name.
- **Dedup v2.** Profiles of the brand's related entities (the discovery source) no longer count as co-occurrence evidence. Pool overlap, shared exemplars and co-occurrence elsewhere still count.
- **Frontier completion reserve** (`FRONTIER_COMPLETION_RESERVE`). In the last two turns, while a candidate with members is unanalyzed, probing candidates without members, or new tag searches, is refused.
- **Incomplete optional panels** degrade robustness instead of failing the methodology (mechanism 7).

## 10. Recovery and Stopping

Each territory without members gets:
- `nextProbe`: concept, type, priority, reason, namespace evidence, tested outcomes, empty slots left and the exact call;
- the remaining turns and Qloo calls, in the guidance line.

Exhausted strategies are refused, and the evaluator `RECOVERY_WITHIN_BUDGET` flags:
- a turn spent entirely on repeated or exhausted calls;
- a refused exhausted call re-proposed in a later turn.

Budgets were **not** raised: turns, Qloo calls, skill budgets and probe limits are unchanged.

## 11. Runtime Evaluators (`run-evaluators-v2`)

The six Sprint 5A.1 evaluators are kept. Seven new ones are cheap, deterministic and trace-derived:

| Evaluator | Passes when |
|---|---|
| `TAG_TYPE_EVIDENCE_VALID` | every reported successful or empty probe type is backed by a recommend answer with that outcome; the namespace is the tag's |
| `PROBE_PRIORITY_JUSTIFIED` | no probe ignored namespace evidence available at the start of its turn (a type with members in the namespace, untried for the concept, while the probed type had none) |
| `NULL_POPULARITY_HANDLED` | no call failed on a popularity contract error; reported popularity is a number or null |
| `ANCHOR_PROVENANCE_PRESERVED` | an off-grounding-tag anchor has a recorded decision that is not an unrelated alternate |
| `SUPPORTED_CONCEPT_NOT_LOST` | no frontier candidate with observed members is reported unsupported, except by semantic, diversity or dedup rules. A dedup drop that keeps a duplicate *without* members is a loss |
| `RECOVERY_WITHIN_BUDGET` | territory probe limit held; no wasted repeat turn; no exhausted call re-proposed |
| `FRONTIER_RESULT_CONSISTENCY` | supported routes have a concept; statuses match routes; the final set holds only supported candidates; the pool is stably ordered |

**Recorded replay** (`pnpm eval:agent:replay`, phase 2) over the stored 5A.1 final results. These scores sit alongside the as-run reports, never in place of them:
- L-E1 run 1 fails `SUPPORTED_CONCEPT_NOT_LOST` (Cooking, Feminism) and `RECOVERY_WITHIN_BUDGET` (T9).
- L-E2 run 1 fails `SUPPORTED_CONCEPT_NOT_LOST` (two movie candidates dropped by dedup).
- All other 5A.1 runs pass.

Over Sprint 5A, the replay finds the 7 null-popularity failures and the over-probing.

## 12. Readiness Gate

Gate v3 is unchanged: **SAFETY ∧ COMPETENCE**, with the same 13 safety checks and 9 competence checks. C9 now runs the 13 evaluators. `evals/agent/stability-criteria.json` (`frontier-stability-criteria-v1`) is **unchanged**, thresholds included.

The metric fix (v3, empty-pair = 0 for supported overlap) is stricter, and it leaves every stored score unchanged:

| | L-E1 5A | L-E2 5A | L-E1 5A.1 | L-E2 5A.1 |
|---|---|---|---|---|
| S1 (v2 as run) | 0.111 | 0.667 | 0 | 0.417 |
| S1 (v3 replay) | 0.111 | 0.667 | 0 | 0.417 |

**Final gate decision** (`backend/feasibility-output/sprint5a2-live/final/report.json`, as run):

| | Check | Result |
|---|---|---|
| SAFETY | 13 checks: coverage 7/7, single model `claude-haiku-5-5`, baseline 7/7, stability MEASURED, 0 violations of every kind, claim and methodology consistency 1 | **PASS** |
| C1 | recovery, no regression in resolution or representation | PASS |
| C2 | probe limits | PASS |
| C3 | meaningful FULL | PASS (6 valid / 0 invalid) |
| C4 | controlled FULL | PASS (C-FULL-1 3 × FULL, preflight PASS) |
| C5 | frontier criteria v1 | **PASS** (L-E1 S1 0.611, S2 cooking + feminism, S3 0.5; L-E2 S1 0.667, S2 female_protagonist + self_help + social_responsibility, S3 0.75) |
| C6 | no regression vs baseline | PASS |
| C7 | synthesis | PASS (after repair 0.857, useful 0.857) |
| C8 | honest degradation | PASS |
| C9 | runtime evaluators | **FAIL**: 3 |
| **Overall** | | **`AGENT_MODEL_NOT_READY`** |

C9 as run:
- L-C2 `TAG_TYPE_EVIDENCE_VALID`: `interests:qloo:heavy_metal` was reported successful, but its recommend call had TIMED OUT.
- L-E1 `TAG_TYPE_EVIDENCE_VALID`: `genre:music:folk` brand was reported empty, but its call had TIMED OUT.
- L-C2 `RECOVERY_WITHIN_BUDGET`: a re-proposed probe that was **accepted**.

Both `TAG_TYPE` failures are real: the evaluator caught late answers recorded as evidence (mechanism 10). The recovery failure is a grader false positive: once a refusal's condition lifts, an accepted re-proposal repeats nothing.

Replay with `run-evaluators-v2.1` (`backend/feasibility-output/sprint5a2-live/replay/replay-sprint5a2-live-final.json`, recorded next to the as-run report): 2 failures on the prescribed cases. The decision is unchanged.

A further real recovery failure appears in a stability repeat (L-E1 stability-2: a refused probe re-proposed and refused again). Stability repeats are not in the C9 denominator.

Warning: `CONTROLLED_SCENARIO_NOT_OWNER_REVIEWED`.

## 13. Offline Regression Tests

All offline and SYNTHETIC; none of this is Qloo or live-model validation.
- **`backend/tests/agent-sprint5a2.test.ts`: 23 tests.**
  - Probing (7): type reuse; namespace evidence; no cross-namespace generalization; empty and namespace-barren; degraded = unreliable; concept and territory limits; sibling diversification.
  - Guidance (1): never contradicts a refusal.
  - Budget-proof support (2): label-tag anchoring; alignment respected.
  - Frontier support (4): the Oatly-style source anchoring; find_tags association; discovery co-occurrence; completion reserve.
  - Anchors (3): supported alternate; unsupported / unneeded / unrelated refusals; deterministic repeats.
  - Null popularity (2).
  - Incomplete optional panel (1).
  - Stability and evaluators (2).
- Mutation-checked: the incomplete-panel test, the guidance test and `s52` fail without their fixes.
- **Scenario** `s52-frontier-namespace-type-evidence`. New expectation kinds: `sourceEvidenceAnchors`, `noDuplicateDrops`.
- **Updated tests:** version pins in `agent-sprint4.test.ts` (`resolve_territory` v5, `explore_candidate_territories` v4).
- **Totals** (after fix 10 and evaluators v2.1): backend tests **544/544** (23 in `agent-sprint5a2.test.ts`); `pnpm eval:agent` **53/53**, runtime-evaluator failures 0; methodology 19/19; eval:live 3/3; elasticity 27/27 (the composite-index score gate is unchanged from Sprint 2: REJECTED_FOR_NOW); lint, typecheck, build and `check:secrets` pass.

## 14. Focused Live Results (phase 3)

```sh
pnpm eval:agent:live -- --arms model --cases L-E1,L-E2,L-C1 --out backend/feasibility-output/sprint5a2-live/focused1
```

Live Qloo (`qloo-mcp`, hackathon host gate passed), `claude-haiku-5-5`, 7 s spacing unchanged.

| Case | Result | Notes |
|---|---|---|
| L-C1 Rapha | **3 × FULL** | 26 Qloo calls (5A.1: 30), $0.015 |
| L-E1 Oatly | Friendship, England, Teenage-girl stories (movie, own grounding tags); Folk INSUFFICIENT | Diversified first probes. `NAMESPACE_TYPE_BARREN` deferred a third brand probe in `keyword:media` and Haiku switched to movie (20 members each). The unsupported alternate `music:qloo:folk` was refused. **The methodology failed on an incomplete optional panel → DESCRIPTIVE** (mechanism 7, fixed after this run) |
| L-E2 Allbirds | Self help, Social responsibility, Soft textures PARTIAL; Folk INSUFFICIENT | Every candidate anchored to its grounding tag |

## 15. Full Live Results (phase 4)

```sh
pnpm eval:agent:live -- --arms baseline,model --stability 3 --out backend/feasibility-output/sprint5a2-live/final
```

Run history. Every attempt's output is kept as run:

| Attempt | Directory | Outcome |
|---|---|---|
| 1 | `attempt1-aborted` | Stopped after Haiku L-C2 exposed mechanism 8. The verdict would have measured code about to change |
| 2 | `attempt2-qloo-stall` | Stopped: the laptop slept (lid). Two `find_tags` calls ran ~16 min of wall-clock against a 5-min tool timeout; baseline L-M1 FAILED on `TOOL_TIMEOUT`. An infrastructure fault, not agent evidence |
| 3 | `attempt3-pre-label-fix` | 7/7 baseline, 7/7 Haiku cases. Stopped before the controlled scenario and stability repeats after L-C2 exposed mechanism 9 |
| 4 | `final` | **Final code (before fix 10). Complete:** baseline 7/7, Haiku 7/7, 4 stability repeats, C-FULL-1 in both arms. The machine slept during the Haiku arm (case latencies up to 12,574 s), which produced the timeouts behind mechanism 10. No case errored |

Haiku vs baseline, by attempt. Attempt 3 is pre-label-fix code; attempt 4 is the final gate run.

| Case | Baseline (attempt 4) | Haiku 5A.1 | Haiku attempt 3 | Haiku attempt 4 |
|---|---|---|---|---|
| L-M1 Aesop → Coffee | PARTIAL (19 calls) | PARTIAL (16) | PARTIAL (16) | PARTIAL (15) |
| L-M2 Yeti → Fly Fishing | PARTIAL (17) | PARTIAL (16) | PARTIAL (13) | PARTIAL (13) |
| L-M3 Le Creuset → Tea | PARTIAL (18) | PARTIAL (15) | PARTIAL (15) | PARTIAL (16) |
| L-C1 Rapha | Cycling PARTIAL, Coffee DESCRIPTIVE, Mountaineering INSUFFICIENT (32); 5A.1: 3 × DESCRIPTIVE | 3 × FULL (30) | **3 × FULL (24)** | **3 × FULL (26)** |
| L-C2 Liquid Death | Heavy Metal PARTIAL, Moonlit DESCRIPTIVE (30) | Heavy Metal FULL, Moonlit INSUFFICIENT (31) | Moonlit DESCRIPTIVE, Heavy Metal INSUFFICIENT (mechanism 9, fixed after) | Heavy Metal PARTIAL, Moonlit DESCRIPTIVE (23) |
| L-E1 Oatly | no candidate (13) | 4 × INSUFFICIENT (27) | **Cooking, Feminism PARTIAL**; Folk, London INSUFFICIENT (32) | **Cooking, Feminism PARTIAL**; British/London, Folk INSUFFICIENT (32) |
| L-E2 Allbirds | 3 × FULL + 1 DESCRIPTIVE (32) | 2 DESCRIPTIVE, 2 INSUFFICIENT (28) | **Social responsibility, Soft textures PARTIAL**; Folk, Self-help INSUFFICIENT (29) | **Female-led stories, Self-help, Social responsibility PARTIAL**; Folk INSUFFICIENT (32) |
| C-FULL-1 (controlled) | PARTIAL / DESCRIPTIVE / INSUFFICIENT, preflight PASS | 3 × FULL | not run (stopped) | **3 × FULL** |

Safety (all observed live runs): 0 invalid FULL results; 0 accepted unsupported claims; probe limits held; no budget or secret violations.

## 16. Stability Comparison

Equivalent metrics (`frontier-stability-metrics-v3`, criteria v1 unchanged):

| | L-E1 5A | L-E1 5A.1 | L-E2 5A | L-E2 5A.1 |
|---|---|---|---|---|
| exact Qloo id overlap | 0.067 | 0 | 0.2 | 0.389 |
| canonical concept overlap | 0.111 | 0.733 | 1 | 0.511 |
| **S1** supported canonical overlap | 0.111 ✗ | 0 ✗ | 0.667 | 0.417 ✗ |
| **S2** recurring supported | folk | none ✗ | folk, self_help | self_help, social_responsibility |
| **S3** anchor consistency | 0.5 | 0 ✗ | 0 ✗ | 0.75 |
| theme proxy | 0.059 | 0.546 | 0.652 | 0.374 |

**Sprint 5A.2 (final run, 3 Haiku runs per case, same metrics and criteria):**

| | L-E1 5A | L-E1 5A.1 | **L-E1 5A.2** | L-E2 5A | L-E2 5A.1 | **L-E2 5A.2** |
|---|---|---|---|---|---|---|
| exact Qloo id overlap | 0.067 | 0 | **0.5** | 0.2 | 0.389 | **0.667** |
| canonical concept overlap | 0.111 | 0.733 | **1** | 1 | 0.511 | **0.733** |
| **S1** supported canonical overlap (L-E1 ≥ 0.25, L-E2 ≥ 0.567) | 0.111 ✗ | 0 ✗ | **0.611 ✓** | 0.667 | 0.417 ✗ | **0.667 ✓** |
| **S2** recurring supported (≥ 1) | folk | none ✗ | **cooking, feminism ✓** | folk, self_help | self_help, social_responsibility | **female_protagonist, self_help, social_responsibility ✓** |
| **S3** anchor consistency (≥ 0.5) | 0.5 | 0 ✗ | **0.5 ✓** | 0 ✗ | 0.75 | **0.75 ✓** |
| theme proxy | 0.059 | 0.546 | 0.632 | 0.652 | 0.374 | 0.393 |
| route stability | 1 | n/a | 0 | 1 | 0.5 | 1 |
| comparable FULL sets | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| criteria v1 | FAIL | FAIL | **PASS** | FAIL | FAIL | **PASS** |

- **L-E1:** all three runs proposed the same four canonical concepts. Cooking and Feminism were supported in the runs that resolved them.
- **L-E2:** three supported concepts recur, each anchored to its grounding tag.
- No FULL comparison set recurred, so relative classes are not compared across runs.

## 17. Performance and Cost

Haiku arm, per case (attempt 3: 7 prescribed cases, pre-label-fix code; attempt 4: the final run, whose latencies are inflated by laptop sleep and not comparable):

| | Sprint 5A | Sprint 5A.1 | Sprint 5A.2 attempt 3 |
|---|---|---|---|
| Qloo calls (mean) | 20.1 | 23.3 | **20.4** (attempt 3); 22.4 (attempt 4: 15/13/16/26/23/32/32) |
| p50 latency | 186 s | 222 s | **150 s** |
| model cost (7 cases) | $0.080 | $0.091 | **$0.084** (attempt 3); $0.097 (attempt 4) |
| useful investigations (valid FULL + meaningful PARTIAL), attempt 4 | — | 7 | **12** (baseline 8); 123 per $; 0.76 per 10 Qloo calls (baseline 0.50) |
| empty type probes, frontier runs | — | 10–12 per run | 7–10 per run |

The 7 s spacing is unchanged. No caching or budget change was made. The supported frontier findings per run went from 0–2 to 2–3.

## 18. Generalization

- No production file names a brand, territory, exemplar or benchmark label; `agent-generalization.test.ts` passes.
- The type ranking, namespace evidence, anchoring rules, dedup v2 and evaluators depend only on Qloo structure observed in the run.
- No namespace name implies a type. No cross-run memory or second data store was added.
- The synthetic additions are fictional (`SYN-*-52xx`).
- The live cases (`agent-live-v1`) and the stability criteria are unchanged. Direction is eval → product.
- Skills: `resolve_territory` v5 and `explore_candidate_territories` v4 (procedure and behavior changed). The other five are unchanged. Haiku 5.5 remains the sole model, and no agent, model, router, critic or memory was added.

## 19. Failure Analysis

- **Live defects found and fixed this sprint** (§3, mechanisms 7–9): the incomplete optional panel, contradictory guidance, and support lost to the resolution budget. Each has a mutation-checked regression test.
- **Baseline L-C1 shifted** (attempt 4): from 3 × DESCRIPTIVE to Cycling PARTIAL, Coffee DESCRIPTIVE, Mountaineering INSUFFICIENT.
  - Not caused by label anchoring: the same concepts were anchored, one turn earlier.
  - Mountaineering's representation was rejected, and its brand-conditioned list was not collected: 2 of 32 calls were left and 4 were needed. This is a pre-existing analysis-reserve gap, since the reserve only counts territories already ready.
  - A weaker baseline makes C1/C6 easier. This must not be read as a Haiku gain. Follow-up: count anchored-but-unready territories in the reserve.
- **Genuine exploration variance:** L-E2 Self-help exhausted brand, place and artist before book (§20).
- **Infrastructure:** attempt 2 stalled on laptop sleep (TOOL_TIMEOUT) and was excluded, kept as run. Attempt 4 also ran through sleep; the timeouts it caused exposed mechanism 10.
- **C9 (final gate blocker):** 2 real evaluator failures, the late answers recorded as evidence. They are fixed after the run, with a mutation-checked test, but the fix is **not live-validated**: a new full run is needed. 1 grader false positive (v2.1).

## 20. Remaining Limitations

- **The first probe of an unseen namespace is still exploration.** Without in-run evidence, a concept can exhaust its 3 slots before the right type (attempt 3, L-E2 Self-help: brand, place and artist were empty; book had worked in other runs). Qloo's tag `parents[].type` would answer this, but harness 0.1.26 drops it. A static namespace→type map would infer capability from a name, and raising the probe cap is excluded.
- **Frontier FULL needs ≥ 3 candidates of one type.** Mixed-type candidate sets stay PARTIAL by design.
- **`genre:music:folk`** has no members of any type probed in any live run. It is reported unsupported every time, which is correct but recurs.
- **Gate scope** is unchanged from 5A.1: the semantic grade is a rule-based proxy; C-FULL-1 is not owner-reviewed; stability rests on n = 3.
- **Live dependence:** the 7 s spacing dominates latency. A readiness run takes about 90 minutes and needs the machine awake: `caffeinate` does not prevent sleep from closing the lid.

## 21. Sprint 5B Integration Readiness

`ce-agent-result/0.3` is unchanged in shape. The additive optional fields are:
- `territories[].probes[].namespace`;
- `trace.anchorDecisions`;
- `trace.probeRecommendations`;
- metrics `successful_type_probes`, `namespace_type_refusals`, `alternate_anchor_refusals`, `source_evidence_anchors`, `frontier_completion_refusals`.

For the Living Atlas:
- **Evidence-supported** (may be drawn as a supported territory): `evidenceStatus = EVIDENCE_SUPPORTED_TERRITORY` (FULL). Its position holds only within its `comparisonSet`.
- **Exploratory** (drawn as partial or unconfirmed): `PARTIAL_EVIDENCE` (partial or descriptive). Show the probes and limitations.
- **Unsupported:** `UNSUPPORTED`. Show it as such, never as a branch with cultural weight.
- **Provenance to show:** `candidate` (canonical identity, source, anchor relation and uncertainty) and `trace.anchorDecisions`, for whether the runtime or the agent anchored it and on which Qloo answer.

A connection means "investigated from". It is never a distance or a path, since Qloo exposes no graph distance. The UI must never make a PARTIAL look like a FULL.
