# Cultural Evidence Core

**Status:** Sprint 1 complete on synthetic data only. `LIVE_QLOO_VALIDATION_NOT_RUN`: Sprint 0B (live Qloo) is still blocked on a credential. Nothing in this document is evidence about Qloo's live behaviour or about any real brand.

## Purpose

The Cultural Evidence Core is the deterministic layer between provider evidence and the future Elasticity methodology. It takes one normalized `EvidencePacket` and returns `AnalysisIngredients`: transparent, individually defensible measurements, each with its availability, provenance and limitations.

It deliberately produces **no** Elasticity score, no 0–100 number, no weights, no Cultural Distance score and no Bridge Strength. Those come later, once live evidence shows what the ingredients actually mean.

## Architecture Boundary

```
raw provider evidence            (Qloo harness envelopes; provider-specific)
      ↓   provider adapter       backend/src/qloo, backend/src/contracts/qloo.ts   ← only place that knows Qloo
normalized EvidencePacket        backend/src/evidence/schema.ts                     ← provider-independent
      ↓   validate → normalize   backend/src/evidence
deterministic ingredients        backend/src/analysis                               ← no Qloo, no LLM, no I/O
      ↓   invariant validation   backend/src/analysis/validate.ts
AnalysisIngredients              packages/shared/src/analysis.ts                    ← consumed by frontend / future agent
      ↓
future Elasticity methodology → future agent interpretation → frontend
```

The engine imports nothing from `qloo/`, `contracts/`, Fastify or `child_process`. A test enforces this (`analysis-ingredients.test.ts`, "provider independence").

Entry points:

| Function | Use |
| --- | --- |
| `analyzeEvidencePacket(input: unknown)` | Full pipeline. Throws `EvidenceValidationError` (with structured issues) on invalid input. |
| `parseEvidencePacket(input)` | Validation only. |
| `normalizeEvidencePacket(packet)` → `computeAnalysisIngredients(normalized)` | The pipeline, step by step. |
| `POST /api/analysis/ingredients` | Development endpoint: offline and deterministic. 400 with issues on invalid input. |

## Canonical Contracts

Input contracts are zod schemas in `backend/src/evidence/schema.ts`. They are strict, so unknown fields are rejected. Output contracts are plain TS types in `packages/shared/src/analysis.ts`, because the frontend consumes them. A compile-time check keeps the shared primitives and the zod schemas identical.

| Contract | Fields (minimal) | Notes |
| --- | --- | --- |
| `ProvenanceRef` | `source`, `operation`, `correlationId?`, `capturedAt?` | Compact pointer, never a payload |
| `NumericEvidence` | `value`, `scale?`, `comparisonScope` | Scale preserved; never assumed 0–1 |
| `CulturalSignal` | `id`, `label`, `category?`, `rank?`, `numeric?`, `provenance[]` | `rank` is 1-based |
| `ResolvedEntity` | `id`, `label`, `type`, `resolution` (`confirmed`/`unconfirmed`/`unknown`), `provenance[]` | |
| `CulturalProfile` | `subject`, `signals[]`, `truncated?`, `provenance[]` | `truncated` undefined = unknown |
| `InterpretableMetric` | `id`, `label`, `value`, `direction`, `scale?{min?,max?}`, `comparisonScope`, `provenance[]` | Semantics declared by the adapter |
| `AudienceEvidence` | `fields` (opaque JSON), `interpretableMetrics[]`, `provenance[]` | |
| `RankingEvidence` | `rankedAgainst`, `targetCandidateId?`, `candidates[]`, `comparisonScope` (`single_call`/`unknown`), `provenance[]` | `single_call` is a claim the engine verifies |
| `BridgeEvidence` | `semantics` (`shared_signal`/`joint_signal`/`intermediate_signal`), `signals[]`, `provenance[]` | Not graph paths |
| `EvidencePacket` | `schemaVersion`, `origin` (`live`/`recorded`/`synthetic`), `brand`, `target`, `audience?`, `ranking?`, `bridges?`, `limitations[]`, `provenance[]` | |
| `Ingredient<T>` | `value: T \| null`, `status`, `provenance[]`, `limitations[]` | `value !== null` exactly when `status === "available"` |
| `AnalysisIngredients` | `overlap`, `profileCoverage`, `stability`, `audience`, `ranking`, `bridges`, `distanceProxy`, `evidenceQuality`, `limitations`, `provenance`, `evidenceOrigin`, `subjects` | The stable downstream boundary |

