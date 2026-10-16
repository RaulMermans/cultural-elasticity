# Cultural Elasticity Methodology v0

Sprint 2 · methodology version **`elasticity-v0.1`** · evidence captured live from `https://hackathon.api.qloo.com` on 2026-10-16

> **Decision: RELATIVE ELASTICITY INDEX REJECTED FOR NOW.** The product reports **relative position + representation robustness + cultural coherence + classification**, never a 0–100 number. The index gate failed for 6 of 6 benchmark brands because territory order changes when exemplars are swapped (§12).

Evidence labels in this document:

- **[live]** means the 2026-10-16 Sprint 2 capture (96 calls, all `ok`), persisted as sanitized fixtures in `evals/benchmarks/cultural-elasticity-v0/evidence/`.
- **[live-0B]** means a Sprint 0B run.
- **[benchmark]** means human-curated labels. They are not truth.

Reproduce every number here offline with `pnpm eval:elasticity` and `pnpm methodology:jacquemus`.

## 1. Question Being Measured

> How far can a brand stretch into a new category, experience, partnership or cultural territory before it stops feeling authentically like itself?

v0 answers a narrower, measurable version:

> Given brand B and candidate territories T1…Tn, what does Qloo evidence let us say about each territory's **relative cultural proximity** to B within this candidate set, how **robust** that is to the choice of territory exemplars, which **cultural signals** B and the territory share, and how **trustworthy** the evidence is?

## 2. What Cultural Elasticity Is

For each territory in a candidate set, the methodology reports four separate dimensions and one derived class:

| Dimension | Meaning | Source |
| --- | --- | --- |
| **Relative position** | Where the territory sits among *this* candidate set for this brand | Same-call `rank` order of territory exemplars for the brand, aggregated over several panels by rank only |
| **Representation robustness** | Whether that position survives swapping the territory's exemplars | Spread of the territory's rank percentile across panels |
| **Cultural coherence** | Which cultural signals the brand and the territory exemplars share | Set membership of `entity_tags` (RAW and operational-filtered) |
| **Evidence quality** | Whether the evidence packet is technically trustworthy and complete | Sprint 1 Cultural Evidence Core, per exemplar packet |
| **Classification** | NATURAL ADJACENCY / CREDIBLE STRETCH / UNCERTAIN (REPRESENTATION-SENSITIVE) / CULTURAL BREAK, *relative to the set* | Position + robustness + quality (PROVISIONAL thresholds) |

Brand-conditioned territory evidence (the entities Qloo returns inside a territory when conditioned on the brand) is shown beside these as qualitative support for the territory representation.

## 3. What Cultural Elasticity Is NOT

- **Not commercial-success prediction.** Nothing here says an extension will sell, succeed or fail.
- **Not consumer intent.** No purchase or adoption likelihood is measured.
- **Not graph distance.** Qloo exposes no network separation, hop count or path (`REAL_GRAPH_DISTANCE_UNAVAILABLE`).
- **Not an individual preference prediction.** Qloo's affinities are aggregate taste signals.
- **Not absolute.** Every position and class is relative to the evaluated candidate set. A "CULTURAL BREAK" means "consistently at the bottom of *this* set", not "impossible".
- Not audience adjacency, bridge strength, novelty or momentum (§4).

The result contract enforces this. It states these exclusions in `semantics.notMeasured`. Its validator rejects fields named confidence, probability, likelihood, score, distance, path, strength, novelty or momentum, and rejects text such as "82% likely to succeed" or "graph distance".

## 4. Live Evidence Constraints

These come from Sprint 0B and were re-observed in Sprint 2. They are architectural facts, not preferences:

