# AGENTS.md

Rules for any human or AI agent working in this repository.

## Priorities

**Qloo evidence first. Methodology second. Agent third. Interface fourth.** Methodology comes before polish.

## Non-negotiables

1. **Never fabricate Qloo evidence.** No invented entity IDs, tags, affinities, schemas or "example" responses presented as real. Synthetic test fixtures must be labelled SYNTHETIC, use placeholder IDs, and live under `backend/tests/fixtures/synthetic/` (unit tests) or `evals/fixtures/synthetic/` (methodology evals, `"fixtureType": "synthetic"`).
2. **Deterministic code owns every number.** Scores, rankings, overlaps and any future Elasticity metric are computed by tested code from Qloo evidence.
3. **LLMs may not invent core scores.** The agent may choose what to investigate and may interpret an evidence packet. It may not produce, adjust or "estimate" a metric.
4. **No secrets in the repo, logs, prompts, docs or fixtures.** `QLOO_API_KEY` is read only by the backend and the Qloo harness child process. Run `pnpm check:secrets` before committing.
5. **Report mocked and live validation separately.** Never describe fixture-based results as live, and never call work complete on mocks when live validation is required. If live validation could not run, say `LIVE_QLOO_VALIDATION_NOT_RUN` and list what is unverified.
6. **Do not present unsupported metrics as fact.** Qloo exposes no graph distance. Use "Cultural Distance Proxy" and "Qloo-supported intermediate cultural signals", never "distance" or "path".
7. **Preserve provenance.** Every Qloo-derived number keeps the correlation ID of the call it came from, and affinities are compared only within one call.

## Engineering

- Keep **frontend/backend boundaries clean.** The frontend talks only to the backend. Only the backend talks to Qloo, through `QlooClient` (`backend/src/qloo`).
- Product code depends on the `QlooClient` and `QlooTransport` interfaces, not on shell commands.
- Validate at boundaries (zod). Contracts are derived from verified Qloo output, never designed first.
- Handle Qloo statuses explicitly:
  - `needs_input` is never silently continued;
  - `partial` and `degraded` are flagged;
  - `error` is retried at most once, and only when Qloo marks it retryable.
- Do not add complexity without a measured requirement. No databases, queues, auth or abstractions "for later".
- Keep hackathon scope tight. Smallest reliable change, no unrelated refactors, and never delete tests to make CI pass.

## Verification before calling work done

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm check:secrets
pnpm eval:methodology   # offline, synthetic; never report as Qloo validation
pnpm feasibility:qloo   # live; report its result separately
```
