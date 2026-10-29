# Sprint 10A: opportunity discovery intelligence

**Status: `SPRINT_10A_COMPLETE_WITH_LIMITATIONS`.**

The capability is implemented and safe. Every provider-free check passes, and the pre-registered suites R (real recorded evidence) and S (synthetic safety) pass. A discovery-quality improvement is **not established**: suite H (blinded human rating) and the 12 frozen holdouts are `NOT_RUN`, and they need owner rating and an approved live budget.

Validation status, kept separate:

| What | Status |
| --- | --- |
| Offline implementation | Complete. All provider-free checks pass (§15). |
| Discovery quality | Not established. The mechanism works on 2 real brands' pools and on 1 real scan's seeds. |
| Live Qloo validation | `LIVE_QLOO_VALIDATION_NOT_RUN` |
| Live agent-model validation | `LIVE_AGENT_MODEL_VALIDATION_NOT_RUN` |
| Agent readiness | Unchanged: `AGENT_MODEL_NOT_READY`. Sprint 9O's competence run never produced a valid result. |

Pre-registration: [PREREGISTRATION.md](PREREGISTRATION.md), committed in `e460a11` before any code change. Case manifest: [evals/discovery/manifest.json](../../evals/discovery/manifest.json).

## 1. Starting state

| Item | Value |
| --- | --- |
| Baseline SHA | `origin/main` `abd11ca`, the merge of PR #49 (Sprint 9O) |
| Branch | `sprint/10a-opportunity-discovery-intelligence`, from `abd11ca` |
| Production (read-only verifier, 2026-10-29) | Vercel, Railway and the running revision are all `abd11ca`; admissions are `accepting`. The result was `RELEASE_DEGRADED`, caused only by the known Preview-only `VERCEL_PREVIEW_ENV_MISSING:CE_INTERNAL_API_SECRET`. |
| Public evaluation | `qloo-hackathon-2026` is open until 2026-11-06T05:00Z. Baseline account: 35 of 408 calls. |
| Open PRs | None |
| Sprint 9O competence | **Not established.** The only competence artifact is an invalid launch (`live-0-harness-error`, 0 Qloo dispatches). Run R1 (the Carhartt rerun) timed out at brand resolution, and R2–R4 never ran. |
| Devpost submission | **UNVERIFIED.** Nothing in the repository or the tools here confirms it was submitted. The deadline is 2026-10-30 23:45 EDT. **This is the immediate release priority.** |
| Local unpushed work | `sprint/9o-production-live` holds one commit (`a8d73cb`, pre-registration amendment 2). It was left untouched. |

Nothing was deployed. No public-evaluation setting, secret, database or deployment control was changed.

## 2. Existing discovery journey (before this sprint)

```
brand ── free deterministic baseline scan (≤ 7 Qloo calls, model-free)
          ├─ brand tag profile (20 tags) ──► directions = first 5 AUDIENCE_TASTE tags, in Qloo order
          └─ related artists / places / films / books ──► shown as observations only
                                                           ("what links them is unknown")
   ├─ "Measure" a direction ──► handoff (analyze_move, grounding tag) ──► agent
   └─ composer question ("what could X stretch into?") ──► explore_frontier ──► agent
         explore_candidate_territories v5:
           related BRANDS (take 8) ──► first 6 profiled ──► frontierConcepts
           ──► pool = support count desc, cut at 12 ──► the model chooses or adds agent_hypothesis
           ──► resolution, Qloo support, semantic, dedup and diversity gates ──► representation ──► analysis
```

Ranking mechanisms that existed:

- **Baseline directions:** Qloo order of the brand's own taste tags (`observed-cultural-tag/v2`).
- **Frontier pool:** the number of the 6 related brands carrying a tag, ties by canonical key.
- **Pruning:** exemplar-profile Jaccard, at 0.5 or above, drops later candidates (`pruneForDiversity`).
- **Model:** free choice from the pool, plus lateral hypotheses that Qloo must validate.

## 3. Root-cause analysis

Carhartt (Sprint 9O live run 1) is a diagnostic only. Its run stored names, not Qloo ids, so it cannot be replayed, and nothing was invented to replay it.

