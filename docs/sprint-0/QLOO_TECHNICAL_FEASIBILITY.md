# Qloo Technical Feasibility

Sprint 0 · Cultural Elasticity · Test case: **Jacquemus → Boutique Hospitality**

> ## Status: **CONDITIONAL GO**, on live hackathon-API evidence (Sprint 0B, 2026-10-16)
>
> - **Sprint 0A** (earlier the same day) ran with no credential and reached a CONDITIONAL GO **at contract level only** (`LIVE_QLOO_VALIDATION_NOT_RUN`). That assessment is preserved unchanged below as **Part B (historical)**.
> - **Sprint 0B** ran the pinned investigation live against `https://hackathon.api.qloo.com` through the official harness `@qloo/qloo-harness` 0.1.26: two full runs of 35 calls each, every call `ok`, plus about 60 exploratory calls. All numbers in Part A are live Qloo output or deterministic descriptive measures over it.
> - Evidence labels: **[live]** observed in a pinned run (persisted in `evals/fixtures/live/jacquemus-boutique-hospitality.live.json`), **[live-exploratory]** observed in the same day's exploratory probes (summarized here, raw responses not persisted), **[docs]** Qloo documentation, **[harness]** harness 0.1.26 source, **[contract]** harness workflow contract.
> - Synthetic results (`pnpm eval:methodology`) are reported separately and are never Qloo evidence.

# Part A — Sprint 0B live validation

## Hackathon API Environment

**[docs]** The Qloo LLM Hackathon developer guide (`https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide`) says the key "is valid only against the hackathon base URL" `https://hackathon.api.qloo.com`. Hackathon keys "do not work" against `https://api.qloo.com` or `https://staging.api.qloo.com`. Authentication uses the `X-Api-Key` header. Legacy `/recommendations` and `/recs` are unsupported.

**How the official harness picks its upstream [harness 0.1.26, read from source, before any credentialed request]:**

| Question | Answer |
| --- | --- |
| Does 0.1.26 support the hackathon environment? | **Yes**, as a *custom, explicitly trusted* base URL. It has no built-in knowledge of the hackathon host. |
| Does it use the hackathon endpoint automatically for event credentials? | **No.** With nothing configured it uses `https://api.qloo.com` (`QLOO_PRODUCTION_BASE_URL` in `packages/qloo-client-ts/dist/config.js`). A hackathon key would silently go to production. |
| Documented CLI/config setting? | `qloo config set base-url <url>` writes `base_url` (and `trusted_base_url`) to `$QLOO_HOME/config`. |
| Environment variable? | `QLOO_BASE_URL` (takes precedence over config) plus `QLOO_TRUSTED_BASE_URL`, which must name the *exact* same endpoint. With only `QLOO_BASE_URL` set, the client refuses: "Custom Qloo base URL is not trusted." |
| Does a command expose the effective upstream? | `qloo doctor` **without** `--network` is fully offline and prints `qloo-endpoint-trust — … explicitly trusted via QLOO_TRUSTED_BASE_URL: https://hackathon.api.qloo.com/`. `qloo exec` builds its client with the same resolver (`createDirectQlooWorkflowExecutorFromEnvironment` → `resolveQlooClientConfiguration`). |
| Was the recorded `production_server=https://api.qloo.com` a real call? | **No.** It is descriptive contract metadata from the offline Sprint 0A `qloo_capabilities` capture, which made no request. It is now labelled historical in the fixture. |

Two more harness facts. The `qloo api … --dry-run` printers ignore `QLOO_BASE_URL` and would *display* `api.qloo.com`, but they send nothing. The main request path does not set `redirect`, so fetch's default (follow) applies. The credential-less probe below showed that the hackathon host answers directly, with no redirect.

**Host safety gate (implemented, `backend/src/qloo/environment.ts`):**

1. `QLOO_API_BASE_URL` (backend config, non-secret, never `NEXT_PUBLIC_*`) must be exactly `https://hackathon.api.qloo.com`. There is no default. Missing → `QLOO_HACKATHON_BASE_URL_REQUIRED`. Production, staging, look-alikes, http, other ports, paths or embedded credentials → `QLOO_WRONG_ENVIRONMENT` / `QLOO_BASE_URL_INVALID`.
2. The harness child gets an explicit environment: `QLOO_BASE_URL` = `QLOO_TRUSTED_BASE_URL` = that origin, a fresh empty `QLOO_HOME` (no stored config can interfere), `QLOO_RESOLUTION_PROVIDER=native`, and taste-resolver variables removed. `HarnessExecTransport` refuses to spawn with any other routing.
3. Before any credentialed call, offline `qloo doctor` is run with the key *removed*, and its endpoint line must name exactly the hackathon origin → **`LIVE_QLOO_HOST_VERIFIED`**. Otherwise → `LIVE_QLOO_HOST_NOT_VERIFIED`, exit 4, nothing sent.

**Result: `LIVE_QLOO_HOST_VERIFIED`.** Effective upstream `https://hackathon.api.qloo.com`, trusted via `QLOO_TRUSTED_BASE_URL`. The **harness transport** was used for every call. The direct-HTTP fallback (`DirectQlooTransport`) was **not needed** and **not implemented**: the brief allows it only if the harness cannot target the hackathon host reliably, and it can.

## Live Authentication

| Step | Result |
| --- | --- |
| Credential-less probe (`qloo doctor --network`, key removed, isolated `QLOO_HOME`) | `HTTP 401` from `https://hackathon.api.qloo.com/` in 515 ms, no redirect: DNS, TLS and host OK |
| First credentialed call: Entity Search via `describe` (`/search` → `/entities`) for Jacquemus, type brand | `status: ok`, harness `correlation_id exec-dedce96b-1036-4a58-a417-5aae4a4d3963`, upstream `duration_ms 824`, wall time 1989 ms. Key accepted. Envelope validated against the `1.0-preview.1` schema. |
| Sanitized shape | `interpretation.entity {input, entityId, name, type: "urn:entity:brand", match: "exact"}`, `resolution.outcomes[]`, `results[{entity_id, name, popularity, properties}]`, `provenance.requests[{GET /entities}]`, `execution{transport: "direct", correlation_id}` |

The harness exposes its own `correlation_id` (`exec-…`) per call. It does not surface the upstream HTTP status of a successful call (an `ok` envelope implies 2xx) or Qloo's `x-request-id`.

**Rate limiting [live-exploratory].** A burst of single-entity calls succeeded. A 10-option `rank` and a `compare_audiences` with a 10-entity group returned `QLOO_RATE_LIMIT` (retryable) on both attempts, while 6-option `rank` and 1–3-entity `compare_audiences` succeeded. The live run spaces calls 7 s apart and caps the audience group at 3 exemplars. Under the retry policy, a rate-limited call is retried once (after 60 s) and then recorded as failed.

## Live Entity Resolution

**[live] Jacquemus.** `/search?query=Jacquemus` (unfiltered) returns: `Jacquemus` `urn:entity:brand` 93A50AC5-FCF2-4F47-87C0-E821E0B9F823 (popularity 0.983), then **`Simon Porte Jacquemus` `urn:entity:person`** CA00D624-5716-419B-AA5C-B2AEC3B7B764 (0.923), then eight `urn:entity:place` stores named Jacquemus/JACQUEMUS. With `types=urn:entity:brand`, the result is **exactly one** entity, the brand. The harness resolves `match: "exact"`. The designer and the stores are distinct types, so the brand is unambiguous. Its Qloo description: "French fashion brand known for womenswear, menswear, shoes, bags, and accessories".

