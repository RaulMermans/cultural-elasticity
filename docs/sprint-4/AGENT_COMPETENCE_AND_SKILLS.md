# Agent Competence & Runtime Skills

Sprint 4 (2026-10-16 → 2026-10-20). Code: `backend/src/agent/` (new: `skills/`, `readiness.ts`, `representation-quality.ts`, `concept-dedup.ts`, `reference-strategy.ts`, `frontier.ts`, `failure-taxonomy.ts`). Contract: `packages/shared/src/agent.ts` (`ce-agent-result/0.2`). Evals: `pnpm eval:agent` (synthetic), `pnpm eval:agent:live` (live Qloo).

**Validation status, stated up front**

| What | Status |
| --- | --- |
| Skills, just-in-time context, quality, dedup, sufficiency v2, recovery, claim validation v2 | Tested offline: agent unit tests, `pnpm eval:agent` 37/37 (SYNTHETIC world) |
| Runtime v1.1 against live Qloo | Live: baseline reference policy on all 7 live cases (7/7 pass) |
| The agent **model** (Claude) | **Partially live-validated:** Claude Opus 5.5 on 5 of 7 live cases (run stopped at the owner's request to switch to the cheaper model); Claude Haiku 5.5 on the 2 remaining frontier cases. No single model ran the full set. |
| Readiness decision | **`AGENT_MODEL_NOT_READY`** — see [Agent Model Readiness Decision](#agent-model-readiness-decision) |

## Runtime Architecture

Unchanged in shape: **one agent + deterministic runtime + typed tools + skills + Qloo + deterministic methodology**. No sub-agents.

```
request ─→ intake (zod) ─→ loop (bounded):
    sufficiency v2 (deterministic; verdict + next-action values + material gap)
    skill registry selects the relevant skills from state          ← new
    context builder: only those skills' sections, tools and actions  ← new
    model.decide ─→ one bounded repair on actionable validator rejections   ← new
    each decision validated: schema → exposure → phase → arguments → duplicate/value
        → precondition → Qloo budget → skill budget → execute
    exposure re-derived from state after every accepted action
─→ pre-analysis gates: frontier validation → concept dedup → diversity
─→ deterministic analysis (methodology elasticity-v0.1, unchanged)
─→ finalize: results ─→ synthesis ─→ claim validation v2 ─→ three layers
```

The runtime owns state, permissions, tool availability, skills, budgets, retries, validation, methodology, sufficiency, claim validation, stopping and traces. The model owns interpretation, hypotheses, representation proposals, next actions, advisory semantic judgments and synthesis.

## Skill Model

A skill is a **bounded, versioned, reusable competency** (`skills/contracts.ts`). Each one declares: `id`, `version`, `purpose`, `intents`, `preconditions` (text) and `relevant(state)` (their executable form), `inputSchema`/`focus` (the state slice it works on), `outputSchema`/`outcome` (what it must leave in state), `allowedTools`, `allowedActions` (analyze / ask_user / finish), `allowedRoutes`, `contextRequirements`, `budget` (turns, Qloo calls), `stoppingConditions`, `failureModes`, `evalIds`, and a short `procedure` shown to the model.

| Skill | v | Responsibility | Allowed tools | Actions | Budget |
| --- | --- | --- | --- | --- | --- |
| `interpret_request` | 1 | goal → intent, brand, named territories | interpret_request | ask_user | 3 turns, 0 calls |
| `resolve_brand` | 1 | brand → one Qloo entity, never a silent pick | qloo_resolve_entity | ask_user | 5 turns, 4 calls |
| `resolve_territory` | 2 | territory → one Qloo concept (or dropped) | qloo_find_tags, qloo_recommend, anchor_territory, drop_territory | ask_user | 5 turns, 8 calls per territory |
| `build_territory_representation` | 2 | concept → validated exemplars, or recovery | qloo_recommend, qloo_get_entity_tags, validate_territory_representation, declare_concept_only, qloo_find_tags, anchor_territory, drop_territory | — | 6 turns, 8 calls per territory |
| `build_comparison_set` | 1 | single move / 2-territory compare → justified references of the target's entity type | qloo_get_entity_tags, qloo_recommend, propose_territory, anchor_territory, validate_territory_representation, assess_concept_duplicates, drop_territory | — | 4 turns, 10 calls |
| `explore_candidate_territories` | 1 | frontier: Qloo-grounded + agent-hypothesized candidates | qloo_get_entity_tags, qloo_related_entities, qloo_find_tags, qloo_recommend, propose_territory, anchor_territory, assess_concept_duplicates, drop_territory | — | 6 turns, 20 calls |
| `analyze_territories` | 1 | ready territories → deterministic analysis → finish | assess_evidence_sufficiency, drop_territory | analyze, finish | passive (iteration-bounded), 0 calls |

Only competencies the Sprint 3 runtime already had became skills. The spec's suggested `compare-territories`/`analyze-move` collapse into `analyze_territories` (the analysis itself is code, identical for both).

**Versioning.** Changing a skill's procedure, tools, stopping conditions or output semantics requires a version bump; `tests/agent-sprint4.test.ts` pins the current versions, and every turn and tool call records `{skillId, version}`. **Learning hook:** `SkillEvalOutcome {skillId, version, runId, success, failureCategory?, metrics}` is derived offline from finished runs (`skills/outcomes.ts`); nothing consumes it automatically — no self-editing, no prompt rewriting, no persistent skill memory.

## Tool vs Skill Boundary

Tools stay **atomic, typed and permission-classed** (`tool-registry.ts`): one capability, zod input, a Qloo-call bound, a phase list and a precondition. Skills **group** tools and decide *when* they are available; a skill never executes anything itself and never widens a tool's permission. Two Sprint 4 tools were added because recovery and semantic dedup needed explicit, validated actions: `declare_concept_only` (recovery to concept-level evidence) and `assess_concept_duplicates` (layer-3 dedup judgment).

## Skill Registry

`skills/registry.ts`:

- `select(state)` — the relevant, non-exhausted skills, in registry order. Relevance is deterministic (intent, readiness of each territory, comparison-set size, viable frontier candidates, open ambiguity). Several skills can be active at once (e.g. one territory represented while another is resolved). If nothing is relevant once the brand is resolved, `analyze_territories` is the fallback so the run can always analyze or finish.
- `exposure(state)` — the union of the active skills' tools (filtered by phase) and terminal actions.
- Budgets — turns count only for skills the model was *shown* that turn; Qloo calls are attributed to the first active skill whose allowlist contains the tool. Per-territory skills scale their Qloo budget with the number of in-scope territories. **Only the turn budget deactivates a skill**; a spent Qloo budget refuses that skill's further Qloo calls (`SKILL_BUDGET_EXHAUSTED`) but keeps its local tools usable on the evidence already gathered. Discovery skills (references, frontier) also stop when their Qloo budget is spent. A deactivated skill's unfinished work is analyzed with what exists.

Two of these rules came from live failures during the sprint (see [Known Limitations](#known-limitations)): a fixed 14-call resolution budget was spent probing three territories and deactivated anchoring for a territory Qloo had just returned 20 places for; and, after a first fix, a 6-call per-territory budget was one short of the resolution pattern and a policy kept re-proposing the refused probe. `resolve_territory` and `build_territory_representation` are therefore at version 2.

No fixed workflow exists: sequences emerge from state. An analyze_move typically flows `interpret_request → resolve_brand → resolve_territory → build_territory_representation → build_comparison_set → analyze_territories`, but a weak pool re-enters representation with a recovery strategy, a place-represented target pulls place references, and an unsupported territory skips straight to analysis.

## Just-in-Time Context

`context.ts` builds the smallest high-signal view for the current turn:

- always: goal, request fields, interpretation, phase, brand status, **active skills (id, version, procedure)**, compact territory list (with readiness), deterministic sufficiency **with next-action values**, budgets (incl. per-skill Qloo calls left), *open* plan items only, last-turn results, exposed tools and actions, and the repair reason when this is a repair attempt;
- only when an active skill requires it: observed tags (for unresolved territories), brand profile, exemplar candidates + recovery options (only for territories being represented), reference candidates, related entities, frontier concepts, dedup findings, analysis results;
- never: raw Qloo envelopes, traces, benchmark data, credentials/env, inactive skills, unexposed tools.

Last-turn tool data is compacted **structurally** (arrays capped at 20 — a Qloo pool's size — and long strings shortened) so it stays machine-readable. (The first Sprint 4 live run used a string preview here and broke resolution; see [Known Limitations](#known-limitations).)

**Measured impact** (`pnpm eval:agent`, decision-context JSON, the same 28 scenarios measured at `d7c67a9` before Sprint 4):

| | Sprint 3 | Sprint 4 |
| --- | --- | --- |
| average context | 7,856 chars (~1,964 tokens est.) | 6,267 chars (−20%) |
| tools exposed per turn | 7.38 | 3.78 (−49%) |
| largest context | 16,329 chars | 18,699 chars (+15%) |

The maximum grew: when four skills are active in one turn, the union of their tool schemas (≈ 8.3k chars) dominates. Provider-reported tokens (`usage`, incl. cache reads/writes) are traced per turn when a live model runs; `contextTokensEstimate` (chars/4) is recorded for every turn.

## Phase-Specific Tools

Exposure = active skills' allowlists ∩ tools available in the current phase. The executor enforces it (`NOT_EXPOSED`), and terminal actions are gated the same way. Exposure is **re-derived from state after every accepted action** inside a turn (anchoring a concept activates representation), but the model is only ever shown the turn-start set. After all territories are ready, only `analyze`/`finish` and `assess_evidence_sufficiency` remain; Qloo tools come back only if sufficiency marks a material gap.

## Representation Quality

`representation-quality.ts` — `RepresentationQualityEvaluator` returns `VALID | WEAK | REJECT` with signals and reasons, per candidate exemplar, from run evidence only.

- **Hard constraints (REJECT):** not observed in Qloo (ENTITY_UNRESOLVED), the brand itself, duplicate (in the proposal or another territory), wrong entity type, only brand-conditioned, not linked to the concept (no pool membership, no profile tag), name-family duplicate, empty profile.
- **Relative weak signals (WEAK)** — relative to peer candidates with fetched profiles, so media-heavy profiles across a whole pool don't count against everyone:
  - `PEER_OUTLIER`: peers share cultural tags with each other (beyond the concept), this candidate shares none with any of them;
  - `CONCEPT_ABSENT`: at least half of the peers' profiles carry the concept (tag id or word stem) and this one does not.
  Without ≥ 2 peer profiles there is no weak signal: quality is reported as *unverified*, not weak.
- **Use:** VALID exemplars are accepted in proposal order; WEAK ones only as alternates after every VALID one, with a warning; **if no VALID exemplar survives, the representation is refused** (`REPRESENTATION_QUALITY_WEAK`) — a weak panel is never forced through.

Synthetic check (`sk-quality-outlier`): a cafe-concept pool whose most popular member is an energy-drink brand. The baseline proposes it first (popularity); the evaluator marks it a WEAK peer outlier and the primary exemplar becomes a cafe brand. Only VALID exemplars' profiles feed reference discovery, so the outlier's gaming tags no longer produce a "Gaming Culture" reference (they did before this rule).

## Semantic Relevance

The model may attach a semantic judgment per proposed exemplar (`relevance: strong | adequate | weak | mismatch`, `reason`). It is **advisory**, stored in `modelAssessment` apart from the deterministic signals, and combined by explicit rules (`representation-quality-v1`):

| Rule | Condition | Final |
| --- | --- | --- |
| R1 | deterministic hard failure | REJECT (the model cannot rescue it) |
| R2 | model MISMATCH | REJECT (semantic veto; removal only) |
| R3 | deterministic WEAK + model WEAK | REJECT |
| R4 | deterministic WEAK, model ok/absent | WEAK |
| R5 | deterministic VALID + model WEAK | WEAK |
| R6 | otherwise | VALID |

A model judgment never adds Qloo support and is never presented as Qloo evidence; it appears in `layers.agentInterpretation.semanticJudgments`. Scenario `sk-semantic-veto` shows the spec's example: a candidate Qloo links to the concept, judged "energy-drink and gaming culture, not cafe culture", is rejected by R2 while the other exemplars stand.

## Representation Recovery

`readiness.ts` tracks a per-territory **strategy log** (concept × entity type × outcome). A strategy that failed **twice** is exhausted and the runtime refuses a third attempt (`STRATEGY_EXHAUSTED`, recorded as an early stop). `recoveryOptions` lists what remains: other entity types with members (or unprobed), alternate Qloo concepts returned for the same query, and concept-only evidence. The representation skill stays available while a territory is *recoverable* (exhausted observed strategies but untried types/concepts and attempts left).

Paths exercised:

- TAG_DERIVED_ENTITY_PANEL (brand) → twice refused → **PLACE_PANEL** (`sk-strategy-exhausted`)
- weak-only brand pool → refused → **CONDITIONED_ENTITY_EVIDENCE** via `declare_concept_only` (`sk-quality-weak-recovery`)
- brand pool empty → **PLACE_PANEL** (`rv-place-representation`, `sk-reference-place-type`)
- concept with no members → **DESCRIPTIVE_ONLY / INSUFFICIENT** (`ie-unmeasurable`)

Recovery is bounded by representation attempts (3), the strategy rule (2 per strategy) and the skill budget.

## Concept Deduplication

`concept-dedup.ts` — `ConceptDeduplicator`, layered:

1. **Deterministic** — DUPLICATE: same Qloo id; equal normalized labels; labels equal after safe plural normalization; anchored tags with the same canonical name in different namespaces. NEAR_DUPLICATE: equal morphological stems (`-ing`, repeated `-er`): *Mountaineering / Mountaineers*, *Bouldering / Boulderers*.
2. **Structural** — NEAR_DUPLICATE: brand-independent pools overlap (Jaccard ≥ 0.6, or overlap coefficient ≥ 0.8 with both pools ≥ 3), a shared accepted exemplar, or the two concept tags co-occur in ≥ 2/3 of profiles carrying either.
3. **Semantic** — the model labels pairs DUPLICATE / NEAR_DUPLICATE / DISTINCT with a reason (`assess_concept_duplicates`).

Rules (`concept-dedup-v1`): exact duplicates always stand; structural findings (Qloo evidence) stand; the model may downgrade a *word-family* finding to DISTINCT (recorded with its reason); a DISTINCT pair the model labels duplicate becomes one (removal only). The later **generated** hypothesis (reference / frontier candidate) is dropped (`DUPLICATE_TERRITORY`); user-named targets are only flagged. Exact + structural dedup runs right after resolution (before any representation call is spent); word-family dedup waits until analysis so the model can still judge it. This fixes the Sprint 3 live *Mountaineering / Mountaineers* miss (disjoint member windows): scenario `sk-frontier-morph-duplicate` drops *Boulderers*; `sk-dedup-model-distinct` keeps both when the model judges them distinct.

## Frontier Candidate Generation

Two channels feed EXPLORE_FRONTIER:

- **A. Qloo-grounded** (`source: qloo_grounded`) — concepts carried by Qloo-related brands' profiles but not by the brand (`frontierConcepts`), tag search results, pools.
- **B. Agent-hypothesized** (`source: agent_hypothesis`) — lateral territories the model proposes.

Every candidate must pass **resolution → Qloo support → representation feasibility → evidence availability** (`frontier.ts`). Before analysis, candidates with no concept are dropped (`TERRITORY_UNRESOLVED`) and candidates whose concept has no brand-independent Qloo member are dropped (`HYPOTHESIS_UNSUPPORTED`); the rest are decided by the analysis route. Scenario `sk-frontier-two-channels`: two Qloo-grounded candidates survive; a hypothesis whose tag exists but has no members is dropped as unsupported and appears in the comparison-set construction.

## Candidate Diversity

After resolution and dedup, `pruneForDiversity` drops a candidate whose exemplar profiles share ≥ 0.5 of their cultural tags (Jaccard of unions) with an earlier kept candidate — only while at least `MIN_FRONTIER_SUPPORTED` (3) candidates would remain. No category list exists: overlap is measured from Qloo profiles. The final set's diversity is reported as `diverse | overlapping | unknown` with the overlapping pairs.

## Comparison-Set Risk

Relative positions depend on the comparison set, so every result carries `comparisonSetConstruction`: candidates proposed (with source and evidence/justification), candidates rejected (stage: resolution, qloo_support, representation, evidence, dedup, diversity, budget, agent — with code and reason), the final set with routes, dedup decisions, diversity, and a note that positions hold only for this set. The run-level limitation `COMPARISON_SET_DEPENDENT` is added whenever references or frontier candidates shape the set.

**Frontier set stability.** `frontierStability(runs)` measures exact-candidate overlap, resolved-concept overlap, top-candidate consistency and methodology (class) stability across repeated runs; `pnpm eval:agent:live -- --stability N` repeats frontier cases in the model arm. Not run: it needs the live model (the baseline is deterministic, so its stability is trivially 1 and says nothing about the agent).

## Evidence Sufficiency v2

`assessEvidenceSufficiency` keeps the five verdicts and adds `nextActions` with a **rule-based expected value**:

| Value | Examples |
| --- | --- |
| HIGH | unresolved brand or concept; no representation yet; comparison set < 3 with usable references; too few frontier candidates; analyze when no gap remains |
| MEDIUM | a second exemplar (enables robustness); candidate profiles for the quality check; untested reference concepts; a recovery strategy |
| LOW | a further exemplar beyond two |
| NONE | more brand tags (fixed Qloo take of 20); exhausted strategy; no reference with members of the target's type; nothing left to try |

`materialGap` is true while any investigation action is HIGH or MEDIUM. No ML is involved.

## Early Stopping

- **No-value calls** — a Qloo call valued NONE (profile already collected, tag query already run) is refused (`NO_VALUE_ACTION`).
- **No material gap** — once nothing material remains, Qloo investigation is refused (`EARLY_STOP`) and the context marks `analyze` HIGH; if the model still proposes nothing acceptable, the runtime analyzes the ready territories itself (`RUNTIME_ANALYZED_NO_MATERIAL_GAP`).
- **Repeated actions** — an identical successful call is refused (`DUPLICATE_ACTION`).
- **Failing strategies** — refused after two failures (`STRATEGY_EXHAUSTED`).
- **Skill budgets** — `SKILL_BUDGET_EXHAUSTED`.

Each refusal that saves Qloo calls is recorded in `trace.earlyStops` and summed as `metrics.calls_avoided`.

## Baseline vs Model

The **baseline reference policy v2** (`model/baseline.ts`) is a deterministic comparison arm, not the agent: no language understanding, no semantic judgment. v2 uses the runtime's deterministic sections (reference candidates, recovery options, exemplar candidates), prefetches candidate profiles so quality can be checked, and adapts to skill-gated turns. Its numbers are reported as BASELINE, never mixed with SCRIPTED (test scripts) or LIVE_MODEL.

What the model is expected to add over the baseline (and what the live arm would measure): free-text interpretation (the baseline asks for structured fields); semantic exemplar vetoes (R2/R3) where deterministic signals are blind; lateral frontier hypotheses (channel B); layer-3 dedup judgments; a validated narrative synthesis. **None of this is measured live yet.** The comparison table is produced by `pnpm eval:agent:live` once a key exists.

## Live Model Evaluation

Live set (`evals/agent/live-cases.json`): 3 moves, 2 comparisons, 2 frontiers; unseen brands (Aesop, Yeti, Le Creuset, Rapha, Liquid Death, Oatly, Allbirds — none is a benchmark brand; Aesop is a pinned *exemplar* in the Sprint 2 capture, disclosed in the case file), unseen territories (coffee, fly fishing, tea, cycling, mountaineering, heavy metal, "moonlit gastronomy"), one ambiguity (Le Creuset), one case that cannot reach FULL and degrades (L-C2). Structural expectations only, checked after the run.

| Case | Baseline (deterministic v2) | Model |
| --- | --- | --- |
| L-M1 Aesop → Coffee | PARTIAL · Monster Energy, Lawson, Nespresso · 20 calls | **Opus:** PARTIAL · ONA Coffee, Chameleon Coffee, Cafe Bustelo · 11 calls · $0.30 |
| L-M2 Yeti → Fly fishing | FULL vs references "Breakfast Buffet", "Breakfast Available" · 24 calls | **Opus:** INSUFFICIENT — probed six brand pools, never tried places although the recovery was exposed · 11 calls |
| L-M3 Le Creuset → Tea | asked · FULL vs "Casual Elegance", "Modern" (exemplar "Gelateria Nona Strada") · 24 calls | **Opus:** asked correctly · PARTIAL · Bigelow, Clipper, Twinings · 12 calls (ran out of iterations before references) |
| L-C1 Rapha: cycling, mountaineering, coffee | PARTIAL / DESCRIPTIVE / DESCRIPTIVE · 32 calls | **Opus:** PARTIAL ×3 · 24 calls |
| L-C2 Liquid Death: heavy metal, moonlit gastronomy | PARTIAL / INSUFFICIENT (gastronomy resolved literally to an Indonesian "terang bulan" pancake) · 32 calls | **Opus:** PARTIAL / INSUFFICIENT · 14 calls |
| L-E1 Oatly frontier | **no candidate at all** (all related-brand concepts were barren media tags) · 14 calls | **Haiku:** 4 candidates, represented with other entity types (books, artists): 2 PARTIAL, 2 DESCRIPTIVE · 32 calls · ≈ $0.02 |
| L-E2 Allbirds frontier | 3 FULL + 1 DESCRIPTIVE (exemplars incl. "47, Elwood, Zynga") · 32 calls | **Haiku:** 2 PARTIAL, 2 INSUFFICIENT · 31 calls |

| Metric | Baseline (7 cases) | Opus 5.5 (5 cases) | Haiku 5.5 (2 cases) |
| --- | --- | --- | --- |
| structural expectations passed | 7/7 | 5/5 | 2/2 |
| valid actions, first attempt / after repair | 0.955 / 0.985 | 0.979 / 1.0 | 0.958 / 1.0 |
| unknown tools / invalid arguments / repairs | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| territory resolution | 1.0 | 1.0 | 1.0 |
| representation success | 0.94 | 0.75 | 0.75 |
| FULL analysis rate | 0.56 | **0** | **0** |
| avg Qloo calls | 25.4 | **14.4** | 31.5 (frontier only) |
| p50 latency | 168 s | 126 s | 248 s |
| model tokens in / out | — | 277k / 39k | 188k / 35k |
| model cost | — | **$1.51** (≈ $0.30/case) | **$0.033** (≈ $0.017/case) |
| model synthesis accepted by claim validation | n/a | **0 of 5** (template used) | **0 of 2** (template used) |

Hard gate requirements (Haiku run, where the gate was computed): 0 permission violations, 0 leakage, 0 methodology overrides, 0 accepted unsupported claims, 0 secret leakage, claim and methodology consistency 1, 0 budget violations. For the stopped Opus run the decision contexts were not persisted, so its leakage check was not recorded; its results pass every other hard check when recomputed from the saved responses.

**Frontier stability:** not measured (the Opus stability repeats were stopped; the Haiku frontier cases ran once).

**Benchmark through the agent (§30):** run with the baseline arm only, on code that still had the fixed 14-call resolution budget: every benchmark territory ended INSUFFICIENT (all 57 assertions not comparable) — the runtime failure later fixed, not a benchmark finding. Not re-run on the final code or with a model.

## Skill-Level Evaluation

`pnpm eval:agent` aggregates `SkillEvalOutcome` per skill version over all synthetic runs, and every skill's `evalIds` must name a scenario (gate). Sprint 4 added 9 skill-targeted scenarios (`sk-*`). Synthetic results (scripted + baseline runs pooled):

| Skill | Runs | Success | Notable metrics |
| --- | --- | --- | --- |
| interpret_request v1 | 34 | 1.00 | 1.03 turns |
| resolve_brand v1 | 34 | 0.91 | 0 unnecessary describe calls; failures are the deliberate not-found / no-silent-choice cases |
| resolve_territory v2 | 30 | 0.97 | 1.2 tag searches, 2.5 Qloo calls per run |
| build_territory_representation v2 | 29 | 1.00 | VALID rate 0.79, 0.83 quality rejections per run, semantic vetoes 0.03, weak alternates 0.10 |
| build_comparison_set v1 | 19 | 0.53 | 0.95 references proposed and represented per run; failures are cases with no usable same-type reference |
| explore_candidate_territories v1 | 7 | 0.29 | Qloo-support rate 0.78, duplicate rate 0.14, unsupported-hypothesis rate 0.57 (deliberate unsupported/duplicate scenarios) |
| analyze_territories v1 | 29 | 0.97 | 0.41 methodology runs per run |

These are synthetic and many scenarios fail deliberately (forbidden behaviours), so success rates describe the scenario mix, not live competence.

## Failure Taxonomy

`AgentFailureCategory` (shared contract): MODEL_DECISION_ERROR, TOOL_SELECTION_ERROR, TOOL_ARGUMENT_ERROR, ENTITY_RESOLUTION_ERROR, TERRITORY_RESOLUTION_ERROR, REPRESENTATION_ERROR, EXEMPLAR_SEMANTIC_ERROR, CONCEPT_DUPLICATION_ERROR, EVIDENCE_SUFFICIENCY_ERROR, ANALYSIS_ROUTE_ERROR, QLOO_DATA_LIMIT, QLOO_TOOL_ERROR, BUDGET_EXHAUSTED, CLAIM_VALIDATION_ERROR, BENCHMARK_LABEL_ERROR, METHODOLOGY_ERROR.

- Runtime side: `classifyRunFailure` assigns every result a primary `failureCategory` (null when it produced measurable evidence).
- Evaluator side: `expectationFailureCategory` classifies each failed eval case from what its expectations caught.
- Benchmark-through-agent assertions are classified AGENT_ERROR / QLOO_DATA_LIMIT / REPRESENTATION_ERROR / METHODOLOGY_ERROR; while labels are not owner-reviewed a robust-but-wrong order is reported as `METHODOLOGY_ERROR|BENCHMARK_LABEL_ERROR`.

## Observability

Per turn: skills (id, version), tools and actions exposed, context chars and token estimate, provider usage (input, output, cache read/write), model attempts, repair reason, first-attempt validity. Per tool call: skill and version, expected value, Qloo operations, correlation ids, latency. Per run: representation-quality decisions (deterministic signals, model assessment, rule, final), concept-dedup decisions, sufficiency with next actions and material gap, early stops with calls avoided, skill usage, comparison-set construction. Metrics add model turns/attempts, first-attempt and after-repair validity, unknown tools, invalid arguments, unsupported state actions, synthesis attempts, calls avoided, context sizes, model and Qloo latency, and model cost (priced only for a live model with a known price: `claude-opus-5-5` at $4 / $20 per MTok, cache reads $0.20). Excluded: chain of thought, secrets, raw prompts.

`/dev/agent` shows all of this (skills per turn, exposure, repairs, quality decisions, dedup, comparison set, next-action values, budgets and early stops). `POST /api/agent/analyze` and `/continue` are unchanged in shape; the result adds `skillsUsed`, `comparisonSetConstruction`, `layers` (Qloo evidence · system analysis · agent interpretation) and `failureCategory`. No prompt text is returned (tested).

## Generalization

Synthetic: 9 generalization-tagged scenarios (unseen brands, unseen territories, place-represented territories, weak pools, recovery, unsupported cases) pass with no code change; new world entries (fictional brand with media-genre profile, cafe pool with an outlier, word-family concepts with disjoint pools, place-typed references) required no runtime change. The baseline's synthetic full-analysis rate rose from 0.279 (Sprint 3 eval) to 0.9 because the generic reference strategy now completes comparison sets, including with places.

Live: all 7 live cases use brands outside the benchmark and territories never seen in development; no code change was needed for any of them. Different cases took different routes (FULL, PARTIAL, DESCRIPTIVE, INSUFFICIENT) and different entity types (brands, places, books, artists). Haiku represented frontier territories with books and artists — a representation type the baseline never chooses.

## Runtime/Eval Isolation

- Moved out of `backend/src` (no longer in the production build): `capture/` → `scripts/capture/`, `feasibility/` → `scripts/feasibility/`, the synthetic world transport → `scripts/synthetic/`, and the benchmark label schema + calibration (the label→class mapping) → `scripts/benchmark/`. `backend` build now starts from an empty `dist`.
- `tests/agent-generalization.test.ts` (G1): nothing outside `src` is reachable from the API or agent entry points; no capture/feasibility/synthetic/benchmark/calibration file exists in `src`; no `src` file references `evals/fixtures`, `world.json`, `scripts/` or `expected_*`. G2 (no benchmark names in runtime code or prompts) unchanged.
- Benchmark `ownerReview.owner_reviewed: false` is recorded in `benchmark.json`; labels were not changed. Labels are read only by evaluators, after runs.
- Leakage: synthetic eval — any benchmark name in a model context; live eval — a benchmark name in a model context that Qloo did not return in that run (Qloo may legitimately return a benchmark brand as evidence), or any `expected_*` label.

## Performance

Profiling the seven Sprint 3 live traces: latency ≈ 7 s × Qloo calls (the provider's call spacing); model time was zero (baseline). Repeated resolution and redundant profile calls were absent (the within-run cache already answers identical requests); the waste was **reference probing**: in single moves, ~7 of ~15 calls probed media/music tags from the brand profile that never return brand members, and the moves still ended PARTIAL.

Sprint 4 levers: namespace-yield ordering and target-neighbourhood reference candidates (probes go first to productive namespaces), early stopping (no-value/duplicate/exhausted refusals), and exact+structural dedup before representation calls. No cross-run Qloo cache was added: within-run caching already covers identical reads, and a cross-run cache would complicate freshness without a measured need. The call spacing was not changed (no measurement justifies a lower value against the live rate limits).

Live (final runtime): baseline p50 168 s at 25 calls (Sprint 3 single moves: 84–113 s at 13–17 calls but every one PARTIAL; the extra calls buy reference sets and candidate profiles). Opus p50 126 s at 14 calls — fewer calls than the baseline; model time is small next to the 7 s Qloo spacing. Haiku is slower per frontier case (248 s, 31 calls) because it explored more. Latency remains spacing-bound (≈ 7 s × calls).

## Known Limitations

- **No model ran the full live set.** Opus covered 5 cases, Haiku 2; stability was not measured. Model synthesis never passed claim validation (0/7): the template was always used.
- **FULL analysis can be culturally meaningless.** The deterministic reference strategy accepts any concept with ≥ 2 brand-independent members of the target's type, e.g. hotel-amenity tags as references for fly fishing; the methodology then classifies the target relative to them. `comparisonSetConstruction` exposes this, but nothing deterministic rejects it.
- **Literal concept resolution** ("moonlit gastronomy" → an Indonesian pancake named "full moon") is not detected deterministically.
- **Three more live-only runtime bugs** were found and fixed: circular reference support (the target's own exemplars counted as reference members), skill budgets that did not scale per territory and deactivated anchoring, and investigation starving analysis of its Qloo calls (now an analysis reserve). Each has a regression test.
- **The repo lives on an iCloud-synced Desktop.** Evicted `node_modules` files ("dataless") made the Qloo harness hang and tests time out; `pnpm install --force` restores them.
- **Live regression caught and fixed during the sprint.** The first live baseline run resolved no territory: just-in-time compaction turned 20-member Qloo pools into a string preview, so the policy never read its probes and the runtime (correctly) refused the repeated calls. Synthetic pools were too small to trigger it. Fixed with structural compaction and a regression test (`last-turn compaction (live regression)`).
- Relative quality signals need ≥ 2 peer profiles; without them quality is *unverified*. Truncated top-20 tag profiles can hide a concept a real exemplar carries.
- Word-family dedup is a light stemmer (plural, `-ing`, `-er`); it misses synonyms (left to the model's layer 3) and could merge rare true distinctions (the model may mark them DISTINCT).
- The largest context grew 15% when several skills are active (tool-schema union).
- Default budgets rose (iterations 8 → 12; Qloo 20/30/30 → 24/32/32) to pay for candidate profiles and references; live latency per call is unchanged.
- Benchmark labels are still unreviewed by the owner.
- `methodology-properties.test.ts` property tests time out on this machine under heavy external load (5 s default); `src/methodology` is unchanged.

## Agent Model Readiness Decision

**`AGENT_MODEL_NOT_READY`.**

Why, in order of weight:
1. **No model completed the live set** (Opus 5/7, Haiku 2/7), and frontier stability was not measured: readiness cannot be claimed on partial evidence.
2. **The model never completed a comparison set** (FULL rate 0 vs baseline 0.56): it stops before references (iteration budget) or skips recovery (Opus did not try places for fly fishing although the runtime offered it).
3. **Model synthesis failed claim validation every time** (0/7); the guardrail worked, but the model is not yet writing usable summaries.

What the model demonstrably adds: free-text interpretation; far better exemplars (real coffee and tea brands where the baseline chose an energy drink and a gelateria); correct ambiguity handling; about half the Qloo calls (Opus); frontier candidates where the baseline found none (Haiku on Oatly). Hard safety requirements held in every model run.

Cost: Haiku 5.5 is ≈ 18× cheaper per case than Opus 5.5 here ($0.017 vs $0.30). The automatic quality comparison in the Haiku report flags "regressions" that are artifacts (2 frontier runs compared with 7 mixed baseline cases); the gate must compare matching case ids — a Sprint 5 fix.

The gate (`scripts/agent-live-harness.ts → readinessGate`) is explicit. Hard requirements on the LIVE_MODEL arm: 0 permission violations, 0 benchmark leakage, 0 deterministic-methodology overrides, 0 accepted unsupported claims, 0 secret leakage, claim consistency 1 after bounded repair, methodology consistency 1, 0 budget violations. Quality (task completion, valid-action rates, tool selection, territory resolution, representation success and quality, full-analysis rate, calls, iterations, latency) is compared with the BASELINE arm; a material regression (e.g. one more failed case, −0.15 representation success, −0.2 full-analysis rate) makes the model NOT READY. With no model run, the gate returns NOT READY by construction; a baseline or scripted run can never satisfy it.

## Sprint 5 Readiness

Not ready for product work on top of the model. Next: run one cheap model (Haiku 5.5) on the full live set and improve it through the runtime — concrete recovery hints (name the untried entity types), a resolve-skill procedure that tries another entity type before anchoring, an iteration budget that leaves room for references, a deterministic reference-relevance check, synthesis prompts tuned to the claim validator — measuring each change against the same set before considering a larger model.
