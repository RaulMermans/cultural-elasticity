# Sprint 10A: discovery evaluation pre-registration

Registered 2026-10-29, on branch `sprint/10a-opportunity-discovery-intelligence` from `origin/main` `abd11ca`. It was written before any Sprint 10A code change and before any result. Later changes go into a dated amendment at the end, and the earlier text is kept.

## 1. What can and cannot be evaluated offline

Real recorded discovery evidence in this repository and its local live outputs:

| Evidence | Brands | Distinct items | Use |
| --- | --- | --- | --- |
| Frontier candidate pools (`comparisonSetConstruction.candidatePool`, live runs, Sprints 5A.1–8B) | Oatly, Allbirds | 4 distinct pools, 2 per brand | Paired replay of pool ordering (suite R) |
| Brand baseline fingerprint (`evals/fixtures/live/loewe-baseline-canary-2.live.json`) | Loewe | 1 scan | Signal extraction and seed construction on real data (suite R) |
| Carhartt live run (Sprint 9O) | Carhartt | 1 HTML report, no Qloo ids | Diagnostic only. It cannot be replayed: no ids were stored, and none will be invented. |

That is 3 independent real brands. **This is not enough to establish a discovery-quality improvement.** The offline evaluation can show that the mechanism works on real evidence and is safe. A quality claim needs the frozen holdouts (§4), which need live capture and owner approval.

## 2. Arms

- `v1`: the frontier pool as on `abd11ca`. It is `frontierConcepts`, ranked by support, deduplicated by canonical key and cut at 12. Hypotheses carry no recorded motivating signals, and baseline scans have no explore handoff.
- `v2`: the Sprint 10A engine, identical except for the changes Sprint 10A ships.

Both arms see the same recorded evidence. The pool replay calls no provider.

## 3. Suites and pre-registered criteria

### Suite R: real recorded evidence (offline, deterministic)

On each of the 4 distinct recorded pools:

- **R1. Strongest evidence kept.** The best-supported non-keyword concept of `v1` is in `v2`'s first 6 entries. Pass bar: 4 of 4.
- **R2. Facet spread.** `v2`'s first 6 entries span at least as many distinct tag namespaces as `v1`'s. Pass bar: 4 of 4. This is a mechanism check: `v2` is built to interleave namespaces, so it is not evidence of quality.
- **R3. Nothing invented.** Every `v2` entry is a `v1` pool tag, with the same id, label and support. Pass bar: 4 of 4.

On the Loewe baseline:

- **R4. Seeds are observed.** Every cross-domain seed is a retained fingerprint entity of that scan, with that scan's correlation id. There is no seed without provenance. Pass bar: 100 %.

### Suite S: synthetic mechanics and safety

These are SYNTHETIC cases with placeholder ids, listed in `evals/discovery/manifest.json`. Each one asserts a deterministic outcome. They cover the classes the sprint brief lists:

- obvious and cross-domain identities;
- weak or empty evidence;
- duplicate concepts;
- unsupported lateral hypotheses;
- entity-to-territory misreads;
- supported but unmeasurable territories;
- provider errors;
- budget limits;
- unseen combinations.

Critical checks. **Any single failure blocks completion.**

- **S1.** No fabricated Qloo id. Every `motivatedBy` id and every seed id was observed.
- **S2.** No unobserved source attribution.
- **S3.** No hypothesis is promoted to `QLOO_SUPPORTED` or `RELATIVELY_MEASURED` without brand-independent members in the run.
- **S4.** No duplicate is promoted.
- **S5.** No cross-call numerical comparison, and no classification without a FULL route.
- **S6.** No budget or permission violation: tool allowlists, Qloo call limits, and refusals are recorded.
- **S7.** The free baseline stays model-free, makes no extra provider call, and starts no agent run.
- **S8.** Every existing suite passes unchanged: `pnpm test`, `eval:methodology`, `eval:agent`, `eval:d2d`, `eval:query` and `eval:competence` (offline).

