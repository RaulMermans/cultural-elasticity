# Sprint 5A — Haiku Agent Reliability, Semantic Evidence Quality and Production Readiness

Sprint 5A (2026-10-20). Branch `sprint/5a-haiku-agent-reliability`, from Sprint 4 at `0fe4b03`. Code: `backend/src/agent/` (new: `semantic-comparison.ts`). Contract: `packages/shared/src/agent.ts` (`ce-agent-result/0.3`, additive). Evals: `pnpm eval:agent` (synthetic, 46 scenarios), `backend/tests/agent-sprint5a.test.ts` (30 adversarial tests), `pnpm eval:agent:live` (live Qloo + Haiku).

> **Result: ENGINEERING_COMPLETE. Readiness: `AGENT_MODEL_NOT_READY`.** The coverage-complete gate computed `AGENT_MODEL_READY`: all 13 hard checks pass on 7/7 Haiku cases, with a case-matched baseline and measured stability. It is overridden on two quality requirements the gate does not encode (§28): **meaningful reference sets were not demonstrated in the final run** (0 FULL; a recovery side effect, diagnosed below) and **frontier stability is weak** (concept overlap 0.067 and 0.2). See *Readiness Decision*.

## Architecture Decision

The architecture is unchanged: one Haiku agent proposes actions, and a deterministic runtime owns truth and control.

```
SINGLE HAIKU AGENT ─→ DETERMINISTIC RUNTIME ─→ SKILLS + TOOL REGISTRY ─→ QLOO EVIDENCE
   ─→ DETERMINISTIC METHODOLOGY ─→ RUNTIME EVALUATORS (now: SemanticComparisonValidator) ─→ CLAIM VALIDATION ─→ STRUCTURED RESULT
```

Sprint 5A adds no agent, framework or reflection loop. It adds:

- one deterministic evaluator (semantic comparison validity);
- one deterministic planner (reference construction);
- one state-grounded recovery contract;
- a `focus` block at the top of the decision context;
- grounded synthesis findings;
- a readiness gate that cannot approve incomplete evidence.

## Starting State

| | |
|---|---|
| Branch / HEAD | `sprint-1-evidence-core` at `0fe4b03` (Sprint 4 **already committed**; worktree clean, so the "stop if dirty" condition did not apply) → new branch `sprint/5a-haiku-agent-reliability` |
| Baseline tests | lint, typecheck pass; backend 457/457 |
| Model configuration | `DEFAULT_AGENT_MODEL = "claude-opus-5-5"`, effort `high`, server-side refusal fallback for Opus |
| Qloo configuration | `qloo mcp` transport, hackathon host gate (`QLOO_API_BASE_URL` = `https://hackathon.api.qloo.com`), 7 s call spacing |
| Readiness | `AGENT_MODEL_NOT_READY` (Opus 5/7 cases, Haiku 2/7, no stability run) |
| Environment | Node 22 via nvm; iCloud had evicted 1,356 `node_modules` files (`pnpm install --frozen-lockfile --force` restored them) |

## Model Decision

**Claude Haiku 5.5 (`claude-haiku-5-5`) is the sole production model.**

- `DEFAULT_AGENT_MODEL` is Haiku.
- No Opus fallback, escalation or router exists. The Haiku request carries no `fallbacks` parameter (Haiku 5.5 has no server-side refusal fallback).
- `AGENT_MODEL` may override the model for development. Readiness is judged on `claude-haiku-5-5` runs only (`READINESS_MODEL_ID`).
- The baseline policy is never substituted: without a key the factory throws `LIVE_AGENT_MODEL_VALIDATION_NOT_RUN`.

**Effort.** Haiku 5.5's API default is `medium`. Sprint 4's Haiku runs used `high`. No controlled comparison of the two exists, so `high` is kept and sent explicitly (`DEFAULT_AGENT_EFFORT`, overridable with `AGENT_EFFORT`). It is recorded as `model.effort` and `metrics.model_effort` in every result. Token limits are unchanged (`max_tokens` 16,000).

