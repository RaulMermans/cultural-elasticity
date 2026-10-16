# backend

Fastify API and Qloo integration for Cultural Elasticity.

```sh
pnpm --filter backend dev               # http://127.0.0.1:4000/health
pnpm --filter backend test              # unit + fixture + recorded-output tests (no live Qloo)
pnpm --filter backend build && pnpm --filter backend start
pnpm --filter backend feasibility:qloo  # live investigation (exit 0 done, 1 failure, 3 not run)
```

## Layout

| Path | Role |
| --- | --- |
| `src/config/env.ts` | Env parsing. Exposes only *whether* a Qloo credential exists. |
| `src/routes/health.ts` | `GET /health` |
| `src/qloo/types.ts` | Workflow inputs and contract constants, each marked `[contract]`, `[harness]` or `[live]` |
| `src/qloo/transport.ts` | `QlooTransport` interface and `HarnessExecTransport` (`qloo exec`) |
| `src/qloo/client.ts` | `QlooClient`: status policy (ok / empty / needs_input / partial / degraded / error, retry ≤1) |
| `src/qloo/normalize.ts` | Envelope validation and mapping to contracts. Sanitizes opaque outputs. |
| `src/qloo/errors.ts` | Typed errors (not configured, workflow, contract, transport) |
| `src/contracts/qloo.ts` | `EvidencePacket` and related strict schemas |
| `src/feasibility/` | Sprint 0 evidence workflow (`run.ts`) and the investigation config with every human assumption (`config.ts`) |
| `scripts/qloo-feasibility.ts` | CLI entry point: readiness, live run, sanitized report |

Configuration lives in `backend/.env` (see the root `.env.example`). The credential is never part of `BackendConfig` and reaches only the harness child process.

Container: `docker build -f backend/Dockerfile -t cultural-elasticity-api .` from the repo root.
