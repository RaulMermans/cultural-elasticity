# Cultural Elasticity

**Cultural Elasticity measures how far a brand can stretch into a new category, experience, partnership or cultural territory before it stops feeling authentically like itself, using Qloo's cultural evidence.**

Built for the **Qloo Agentic Hackathon**. First test case: **Jacquemus → Boutique Hospitality**.

## Current status: Sprint 3 — Agentic Investigation Runtime

- **Sprint 3** added a single-agent investigation runtime (`backend/src/agent`). The agent interprets the goal (`analyze_move`, `compare_territories`, `explore_frontier`), resolves the brand, discovers and anchors territories, picks exemplars from Qloo evidence, and calls typed, read-only Qloo tools through the official **`qloo mcp`** server. Deterministic code validates every action, chooses each territory's representation strategy and analysis route (full relative / partial / descriptive / insufficient), runs the Sprint 2 methodology only where a valid comparison set exists, bounds the loop, and validates the model's synthesis against the results. The Qloo tool boundary is **live-validated**. The agent model is **not** (`LIVE_AGENT_MODEL_VALIDATION_NOT_RUN`, no model credential); live runs used a deterministic baseline reference policy. See [docs/sprint-3/AGENTIC_INVESTIGATION_RUNTIME.md](docs/sprint-3/AGENTIC_INVESTIGATION_RUNTIME.md).

Earlier sprints:

- **Sprint 2** defined the first evidence-backed methodology (`elasticity-v0.1`). For a brand and up to six candidate territories it reports **relative position** (from single-call Qloo rank panels, aggregated by rank only), **representation robustness** (does the position survive swapping territory exemplars?), **cultural coherence** (shared tag sets, RAW and operational-filtered), **evidence quality** and a **PROVISIONAL classification**: natural adjacency, credible stretch, uncertain / representation-sensitive or cultural break. **No 0–100 score:** the Relative Elasticity Index was rejected for now after its gate failed on a 6-brand live benchmark. Live benchmark results: 51/57 pairwise orderings correct (24/29 on held-out brands, 22/22 strong-vs-weak). See [docs/sprint-2/CULTURAL_ELASTICITY_METHODOLOGY.md](docs/sprint-2/CULTURAL_ELASTICITY_METHODOLOGY.md).

- **Sprint 0B** ran the pinned Jacquemus → Boutique Hospitality investigation against the **Qloo hackathon API** (`https://hackathon.api.qloo.com`) through the official harness. Decision: **CONDITIONAL GO**. G1 (brand) and G2 (territory) pass; profile, audience, ranking and bridge evidence are usable only in reduced form. See [docs/sprint-0/QLOO_TECHNICAL_FEASIBILITY.md](docs/sprint-0/QLOO_TECHNICAL_FEASIBILITY.md).
- **Sprint 1** built the provider-independent `EvidencePacket`, a deterministic ingredient engine and an offline methodology eval harness. It ran unchanged on the first live packet. It produces no score. See [docs/sprint-1/CULTURAL_EVIDENCE_CORE.md](docs/sprint-1/CULTURAL_EVIDENCE_CORE.md).
- **Sprint 0A** was contract-only (no credential). Its findings are kept, labelled historical, in the same feasibility document.

## Sprint 0 — Technical Feasibility

Sprint 0 asks one question: can the official Qloo tooling provide enough real, structured evidence for a defensible Elasticity methodology?

- Result: **CONDITIONAL GO** on live hackathon-API evidence (2026-10-16). Sprint 0A's earlier CONDITIONAL GO was contract-level only.
- Full assessment: [docs/sprint-0/QLOO_TECHNICAL_FEASIBILITY.md](docs/sprint-0/QLOO_TECHNICAL_FEASIBILITY.md)

## Architecture

```
Qloo           = cultural evidence      (official @qloo/qloo-harness: exec / MCP)
Evidence Core  = deterministic ingredients (backend/src/evidence, backend/src/analysis)
Methodology    = Cultural Elasticity v0 (backend/src/methodology; deterministic, no LLM; no 0–100 score)
Agent          = investigation + interpretation (not built yet)
Frontend       = strategy interface (health page + developer pages /dev/analysis, /dev/methodology)
```

