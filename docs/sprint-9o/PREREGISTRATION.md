# Sprint 9O pre-registration: live competence cases

Registered on 2026-10-29, before any Sprint 9O live result was observed, on branch
`sprint/9o-live-competence-acceptance` (base `c39b978`). After the first paid call, this file changes only by
appended amendments. Each amendment is dated and gives its reason, and the original text stays.

## 1. Environment at registration

| Item | Value | Source |
| --- | --- | --- |
| Release, Vercel, Railway, running revision | `c39b978` | `verify-production.mjs`, 2026-10-29 |
| Feasibility policy in production | `enforce` (`CE_FEASIBILITY_POLICY` unset) | Railway variable names, `feasibilityPolicyFromEnv` |
| Public evaluation | `qloo-hackathon-2026`, open until 2026-11-06T05:00Z | Railway flags, `/ready` |
| Durable ledger | 142 / 1,000 Qloo calls; 13 / 500 model cents | `/ops/status` |
| Baseline account | 27 / 408 calls | `/ops/baselines` |
| Production model | `claude-haiku-5-5` | AGENTS.md |
| Engine under test | `c39b978` (deployed). The Sprint 9O probe-bound fix is **not** deployed, so live cases measure the deployed engine. | |

## 2. Budget (proposed; requires owner approval)

- Sprint 9O live ceiling: **120 Qloo calls** and **$0.50 Anthropic**. Both are measured as ledger deltas from `/ops/status`, and both stay inside the evaluation's durable 1,000 / $5.00 ceilings.
- Worst case per case, from the runtime's own caps:
  - `analyze_move` is capped at 24 Qloo calls;
  - `compare_territories` at 32;
  - a baseline at 7, or 0 when stored;
  - brand resolution at 1.
- **Stopping rule.** Before each case, the remaining approved Qloo budget must cover that case's worst case; otherwise the case is `NOT_RUN`. A paid start is never retried. A run stopped by budget, timeout or a provider failure is recorded as it ended.

## 3. Cases, in run order

The run order follows the expected information per Qloo call.

| # | Case id | Request | Path | Worst case |
| --- | --- | --- | --- | --- |
| 1 | `9o-c1-uniqlo-manga` | "How far can Uniqlo extend into manga?" | Hosted UI composer question | 1 + 7 + 24 = 32 |
| 4 | `9o-c4-holdout-discovery` | Brand **Carhartt**. If it is ambiguous or unresolvable: **Birkenstock**. Neither appears anywhere in the repository. Investigate the **first** direction the baseline lists. | Hosted UI full journey: desktop acceptance, export, save, reopen | 1 + 7 + 32 = 40 |
| 2 | `9o-c2-crocs-fine-dining` | "How far can Crocs extend into fine dining?" | Hosted UI composer question (stored Crocs baseline) | 1 + 0 + 24 = 25 |
| 3 | `9o-c3-aesop-coffee` | "How far can Aesop extend into coffee?" | Hosted UI composer question | 1 + 7 + 24 = 32 |

- The worst cases sum to 129 calls, which is more than the 120-call ceiling. Case 3 therefore runs only if the measured usage of Cases 1, 4 and 2 is 88 calls or fewer.
- The optional cases are **not registered** for live runs:
  - Crocs → Fiction;
  - the three Patagonia cases;
  - a deliberately unsupported case;
  - the late-candidate case.

  The late-candidate case is covered offline by `backend/tests/agent-sprint9o.test.ts`.

## 4. Acceptance criteria

These are fixed before any result is observed. Every criterion is computed by code from the captured result (`pnpm eval:d2d -- --score`, the trace and the decision cards) unless it is marked *human review*.

### Safety (every case; any failure makes the case FAIL)

- **S1** No unsupported classification. The d2d `unsupportedClassifications` count is 0.
- **S2** No cross-call numerical comparison. Every compared number shares one correlation ID.
- **S3** The decision card has no violations. The d2d card `violations` count is 0.
- **S4** Spend stays inside the case's worst case, and no paid start is retried.
- **S5** The evidence is captured. `jobs/<id>.json` and `results/<id>.json` exist and parse as agent results.
- **S6** Every FULL territory's comparison set passed the semantic validator.

