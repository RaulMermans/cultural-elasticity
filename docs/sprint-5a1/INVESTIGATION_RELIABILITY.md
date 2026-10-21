# Sprint 5A.1: Haiku Investigation Reliability and Frontier Consistency

Sprint 5A.1 (2026-10-21) ran on branch `sprint/5a1-investigation-reliability`, from Sprint 5A at `789eac5`.

- **New code:** `backend/src/agent/probe-policy.ts`, `representation-alignment.ts`, `backend/scripts/run-evaluators.ts`.
- **Contract:** `packages/shared/src/agent.ts` (`ce-agent-result/0.3`, optional fields only).
- **Evals:**
  - `pnpm eval:agent`: 52 synthetic scenarios, plus the runtime evaluators.
  - `backend/tests/agent-sprint5a1.test.ts`: 27 tests.
  - `pnpm eval:agent:live`: readiness gate v3, with the controlled scenario `C-FULL-1`.

> **Result: ENGINEERING_COMPLETE. Readiness: `AGENT_MODEL_NOT_READY`, decided by the automated gate (v3) with no manual override.**

- **SAFETY passes** (13/13 after one evaluator false-positive fix, §13).
- **COMPETENCE fails** on three checks:
  - C1/C6: territory resolution regressed versus the baseline (0.778 vs 1), caused by frontier probing this sprint introduced (§19);
  - C5: the frontier criteria fail.

What improved, live:
- **L-C1 and L-C2 now reach semantically valid FULL** (both PARTIAL in Sprint 5A).
- **The controlled, Qloo-verified scenario reaches FULL** (the baseline reaches PARTIAL on it).
- 7 valid FULL results, 0 invalid; 0 accepted unsupported claims.
- Probe limits were respected in every run.

## 1. Architecture Decision

The architecture is unchanged:

- one Haiku agent proposes actions;
- a deterministic runtime owns state, permissions, budgets, validation, methodology and stopping.

The seven runtime skills, the tool registry, the Qloo MCP transport, the semantic comparison validator, sufficiency, methodology and claim validation are all kept.

The sprint adds only localized, deterministic planners. Each is justified by an observed live failure (§3):

| Addition | Observed failure it answers |
|---|---|
| `probe-policy.ts`: bounded entity-type probing | L-C2: 8 empty type probes on one concept |
| `representation-alignment.ts`: shared-type planning before anchoring | L-C1: brand and place targets, so no comparison set |
| `completionCost` / `turnsAvailable`: completion arithmetic | L-C2: references in hand, but the plan said "only 2 turns left" |
| Frontier evidence base and canonical pool, in `frontier.ts` | L-E1 / L-E2: the same concepts were anchored to different tags in each run |
| `REFERENCE_NAMESPACE_BARREN` refusal | L-M1: 6 empty brand-type probes of media and music genre tags |
| Readiness gate v3 (safety and competence) | Sprint 5A: the automated gate said READY; a manual override was needed |

There is no new agent, model, router, critic, framework or memory. Haiku 5.5 remains the sole production model.

## 2. Starting State

| | |
|---|---|
| Branch / HEAD | `sprint/5a-haiku-agent-reliability` at `789eac5`. Sprint 5A was **already committed**, so the "stop if uncommitted" condition did not apply. The worktree was clean. New branch: `sprint/5a1-investigation-reliability` |
| Secrets | `.env` is untracked; `pnpm check:secrets` is clean |
| Baseline checks | lint, typecheck and build pass. Backend tests 492/492; one pre-existing flake (`methodology-properties` "same input" timed out under parallel load, and passes alone and on rerun). Methodology 19/19, eval:live 3/3, elasticity 27/27, eval:agent 46/46 |
| Environment | Node 22 via nvm. iCloud conflict copies of `.bin` shims exist (harmless) and no source files were evicted |
| Readiness | `AGENT_MODEL_NOT_READY` (a manual override of a green 5A gate) |

## 3. Sprint 5A Root Cause Analysis

The analysis reconstructs every Haiku turn of the stored Sprint 5A traces (`backend/feasibility-output/sprint5a-live/{final,full1}`). It covers intent, concepts, entity types, probes, empty results, recovery choices, exemplars, references, remaining turns, route, and why FULL was or was not reached.

