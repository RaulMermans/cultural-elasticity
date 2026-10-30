# Methodology

## Current methodology (Sprint 12 onward)

A completed investigation answers two separate questions, both computed by deterministic, tested code. The model never produces or adjusts either.

**1. Evidence assessment: what did Qloo show directly?** `evidence-assessment/v1` ([`packages/shared/src/evidence-assessment.ts`](../../packages/shared/src/evidence-assessment.ts)) is one projection of a stored result. The workspace, the HTML/PDF report, the decision card and the evaluations all call it, so they tell the same story. Its outcomes are evidence categories, never calibrated strengths:

| Outcome | Rule (applied in this order) |
| --- | --- |
| Investigation incomplete | The run or this territory did not finish |
| Not testable as asked | No Qloo concept anchors the territory, or only a related-but-different concept does |
| Established cultural association | Qloo categorises the brand as the concept, or the concept is on the brand's profile **and** a brand-conditioned query returned entities |
| Observed association worth examining | One direct observation: the concept is on the brand's profile, or validated brand-conditioned examples share a non-tautological signal with the brand |
| No support found in the scope tested | The brand-conditioned query answered cleanly with nothing and the concept is not on the brand's profile; never proof of no relationship |
| Limited evidence | Some evidence, not enough for any of the above |

A returned-entity count is never read as affinity strength, and absent evidence is never read as a negative fit. A compound question keeps one assessment per concept.

**2. Comparative measurement: where does the territory place?** This only applies when a semantically valid comparison set of at least three Qloo-measurable territories of one entity type exists. Position is the median rank percentile across one-call, brand-conditioned rank panels; robustness is the spread across exemplar panels; the class (*Natural fit*, *Credible stretch*, *Cultural break*, or *Not settled* when robustness is LOW or INSUFFICIENT) uses the provisional 0.8 / 0.2 thresholds in [`classification.ts`](../../backend/src/methodology/classification.ts). Without a valid set, the result is "Not established comparatively".

**The decision card** (`decision-card/v2`, [`packages/shared/src/decision-card.ts`](../../packages/shared/src/decision-card.ts)) projects both into a conclusion, the evidence measurement, the strategic meaning (interpretation, labelled as reasoning rather than evidence) and next research actions. Named comparisons come only from references the server validated for that question.

The rest of this page records how the methodology got here.

**Status at Sprint 2 (historical):** Cultural Elasticity Methodology v0 (`elasticity-v0.1`) exists and is deterministic. It reports **relative position, representation robustness, cultural coherence (RAW and operational-filtered) and a PROVISIONAL classification** per territory. The **0–100 Relative Elasticity Index was REJECTED FOR NOW**: its gate failed on live evidence because territory order changes when exemplars are swapped. Full method, live results and limitations: [../sprint-2/CULTURAL_ELASTICITY_METHODOLOGY.md](../sprint-2/CULTURAL_ELASTICITY_METHODOLOGY.md).

## How the methodology evolved

