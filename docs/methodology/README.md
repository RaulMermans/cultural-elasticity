# Methodology

**Status (Sprint 2):** Cultural Elasticity Methodology v0 (`elasticity-v0.1`) exists and is deterministic. It reports **relative position, representation robustness, cultural coherence (RAW and operational-filtered) and a PROVISIONAL classification** per territory. The **0–100 Relative Elasticity Index was REJECTED FOR NOW**: its gate failed on live evidence because territory order changes when exemplars are swapped. Full method, live results and limitations: [../sprint-2/CULTURAL_ELASTICITY_METHODOLOGY.md](../sprint-2/CULTURAL_ELASTICITY_METHODOLOGY.md).

## How the methodology evolved

| Stage | What we believed | What changed it |
| --- | --- | --- |
| Initial concept | A 0–100 Elasticity Score combining Cultural Distance, Coherence, Novelty, Audience Adjacency, Bridge Strength and Momentum | — |
| Sprint 0A (contract only, no credential) | Most dimensions looked feasible at contract level; graph distance and independent novelty did not | The harness contract: no distance or path endpoint |
| Sprint 0B (live) | CONDITIONAL GO. Tag affinities saturated, operational tag noise, undocumented audience and trend fields, noisy bridges. Same-call rank order and brand-conditioned territory lists repeatable and discriminating. One exemplar per territory too fragile | Live hackathon-API evidence ([feasibility report](../sprint-0/QLOO_TECHNICAL_FEASIBILITY.md#methodology-inputs-approved-for-sprint-2)) |
| Sprint 1 | Deterministic ingredients, no formula | Built before live access; ran unchanged on live data ([evidence core](../sprint-1/CULTURAL_EVIDENCE_CORE.md)) |
| **Sprint 2** | Rank-only multi-exemplar panels as the quantitative core; tags set-only as explanation; Novelty, Momentum, Audience and Bridge dimensions dropped; index rejected after a gate on a 6-brand live benchmark | 96 live calls, 57 pairwise benchmark assertions (51 correct, 24/29 held-out), index gate FAIL (Kendall τ across exemplar panels below 0.6 for 6/6 brands) |

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
