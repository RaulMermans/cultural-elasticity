# Architecture

How Cultural Elasticity works today. The engineering rules behind it are in [../AGENTS.md](../AGENTS.md); the sprint-by-sprint history is indexed in [README.md](README.md#development-history).

![Architecture diagram](media/architecture.png)

## Request path

```
Browser ──► Next.js (Vercel, frontend/)                 server-side proxy routes only; no key reaches the browser
              │  server-to-server, CE_INTERNAL_API_SECRET
              ▼
           Fastify API (Railway, backend/src/api)       admission, per-network quotas, spend reservations, readiness
              ├─► Brand baseline (backend/src/brand-baseline)   fixed, model-free Qloo scan → fingerprint + directions
              ├─► Query layer (backend/src/agent/query)          one Haiku interpretation (no tools) → deterministic gate
              │        └─► Agent runtime (backend/src/agent)      skills, budgets, probing, stopping, claim validation
              │               ├─► Claude Haiku (agent/model)       proposes the next action; never sets a number
              │               └─► QlooClient (backend/src/qloo)    typed tools over the official harness
              └─► PostgreSQL                                       scans, reservations, Qloo/model ledgers, quotas
```

## Layers

| Layer | Where | Responsibility |
| --- | --- | --- |
| Qloo client | `backend/src/qloo` | The only path to Qloo. `HarnessMcpTransport` (`qloo mcp`, default) or `HarnessExecTransport` (`AGENT_QLOO_TRANSPORT=exec`), both pinned to the hackathon host. Status policy, at most one retry when Qloo marks an error retryable, zod normalization, dispatch limits |
| Evidence core | `backend/src/evidence`, `backend/src/analysis` | Provider-independent `EvidencePacket` and deterministic ingredients; refuses cross-call comparisons |
| Methodology | `backend/src/methodology` | Rank-panel position, representation robustness, coherence, provisional class. No LLM, no I/O (a test enforces this) |
| Brand baseline | `backend/src/brand-baseline` | A seven-call, model-free scan with durable reservations; observations, themes and hypotheses kept separate (`ce-brand-baseline/0.2`) |
| Query layer | `backend/src/agent/query` | Interprets a natural-language request once, then the gate approves, clarifies or refuses. Deferred operations (bridges, whitespace, competitor comparison) are reported as unsupported and use no investigation allowance |
| Agent runtime | `backend/src/agent` | Research policy v1 routes each question (direct evidence, comparison, exploration). Skills (`agent/skills`) expose only their own tools. The runtime owns state, budgets, probing bounds (`probe-policy.ts`), representation quality, semantic comparison validity, sufficiency, the claim validator and stopping |
| Shared projections | `packages/shared` | Contracts plus `evidence-assessment/v1` and `decision-card/v2`: one deterministic reading used by the workspace, the HTML/PDF report and the evaluations |
| Frontend | `frontend/src` | The brand research workspace (default) and the Living Atlas (`?mode=atlas`). A view over validated results: it never adds evidence, scores or model calls |

## Durability

| Durable in PostgreSQL | In process |
| --- | --- |
| Brand scans and their provider-call reservations; Qloo and model budget ledgers; per-network public quotas | Running agent investigations and their job state (a restart interrupts them) |

Durable agent jobs with journal replay (`CE_DURABLE_AGENT=1`, migration 002, `backend/src/agent/durable`) exist and recovered two interrupted live runs in Sprint 10D. They are not enabled in production.

## Cultural Evidence Core pipeline

```
unknown input → zod validation → normalization (dedupe, sort, provenance merge)
  → calculators: overlap · coverage/stability · audience · ranking · bridges · distance-proxy ingredients
  → evidence quality → AnalysisIngredients → invariant validation (no NaN, unknown ≠ 0, ratios in [0,1], no scores)
```

Comparability is enforced in code (`evidence/comparability.ts`): values from separate calls, unknown scopes or mismatched scales are refused, never normalized together.

## Cultural Elasticity Methodology pipeline (Sprint 2)

```
MethodologyInput (zod; structural errors → 400)
  → panels: one rank call each, verified single-call scope, positions from explicit ranks only
  → ordinal aggregation: median rank percentile across aggregated panels (repeats only test determinism)
  → representation robustness: spread across exemplar panels; INSUFFICIENT < 2 exemplars; LOW cap on missing evidence
  → territory evidence: one EvidencePacket per exemplar (set-only tags) → Cultural Evidence Core → evidence quality
  → operational-tags-v1 → set coherence RAW and CULTURAL_FILTERED (explanatory, not a classification input)
  → classification (PROVISIONAL) → index gate A–G → CulturalElasticityResult + trace → invariant validation
```

The methodology imports no LLM, agent, Fastify, MCP, transport or `child_process` code (a test enforces this). It never compares raw values across calls and never emits a 0–100 index while the decision is REJECTED_FOR_NOW.

## Qloo integration boundary

```
product code ──► QlooClient (interface)
                   └─ HarnessQlooClient: status policy, retry ≤1, normalization
                        └─ QlooTransport (interface)
                             ├─ HarnessMcpTransport  → `qloo mcp` stdio (default for the agent)
                             └─ HarnessExecTransport → `qloo exec <workflow>` (AGENT_QLOO_TRANSPORT=exec, and the feasibility scripts)
```

### Hackathon environment and host gate

Hackathon keys work only on `https://hackathon.api.qloo.com`. The harness would otherwise default to `https://api.qloo.com`. So:

- `QLOO_API_BASE_URL` is backend-only configuration, must equal the hackathon origin, and has no default (`QLOO_HACKATHON_BASE_URL_REQUIRED`, `QLOO_WRONG_ENVIRONMENT`).
- `harnessChildEnv` passes the harness `QLOO_BASE_URL` = `QLOO_TRUSTED_BASE_URL` = that origin, an isolated `QLOO_HOME` and the native resolver. `HarnessExecTransport` refuses any other routing.
- Before a live run, offline `qloo doctor` (key removed) must report that origin → `LIVE_QLOO_HOST_VERIFIED`. Otherwise nothing is sent (`LIVE_QLOO_HOST_NOT_VERIFIED`).
- No `DirectQlooTransport` exists. The harness can target the hackathon host, so the direct-HTTP fallback was not needed.

- Both harness surfaces return the same normalized envelope (`schema_version 1.0-preview.1`). Swapping transports does not touch product code.
- Envelope → zod validation (`normalize.ts`) → internal contracts. Contract mismatches raise `QlooContractError` and are never retried.
- The harness runs as a local child or stdio process. That is why the backend needs a container-capable runtime and why Qloo calls never run in the browser or in ordinary serverless functions.

## Deployment

| Part | Target | Notes |
| --- | --- | --- |
| Frontend | Vercel project `cultural-elasticity`, root `frontend/` | Production builds from `main`. Server-only `BACKEND_URL` and `CE_INTERNAL_API_SECRET`; no `NEXT_PUBLIC_` secrets |
| Backend | Railway service `cultural-elasticity-api`, `backend/Dockerfile` from the repository root | Production builds from `main`. One replica, PostgreSQL attached, sleep off |

A merge to `main` deploys both. `node scripts/release/verify-production.mjs` confirms that both serve the released SHA and checks readiness, admissions and budgets read-only. The public evaluation runs under a durable global ceiling, per-network quotas, an expiry and a kill switch (`scripts/public-evaluation-open.sh`, `scripts/public-evaluation-close.sh`). The canonical policy is [operations/DEPLOYMENT_RELEASE_CONTRACT.md](operations/DEPLOYMENT_RELEASE_CONTRACT.md).

## Validation categories

| Category | Data | Where |
| --- | --- | --- |
| Unit | Synthetic fixtures and mocks | `backend/tests/*.test.ts`, `backend/tests/fixtures/synthetic/` |
| Methodology (offline) | Synthetic EvidencePackets | `evals/fixtures/synthetic/` → `pnpm eval:methodology` |
| Integration | Recorded real harness outputs and the real harness binary (no network) | `backend/tests/fixtures/recorded/`, `feasibility-script.test.ts` |
| Live (captured) | Sanitized hackathon-API captures | `evals/fixtures/live/` → `pnpm eval:live` (offline, structural) |
| Methodology benchmark (captured live) | 6 brands × 6 territories, human-curated labels, brand-level calibration/held-out split | `evals/benchmarks/cultural-elasticity-v0/` → `pnpm eval:elasticity` (offline) |
| Live Qloo | Real credential, real responses, hackathon host only | `pnpm feasibility:qloo [-- --write-fixture]`, `pnpm capture:elasticity [-- --write-fixtures]` |