**Cost accounting.** Costs come from provider-reported usage: uncached input, cache reads, cache writes and output. The price is $0.10 / $0.50 per MTok, with cache reads at $0.01 and writes at $0.125 (prompts up to 100K tokens; every turn here is far below that). Every result records `metrics.model_id`, `model_effort`, `model_input_tokens`, `model_output_tokens`, `model_cost_usd` and `model_latency_ms`. Missing usage stays `null`; it is never estimated.

**On the Sprint 4 costs.** Opus cost about $0.30 per case over five move/compare cases; Haiku cost about $0.017 per case over two frontier cases. These are **different case sets**. They are not a controlled quality or cost comparison, and Sprint 5A does not claim one.

## Sprint 4 Failure Analysis

The failures below were diagnosed from the stored Sprint 4 live traces (`backend/feasibility-output/sprint4-live/{model1,model2,haiku-frontier,final2}`): Opus on L-M1–M3 and L-C1–C2, Haiku on L-E1–E2, and baseline v2 on all seven. `model1` was an API failure (0 tokens, 1 s per case), not a model-quality signal.

| # | Observed failure | Root cause in the traces | Fix (Sprint 5A) |
|---|---|---|---|
| 1 | The model never assembled a reference set (5/5 Opus move/compare runs ended PARTIAL) | Once the target was represented, sufficiency rated `add_references` and `analyze` both **MEDIUM**. The model analyzed (T8), the target became `analyzed`, sufficiency flipped to SUFFICIENT and further Qloo calls were refused, so the route was locked to PARTIAL. The model's turn budget was **not** exhausted (9 of 12 turns used). | Deterministic `referencePlan`. While a meaningful set is feasible within the remaining calls, turns and slots, `add_references` is **HIGH**, `analyze` is **LOW**, and the first `analyze` of a target is deferred once (`REFERENCES_PENDING`, the exact requirement in the message, not counted as an invalid turn). |
| 2 | Recovery suggestions ignored (L-M2 Fly Fishing → INSUFFICIENT) | Opus probed **7 tag namespaces with `brand` only** (all empty) and spent the resolve skill's 8-call budget. `place` was never tried. The context offered only generic options. | Barren-probe rule: an entity type empty for ≥ 2 of a territory's concepts is refused (`NO_VALUE_ACTION`), naming the untried supported types. Per-territory probe ledger and `recoveryGuidance` (what failed, remaining strategies, untried types in run-evidence order, alternate concepts, attempts left, tool per step). |
| 3 | Culturally meaningless FULL (baseline) | References came from **one** target exemplar's profile, in venue-listing namespaces: `amenity:qloo:breakfast_buffet`, `dining_option:qloo:breakfast_available`, `decor:qloo:casual_elegance`, plus a single-exemplar `cuisine:qloo:modern`. `operational-tags-v1` keeps `:qloo` amenities by design. | SemanticComparisonValidator (below). Replaying the stored baseline results with the new evaluator: **2 of 5 FULL results invalid** (YETI → Fly Fishing, Le Creuset → Tea). |
| 4 | 7/7 model syntheses rejected | Final-attempt violations (21): 10 robustness wording, 5 class language, 5 prediction/score, 1 causal. The 10 robustness rejections all name PARTIAL territories with coherence evidence ("not measured"). The trigger list included `consistently`, the coherence field (`consistentlyShared`) the model naturally describes → **false positive (inferred: Sprint 4 did not store rejected texts)**. 4 class rejections were Haiku listing every class name in a negated sentence (correctly rejected by policy). The prediction/score hits were likely negated disclaimers ("not a prediction"). | `consistently` removed from robustness wording. Directly negated noun disclaimers exempt (`not a prediction`, `no score`); affirmative forms still rejected. The prompt forbids writing disclaimers and naming classes for unclassified territories. Grounded findings. Rejected outputs and categories now stored per attempt. |
| 5 | Numbers whitelisted run-wide | `allowedNumbers()` let any number from any territory appear in any claim (misattribution possible). | Numbers are grounded per scope: a territory note may use only that territory's values; a summary sentence only those of the territories it names, plus run-level counts. Findings must cite fields whose values contain each number. |
| 6 | Readiness gate could approve an incomplete set | `readinessGate` received only successful runs; errors were printed and dropped; no coverage, model-identity or stability requirement. | New gate contract (below). |
| 7 | Leakage false positive (model1) | The L-M1 request itself names a benchmark exemplar brand; the live leakage check already excludes request text. The model1 flag came from a failed-API run. | Kept as is; noted. |
| 8 | Latency | 115–330 s per case; Qloo spacing (7 s × calls) was not separated from Qloo response time. | Spacing and back-off are measured separately (`qloo_spacing_ms`), as are analysis and synthesis time. |