**Resolution: `confirmed`.**

## Pinned Brand

`backend/src/feasibility/live-config.ts` pins `93A50AC5-FCF2-4F47-87C0-E821E0B9F823` / `urn:entity:brand`. Every run re-resolves "Jacquemus" and blocks with G1 = FAIL (NO-GO) if the resolved ID differs from the pin. Both pinned runs: `match=exact`, pin matches (run 2 `exec-9b89847e-7f0f-4d13-884e-6a97be8c9a61`).

## Pinned Territory

**Target meaning:** "boutique / design-led hospitality as a potential brand-extension territory".

**[live] Tag search (`find_tags`, semantic, 10 per query).** Every phrasing returns near-duplicate concepts across many namespaces. Highlights:

| Query | Notable candidates (id) |
| --- | --- |
| Boutique Hospitality | `urn:tag:interests:qloo:boutique_hospitality` (first), `urn:tag:amenity:qloo:boutique_hotel`, `urn:tag:product_service:qloo:boutique_hotel_accommodation`, `urn:tag:lifestyle:qloo:boutique_hospitality`, … |
| Boutique Hotel | `urn:tag:amenity:qloo:boutique_hotel`, `urn:tag:setting:qloo:boutique_hotel`, `urn:tag:interests:qloo:boutique_hotels`, `urn:tag:decor:qloo:boutique_hotel`, `urn:tag:decor:qloo:boutique_hotel_chic`, … |
| Luxury Hospitality | `urn:tag:lifestyle:qloo:luxury_hospitality`, `…:high_end_hospitality`, `urn:tag:product_service:qloo:luxury_hotels`, … |
| Hospitality | `urn:tag:keyword:qloo:hospitality`, `urn:tag:amenity:qloo:hospitality_services`, `urn:tag:genre:qloo:hospitality`, … |
| Hotels | `urn:tag:category:place:hotel`, `urn:tag:genre:place:hotel`, `urn:tag:amenity:qloo:hotels`, … |
| Design Hotel | `urn:tag:setting:qloo:design_hotel`, `urn:tag:decor:qloo:design_hotel`, `urn:tag:interests:qloo:design_hotels`, … |

Tags carry `popularity` but **no affinity** in search. The first result was not assumed correct. Each candidate was tested as a place filter **[live-exploratory]**:

- **Tag-only signal is degenerate.** `recommend place` with a tag as the only signal returns a flat affinity of exactly `0.7649962877984056` for every result, in entity-UUID order (`00157…`, `00158…`, `00172…`), with many non-hotels (restaurants, a visitor centre, wine bars). **Sprint 0A's exemplar method (tag as signal + filter) produces no cultural ordering and is abandoned.**
- **What works:** raw Insights with `filter.tags = <tag> ∩ urn:tag:category:place:hotel` (intersection) and the documented `filter.popularity.min = 0.95`.

**Pinned:** `urn:tag:interests:qloo:boutique_hospitality`. It has the exact label and is an *interest* (taste) concept rather than a facility attribute. Intersected with the hotel category, it yields recognisable boutique and design-led hotels.

| Rejected | Why |
| --- | --- |
| `urn:tag:amenity:qloo:boutique_hotel` | facility attribute; as a filter it returned restaurants, a visitor centre and wine bars |
| `urn:tag:setting:qloo:boutique_hotel` | viable, but its hotel set is less design-led (resorts, conference hotels); kept for exemplar sensitivity |
| `urn:tag:lifestyle:qloo:boutique_hospitality` | 0 place results |
| `urn:tag:interests:qloo:design_hotels`, `urn:tag:setting:qloo:design_hotel` | closest to "design-led" but sparse: 2 and 6 places at popularity ≥ 0.95 |
| `urn:tag:lifestyle:qloo:luxury_hospitality` | luxury, not boutique |
| `urn:tag:category:place:hotel` | generic; used only as the intersection filter |

**Exemplars (human-reviewed subset of the 20-result Qloo query, all `urn:entity:place`):** TRUNK(HOTEL) (Tokyo), Pikes Ibiza, The Culver Hotel, Posada Margherita (Tulum), Hôtel Particulier (Paris), Room Mate Aitana (Amsterdam), The Box House Hotel (NYC), The Margi (Athens), Great John Street Hotel (Manchester), The Crow's Nest (East Hampton). Rejected from the query: The Edgewater Hotel, Ekante Bliss (IHCL), Costa d'Este Beach Resort, Ace of Hua Hin Resort, Andaz Savannah, Tsar Palace (not boutique or design-led). IDs are in `live-config.ts`.

The territory is therefore a **derived representation**: pinned tag → Qloo-filtered places → human review. This choice shapes every downstream number (see Exemplar Sensitivity).

## Live Cultural Profiles

**Jacquemus [live, `entity_tags`, limit 20, `exec-bbfc655f-f61f-44dd-859c-263f6ac95c84`].** Twenty tags, all with affinity:

| # | Tag (namespace) | affinity |
| --- | --- | --- |
| 1–9 | VISA (credit_card), France (genre:media), French (genre:place:restaurant), Five Star (hotel_rating), electronic (genre:music), Model (genre:person), Identifies as women-owned (inclusivity), Expensive (cost_description), Beetroot Salad (specialty_dish) | **1** (all nine tied) |
| 10–20 | france, paris france (keyword:media), High-Fashion Consumers (customer_segment), French-Inspired (aesthetic_property), Fashion-forward consumers (customer_identity), Ready To Wear (product_service), Fashion Designer (occupation), playful designs (keyword), Young Creatives (influencer_appeal), Fashion Designers (category), gay (keyword:media) | 0.99986 → 0.99895 |

Findings:

- **Saturation.** The whole top 20 spans an affinity range of **0.00105**, and 9 tags are tied at exactly 1. Within the list, affinity barely discriminates. The profile is usable as a **set**, not as weights.
- **Operational noise.** 5 of 20 (25 %) are venue-operational namespaces (credit card, hotel rating, inclusivity badge, cost, menu dish), most likely inherited from Jacquemus's stores and cafés. 75 % are taste signals, and those are culturally precise (French fashion, high-fashion consumers, playful designs, young creatives).
- **Truncation.** The harness caps `entity_tags` at 20 (`limit: 50` is rejected locally with `TOOL_INPUT`; nothing is sent). `qloo api insights` cannot display tag results. Whether Qloo holds more than 20 tags for Jacquemus is **not observed**.
- **Related entities [live, `recommend brand`, `exec-9023bac9-…`]:** Céline (0.950), Tagwalk, Narciso Rodriguez, Isabel Marant, Dries Van Noten, Vetements, Helmut Lang, … Margiela, Acne Studios, The Row, Jil Sander (0.926). Very high face validity.
- **Popularity:** brand popularity 0.983 (undocumented response field; recorded, not used).

**Hospitality exemplars [live, 10 × `entity_tags`].** Each exemplar's 20 tags span affinity ≈ 0.95–1.00. They are dominated by operational namespaces: `specialty_dish` (tiramisu, avocado toast, steak tartare, chicken wings), `credit_card`, `hotel_rating`, `cost_description`, `inclusivity`.