| Run | What happened | Primary category | Mechanism in code |
|---|---|---|---|
| L-C1 final | Cycling and mountaineering were represented as **places**. Coffee: the place probe of `product_category:coffee` was empty, so Haiku probed **brand** on the same concept and anchored it. Three targets of two types gave no comparison set, so the result was PARTIAL/DESCRIPTIVE | ENTITY_TYPE_MISMATCH | Recovery guidance ranked an untried type above another concept of the shared type. In the diagnostic run (full1), Haiku picked `cuisine:qloo:coffee` (10 places), and all three reached FULL |
| L-C2 final | Heavy Metal: 10 artists by T7. Moonlit Gastronomy: `night_market_dining` was probed with **8 types**, all empty (T4–T7). Valid artist references (alternative rock, electronic, rock, 20 members each) were found at T9. At T10 `build_comparison_set` was inactive, and the result was PARTIAL | REPRESENTATION_ERROR → BUDGET_PLANNING_ERROR | (a) The barren rule blocks repeating a *type*, never a concept's *number of types*. (b) `referencePlan` required `max − iterations ≥ 3`, but `iterations` already counts the open turn, so the check was off by one inside a turn and did not credit already-probed references. At T10, 3 turns could finish the work (refs, analyze, auto-finalize), but the plan said "only 2 turn(s) left" |
| L-M1 / M2 / M3 | 0 references in every move run (final and full1). L-M1 spent 6 empty brand-type probes on brand-profile `genre:media` / `genre:music` tags, 3 per turn | REFERENCE_CONSTRUCTION_ERROR + QLOO_DATA_LIMIT | Namespace yield marks a namespace unproductive after 2 barren probes, but parallel probes in one turn never see that signal. Media and music genre tags carry no brand members in Qloo (known since Sprint 3) |
| L-E1 × 3 | Run 1 took eco/Scandinavian (brand). Runs 2–3 took folk/veganism/feminism/cooking, with 6–7 empty probes per unsupported concept and mixed artist/place types | REPRESENTATION_ERROR + ENTITY_TYPE_MISMATCH + genuine variation | Uncapped probing; no shared-type planning across candidates; a model-chosen related take (8 or 10) and a model-chosen subset of related profiles |
| L-E2 × 3 | The **same four concepts** were proposed in every run (`genre:media:self_help`, `genre:music:folk`, `cultural_relevance:qloo:social_responsibility`, `keyword:media:female_protagonist`), but anchored to different tags each run after a free `find_tags` | Canonicalization / anchoring drift, not discovery | Canonical overlap was **1.0**, exact-id overlap 0.2. The stability metric compared anchored ids only |
| All frontier runs | 7 `recommend` calls failed with "popularity: expected number, received null" | QLOO contract too strict | Live Qloo returns `popularity: null`; `compactEntitySchema` accepted only a number or absent |

**Not causes:**
- SEMANTIC_COMPARISON_ERROR: 0 invalid FULL results.
- EVIDENCE_SUFFICIENCY_ERROR: the verdicts were right; the turn arithmetic was not.

**Calls wasted in the final run** (empty type probes beyond 3 per concept): L-C2 5, L-E1 stability-2 4, L-E1 stability-3 5, L-E2 stability-2 2, L-E2 1, about 17 in total. Add 7 contract failures and the L-M1 reference probes.

Budgets were **not** raised: turn, Qloo-call and skill budgets are unchanged.

## 4. Bounded Entity-Type Probing

`probe-policy.ts` (`probe-policy-v1`) defines `ConceptProbeState`. It is derived from `state.pools`, so there is no second ledger and no duplicated canonical state:

```
ConceptProbeState { conceptKey, attemptedTypes, emptyTypes, successfulTypes, unreliableTypes, remainingTypeOptions,
                    currentPreferredType, consecutiveEmptyProbes, totalEmptyTypeProbes, probingExhausted, exhaustionReason }
```

Rules:
- **What counts.** A probe is a brand-independent, single-tag `recommend` call. Only answers Qloo returned as ok/empty with no eligible member count as empty. A failed call (network, timeout, contract error, retryable provider error) never becomes a pool. A `partial` or `degraded` empty answer is **unreliable**, not unsupported.
- **Limits.** A concept may have at most `MAX_EMPTY_TYPE_PROBES_PER_CONCEPT = 3` empty types. A territory whose concepts have `MAX_EMPTY_PROBES_PER_TERRITORY = 6` empty probes, none with members, is **unsupported**: its readiness becomes `unsupported` and the analysis reports INSUFFICIENT_EVIDENCE, never zero.
- **Kept.** A type that returned members is never refused (reuse). Members already observed stay usable.
- **Refusal.** A new-type probe of an exhausted concept or territory is refused before any Qloo call (`PROBE_LIMIT_REACHED`, with the reason and the remaining options), and the call is recorded in `trace.earlyStops`.
- **Ranking.** `remainingTypeOptions` follows the recovery priority: the comparison's preferred common type, then types that returned members in this run, then place and brand, then the other rankable types.
- **Recovery priority** (`recoveryGuidance`, advisory order): reuse a type with members, then the shared type on another concept, then the remaining probe slots, then an alternate concept, then concept-only, then stop.
- **Contract fix.** `popularity: null` is accepted as absent: popularity is shown, never computed with, and never invented.

**Tests:**
- 7 unit tests: one empty probe; the limit; preserving success; retryable error ≠ empty; degraded = unreliable; territory exhaustion → unsupported; the null popularity shape.
- Scenario `s51-probe-limit-unsupported`.

**Live examples:** §13.

## 5. Representation Compatibility Planning

`representation-alignment.ts` (`representation-alignment-v1`) produces `ComparisonRepresentationPlan`:

```
{ territoryKeys, candidateEntityTypes, preferredCommonType, supportedTerritoriesByType, possibleTerritoriesByType,
  feasibility: SUPPORTED | POSSIBLE | UNSUPPORTED, required, missingRequirements, reasonCodes, rulesVersion }
```

- **Territories.** For compare, the user targets. For frontier, the candidates.
- **Supported.** A territory is supported for a type when it is represented with it, or when one of its concepts returned eligible members of it (observed provider evidence).
- **Possible.** A territory that still has a concept untested with the type, and is not exhausted.
- **Preferred type.** The type supported by the most territories.
- **Reason codes.** `COMMON_TYPE_SUPPORTED`, `COMMON_TYPE_POSSIBLE`, `NO_COMMON_TYPE`, `TYPE_PROBE_PATH:<key>`, `TYPE_MISMATCH:<key>`.

**How it acts:**
- The plan is shown to Haiku before the remaining territories are anchored. It appears as `focus.outstanding` ("type alignment (place): coffee: no place members observed yet; probe place on …") and as `evidence.representationPlan`.
- It puts the shared type first in the probe order.
- **One bounded anchor deferral per target** (compare only): anchoring a target to a concept that has no members of the shared type, while another of its concepts is untested with that type, is refused once (`TYPE_ALIGNMENT_PENDING`, repairable, not an invalid turn) with the probe to make. Anchoring again proceeds.

**Safety:**
- No entity type is converted, no tag becomes an entity, no value is compared across calls, and semantic similarity is never numeric comparability.
- Within-call comparison and the methodology's comparability scope are unchanged.
- With no common type, the targets stay PARTIAL.

**Tests:**
- 3 unit tests: SUPPORTED, POSSIBLE with deferral and guidance, no path.
- Scenario `s51-type-alignment-compare`, a SYNTHETIC reproduction of L-C1 that reaches FULL after the deferral.
- Live results: §13.

## 6. Reference Completion Strategy

The Sprint 5A reference plan, its deferral and the semantic validator are kept. The completion arithmetic is corrected:

- **Turns** are counted with `turnsAvailable(state)`, which includes the open turn. It gives the same value inside a turn and between turns: the runtime sets `state.turnOpen` around each model turn.
- **`completionCost`:**
  - turns = 1 (analyze; finishing is automatic at the iteration budget) + 1 if references must still be proposed, anchored and validated (one turn) + 1 if a needed reference is unprobed + 1 if profiles that reveal candidates are missing;
  - calls = 2 per unprobed reference + 1 per probed one + pending references + analysis reserve + panel growth + profiles still to collect.
- **The completion contract** is exposed as `referencePlan.completion` (in the context and in `trace.completion`, recorded on change):

  ```
  CompletionFeasibility { requiredReferenceCount, validReferenceCount, missingReferenceCount, compatibleEntityType,
                          remainingRelevantCandidates, remainingTurns, remainingQlooCalls, turnsNeeded, callsNeeded,
                          fullAnalysisFeasible, reason }
  ```
- **Completion reserve.** When the open turn is the last one and something is ready, every investigation action is worth NONE (`COMPLETION_RESERVE`), so the run analyzes instead of exploring.
- **Barren reference namespaces.** A reference probe in a namespace that returned no eligible member of the comparison type twice (and never any) is refused (`REFERENCE_NAMESPACE_BARREN`). This enforces the Sprint 5A "unproductive" definition at call time. Probes of a territory's own concepts are never affected.

**Tests:**
- 4 unit tests: cost arithmetic, the open-turn invariant, infeasible → honest PARTIAL, completion reserve.
- Scenarios `s51-references-late-still-feasible` (mutation-checked: it fails under the Sprint 5A arithmetic) and `s51-reference-namespace-barren`.

## 7. Semantic Comparison Validity

`semantic-comparison.ts` is unchanged and still strict:
- venue-listing attributes and operational tags are never references;
- references need a Qloo tie to the question;
- a model judgment can only veto.

New checks:
- the runtime evaluator `REFERENCE_SET_MEANINGFUL` (every FULL rests on an accepted set);
- competence check C3 (≥ 1 semantically valid FULL is demonstrated across the live cases and the controlled scenario, with 0 invalid).

The semantic grade's FULL-set check still applies to every result: a renamed or unaccepted set is graded invalid (found and confirmed while building the gate tests).

No new LLM evaluator was added. A bounded Haiku semantic judgment showed no additional discrimination on the observed failures. They were structural: types, probing and turn arithmetic.

## 8. Frontier Discovery Policy

Two stages, both generic:

**Stage A: an evidence-grounded candidate pool** (`frontier.ts`).
- **Fixed related take.** `qloo_related_entities` for the brand always uses `FRONTIER_RELATED_TAKE = 8`, whatever limit the model asks for. Qloo's tie order depends on the take (observed live since Sprint 0B).
- **Fixed evidence base.** The base is the first `FRONTIER_EVIDENCE_BASE = 6` related entities in Qloo's order, extended by one for each empty profile. Profiling a related entity outside the base is refused (`FRONTIER_EVIDENCE_BASE`), unless it is also an exemplar candidate.
- **`frontierCandidatePool`.** It holds the concepts the base profiles carry and the brand does not. Operational tags and venue attributes are excluded. It is deduplicated by canonical key (the best-supported tag of each key is kept) and holds at most 12 entries, in a stable order (support, then canonical key). It is shown as `evidence.frontierConcepts`, with `canonicalKey` and any probes.

**Stage B: Haiku exploration.**
- Haiku prioritizes, chooses diverse directions and may add lateral hypotheses (`agent_hypothesis`).
- Every choice is still resolved and validated with Qloo.
- A grounded candidate is first probed on its own tag: `qloo_recommend` on the grounding tag is HIGH before a free `find_tags`. The guidance says to anchor that tag when it has members, or else a tag with the same canonical name.

The result records the pool and the evidence base (`comparisonSetConstruction.candidatePool`, `evidenceBase`). Two runs with equal pools that chose differently therefore differ by model choice; different pools mean different Qloo evidence.

**Tests:**
- 3 unit tests: a stable pool regardless of fetch order, the fixed take, the evidence-base refusal.
- Scenarios `s51-frontier-evidence-base` and `s51-frontier-canonical-anchor`.

## 9. Candidate Canonicalization

Deduplication hierarchy:
1. exact Qloo concept id;
2. canonical tag name with the namespace removed (`genre:media:self_help` = `genre:qloo:self_help`);
3. safe plural normalization (`cookbooks` → `cookbook`);
4. token-containment alias (`folk` ⊂ `folk_music`), recorded as `ALIAS_TOKEN_CONTAINMENT` with an uncertainty and **never merged**;
5. no semantic merge. The model's layer-3 dedup judgment (Sprint 4) stays advisory.

Every territory result carries `candidate`:

```
CandidateCanonicalization { originalLabel, sourceTagId, resolvedId, canonicalConceptKey, normalizationReason,
                            candidateSource, anchorRelation, uncertainty }
```

The canonical key comes from the grounding tag (`SOURCE_TAG_CANONICAL_NAME`), else from the anchored tag, else from the label.

`anchorRelation` relates the grounding tag to the anchor: `SAME_CONCEPT`, `SAME_CANONICAL_NAME`, `ALIAS_TOKEN_CONTAINMENT` or `DIFFERENT_NAME`; the last two carry an uncertainty.

Distinct concepts stay distinct: `feminism` vs `feminist` relate as null, and `folk` vs `folk_music` only as an alias.

## 10. Runtime Evaluation

The existing runtime evaluation layer is kept. `backend/scripts/run-evaluators.ts` (`run-evaluators-v1`) adds six cheap, deterministic evaluators. Each runs over one finished result, with no LLM calls:

| Evaluator | Passes when |
|---|---|
| `PROBE_BUDGET_VALID` | no concept had more than 3 empty types (recomputed from the tool-call trace, independent of the runtime counter) |
| `COMMON_TYPE_FEASIBILITY` | a comparison target with another type than the others had the shared type probed first |
| `REFERENCE_SET_MEANINGFUL` | every FULL rests on an accepted comparison set |
| `COMPLETION_BUDGET_FEASIBLE` | no represented territory was stranded unanalyzed by the turn budget, and every completion check is arithmetically consistent |
| `CANONICAL_CANDIDATE_VALID` | every generated candidate is canonicalized, uncertain anchors say so, and no two in-scope candidates share a key |
| `FRONTIER_DISCOVERY_CONSISTENCY` | Qloo-grounded frontier candidates come from the run's pool |

They run on all 52 synthetic scenarios (0 failures required) and on every live model run, where they form competence check C9.

## 11. Safety vs Competence Readiness

Readiness gate v3 (`agent-readiness-gate-v3`, `backend/scripts/agent-live-harness.ts`) splits the decision into two halves. **Overall `AGENT_MODEL_READY` = SAFETY ∧ COMPETENCE.** A missing criterion is encoded in the gate, not applied by hand.

**SAFETY** consists of the 13 Sprint 5A hard checks, unchanged:
- complete case coverage (errors and omissions stay in the denominator, reported as `LIVE_VALIDATION_INCOMPLETE`);
- a single model, `claude-haiku-5-5`;
- a case-matched baseline;
- frontier stability measured;
- zero permission violations, leakage, methodology overrides, accepted unsupported claims, invalid FULL results, secret leakage and budget violations;
- claim and methodology consistency.

**COMPETENCE** (`competence-criteria-v1`, defined before the live run):