Calls consumed unnecessarily in Sprint 4: L-M2 spent 6 empty brand probes, plus one duplicate refused. Haiku L-E1 fetched 9 candidate profiles in one turn (allowed, MEDIUM value).

## Semantic Comparison Validation

`backend/src/agent/semantic-comparison.ts` (`semantic-comparison-v1`) judges structure and meaning separately.

**Structural** (`VALID` / `INVALID`):

- ≥ 3 members of one entity type;
- distinct concepts;
- no exemplar shared between territories;
- every exemplar and concept provenance-backed.

**Semantic, per reference territory:**

| Status | When |
|---|---|
| INCOMPARABLE | operational tag; venue-listing attribute namespace (`amenity`, `dining_option`, `service_type`, `good_for`, `decor`, each backed by values observed live); or the agent judged it weak/mismatched (advisory veto) |
| WEAK | descriptor namespace (`ambience`, `emotional_tone`, `audience`, `adjective`), or the only Qloo tie is one target-exemplar profile |
| MEANINGFUL | on the brand's own Qloo tag profile, or carried by ≥ 2 VALID target-exemplar profiles (correlation ids recorded as evidence) |
| UNKNOWN | no Qloo tie observed in the run |

The runtime enforces the verdict:

- Only MEANINGFUL references are accepted.
- A model judgment can only remove: "strong" never upgrades WEAK or UNKNOWN (AGENTS.md runtime rule 12).
- Proposing an incidental tag is refused (`PRECONDITION`).
- Anchoring a reference to a non-meaningful concept drops it before any Qloo call (`SEMANTIC_REFERENCE_REJECTED`).
- In analysis, rejected references are removed and the rest re-assessed. A group is ranked (FULL) only if it is structurally VALID with ≥ 3 accepted members. Otherwise its territories degrade with `SEMANTIC_COMPARISON_INVALID` / `SEMANTIC_REFERENCE_REJECTED` limitations.
- Every assessment is returned (`comparisonSetConstruction.semanticAssessments`, `trace.semanticAssessments`, `comparisonSet.semanticStatus`).

The validator uses no list of good territories, brands or pairs.

**Demonstration** (`s5-meaningless-reference-refused`, SYNTHETIC reproduction of the live failure): a place-represented activity whose only reachable references are breakfast buffet, breakfast available, rustic-charm decor and a single-lodge tie ends PARTIAL. None of those references is ever proposed. Frontier generation excludes venue attributes the same way (`s5-frontier-incidental-excluded`).

## Reference Strategy

`reference-strategy.ts` v2 keeps the Sprint 4 sources and signals (brand profile, target-exemplar profiles, namespace yield, member availability, type compatibility). Each candidate now also carries its semantic verdict:

- Non-MEANINGFUL candidates are never `usable` and rank last.
- The model context lists only MEANINGFUL candidates. `evidence.referencePlan` lists the rejected ones with reason codes.

`referencePlan(state)` reports:

- required, valid and needed counts;
- pending references and meaningful candidates;
- rejected candidates;
- whether FULL is **feasible** within the remaining Qloo calls (needed × 2 + pending + analysis reserve + profiles still to collect), turns (≥ 3), candidate slots and the comparison-set skill budget;
- the exact outstanding requirement as one instruction, e.g. "2 more meaningful place reference territories are required for a relative position (have 1 of 3)…".

Until the brand and target-exemplar profiles are collected, "no candidate" means "not yet discovered" (feasible, with an instruction to fetch them). Once FULL is infeasible, the agent stops pursuing it, and the PARTIAL result is a valid outcome.

## Representation Recovery

Recovery is evidence-driven, in the order: available strategy → untried supported entity type → alternate Qloo concept → `declare_concept_only`.

