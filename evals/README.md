# Evals and fixtures

Three classes of test data. They are never mixed and never relabelled.

| Class | Location | What it is | May be cited as Qloo evidence? |
| --- | --- | --- | --- |
| **Synthetic** | `backend/tests/fixtures/synthetic/` | Hand-written to the verified envelope shape. Placeholder IDs, fictional names. | **No** |
| **Recorded** | `backend/tests/fixtures/recorded/` | Real harness outputs captured without a credential (contract, auth-failure envelopes) | Only as evidence of harness *behaviour* |
| **Live** | `evals/fixtures/live/` | Sanitized evidence packets from `pnpm feasibility:qloo` with a real credential, after human review | **Yes**, with provenance |

## Promoting a live run

1. Run `pnpm feasibility:qloo`. The report is written to `backend/feasibility-output/` (gitignored, mode 0600).
2. Review it, and confirm it contains no credential and no personal data. The script already refuses to write output that contains the key, and drops description, image, address and geocode fields from opaque data.
3. Copy the `packet` into `evals/fixtures/live/<brand>-<territory>.<date>.json`.
4. Run `pnpm check:secrets` before committing.

If Qloo's terms or the event rules disallow storing raw responses, store only the derived fields (IDs, labels, affinities, gates).

**Status:** `evals/fixtures/live/` is empty. Live validation has not run yet.