| # | Live fact | Methodological consequence |
| --- | --- | --- |
| 1 | No graph distance or path endpoint | No "distance" is claimed. The name Cultural Distance Proxy is reserved and no number is defined (§11) |
| 2 | Brand tag affinities are saturated (Jacquemus top 20: range 0.001, 9 tied at 1) | Tags are used as **sets only**. The methodology strips tag values before analysis |
| 3 | Tag profiles carry venue/operational noise | RAW and CULTURAL_FILTERED views, with a versioned policy (§14) |
| 4 | Tag lists are capped at 20 and tie order depends on `take` | Fixed `take = 20` for every profile, enforced by the input contract |
| 5 | Affinity scale and cross-call comparability are undocumented | No cross-call value comparison, averaging or normalization. Across panels only ranks are compared |
| 6 | One rank call is repeatable and discriminating | Same-call order is the quantitative core. **[live]** 6/6 repeat panels were identical, and the Jacquemus primary panel gave the same order in three Sprint 0B runs and in the Sprint 2 capture |
| 7 | One exemplar per territory is fragile | ≥ 2 exemplars per territory and several panels (§5–6). Single-exemplar territories get INSUFFICIENT robustness |
| 8 | Audience comparison fields are undocumented | No audience number. Audience data cannot enter the methodology input at all |
| 9 | Bridge evidence is noisy | No bridge number. Bridges cannot enter the methodology input |
| 10 | No independent novelty signal | No Novelty dimension |
| 11 | Trends are flat and undocumented | No Momentum dimension |
| 12 | Brand-conditioned territory lists are coherent and repeatable | New canonical evidence slot (§10) |
| 13 | ≤ 6 rank options are safe; 10 were rate-limited | Panels hold ≤ 6 candidates, so the comparison set is 2–6 territories |

**[live] Observation recorded, not used:** 53 of 53 (brand, entity) pairs observed in more than one call carried *identical* affinity, including entities seen in both a rank panel and a conditioned list. Affinity may be a per-(signal, entity) quantity. Qloo does not document this, so v0 still compares values only within a call. Confirming it with Qloo is a Sprint 3 question (§23).

## 5. Territory Representation

A `TerritoryRepresentation` (in `backend/src/methodology/contracts.ts`) holds:

- a semantic label;
- a pinned Qloo concept (tag);
- exactly one primary exemplar and zero or more alternates (preferred: ≥ 2 exemplars in total);
- rejected exemplars with reasons;
- assumptions and approximation warnings;
- provenance.

An exemplar can represent only one territory. A brand cannot represent a territory.

Exemplars were pinned by a human from category knowledge after live resolution. They were **not** taken from brand-conditioned lists, so no benchmark brand shaped its own panel. For example, Villeroy & Boch was rejected for Ceramics because it first surfaced in a Jacquemus-conditioned list. The pins live in `backend/src/capture/elasticity-config.ts`.

| Territory | Concept (conditioned query filter) | Exemplars (panel A / B / C) | Main approximation |
| --- | --- | --- | --- |
| Boutique Hospitality | `urn:tag:interests:qloo:boutique_hospitality` (places) | Ace Hotel / The Hoxton / Soho House | conditioned list returns hotel *places*; exemplars are hotel *brands* |
| Ceramics | `urn:tag:industry:qloo:ceramics` | Heath Ceramics / Royal Copenhagen / Wedgwood | craft studio mixed with heritage porcelain; Royal Copenhagen's tag profile looks conflated |
| Furniture | `urn:tag:industry:qloo:furniture` | HAY / VITRA / MUUTO | means *design* furniture |
| Sailing / marine lifestyle | `urn:tag:customer_segment:qloo:sailors` | Helly Hansen / Sebago / Sperry | no sailing-equipment brand resolvable; two boat-shoe brands; **weak proxy** |
| Wellness | `urn:tag:industry:qloo:wellness` | Six Senses / Aesop / Goop | heterogeneous; Six Senses confounds wellness with hospitality |
| Gaming Hardware | `urn:tag:industry:qloo:gaming_hardware` | Razer / Steel Series / Corsair | none |

Resolution gaps **[live]**: North Sails, Henri Lloyd and Astier de Villatte exist only as place stores. Musto, Gill, Zhik, Mama Shelter, East Fork, Hasami Porcelain and Mud Australia did not resolve. Slam resolved, but its tags mix sailing with hip-hop/rap (likely entity conflation), so it was rejected. Interest-namespace tags for ceramics, furniture, sailing and gaming returned **no brands** as filters, which is why industry and segment tags are used.

Three of the six concepts (furniture, sailing, wellness) were not in the top 10 of a tag search for their label in this capture (`CONCEPT_NOT_CONFIRMED`, disclosed). They were pinned because they filtered the conditioned query successfully during exploration.

## 6. Multi-Exemplar Panels

A **panel** is **one `rank` call**: options = one exemplar per territory (six options), signal = the brand. Inside a panel the order is valid, and raw values may be shown, labelled within-call. Each brand has:

| Panel | Purpose | Exemplars |
| --- | --- | --- |
| A | primary | exemplar 1 of every territory |
| A-repeat | determinism check (never aggregated) | identical to A |
| B | alternate | exemplar 2 of every territory |
| C | alternate | exemplar 3 of every territory |

The input contract enforces the structure:

- every panel covers every territory exactly once;
- ranked candidates must be exactly the assigned exemplars;
- the panel is ranked for the brand;
- a repeat panel must repeat its original's assignments.

A panel is used only when its single-call scope is verified (every candidate has the same correlation id) and every candidate has an explicit rank. Otherwise it is reported as `missing`, `scope_unverified` or `unranked`. The panel's evidence then counts as missing (§8).

**[live] Jacquemus panels:**

| Panel | Correlation id | Order |
| --- | --- | --- |
| A | `exec-2c290276-ea57-4d0e-8c3d-ea718b9187ab` | HAY > Ace Hotel > Heath Ceramics > Six Senses > Razer > Helly Hansen |
| A-repeat | `exec-3f24d5f4-5b78-4040-9b7c-ccd153c1d449` | identical |
| B | `exec-68df5bf5-fcf4-4010-ae96-491cd80f15b2` | Aesop > The Hoxton > VITRA > Sebago > Royal Copenhagen > Steel Series |
| C | `exec-0aa38abc-9dde-4b43-a8eb-e866c8672d0a` | Soho House > Goop > Wedgwood > MUUTO > Sperry > Corsair |

Panel A is the same order Sprint 0B observed in all three of its runs.

## 7. Ordinal Aggregation

**Chosen: median panel percentile.** For territory *t* in panel *p* with *n* options, the percentile is

`(n − rank) / (n − 1)`

where 1 is the top of the panel and 0 the bottom. The territory's central ordinal position is the **median over aggregated panels**. Relative position is the competition rank of that median among the territories; ties share a position. Dispersion is reported separately as robustness and never folded into the position. Pairwise wins/losses per shared panel are reported as supporting evidence and used only to order tied territories for display.

All values are rounded to 6 decimals so threshold tests are exact. Raw affinities never enter aggregation.

| Alternative | Why not chosen |
| --- | --- |
| Mean percentile / Borda count | One outlying exemplar drags the mean; equivalent to Borda for equal-size panels |
| Pairwise win rate (Copeland) | Defensible, but ties are frequent with 2–3 panels and it is harder to explain; kept as supporting evidence |
| Kemeny consensus ranking | Optimal in theory, opaque in practice (NP-hard, no per-territory explanation) |
| Cross-panel affinity average | Forbidden (§4.5) |

The median uses ranks only. It resists one bad exemplar when there are three panels, keeps dispersion visible next to the position, is deterministic, and fits in one sentence for a judge.

## 8. Representation Robustness

Rule-based, a priori, not tuned on the benchmark (`ROBUSTNESS_POLICY`):

| Level | Rule |
| --- | --- |
| INSUFFICIENT | fewer than 2 distinct exemplars with valid panel evidence (substitution cannot be tested) |
| LOW (cap) | any declared exemplar or declared panel lacks valid evidence. Missing evidence could have placed the territory anywhere, so it is never assumed favourable |
| HIGH | percentile spread ≤ 0.2 (moves at most one place in a 6-option panel) |
| MEDIUM | spread ≤ 0.4 (at most two places) |
| LOW | otherwise |

Reported with it: declared vs panelled exemplars, best and worst rank, rank spread, percentile spread, and direction consistency (whether all observations fall on one side of the midpoint).

The cap means that **removing an exemplar's evidence never improves robustness**. A seeded property test checks this over 120 random inputs. A known alternate that is never panelled caps the territory at LOW, so one exemplar cannot silently represent a territory.

**[live] Results (36 brand × territory cases):** HIGH 16, MEDIUM 10, LOW 10, INSUFFICIENT 0.

Every LOW case comes from a real exemplar swap. Examples: Jacquemus × Furniture (HAY 1/6, VITRA 3/6, MUUTO 4/6) and Jacquemus × Wellness (Six Senses 4/6, Aesop 1/6, Goop 2/6). Wellness is LOW for 5 of 6 brands, which is consistent with its heterogeneous exemplars.

Evidence quality and robustness are independent. All 36 cases have evidence quality MEDIUM, while robustness ranges from LOW to HIGH.

## 9. Cultural Coherence