- `typePreference` orders types by the members they returned in this run, then `place`, `brand`, then the other rankable Insights types (all accepted by `qloo_recommend`; none invented).
- `probeLedger` shows which (concept, type) probes were made and how many members each returned.
- `recoveryGuidance` turns that into steps, e.g. "brand probes of 2 of this territory's Qloo concepts returned no members: do not probe brand again" and "not yet probed with the supported entity type(s) place, artist, book → qloo_recommend on urn:…, conditionOnBrand=false".
- Exhausted strategies, rejected exemplars and barren probes are refused, never repeated.

Two recovery behaviours, demonstrated offline:

1. **Barren type → switch type** (`s5-barren-probe-switches-type`): the third brand probe is refused with `NO_VALUE_ACTION`, place is probed, and the move reaches FULL with two brand-profile references.
2. **Empty anchored concept → untried type** (`s5-recovery-untried-type`): after an empty brand pool, the context names `place` with the tool, and the territory is represented by places.

## Haiku Context Engineering

Every decision context now starts with `focus`:

- objective;
- stage (`RESOLUTION`, `REPRESENTATION`, `REFERENCE_CONSTRUCTION`, `FRONTIER_DISCOVERY`, `ANALYSIS`, `FINISH`);
- active skills with versions;
- the HIGH-value blocker;
- the exact outstanding requirements (from readiness, the reference plan and recovery guidance);
- `nextAllowed` tools and actions;
- turns and Qloo calls left;
- rejected approaches (last refusals, early stops, candidate rejections).

`sufficiency.nextSteps` and the open plan list were removed from the model context (they duplicated `focus`; both remain in the trace). The system prompt tells the model to read `focus` first and to follow `recoveryGuidance`. It states that an honest PARTIAL beats a meaningless FULL. It contains no brand, territory or benchmark example.

Context size (decision-context JSON, `pnpm eval:agent`, the same 28 Sprint 3 scenarios):

| | Sprint 3 (`d7c67a9`) | Sprint 4 | Sprint 5A |
|---|---|---|---|
| average | 7,856 chars | 6,267 chars | 7,552 chars (~1,890 tokens est.) |
| largest | 16,329 | 18,699 | 22,672 |

The added guidance costs about 20% more context than Sprint 4. At Haiku's prices this is about $0.0001 per turn. Live provider-reported tokens are in the live results.

## Runtime Skills

Seven skills are kept (no new skill). Five are versioned up with updated contracts and evals; `interpret_request` v1 and `resolve_brand` v1 are unchanged.

| Skill | Version | Change | Evals |
|---|---|---|---|
| `resolve_territory` | 2 → **3** | probes across entity types (barren-probe rule); probe ledger and recovery guidance | `s5-barren-probe-switches-type` |
| `build_territory_representation` | 2 → **3** | recovery contract v2 | `s5-recovery-untried-type` |
| `build_comparison_set` | 1 → **2** | semantic validation, `referencePlan`, outstanding requirement, relevant only while feasible | `s5-meaningless-reference-refused`, `s5-references-before-analysis` |
| `explore_candidate_territories` | 1 → **2** | venue attributes excluded and refused; advisory semantic veto | `s5-frontier-incidental-excluded` |
| `analyze_territories` | 1 → **2** | bounded deferral of target analysis while references are feasible; FULL needs semantic acceptance | `s5-references-before-analysis` |

The version pin test (`agent-sprint4.test.ts`) was updated. No runtime self-modification exists; `SkillEvalOutcome` stays an offline input.

## Evidence Sufficiency

v3 keeps HIGH / MEDIUM / LOW / NONE and changes three things:

- **Reference construction** is valued from `referencePlan`: HIGH while feasible, NONE with the reason once it is not (budget, turns, slots, no meaningful candidate).
- **Analyze** is LOW while references are pending and no deferral has happened yet.
- **Barren probes** are NONE.

`investigationStage(state)` names the stage. A useful PARTIAL remains a valid stopping outcome; success is not equated with FULL.

## Structured Synthesis

The model now answers with:

```
{ summary, findings: [{ territoryKey, claimType, supportingFields, interpretation, limitationCodes }], followUpOptions }
```

- `claimType` must be supported by the territory's route (e.g. `relative_position` only with a relative position).
- Every `supportingFields` path must resolve to a value in that territory's result view.
- Every number in the interpretation must be a value of those fields.
- Limitation codes must be the territory's own.