1. **The baseline's directions can only restate the brand.** They are the brand's *own* profile tags in Qloo's order. For Carhartt: Blue Collar, country, Outdoor Adventure Enthusiasts, American Brand, American Craftsmanship. For Loewe (real recorded scan): Model, Fashion. This is correct for a model-free scan, which must not invent territories, but by construction it never surfaces anything lateral.
2. **The cross-domain evidence was a dead end.** The scan's related artists, places, films and books (Carhartt: Refused, Turnstile, Converge; Loewe: Red Velvet, BLACKPINK, SUNMI) were shown, with the note that what links them is unknown. No path took them into the agent. The explore run looked only at related *brands*.
3. **The frontier pool ranked by support count alone and ignored tag facets.** In the real recorded pools, free media keywords filled the top of the bounded pool:
   - Oatly: friendship, england, london england, teenage girl;
   - Allbirds: female protagonist, friendship, new york city, 21st century.

   Taxonomy concepts sat below them: folk, Cooking, Feminism, Self Help. The baseline already classified such keywords as noisy (`tagRole`), but the agent did not use that classification. Haiku compensated in the recorded runs, choosing Folk, Feminism, Cooking and Self help. The deterministic baseline policy did not.
4. **No record of why a candidate surfaced.** An agent hypothesis carried free-text rationale only. The result had no structured link from an observed signal to a proposed territory to an evidence status.

## 4. Architecture decision

**Kept:** a hybrid workflow agent, a single agent, deterministic evidence boundaries and Haiku 5.5 only. No new agent, framework, store, memory, router, provider or scoring method was added.

**Smallest change that addresses each cause:**

| Cause | Change | Where |
| --- | --- | --- |
| 1, 2 | The free scan stays model-free and unchanged. A **user-initiated** explore handoff passes the scan's own cross-domain observations to the agent as server-held *seeds*. | `api/baseline-handoff.ts`, `api/agent.ts` |
| 2 | The agent may profile up to 3 seeds. Their tags join the frontier evidence base. | `frontier.ts`, `tool-registry.ts` |
| 3 | `frontier-pool/v2`: taxonomy concepts are interleaved across facets ahead of free keywords. Each entry carries its facet, role, domain relation and supporters, and deferrals are recorded. | `frontier.ts` |
| 4 | `motivatedBy` on proposals, validated as observed. `opportunity-status/v1` gives every candidate a status, with blockers. | `tool-registry.ts`, `frontier.ts`, `opportunity.ts` |

## 5. Signal and opportunity contracts (`packages/shared/src/opportunity.ts`)

- **`SignalRelation`.** The values are `BRAND_PROFILE_TAG`, `RELATED_ENTITY_TAG`, `BRAND_CONDITIONED_ENTITY` and `SEED_ENTITY_TAG`. Only the first is a direct observation about the brand.
- **`DiscoverySeed`.**
  - Fields: an entity id from the scan, its label, the query domain, the scan id, the scan's correlation id, its rank, the verbatim type evidence and a `partial` flag.
  - Rules: provenance-checked against `fingerprint.provenance`; type-conflicting and set-aside results excluded; at most 3 per domain and 12 in all.
- **`DomainRelation`.** One of `WITHIN_BRAND_PROFILE_FACETS`, `OUTSIDE_BRAND_PROFILE_FACETS` or `BRAND_PROFILE_UNKNOWN`. It is a structural fact about tag URNs. It is **not** a novelty score, and **not** a core-versus-adjacent position: `research-position/v1` forbids inferring that from Qloo alone.
- **`OpportunityStatus`** (`opportunity-status/v1`), with exact definitions:

| Status | Definition |
| --- | --- |
| `OBSERVED_ASSOCIATION` | Qloo returned it for the brand. Not proposed or tested. |
| `UNVALIDATED_HYPOTHESIS` | Proposed in this run. Support was not yet decided, and there are no brand-independent members. |
| `QLOO_SUPPORTED` | The concept is anchored, with at least one brand-independent **recommend member** in this run, and has no numeric relative position. |
| `RELATIVELY_MEASURED` | `FULL_RELATIVE_ANALYSIS` with a numeric position, **and** members. |
| `NOT_ESTABLISHED` | The `blocker` says which: `UNSUPPORTED`, `DUPLICATE`, `UNMEASURABLE`, or `INCONCLUSIVE` (the run ended before testing). |

`QLOO_SUPPORTED` is deliberately **stricter than the candidate gate.** `qlooSupport` also accepts a non-brand profile that carries the tag, but a profile is not a member. The stricter rule only removes support.