Coherence is computed per exemplar (brand vs that exemplar, both at `take = 20`), then summarized across the territory's exemplars:

- per exemplar: counts, shared, union, Jaccard, overlap coefficient, shared / brand-only / target-only signals;
- summary: min, median and max shared count, median Jaccard, and the signals shared with at least half the exemplars;
- a **descriptive** band from the median shared count (0 NONE, 1–2 SPARSE, 3–5 SOME, ≥ 6 SUBSTANTIAL). The band is not calibrated.

Coherence is **explanatory**. It is not an input to classification, so the rank evidence and the tag overlap are never counted twice. Tag affinity is never a weight: the methodology passes set-only profiles to the core, and a test shows that rewriting every tag value changes nothing.

### Raw

Jacquemus × Boutique Hospitality: median **5** shared raw signals (SOME), the same figure as Sprint 0B's derived-profile overlap.

### Operational-Filtered

Jacquemus × Boutique Hospitality: median **2** shared after filtering (SPARSE).

| Exemplar | Raw shared | Kept after filtering |
| --- | --- | --- |
| Ace Hotel | 3 | 1: electronic |
| Soho House | 5 | 2: electronic, Model |
| The Hoxton | 7 | 3: electronic, france, paris france |

Expensive, Five Star, French (restaurant venue category) and "Identifies as women-owned" were removed.

**[live] Filter effect over 108 brand × exemplar pairs:**

| Effect | Pairs | Example |
| --- | --- | --- |
| Overlap reduced | 90 | Jacquemus × Aesop 7 → 2; Lululemon × Goop 6 → 1 (Expensive, Discover, Restaurant, women-owned badge, Salad removed) |
| Unchanged (all shared signals cultural) | 7 non-zero (18 incl. zero) | Muji × Steel Series 2 → 2 (anime animation, based on manga); Alienware × Ace Hotel 1 → 1 (electronic) |
| **Relationship was entirely operational** | 42 | Jacquemus × Sebago 3 → 0 (Expensive, VISA, Five Star); Alienware × Royal Copenhagen 1 → 0 (Three Star) |

Diagnostic only (not used anywhere): across the 36 cases, the Spearman correlation between median panel percentile and median shared count is **0.39 raw** and **0.12 filtered**. Part of the raw tag overlap that moved with position was venue metadata.

## 10. Brand-Conditioned Territory Evidence

**New canonical slot:** `EvidencePacket.conditionedEntities` (schema `ce-evidence/0.2`; 0.1 packets remain valid and cannot carry it). Each item is `ConditionedEntityEvidence`:

```
{ conditionedOn {id,label}, territory {id,label}, entityType?, requestedLimit?, truncated?,
  entities [{ id, label, rank, numeric? (within_call only), provenance }],
  comparisonScope: "single_call", provenance }
```

Rules enforced in code:

- values must be `within_call` with no scale;
- ranks and ids are unique;
- the single-call scope is verified against correlation ids;
- an observed empty list is valid only with provenance, so it is never confused with "not collected";
- missing evidence is `null` plus `CONDITIONED_NOT_COLLECTED`, never zero.

Normalization sorts entities by rank. Evidence quality adds a `conditionedEvidence` indicator; its absence never lowers quality. The core reports a descriptive view: count, support (SUPPORTED ≥ 5 / SPARSE 1–4 / EMPTY), top entities, and within-call value range and top-five gap. Nothing is compared across territories or calls.

The live adapter (`conditionedEntitiesFromRecommend`) maps `recommend` (signal = brand, `include_tags` = territory concept). The Sprint 0B investigation now writes this slot into its packet (`evals/fixtures/live/jacquemus-boutique-hospitality.live.json`, re-captured 2026-10-16T12:02Z).

**[live] What it shows:**

- 30 of 36 lists are SUPPORTED. The lists are clearly brand-specific. Furniture: Jacquemus → CARAVANE, Fritz Hansen, VITRA; Muji → Niko And…, Nitori, IKEA; Patagonia → Article, Joybird; Lululemon → Pottery Barn, Crate & Barrel. Hospitality: Jacquemus → Parisian boutique hotels (Hôtel Mansart, Hôtel Splendor); Muji → House of Finn Juhl Hakuba, Hotel Karuizawa Cross.
- All 6 SPARSE lists are Sailing: one entity (Vuarnet) for every brand. Few brands carry the sailors segment tag, which is independent evidence that the Sailing representation is weak.
- Declared exemplars appear in Qloo's own conditioned list in 9 lists (Gaming for all brands; Furniture for Jacquemus, Muji and Nintendo). This is a face-validity check of the representation.