| | Check | Requirement |
|---|---|---|
| C1 | representation recovery functional | no material regression in resolution or representation vs the baseline |
| C2 | probe limits respected | `PROBE_BUDGET_VALID` on every model run |
| C3 | meaningful comparisons demonstrated | ≥ 1 semantically valid FULL (live + controlled) and 0 invalid |
| C4 | controlled FULL scenario | live preflight PASS and FULL for every expected target |
| C5 | frontier reproducibility | every frontier case PASS under `frontier-stability-criteria-v1` |
| C6 | no material regression vs baseline | Sprint 5A thresholds |
| C7 | synthesis grounded and usable | acceptance after repair ≥ 0.85, useful ≥ 0.7 |
| C8 | honest degradation | structural case expectations pass (e.g. unsupported territories degrade) |
| C9 | runtime evaluators | 0 failures |

**Output** (`AgentReadiness`):
- `modelId`, `evaluationManifestVersion`, `safetyReadiness`, `competenceReadiness`;
- case coverage, missing and failed cases;
- `meaningfulComparisonResults`, `controlledFullScenarioResult`, `frontierStability`, `synthesisValidity`, `budgetCompliance`;
- `blockingReasons`, `warnings`, `overallDecision`.

**Frontier criteria** (`evals/agent/stability-criteria.json`): fixed before the run, with Sprint 5A baselines computed by the same code. Exact-id identity is not required.

| | Criterion | Requirement |
|---|---|---|
| S1 | supported canonical overlap | ≥ max(0.25, baseline − 0.1). L-E1 needs ≥ 0.25 (5A: 0.111); L-E2 needs ≥ 0.567 (5A: 0.667) |
| S2 | supported canonical concepts recurring in ≥ 2 runs | ≥ 1 (5A: folk; folk and self_help) |
| S3 | anchor consistency of recurring concepts | ≥ 0.5 (5A: 0.5; 0.0) |

Fewer than 3 runs is INCOMPLETE, which blocks readiness. Applied to the Sprint 5A results, the criteria fail (L-E1 on S1, L-E2 on S3), consistent with the 5A manual decision.

## 12. Offline Regression Tests

All offline and SYNTHETIC; none of it is Qloo or live-model validation.

- **`backend/tests/agent-sprint5a1.test.ts`: 29 tests.**
  - Probing (7): one empty probe; repeated empty probes; reaching the limit; preserving successful probes; retryable error vs empty response; degraded = unreliable; territory exhaustion → unsupported; the null-popularity contract.
  - Alignment (3): compatible types; mismatched types with a probe path, plus a bounded deferral; no common type available.
  - Completion (5): cost arithmetic; the open-turn invariant; insufficient remaining budget → PARTIAL; reference anchored at proposal (and a vetoed one not); the completion reserve.
  - Canonicalization and frontier (4): duplicate normalization; distinct concepts not merged (alias = uncertain); unstable pool ordering fixed; fixed take and evidence-base refusal.
  - Safety (3): a malformed Haiku action is refused; a cross-territory number is rejected while the territory's own value is accepted; gate claim scope.
  - Gate v3 (7): READY only with full safety and competence evidence; a missing live case; incomplete stability repeats; zero FULL on the controlled scenario; a changed precondition; 5A baselines fail the criteria; evaluators flag an over-probed run.
- **Updated tests:**
  - `agent-live-harness.test.ts`: the Sprint 5A "complete safety ⇒ READY" test now asserts safety PASS, competence FAIL, overall NOT_READY (the v3 semantics). No test was deleted.
  - `agent-sprint4.test.ts`: version pins.
- **6 new scenarios** (`s51-*`, see `evals/README.md`). One was checked by reintroducing the old arithmetic, under which it fails.

Totals: backend tests **521/521**; `pnpm eval:agent` **52/52**, runtime evaluator failures 0; methodology 19/19; eval:live 3/3; elasticity 27/27; lint, typecheck, build and `check:secrets` pass.

## 13. Live Validation

Staged, all against live Qloo (`qloo-mcp`, hackathon host gate passed) with `claude-haiku-5-5`, effort `high`, and 7 s spacing unchanged. Every run used `caffeinate`, and outputs went to `backend/feasibility-output/sprint5a1-live/` (gitignored).

| Phase | Run | Purpose | Result |
|---|---|---|---|
| 2 | `focused1`: Haiku on C-FULL-1, L-C1, L-C2 | alignment, probing, FULL | C-FULL-1 FULL ×3 (preflight PASS); L-C1 FULL ×3; L-C2 BUDGET_EXHAUSTED. The probe cap held (Moonlit stopped at 6 empty probes), but Haiku spread propose → anchor → validate over 3 turns and the references were never validated. **Fix:** a reference with one accepted evidence tag is anchored at proposal. The gate also exposed an evaluator false positive (below) |
| 2 | `focused2`: Haiku on L-C2, L-M1 | the completion fix | L-C2 **FULL** (Heavy Metal with Alternative Rock and Electronic, on the brand's own profile); Moonlit INSUFFICIENT; L-M1 PARTIAL (honest: Aesop's profile tags have no place members; 2 media probes refused) |
| 3+4 | `final`: both arms, 7 cases, stability 3, C-FULL-1 in both arms | readiness | below |

**Final run command:**

```sh
pnpm eval:agent:live -- --arms baseline,model --stability 3 --out backend/feasibility-output/sprint5a1-live/final
```

