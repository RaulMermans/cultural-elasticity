# Evals and fixtures

Several classes of test data. They are never mixed and never relabelled.

| Class | Location | What it is | May be cited as Qloo evidence? |
| --- | --- | --- | --- |
| **Synthetic** | `backend/tests/fixtures/synthetic/` | Hand-written to the verified envelope shape. Placeholder IDs, fictional names. | **No** |
| **Synthetic (methodology)** | `evals/fixtures/synthetic/` | Hand-written canonical `EvidencePacket`s, cases A–J. `"fixtureType": "synthetic"`, `origin: "synthetic"`, provenance source `synthetic-fixture`. | **No**. They test engine behaviour only. |
| **Recorded** | `backend/tests/fixtures/recorded/` | HISTORICAL Sprint 0A harness outputs captured offline without a credential (contract, auth-failure envelopes). `production_server` in them is harness contract metadata, not this project's environment. | Only as evidence of harness *behaviour* |
| **Live** | `evals/fixtures/live/` | Sanitized evidence captured from the **Qloo hackathon API** by `pnpm feasibility:qloo -- --write-fixture`. `"fixtureType": "live"`, `origin: "live"`, provenance source `qloo-hackathon-api`, every ref carries a correlation id. | **Yes**, with provenance, as of its `captureDate` |
| **Live benchmark** | `evals/benchmarks/cultural-elasticity-v0/` | `benchmark.json`: human-curated labels (not truth) for 6 brands × 6 territories, brand-level calibration/held-out split. `evidence/<brand>.live.json`: sanitized `MethodologyInput` captured from the **Qloo hackathon API** by `pnpm capture:elasticity -- --write-fixtures`. | **Yes**, with provenance, as of its `captureDate` |

## Promoting a live run

1. Run `pnpm feasibility:qloo -- --write-fixture`. The full report goes to `backend/feasibility-output/` (gitignored, mode 0600). The fixture goes to `evals/fixtures/live/jacquemus-boutique-hospitality.live.json`.
2. Review the fixture. It holds the normalized `EvidencePacket`, gates and observations, with no request headers, no key, no raw upstream payloads, and no address, phone, image or description fields. The script refuses to write anything that contains credential material.
3. Run `pnpm check:secrets` and `pnpm eval:live` before committing.

If Qloo's terms or the event rules disallow storing raw responses, store only the derived fields (IDs, labels, affinities, gates).

**Status:** one Sprint 0B live fixture, `jacquemus-boutique-hospitality.live.json` (re-captured 2026-10-16 12:02 UTC from `https://hackathon.api.qloo.com`; since Sprint 2 its packet carries `conditionedEntities`), and six Sprint 2 benchmark fixtures (captured 2026-10-16 11:56 UTC).

## Live and recorded evals

```sh
pnpm eval:live
```

These are offline structural checks over the captured live fixture and the historical recorded fixtures, reported as separate sections. They make no network request and are **not** a new live validation (run `pnpm feasibility:qloo` for that). They assert stable facts, not exact floats: pinned identity, `within_call` scope with no invented scale, a derived target with no values, no promoted audience metric, a verified single-call ranking, cross-profile weighted overlap withheld, top-N stability at N = 5/10/15/20, no score fields, and core gates G1/G2. Never summarize synthetic results as live evidence, or the reverse.

## Methodology evals

```sh
pnpm eval:methodology
```

This loads `evals/fixtures/synthetic/`, rejects any fixture not labelled synthetic, runs the Cultural Evidence Core, and checks deterministic properties and forbidden behaviour (19 checks). Exit 0 means every check passed. It never touches Qloo. Its output always ends with `LIVE_QLOO_VALIDATION_NOT_RUN`, meaning the synthetic eval itself performs no live validation. Case descriptions: [docs/sprint-1/CULTURAL_EVIDENCE_CORE.md](../docs/sprint-1/CULTURAL_EVIDENCE_CORE.md#synthetic-evaluation-cases).

## Methodology benchmark (Sprint 2)

```sh
pnpm eval:elasticity              # offline; replays the live benchmark fixtures
pnpm eval:elasticity -- --json out.json
```

This loads `evals/benchmarks/cultural-elasticity-v0/benchmark.json` and every `evidence/*.live.json`, runs the Cultural Elasticity Methodology on each brand and reports:

- pairwise ordering accuracy (all / calibration / held-out / strong-vs-weak);
- repeat determinism;
- representation-stable territories;
- insufficient-evidence and unresolved-entity rates;
- operational-filter effects;
- class agreement and class changes under exemplar substitution;
- the calibration grid;
- brand-conditioned evidence support;
- the index gate.

It exits 1 only on structural failures: missing or invalid fixtures, provenance without correlation ids, non-determinism, calibration drift, or an index decision inconsistent with the gate. Accuracy is reported, not gated. The output says it replays live evidence offline and is **not** a new live validation.

**Labels** are `expected_strong` / `expected_mid` / `expected_weak` with a rationale each. They are human-curated evaluation labels, not objective truth, and claim no historical success. The **split is by brand** and fixed before capture. A brand whose labels were written after its evidence was seen (Jacquemus) may only be in the calibration subset; the schema enforces this.

To refresh the evidence: `pnpm capture:elasticity -- --write-fixtures` (live, about 100 calls, hackathon host only). Then run `pnpm check:secrets`, `pnpm eval:elasticity` and `pnpm test`. The live regression test locks `elasticity-v0.1` to the current capture, so a refresh that changes results needs a methodology-version decision.

## Agent evals (Sprint 3)

```sh
pnpm eval:agent                 # offline; SYNTHETIC world
pnpm eval:agent -- --json out.json
```

`evals/agent/scenarios.json` holds 28 scenarios (`"fixtureType": "synthetic"`) in 12 categories: intent routing, entity resolution, ambiguity, dynamic territory discovery, exemplar discovery, representation validation, tool selection, insufficient evidence, budget control, final synthesis consistency, generalization and forbidden behaviours. They run against `evals/fixtures/synthetic/agent/world.json`, a SYNTHETIC Qloo world (fictional names, `SYN-` placeholder ids, hand-written tag sets) that a deterministic simulator serves in the live envelope shape. Each scenario is driven either by the ScriptedAgentModel (a fixed turn list, used for control flow and forbidden behaviours) or by the baseline reference policy (end to end). Each one has deterministic expectations.

The report gives routing accuracy, tool-call validity, resolution and representation success, the route mix, methodology consistency (recomputed independently), final-claim consistency, budget violations, benchmark leakage (no benchmark brand, exemplar or `expected_*` label may appear in any model context), the generalization gates and averages. It exits 1 if any acceptance threshold fails. It is **neither** a Qloo validation **nor** a live model validation, and it always prints the model status (`LIVE_AGENT_MODEL_VALIDATION_NOT_RUN` without a key).