The runtime validates the findings, renders them as territory notes, then runs the full claim validator. Findings appear in `layers.agentInterpretation.findings`; Qloo evidence and system analysis stay in their own layers. Free-text `territoryNotes` remain accepted (scripted fixtures). The deterministic template is unchanged and always passes.

## Claim Validation

The changes are evidence-based, not relaxations:

1. `consistently` is no longer robustness wording (a proven false-positive class: 10/21 Sprint 4 rejections).
2. A directly negated **noun** disclaimer (`no/not/never/nor/without` + prediction, forecast, score, index, confidence, guarantee) is not a claim. Verbs ("Qloo predicts…"), affirmatives ("high confidence") and commercial or causal words are still rejected.
3. Numbers are grounded per scope instead of a run-wide whitelist (strengthened, §16).

Each attempt now stores its categorized rejections:

- `SCHEMA`
- `INVENTED_NUMBER`
- `UNSUPPORTED_CLASSIFICATION`
- `MISMATCHED_ROBUSTNESS`
- `MISMATCHED_EVIDENCE_QUALITY`
- `PROHIBITED_COMMERCIAL_OR_PREDICTION`
- `UNSUPPORTED_CAUSAL`
- `PROHIBITED_METRIC_LANGUAGE`
- `INVALID_NAMED_ENTITY`
- `UNKNOWN_TERRITORY`
- `UNGROUNDED_FINDING`