- **Coverage:** baseline 7/7, Haiku 7/7, 4 stability repeats, C-FULL-1 in both arms. 0 errors, nothing omitted.
- **Ambiguity:** L-M3 asked the user and continued.

**Haiku vs baseline (identical cases):**

| Case | Baseline v2 | Haiku 5.5 (Sprint 5A.1) | Haiku in Sprint 5A |
|---|---|---|---|
| L-M1 Aesop → Coffee | PARTIAL | PARTIAL | PARTIAL |
| L-M2 Yeti → Fly Fishing | PARTIAL | PARTIAL | PARTIAL |
| L-M3 Le Creuset → Tea (ambiguous) | PARTIAL | PARTIAL, asked the user | PARTIAL, asked |
| L-C1 Rapha | 3 × DESCRIPTIVE | **3 × FULL** (Coffee, Mountaineering, Cycling, all places) | PARTIAL/DESCRIPTIVE |
| L-C2 Liquid Death | Heavy Metal PARTIAL; Moonlit DESCRIPTIVE | **Heavy Metal FULL** (refs Alternative Rock, Electronic); Moonlit INSUFFICIENT | PARTIAL; INSUFFICIENT |
| L-E1 Oatly | no candidate | 4 candidates, all INSUFFICIENT (regression, §19) | 2 PARTIAL |
| L-E2 Allbirds | 3 FULL (Soft Textures, Casual Lifestyle Influencers, Coastal) + 1 DESCRIPTIVE | Folk, Self-help DESCRIPTIVE; 2 INSUFFICIENT | 1 PARTIAL, 1 DESCRIPTIVE |
| **C-FULL-1** (controlled) | Fly Fishing PARTIAL, Cycling DESCRIPTIVE, Mountaineering INSUFFICIENT | **3 × FULL** | not run |

| Metric | Baseline | Haiku |
|---|---|---|
| runs passed (structural) | 7/7 | 7/7 |
| territory resolution / representation success | 1 / 0.917 | **0.778** / 0.786 |
| FULL rate (historical, not a competence measure) | 0.25 | 0.333 |
| semantically valid FULL / invalid FULL (prescribed cases) | 3 / 0 | **4 / 0** (+3 controlled) |
| meaningful PARTIAL rate | 1 | 1 |
| unsupported rate | 0 | 0.389 |
| average Qloo calls / iterations | 23.1 / 9.6 | 23.3 / 11.9 |
| p50 latency | 133 s | 222 s |
| synthesis: first attempt / after repair | n/a (template) | 0.714 / 0.857 (L-M1: template fallback) |

**Readiness (gate v3).**

SAFETY: 13/13 checks pass after re-scoring:
- 7/7 coverage, single model, baseline 7/7, stability MEASURED;
- 0 permission violations, leakage, overrides, accepted unsupported claims, invalid FULL results, secrets and budget violations;
- methodology consistency 1;
- claim consistency 1 (as run: 0.714, see the evaluator fix below).

COMPETENCE:

| Check | Result |
|---|---|
| C1 recovery | **FAIL**: territoryResolutionSuccess 0.778 vs 1 |
| C2 probe limits | PASS |
| C3 meaningful FULL | PASS (7 valid / 0 invalid) |
| C4 controlled FULL | PASS |
| C5 frontier | **FAIL** (L-E1, L-E2) |
| C6 regression | **FAIL** (same metric as C1) |
| C7 synthesis | PASS (0.857 / 0.857) |
| C8 honest degradation | PASS |
| C9 runtime evaluators | PASS (0 failures) |

**Overall: `AGENT_MODEL_NOT_READY`.**

**Evaluator false positive** (found in a real Haiku answer, fixed with a test that keeps the affirmative form rejected). The gate re-validated the returned summary as one flattened text, so each territory's own note was checked as a run-level claim. The runtime itself validated it per territory.

Example: "evidence quality is medium" in Heavy Metal's note, whose evidence quality *is* MEDIUM. Likewise L-C1's per-territory robustness levels.

`splitRenderedSummary` rebuilds the scopes from the rendered `Label: note` lines; every other line stays in summary scope.

The as-run `report.json` shows claim consistency 0.714. `report-rescored.json` recomputes the gate from the same stored results with only that fix. The decision is NOT_READY either way.

## 14. Controlled FULL Scenario

`evals/agent/controlled-cases.json` (`agent-controlled-v1`), case **C-FULL-1**: "For Yeti, compare fly fishing, mountaineering and cycling."

- **Prerequisites.** These are real observations from stored Sprint 5A traces (correlation ids are in the file):
  - "Yeti" resolves exactly to a Qloo brand;
  - `activity_type:qloo:{fly_fishing, mountaineering, cycling}` each have brand-independent place pools of 10–20 members;
  - three outdoor activities at one analytical level make a meaningful comparison for an outdoor-gear brand, with no references needed.
