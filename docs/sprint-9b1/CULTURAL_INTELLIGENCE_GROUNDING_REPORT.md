# Sprint 9B.1: Cultural intelligence and evidence grounding

Branch `sprint/9b1-cultural-intelligence-grounding`, based on `origin/main` at `97e5951` (PR #24, which contains Sprint 9B head `752c8bf`). No Qloo, Anthropic, database-migration or deployment action was taken against production. Every result below is offline: it uses stored live evidence, recorded live profiles, or SYNTHETIC fixtures, and says which.

## 1. Outcome

Loewe's zero-territory result had four causes. Two are confirmed bugs, and two are methodology limits. The baseline now projects a versioned `ce-brand-baseline/0.2` result. It has three levels that are kept apart:

1. an **observed cultural profile**, which never depends on finding a territory;
2. **themes**, which are versioned facet groupings;
3. **territory hypotheses**, each with an explanation, its evidence, its limits and a next step.

Generic `urn:entity` results are now **qualified, not discarded and not retyped**. The tag template reads 20 tags instead of 10, at the same call count.

Replaying the stored Loewe canary offline gives 4 cultural tags, 6 operational tags set aside, 40 query-scoped associations, 1 theme and 2 hypotheses (Model, Fashion). The evidence integrity is sound. The research value for Loewe is still **insufficient**: the hypotheses are weak, and the most specific signals (named artists, hotels, films) cannot yet be grouped from Qloo evidence. One bounded live canary is needed to close the main open question (§15).

## 2. Root-cause matrix

Every row was traced through stored canary artifacts (`ce9b_canary2`, scan `b3a92759…`), harness 0.1.26 source, and repository code.

| # | Finding | Class | Evidence |
| - | --- | --- | --- |
| R1 | Territory rule required tag source `:qloo`. Loewe's only cultural tags were `genre:media`, `genre:person` and `keyword:media`, which the existing operational-tag policy explicitly **keeps** as cultural. | **Confirmed bug** (contradictory rules) | `research.ts` v1 `tagNamespace(...).source === "qloo"` vs `operational-tags.ts` header |
| R2 | `normalize.ts` accepted the harness `subtype` and then dropped it, so domain information was lost at normalization. | **Confirmed bug** | harness `compactEntity` returns `{type, subtype}`; `toEntitySignals` omitted `subtype` |
| R3 | Observation artifacts kept neither `subtype` nor the recorded request (`provenance.requests[].query["filter.type"]`), so stored scans cannot verify query scope from the response. | **Confirmed capture gap** | stored `ce-brand-baseline-observation/0.2` payloads |
| R4 | Any entity whose `type` was not literally the requested domain was excluded, so all 40 Loewe recommendations were dropped instead of being qualified. | Methodological restriction | v1 type check; as-run limitations |
| R5 | Qloo `recommend` members carry `type: "urn:entity"`. Whether `subtype` holds the specific type is **not verified**, because no stored artifact kept it. | **Contract limitation** (open live question) | 40/40 stored types `urn:entity`; Sprint 3 doc notes the same for pool members |
| R6 | Brand tag profiles inherit venue-listing attributes. In **all 7** recorded live profiles, 5–6 of the first 10 tags are operational. Curated `:qloo` concepts sit mostly at ranks 11–20 (Jacquemus 0 in the top 10, 8 in ranks 11–20; Lululemon 2→11; Patagonia 1→10). | **Data coverage limitation** | six Sprint 0B take-20 profiles plus Loewe |
| R7 | The baseline read only 10 tags, so R6 left 4 usable tags for Loewe. | Methodological restriction | `BASELINE_MAX_ENTITIES = 10` |
| R8 | Recommended entities carry no tags in this template, so no Qloo-grounded rule can group them into a theme. | Data coverage limitation | harness `recommend` output |
| R9 | The as-run status was `COMPLETE` with zero territories. | Bug, already fixed in `9fc12a6` | as-run artifact |

**Trace answers.**

- **A.** The baseline requests `target_type` ∈ {artist, place, movie, book}. The harness sends `filter.type=urn:entity:<domain>`.
- **B.** Qloo returns `type: "urn:entity"` on every member. `subtype` is unknown (R5).
- **C.** The harness preserves `type`, `subtype`, explainability, `interpretation.target_type` and `provenance.requests`.
- **D.** The normalized adapter preserved `type` only, before R2 was fixed.
- **E.** `urn:entity` appears in the provider response itself.
- **F.** Yes, domain information was lost at normalization (R2).
- **G.** Yes. The response's own `provenance.requests` records `filter.type`, so a new capture can verify query scope.
- **H.** `describe` by ID could confirm a type at 1 call per entity. That was rejected as unbounded (40 calls per scan).
- **I.** Genuine cultural classifications are genre facets (`genre:media`, `genre:music`, `genre:person`) and curated `:qloo` concepts.
- **J.** Operational metadata is the place-sourced attributes in `operational-tags-v1`.
- **K.** Discovery rejected the evidence because of R1 and R7.

## 3. Raw-to-normalized contract map

| Field | Qloo / harness | Before | Now |
| --- | --- | --- | --- |
| `entity_id`, `name` | yes | kept | kept |
| `type` | `urn:entity` (recommend) | kept | kept as `grounding.providerType` |
| `subtype` | passed through by harness | **dropped** | kept as `CulturalSignal.subtype` → observation 0.3 → `grounding.providerSubtype` |
| `provenance.requests[].query["filter.type"]` | recorded by harness | in memory only | stored as `recordedRequestType` (observation 0.3) |
| `affinity`, `popularity` | query-relative | not in result | still not in result (no cross-call values) |
| explainability | single-signal (brand only) | not kept | not kept: with one signal it only restates the brand |

## 4. Type and domain grounding (`entity-type grounding`, in `research.ts`)

| Class | Rule | User wording |
| --- | --- | --- |
| `PROVIDER_CONFIRMED_TYPE` | `type` or `subtype` equals (or narrows) the requested `urn:entity:<domain>` | "Qloo identifies each of these as artists." |
| `QUERY_SCOPED` | generic or missing type, **and** a scope basis | "Returned when Qloo was asked for artists. Qloo did not confirm each result individually." |
| `GENERIC_TYPE_UNRESOLVED` | generic type with no verifiable scope | "Qloo did not confirm what kind of result these are." |
| `CONFLICTING_TYPE` | a specific type differs, or the recorded request differs from the requested domain | set aside, with its source, in `excluded` |

There are two scope bases. `RECORDED_PROVIDER_REQUEST` comes from the response's own request record (new captures). `BASELINE_TEMPLATE_STAGE` covers stored 0.2 artifacts that never captured the request: the scope then rests on the stored stage, and a limitation says so. Query scope is never upgraded into an entity-level type. Each signal keeps its original provider type, subtype, requested type, scope basis, source ID, correlation ID, status and capture time.

## 5. Cultural fingerprint (A) and discovery (B)

**Tag roles** (`tagRole`, from the URN facet only; the URN is authoritative over any returned type label):

- `AUDIENCE_TASTE`: genre facets other than place or brand, and curated `:qloo` concepts.
- `BRAND_CLASSIFICATION`: `genre:brand`, `industry:qloo` and `product_service:qloo`. In every recorded profile these described the brand's own category or products (Games, Athletic Apparel, Yoga Pants, Ready To Wear, Outdoor Clothing).
- `DESCRIPTIVE_KEYWORD`: `keyword:<non-qloo>`, which are free media keywords.

**Duplicates.** Repeated IDs in a call are dropped. Tags whose names are equal after case, accent and punctuation folding (J-pop / JPop, France / france) are flagged `possibleDuplicateOf`. They are never merged and never counted twice. A repeated copy of the same Qloo call (same correlation ID) is processed once.

**Themes** (`tag-facet-group/v1`). A theme is two or more distinct retained tags in one URN facet. Its label comes from the URN (for example "Music genres" or "Media keywords"), never from tag names. Entities are not grouped (R8).

**Hypotheses** (`observed-cultural-tag/v2`). One per canonical `AUDIENCE_TASTE` tag ID that is not a duplicate. They follow Qloo's order and are capped at 5. The cap is a ceiling, not a target. Each hypothesis carries `level: TERRITORY_HYPOTHESIS`, `validation: UNVALIDATED`, a plain explanation (tag, facet, position in Qloo's order), supporting references, limitations and a next investigation. With zero hypotheses, `discovery.reasons` and `discovery.nextSteps` explain why and what to do next.

