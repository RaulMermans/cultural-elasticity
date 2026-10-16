# Cultural Elasticity

**Cultural Elasticity measures how far a brand can stretch into a new category, experience, partnership or cultural territory before it stops feeling authentically like itself, using Qloo's cultural evidence.**

Built for the **Qloo Agentic Hackathon**. First test case: **Jacquemus → Boutique Hospitality**.

## Current status: Sprint 0 — Technical Feasibility

Sprint 0 asks one question: can the official Qloo tooling provide enough real, structured evidence for a defensible Elasticity methodology?

- Result: **CONDITIONAL GO**, at the contract level only. Live Qloo validation has **not run** yet because no credential was available.
- Full assessment: [docs/sprint-0/QLOO_TECHNICAL_FEASIBILITY.md](docs/sprint-0/QLOO_TECHNICAL_FEASIBILITY.md)

## Architecture

```
Qloo           = cultural evidence      (official @qloo/qloo-harness: exec / MCP)
Elasticity     = deterministic measurement (backend; not built yet)
Agent          = investigation + interpretation (not built yet)
Frontend       = strategy interface (Sprint 0: health page only)
```

```
frontend/          Next.js app (server-side calls to the backend only; never to Qloo)
backend/           Fastify API + Qloo adapter + feasibility investigation
  src/qloo/        QlooClient interface, harness transport, envelope normalization, errors
  src/contracts/   Evidence contracts (EvidencePacket etc.) derived from the verified Qloo contract
  src/feasibility/ Sprint 0 evidence-collection workflow
  scripts/         qloo-feasibility.ts (live investigation entry point)
packages/shared/   Types shared across the frontend/backend boundary
docs/              Architecture, methodology, sprint reports
evals/             Fixture policy and (future) recorded live evidence
```

See [docs/architecture.md](docs/architecture.md).

## Local development

Requirements: **Node ≥ 22.19** (`nvm use`) and **pnpm 10**.

```sh
pnpm install
pnpm dev               # frontend :3000 + backend :4000
pnpm dev:frontend
pnpm dev:backend
pnpm test              # unit + fixture tests (never call live Qloo)
pnpm lint
pnpm typecheck
pnpm build
pnpm check:secrets     # repo + browser-bundle credential scan
pnpm feasibility:qloo  # live Qloo investigation (needs a credential)
```

Open http://localhost:3000. It shows `Backend: connected` when the API is up. `GET http://127.0.0.1:4000/health` returns `{"status":"ok","service":"cultural-elasticity-api"}`.

Docker is optional and used only for backend deployment portability (`docker build -f backend/Dockerfile .`).

## Qloo setup

The backend uses the official harness `@qloo/qloo-harness` 0.1.26, installed as a pinned workspace dependency. You don't need a global install. Useful commands:

```sh
pnpm --filter backend exec qloo doctor            # readiness (no network)
pnpm --filter backend exec qloo explore           # interactive discovery (TTY + model login)
pnpm --filter backend exec qloo exec find_tags --input '{"query":"boutique hotel"}'
```

To enable live calls, either:

```sh
cp .env.example backend/.env    # then set QLOO_API_KEY in backend/.env
# or
pnpm --filter backend exec qloo setup
```

Without a credential, `pnpm feasibility:qloo` prints `LIVE_QLOO_VALIDATION_NOT_RUN`, lists what remains unverified, and exits 3. It never substitutes mocked data.

## ⚠️ Secrets

- **Never commit `QLOO_API_KEY`.** `backend/.env` and every `.env.*` except `.env.example` are gitignored.
- Never put it in frontend code, `NEXT_PUBLIC_*` variables, logs, docs, prompts or test fixtures.
- Only the backend process and its Qloo harness child process may read it.
- `pnpm check:secrets` runs in CI and fails on any leak.

## License

MIT. See [LICENSE](LICENSE).
