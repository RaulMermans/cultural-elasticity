# Sprint 9M: pre-registered Cultural Break attempt

Written on 2026-10-29, **before** any paid run of this sprint. It exists so that a "Cultural break" example, if one appears, is not cherry-picked.

## Why

So far the live product has shown two outcomes, both for Crocs (Sprint 9L):

- fine dining was a **Credible stretch**, provisional;
- Fiction was **Inconclusive**.

The runtime has never shown a **Cultural break** in a documented production investigation. We want to know whether it can, without changing any rule to make one appear.

## Rules

1. **No methodology change.** The classification rules, thresholds and comparison-set construction stay exactly as deployed at `e65994f`.
2. **Fixed candidates, fixed order.** Each run is one anonymous public-evaluation visit in a real browser, using the hosted acceptance journey:

   | Run | Brand | Agent's own first direction | Contrast question (typed in the composer) |
   | --- | --- | --- | --- |
   | A | Patagonia | whatever the baseline proposes first | "How far can Patagonia extend into luxury jewelry?" |
   | B (only if A's contrast is Inconclusive) | Patagonia | n/a | "How far can Patagonia extend into nightclubs?" |

   Run A also validates the journey for an anonymous judge, as a release acceptance check.

   We chose Patagonia → luxury jewelry because outdoor-utility taste and luxury ornament taste plausibly diverge. That is a hypothesis for Qloo to test, not a label.

3. **Stopping.**
   - At most two contrast questions are asked.
   - No question is re-run.
   - If both are Inconclusive, or neither is a Cultural break, the sprint reports that the runtime has **not yet demonstrated** a Cultural break.
4. **Reporting.** Every result is reported, including:
   - the agent's own first direction;
   - classification, stability and robustness;
   - the comparison set and missing evidence.

   A result that contradicts the hypothesis is reported as found.
5. **Budget.** Runs come from the owner-approved public evaluation: 1,000 Qloo calls and $5.00 in total, with per-network quotas. No operator token or extra allowance is used.

## Results

Filled in after the runs; see `LIVE_EVALUATION_EVIDENCE.md`.