Conditioned evidence is not a score dimension. It is shown per territory as support for (or a warning against) the representation.

## 11. Cultural Distance Proxy

**Retained as a name, rejected as a number for v0.** No formula combines tag overlap, rank and conditioned evidence into a distance. Relative position is the only proximity measure, and it is named for what it is. The Sprint 1 `DistanceProxyIngredients.formula` stays `NOT_DEFINED`. The result carries `NO_CULTURAL_DISTANCE_NUMBER` and states in `notMeasured` that no network separation exists in Qloo.

## 12. Relative Elasticity Index

**Decision: REJECTED FOR NOW.**

Candidate studied: `round(100 × median panel percentile)`. Semantics: relative candidate position (100 = top of every panel, 0 = bottom). It would always carry its `comparisonSet` and `NOT_A_PROBABILITY: true`. It is monotonic by construction and reconstructable from ranks.

**Gate** (`relative-index.ts`, thresholds fixed a priori):

| Check | Requirement | [live] brands passing |
| --- | --- | --- |
| A | Repeated identical panels give the same order | **6/6** |
| B | Alternate-exemplar panels agree on territory order: every pair Kendall τ ≥ 0.6 (≤ 3 of 15 pairs discordant) | **0/6** (per-brand minimum τ 0.07–0.47) |
| C | Dropping any one panel moves no median by more than one rank step (0.2) | **1/6** (5 brands move a median by 0.3) |
| D | Transform monotonic with rank | 6/6 |
| E | Missing evidence cannot improve the result (simulated exemplar removal) | 6/6 |
| F | Evidence-quality problems stay visible separately | 6/6 |
| G | Result reconstructable from panel rank orders | 6/6 |

A 0–100 number would present exemplar-sensitive orderings with false precision. The product therefore uses **relative position + robustness + coherence + classification**, which shows the sensitivity instead of hiding it.

The machinery stays in place. If `RELATIVE_INDEX_DECISION` were ever APPROVED, an index would appear only for analyses that pass every gate check, and only for territories with robustness ≥ MEDIUM and quality above LOW. Gate details never contain index values. The validator rejects any index that appears without an APPROVED decision and a passing gate. `pnpm eval:elasticity` fails if the decision is APPROVED while the benchmark gate fails.

## 13. Classification Method

Ordered rules (`classification.ts`):

1. **INSUFFICIENT_EVIDENCE**: no valid panel observation, or evidence quality LOW.
2. **UNCERTAIN_REPRESENTATION_SENSITIVE**: robustness INSUFFICIENT or LOW.
3. **NATURAL_ADJACENCY**: median panel percentile ≥ **0.8**.
4. **CULTURAL_BREAK**: median panel percentile ≤ **0.2**.
5. **CREDIBLE_STRETCH**: otherwise (consistently mid-set).

Inputs are position, robustness and quality only. Coherence is not an input. Thresholds are **PROVISIONAL** (§18).

## 14. Operational Tag Policy

`operational-tags-v1` (`operational-tags.ts`) matches the URN namespace and source segment (`urn:tag:<namespace>:<source>:…`). Brand profiles inherit the attributes of the brand's *place listings* (stores, cafés) through `:place` namespaces.

| Rule | Matches | Why excluded |
| --- | --- | --- |
| payment | `credit_card:*` | payment method at a venue (VISA, Discover, JCB) |
| venue_rating | `hotel_rating:*` | star rating of a lodging venue |
| menu_item | `specialty_dish:*` | dish served at a venue (Beetroot Salad, Burger, Vegetarian Ramen) |
| price_descriptor | `cost_description:*` | venue price descriptor (Expensive, Inexpensive) |
| venue_listing_badge | `inclusivity:place` | ownership badge of a listing; on **6/6** brand profiles regardless of culture |
| venue_category | `genre:place` | listing category (Restaurant, Cafe, Tourist attraction, Hotel) |
| venue_facility / venue_offering / venue_service_option | `amenity:place`, `offerings:place`, `service_option:place` | venue facilities and services |

**Reviewed and kept:**

