# Architecture

## Target (hybrid workflow-agent)

```
Qloo adapter                     backend/src/qloo, backend/src/contracts/qloo.ts   ← provider-specific schemas STOP here
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
- **Not yet:** the Qloo → `EvidencePacket` mapping, which is blocked on live validation (Sprint 0B).

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
                             ├─ HarnessExecTransport  → `qloo exec <workflow>` (implemented)
                             └─ (future) HarnessMcpTransport → `qloo mcp` stdio
```

- Both harness surfaces return the same normalized envelope (`schema_version 1.0-preview.1`). Swapping transports does not touch product code.
- Envelope → zod validation (`normalize.ts`) → internal contracts. Contract mismatches raise `QlooContractError` and are never retried.
- The harness runs as a local child or stdio process. That is why the backend needs a container-capable runtime and why Qloo calls never run in the browser or in ordinary serverless functions.

## Deployment (prepared, not deployed)

| Part | Target | Notes |
| --- | --- | --- |
| frontend | Vercel | Needs `BACKEND_URL` (server-side env) only |
| backend | Any container runtime | `backend/Dockerfile`, built from the repo root. `QLOO_API_KEY` is injected at runtime. |

The two deploy independently. No platform-specific configuration has been added yet.

## Validation categories

| Category | Data | Where |
| --- | --- | --- |
| Unit | Synthetic fixtures and mocks | `backend/tests/*.test.ts`, `backend/tests/fixtures/synthetic/` |
| Methodology (offline) | Synthetic EvidencePackets | `evals/fixtures/synthetic/` → `pnpm eval:methodology` |
| Integration | Recorded real harness outputs and the real harness binary (no network) | `backend/tests/fixtures/recorded/`, `feasibility-script.test.ts` |
| Live Qloo | Real credential, real responses | `pnpm feasibility:qloo` → reviewed into `evals/fixtures/live/` |