## 6. Evidence taxonomy (reconciled with existing names)

| Requested concept | Implemented as |
| --- | --- |
| Observed association | hypothesis `evidenceStatus: OBSERVED_ASSOCIATION` (existing) |
| Multi-signal support | `MULTI_SIGNAL_SUPPORT`: the same tag ID from ≥2 **distinct Qloo calls**. The v2 template has one tag call, so it cannot occur in production today. |
| Partial support | `PARTIAL_EVIDENCE` (existing): the source call was partial or degraded |
| Unvalidated hypothesis | every hypothesis: `validation: UNVALIDATED` |
| Insufficient evidence | `scanStatus: INSUFFICIENT_EVIDENCE` (existing) plus `discovery.reasons` |
| Unresolved classification | `GENERIC_TYPE_UNRESOLVED` |
| Unavailable provider data | coverage `UNAVAILABLE` / `EMPTY` (existing) |

There are no scores, percentages, probabilities or averages. The audit counts are computed by the projection itself.

## 7. Template and contract versions

- **`ce-brand-baseline/v2`** (new scans) asks the same five questions as v1, with `entity_tags` limit 20 (the harness maximum) instead of 10. It makes **zero extra calls** (still ≤ 7 including identity) and its latency is unchanged, apart from a larger tag payload.
- **`ce-brand-baseline/0.2`** result schema; **`ce-brand-baseline-observation/0.3`** artifacts with optional `subtype` and `recordedRequestType`.
- `0.1` results and `0.2` observations stay readable: the strict legacy schema is frozen, and `readScan` reads both versions. The 24-hour cache only reuses a `v2`/`0.2` result.
- **No database migration.** `schema_version` is text and artifacts are JSONB. Commit validation now also checks that every exclusion cites a recorded observation and that every theme member is a retained signal.