**Validation rejects:** NaN and ±Infinity (anywhere, including opaque fields), ranks that are not positive integers, two different signals or candidates sharing a rank, empty or whitespace ids, malformed provenance (missing fields, bad timestamps, extra keys, empty correlation ids), brand and target being the same subject, duplicate candidate or metric ids, a `targetCandidateId` that matches no candidate, a metric outside its declared scale, `scale.min > scale.max`, and malformed limitation codes. It does not reject provider numbers of unknown scale: `-340.5` or `9001` pass through untouched.

**Duplicate signals** (the same id twice in one list) are valid input. Normalization merges them deterministically: lowest rank wins, provenance is unioned, and a conflicting value or category becomes unknown. Each merge is reported as a limitation.

## Comparability Rules

`backend/src/evidence/comparability.ts`. Two numbers may be compared only if all of these hold:

1. Neither scope is `unknown`.
2. Both declare the same scope.
3. Both declare the same scale, or both declare none.
4. The scope permits the comparison:
   - `within_call`: each value traces to exactly one correlation id, and it is the same id;
   - `within_profile`: the comparison is inside a single profile;
   - `cross_call_verified`: a scale is declared.

A ranking is comparable across candidates only when it is declared `single_call` **and** every candidate, plus any ranking-level provenance, traces to the same single correlation id. Calculators refuse with `not_comparable` when a rule fails. Nothing is rescaled or normalized to make values comparable.

## Overlap Measurements

`backend/src/analysis/overlap.ts`, on normalized profiles (unique ids):

- brand / target signal counts, shared count, union count;
- **observed Jaccard** = |B ∩ T| / |B ∪ T|;
- **overlap coefficient** = |B ∩ T| / min(|B|, |T|);
- shared list (with both ranks and merged provenance), unique-to-brand, unique-to-target.

Ratios need both profiles non-empty. Otherwise the status is `insufficient_evidence` and the value is null, never 0.

**Weighted shared overlap** = Σ min(b, t) / Σ max(b, t), computed **only over shared signals** whose two values pass the comparability rules. It is not weighted Jaccard over the union: a signal missing from one profile is unknown on that side, not zero. It is `not_comparable` for incompatible values or any negative value (the ratio is undefined), and `insufficient_evidence` when there are no shared signals, no paired values, or all values are zero.

## Profile Coverage

`backend/src/analysis/coverage.ts`. Coverage describes evidence richness, not elasticity: total, ranked and numeric signal counts; numeric coverage and missing-numeric ratio; within-profile numeric comparability; truncation (`truncated` / `not_truncated` / `unknown`); provenance coverage; category count; and shared-of-brand / shared-of-target.

**Top-N sensitivity** (`topNSensitivity`, default N = 5, 10, 15, 20) gives Jaccard, shared count and shared ids at each cut-off. It also returns min/max/range of Jaccard, the ids shared at every N, and how many times the shared set changed. A cut needs an order, and **only explicit ranks are trusted**. Values are never used to order signals because their direction is unknown, so unranked profiles return `insufficient_evidence`. The N values are probe sizes, not methodology parameters. Stability measures how sensitive the observed representation is to the cut-off. It is not cultural truth.

## Audience Evidence

`backend/src/analysis/adjacency.ts` → `analyzeAudienceEvidence()`. No adjacency formula exists and no aggregate is computed.

- **Interpretable metrics** keep their declared direction and scope. Only metrics with direction `higher_is_closer` or `higher_is_farther` are usable as ingredients. `neutral` metrics are surfaced with an exclusion reason. `crossCallComparable` is true only for `cross_call_verified`.
- **Opaque fields** stay as evidence. Their leaf paths and numeric leaf paths are listed for human investigation and never promoted into calculations.
- Status: `unavailable` (no audience evidence), `insufficient_evidence` (present but nothing directional), `available`.

Deciding that an upstream field is interpretable is the adapter's job. It happens only after its meaning is verified live.

## Candidate Ranking

`backend/src/analysis/ranking.ts` → `analyzeRanking()`. When the single-call scope is verified and every candidate has a rank, it returns the rank-sorted candidates and the candidate count. For the target it returns rank position, positions from top and bottom, **relative rank percentile** = (n − position) / (n − 1) (1 = top, 0 = bottom, needs n ≥ 2), and raw value gaps to the top and bottom candidates. Gaps need every candidate's value to be comparable within the call, and no direction is implied.