```
frontend/          Next.js app (server-side calls to the backend only; never to Qloo)
backend/           Fastify API + Qloo adapter + feasibility investigation
  src/qloo/        QlooClient interface, harness transport, envelope normalization, errors
  src/contracts/   Qloo-side evidence record derived from the verified Qloo contract
  src/evidence/    Canonical provider-independent EvidencePacket, normalization, comparability, quality
  src/analysis/    Deterministic ingredient calculators → AnalysisIngredients
  src/methodology/ Cultural Elasticity Methodology v0 → CulturalElasticityResult
  src/capture/     Sprint 2 pinned live benchmark capture (Qloo → MethodologyInput)
  src/api/         HTTP routes (/health, POST /api/analysis/ingredients, POST /api/methodology/analyze)
  src/feasibility/ Sprint 0 evidence-collection workflow
  scripts/         live runs (qloo-feasibility, elasticity-capture) and offline evals (eval-methodology, eval-live, eval-elasticity)
packages/shared/   Types shared across the frontend/backend boundary
docs/              Architecture, methodology, sprint reports
evals/             Fixture policy, synthetic fixtures, sanitized live Qloo evidence, the cultural-elasticity-v0 benchmark
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
pnpm eval:methodology  # offline methodology evals (synthetic fixtures; not Qloo validation)
pnpm eval:live         # offline structural checks over captured live + recorded fixtures (no network)
pnpm eval:elasticity   # offline methodology benchmark over captured live evidence (no network)
pnpm eval:agent        # offline agent-runtime evals (SYNTHETIC world; not Qloo or live-model validation)
pnpm agent:run -- "Could Glossier move into pottery?" --brand Glossier --territories Pottery --model baseline
                       # one investigation; live Qloo (or --synthetic); --model auto needs ANTHROPIC_API_KEY
pnpm methodology:jacquemus            # Jacquemus × 6 territories through the methodology (offline replay)
pnpm methodology:jacquemus -- --live  # refresh the Jacquemus evidence from Qloo first
pnpm feasibility:qloo  # live Qloo investigation (needs a credential; hackathon host only)
pnpm capture:elasticity -- --write-fixtures   # live benchmark capture (6 brands, ~100 calls)
```

Open http://localhost:3000. It shows `Backend: connected` when the API is up. In development, http://localhost:3000/dev/analysis runs a synthetic fixture through the analysis endpoint, and http://localhost:3000/dev/methodology runs a live benchmark fixture through the methodology (panels, robustness, RAW vs filtered overlap, classification, index gate, trace). `GET http://127.0.0.1:4000/health` returns `{"status":"ok","service":"cultural-elasticity-api"}`.

Docker is optional and used only for backend deployment portability (`docker build -f backend/Dockerfile .`).

## Qloo setup

The backend uses the official harness `@qloo/qloo-harness` 0.1.26, installed as a pinned workspace dependency. You don't need a global install.

**Hackathon keys work only against `https://hackathon.api.qloo.com`**, not `api.qloo.com` or `staging.api.qloo.com`. The harness **defaults to production** unless told otherwise. Never run the `qloo` CLI by hand with a hackathon key unless both `QLOO_BASE_URL` and `QLOO_TRUSTED_BASE_URL` are set to the hackathon origin. The project's own code does this for you and refuses to run otherwise.

To enable live calls:

```sh
cp .env.example backend/.env    # then set QLOO_API_KEY; keep QLOO_API_BASE_URL=https://hackathon.api.qloo.com
pnpm feasibility:qloo
```

`pnpm feasibility:qloo` checks, in order: credential present → `QLOO_API_BASE_URL` is exactly the hackathon origin (fails closed with `QLOO_HACKATHON_BASE_URL_REQUIRED` / `QLOO_WRONG_ENVIRONMENT`, no default) → the harness itself, offline via `qloo doctor`, reports that origin (`LIVE_QLOO_HOST_VERIFIED`). Only then does it call Qloo. Exit codes: 3 = `LIVE_QLOO_VALIDATION_NOT_RUN` (no key), 4 = `LIVE_QLOO_HOST_NOT_VERIFIED` (nothing sent). It never substitutes mocked data.

Offline harness inspection is safe without a key:

```sh
pnpm --filter backend exec qloo doctor            # readiness (no network without --network)
```

## ⚠️ Secrets

- **Never commit `QLOO_API_KEY`.** `backend/.env` and every `.env.*` except `.env.example` are gitignored.
- Never put it in frontend code, `NEXT_PUBLIC_*` variables, logs, docs, prompts or test fixtures.
- Only the backend process and its Qloo harness child process may read it.
- `pnpm check:secrets` runs in CI and fails on any leak.

## License

MIT. See [LICENSE](LICENSE).
