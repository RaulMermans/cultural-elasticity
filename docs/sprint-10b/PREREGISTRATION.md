# Sprint 10B pre-registration: decision-point competence

Registered 2026-10-30. This was written before any Sprint 10B change to the runtime, the context or the prompts, and before any model run. Base: `main` at `62ca552`.

## What is frozen

| Item | Where |
|---|---|
| 38 decision cases: 22 dev, 16 holdout | `evals/competence/decisions.json` |
| Arms: `before` (main) and `new` (`focus.withdrawn`) | same file, `arms` |
| Pass bar: safety, sensitivity, reachability, improvement | same file, `passBar` |
| Offline baseline result | `docs/sprint-10b/evaluation/decisions-offline-preregistration.{txt,json}` |

Any later change goes to `amendments` with a date and a reason. Earlier results are kept.

## Why decision points

The full-run evaluations (`eval:agent`, `eval:d2d`) drive the deterministic reference policy. They never exercise a model's choices. A decision case freezes one turn in a synthetic scenario:

1. The scenario's own policy drives the run to the decision point.
2. The policy under test takes that one turn.
3. The reference policy finishes the run.

The tested turn is scored from the runtime's trace, against generic predicates such as `followsNextProbe`, `repeatsRefusal`, `usesUnlistedReference` and `qlooCall`. No predicate names a brand, a territory or an id.

## Holdout

- The 16 holdout cases are not inspected per case before the paired Haiku run.
- They are separate from the Sprint 10A discovery holdout brands. Those 12 brands are not read, not used and not touched.
- The 9O competence cases (`evals/competence/cases.json`) are diagnostics only.

## Offline baseline (`main`, both arms identical before the change)

| Policy | Dev correct | Holdout correct | Reached |
|---|---|---|---|
| reference | 20/22 | 14/16 | 38/38 |
| instrument: eager-finish | 10/22 | 5/16 | 38/38 |
| instrument: ignore-guidance | 15/22 | 10/16 | 38/38 |

- The instruments reproduce live failure classes. Both score below the reference policy, so the scorer discriminates.
- Safety violations: 0 for every policy.
- The reference policy is a scorer ceiling, not ground truth. It misses d05, d09, d19 and d36:
  - it ignores the ranked `nextProbe` (d05);
  - it analyzes while a recovery path remains (d09);
  - it repeats a deferred reference probe (d19);
  - it searches tags instead of probing pending candidates (d36).

## Paid step (not run)

The `improvement` criterion needs Haiku on the tested turns:

```
pnpm eval:competence -- --decisions --policy haiku --arms before,new --repeats 3 --approved-usd <N>
```

- The synthetic world means **no Qloo call** is made.
- The script prints its reserved exposure and refuses to start unless `--approved-usd` covers it.
- It needs explicit owner approval. Until then the status is `LIVE_AGENT_MODEL_VALIDATION_NOT_RUN`.