When the scope is unverified (an undeclared scope, mixed correlation ids, or missing ids), the status is `not_comparable` and every relative ingredient is null. Candidates are then listed in **id order, not rank order**, so separate calls are never presented as one ranking. A ranking made for a subject other than the brand is flagged, and its percentile becomes `not_comparable` in the distance proxy.

## Bridge Evidence

`backend/src/analysis/bridges.ts` → `BridgeIngredients`: distinct signal count across bridge items, signals (deduplicated, provenance merged, per-list ranks dropped because they are not comparable across lists), counts by semantics, category count, numeric coverage and provenance coverage. **There is no bridge score.**

- No bridge evidence gives `unavailable`, with `signalCount: null`.
- An empty bridge result **that traces to a call** gives `available` with 0: an observed zero.
- An empty bridge item **without provenance** cannot be told apart from "not collected", so it is treated as unavailable and flagged.

## Distance Proxy Ingredients

`backend/src/analysis/distance.ts` → `DistanceProxyIngredients`, with `formula: "NOT_DEFINED"`. These are inputs a future Cultural Distance Proxy may use. They are not combined here:

`jaccardOverlap`, `overlapCoefficient`, `sharedSignalCount`, `weightedSharedOverlap`, `relativeRankPercentile`, `audienceMetrics` (usable metrics only), `bridgeSignalCount`, `profileCoverage`, `profileStability`.

Each is an `Ingredient<T>` with its own status, provenance and limitations. Qloo exposes no graph distance (see the Sprint 0 feasibility doc), so the term stays "Cultural Distance Proxy".

## Evidence Quality

`backend/src/evidence/quality.ts`. Quality means sufficiency of evidence for analysis. It is **not** confidence in a business outcome, and it has no percentage.

| Indicator | Levels and rule |
| --- | --- |
| `resolution` | good if both subjects are `confirmed`, otherwise limited |
| `profileCoverage` | insufficient if either profile is empty; limited if either is truncated or its truncation is unknown; otherwise good |
| `numericEvidence` | good / limited / unavailable by share of signals with values (informational) |
| `provenance` | insufficient if any evidence item has no provenance; limited if some lack a correlation id; otherwise good |
| `comparisonValidity` | not_applicable if nothing requests a comparison; limited if any comparison was refused (incompatible shared values, unverified ranking scope); otherwise good |
| `audienceSemantics` | unavailable / limited (opaque or neutral only) / good |
| `bridgeEvidence` | unavailable / good |

**Overall** (explicit rule, returned verbatim in `overall.rule`): **LOW** if any core indicator (resolution, profileCoverage, provenance) is insufficient. **HIGH** if all core indicators are good and no requested comparison was refused. **MEDIUM** otherwise. Absent optional evidence never lowers the level. Present evidence that fails its own comparability claim caps the level at MEDIUM, because it usually means an adapter or data defect.

## Missing Evidence Semantics

**unknown ≠ zero.** **Missing evidence is not negative evidence.**

- Every withheld ingredient has `value: null` plus a status: `unavailable`, `insufficient_evidence` or `not_comparable`.
- `validate.ts` checks every output before it leaves the engine: an `available` ingredient must carry a value, and any other status must carry `null`. It also checks that no NaN or Infinity appears anywhere, that ratios lie in [0, 1], that union = brand + target − shared, and that no key names a score, elasticity or confidence. A violation raises `AnalysisInvariantError`, which the API returns as a 500.
- Counts in `overlap` describe the observed representation, so they can legitimately be 0. Ratios and the `sharedSignalCount` ingredient become null when a profile is empty.

## Provenance

- Every signal, candidate, metric and bridge item carries `ProvenanceRef[]`. Refs are compact (source, operation, correlation id, time) and never raw payloads. The schema rejects extra keys.
- Derived values carry the union of their sources' provenance, deduplicated and sorted. A shared signal cites both its brand-side and target-side observations. Overlap ingredients cite both profiles. Ranking ingredients cite the ranking call.
- `AnalysisIngredients.provenance` is the union of all provenance in the packet. `evidenceOrigin` is copied from the packet, so synthetic results stay labelled synthetic.

## Synthetic Evaluation Cases

`evals/fixtures/synthetic/`. Every file has `"fixtureType": "synthetic"`, a `SYNTHETIC` notice, `packet.origin: "synthetic"`, placeholder ids (`syn-…`) and provenance source `synthetic-fixture`. The loader rejects any fixture that breaks these rules.