The rejected alternatives are `describe` by ID for each entity (40 calls) and `entity_tags` over each recommendation list (4 more calls, which breaks the 7-call ceiling). The second is proposed as a separately approved second stage (§15).

## 8. Historical compatibility

The Loewe as-run `0.1` artifact (`COMPLETE`, 10 signals, 0 territories) parses unchanged with the frozen schema. It reads back byte-equal through `readScan` (real PostgreSQL test) and is untouched by replay (test). The new projection is a **separate derived artifact**, [`evidence/loewe-canary-2.derived-0.2.json`](evidence/loewe-canary-2.derived-0.2.json). Its `execution.derivedFrom` names the source scan and schema. Nothing was written to any database.

## 9. Evaluation

`pnpm --filter backend eval:brand-baseline:report` regenerates [`evidence/audit-report.json`](evidence/audit-report.json). It makes 0 provider calls and 0 model calls. Columns: tags returned/operational/cultural; entities; type evidence confirmed/scoped/unresolved/conflicting; themes; hypotheses; integrity; deterministic usefulness.

| Case | Evidence | Status | Tags | Ent. | Types | Th. | Hypotheses | Int. | Use |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Loewe canary 2 | LIVE replay | COMPLETE | 10/6/4 | 40 | 0/40/0/0 | 1 | Model, Fashion | PASS | PASS |
| Loewe canary 1 | LIVE replay | INSUFFICIENT_EVIDENCE | 10/0/0 | 40 | 0/0/0/0 | 0 | — (0.1 artifacts lack per-signal provenance; refused) | PASS | INSUFF. |
| Alienware profile | LIVE replay (tags, take 20) | — | 20/5/15 | — | — | 2 | Youtuber, electronic, Video-Game Music, dubstep, dub | PASS | PASS |
| Jacquemus profile | LIVE replay (tags) | — | 20/6/14 | — | — | 1 | France, electronic, Model, High-Fashion Consumers, French-Inspired | PASS | PASS |
| Lululemon profile | LIVE replay (tags) | — | 20/6/14 | — | — | 2 | country, Self Help, Mindful, Lifestyle Brand, Yoga Instructors | PASS | PASS |
| Muji profile | LIVE replay (tags) | — | 20/5/15 | — | — | 3 | Manga, Animation, J-pop, J-rock | PASS | PASS |
| Nintendo profile | LIVE replay (tags) | — | 20/6/14 | — | — | 3 | Youtuber, Video-Game Music, Graphic Novels, Comics, electronic | PASS | PASS |
| Patagonia profile | LIVE replay (tags) | — | 20/6/14 | — | — | 3 | Ethical Consumption, folk, Environmental Activism, Natural Fibers, Environmentally Conscious | PASS | PASS |
| 17 SYNTHETIC cases | synthetic | — | — | — | — | — | see report | 17/17 PASS | 12 PASS / 5 INSUFF. |

