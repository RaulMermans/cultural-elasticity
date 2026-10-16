# Architecture

## Target (hybrid workflow-agent)

```
User
  ↓
Frontend (Next.js, Vercel)                       ← never sees Qloo or its credential
  ↓ HTTP
Backend API (Fastify, container runtime)
  ↓
Agent                                            ← Sprint 2+: chooses what to investigate, interprets
  ├── Qloo tools        (QlooClient → QlooTransport → official harness: exec now, MCP later)
  └── Deterministic tools (evidence workflow, Elasticity engine)
  ↓
EvidencePacket  (backend/src/contracts/qloo.ts)
  ↓
Elasticity Engine (deterministic, tested; no LLM-produced numbers)
  ↓
Validated analysis → Frontend visualization
```

**Sprint 0 implements:** the frontend shell, `/health`, the Qloo adapter, the evidence contracts, and the feasibility evidence workflow.

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
| Integration | Recorded real harness outputs and the real harness binary (no network) | `backend/tests/fixtures/recorded/`, `feasibility-script.test.ts` |
| Live Qloo | Real credential, real responses | `pnpm feasibility:qloo` → reviewed into `evals/fixtures/live/` |