| Case | Situation | Key expected behaviour |
| --- | --- | --- |
| A | High overlap, complete evidence | 16 shared, weighted overlap available, quality HIGH |
| B | Moderate overlap | 8 shared; weighted overlap `insufficient_evidence` (no values), not 0 |
| C | Low overlap | 2 shared; percentile 0 (bottom of one call) |
| D | No audience evidence | audience `unavailable`, `audienceMetrics` null |
| E | No bridge evidence | bridges `unavailable`, `bridgeSignalCount` null |
| F | Truncated profiles | truncation surfaced in quality and on overlap ingredients; quality MEDIUM |
| G | Conflicting / opaque scales | weighted overlap `not_comparable`; opaque numerics listed, not promoted; neutral metric unusable; MEDIUM |
| H | Ranking candidates from two calls | ranking `not_comparable`, percentile null, no merged rank order; MEDIUM |
| I | Missing / ambiguous provenance | provenance insufficient; quality LOW |
| J | Empty target profile | ratios and shared count null / `insufficient_evidence`; quality LOW |

`pnpm eval:methodology` runs 19 checks over these cases. Besides each case's expectations, it checks forbidden behaviour across all cases: no NaN, no withheld ingredient with a value, no score/elasticity/confidence keys, no distance formula, only synthetic provenance. It also checks that each shared signal's provenance equals the union of its sources, and that reversing every input list gives byte-identical output.

Property tests (`backend/tests/analysis-properties.test.ts`, 200 seeded random packets) check that Jaccard stays in [0, 1], intersection ≤ min, union ≥ max, reordering changes nothing, duplicated input matches deduplicated input, adding a shared signal never lowers the shared count, no NaN or Infinity appears, missing evidence is never zero, and weighted overlap appears only for comparable pairs. A reach test checks that the generator actually hits every branch, so these properties are not vacuous.

## What This Sprint Does NOT Establish

- That any ingredient is meaningful for Qloo evidence, or for elasticity.
- Any formula, weight, threshold, score, Cultural Distance value or Bridge Strength.
- That Qloo affinities fit any `comparisonScope` beyond `within_call`, or that any Qloo field is an `InterpretableMetric`.
- That synthetic fixture results resemble live results. The fixtures test engine behaviour only (Rule 7). They are not tuned toward any brand (Rule 8).

## Dependency on Sprint 0B

Blocked on live Qloo (no credential):

1. **The adapter mapping** from the Qloo-side record (`backend/src/contracts/qloo.ts`, harness-level) to the canonical `EvidencePacket`. It is not written yet, on purpose, so no unverified payload assumption gets baked in.
2. **Signal identity.** Whether Qloo tag/entity ids are stable enough to intersect across separate `entity_tags` calls (live gate G3).
3. **Ranks and truncation.** Whether returned order is a usable `rank`, and which requested limits imply `truncated: true`.
4. **Numeric scopes.** Qloo affinities are query-relative ([contract]), so they map to `within_call` with the call's correlation id. Whether any field is `cross_call_verified` stays unknown.
5. **Audience semantics.** `compare_audiences` output is untyped ([contract]). Which fields, if any, become `InterpretableMetric`s, with what direction and scale, needs live observation (gate G4).
6. **Ranking.** Whether `rank` output yields a usable rank/value per candidate within one call (gate G5).
7. **Bridges.** Which `shared_signal` / `joint_signal` sources are populated live (gate G6).
8. **Resolution.** How harness confirmation (`unambiguous` / `auto_selected_unconfirmed` / `pinned`) maps to `confirmed` / `unconfirmed`. The proposal is unambiguous or pinned → confirmed, auto-selected → unconfirmed.

None of these needs an engine change. They are adapter decisions.

## Sprint 2 Readiness

Ready:

- A stable, typed input contract (`EvidencePacket`) and output contract (`AnalysisIngredients`) for an adapter, a methodology and a frontend to target.
- Deterministic, provenance-preserving calculators with comparability enforced in code.
- An offline eval harness that can take recorded and live fixture classes next to synthetic ones.

Recommended next, once a credential exists: run `pnpm feasibility:qloo`, write the Qloo → `EvidencePacket` adapter from the observed output, promote sanitized live packets into `evals/fixtures/live/`, and add a live loader to the harness. Only then should a methodology be drafted.