The SYNTHETIC cases cover: luxury-shaped, unrelated category, many cultural tags, mainly operational, only operational, generic types (scoped), mixed types, no associations, rich fingerprint, conflicting types, recorded-scope mismatch, incomplete responses, degraded provenance, duplicated references, multi-signal versus a repeated call, zero territories (keywords only), and unclassifiable entities. Benchmark profiles are read only by evaluation code. They were captured on 2026-10-16 by a different workflow and are tag-only, not baseline scans.

The integrity evaluators check schema, brand identity, provenance, fabricated claims, type grounding, query scope, cultural versus operational tags, duplicates, grouping validity, hypothesis sufficiency and cross-call values. A test proves they fail on renamed, unrecorded, retyped and scored results.

**Bugs found by the evaluators during this sprint and fixed:**

- the tag type label was able to override the URN;
- a repeated call was processed twice;
- a theme could count one concept from two calls twice;
- canary 1 was explained as "all operational" when its tags were actually untraceable.

## 10. Usefulness gate (separate from integrity)

The deterministic half (`usefulnessChecks`) asks seven questions: observed, meaningful, why, evidence, limitations, next step, plain language. It is **necessary, not sufficient**: any grounded hypothesis passes "meaningful".

The judgement half below is the **implementing agent's** structured review. It is not the owner's human review, which is still pending.