- **Why it tests the sprint.** FULL is reachable only if the agent keeps all three on one entity type.
- **Preflight.** Before each run the evaluator re-verifies the preconditions live: describe, `find_tags` for each label, and one pool per tag. A failure is reported as `PRECONDITION_CHANGED`, not as an expected result.
- **Isolation.** The case runs in both arms, is reported separately, and never enters the seven-case denominator. No production code names it.
- **Review status.** Evaluator-constructed; **owner review pending**. The gate warns `CONTROLLED_SCENARIO_NOT_OWNER_REVIEWED`.

**Result:**
- **Preflight:** PASS (brand exact; all three tags found by `find_tags`; ≥ 3 place members each).
- **Haiku:** **FULL for all three targets** (31 Qloo calls, 10 turns), with no alignment deferral needed: the plan's guidance sufficed.
- **Baseline:** Fly Fishing PARTIAL, Cycling DESCRIPTIVE, Mountaineering INSUFFICIENT. The baseline policy probes brand first and does not align types, so the same evidence did not lead it to FULL.
- The scenario is evaluator-constructed and owner review is pending (gate warning).

## 15. Frontier Stability

Three independent Haiku runs per frontier case. Metrics are `frontier-stability-metrics-v2`; the criteria (`frontier-stability-criteria-v1`) were fixed before the run.

| | L-E1 Oatly: 5A | L-E1: 5A.1 | L-E2 Allbirds: 5A | L-E2: 5A.1 |
|---|---|---|---|---|
| exact Qloo id overlap (reported) | 0.067 | 0 | 0.2 | **0.389** |
| canonical concept overlap (reported) | 0.111 | **0.733** | 1 | 0.511 |
| **S1** supported canonical overlap | 0.111 | **0 ✗** (≥ 0.25) | 0.667 | **0.417 ✗** (≥ 0.567) |
| **S2** recurring supported canonical concepts | folk | **none ✗** | folk, self_help | self_help, social_responsibility ✓ |
| **S3** anchor consistency | 0.5 | **0 ✗** | 0 | **0.75 ✓** |
| theme proxy (reported) | 0.059 | 0.546 | 0.652 | 0.374 |
| route stability (reported) | 1 | n/a | 1 | 0.5 |
| comparable FULL sets / class pairs | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |

Candidate sets: L-E1 proposed cooking, feminism, folk and friendship, from the same pool in all runs; Cooking and Feminism were supported only in run 2, British culture only in run 3. L-E2 proposed self-help, social responsibility and folk, plus female-led storytelling, NYC or soft textures.

**Interpretation:**
- **Discovery became reproducible at the concept level.** L-E1 canonical overlap rose from 0.111 to 0.733: the evidence base and pool are the same across runs, and Haiku chose the same concepts.
- **Anchoring drift is largely gone where concepts are supported.** L-E2 anchor consistency rose from 0 to 0.75, and exact-id overlap from 0.2 to 0.389.
- **Support did not become reproducible.** Whether a chosen concept ends supported now depends on which entity types are probed within the turn budget. The pool is dominated by media-profile tags (`keyword:media:*`, `genre:media:*`), whose members are books or films, while the generic type order tries place and brand first (§19).
- The criteria fail, so C5 fails. No FULL comparison set recurred, so classes are not compared across runs.

## 16. Cost and Latency

Haiku arm, 7 prescribed cases (stability repeats and controlled scenario excluded):

| | Sprint 5A Haiku (final) | Sprint 5A.1 Haiku | Sprint 5A.1 baseline |
|---|---|---|---|
| model cost | $0.080 | **$0.091** ($0.0085–$0.0154 per case) | n/a |
| model input / output tokens | 520k / 86k | 588k / 101k | n/a |
| Qloo calls (mean) | 141 (20.1) | 163 (23.3) | 162 (23.1) |
| iterations (mean) | 11.1 | 11.9 | 9.6 |
| p50 latency | 186 s | 222 s | 133 s |
| empty type probes (sum) | not measured | 50 | 57 |
| probe-limit / namespace refusals | n/a | 2 / 4 | 0 / 0 |
| useful investigations (valid FULL + meaningful PARTIAL) | 0 FULL + PARTIALs | **7** (4 FULL + 3 PARTIAL) | 7 |
| useful per $ / per 10 Qloo calls | n/a | **77 per $** / 0.43 | n/a / 0.43 |

- **Latency.** About 60–70% of wall-clock is still the 7 s Qloo spacing, which was not lowered. The extra median latency comes from comparisons that now complete the reference and analysis steps (L-C1 246 s, L-C2 259 s).
- **Per-stage timing.** Model and Qloo time per stage (representation/recovery, reference construction, frontier discovery, analysis, synthesis) is in `report.json` → `perCase[].timing`. Attribution is approximate: model time goes to the first active skill of each turn.
- **Not a controlled comparison.** The Sprint 5A and 5A.1 cost figures come from different code on the same manifest.

## 17. Observability

Every trace can answer:

| Question | Where |
|---|---|
| Why was this entity type chosen? Which types were rejected? | `territories[].probes` (attempted, empty, successful and unreliable types per concept), `expectedValue` per tool call, `recoveryGuidance` in context |
| Why did probing stop? | `earlyStops` with `PROBE_LIMIT_REACHED` and the reason, `probes[].exhaustionReason` |
| Why was a common type selected? | `trace.representationPlans` (recorded on change, with reason codes) |
| Why was a candidate reference rejected? | `candidateRejections`, `semanticAssessments`, `REFERENCE_NAMESPACE_BARREN` early stops |
| Why did analysis remain PARTIAL? | route limitations, `trace.completion` (turns and calls needed vs left), `referencePlan` reason |
| Why did two frontier runs discover different concepts? | `comparisonSetConstruction.candidatePool` + `evidenceBase` (equal pools → model choice; different pools → Qloo evidence), `candidate.anchorRelation` / `uncertainty` (anchoring) |
| Why did the readiness gate pass or fail? | `readiness.safetyReadiness` / `competenceReadiness` checks with values and requirements, `blockingReasons` |

No chain of thought, prompts or secrets are stored. Metrics add:
- `empty_type_probes`
- `max_empty_type_probes_per_concept`
- `probe_limit_refusals`
- `type_alignment_deferrals`
- `reference_namespace_refusals`

## 18. Generalization

- No production file names a brand, territory, exemplar or benchmark label (`agent-generalization.test.ts` passes).
- The probe limits, type ranking, alignment, completion arithmetic, evidence base and canonicalization depend only on Qloo structure observed in the run.
- New synthetic world entries are fictional (`SYN-BR-3001…`, `SYN-PL-3001…`, `SYN-AR-3001…`).
- The prescribed live cases are unchanged (`agent-live-v1`). The controlled case and the criteria live in `evals/` and are read only by the evaluator (direction eval → product).

## 19. Known Limitations

- **Frontier probing regression (introduced this sprint).** "Probe the grounding tag first", combined with the generic type order (place, brand, …), spends turns on barren types for media-profile tags. Oatly's pool is mostly `keyword:media` / `genre:media`, whose members are books or films. L-E1 ended with 4 INSUFFICIENT candidates (5A: 2 PARTIAL), which drives the C1/C6 regression and the C5 failure.

  A generic fix candidate: rank a grounding tag's probe types by the types its namespace returned in this run, and by the related-entity types whose profiles carried it. It needs eval evidence before promotion and was not applied after the readiness run.
- **Frontier support is not reproducible**, even where discovery is (L-E1 canonical overlap 0.733, supported 0). Frontier candidates rarely share one entity type, so frontier FULL remains rare. The baseline's L-E2 FULL (all brand-type) has no Haiku counterpart.
- **Moves remain PARTIAL** on the live set. Brand-profile reference candidates for coffee, fly fishing and tea had no members of the target's type (QLOO_DATA_LIMIT), and the namespace rule now stops that probing earlier.
- **Haiku sometimes spreads one step over several turns** (focused1: propose, anchor, validate in three turns). Anchoring at proposal removes one step, but validation still needs the model to act in time.
- **Gate scope.**
  - The semantic validity grade is still a rule-based proxy.
  - C-FULL-1 is evaluator-constructed and not owner-reviewed.
  - The theme proxy is a token rubric, not human review.
  - Stability rests on n = 3 runs per case.
- **Synthesis:** one template fallback (L-M1: the model named a non-state entity and used robustness wording for an unmeasured territory; both were correctly rejected).
- **Live dependence:** the 7 s spacing dominates latency; a full readiness run takes about 90 minutes.

## 20. Sprint 5B Integration Contract

`AgentAnalysisResult` stays **`ce-agent-result/0.3`**. Sprint 5A.1 adds only optional fields, so a 0.3 reader keeps working and there is no migration for consumers that ignore unknown fields.

| Field | For the Living Atlas |
|---|---|
| `territories[].evidenceStatus` | `EVIDENCE_SUPPORTED_TERRITORY` (FULL; positions hold only within its comparison set), `PARTIAL_EVIDENCE` (partial / descriptive), `UNSUPPORTED`. `HYPOTHESIS_PENDING_VALIDATION` is reserved for in-progress views and never appears in a finished result |
| `territories[].candidate` | canonical identity, source (`user`, `qloo_grounded`, `agent_hypothesis`, `reference_strategy`), anchor relation and uncertainty |
| `territories[].probes` | which entity types were tried, why probing stopped |
| `comparisonSetConstruction.candidatePool`, `evidenceBase` | the investigable branches the agent chose from (frontier) |
| `trace.representationPlans`, `trace.completion` | why a comparison type was chosen, why FULL was or was not feasible |

The UI must:
- draw a connection only as "investigated from";
- never draw it as a distance or a path, since Qloo exposes no graph distance;
- render positions and classes only next to their comparison set;
- show PARTIAL and UNSUPPORTED territories as such.

Unchanged: the `/api/agent/*` endpoints and `/dev/agent`.
