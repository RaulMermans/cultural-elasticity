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

## Agent evals (Sprint 4 → Sprint 5A update)

`evals/agent/scenarios.json` now holds **46** synthetic scenarios. Sprint 4 added the skill scenarios (`sk-*`). Sprint 5A adds nine `s5-*` scenarios that reproduce live failure classes:
- meaningless references refused;
- barren probe switches type;
- references built before analysis;
- recovery to an untried type;
- incidental reference proposal refused;
- frontier venue attributes excluded;
- two synthesis false positives accepted;
- grounded findings accepted;
- an unsupported grounded finding rejected.

Scenarios may wrap the baseline with a failure behaviour observed live (`"wrap": "eager_analyze"`). Two more expectation kinds exist: `contextIncludes` (state-grounded guidance actually reached the model) and `notFull`. `backend/tests/agent-sprint5a.test.ts` adds 30 targeted adversarial tests (semantic validator, reference plan, recovery, deferral, frontier, synthesis validity and false positives, gate honesty). All of this is SYNTHETIC: neither a Qloo validation nor a live model validation.

## Agent evals (Sprint 5A.1 update)

`evals/agent/scenarios.json` holds **52** scenarios. Six `s51-*` scenarios reproduce the Sprint 5A live failure classes with fictional `SYN-` entities (world additions `SYN-*-3xxx`):
- `s51-type-alignment-compare`: an off-type anchor deferred once (`TYPE_ALIGNMENT_PENDING`); all three targets reach one place set (FULL);
- `s51-probe-limit-unsupported`: `PROBE_LIMIT_REACHED` after 3 empty types; the territory becomes unsupported after 6 empty probes; INSUFFICIENT, never zero;
- `s51-references-late-still-feasible`: references found with two turns left still complete (FULL). It fails under the Sprint 5A turn arithmetic (mutation-checked);
- `s51-reference-namespace-barren`: a third probe in a namespace already barren for the type is refused (`REFERENCE_NAMESPACE_BARREN`);
- `s51-frontier-evidence-base`: the related take is fixed and a profile outside the evidence base is refused (`FRONTIER_EVIDENCE_BASE`);
- `s51-frontier-canonical-anchor`: candidates keep their grounding tag as canonical identity (`SAME_CONCEPT`).

New expectation kinds: `maxEmptyTypeProbesPerConcept`, `evidenceStatus`, `relatedTake`, `allCandidatesCanonical`.

`pnpm eval:agent` also runs the targeted runtime evaluators (`backend/scripts/run-evaluators.ts`, `run-evaluators-v1`) on every scenario:
- `PROBE_BUDGET_VALID`
- `COMMON_TYPE_FEASIBILITY`
- `REFERENCE_SET_MEANINGFUL`
- `COMPLETION_BUDGET_FEASIBLE`
- `CANONICAL_CANDIDATE_VALID`
- `FRONTIER_DISCOVERY_CONSISTENCY`

The run requires 0 failures. `backend/tests/agent-sprint5a1.test.ts` adds 27 targeted tests. All of this is SYNTHETIC.

Two eval-side files feed the live readiness gate v3:
- `evals/agent/controlled-cases.json` (`agent-controlled-v1`) holds the controlled positive scenario `C-FULL-1`. Its preconditions are real Qloo observations with correlation ids from stored Sprint 5A traces, and they are re-verified live before every run. It is evaluator-constructed (owner review pending) and kept outside the seven-case denominator.
- `evals/agent/stability-criteria.json` (`frontier-stability-criteria-v1`) holds the frontier criteria. They were defined before the Sprint 5A.1 live run, with Sprint 5A baselines computed by the same code. Thresholds must not be changed after seeing results.

### Live agent evaluation (`pnpm eval:agent:live`)

`evals/agent/live-cases.json` (`agent-live-v1`) is unchanged: L-M1–M3, L-C1–C2, L-E1–E2.

The readiness run is:

```sh
pnpm eval:agent:live -- --arms baseline,model --stability 3 --out backend/feasibility-output/sprint5a-live/<name>
```

It runs both arms on the identical cases and repeats each frontier case three times in the model arm. Sprint 5A.1:
- The controlled scenario(s) run in both arms after a live preflight, whenever `--cases` is absent or names them.
- The default output directory is `backend/feasibility-output/sprint5a1-live/<timestamp>`.
- The gate (`agent-readiness-gate-v3`) reports **SAFETY** (the list below) and **COMPETENCE** separately. Overall READY needs both.
- The nine competence checks are: recovery, probe limits, meaningful FULL demonstrated, controlled FULL, frontier criteria, no regression, synthesis usable, honest degradation, runtime evaluators.

The SAFETY half requires:
- every prescribed case executed by `claude-haiku-5-5` (an error or omission stays in the denominator: `INCOMPLETE_LIVE_EVALUATION`);
- a single model id;
- a full case-matched baseline;
- measured frontier stability;
- zero permission, secret or benchmark leakage, methodology overrides, budget violations, accepted unsupported claims, and **semantically invalid FULL results**.

Reported separately from the historical route mix: `semanticallyValidFullRate`, `invalidFullComparisonRate`, `meaningfulPartialRate` (a rule-based proxy, not human judgment), synthesis first-attempt / after-repair / fallback / usefulness rates, and the latency split (model, Qloo, spacing, analysis, synthesis).
