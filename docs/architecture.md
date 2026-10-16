# Architecture

## Target (hybrid workflow-agent)

```
Qloo adapter                     backend/src/qloo (live-adapter.ts)               ← provider-specific schemas STOP here
      ↓
EvidencePacket                   backend/src/evidence/schema.ts                    ← canonical, provider-independent
      ↓
Cultural Evidence Core           backend/src/evidence + backend/src/analysis       ← deterministic, tested, no LLM, no I/O
      ↓
AnalysisIngredients              packages/shared/src/analysis.ts                   ← stable downstream boundary
      ↓
Future Elasticity Methodology    (not built: no formula, weights or score yet)
      ↓
Future Agent Interpretation      (not built: may choose investigations and explain ingredients, never produce numbers)
      ↓
Frontend (Next.js, Vercel)       ← talks only to the backend; never sees Qloo or its credential
```

Provider-specific shapes (harness envelopes, Qloo entity/tag records, `compare_audiences` passthroughs) exist only in the adapter. Everything from `EvidencePacket` down is provider-independent, so Sprint 0B can change the adapter without touching the engine. See [sprint-1/CULTURAL_EVIDENCE_CORE.md](sprint-1/CULTURAL_EVIDENCE_CORE.md).

**Implemented so far:**

- Sprint 0: the frontend shell, `/health`, the Qloo adapter, the Qloo-side evidence record (`contracts/qloo.ts`) and the feasibility workflow.
- Sprint 1: the canonical `EvidencePacket`, the Cultural Evidence Core, `AnalysisIngredients`, `POST /api/analysis/ingredients` (offline, development only), `/dev/analysis` (development only) and the methodology eval harness.
- Sprint 0B: the hackathon host safety gate (`qloo/environment.ts`), the live Qloo → `EvidencePacket` adapter (`qloo/live-adapter.ts`, written from live output), the pinned live investigation (`feasibility/live.ts`, `live-config.ts`) and the live and recorded eval class (`pnpm eval:live`). The Sprint 1 engine ran on live data unchanged.

## Cultural Evidence Core pipeline

```
unknown input → zod validation → normalization (dedupe, sort, provenance merge)
  → calculators: overlap · coverage/stability · audience · ranking · bridges · distance-proxy ingredients
  → evidence quality → AnalysisIngredients → invariant validation (no NaN, unknown ≠ 0, ratios in [0,1], no scores)
```

Comparability is enforced in code (`evidence/comparability.ts`): values from separate calls, unknown scopes or mismatched scales are refused, never normalized together.

## Qloo integration boundary

```
product code ──► QlooClient (interface)
                   └─ HarnessQlooClient: status policy, retry ≤1, normalization
                        └─ QlooTransport (interface)
                             ├─ HarnessExecTransport  → `qloo exec <workflow>` (implemented; pinned to the hackathon host)
                             └─ (future) HarnessMcpTransport → `qloo mcp` stdio
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

## Deployment (prepared, not deployed)

| Part | Target | Notes |
| --- | --- | --- |
| frontend | Vercel | Needs `BACKEND_URL` (server-side env) only |
| backend | Any container runtime | `backend/Dockerfile`, built from the repo root. `QLOO_API_KEY` and `QLOO_API_BASE_URL` are injected at runtime. The image contains neither. |

The two deploy independently. No platform-specific configuration has been added yet.

## Validation categories

| Category | Data | Where |
| --- | --- | --- |
| Unit | Synthetic fixtures and mocks | `backend/tests/*.test.ts`, `backend/tests/fixtures/synthetic/` |
| Methodology (offline) | Synthetic EvidencePackets | `evals/fixtures/synthetic/` → `pnpm eval:methodology` |
| Integration | Recorded real harness outputs and the real harness binary (no network) | `backend/tests/fixtures/recorded/`, `feasibility-script.test.ts` |
| Live (captured) | Sanitized hackathon-API captures | `evals/fixtures/live/` → `pnpm eval:live` (offline, structural) |
| Live Qloo | Real credential, real responses, hackathon host only | `pnpm feasibility:qloo [-- --write-fixture]` |