- curated `:qloo` concept namespaces, including `amenity:qloo`, lifestyle, aesthetic, customer segment, industry and `inclusivity:qloo`;
- media, music and person genres;
- media keywords. These are noisy ("based on manga", "japanese drama") but describe taste, not venue operations.

Keeping a signal does not assert that it is meaningful.

**[live] Prevalence on the 6 brand profiles:** payment, price, venue badge, venue category and venue rating each on 6/6; menu item on 4/6. Brands keep 14–15 of 20 tags.

The filter was not tuned for Jacquemus: it *removes* Jacquemus × hospitality overlap (5 → 2). RAW is always kept, and every exclusion is listed with its rule and reason.

## 15. Evidence Quality

Per territory: the worst Cultural Evidence Core overall level across that territory's exemplar packets. Each packet is the brand profile vs the exemplar profile (set-only), the exemplar's panel ranking and the territory's conditioned list. A missing exemplar profile marks that packet MISSING and caps the territory at MEDIUM. LOW quality withholds classification (INSUFFICIENT_EVIDENCE) and would withhold any index.

**[live]** All 36 cases are MEDIUM. The driver is `profileCoverage: limited`, because every tag profile is truncated at 20. This is the expected ceiling for this API.

## 16. Provenance

Every Qloo-derived value keeps `{source: "qloo-hackathon-api", operation, correlationId, capturedAt}`. Panel observations carry their panel's correlation id. Territory provenance is the union of the concept search, exemplar profiles, panel candidates and the conditioned list.

The result carries a compact **trace**: brand → representations → panel calls → ranks → aggregation → robustness → tag filtering → overlap → classification → index decision. Gate check G recomputes every median from the trace's rank orders.

The live fixtures contain no key, headers, raw payloads, addresses, phones or images. `pnpm check:secrets` and `pnpm eval:elasticity` verify this.

## 17. Benchmark

`evals/benchmarks/cultural-elasticity-v0/benchmark.json` contains 6 brands × the same 6 territories = **36 cases**.

Labels are `expected_strong` / `expected_mid` / `expected_weak`, each with a rationale. They are explicitly **human-curated evaluation labels, not objective truth**. They were drafted by the implementing agent from general brand knowledge, and the **project owner should review them**. No label claims historical success.

| Brand | Strong | Mid | Weak (incl. controls) | Labels written |
| --- | --- | --- | --- | --- |
| Jacquemus | Boutique Hospitality | Ceramics, Furniture, Wellness | Sailing, Gaming | after Sprint 0B evidence → **calibration only** |
| Muji | Furniture, Ceramics | Wellness, Hospitality | Sailing, Gaming | blind |
| Alienware | Gaming | — | all five others | blind |
| Patagonia | Sailing | Wellness | Hospitality, Ceramics, Furniture, Gaming | blind |
| Lululemon | Wellness | Sailing, Hospitality | Furniture, Ceramics, Gaming | blind |
| Nintendo | Gaming | Wellness | Hospitality, Ceramics, Furniture, Sailing | blind |

**Pairwise assertions:** every pair with different labels gives "A should rank above B". That yields **57** assertions, 22 of them strong-vs-weak.

## 18. Calibration

The split is **by brand**, fixed before capture and enforced by the schema:

- **calibration:** Jacquemus, Muji, Alienware;
- **held-out:** Patagonia, Lululemon, Nintendo.

A brand whose labels were written after seeing its evidence (Jacquemus) cannot be held out.

Only the classification thresholds are calibrated. The grid is natural ∈ {0.6, 0.7, 0.8} × break ∈ {0.2, 0.3, 0.4}, scored on calibration brands only by class agreement (strong ↔ NATURAL_ADJACENCY, mid ↔ CREDIBLE_STRETCH, weak ↔ CULTURAL_BREAK; UNCERTAIN never agrees). Ties go to the a-priori default (0.8 / 0.2).

**[live]** Natural ≥ 0.7 and ≥ 0.8 tie at 11/18, and 0.6 gives 9/18. The break threshold makes no difference on this data. **Chosen: 0.8 / 0.2 (the default). The data could not separate the candidates, so the thresholds are PROVISIONAL.** `pnpm eval:elasticity` re-derives them and fails if the configured values drift.

Robustness thresholds and gate thresholds were fixed a priori and are not calibrated.

## 19. Evaluation Results

`pnpm eval:elasticity` replays the live fixtures offline. The results describe live evidence; running the eval is not a new live validation.