## Top-N Stability

**[live] Sprint 1 machinery over the live packet** (brand top-N vs derived-target top-N, explicit ranks):

| N | brand used | target used | shared | Jaccard |
| --- | --- | --- | --- | --- |
| 5 | 5 | 5 | 0 | 0.000 |
| 10 | 10 | 10 | 3 | 0.176 |
| 15 | 15 | 15 | 5 | 0.200 |
| 20 | 20 | 20 | 5 | 0.143 |

No shared signal persists across every N (`persistentSharedIds = []`), the shared set changes twice, and the Jaccard range is 0.20. **Conclusions about Jacquemus ↔ hospitality are highly sensitive to truncation at N ≤ 10.** At N = 5 the brand cut falls inside a 9-way tie at affinity 1, so it is arbitrary.

**Request-level stability (brand profile):**

- Repeat call, same `take=20`: **identical** IDs, values and order (Jaccard 1). Run 1 vs run 2 (≈ 5 min apart): identical.
- **Cross-take:** asking for `take=N` is not the same as truncating `take=20`. Jaccard(take N, first N of take 20) = **0.67 at N=5**, 1.0 at N=10 and N=15. Ties are re-ordered depending on `take`. Profiles must therefore be captured at one fixed `take` and cut locally.

Qloo never returned fewer than the limit, so there was no padding or saturation.

## Audience Evidence

**[live] `compare_audiences` (Jacquemus vs 3 exemplars, `exec-860b55d8-7f32-4f2d-b9a9-a32f917328b8`)** returns `results = { tags: [], a: [20 tags], b: [≤ 20 tags] }`. Each item has `tag_id, name, subtype, entity_id, popularity, query.count` (`count` is a string). Jacquemus vs Ace Hotel **[live-exploratory]** gave `a`: Casual, Accessories, Playfulness, Footwear, French fashion, art and design, Creatives, Travel bloggers; `b`: Travel, Hotel. The numeric paths are only `a[].popularity`, `b[].popularity`.

**[docs] `/v2/analysis/compare`** documents no result field's meaning, direction or scale. Only `duration` (seconds) is documented. → **Opaque.**

**[live] `audience_demographics` (Jacquemus):** `query.age.{24_and_younger −0.05, 25_to_29 0.14, 30_to_34 0.25, 35_to_44 0.18, 45_to_54 −0.55, 55_and_older −0.57}`, `query.gender.{female 0.31, male −0.31}`. **[docs]** "positive values indicate stronger-than-average alignment for that audience group". Scale, baseline and cross-request/entity comparability are **not documented**.

| Field | Meaning | Direction | Scale | Comparison scope | Promoted? |
| --- | --- | --- | --- | --- | --- |
| compare `a[]/b[].popularity` | undocumented | — | — | — | No (opaque) |
| compare `query.count` | undocumented (string) | — | — | — | No |
| demographics `query.age.*`, `query.gender.*` | alignment vs "average" | documented (+ = stronger) | undocumented | one entity, one call; not comparable across entities | No: it describes brand↔demographic, not brand↔territory closeness |

**G4: `INTERPRETABLE_QUANTITATIVE_AUDIENCE_EVIDENCE` is not established. → PARTIAL.** Demographic skew is readable as single-entity context. No documented quantitative brand-vs-territory audience metric exists. The adapter promotes **no** `InterpretableMetric`, and the engine reports `audience: insufficient_evidence` with `OPAQUE_NUMERIC_FIELDS`.

## Candidate Ranking

`rank` scores entities of **one type** in **one call** [contract], so each territory needs a brand exemplar. That is a documented approximation. **[live]** resolution:

| Territory | Proposed | Live resolution → used |
| --- | --- | --- |
| Boutique Hospitality | Ace Hotel | brand, exact → **Ace Hotel**; alternate **The Hoxton** |
| Ceramics | Astier de Villatte | exists only as `place` stores; harness `needs_input` with wrong candidates (not continued) → **Heath Ceramics** |
| Furniture | HAY | brand, exact → **HAY**; alternate **VITRA** |
| Sailing / marine | North Sails | only `place` stores (Henri Lloyd too; Musto not found) → **Helly Hansen** (weak proxy); alternate **Sebago** |
| Wellness | Six Senses | brand, exact → **Six Senses** (also a hospitality brand: confounded); alternate **Aesop** |
| Gaming Hardware | Razer | brand, exact → **Razer**; alternate **Steel Series** (SteelSeries; `needs_input`, reviewed and pinned) |

**[live] Single call, signal = Jacquemus (`exec-cfd19692-e04d-46a9-80ed-1a4d14b7ad27`):**

| Position | Primary exemplar | affinity | Alternate exemplar (`exec-b8154b63-…`) | affinity |
| --- | --- | --- | --- | --- |
| 1 | HAY | 0.8209 | Aesop | 0.8577 |
| 2 | **Ace Hotel** | 0.7965 | **The Hoxton** | 0.8431 |
| 3 | Heath Ceramics | 0.7357 | VITRA | 0.8104 |
| 4 | Six Senses | 0.7039 | Sebago | 0.7941 |
| 5 | Razer | 0.6122 | Heath Ceramics | 0.7357 |
| 6 | Helly Hansen | 0.6038 | Steel Series | 0.5626 |

The repeat call was **identical**. The range across options (0.60–0.86) is much wider than the tag-affinity range, so this signal **does discriminate**. Heath Ceramics returned the *same* affinity (0.735673…) in two calls with different option sets. That suggests per-option affinity is independent of the option set, but cross-call comparability is **undocumented**, so the engine still compares values only within one call (`comparisonScope: within_call`, ranking scope verified `single_call`).

**Related signal [live]:** `recommend place` with signal = Jacquemus and filter = pinned tag (`exec-4d8611d9-…`) returns 20 places, led by Hôtel Mansart (0.958), Hôtel Splendor, Grands Boulevards, Georgian House Hotel, Hôtel Whistler, Hôtel de Sèze, Seethrough Mykonos, The Rookery, **Room Mate Aitana** (also a pinned exemplar), Hôtel des Lices Saint-Tropez, … (0.922). These are Parisian and Mediterranean boutique hotels, a coherent "Jacquemus taste" inside the territory. This is the clearest Qloo-specific evidence in the run. **Sprint 1's `EvidencePacket` has no slot for it**, so it is recorded in the run's observations, not in the packet (see Sprint 2).

## Exemplar Sensitivity

| Test | Result |
| --- | --- |
| Hospitality rank position, Ace Hotel → The Hoxton | 2 → 2 (stable) |
| Gaming rank position, Razer → Steel Series | 5 → 6 (bottom both times; stable) |
| Furniture HAY → VITRA | 1 → 3 |
| Wellness Six Senses → Aesop | 4 → 1 |
| Sailing Helly Hansen → Sebago | 6 → 4 |
| Jacquemus ∩ exemplar tags [live-exploratory]: Ace Hotel vs The Hoxton | 3 vs **7** shared (Jaccard 0.08 vs 0.21) |
| Jacquemus ∩ exemplar tags: Razer vs Steel Series | 2 vs 2 (Razer/Steel overlap 0.60) |
| Joint target tags, reviewed 10 vs Qloo-order top 10 vs `setting:boutique_hotel` top 10 [live-exploratory] | Jaccard **0.21** and **0.00** |
| Derived recurring target vs joint target tags (same exemplars) [live] | Jaccard **0.06** |

