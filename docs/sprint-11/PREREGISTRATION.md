# Sprint 11 pre-registration: research intelligence

Registered on 2026-10-30, before any Sprint 11 implementation commit. Base: `main` `c8f3633`. Cases, gold expectations, rubric and thresholds: [`evals/research-intelligence/cases.json`](../../evals/research-intelligence/cases.json). Changes after this commit are recorded as amendments, and earlier results are kept.

## Baseline diagnosis (Phase 0)

### Evidence examined

- **Live traces (Sprint 10D session, not committed, gitignored):** Fjällräven discovery (L1), Bodum × specialty coffee (L2), Diptyque × boutique hotels / ceramics / jazz (L3), Dyson × wellness retreats (L4).
- **Vinted runs (production):** I could not retrieve them. They exist only in the production database, and a read-only query was refused by the session's permission policy. I diagnosed the four Vinted failures from the owner's descriptions and the code paths alone, and I make no claim about their provider outputs.

### Where research meaning is lost

| # | Stage | Root cause in code | Trace evidence |
|---|---|---|---|
| R1 | Query interpretation | `queryProposalSchema` keeps only territory names, so the user's objective, distinctions and exclusions are discarded. The runtime agent sees `userQuery` and a name. | Every trace: `requestFields.territories` is a bare string. |
| R2 | Territory anchoring | `anchor_territory` takes only `{territoryKey, tagId}`. Nothing records whether the tag means what the user meant, so a related tag silently becomes "the territory". The runtime auto-anchors same-named tags. | Diptyque: Ceramics was anchored to `material:ceramic` (since blocked by 10D's incidental-anchor rule). Vinted: space tourism was investigated as astrotourism (owner report). |
| R3 | Exemplar judgment | The semantic judgment is optional, and its scale (`strong/adequate/weak/mismatch`) is not anchored to the intended phenomenon. | Dyson L4: Lululemon was rated `adequate` with the reason "closer to apparel than to retreats". A panel of three athleisure brands represented wellness retreats. |
| R4 | Research method | For `analyze_move`, reference construction is mandatory (`evidence-sufficiency.ts:98`, the focus `outstanding` list) unless the caller sets `single_hypothesis_v1`. The agent cannot decide that a comparison is the wrong method. | Dyson L4: three of eight turns probed "doctor", "electronic music" and "family relationships" as reference territories, as "the focus requires". |
| R5 | Synthesis | The synthesis contract allows only grounded findings that restate fields. There is no layer for interpretation, implication, counterpoint or a next step. | Bodum L2 and Dyson L4 summaries only restate routes, robustness and truncation. |
| R6 | Brand identity | Nothing distinguishes the brand's own Qloo category from a proposed extension. A brand-core concept is ranked like a stretch. | Vinted × Online Marketplace: a provisional last place (owner report). |

## Arms and controls

**A** is the production policy at `c8f3633`. **B** is the Sprint 11 policy. A single switch, `CE_RESEARCH_POLICY` (`v0` or `v1`), selects the arm, and both arms run in one build. Both arms use the same model, effort, tools, budgets and Qloo recordings.

## Tiers

| Tier | What | Cost | Status at registration |
|---|---|---|---|
| T0 | Provider-free contract and runtime-rule tests (CI) | none | planned |
| T1 | Live Haiku interpretation only, 24 queries, B arm | Anthropic only, small | **needs approval** |
| T2 | Paired live A/B, 18 holdouts × 2 arms | Qloo + Anthropic | **needs approval** |
| T3 | Blinded owner rating of T2 | owner time | after T2 |

The owner's rating is **not** independent review, and it is labelled that way. An LLM-assisted diagnosis is never presented as human judgment.

## Decision rule

`RESEARCH_INTELLIGENCE_UPGRADE_COMPLETE` requires:

- the hard gates;
- demonstrated improvement on T2 + T3, as defined in `thresholds.improvement`;
- the efficiency bound.

If T0 passes but T1, T2 or T3 has not run, the result is at most `RESEARCH_INTELLIGENCE_UPGRADE_COMPLETE_WITH_LIMITATIONS`.