| Metric | Result |
| --- | --- |
| Pairwise accuracy (all) | **51 / 57 = 0.895** (3 ties, 3 wrong) |
| Calibration brands | 27 / 28 = 0.964 |
| **Held-out brands** | **24 / 29 = 0.828** |
| Strong vs weak | **22 / 22 = 1.000** |
| Repeat determinism | 6 / 6 repeat panels identical |
| Representation-stable territories (HIGH or MEDIUM) | 26 / 36 |
| Insufficient-evidence cases | 0 |
| Unresolved entities | 0 / 24 pinned (6 brands, 18 exemplars) |
| Operational-filter changes | 90 / 108 overlaps reduced; 42 entirely operational |
| Class agreement with labels | calibration 11 / 18, held-out 8 / 18 (UNCERTAIN in 10 / 36 counts as disagreement) |
| Class changes under exemplar substitution (per-panel class differs) | 24 / 36 |
| Index gate | **FAIL** (B 0/6, C 1/6) |

**Pairwise misses:**

- Jacquemus: Hospitality = Wellness (tie at 0.8).
- Lululemon: Hospitality = Ceramics (tie).
- Lululemon: Sailing (1.0) above Wellness (0.8). Both are LOW robustness; the Sailing exemplars are outdoor and boat-shoe brands, so this may be outdoor-apparel proximity.
- Nintendo: Wellness (0.2) below Ceramics and Furniture (0.6), and tied with Sailing. The wellness exemplars are luxury resort, skincare and lifestyle media, which a fitness-game rationale does not anticipate. The label may be wrong, or the representation may not match it.

Per-brand order (median percentile, robustness, class):

| Brand | Order |
| --- | --- |
| Alienware | Gaming 1.0 HIGH NA · Sailing 0.6 MEDIUM CS · Wellness 0.6 LOW U · Hospitality 0.4 LOW U · Ceramics 0.2 MEDIUM CB · Furniture 0 LOW U |
| Jacquemus | Hospitality 0.8 HIGH NA · Wellness 0.8 LOW U · Furniture 0.6 LOW U · Ceramics 0.6 MEDIUM CS · Sailing 0.2 MEDIUM CB · Gaming 0 HIGH CB |
| Lululemon | Sailing 1.0 LOW U · Wellness 0.8 LOW U · Hospitality 0.6 HIGH CS · Ceramics 0.6 MEDIUM CS · Furniture 0.2 HIGH CB · Gaming 0 HIGH CB |
| Muji | Furniture 0.8 HIGH NA · Ceramics 0.8 MEDIUM NA · Hospitality 0.6 HIGH CS · Wellness 0.4 LOW U · Sailing 0.2 HIGH CB · Gaming 0 HIGH CB |
| Nintendo | Gaming 1.0 HIGH NA · Furniture 0.6 HIGH CS · Ceramics 0.6 MEDIUM CS · Sailing 0.2 LOW U · Wellness 0.2 MEDIUM CB · Hospitality 0 MEDIUM CB |
| Patagonia | Sailing 1.0 HIGH NA · Wellness 0.8 LOW U · Hospitality 0.6 HIGH CS · Furniture 0.4 HIGH CS · Ceramics 0.2 MEDIUM CB · Gaming 0 HIGH CB |

(NA natural adjacency, CS credible stretch, U uncertain / representation-sensitive, CB cultural break.)

**First methodology result, Jacquemus** (`pnpm methodology:jacquemus`):

| Territory | Position | Robustness | Coherence raw → filtered | Conditioned | Class |
| --- | --- | --- | --- | --- | --- |
| Boutique Hospitality | 1 / 6 (tied) | HIGH: Ace 2/6, Hoxton 2/6, Soho House 1/6 | 5 → 2 | SUPPORTED: Hôtel Mansart, Hôtel Splendor, Grands Boulevards | **NATURAL ADJACENCY** |
| Wellness | 1 / 6 (tied) | LOW: Six Senses 4/6, Aesop 1/6, Goop 2/6 | 4 → 2 | SUPPORTED: Sporty & Rich, Glossy, Aman | **UNCERTAIN** |
| Furniture | 3 / 6 (tied) | LOW: HAY 1/6, VITRA 3/6, MUUTO 4/6 | 5 → 1 | SUPPORTED: CARAVANE, Fritz Hansen, VITRA | **UNCERTAIN** |
| Ceramics | 3 / 6 (tied) | MEDIUM: 3/6, 5/6, 3/6 | 4 → 1 | SUPPORTED (8) | **CREDIBLE STRETCH** |
| Sailing / marine | 5 / 6 | MEDIUM: 6/6, 4/6, 5/6 | 2 → 0 | SPARSE (Vuarnet) | **CULTURAL BREAK** |
| Gaming Hardware | 6 / 6 | HIGH: 5/6, 6/6, 6/6 | 2 → 1 | SUPPORTED; Razer #1 | **CULTURAL BREAK** |