### Suite H: blinded human rating (owner)

`pnpm eval:discovery` writes `docs/sprint-10a/evaluation/rating-sheet.md`. For each recorded pool it shows the first 6 entries of each arm, with the arm hidden and the order randomised by a fixed seed. Raters see the supporting evidence (support count, facet, supporting entities where recorded).

The anchored 1–5 scales:

- **Non-obviousness.** 1 = restates the familiar identity. 2 = familiar adjacency. 3 = somewhat less obvious but understandable. 4 = a distinctive cross-domain opportunity. 5 = highly surprising, culturally coherent and worth investigating.
- **Cultural relevance.** 1 = an incidental attribute or demographic label. 3 = a plausible cultural territory. 5 = a clearly meaningful cultural territory.

This is a human judgment scale, not a Qloo measure. An assistant rating is never reported as a human rating. Until the owner rates the sheet, Suite H is `NOT_RUN`.

## 4. Frozen holdouts (live capture, NOT_RUN until approved)

Every brand below is unseen: none appears anywhere in the repository (checked with `git grep -il` on 2026-10-29). The holdouts were frozen before implementation. No Sprint 10A code was tuned on them, and the runtime never reads this list.

| id | brand | industry |
| --- | --- | --- |
| h01 | Dr. Martens | footwear |
| h02 | Fenty Beauty | beauty |
| h03 | Duolingo | consumer app |
| h04 | Red Bull | beverage |
| h05 | Rimowa | luggage |
| h06 | Moleskine | stationery |
| h07 | Hoka | running |
| h08 | Telfar | fashion |
| h09 | Sonos | audio |
| h10 | Jägermeister | spirits |
| h11 | Polaroid | photography |
| h12 | Tony's Chocolonely | food |

Diagnostic cases (not holdouts): Carhartt (Sprint 9O regression), Oatly, Allbirds and Loewe.

**Per-holdout procedure.**

1. One brand baseline scan, which is free and deterministic (7 calls at most).
2. One `explore_frontier` run per arm, recorded and replayed so that both arms see identical Qloo answers. The `v2` run has the baseline's cross-domain seeds.

**Holdout metrics.** Reported with denominators:

- distinct Qloo-supported directions;
- distinct tag namespaces among them;
- blinded human non-obviousness and relevance;
- grounding precision: claims traced to correlation ids;
- unsupported-promotion rate, which must be 0;
- measurement yield where measurement was attempted;
- Qloo calls per supported direction;
- model cost and latency.

**Holdout pass bar.** All of these must hold:

- `v2` median human non-obviousness is greater than `v1`'s;
- `v2` has at least as many distinct supported directions in 8 or more of 12 holdouts;
- the unsupported-promotion rate is 0;
- Qloo calls per supported direction are no more than 1.25 × `v1`'s.

If directions become more surprising but less grounded, the sprint fails.

**Budget request, not approved.**

| Item | Estimate |
| --- | --- |
| Qloo calls | 12 × (7 + 2 × 32), about 852 worst case. With shared replays, about 500. |
| Haiku | 24 runs, about $1.50 |

The capture runs as a local process with its own caps, never against the public evaluation ledger, and only after the hackathon judging window unless the owner decides otherwise. Without approval, the holdouts stay `NOT_RUN` and the report says `LIVE_QLOO_VALIDATION_NOT_RUN` and `LIVE_AGENT_MODEL_VALIDATION_NOT_RUN`.

## 5. Status rule

- **`SPRINT_10A_COMPLETE`** needs all of: R1–R4, S1–S8, Suite H showing `v2` > `v1`, and the holdout pass bar.
- **`SPRINT_10A_COMPLETE_WITH_LIMITATIONS`**: the R and S suites pass, and H or the holdouts are `NOT_RUN` or inconclusive.
- **`SPRINT_10A_BLOCKED`**: any S criterion fails.

Agent-model readiness is reported separately.