### Competence (per case)

**C1 Uniqlo → Manga.** PASS if either of these holds:

- (a) a FULL, semantically valid relative analysis; or
- (b) a PARTIAL or inconclusive result that meets all of the following:
  - the feasibility assessment is recorded with a named blocker;
  - there are no more than `REFERENCE_EMPTY_PROBE_LIMIT` (4) empty reference probes;
  - there is at most 1 Qloo-facing call after feasibility became INFEASIBLE;
  - the card names a limitation and a next action;
  - a repeat recommendation is present.

Otherwise FAIL. Time to the result is recorded but not judged, because there is no stored historical trace to compare it with.

**C2 Crocs → Fine dining.** PASS if all of these hold:

- the target is represented with at least 2 valid exemplars;
- the result is a FULL relative analysis on at least 3 semantically meaningful territories of one entity type, ranked in one call;
- the class follows the published thresholds from the position;
- the HTML and PDF reports state the same class and finding as the card. This applies if the case was exported; the export check runs in Case 4.

The Sprint 9L class (Credible stretch, provisional) is a regression *reference*, not an expected answer. A different class on fresh evidence is not a failure. A PARTIAL is a FAIL, and the report names its cause. A refusal by the probe bound counts as a policy-caused cause.

**C3 Aesop → Coffee.** PASS if both of these hold:

- there are no more than 4 empty reference probes (recorded live L-M1, pre-9N: 7);
- no reference probe is repeated after a refusal.

FULL is recorded but not required.

**C4 Holdout discovery.** Deterministic checks first, then human review:

- **D1** The baseline lists at least 2 directions, each with Qloo provenance (a tag or entity from the scan).
- **D2** The investigated direction's outcome satisfies S1–S6.
- **D3** Agent hypotheses are labelled apart from observed evidence, for example `UNVALIDATED` and `INTERPRETATION` versus `DIRECT`.
- **D4** No affinity or opportunity number appears that has no correlation ID.

*Human review* uses the rubric in §5, kept separate from validity:

- **H1** At least 2 directions are culturally distinct.
- **H2** At least 1 direction is potentially non-obvious.
- **H3** The investigated direction yields a finding a strategist could act on, or an honest explanation of why not.

### Product journey (Case 4, desktop 1440×900)

The journey has these steps:

1. Anonymous or operator open.
2. Resolve.
3. Baseline.
4. Network.
5. Direction dossier with Qloo grounding.
6. Investigation with progress.
7. Result and decision card.
8. HTML and PDF export, verified by **content** (finding, why, evidence, uncertainty, implication, next actions).
9. Save.
10. Reopen.

Each step is PASS, FAIL or NOT_RUN. Mobile 390×844 runs the same critical journey on a **recorded** investigation, with no paid start.

## 5. Human-review rubric (Case 4 and decision usefulness)

Each item is scored 0, 1 or 2 by a named reviewer. An assistant's provisional score is labelled as such. Owner review is required before any score is quoted outside this repository.

| Item | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Distinctness | The directions restate one theme | Two themes | Three or more distinct themes |
| Non-obviousness | Every direction is the brand's own category | One adjacent | At least one surprising and still grounded |
| Clarity | A non-expert cannot say what was found | Understandable with effort | Plain on first read |
| Next action | None, or generic | Specific but unjustified | Specific and tied to the evidence gap or finding |
| Honesty of uncertainty | Overstated | Stated but buried | Prominent and correct |

## 6. What these results can and cannot show

- The live cases are new observations on the deployed engine. Comparisons with Sprint 9L, Sprint 9M and the recorded L-* artefacts are **unmatched**, because the provider data, date and engine differ. They show no causal improvement.
- The Sprint 9N offline numbers (52 → 38 empty probes, FULL 36 → 36) are matched synthetic results, and they stay labelled that way.
- Agent-model readiness (`eval:agent:live`, 7 cases, about $28 reserved) is outside this budget. `AGENT_MODEL_NOT_READY` stands unless that gate runs.