## 20. Limitations

- **Relative only.** Positions and classes change if the candidate set changes. There is no absolute anchor.
- **Exemplar dependence remains the dominant uncertainty.** 10/36 territories are representation-sensitive, and the index gate fails on ordinal instability.
- **Representations are human judgements.** Sailing is a weak proxy. Wellness is heterogeneous. Redeclaring a territory with fewer exemplars changes its representation; this is disclosed and versioned, not detected.
- **Tag profiles are truncated at 20** and set-only. Coherence is descriptive.
- **Benchmark is small** (6 brands, 57 assertions). The labels were drafted by the implementing agent and need human review. Accuracy figures have wide uncertainty; no confidence interval is claimed.
- **Thresholds are provisional.** Calibration could not separate 0.7 from 0.8.
- **Robustness thresholds assume 6-option panels.** With fewer territories, one rank step is a larger percentile move.
- Concepts for furniture, sailing and wellness were not re-confirmed by tag search in this capture.
- Live values can change between captures. The regression test locks elasticity-v0.1 on the 2026-10-16 capture.

## 21. Why Qloo Is Necessary

| Capability | Without Qloo |
| --- | --- |
| Same-call rank order of territory exemplars for a brand | **Lost.** Repeatable (6/6 repeats identical; the Jacquemus primary panel is identical across four separate runs) and discriminating. It produced 51/57 correct orderings, 24/29 on blind held-out brands and 22/22 strong-vs-weak. An LLM can guess an order, but not one that is reproducible, provenance-bearing and checkable by a gate |
| Brand-conditioned territory entities | **Lost.** Brand-specific lists (IKEA/Nitori for Muji, CARAVANE/Fritz Hansen for Jacquemus) with correlation ids, and an independent signal that the Sailing representation is weak |
| Entity resolution | **Lost.** Brand vs store vs person disambiguation, and stable ids |
| Tag sets | Partly replaceable. After filtering, the cultural subset is small and an LLM could approximate it |

The methodology therefore centres on Qloo's same-call entity evidence and treats tags as explanation.

## 22. Methodology Version

`METHODOLOGY_VERSION = "elasticity-v0.1"` (`backend/src/methodology/config.ts`). It covers:

- operational filter `operational-tags-v1`;
- median panel percentile aggregation;
- `ROBUSTNESS_POLICY` (0.2 / 0.4 with caps);
- classification thresholds 0.8 / 0.2 (PROVISIONAL);
- index decision REJECTED_FOR_NOW.

Any change that alters output meaning must bump the version. The live regression test (`methodology-live-regression.test.ts`) fails when output changes. Related schema versions: `ce-evidence/0.2`, `ce-ingredients/0.2`, `ce-methodology-input/0.1`, `ce-elasticity-result/0.1`.

## 23. Sprint 3 Readiness

**Ready:**

- a deterministic, tested `CulturalElasticityResult` with explicit semantics, limitations and a trace;
- `POST /api/methodology/analyze`;
- a live capture path (`pnpm capture:elasticity`) that turns pinned representations into methodology input;
- `/dev/methodology` for inspection.

An agent can choose which territories and exemplars to investigate and explain a result from its trace. It cannot produce or adjust any number.

**Open questions for Sprint 3:**

1. Ask Qloo whether affinity is a per-(signal, entity) quantity. 53/53 repeated observations were identical across calls. If Qloo confirms it, a documented cross-call value comparison could be revisited.
2. Agent-assisted territory representation: propose exemplars from category knowledge and validate them with Qloo resolution and conditioned lists, without letting the brand pick its own exemplars.
3. Human review of the benchmark labels. Grow to more brands, and to territories whose exemplars agree, before revisiting the index gate.
4. Stronger Sailing and Wellness representations (Sailing is SPARSE in every conditioned list).
