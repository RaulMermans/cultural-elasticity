# Evals and fixtures

Three classes of test data. They are never mixed and never relabelled.

| Class | Location | What it is | May be cited as Qloo evidence? |
| --- | --- | --- | --- |
| **Synthetic** | `backend/tests/fixtures/synthetic/` | Hand-written to the verified envelope shape. Placeholder IDs, fictional names. | **No** |
| **Synthetic (methodology)** | `evals/fixtures/synthetic/` | Hand-written canonical `EvidencePacket`s, cases A–J. `"fixtureType": "synthetic"`, `origin: "synthetic"`, provenance source `synthetic-fixture`. | **No**. They test engine behaviour only. |
| **Recorded** | `backend/tests/fixtures/recorded/` | HISTORICAL Sprint 0A harness outputs captured offline without a credential (contract, auth-failure envelopes). `production_server` in them is harness contract metadata, not this project's environment. | Only as evidence of harness *behaviour* |
| **Live** | `evals/fixtures/live/` | Sanitized evidence captured from the **Qloo hackathon API** by `pnpm feasibility:qloo -- --write-fixture`. `"fixtureType": "live"`, `origin: "live"`, provenance source `qloo-hackathon-api`, every ref carries a correlation id. | **Yes**, with provenance, as of its `captureDate` |

## Promoting a live run

1. Run `pnpm feasibility:qloo -- --write-fixture`. The full report goes to `backend/feasibility-output/` (gitignored, mode 0600). The fixture goes to `evals/fixtures/live/jacquemus-boutique-hospitality.live.json`.
2. Review the fixture. It holds the normalized `EvidencePacket`, gates and observations, with no request headers, no key, no raw upstream payloads, and no address, phone, image or description fields. The script refuses to write anything that contains credential material.
3. Run `pnpm check:secrets` and `pnpm eval:live` before committing.

If Qloo's terms or the event rules disallow storing raw responses, store only the derived fields (IDs, labels, affinities, gates).

**Status:** one live fixture, `jacquemus-boutique-hospitality.live.json` (captured 2026-10-16 from `https://hackathon.api.qloo.com`).

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
