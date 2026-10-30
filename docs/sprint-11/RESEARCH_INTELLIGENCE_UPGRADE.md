# Sprint 11: Research Intelligence Upgrade

**Status: `RESEARCH_INTELLIGENCE_UPGRADE_COMPLETE_WITH_LIMITATIONS`.** The implementation and every offline check pass. Independent improvement, live competence and human-rated usefulness are **unproven**: no paid run was authorized, so tiers T1–T3 have not run (`LIVE_QLOO_VALIDATION_NOT_RUN`, `LIVE_AGENT_MODEL_VALIDATION_NOT_RUN`). `AGENT_MODEL_READY` is not claimed.

## 1. Starting repository state

| | |
|---|---|
| Base | `main` `c8f3633` (PR #54 merged). No open PRs. |
| Production | Vercel + Railway serve `c8f3633`; the public evaluation is open (1,000 Qloo / $5 ledger) |
| Branch | `sprint/11-research-intelligence`, worktree `~/dev/ce-11` |
| Pre-registration | `89f06a4`, committed before any implementation commit ([PREREGISTRATION.md](PREREGISTRATION.md), [`evals/research-intelligence/cases.json`](../../evals/research-intelligence/cases.json)) |
| Implementation | `0275ec2` plus the follow-up commits listed in §17 |

## 2. Diagnosed root causes

The Phase 0 evidence is in [PREREGISTRATION.md](PREREGISTRATION.md#baseline-diagnosis-phase-0). In short:

| # | Where meaning was lost | Evidence |
|---|---|---|
| R1 | The interpreter kept territory names only. The user's objective, distinctions and exclusions never reached the agent. | Every trace |
| R2 | `anchor_territory` had no notion of whether a tag means what the user meant. | Diptyque ceramics; Vinted space tourism (owner report) |
| R3 | The exemplar judgment was optional, and its scale was not tied to the intended phenomenon. | Dyson L4: Lululemon rated `adequate` "closer to apparel than to retreats" |
| R4 | `analyze_move` had to build references. The model could not decide a ranking was the wrong method. | Dyson L4: 3 of 8 turns probed "doctor", "electronic music", "family relationships" |
| R5 | Synthesis could only restate fields. | Bodum L2, Dyson L4 summaries |
| R6 | The brand's own category was ranked like an extension. | Vinted × online marketplace (owner report) |

**The Vinted artifacts were not retrieved.** They exist only in the production database. A read-only query was refused by this session's permission policy, so the Vinted diagnoses rest on the owner's descriptions and the code paths alone. No Vinted provider output is claimed.

## 3. Architecture decision

The hybrid workflow-agent stays. No new agent, planner, framework, store or persistence was added. The change is a single **research policy v1** that moves research decisions to the model and keeps every boundary in code.

| The model now decides | Code still owns |
|---|---|
| What the user means (research brief) | Tools, permissions, budgets, and turn and call ceilings (none raised) |
| Whether a Qloo concept preserves that meaning (concept alignment) | Qloo provenance and correlation IDs |
| Whether exemplars are instances of the phenomenon | Every number, route, class, robustness and position |
| Whether a ranking answers the question (`reframe_research`) | Refusing the model's own MISMATCHED verdict; qualifying non-equivalent concepts |
| What a finding may mean, why it matters, what could refute it, how to test it | Claim validation for both layers; brand-core detection by tag URN facet |

`CE_RESEARCH_POLICY=v0` restores Sprint 10 research behaviour exactly. That is evaluation arm A and the rollback. Under v0 the model sees the Sprint 10 prompts and the Sprint 10 tool descriptions and schemas. `toolSpecFor` hides the v1-only properties, and `reframe_research` is not exposed.

A deterministic decision policy (the baseline reference policy, or any non-LLM model) always runs v0. It cannot judge meaning, and inventing judgments for it would be fabrication.

## 4. Original versus improved research behaviour (designed; live effect unmeasured)

| Situation | v0 (production) | v1 |
|---|---|---|
| A tag related to but different from the asked concept (space tourism → astrotourism) | Anchored silently and reported as the user's territory | Anchoring needs an alignment judgment. RELATED_DIFFERENT is reported as exactly that (limitation, template, card), and the summary must name the concept actually investigated. A WORTH_FURTHER_INVESTIGATION verdict is blocked. |
| Compound question (repair *and* upcycling) | Reduced to whichever tag matched | The brief splits the concepts. Anchoring one part is PARTIAL_COVERAGE with `uncovered`, shown in the result. |
| The agent itself judges the tag a different phenomenon | Nothing stops it | `CONCEPT_MISMATCH` refusal. The agent must search again, narrow honestly, or drop the territory as unsupported. |
| Athleisure brands standing for wellness retreats | Passed at `adequate` | Judgment required. The scale defines "shares an audience but is not an instance" as **weak**, and weak-only panels are refused by the existing rules. |
| No meaningful reference exists | References are probed anyway | The agent may `reframe_research` to an investigation. Pending references are dropped as not investigated, the result says the comparison was declined, and no budget is added. |
| The brand's own category as target (online marketplace) | Ranked like a stretch | `brandCore` plus the `BRAND_CORE_CATEGORY` limitation. The template, card and insights frame it as established positioning. |
| Synthesis | Restates fields | Two layers: validated findings, plus up to 3 labelled interpretations (observation, interpretation, implication, counterpoint, validation). |

## 5. Brand intelligence design and sources

`brand-intelligence/v1` (`backend/src/agent/research-intelligence.ts`) has three layers that are never merged:

1. **Cited business facts.** `brandContext.facts` on the investigation body, each with a source title, URL or null, and a retrieval date. They are labelled `requester_supplied`, are **not independently verified by the system**, and are never Qloo evidence.
2. **Qloo-observed evidence.** The brand's own profile from this run, split by tag URN facet into classification tags (`BRAND_CLASSIFICATION`: `genre:brand` and curated `industry` / `product_service`, the existing `tagRole` rule) and other taste tags.
3. **Strategic interpretation.** This exists only in synthesis layer 2. Basis `BRAND_FACT` must cite fact refs that exist.

The brief also lists what is unverified: no facts supplied, no category tags, profile not fetched.

**External retrieval was not built.** The backend has no read-only source-retrieval integration. Adding one would create a new outbound surface on a public deployment (SSRF and content-injection review, provenance storage). The sprint brief allows a requester-supplied brief when reliable retrieval is unavailable, and that is what ships. The offline packets for evaluation use the same `brandContext` shape, so both arms see identical facts.

## 6. Research intent and concept alignment

- **Research brief** (`researchBriefSchema`): central question; each concept with `meaning` and `notThis`; useful answer; approach and reason.
  - It is proposed in the **same single interpreter call** (no second interpreter).
  - It is text only, so the strict schema has no field for tools, budgets, evidence or ids.
  - The gate passes a schema-valid brief to the run request. The runtime shows it to the agent every turn (`research.brief`) and to synthesis.
- **Concept alignment** (`EQUIVALENT`, `NARROWER`, `PARTIAL_COVERAGE`, `RELATED_DIFFERENT`, `MISMATCHED`): the agent judges it at `anchor_territory` for user-named targets.
  - When the tag carries the territory's own name, the runtime records `EQUIVALENT` itself; this covers its own same-named auto-anchors. The 10D incidental-attribute rule still blocks material tags first.
  - Code enforces three things: a differently named tag needs a judgment; the agent's own MISMATCHED is refused; any non-equivalence is carried into the limitations, the template, the Decision Card and the single-hypothesis assessment.
  - **No dictionary of concepts, brands or categories exists anywhere.** The categories frame the model's judgment; they are never a lookup.

## 7. Agent autonomy changes

- **Approach.** It starts from the caller (`single_hypothesis_v1` → investigate), else from the gate-approved brief when it fits the operation, else from the operation's default.
- **`reframe_research`** (v1 only; once; before any target is analyzed) moves compare → investigate. It only narrows: no budget is added, pending references are dropped as `NOT_INVESTIGATED`, and the result carries `COMPARISON_DECLINED` with the agent's reason.
- **Single switch.** Every former "single-hypothesis?" check that gated comparison work now reads `withoutComparison(state)`. That covers sufficiency, focus, feasibility, the reference skill, the analysis deferral and the qualitative assessment.
- **Budgets.** The 40-step and per-intent Qloo ceilings are unchanged. Raising them needs evidence from matched traces, and none exists.
- **Skills bumped:** `resolve_territory` v6, `build_territory_representation` v5, `build_comparison_set` v6, `analyze_territories` v4.

## 8. Semantic representation changes

- **Exemplar judgment.** Every exemplar of a user-named territory needs a semantic judgment against the brief (`SEMANTIC_JUDGMENT_REQUIRED`). The relevance scale is now defined:
  - **strong:** a clear instance;
  - **adequate:** an instance;
  - **weak:** shares an audience, aesthetic or product category but is not an instance;
  - **mismatch:** a different phenomenon.
- **Combination rules unchanged.** The model can still only remove (`representation-quality-v1`): it cannot rescue a deterministic rejection or add Qloo support.
- **Comparison selection** is unchanged: the semantic comparison validator and operational-tag rules, plus the agent's new option to decline a comparison.

## 9. Strategic synthesis design

- **Layer 1 (summary, findings)** is validated exactly as before. Under v1 a new framing rule applies: a sentence that names the user's concept for a RELATED_DIFFERENT territory must also name the Qloo concept investigated.
- **Layer 2 (`insights`, up to 3; `validateInsights`):**
  - **Observation** is grounded like a finding: its fields must resolve, its numbers must be values of those fields, and names and class wording must match the run.
  - **Interpretation, implication, counterpoint, validation** are labelled reasoning. They may contain no numbers, no "Qloo shows / affinity" evidence wording, no market facts (trends, demand, willingness to pay, pricing power), no proof or confirmation language, and no capitalized names outside the run and the cited facts. Every existing forbidden-language rule also applies.
  - **horizon** (ESTABLISHED / ADJACENT / SPECULATIVE) is the model's judgment, never a class. A brand-core territory must be ESTABLISHED.
  - **basis** and `brandFactRefs` must agree.
- **Template fallback.** The deterministic template never invents insights. It does state concept qualifications and brand-core framing.
- **Surfaces.** The Decision Card gets a "Strategic interpretation (reasoning, not evidence)" block. Its "why interesting" and "uncertain" lines carry the concept and brand-core qualifications. There is no frontend redesign.

## 10. Evaluation methodology

Pre-registered before implementation ([cases.json](../../evals/research-intelligence/cases.json)):

- 6 development diagnostics and 18 frozen holdouts. The holdout brands are unused anywhere in the repository; their structures cover brand core, adjacency, unexpected links, compounds, near matches, comparisons, weak coverage, abstention, discovery and ambiguity.
- Gold semantics per case, a 0–2 rubric, hard gates and a paired sign-test rule. Ties are not improvement, and n < 16 rated holdouts is `INSUFFICIENT_SAMPLE`.

| Tier | Command | Provider | Status |
|---|---|---|---|
| T0 | `pnpm test` (`tests/agent-sprint11.test.ts`, 20 tests) and existing suites | none (SYNTHETIC) | **PASS** |
| T1 | `pnpm eval:research-intelligence -- --live --approved-usd <N> --out <dir>` | Haiku interpretation only | **NOT RUN** (needs approval) |
| T2 | `pnpm eval:research-intelligence -- --paired --live --approved-qloo <N> --approved-usd <N> --out <dir>` | Qloo + Haiku, shared recordings | **NOT RUN** (needs approval) |
| T3 | blinded `t3-rating-sheet.json` (X/Y order seeded, key in `t3-key.json`) | owner time | **NOT RUN** |

## 11. Paired before/after results

**None.** No paired run has been made. T0 tests show that the v1 contracts behave as designed on scripted decisions over the synthetic world. They are not evidence that Haiku makes better research decisions.

## 12. Independent holdout outcomes

**Not run.** The 18 holdouts remain frozen and unused.

## 13. Human research-quality assessment

**Not run.** The rating sheet is produced by T2.

## 14. Real provider acceptance and costs

No provider call was made in Sprint 11. The cost is $0 Qloo and $0 Anthropic.

### Live validation request (requires explicit owner approval)

Run as a local process with a frozen worktree (per the 10D rule), the operator path and a local ledger. **Never through the public visitor allowance.**

| Tier | Runs | Qloo worst case | Model reservation ceiling | Expected usage |
|---|---|---|---|---|
| T1 interpretation | 24 interpretations | 0 | $0.67 (conservative price, one repair each) | ≈ $0.02 |
| T2 paired holdouts | 36 (18 × A/B) | 928 dispatches before shared recordings | $19.08 (36 × $0.53 reservation) | ≈ 400–650 live Qloo, ≈ $0.35–1.00 Haiku (10D live: 12–30 Qloo and $0.009–0.019 per run) |
| T2 reduced option | 10 (5 holdouts: h01, h02, h08, h11, h16) | 272 | $5.30 | ≈ 120–200 Qloo, ≈ $0.10–0.30 |

- **Retries.** A Qloo `error` is retried at most once, only when retryable, and the retry counts as a dispatch. There is one interpreter schema repair. No automatic replay of an unknown outcome.
- **Stop conditions.** A case starts only if its worst case fits the remaining Qloo and USD allowance. Spend is re-checked after every arm. Live dispatches stop at `--approved-qloo`.
- **Remaining allowance.** The production public ledger (1,000 Qloo / $5) is not touched. The Qloo account-level quota is not visible to me and is unverified.
- **Not covered.** The full T2 does not reach the pre-registered n ≥ 16 rated holdouts unless all 18 run. The reduced option can only report `INSUFFICIENT_SAMPLE`.

## 15. Safety and methodology regressions

| Check | Result |
|---|---|
| `pnpm lint`, `pnpm typecheck` | pass |
| `pnpm test` (backend 1,040 tests across 90 files; frontend 118) | pass |
| `pnpm test:durable` (19), `pnpm test:db` (23), disposable local Postgres | pass |
| `pnpm test:e2e` (64, SYNTHETIC job API) | pass |
| `pnpm build`, `pnpm check:secrets` | pass |
| `pnpm eval:methodology`, `eval:agent`, `eval:query`, `eval:discovery`, `eval:d2d` (offline) | pass |
| Methodology thresholds, numbers, classes | unchanged; no file under `backend/src/methodology` changed |
| Generalization (`tests/agent-generalization.test.ts`) | pass; no brand, territory or concept name in product code |
| Checkpoints | v1 fields round-trip; pre-Sprint-11 checkpoints hydrate as v0 |

## 16. Changed modules and contracts

- **New:** `backend/src/agent/research-intelligence.ts`, `backend/scripts/eval-research-intelligence.ts`, `backend/scripts/research-intelligence/paired.ts`, `backend/tests/agent-sprint11.test.ts`.
- **Shared (additive):** `ConceptAlignment`, `ResearchBrief`, `ResearchApproachRecord`, `BrandIntelligenceBrief`, `StrategicInsight`; optional result fields `researchBrief`, `researchApproach`, `brandIntelligence`, `insights`; territory fields `conceptAlignment`, `brandCore`; `trace.researchPolicy`; Decision Card `interpretations`.
- **Request and query:** `researchBrief` and `brandContext` on the agent request; `researchBrief` in the proposal (v1 JSON schema only); `brandContext` on the investigation body.
- **Runtime:**
  - tools: `anchor_territory` (alignment), `validate_territory_representation` (required judgment), new `reframe_research`;
  - prompts: v1 agent and synthesis prompts, v1 interpreter prompt;
  - synthesis schema: v1 adds `insights`;
  - claim validator: `validateInsights`, `validateConceptFraming`;
  - finalizer, hypothesis assessment, frontier (runtime alignment), skills, context.
- **Frontend:** `DecisionCard.tsx` interpretation block.

## 17. Release status

- **Commits:** `89f06a4` (pre-registration), `0275ec2` (implementation), then evaluation harness and docs.
- **GitHub:** the branch is pushed with Vercel deployments disabled for it (`frontend/vercel.json`, as in 10D), so CI can run without an unprotected preview. A draft PR is opened. **Not merged, not deployed.** Production stays `c8f3633`.
- **Before release:** a merge needs owner review. A production deploy needs a separate release decision and live T2 evidence. Under the hard gates, v1 should not go to production as the default before T2 shows no regression. The rollback is `CE_RESEARCH_POLICY=v0`.

## 18. Remaining limitations

1. No live evidence that Haiku uses the new freedom well. Strict concept and exemplar judgments may cost repair turns; this is unmeasured.
2. The Vinted traces were not inspected, so whether v1 fixes those exact runs is unknown.
3. Compound questions are disclosed as PARTIAL_COVERAGE. The agent cannot yet add a second user target to investigate the uncovered part in the same run.
4. Brand-core detection depends on Qloo returning classification tags for the brand. Without them, "established versus new" stays unknown, and the brief says so.
5. External brand retrieval is not built; facts must be supplied.
6. The concept-framing rule is lexical: it checks that the investigated concept is named, not that the sentence is well framed.
7. The owner's rating is not independent review.
8. The stronger-model experiment (§11 of the sprint brief) was not designed in detail. Remaining failures are not yet attributable to model capability without T2.

## 19. Recommendations

1. Approve T1 first (≈ $0.02 expected, $0.67 ceiling). It tests whether Haiku writes faithful briefs, the foundation of everything else.
2. Then approve the full T2 (18 holdouts). Run it from a frozen worktree after the public evaluation closes, or under a separate private ledger, and rate the sheet blind before opening the key.
3. Ship v1 only if the hard gates hold and intent fidelity is not worse. Keep `CE_RESEARCH_POLICY=v0` as the switch.
4. Add `brandContext` fields to the UI only after T2 shows that brand facts change decisions.
5. Re-run the Vinted questions live under v1 as development diagnostics (not holdouts) once traces can be stored.

## Example research outputs

The deliverable asks for three examples from actually evaluated evidence. **No v1 run exists, so no improved example can be shown, and none is fabricated.** These are the real baseline (v0) outputs that v1 is designed to change, from the Sprint 10D live session (artifacts gitignored):

- **Inconclusive investigation, baseline:** Bodum × specialty coffee culture, PARTIAL. The summary only restates that there is no comparison set and that the list is truncated.
- **Comparison, baseline:** Diptyque × boutique hotels / ceramics / jazz, FULL relative analysis. Ceramics was represented by Richard Mille, Rolex and Tissot (a material tag), so it is not a well-supported comparison. 10D's incidental-anchor rule now blocks this.
- **Cultural opportunity, baseline:** none. Dyson × wellness retreats was PARTIAL and rested on athleisure brands.

T2 will produce the paired v1 outputs for this section.