| Output | Specificity | Grounding | Interpretability | Research relevance | Uncertainty | Actionability | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Loewe (stored, take 10) | Low for hypotheses (Fashion is likely the brand's own category; Model is generic). High for associations (named K-pop groups, Paris palace hotels and maisons, auteur films, celebrity memoirs), which are ungrouped | High | Good | Associations: moderate. Hypotheses: low | Good | Good (three concrete next steps) | **INSUFFICIENT** |
| Patagonia profile (take 20) | High (Ethical Consumption, Environmental Activism, Natural Fibers) | High | Good | High, but these restate known positioning more than adjacent territories | Good | Good | Adequate for a baseline |
| Muji / Nintendo profiles | Medium–high (Manga, J-pop; Graphic Novels, Comics) | High | Good | Medium | Good | Good | Adequate |
| Lululemon profile | Mixed ("country" music, Self Help next to Mindful, Yoga Instructors) | High | Good | Medium | Good | Good | Borderline |

On the recorded profiles, take 20 lifts curated concepts into the hypotheses. This supports v2. It does not prove Loewe has such concepts.

## 11. Presentation

The brand panel now answers four questions: **What we found**, **Territories worth investigating** (why it appeared / how certain / next), **What remains uncertain**, and **What to explore next**. Correlation IDs, operation names, rule versions, audit counts and excluded tags appear only inside the collapsed **Methodology details**. Stage codes are mapped to plain labels. Legacy `0.1` results render in a compact view marked "Recorded with an earlier method". Screenshots are in [`screenshots/`](screenshots/), including `loewe-replay-derived.png` (recorded live evidence, offline).

## 12. Regression (Node 22.23.2)

| Check | Result |
| --- | --- |
| `pnpm lint`, `typecheck`, `build`, `check:secrets` | pass (466 repo and 19 bundle files, no leakage) |
| `pnpm test` | backend 797/797 (62 files), frontend 29/29 |
| `pnpm test:db` / `smoke:baseline` (isolated local PostgreSQL 16, `ce9b1_test`) | 15/15, including 3 new: legacy artifact readable byte-equal, end-to-end v2 capture of subtype and recorded request, unrecorded exclusion rejected |
| `pnpm test:e2e` (SYNTHETIC API) | 31/31, including the existing Jacquemus Atlas suite and 7 brand-baseline tests: legacy, hypotheses with keyboard, zero-territory, insufficient, partial, mobile 390px with no horizontal overflow, paused admission |
| `eval:brand-baseline`, `eval:methodology`, `eval:agent`, `eval:query`, `smoke:offline` | pass. Each still reports its existing `*_NOT_RUN` live markers |
| Offline performance | 0.24 ms mean per Loewe replay (500 runs, including fixture parse); derived artifact 39 KB vs 7 KB as-run (bounded: ≤20 tags, ≤40 entities); deterministic. Heap delta is not meaningful at this size because GC dominates |

Playwright ran through the repository's Playwright runner, not the Playwright MCP, which is not attached to this session. Cloud CI was not triggered.

## 13. Security and governance

There were no provider or model calls. Production baseline code imports no model client, agent runtime, benchmark or eval code (test). Admission flags, the Railway configuration, the production commit pin and the call budgets are unchanged. No public route was added, and the operator diagnostics are unchanged. The secret scanner rules are unchanged.

**Git and deployment.** Implementation commit `573c62a` was pushed to `sprint/9b1-cultural-intelligence-grounding`. It is not merged to `main`. The push created Vercel preview `cultural-elasticity-enx8slmt6-raulmermans-projects.vercel.app` (Ready). The anonymous probe returned **HTTP 401** for it and **404 `DEPLOYMENT_NOT_FOUND`** for the production alias (`VERCEL_PROTECTION_PROBE_PASS`). Railway still runs `9fc12a6` and was not touched.

## 14. Provider-call impact

v2 is the same as v1: identity 1, tags 1, related 4, so ≤ 7 including retries, with the same spacing, reservations and unknown-outcome handling. The only request change is `limit: 20` on `entity_tags`.

## 15. Recommended live test (not run; needs separate approval)

**Reason.** Two facts cannot be known offline:

- (a) whether Qloo fills `subtype` on `recommend` members, which would turn `QUERY_SCOPED` into `PROVIDER_CONFIRMED_TYPE`;
- (b) what Loewe's tags at ranks 11–20 are.

**Plan.** One v2 baseline scan of Loewe on an isolated local database: 1 describe, 1 `entity_tags` (limit 20) and 4 `recommend`. The maximum is **7 dispatches including retries**. No Anthropic call.

**Success criteria.** Observation 0.3 artifacts contain `recordedRequestType` for all four lists. The `subtype` result is recorded either way. The integrity evaluators pass. The usefulness review is repeated.

**Stop conditions.** Any `UNKNOWN` dispatch, any contract drift, or 7 reservations.

**Optional second stage, separately approved.** One `entity_tags` call over the 10 returned artists (≤ 2 calls including retry) would test whether a Qloo-grounded genre groups them. This would be the first grounded entity theme.

## 16. Remaining limitations and readiness

- Entity themes are impossible without entity tags (R8). Multi-signal support cannot occur with one tag call.
- The `BRAND_CLASSIFICATION` facet list rests on six recorded profiles.
- A genre such as "Fashion" for a fashion house may still be the brand's own category. That is stated in every hypothesis.
- Owner human review is pending.

**Sprint 9C readiness:** the contract (`0.2`) and the presentation sections are ready to build on. Methodology usefulness should be confirmed by the §15 canary first.

## Final statuses

```
QLOO_CONTRACT:            PARTIAL      (scope verifiable from response; recommend subtype population unverified)
CULTURAL_FINGERPRINT:     VERIFIED     (offline: synthetic + recorded live replays)
TERRITORY_GROUNDING:      PARTIAL      (deterministic and grounded; Loewe hypotheses weak; entity themes unavailable)
EVIDENCE_INTEGRITY:       PASS
METHODOLOGY_USEFULNESS:   INSUFFICIENT (Loewe); adequate on recorded take-20 profiles; owner review pending
HISTORICAL_COMPATIBILITY: PASS
DATABASE_REGRESSION:      PASS         (local isolated PostgreSQL 16)
FULL_REGRESSION:          PASS         (local; cloud CI not run)
LIVE_QLOO_VALIDATION:     NOT_RUN      (LIVE_QLOO_VALIDATION_NOT_RUN)
PUBLIC_RELEASE_READY:     NO
AGENT_MODEL_READY:        UNCHANGED — NOT_READY
```
