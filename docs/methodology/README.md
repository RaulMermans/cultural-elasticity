# Methodology

**Status:** preliminary. There are no weights, no formula and no Elasticity Score. They will be defined only after live Qloo evidence passes the Sprint 0 gates. See [../sprint-0/QLOO_TECHNICAL_FEASIBILITY.md](../sprint-0/QLOO_TECHNICAL_FEASIBILITY.md) §13 and §17.

## Principles

1. **Evidence before formula.** Every ingredient must come from a Qloo workflow whose output has been observed live and typed.
2. **Same-call comparability.** Qloo affinities are query-relative. Only numbers from one call are compared, or rank-based transforms of them.
3. **Explicit representation.** A territory is a human-pinned Qloo tag plus Qloo-returned exemplar entities, recorded in the evidence packet.
4. **Honest naming.** Use "Cultural Distance Proxy" (Qloo has no graph distance) and "Qloo-supported intermediate cultural signals" (Qloo has no paths).
5. **Deterministic computation, LLM interpretation.** Code computes ingredients. The agent explains them.

## Candidate ingredients (pending live gates)

| Ingredient | Qloo source | Gate |
| --- | --- | --- |
| Shared and joint tags, top-N overlap | `entity_tags` | G3, G6 |
| Territory entities' affinity to the brand | `recommend` (signal = brand, filter = territory tag) | G2 |
| Single-call rank position of territory exemplars | `rank` | G5 |
| Audience comparison fields | `compare_audiences` | G4 |
| Entity momentum | `trends` | — (context only) |

**Dropped as an independent dimension:** Novelty. Qloo has no direct signal for it (see feasibility §11).