The rejected output (the model's answer, never reasoning) is kept in `trace.synthesis.attemptDetails`. Metrics: `synthesis_first_attempt_valid`, `synthesis_valid_after_repair` and `synthesis_fallback`. Live aggregates add first-attempt acceptance, acceptance after repair, fallback rate, a useful-synthesis rate (every evidenced territory covered by a finding, ≥ 1 follow-up) and unsupported claims accepted.

## Live Evaluation Coverage

The live evaluation ran on 2026-10-21 against live Qloo (`qloo-mcp`, hackathon host gate passed), with model `claude-haiku-5-5`, effort `high` and manifest `agent-live-v1`. The command was:

```sh
pnpm eval:agent:live -- --arms baseline,model --stability 3 --out backend/feasibility-output/sprint5a-live/final
```

Run under `caffeinate`.

- **Coverage:** baseline 7/7 and Haiku 7/7, plus 4 stability repeats. No errors, no omissions, 18/18 runs complete. Every case passed its structural expectations (`runs_passed` 7/7 per arm).
- **Ambiguity:** L-M3 (Le Creuset) went NEEDS_INPUT → user answer → COMPLETE. The brand was never picked silently.

Two earlier live runs are **diagnostic, not readiness results**:
- `focused1`: Haiku on L-M1 and L-M2 only.
- `full1`: an earlier full run whose findings led to three fixes. Its L-E2 timing is invalid because the laptop slept, and it was stopped before its stability repeats.

## Baseline vs Haiku (final run, identical cases)

| Case | Baseline v2 | Haiku 5.5 | Haiku Qloo / turns / $ |
|---|---|---|---|
| L-M1 Aesop → Coffee | PARTIAL | PARTIAL | 15 / 11 / $0.0116 |
| L-M2 YETI → Fly Fishing | PARTIAL (Sprint 4: FULL among breakfast buffet / breakfast available) | PARTIAL (Sprint 4 Opus: INSUFFICIENT) | 15 / 11 / $0.0097 |
| L-M3 Le Creuset → Tea (ambiguous) | PARTIAL (Sprint 4: FULL among casual-elegance decor / "Modern") | PARTIAL, asked the user | 10 / 11 / $0.0065 |
| L-C1 Rapha: Cycling, Mountaineering, Coffee | 3 × DESCRIPTIVE (32-call budget spent) | Coffee, Cycling PARTIAL; Mountaineering DESCRIPTIVE | 23 / 11 / $0.0128 |
| L-C2 Liquid Death: Heavy Metal, Moonlit Gastronomy | Heavy Metal PARTIAL; Moonlit DESCRIPTIVE | Heavy Metal PARTIAL; Moonlit INSUFFICIENT | 23 / 11 / $0.0111 |
| L-E1 Oatly frontier | no candidate | Eco-conscious Living, Scandinavian Minimalism (PARTIAL) | 25 / 11 / $0.0128 |
| L-E2 Allbirds frontier | Soft Textures, Casual Lifestyle Influencers, Coastal (FULL); Athletic Influencers (DESCRIPTIVE) | Self-help (PARTIAL); Folk Music (DESCRIPTIVE); 2 unsupported hypotheses dropped | 30 / 12 / $0.0155 |

| Metric | Baseline | Haiku |
|---|---|---|
| runs passed | 7/7 | 7/7 |
| valid actions, first attempt / after repair | 0.879 / 1 | **0.987** / 1 |
| tool selection accuracy | 0.99 | 0.994 |
| territory resolution / representation success | 1 / 0.917 | 0.929 / 0.846 |
| representation quality accept rate | 0.872 | **1** |
| FULL rate (historical metric, not a competence measure) | 0.25 | 0 |
| semantically valid FULL / invalid FULL | 3 / 0 | 0 / 0 |
| meaningful PARTIAL rate | 1 | 1 |
| unsupported rate | 0 | 0.214 |
| average Qloo calls / iterations | 22.6 / 9.4 | **20.1** / 11.1 |
| p50 / p95 latency | 128 / 224 s | 186 / 239 s |
| unsupported claims accepted | 0 | 0 |

## Cultural Validity

These are rule-based proxy grades from `semanticGrade`: an evaluator rule, not human judgment.

| Run set | FULL | valid FULL | **invalid FULL** | PARTIAL (meaningful) | unsupported |
|---|---|---|---|---|---|
| Sprint 4 baseline (stored live results) | 5 | 3 | **2** | 2 (2) | 4 |
| Sprint 5A baseline, final | 3 | 3 | **0** | 4 (4) | 0 |
| Sprint 5A Haiku, final (11 runs incl. stability) | 0 | 0 | **0** | 19 (19) | 9 |
| Sprint 5A Haiku, diagnostic run `full1` | 7 | 7 | **0** | 5 (5) | 3 |

No semantically invalid FULL was accepted in any Sprint 5A run. Haiku built meaningful FULL comparison sets in the diagnostic run:
- **L-C1:** Rapha's three named territories, all as places.
- **L-C2:** Heavy Metal with Alternative Rock and Electronic, all on Liquid Death's own Qloo profile. Haiku judged both references "adequate, same-level genre alternatives".
- **L-E1:** Plant-based Living, Specialty Coffee Culture and Environmental Activism.

All of those carried LOW robustness and "uncertain / representation-sensitive" classes, which is honest. **The final run reproduced none of them** (see Readiness Decision).

The baseline's remaining FULL (L-E2: Soft Textures, Casual Lifestyle Influencers, Coastal) passes the semantic proxy, since frontier candidates are not references and none is a venue attribute. Whether "Soft Textures" is a meaningful strategic territory is a judgment the proxy cannot make.

## Synthesis (live)

| | Sprint 4 (live model) | Sprint 5A Haiku final |
|---|---|---|
| model syntheses | 7 | 7 (+ 4 stability runs) |
| accepted first attempt | **0** | **5/7 (0.714)** |
| accepted after one repair | 0 | **7/7** |
| template fallback | 7/7 | 0/7 (stability runs: 4/4 model) |
| useful (every evidenced territory covered by a finding, ≥ 1 follow-up) | — | 7/7 |
| unsupported claims accepted | 0 | **0** |

Rejection categories in the final run: `MISMATCHED_ROBUSTNESS` × 2, both repaired. Validator fixes during this sprint, each found in a real Haiku answer and pinned by a test that also keeps the affirmative form rejected:
- `consistently shared` is not a robustness claim (Sprint 4 traces).
- A directly negated noun disclaimer is not a claim.
- Negated or contrasted robustness wording ("tentative rather than stable", "cannot be … described as stable") is not a claim. The negation's scope ends at punctuation or a contrast word, so "not the leader but robust" is still rejected.
- An unnamed level claim in a single-territory run attaches to that territory and must match it.

Re-validated offline, the four rejected L-M1/L-M2 answers from the diagnostic run are accepted. One answer was rejected correctly: it cited a relative position for a PARTIAL territory.

## Frontier Stability

Three independent Haiku runs per frontier case, `stabilityReport`:

| Case | Candidate sets (3 runs) | concept overlap | supported-concept overlap | route stability | comparable class pairs |
|---|---|---|---|---|---|
| L-E1 Oatly | {Eco-conscious living, Scandinavian minimalism} · {Folk music, Veganism & plant-based nutrition, Feminism*, Self-help*} · {Feminism, Folk music, British/London*, Cooking*} | 0.067 | 0.111 | 1 | 0 |
| L-E2 Allbirds | {Self-help & personal growth, Folk music, Female-led storytelling*, Philanthropy*} · {Folk & Americana, Self-help, Female-led storytelling*, Philanthropy*} · {Female-protagonist storytelling, Folk music, Self-help literature, Social responsibility causes} | 0.2 | 0.111 | 1 | 0 |

`*` = dropped as unsupported (`INSUFFICIENT`).

**Stability is weak at the concept level.** For L-E2, the *themes* recur in every run (folk music, self-help, female-led storytelling, social responsibility), but the anchored Qloo concepts differ, so concept overlap stays low. L-E1 varies in themes as well. No run produced classes for the same comparison set twice, so classifications are not compared (comparable pairs 0). This is reported as `FRONTIER_INSTABILITY`; candidate lists were not hardcoded to stabilize it.

## Latency and Cost

| | Haiku final (7 cases) | Haiku stability (4 runs) | Baseline (7 cases) |
|---|---|---|---|
| model cost | **$0.080** ($0.0065–$0.0155 per case, mean $0.0114) | $0.068 | — |
| model input / output tokens | 520,434 / 86,131 | — | — |
| Qloo calls | 141 (mean 20.1) | 128 | 158 |
| p50 latency | 186 s | ~270 s | 128 s |

Per Haiku case, the latency splits as:
- model 27–60 s;
- Qloo 41–162 s, of which **34–141 s is the 7 s rate-limit spacing**;
- analysis 0–50 s;
- synthesis 10–26 s.

The bottleneck is the Qloo spacing, not the model. Spacing was not reduced (rate-limit safety), and no cache was added.

The decision context averaged ≈ 2,984 tokens (est.) per live turn, max 8,789. 119/126 live turns were valid on the first attempt.

Sprint 4 Opus (about $0.30 per case on 5 move/compare cases) and Sprint 5A Haiku ($0.011 per case on the same 7-case manifest) were not run as a controlled model comparison. No quality-per-model claim is made.

## Readiness Decision

**Gate output: `AGENT_MODEL_READY`.** All 13 hard checks pass:
- coverage 7/7;
- a single model, `claude-haiku-5-5`;
- baseline coverage 7/7;
- stability MEASURED;
- 0 permission violations, 0 leakage, 0 methodology overrides, 0 accepted unsupported claims, 0 semantically invalid FULL, 0 secret leakage, 0 budget violations;
- claim and methodology consistency 1.

No material regression versus the baseline.

**Sprint decision: `AGENT_MODEL_NOT_READY`.** The gate encodes the hard requirements and baseline regressions, but not two of §28's quality requirements. On those, the observed evidence does not support readiness:

1. **Meaningful reference sets were not demonstrated in the final run.** There were 0 FULL results, against 7 valid FULL in the diagnostic run on the same cases. The diagnosed cause is a recovery side effect introduced this sprint: `recoveryGuidance` lists every untried supported entity type. In final L-C2, Haiku probed an unsupported concept with eight types over four turns. It found valid reference genres (all with members) only at T8–T9, with two turns left. The reference plan then correctly judged FULL infeasible, and the run analyzed PARTIAL. In final L-C1, Haiku anchored Coffee to a brand-type concept while the other two targets were places, so no single-type set existed.
2. **Frontier stability is weak** (concept overlap 0.067 / 0.2).

The hard safety record is clean: 0 invalid FULL, 0 accepted unsupported claims, 0 violations. Synthesis now works (7/7 after repair, 0 fallbacks). The remaining gap is investigation quality, not safety.

## Runtime Observability

Each run can explain:

- the active skill, the tools offered and the tool chosen, per turn;
- why a representation was rejected (representation-quality decisions);
- why a reference was rejected (`candidateRejections` with stage `semantic`, `semanticAssessments`);
- why recovery was attempted (barren-probe and early-stop records, `recoveryGuidance` in context);
- why FULL or PARTIAL was selected (route limitations, semantic assessments);
- why each next action was useful (`expectedValue` per tool call);
- why investigation stopped (`trace.stopReason`);
- why synthesis was rejected (`attemptDetails`) and whether the template was used.

No chain of thought, prompts or secrets are stored.

## Generalization

No production file names a brand, territory, exemplar or benchmark label. `agent-generalization.test.ts` passes; it caught one benchmark word in a code comment during this sprint, which was removed. The namespace policies are categories of Qloo's taxonomy, each backed by live-observed values. The new synthetic world entries are fictional (`SYN-BR-2001…`, `SYN-PL-2001…`). The live cases are unchanged (`agent-live-v1`, 7 cases).

## Failure Taxonomy

The Sprint 4 categories are kept. Added:

- `SEMANTIC_REFERENCE_ERROR`
- `REPRESENTATION_RECOVERY_FAILURE`
- `REFERENCE_CONSTRUCTION_FAILURE`
- `SYNTHESIS_VALIDATION_FAILURE`
- `SYNTHESIS_FALSE_POSITIVE`
- `INCOMPLETE_LIVE_EVALUATION`
- `FRONTIER_INSTABILITY`
- `AGENT_BUDGET_EXHAUSTED`

`EXEMPLAR_SEMANTIC_ERROR`, `QLOO_DATA_LIMIT` and `MODEL_DECISION_ERROR` already existed and are reused.

## Known Limitations

- **Turn budget versus breadth of recovery.** Recovery guidance can lead Haiku to walk many entity types for a concept Qloo does not support, which squeezes out reference construction (final L-C2). There is no cap on types probed per concept and no "unsupported after N types" stop.
- **Type compatibility in comparisons.** Nothing steers anchoring towards concepts that share an entity type across the targets (final L-C1: coffee as brand, the others as places).
- **Run-to-run variance.** The same case can end FULL in one run and PARTIAL in the next (L-C1, L-C2, L-E1). Frontier concept sets are unstable.
- **The semantic validity grade is a rule-based proxy.** The descriptor and venue-attribute namespace lists are categories backed by observed values, not exhaustive. Brand-profile ties count as meaningful even across domains (e.g. a music genre as a reference for a product category); only the model's advisory veto guards that.
- **Gate scope.** `readinessGate` does not encode frontier-stability thresholds or a "FULL demonstrated" requirement; those are judged in this document.
- **Not compared:** Haiku vs Opus quality (different case sets). Effort `high` vs `medium` was not measured.
- **Live dependence:** about 70% of wall-clock time is Qloo rate-limit spacing. A sleeping host suspends runs (`caffeinate` was needed).

## Sprint 5B Integration Contract

`AgentAnalysisResult` (`ce-agent-result/0.3`; additive over 0.2, so a 0.2 reader that ignores unknown fields keeps working) gives the Cultural Frontier UI:

- **Run:** `status`, `finalSufficiency`, `trace.stopReason`, `model` (`id`, `kind`, `live`, `effort`), `metrics` (Qloo calls, cost, latency split).
- **Qloo evidence** (`layers.qlooEvidence`): the brand with correlation id, concepts and exemplars with provenance.
- **System analysis** (`layers.systemAnalysis`, `territories[]`): route, relative position, robustness, coherence, conditioned evidence, evidence quality and provisional class per territory, plus `comparisonSet.semanticStatus`, `semanticComparison` and `representationDecisions`.
- **Comparison-set construction:** `comparisonSetConstruction` (proposed, rejected with stage, final, dedup, diversity, `semanticAssessments`).
- **Agent interpretation** (`layers.agentInterpretation`): summary, source (model or template), `claimValidationPassed`, grounded `findings`, advisory `semanticJudgments`, `followUpOptions`.
- **Limitations:** per territory and per run.

The UI must render a class only where `classification` is non-null, always next to its comparison set and as provisional, and must show PARTIAL and DESCRIPTIVE routes as such. Migration: consumers comparing `schemaVersion` must accept `ce-agent-result/0.3`. The `/api/agent/*` endpoints and `/dev/agent` are unchanged.
