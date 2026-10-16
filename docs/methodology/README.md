# Methodology

**Status:** Sprint 0B live validation is complete: **CONDITIONAL GO** on live hackathon-API evidence (2026-10-16). There are still no weights, no formula and no Elasticity Score. Sprint 2 defines them, using only the inputs approved in [../sprint-0/QLOO_TECHNICAL_FEASIBILITY.md § Methodology Inputs Approved for Sprint 2](../sprint-0/QLOO_TECHNICAL_FEASIBILITY.md#methodology-inputs-approved-for-sprint-2).

The deterministic ingredients exist (Sprint 1) and ran unchanged on the first live packet. They are still not combined. See [../sprint-1/CULTURAL_EVIDENCE_CORE.md](../sprint-1/CULTURAL_EVIDENCE_CORE.md).

## Principles

1. **Evidence before formula.** Every ingredient must come from a Qloo workflow whose output has been observed live and typed.
2. **Same-call comparability.** Qloo affinities have no documented scale and are query-relative. Only numbers from one call (same correlation id) are compared, or rank-based transforms of them.
3. **Explicit representation.** A territory is a human-pinned Qloo tag plus human-reviewed, Qloo-filtered exemplar entities, recorded in the evidence packet and disclosed as a derived representation.
4. **Several exemplars per territory.** Live data showed that mid-table conclusions change with the exemplar. Report the spread; never let one exemplar stand for a territory alone.
5. **Honest naming.** Use "Cultural Distance Proxy" (Qloo has no graph distance: `REAL_GRAPH_DISTANCE_UNAVAILABLE`) and "Qloo-supported intermediate cultural signals" (Qloo has no paths).
6. **Deterministic computation, LLM interpretation.** Code computes ingredients. The agent explains them.

## Ingredients after live validation

| Ingredient | Qloo source | Live status | Use |
| --- | --- | --- | --- |
| Brand-relative candidate order | `rank` (one call, ≤ 6 options observed safe) | discriminating (0.56–0.86), repeatable | **quantitative, within call** |
| Brand-conditioned territory entities | `recommend` (signal = brand, filter = territory tag) | coherent, repeatable | **quantitative, within call** (needs a packet slot) |
| Related entities | `recommend` same type | high face validity | context, mutual-neighbour checks |
| Tag-set overlap and top-N stability | `entity_tags` at fixed take = 20 | saturated values, operational noise, truncation-sensitive | **set-only, descriptive**; separate operational namespaces |
| Joint tags, mutually related entities | `entity_tags` (joint), `recommend` × 2 | noisy; 0 mutual neighbours | **qualitative only** |
| Demographic skew | `audience_demographics` | direction documented only | qualitative context |
| Audience comparison fields | `compare_audiences` | undocumented | **not used** |
| Momentum | `trends` | flat, undocumented | **not used** |

**Dropped as an independent dimension:** Novelty (confirmed live: there is no independent signal).