| Stage | What we believed | What changed it |
| --- | --- | --- |
| Initial concept | A 0–100 Elasticity Score combining Cultural Distance, Coherence, Novelty, Audience Adjacency, Bridge Strength and Momentum | — |
| Sprint 0A (contract only, no credential) | Most dimensions looked feasible at contract level; graph distance and independent novelty did not | The harness contract: no distance or path endpoint |
| Sprint 0B (live) | CONDITIONAL GO. Tag affinities saturated, operational tag noise, undocumented audience and trend fields, noisy bridges. Same-call rank order and brand-conditioned territory lists repeatable and discriminating. One exemplar per territory too fragile | Live hackathon-API evidence ([feasibility report](../sprint-0/QLOO_TECHNICAL_FEASIBILITY.md#methodology-inputs-approved-for-sprint-2)) |
| Sprint 1 | Deterministic ingredients, no formula | Built before live access; ran unchanged on live data ([evidence core](../sprint-1/CULTURAL_EVIDENCE_CORE.md)) |
| **Sprint 2** | Rank-only multi-exemplar panels as the quantitative core; tags set-only as explanation; Novelty, Momentum, Audience and Bridge dimensions dropped; index rejected after a gate on a 6-brand live benchmark | 96 live calls, 57 pairwise benchmark assertions (51 correct, 24/29 held-out), index gate FAIL (Kendall τ across exemplar panels below 0.6 for 6/6 brands) |
| Sprints 3–5 | An agent chooses what to investigate; code computes every number | Live runs: a semantic comparison validator so a structurally valid FULL result is not accepted when its references are meaningless ([5A](../sprint-5a/HAIKU_AGENT_RELIABILITY.md)) |
| Sprints 9N–10D | Measurement-first feasibility: state whether a comparison can still be completed before spending on it | Live L1–L4 (10D): honest partial results, one misleading relative reading from a material-tag anchor, fixed ([10D](../sprint-10d/FINAL_RESEARCH_INTELLIGENCE_AND_RELEASE.md)) |
| Sprint 11 | Research policy v1: the question decides the route (direct evidence, comparison or exploration) | Offline; pre-registered paired live evaluation not yet run ([11](../sprint-11/RESEARCH_INTELLIGENCE_UPGRADE.md)) |
| **Sprint 12** | A result without a ranked position still has a direct-evidence answer: `evidence-assessment/v1` | Replay of stored live results: "Not measured" leads went from 8 to 0 ([12](../sprint-12/MEASUREMENT_AND_RESEARCH_COMPLETION.md)) |

The Sprint 0B status text below is kept for history.

> *Sprint 0B (historical):* live validation complete: **CONDITIONAL GO** on live hackathon-API evidence (2026-10-16). There are still no weights, no formula and no Elasticity Score. Sprint 2 defines them, using only the inputs approved in the feasibility report. The deterministic ingredients exist (Sprint 1) and ran unchanged on the first live packet. They are still not combined.

## Principles

1. **Evidence before formula.** Every ingredient must come from a Qloo workflow whose output has been observed live and typed.
2. **Same-call comparability.** Qloo affinities have no documented scale and are query-relative. Only numbers from one call (same correlation id) are compared, or rank-based transforms of them.
3. **Explicit representation.** A territory is a human-pinned Qloo tag plus human-reviewed, Qloo-filtered exemplar entities, recorded in the evidence packet and disclosed as a derived representation.
4. **Several exemplars per territory.** Live data showed that mid-table conclusions change with the exemplar. Report the spread; never let one exemplar stand for a territory alone.
5. **Honest naming.** Use "Cultural Distance Proxy" (Qloo has no graph distance: `REAL_GRAPH_DISTANCE_UNAVAILABLE`) and "Qloo-supported intermediate cultural signals" (Qloo has no paths).
6. **Deterministic computation, LLM interpretation.** Code computes ingredients. The agent explains them.

## Ingredients after live validation (Sprint 0B)

| Ingredient | Qloo source | Live status | Use |
| --- | --- | --- | --- |
| Brand-relative candidate order | `rank` (one call, ≤ 6 options observed safe) | discriminating (0.56–0.86), repeatable | **quantitative, within call** |
| Brand-conditioned territory entities | `recommend` (signal = brand, filter = territory tag) | coherent, repeatable | **within call; descriptive support** for the territory representation (Sprint 2: `EvidencePacket.conditionedEntities`) |
| Related entities | `recommend` same type | high face validity | context, mutual-neighbour checks |
| Tag-set overlap and top-N stability | `entity_tags` at fixed take = 20 | saturated values, operational noise, truncation-sensitive | **set-only, descriptive**; separate operational namespaces |
| Joint tags, mutually related entities | `entity_tags` (joint), `recommend` × 2 | noisy; 0 mutual neighbours | **qualitative only** |
| Demographic skew | `audience_demographics` | direction documented only | qualitative context |
| Audience comparison fields | `compare_audiences` | undocumented | **not used** |
| Momentum | `trends` | flat, undocumented | **not used** |

**Dropped as an independent dimension:** Novelty (confirmed live: there is no independent signal).

## Sprint 2 methodology in one table

| Output | Computed from | Never |
| --- | --- | --- |
| Relative position | Median over panels of the rank percentile `(n − rank)/(n − 1)` in one-call rank panels (one exemplar per territory, ≤ 6 options) | cross-call values, averages of affinities |
| Representation robustness | Percentile spread across panels (HIGH ≤ 0.2, MEDIUM ≤ 0.4); INSUFFICIENT under 2 exemplars; LOW cap when declared evidence is missing | a probability |
| Cultural coherence | Set overlap of `take = 20` tag profiles, RAW and `operational-tags-v1` filtered | tag-affinity weights; input to classification |
| Evidence quality | Sprint 1 core, per exemplar packet | merged with robustness |
| Classification | Position + robustness + quality; thresholds 0.8 / 0.2 PROVISIONAL | coherence; absolute claims |
| Relative Elasticity Index | **Rejected for now** (gate B and C failed on live data) | shown when the gate fails |