- **`OpportunityView`.** Per frontier candidate:
  - direction, source and status;
  - `surfacedBy` signals with correlation ids;
  - facet and domain relation;
  - `interpretation` (the model's rationale, labelled as interpretation everywhere);
  - unknowns and a templated next investigation.
- **`ComparisonSetConstruction`** gains these optional fields (schema `ce-agent-result/0.3`, additive):
  - `candidatePoolRule`;
  - the pool annotations;
  - `deferredConcepts`;
  - `seeds`;
  - `opportunities`.

## 6. Discovery flow (after)

```
scan (unchanged, free) ──► user clicks "Explore these signals with the agent" (paid, admission-gated)
   ──► POST handoff {scanId, explore: true, idempotencyKey}
   ──► server rereads scan by token ──► discoverySeeds() ──► explore_frontier job (query text names the brand only)
   ──► agent: brand profile, related brands, first 6 related profiles      (Channel A, unchanged)
              seeds listed in context; profile ≤ 3 seeds                   (new)
              pool = related-base ∪ profiled-seed tags, frontier-pool/v2    (new)
              propose qloo_evidence (pool tag) or agent_hypothesis + motivatedBy (validated)
              probe brand-independent members ──► anchor ──► represent ──► analyze (all unchanged)
   ──► result: candidatePool (annotated), deferredConcepts, seeds, opportunities[status, surfacedBy, unknowns, next]
   ──► UI: "Why this direction surfaced" in the reading; the same lines in the exported report
```

## 7. Modified modules

| Area | Files |
| --- | --- |
| Shared contracts | `packages/shared/src/opportunity.ts` (new), `agent.ts`, `brand-baseline.ts` (BaselineTagRole is now an alias of FacetRole), `index.ts` |
| Facet semantics | `backend/src/methodology/tag-facets.ts` (moved unchanged from `brand-baseline/research.ts`, which re-exports it) |
| Frontier | `backend/src/agent/frontier.ts`: pool v2, `orderFrontierPool`, seeds, `opportunityStatus`, `frontierOpportunities`, `surfacedBy` |
| Tools, context, skill | `tool-registry.ts` (`motivatedBy`, seed profiles), `context.ts`, `model/provider.ts`, `skills/definitions.ts` (v6) |
| Plumbing | `state.ts`, `runtime.ts`, `query/service.ts`, `query/jobs.ts` |
| API | `api/baseline-handoff.ts` (`discoverySeeds`, `buildExploreInvestigationRequest`), `api/agent.ts` (exactly one of `territoryId`, `proposedDirection` or `explore`) |
| Frontend | `lib/territory-reading.ts`, `lib/network-report.ts`, `lib/research-network.ts` (`explore` origin), `components/research/TerritoryReading.tsx`, `ResearchNetwork.tsx`, `use-research-network.ts` |
| Evaluation | `backend/scripts/eval-discovery.ts` (`pnpm eval:discovery`); `run-evaluators.ts` (v2.2); the `agent-eval-harness.ts` seeds and opportunity expectations; `evals/discovery/` (manifest and real recorded pools); the agent scenario `s10a-discovery-mechanics` with its synthetic world entries |

## 8. Model versus deterministic responsibilities

| The model decides | Code enforces |
| --- | --- |
| Which pool concepts to propose. Whether seed clusters suggest a scene worth testing. Which ≤ 3 seeds to profile. The wording of a hypothesis and its rationale. Advisory semantic judgments, which can only remove. | Seed construction and provenance. The pool contents, order, cut and deferrals. The facet, role and domain relation. That `motivatedBy` ids were observed. The seed-profile bound. Every existing gate: resolution, brand-independent members, semantic validity, dedup, diversity, probe policy, completion reserve, budgets. The opportunity status and blocker. Every number and class. |

No second planning model was added. Model text (`interpretation`) is shown only as "the agent's interpretation, not Qloo evidence".

## 9. Tools, skills and budgets

- **`explore_candidate_territories` v5 → v6.** The procedure and output semantics changed (pool v2, seeds, `motivatedBy`, discovery mix). The tool allowlist is unchanged (s33), and so are the skill budget (6 turns, 20 Qloo calls) and the `explore_frontier` run budget (32 Qloo calls).
- **`propose_territory`** takes an optional `motivatedBy` (at most 6 ids). An unobserved id is refused.
- **`qloo_get_entity_tags`** also accepts a server-held seed id. The 4th seed profile in a run is refused, so at most 3 Qloo calls go to seeds, and only when the model chooses to make them.
- **The free baseline** makes no extra call and starts nothing (s32).
- **Context cost**, measured on the synthetic frontier scenarios: Sprint 10A adds at most 244 estimated tokens per turn (means of 46–123) to contexts of 5.2–6.1k tokens.

## 10. Evidence provenance rules (added)

1. A seed is an observation from an authorized scan, carried with the scan's correlation id and re-read on the server. It never comes from client text, never enters the query text, and is **never support**.
2. A profiled seed's tags are new in-run Qloo evidence, with their own correlation id. A seed-derived concept still needs brand-independent members before it becomes `QLOO_SUPPORTED`.
3. A `motivatedBy` id must be a tag or entity observed in the run, or a seed. Motivation explains; it never supports.
4. Every `surfacedBy` signal keeps the correlation ids of the calls that observed it.
5. Opportunity status comes from code. An agent hypothesis never inherits the status of the signals that motivated it.

## 11. Evaluation methodology

The pre-registered evaluation ([PREREGISTRATION.md](PREREGISTRATION.md)) has four parts:

- **Suite R:** real recorded evidence, offline.
- **Suite S:** 34 synthetic mechanics and safety cases (s01–s34), plus the agent scenario `s10a-discovery-mechanics` and 3 API tests.
- **Suite H:** a blinded human rating sheet (`evaluation/rating-sheet.md`; the key is in `rating-key.json`).
- **Holdouts:** 12 unseen brands, frozen before implementation, which need live capture.

Two amendments were recorded before any result. One renamed state 5 to `NOT_ESTABLISHED`. The other made s29 stricter: the supported status needs members.

## 12. Baseline versus new results (offline, real evidence)

`pnpm eval:discovery`: **R1–R4 PASS (4/4, 4/4, 4/4, 1/1).** This is mechanism evidence, not quality evidence.

| Pool (real, recorded) | Recorded by | Top 6, v1 (support order) | Top 6, v2 | Namespaces | Keyword share |
| --- | --- | --- | --- | --- | --- |
| Oatly `ebc85f4b` | 10 Haiku runs | friendship, england, folk, london england, teenage girl, british | folk, Cooking, british, Feminism, friendship, england | 2 → 3 | 0.67 → 0.33 |
| Allbirds `c53d12ae` | 9 Haiku runs | female protagonist, folk, friendship, new york city, 21st century, Self Help | folk, Self Help, Social Responsibility, socially conscious consumers, Soft Textures, female protagonist | 3 → 6 | 0.67 → 0.17 |
| Oatly `bc43a31d` | baseline policy | british, england, friendship, london england, Chance Encounter, Cooking | unchanged | 4 → 4 | 0.5 → 0.5 |
| Allbirds `d7254362` | baseline policy | Soft Textures, Athletic Influencers, … | unchanged | 4 → 4 | 0 → 0 |

Two pools did not change: almost every concept in them has support 1, which v2 deliberately does not promote. In the 19 Haiku runs, the model had already chosen the taxonomy concepts that v2 moves up (Folk, Feminism, Cooking, Self help, Social responsibility). **For a capable model, v2 mostly brings forward what it would choose anyway.** The expected gain is in robustness (the deterministic policy, weaker turns, and the 10-entry context cut), not in a large shift of choices.

**Seeds on the real Loewe scan (R4).** The scan's directions were Model and Fashion. Its seeds were:

- artists: Red Velvet, BLACKPINK, SUNMI;
- places: Les Ombres, Café de la Paix, Hermès;
- films: Call Me by Your Name, Phantom Thread, Roma;
- books: three memoirs and essays.

All 12 trace to the scan's provenance. Whether, say, K-pop artists lead to a Qloo-supported territory for Loewe is **untested**; that is the live question.

**Before and after for Carhartt (illustrative, not replayable).** Before, the five familiar directions were the only thing offered, and the punk artists were a dead end. After, the scan offers "Explore these signals with the agent". The agent can profile up to 3 of those artists. If they share a genre tag, it enters the pool as a concept outside the brand's profile facets, with the artists named as supporters. Qloo must then return brand-independent members before the direction can be called supported. Whether that happens for Carhartt is unknown until a live run.

**Tool-call efficiency and cost.** Sprint 10A made **0 Qloo calls and spent $0** on models. Live, an explore run stays within its existing 32-call budget, and seeds take at most 3 of those calls. The marginal gain per seed call is **unmeasured**, and it is a holdout metric. Model cost per turn rises by at most about 244 input tokens.

## 13. Holdout results

`NOT_RUN`. The 12 holdouts (Dr. Martens, Fenty Beauty, Duolingo, Red Bull, Rimowa, Moleskine, Hoka, Telfar, Sonos, Jägermeister, Polaroid, Tony's Chocolonely) need live capture. The budget request (about 500–852 Qloo calls and about $1.50 of Haiku, as a local process with its own caps) is in the pre-registration §4. It is **not approved**. Suite H also awaits the owner's ratings.

## 14. Failure and regression analysis

- **The evaluator flagged v2 pools.** `FRONTIER_RESULT_CONSISTENCY` assumed support order. It is now rule-aware: v1 pools are checked exactly as before, and v2 pools against an independent re-derivation. `RUN_EVALUATORS_VERSION` went from v2.1 to v2.2, and the pin tests were updated. **Replay check:** 63 stored live runs (5a final, 5a1 final, 5a2 final and focused1, 8b-c9) score identically under v2.1 and v2.2.
- **A defect found while testing:** a candidate the run ended before analysing was labelled `UNMEASURABLE`. Fixed: `NOT_INVESTIGATED` and `BUDGET_EXHAUSTED` become `INCONCLUSIVE` (s21).
- **A design gap found while testing:** the candidate gate counts a profile carrying a tag as support, so a profiled seed would have passed it. Fixed by requiring members for `QLOO_SUPPORTED` and `RELATIVELY_MEASURED` (s29, amendment 2).
- **Unchanged:** the agent eval (21 runs), d2d, query and methodology evals; the e2e suite (58 tests plus 1 new); and the existing frontier stability tests.

## 15. Tests and CI (all provider-free, run 2026-10-29 on Node 22)

| Command | Result |
| --- | --- |
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | backend 85 files and 982 tests, frontend 114 tests: all pass |
| `pnpm build` | pass |
| `pnpm check:secrets` | pass |
| `pnpm eval:methodology` | 19/19 |
| `pnpm eval:live` | 3/3 (recorded captures, no credentialed call) |
| `pnpm eval:elasticity` | 27/27 |
| `pnpm eval:agent` | PASS (including `s10a-discovery-mechanics`) |
| `pnpm eval:d2d` | PASS |
| `pnpm eval:query` | PASS |
| `pnpm eval:discovery` (new) | PASS (suite R) |
| `pnpm eval:agent:replay` | 63 stored live runs identical under v2.1 and v2.2 |
| `pnpm smoke:offline` | `OFFLINE_SMOKE_PASS` |
| `E2E_MODE=production pnpm test:e2e` | 58/58, plus the new explore test (research-network 18/18) |
| `pnpm eval:competence` | Not applicable. The only cassette has 0 dispatches; the cassette unit tests run in `pnpm test`. |
| `pnpm smoke:docker` | Not run |

`pnpm eval:discovery` was added to CI next to `eval:d2d`. CI stays provider-free.

## 16. Security and deployment status

There were no deployment, Railway, Vercel, secret, database, quota or public-evaluation changes. The new paid action is user-initiated, goes through the existing handoff route and admission gate, sends identifiers only (an e2e test asserts the body keys), and never starts from a free scan. The existing protections are unchanged:

- tool allowlists, budgets and idempotency (the same key across kinds returns 409);
- cancellation, timeouts, cost accounting and the claim validator;
- comparability, with no cross-call numbers.

## 17. Known limitations

- Discovery quality is unproven: 2 brands' pools, 1 scan's seeds, no human ratings and no live runs.
- The recorded pools were cut to 12 by the v1 order, so v2's effect on concepts beyond those 12 is unobservable offline.
- `domainRelation` could not be computed in the replay, because brand profiles were not stored with the pools.
- Seeds are the baseline's first 3 per domain in Qloo order, not a judged selection.
- The explore handoff is only as durable as the other in-process jobs.
- The explore action shows only when the scan has related entities and investigations are admitted.

## 18. Rollback plan

- **Behaviour:** revert the PR. No data migration exists, and stored results stay readable (all new fields are optional).
- **Narrower rollbacks:**
  - Hide the UI action: remove the `onExplore` prop in `ResearchNetwork.tsx`. The route then has no caller.
  - Restore the v1 pool order: replace `orderFrontierPool` with the support sort and drop `candidatePoolRule`. Evaluator v2.2 then falls back to the v1 check.

## 19. Remaining agent-competence questions

1. Does Haiku use seeds well? Does it profile coherent clusters, or random ones?
2. How often do seed-derived concepts return brand-independent members for the shared entity type? Sprint 9O found that media and music tags rarely return places or brands. Artists may work.
3. Does the explore mix increase distinct supported directions without lowering grounding precision?
4. Is 3 the right number of seed profiles, given the marginal yield per call?

## 20. Sprint 10B recommendations

1. **Before anything else:** confirm the Devpost submission. Keep production frozen until judging ends on 2026-11-05.
2. Run the owner's blinded rating of `evaluation/rating-sheet.md`.
3. After judging, and with approval, capture the 12 holdouts with the competence cassette, both arms on identical Qloo answers. Report the pre-registered holdout metrics with denominators.
4. If the holdouts show yield, consider a model-free "signals worth exploring" summary in the free scan (a grouping by seed domain only, no extra call). Otherwise keep seeds agent-only.
5. Store the brand profile with each frontier result, so future replays can compute `domainRelation`.