**Conclusion:** the *direction* of the extreme conclusions is robust (hospitality upper half, gaming bottom). Mid-table positions, and any tag-overlap magnitude, depend heavily on which exemplar stands in for the territory. **"Territory = one exemplar" is too fragile for a single number.** Sprint 2 must use several exemplars per territory and report the spread.

## Bridge Evidence

| Bridge | Joint tags (one call, brand + 1 exemplar) | Mutually related brands (top 20 each) |
| --- | --- | --- |
| Jacquemus → Boutique Hospitality (Ace Hotel), `exec-ce139cd6-…` | 20, e.g. Ready To Wear, Chic, indie, Handbags, electronic, plus noise (japanese drama, based on manga, Breakfast Burrito) | **0** (Ace's related brands: The Standard, Sydell Group, The Hoxton, EDITION, CitizenM, Aesop, …) |
| Jacquemus → Gaming Hardware (Razer), `exec-bca1f267-…` | 20, mostly Jacquemus's own (French Fashion, High-Fashion Consumers, playful designs), plus anime animation, Inexpensive, VISA | **0** (Razer's: Corsair, Logitech, MSI, Asus, Steel Series, HyperX, …) |

**[live-exploratory] Provenance of joint tags:** J+Ace = 6 from the brand's own top 20, 9 from Ace's, 8 from neither. J+Razer = 10 / 5 / 7. The two joint lists share only 4 of 20, so joint tags do respond to the target. But the "neither" tags (candidate intermediate signals) are semantically noisy, and no strength, direction or path semantics exist.

**G6 answer: B, qualitative evidence only.** Bridges stay "Qloo-supported intermediate cultural signals" for explanation. No Bridge Strength number.

## Graph Distance Decision

**[contract + docs] `REAL_GRAPH_DISTANCE_UNAVAILABLE`.** The hackathon API exposes the standard v2 endpoints (`/search`, `/entities`, `/v2/insights`, `/v2/tags`, `/v2/analysis/compare`, `/v2/trending`, `/v2/audiences`). None returns a distance, shortest path or hop count. Any distance-like measure the project builds is the **Qloo-derived Cultural Distance Proxy**, and the word "graph distance" is not used for it.

## Novelty Decision

**REMOVE independent Novelty (confirmed).** No live signal measures novelty independently of coherence. Trends are flat or undocumented (below). `popularity` is undocumented and is not novelty. `novelty = 1 − coherence` would not be an independent measurement.

## Momentum Decision

**[live] `trends` (Jacquemus, 365-day window, `exec-a83db44c-…`):** 10 weekly points, each `{date, population_percentile 0.8277, population_rank "489", population_rank_velocity 0, velocity_fold_change 0, population_percent_delta 0}`. Every point is identical. **[docs]** Weekly granularity is documented, but none of the five metric fields has documented meaning. → **Not a Cultural Momentum ingredient.** Possible future context only, after Qloo documents the fields. It was not investigated further, to save quota.

## EvidencePacket Mapping

`backend/src/qloo/live-adapter.ts` (written from live output):

```
harness envelope (zod, schema 1.0-preview.1)
  entity_tags(brand)              → brand CulturalProfile: tag id, label, category = tag namespace, rank = Qloo order,
                                    numeric {value: affinity, comparisonScope: within_call} (NO scale), truncated when n = limit
  entity_tags(each exemplar) × 10 → target CulturalProfile (DERIVED): tags in ≥ 2 exemplars; rank = support desc,
                                    best rank asc, id; NO values (never averaged across calls); provenance = every exemplar call
  rank(brand → 6 exemplars)       → RankingEvidence: single_call, within_call affinity, targetCandidateId = Ace Hotel
  compare_audiences               → AudienceEvidence.fields (sanitized, opaque); interpretableMetrics = []
  entity_tags(brand + Ace)        → BridgeEvidence joint_signal (no rank, no strength)
  recommend(brand) ∩ recommend(Ace) → BridgeEvidence intermediate_signal (membership only; 0 found)
provenance: {source: "qloo-hackathon-api", operation, correlationId, capturedAt} on every item
```

Provider-specific fields stop at the adapter. Unknown data stays opaque. Missing evidence stays absent. **The Sprint 1 engine needed no changes.** The abstraction held: within-call scope, derived-profile-without-values, and opaque audience all mapped onto existing concepts.

## Live AnalysisIngredients

First real analytical packet, Jacquemus → Boutique Hospitality (ingredients only: no Elasticity Score, no Cultural Distance Score, no recommendation, no LLM text):

| Ingredient | Value | Notes |
| --- | --- | --- |
| Overlap | 20 brand × 32 target signals; **5 shared**; Jaccard **0.106**; overlap coefficient 0.25 | Shared: Expensive, electronic, Model, French (restaurant genre), Five Star. 3 of 5 are venue attributes (cost, hotel rating, restaurant genre); 2 are taste signals. |
| Weighted shared overlap | `insufficient_evidence` | Target has no values; cross-call values are never compared |
| Profile coverage | brand 20 signals, numeric 1.0, 18 categories, truncated; target 32, numeric 0, 11 categories, truncated; shared-of-brand 0.25, shared-of-target 0.16 | |
| Stability | Jaccard 0 / 0.176 / 0.200 / 0.143 at N = 5/10/15/20; no persistent shared signal | highly truncation-sensitive |
| Audience | `insufficient_evidence` (40 opaque numeric paths, 0 interpretable metrics) | |
| Ranking | verified single call; Ace Hotel position 2 of 6; relative rank percentile 0.8; raw value gap from top 0.024, from bottom 0.193 (call's own scale, direction not interpreted) | |
| Bridges | available: 20 joint signals, 0 intermediate | qualitative |
| Distance-proxy ingredients | `formula: NOT_DEFINED`; Jaccard, overlap coefficient, shared count, rank percentile, bridge count, coverage, stability available; weighted overlap and audience insufficient | |
| Evidence quality | **MEDIUM** (driver: profileCoverage limited) | resolution, provenance, comparison validity, bridges good |
| Limitations | AFFINITY_SCALE_UNDOCUMENTED, TARGET_IS_DERIVED_REPRESENTATION, TERRITORY_EXEMPLARS_HUMAN_REVIEWED, RANKING_EXEMPLAR_APPROXIMATION, EXEMPLAR_SUBSTITUTED ×3, OPERATIONAL_TAGS_PRESENT, NO_GRAPH_DISTANCE, BRAND/TARGET_PROFILE_TRUNCATED, STABILITY_ON_PARTIAL_REPRESENTATION, OPAQUE_NUMERIC_FIELDS, NO_INTERPRETABLE_AUDIENCE_METRIC | |

## Revised G1–G6

Deterministic definitions in `backend/src/feasibility/live.ts`. The G3 thresholds were fixed after inspecting live data.

| Gate | Tier | Definition | Result | Consequence |
| --- | --- | --- | --- | --- |
| **G1** Confirmed brand identity | CORE | brand-filtered search resolves `exact` to the pinned ID | **PASS** | — |
| **G2** Confirmed target territory representation | CORE | pinned tag reappears in tag search; ≥ 5 pinned exemplars return tags; ≥ 5 brand-conditioned territory entities | **PASS** (10/10, 20) | Representation is human-reviewed and derived; disclose it |
| **G3** `SUFFICIENT_STABLE_CULTURAL_PROFILE` | CORE | C1 ≥ 10 signals · C2 numeric coverage 1 (single-call profiles) · C3 ≥ 5 namespaces · C4 taste (non-operational) share ≥ 0.5 · C5 repeat-call Jaccard 1 · C6 cross-take Jaccard ≥ 0.6 at N ≥ 10 · C7 affinity range ≥ 0.01. All → PASS; C1–C6 → SET_ONLY | **PARTIAL**: brand SET_ONLY (fails C7: range 0.001); target INSUFFICIENT (fails C4: taste share 0.44) | Tag overlap usable only as an unweighted, operational-filtered set; tag affinities can't weight anything |
| **G4** `INTERPRETABLE_QUANTITATIVE_AUDIENCE_EVIDENCE` | ENHANCEMENT | ≥ 1 audience field with documented meaning, direction, scale and comparison scope | **PARTIAL** (demographic direction only) | No audience ingredient in Elasticity |
| **G5** Valid candidate-relative evidence | ENHANCEMENT | single-call rank with ≥ 4 valued candidates, identical on repeat; PARTIAL if exemplar swaps move positions | **PARTIAL** (6 valued, repeat identical, 4/5 positions move) | Usable only as within-call order with ≥ 2 exemplars per territory |
| **G6** Useful intermediate bridge evidence | ENHANCEMENT | A quantitative · B qualitative · C neither | **PARTIAL = B** | Explanation only; no Bridge Strength |

Decision rule: any CORE FAIL → NO-GO; all PASS → GO; otherwise CONDITIONAL GO.

## Qloo Necessity

What disappears without Qloo, judged on this run:

| Capability | Without Qloo | Verdict |
| --- | --- | --- |
| Entity resolution | Brand vs designer vs store disambiguation, stable IDs | **lost**; Qloo-unique, modest value |
| Cultural profiles (tags) | 20 brand tags. The taste subset (French-inspired, high-fashion consumers, playful designs, young creatives) is plausible for an LLM to guess; the operational noise is not useful | **partly replaceable** |
| Affinity evidence | Within-call, reproducible, discriminating values for **brand → candidate brands** (0.56–0.86) and **brand → territory places** (Paris/Mediterranean boutique hotels) | **lost**; this is the evidence an LLM cannot produce with provenance |
| Related entities | Céline, Isabel Marant, Dries Van Noten, … with values | **lost** (an LLM can guess names, not values or reproducibility) |
| Audience | Demographic skew with documented direction; no comparison metric | **marginal** |
| Rankings | Single-call relative order, repeatable | **lost** |
| Bridges | Qualitative joint tags | **marginal** |
| Trends | Flat, undocumented | **none** |

**Qloo is necessary** for the quantitative, reproducible, provenance-bearing core: entity-level affinities in a shared comparison scope. It is **not** necessary for the tag-level cultural narrative, which an LLM could approximate. That is why the methodology must centre on within-call entity affinities, not tag overlap.

## Final Feasibility Decision

## **CONDITIONAL GO**

Qloo provides enough real evidence for a defensible but **reduced** Cultural Elasticity methodology. Both core identity gates pass. Live data is reproducible to the last digit across runs. Single-call entity affinities discriminate between territories and carry provenance an LLM cannot fabricate. It is not GO for four reasons:

1. Tag profiles are saturated (affinity range 0.001) and polluted by operational tags. Tag-overlap measures are set-only, small (5 shared) and truncation-sensitive.
2. No audience metric has documented semantics.
3. Territory conclusions depend on the exemplar.
4. Bridges are qualitative only.

It is not NO-GO because the within-call affinity evidence clearly distinguishes this product from a subjective LLM brand analysis.

## Methodology Inputs Approved for Sprint 2

**Approved as quantitative ingredients (within one call only, with correlation id):**

1. **Brand-relative candidate order** from one `rank` call (≤ 6 options per call observed safe), with **≥ 2 exemplars per territory**, reporting each exemplar's position and the spread.
2. **Brand-conditioned territory affinity:** `recommend` place/brand with signal = brand and filter = pinned territory tag, used as within-call order and coverage (count returned, top entities). Requires a new optional `EvidencePacket` slot (an adapter-compatible schema addition).
3. **Brand-related entities** (`recommend` same type) as context and for mutual-neighbour checks.

**Approved as descriptive, set-only ingredients:**

4. Tag-set overlap (Jaccard, overlap coefficient, shared IDs) at a **fixed `take=20`**, reported with top-N stability. **Operational namespaces must be separated** (credit_card, cost_description, specialty_dish, hotel_rating, inclusivity, amenity, offerings, service_option), and overlap reported on the taste subset as well as the full set. No weighted overlap.

**Approved as qualitative evidence only:** joint tags and mutually related entities ("Qloo-supported intermediate cultural signals"), demographic skew of the brand (direction only).

**Not approved:** audience comparison metrics, tag-affinity weighting, cross-call value comparison, trends/momentum, Novelty, graph distance, any Bridge Strength.

---

# Part B — Sprint 0A (historical, contract-only)

> Preserved as written on 2026-10-16 **before** a credential existed. Its decision was contract-level only (`LIVE_QLOO_VALIDATION_NOT_RUN`) and has been **superseded by Part A**. One line was corrected: §2's upstream row, which described the harness default as if it were this project's environment. Some of its assumptions were later disproved live, notably the exemplar method in §5/§13 (a tag as signal + filter returns an unordered set). Evidence labels in Part B use its own definitions:
>
> - **[contract]**: read from the harness workflow contract (`qloo_capabilities`, contract 1.0.0, checksum `sha256:762bdcc5…24f5`).
> - **[harness]**: read from the harness 0.1.26 workflow implementation.
> - **[recorded]**: a real harness output captured without a credential.
> - **[live]**: nothing in Part B is at this level.

## 1. Executive Decision

### CONDITIONAL GO (contract level only, live evidence unverified). Superseded by Part A

At the contract level, the official Qloo tooling can supply most of the evidence a defensible Cultural Elasticity methodology needs:

- tag-level cultural profiles with numeric affinity;
- audience comparison between entity groups;
- single-call ranking of candidate entities against a brand;
- jointly characterizing tags for bridge discovery;
- time-series popularity.

Two of the originally proposed concepts are **not** supported as stated:

1. **Graph distance does not exist.** Qloo exposes no distance, path or topology endpoint [contract]. "Cultural distance" can only be a clearly labelled *proxy* built from overlap and affinity.
2. **Territories are not Qloo objects.** "Boutique Hospitality", "Ceramics" and "Gaming Hardware" must each be represented by a Qloo tag plus exemplar entities. That representation choice drives every downstream number.

The decision becomes **GO** only if a live run passes gates G1–G3 (§17). If G1–G3 fail, the honest answer is **NO-GO** for a Qloo-grounded product.

## 2. Environment

| Item | Value |
| --- | --- |
| Node | 22.23.2 (nvm). The machine default was 20.20.0, below the required ≥22.19, so the repo pins `.nvmrc` = 22 and `engines.node` ≥22.19.0 |
| pnpm | 10.26.0 |
| Qloo harness | `@qloo/qloo-harness` **0.1.26**, pinned exactly as a backend dependency |
| Pi runtime (inside harness) | 0.84.2 |
| Workflow contract | 1.0.0, `sha256:762bdcc5e14ff797b6de739d2658a83f78af35e68d7a5a3449455be6046924f5`, result schema `1.0-preview.1` |
| Upstream | *(corrected in Sprint 0B)* `qloo doctor` reported the harness **default** `https://api.qloo.com`, because nothing else was configured. That is **not** this project's environment: hackathon keys work only on `https://hackathon.api.qloo.com` (Part A, Hackathon API Environment). Qloo API v2.0 |
| `qloo doctor` | Qloo credential **missing**, model provider **not signed in**, endpoint trust ok, resolution provider = native |
| Live validation | **NOT RUN.** No `QLOO_API_KEY` and no harness-stored key |

## 3. Authentication

- The backend and the harness child process read `QLOO_API_KEY` from the environment. Locally it lives in `backend/.env` (gitignored). Alternatively `qloo setup` stores it in `~/.qloo`.
- `BackendConfig` exposes only `hasCredential: boolean`, never the value. The credential reaches the harness only through the child's inherited environment.
- Error messages from the transport pass through `scrubSecrets()`. The Fastify logger redacts credential-shaped fields. The feasibility script refuses to write output that contains the key.
- `pnpm check:secrets` scans tracked and untracked files and the browser bundle (`frontend/.next/static`). CI runs it after the build.
- The frontend never talks to Qloo. Its only backend variable, `BACKEND_URL`, is server-side (no `NEXT_PUBLIC_`).
- **Harness behaviour observed [recorded]:** credentials are checked before input validation. An invalid type such as `"shoe"` still returns `QLOO_AUTH` (exit 4), so input validation cannot be exercised offline.

## 4. Qloo Surfaces Tested

| Surface | What was done | Result |
| --- | --- | --- |
| `qloo explore` | Inspected (help, README, profile docs). Not driven. | Interactive and TTY-only. It also needs a model-provider login, which is absent. It is a human discovery tool, not an automation surface. **Recommended for the team's manual live session once a key exists.** |
| `qloo exec` | Integrated as the backend transport (`HarnessExecTransport`). Exercised for real without a credential. | Model-free, non-interactive, one normalized envelope per call. Exit codes: 2 input, 4 auth, 1 failure, 130 cancel [harness]. Failure output is `{error, operation, correlation_id}`, not an envelope [recorded]. **Best fit for deterministic evidence collection.** |
| `qloo api` | Inspected (`--help`). | The legacy endpoint-shaped CLI (`insights`, `search`, `entity`, `analyze`, `tags`). Useful for raw-request debugging. The harness marks it non-canonical. Not used. |
| `qloo mcp` | Started over stdio. Ran `initialize`, `tools/list`, `qloo_capabilities` and a `qloo_describe` call. | The nine canonical `qloo_*` tools plus `qloo_capabilities` work fully offline. Without a credential, calls return a structured `status:"error"`, `QLOO_AUTH`, `retryable:false` envelope [recorded]. **This is the future agent's runtime surface.** |
| `qloo doctor` / `setup --status --json` | Run. | Machine-readable readiness. The feasibility script uses it to detect a harness-stored key. |

The nine canonical workflows [contract]: `recommend`, `rank`, `describe`, `where_popular`, `compare_audiences`, `entity_tags`, `audience_demographics`, `trends`, `find_tags`.

Upstream endpoints behind them [contract]: `/search`, `/entities`, `/v2/insights` (including `filter.type=urn:tag`, `urn:demographics` and `urn:heatmap`), `/v2/analysis/compare`, `/v2/tags`, `/v2/trending`, `/v2/audiences`.

## 5. Entity Resolution

### Jacquemus

**Live result: unverified.**

What is established:

- `describe` resolves a name through `/search` with `types=urn:entity:brand` and `take: 5`, then hydrates through `/entities` [harness].
- Outcomes are explicit:
  - **resolved** when exactly one exact normalized-name match exists (`match: "exact"`);
  - **ambiguous** with up to five candidates;
  - **not_found**.

  The last two surface as `status: "needs_input"`. The harness never auto-picks between ambiguous candidates [harness].
- Returned metadata is restricted to: `entity_id`, `name`, `type`, `subtype`, `popularity`, plus `description`, `short_description`, `image`, `geocode`, `address`, `price_level` and `business_rating` when present [harness]. There is **no confidence score**, and the harness explicitly refuses to relabel popularity or order as confidence.
- **Ambiguity risk:** "Jacquemus" is both the brand and the designer (Simon Porte Jacquemus). Scoping `describe` to `type: brand` should isolate the brand. Whether a separate `person` entity exists is a live question.
- Our client treats `needs_input` as blocking. The feasibility run stops (status `BLOCKED`, gate G1 fails) rather than choosing.

### Boutique Hospitality

**Live result: unverified.**

Qloo has no "category" or "territory" object [contract]. The available representations are:

| Representation | Mechanism | Usable for |
| --- | --- | --- |
| **Tag** (e.g. a boutique-hotel tag URN) | `find_tags` semantic search over the tag ontology. It returns tag URNs in rank order with no confidence [harness]. | Filters and signals in `recommend` and `rank`. **Not accepted** by `compare_audiences`, `entity_tags` or `audience_demographics`, which take entities only [contract]. |
| **Exemplar entities** (hotels as `place` entities) | `recommend` with `target_type: place`, `signal_tags = include_tags = [tag]` | Everything that needs entities: audience comparison, tag profiles, trends. |
| **Brand-conditioned territory** | `recommend` with `target_type: place`, `signals = [Jacquemus]`, `include_tags = [tag]` | Which hospitality entities the Jacquemus audience over-indexes on. |

**Selected representation:** tag + exemplars. Specifically:

1. Run `find_tags` for all five phrasings ("Boutique Hospitality", "Boutique Hotel", "Luxury Hospitality", "Hospitality", "Hotels") and record every candidate.
2. Take the first candidate of the first non-empty phrasing as the tag. Mark it `auto_selected_unconfirmed` and list the alternatives in the packet. **A human must pin the tag** (`pinnedTagId` in `backend/src/feasibility/config.ts`) before results are relied on.
3. Use the top 10 `place` entities for that tag as exemplars, deliberately **not** conditioned on Jacquemus to avoid circularity.

Open live questions:

- Does a boutique-hotel tag exist, and is it scoped to places? (The harness scopes tags locally to the target type when parent metadata allows [harness].)
- Do "Luxury Hospitality" and "Hotels" map to different tags, meaning they are distinct territories rather than synonyms?

## 6. Cultural Profile Evidence

The following [contract]/[harness] evidence is available per entity:

| Evidence | Workflow | Shape | Notes |
| --- | --- | --- | --- |
| Characterizing tags | `entity_tags` (Insights `filter.type=urn:tag`) | `{id, name, type, popularity?, affinity?}`, ≤20 per call [harness] | **Primary profile evidence.** Accepts 1–10 entities and returns tags that *jointly* characterize them. |
| Related entities | `recommend` with `signals=[entity]` | `{entity_id, name, type, subtype, popularity?, affinity?}`, ≤20, optional explainability [harness] | Cross-domain neighbours (brands, places, artists…). |
| Demographics | `audience_demographics` (`urn:demographics`) | **Untyped**, passed through [harness] | Documented by Qloo as "documented-but-not-enumerated" [contract]. Stored as opaque evidence. |
| Momentum | `trends` (`/v2/trending`) | **Untyped** `series[{entity, points[]}]` [harness] | Entity-level only, 1–5 entities per call, ISO date range. |
| Geography | `where_popular` (heatmap) | Untyped | Not needed for Sprint 0, so not wrapped. |
| Scores | `affinity`, `popularity` | Numbers [harness] | **Query-relative.** Comparable only within one call. |

For the target, the same evidence is collected over the exemplar set (`entity_tags` jointly over up to 10 exemplars).

## 7. Audience Comparison

`compare_audiences` [contract]:

- **Input:** `group_a` and `group_b`, each 1–10 **entities** (no tags), optional `target_type` and `limit` ≤20.
- **Upstream:** `/v2/analysis/compare` with `a.signal.interests.entities` and `b.signal.interests.entities`.
- **Output:** `results` is the raw upstream payload, **passed through untyped** [harness].

So:

- **Output schema: unknown until live.** We store it as `OpaqueEvidence` with its top-level keys and the paths of numeric fields, and interpret nothing.
- **Quantitative scores: unknown.** Gate G4 checks whether any numeric field exists.
- **Limitation:** Boutique Hospitality enters only through its exemplars, so the comparison is "Jacquemus vs. these 10 hotels", not "vs. the territory".
- **Can it support Audience Adjacency?** **Possibly, if** G4 shows per-entity or per-tag comparative scores *and* Qloo documents their meaning. Without documented semantics we must not treat any number as an overlap percentage.
- **Fallback that is already well-defined:** affinities from the brand-conditioned territory call (§5). These are numeric, per entity and single-call comparable [harness].

## 8. Candidate Ranking

`rank` [contract]:

- ranks 1–10 **entities of one `option_type`** against a shared signal profile;
- requires at least one entity, location or demographic signal;
- the contract states: **"Scores from separate calls are not comparable."**

The harness restricts `/v2/insights` to the supplied IDs (`filter.results.entities`) and returns each option's `affinity` and `popularity` [harness].

Consequences:

- Abstract territories ("Ceramics", "Sailing Experience") **cannot be ranked directly**.
- The viable design: one human-chosen **exemplar brand per territory**, all ranked in **one call** with Jacquemus as the signal.

  | Territory | Exemplar brand (assumption) |
  | --- | --- |
  | Boutique Hotel | Ace Hotel |
  | Ceramics | Astier de Villatte |
  | Furniture | HAY |
  | Sailing Experience | North Sails |
  | Wellness Retreat | Six Senses |
  | Gaming Hardware | Razer |

- Exemplars that are ambiguous or not found are **excluded and reported**, not guessed (tested).
- **Recorded assumptions:**
  - the exemplar stands in for the territory, so a different exemplar could change the order;
  - all six must be Qloo `brand` entities;
  - affinities are comparable only within this call (`comparableWithinCorrelationId`).

**Can it distinguish plausible from weak territories?** Mechanically yes. Validity rests on exemplar choice, which is a methodological risk (§14). A more robust variant for Sprint 1: rank *several* exemplars per territory in one call (the call takes ≤10 options) and compare distributions rather than single points.

## 9. Bridge Discovery

**Qloo exposes no graph paths** [contract]. The supported output is therefore:

> **Qloo-supported intermediate cultural signals**

It is produced from two pieces of evidence:

1. **Shared tags:** tag IDs that appear in both the brand's and the target's top-N `entity_tags` lists.
2. **Joint tags:** `entity_tags` called on {Jacquemus + up to 3 target exemplars} at once. Qloo returns tags that jointly characterize the combined set [contract: "concepts that jointly characterize one or more entities"].

The same procedure runs for Jacquemus → Gaming Hardware (exemplar: Razer) as a deliberately distant contrast.

What **cannot** be claimed:

- that a tag lies "between" the two in any topological sense;
- path length;
- that a joint tag is causal or directional.

The joint call is also asymmetric: one brand versus up to three exemplars. The `BridgeEvidence` contract hard-codes `semantics: "qloo_supported_intermediate_cultural_signals"`, and the schema rejects any other value.

## 10. Cultural Distance

**Does Qloo expose real graph distance? No.**

The complete set of upstream GET paths in the pinned specification is `/`, `/entities`, `/search`, `/v2/analysis/compare`, `/v2/audiences`, `/v2/audiences/types`, `/v2/insights`, `/v2/tags`, `/v2/tags/types`, `/v2/trending` [contract]. None returns a distance, path or topology. No workflow returns one either. Qloo's scores are affinities (query-relative association strength), not metric distances.

**What defensible proxy is possible:** a *Qloo-derived Cultural Distance Proxy*, explicitly labelled as such, assembled from:

| Ingredient | Source | Status |
| --- | --- | --- |
| Tag-set overlap (shared count, Jaccard on top-N lists) | `entity_tags` brand vs. target | Computed in Sprint 0 (descriptive only). Depends on live data. |
| Single-call rank position and affinity of the territory exemplar | `rank` | Collected. Depends on live data. |
| Affinity of territory entities to the brand | brand-conditioned `recommend` | Collected. Depends on live data. |
| Audience comparison fields | `compare_audiences` | Depends on output semantics (G4). |
| Bridge availability (joint and shared tag count) | `entity_tags` joint | Collected. Depends on live data. |

Constraints on any proxy:

- it may only combine numbers from the **same call** or rank-based (ordinal) transforms;
- it must not be called "distance" in the UI without the word "proxy";
- it must expose its ingredients;
- weights are out of scope until live data shows the ingredients' ranges and stability.

## 11. Candidate Elasticity Dimensions

| Dimension | Supported? | Qloo evidence | Confidence | Notes |
| --- | --- | --- | --- | --- |
| Cultural Coherence | **Partially** | `entity_tags` (brand vs. exemplars): shared tags and affinity | Medium (contract), unverified live | Depends on the target representation, and the 20-tag cap truncates profiles. Gates G3 and G6. |
| Audience Adjacency | **Conditional** | `compare_audiences` (untyped); brand-conditioned `recommend` affinities | Low–Medium | The compare output schema is unknown (G4). The recommend affinities are a well-defined fallback. |
| Novelty | **Not supported as an independent dimension** | No direct signal. `popularity` measures how mainstream something is, not novelty. Low overlap is just the inverse of coherence. | Low | Drop as an independent dimension, or redefine (e.g. a territory where the brand's audience over-indexes but the brand has no tag presence). Needs live data to test. |
| Bridge Strength | **Partially, renamed** | Joint and shared `entity_tags` | Medium (contract) | Must be reported as "Qloo-supported intermediate cultural signals", not paths. Gate G6. |
| Cultural Distance Proxy | **Proxy only** | Overlap + single-call rank + affinities | Medium (contract) | **No real graph distance** (§10). |
| Cultural Momentum | **Supported for entities** | `trends` time series | Low–Medium | Output untyped until live. Territories only via exemplars (≤5 per call). |

## 12. Proposed Evidence Model

Implemented in `backend/src/contracts/qloo.ts` as strict zod schemas, validated at the boundary. Unknown fields such as `elasticityScore` or `confidence` are rejected by tests.

```
EvidencePacket (schemaVersion "0.1", evidenceSource "live" | "fixture", harness {version, contractChecksum})
├── brand: CulturalProfile
│   ├── subjects: ResolvedConcept[]       kind, input, label, qlooId, type, match,
│   │                                     confirmation (unambiguous | auto_selected_unconfirmed | pinned),
│   │                                     alternatives, provenance
│   ├── tags: CulturalSignal[]            qlooId, label, affinity?, popularity?, sourceCorrelationId
│   ├── relatedEntities?, demographics? (OpaqueEvidence), momentum? (OpaqueEvidence)
├── target
│   ├── representation: label, tagCandidates[] (per phrasing), selectedTag, exemplars[], exemplarMethod
│   └── profile?: CulturalProfile over the exemplars
├── targetAffinityToBrand?   territory entities ranked by affinity to the brand (one call)
├── audienceComparison?      groupA, groupB, result: OpaqueEvidence (shape "unverified", topLevelKeys, numericFieldPaths)
├── rankings?: CandidateRanking[]   entries (territory, exemplarInput, exemplar?, position?, affinity?,
│                                   unresolvedReason?), comparableWithinCorrelationId, assumptions
├── bridgeEvidence?: BridgeEvidence[]   semantics (fixed literal), sharedTags, jointTags, overlap (descriptive)
├── limitations: string[]
└── provenance: ProvenanceRef[]   operation, correlationId, status, endpoint, requests (IDs/URNs only),
                                  warnings, degraded, partial
```

Design rules embodied in the model:

- every number carries the correlation ID of the call it came from;
- untyped Qloo outputs stay opaque;
- human assumptions (tag choice, exemplars) are explicit fields;
- there is no score field anywhere.

## 13. Preliminary Elasticity Methodology

No weights and no formula. These are the measurable ingredients that appear viable, subject to live gates:

1. **Grounding.** Brand resolved unambiguously (G1). Territory = human-pinned tag + Qloo-returned exemplars (G2).
2. **Coherence ingredients.** Brand tag profile vs. territory tag profile: shared tags, overlap on top-N lists, affinity of shared tags (G3, G6).
3. **Adjacency ingredients.** Affinity of territory entities to the brand in one call. `compare_audiences` fields, if G4 shows documented quantitative semantics.
4. **Relative stretch.** Single-call rank of territory exemplars against the brand. Ordinal positions are safer than raw affinities (G5).
5. **Bridge ingredients.** Joint and shared tags, reported as named cultural signals for the agent to interpret (G6).
6. **Momentum context.** Entity trends, as context rather than a scored dimension.

Methodological rules carried forward:

- ordinal comparisons within one call only;
- every ingredient is shown alongside the score that later combines them;
- the deterministic engine computes, and the LLM only interprets.

## 14. Limitations

1. **Live validation was not run.** Every live behaviour is unverified (the list is printed by `pnpm feasibility:qloo`).
2. **No graph distance or paths** in Qloo [contract].
3. **Affinity is query-relative.** There is no cross-call comparability [contract for rank, harness for all].
4. **Territories are constructed.** Tag choice and exemplar choice are judgement calls that drive results. The tag auto-selection is a placeholder that requires human confirmation.
5. **Untyped outputs:** `compare_audiences`, `audience_demographics`, `trends` [harness].
6. **Top-20 caps** on every list workflow [contract], so overlap measures are computed on truncated lists.
7. **The 10-entity cap** on signal groups, options and joint-tag inputs [contract].
8. **Joint-tag asymmetry** (1 brand vs. N exemplars).
9. **Ranking single exemplars** conflates the exemplar with the territory.
10. **No confidence values anywhere.** Resolution is exact, ambiguous or not found [harness].
11. **Harness preview status.** The result schema is `1.0-preview.1`, and the contract may change. The client pins the schema version and checksum and rejects mismatches.
12. **Runtime weight.** The harness ships a full agent runtime (the backend container is 529 MB).

## 15. Qloo Necessity Assessment

**Would this concept materially weaken without Qloo? Yes.** Without Qloo, every dimension would be one of two things:

- **LLM judgement:** an LLM's opinion of whether Jacquemus "fits" hospitality. This is unfalsifiable, non-reproducible and exactly what AGENTS.md forbids for core scores.
- **Hand-built proxies:** social listening and co-mention scraping. These are out of scope, slow, and noisy.

Qloo uniquely provides cross-domain affinity (fashion brand → hotels, ceramics brands, gaming hardware) from one consistent taste graph, with stable IDs and provenance. That is the only reason the core question can be answered with *measured* rather than *asserted* evidence.

The contract findings narrow the claim, but do not remove the dependence: Qloo supplies association evidence, not distances.

## 16. Architecture Recommendation

- **Keep the hybrid workflow-agent design**, with one change in emphasis: **deterministic evidence collection is a fixed workflow**, not agent free-play. Sprint 0's `runFeasibility` is the prototype of that workflow. The agent, later, chooses *which* territories and exemplars to investigate and interprets the packet. It never produces numbers.
- **Transport:** keep `QlooTransport` as the seam.
  - `qloo exec` (implemented) suits batch and CLI collection.
  - For the backend service and agent runtime, add a **`qloo mcp` stdio transport** (same envelope, long-lived process, no per-call spawn cost).
  - Both run only in a container-capable backend.
- **Never call Qloo from the frontend**, and never assume serverless compatibility for the harness process.
- **Contracts:**
  - promote `OpaqueEvidence` fields to typed contracts **only after** live responses are recorded;
  - store sanitized live packets under `evals/fixtures/live/` as regression evidence.

## 17. Go / Conditional-Go / No-Go

**CONDITIONAL GO.** Viable at the contract level, unverified against live Qloo.

| Gate | Requirement (checked automatically by `pnpm feasibility:qloo`) | If it fails |
| --- | --- | --- |
| **G1** | Jacquemus resolves unambiguously to a brand entity | **NO-GO** for this test case (choose a different hero brand) |
| **G2** | A hospitality tag exists and yields ≥5 place exemplars | **NO-GO** for this territory (re-scope the target) |
| **G3** | Jacquemus has ≥10 tags with numeric affinity | **NO-GO**: no profile evidence, so coherence is unsupported |
| G4 | `compare_audiences` returns numeric fields | Audience Adjacency falls back to brand-conditioned affinity |
| G5 | One rank call returns affinity for ≥4 exemplars | The ranking design needs rework |
| G6 | Brand + territory joint tags are non-empty | Bridge Strength is unsupported |

G1–G3 passing → **GO**. Any of G1–G3 failing → **NO-GO** as currently scoped. G4–G6 decide which dimensions survive.

## 18. Sprint 1 Recommendation

**Exact next task:** obtain the hackathon credential and run `pnpm feasibility:qloo` live. Then:

1. Evaluate gates G1–G6 and update §1 and §17 of this document with **[live]** findings.
2. Review the hospitality tag candidates and **pin** the target tag in `backend/src/feasibility/config.ts`. Re-run.
3. Record the real `compare_audiences`, `audience_demographics` and `trends` output shapes. Replace their `OpaqueEvidence` with typed contracts and add normalizer tests against the recorded (sanitized) payloads.
4. Commit the reviewed, sanitized packet to `evals/fixtures/live/`.

Only after G1–G3 pass: implement the deterministic **ingredient calculator**. This is a pure function from `EvidencePacket` to named, ordinal, single-call-scoped ingredients, without weights or a composite score.
