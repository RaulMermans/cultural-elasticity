# Cultural Elasticity

**Cultural Elasticity measures how far a brand can stretch into a new category, experience, partnership or cultural territory before it stops feeling authentically like itself, using Qloo's cultural evidence.**

Built for the **Qloo Agentic Hackathon**. First test case: **Jacquemus → Boutique Hospitality**.

## Deployment release contract (permanent)

Before merging a release, run `pnpm check:deployment-config` and follow [the Vercel/Railway release runbook](docs/operations/DEPLOYMENT_RELEASE_CONTRACT.md). The offline guard prevents checked-in config regressions; **remote platform settings and hosted behavior must be verified separately**. Railway follows `main` and can deploy after each merge; Vercel's prior preview-only ignored-build rule must never be restored accidentally. Public exposure and paid investigations remain independent approval gates.

## Sprint 9F — One research journey

The brand research workspace is the primary product journey: submit a brand name to the existing admission-gated Qloo identity resolver or open clearly labelled recorded research; inspect the cultural landscape; preview and explicitly start an authorized investigation; review validated findings and export the same research brief. The historical Living Atlas is retained for archived deep links and the recorded Jacquemus investigation, without a competing top-level product navigation. Public paid admission remains off. See [the Sprint 9F audit and contract](docs/sprint-9f/UNIFIED_PRODUCT_EXPERIENCE.md).

## Sprint 9C — Brand-first research workspace

The default product view is now a brand research workspace: explore a brand, read its cultural fingerprint, inspect each Qloo connection's evidence, review directions worth investigating with their limits, and download a deterministic research summary. It is a view over the canonical `ce-brand-baseline` result: no new evidence, scores, model calls or provider calls. Recorded Loewe research (real stored evidence) opens instantly; the Living Atlas remains available at `?mode=atlas`. See [docs/sprint-9c/BRAND_FIRST_RESEARCH_WORKSPACE.md](docs/sprint-9c/BRAND_FIRST_RESEARCH_WORKSPACE.md).

## Sprint 9D — Agentic research workflow

An authorized baseline scan can now hand a selected direction to the existing governed agent runtime after the backend verifies the stored scan, source references, and canonical brand ID. The workspace shows research progress and validated findings; the Atlas offers a read-only side-by-side comparison; the strategic brief is deterministic and source-linked. Public paid investigations stay disabled because agent jobs and the handoff idempotency map remain in-process. `pnpm eval:qloo-value` audits seven frozen recorded-live Qloo results; its LLM-only comparison arm has not run. See [docs/sprint-9d/AGENTIC_INTELLIGENCE_AND_STRATEGIC_DECISION.md](docs/sprint-9d/AGENTIC_INTELLIGENCE_AND_STRATEGIC_DECISION.md).

## Sprint 9B — Brand baseline and PostgreSQL

The new brand-first panel resolves a Qloo brand, runs a bounded deterministic baseline without an LLM, and displays evidence-backed associations and candidate territories. New baseline scans use PostgreSQL with durable call reservations, idempotent creation, and restart-safe result retrieval. The existing agent remains admission-gated and in-memory. Production baseline admission defaults to off. See the [Sprint 9B source of truth](docs/sprint-9b/BRAND_INTELLIGENCE_AND_DURABLE_INFRASTRUCTURE.md) for the schema, deployment, backup/restore, live canary result, and limitations.

Sprint 9B.1 replaced the result with `ce-brand-baseline/0.2`: an observed cultural profile, facet themes, and qualified territory hypotheses, with generic Qloo entity types kept as query-scoped rather than discarded. See the [Sprint 9B.1 report](docs/sprint-9b1/CULTURAL_INTELLIGENCE_GROUNDING_REPORT.md).

Local commands: `pnpm db:migrate`, `pnpm test:db` (real isolated PostgreSQL), `pnpm eval:brand-baseline` (SYNTHETIC plus offline replay of recorded live evidence; `pnpm --filter backend eval:brand-baseline:report` writes the audit report), and `pnpm smoke:baseline` (real PostgreSQL with SYNTHETIC Qloo transport). A live canary is a separate, explicitly budgeted operator action.

## Current status: Sprint 8F.2 — Deployment activation and hosted E2E

- **Sprint 8F.2** applied the staged Railway GitHub source and created a protected Vercel preview. The existing API service now runs GitHub `main@47a20fd` (docs-only vs the 8F.1 pin `4c35a20`), one replica, admissions **off**, remote smoke 23/23. The existing Vercel project has a **preview** deployment of `deploy/8f2-protected-preview@47a20fd` with Authentication **All Deployments**; anonymous visitors are refused; the production alias remains `DEPLOYMENT_NOT_FOUND`. Hosted Vercel→Railway with the correct secret is admissions-paused (503, no paid call). GitHub Actions remains billing-blocked. Public hackathon release is **not** ready. The agent stays **`AGENT_MODEL_NOT_READY`**. See [docs/sprint-8f2/DEPLOYMENT_ACTIVATION_AND_HOSTED_E2E.md](docs/sprint-8f2/DEPLOYMENT_ACTIVATION_AND_HOSTED_E2E.md).

## Previous status: Sprint 8F.1 — Playwright GitHub deployment integration

- **Sprint 8F.1** connected the existing GitHub repository to the existing Railway and Vercel projects, staged Railway Git at `main@4c35a20`, and linked Vercel with All Deployments and pre-production-only Git builds. `accept-deploy` and the first preview were left for 8F.2. See [docs/sprint-8f1/PLAYWRIGHT_GITHUB_DEPLOYMENT_INTEGRATION.md](docs/sprint-8f1/PLAYWRIGHT_GITHUB_DEPLOYMENT_INTEGRATION.md).

## Previous status: Sprint 8F — GitHub-connected deployments and release readiness

- **Sprint 8F** made GitHub the intended source of truth, set Vercel Authentication to **All Deployments**, extended offline CI, and added an operator-only Git SHA on `/ops/status`. At 8F close, Railway GitHub App access and Vercel Git linking were still blocked. See [docs/sprint-8f/GITHUB_CONNECTED_DEPLOYMENTS_AND_RELEASE.md](docs/sprint-8f/GITHUB_CONNECTED_DEPLOYMENTS_AND_RELEASE.md).

## Previous status: Sprint 8E — Live agent validation and Railway deployment

- **Sprint 8E** brand-scopes the frontier evidence base, gates every paid live eval on an owner-approved ceiling (`pnpm eval:agent:budget`; the full gate's reserved exposure is $28.08), and re-ran the live Jacquemus parent: 0 invalid actions, 3 PARTIAL, 0 FULL, 256 s, $0.017. The backend runs on Railway (one service, one replica, admissions **off**, remote smoke 22/22). Vercel integration was **not verified**. The agent stays **`AGENT_MODEL_NOT_READY`** (`LIVE_GATE_BLOCKED_BY_APPROVAL`). See [docs/sprint-8e/LIVE_AGENT_VALIDATION_AND_RAILWAY_DEPLOYMENT.md](docs/sprint-8e/LIVE_AGENT_VALIDATION_AND_RAILWAY_DEPLOYMENT.md).

## Previous status: Sprint 8B — Live agent optimization and Vercel proof

- **Sprint 8B** traces a live Haiku+Qloo parent investigation (95% span coverage), reserves Qloo budget at dispatch, memos duplicate derived views, and validates C9’s late-answer grader on live L-C2 and L-E1 (`TAG_TYPE_EVIDENCE_VALID:pass`). A protected Hobby preview proves Node 22 Functions and fake-MCP subprocesses. Official Workflow SDK compiles locally; hosted step registration failed. The agent stays **`AGENT_MODEL_NOT_READY`** (full 7-case gate not repeated). Vercel-only is **`VERCEL_ONLY_CONDITIONAL`**. See [docs/sprint-8b/LIVE_AGENT_OPTIMIZATION_AND_VERCEL_PROOF.md](docs/sprint-8b/LIVE_AGENT_OPTIMIZATION_AND_VERCEL_PROOF.md). No commit/push without owner approval.

## Previous status: Sprint 8A — Agent performance and Vercel feasibility

- **Sprint 8A** established a performance baseline (spans, coverage, eval-only effort/token config) and local Vercel MCP/Workflow proofs. C9 still blocked live readiness. Vercel-only was **not** proven. See [docs/sprint-8a/AGENT_PERFORMANCE_AND_VERCEL_FEASIBILITY.md](docs/sprint-8a/AGENT_PERFORMANCE_AND_VERCEL_FEASIBILITY.md).

## Previous status: Sprint 7A — Deployment foundation

- **Sprint 7A** prepares a public-deployment-capable Living Atlas without publishing it. The backend remains one persistent Node 22 process (`JobManager` is still in-memory). Frontend and backend are intended to deploy separately. See [docs/sprint-7a/DEPLOYMENT_FOUNDATION.md](docs/sprint-7a/DEPLOYMENT_FOUNDATION.md). Owner approval is required before any paid host, DNS or credential change. The agent stays **`AGENT_MODEL_NOT_READY`**.

## Previous status: Sprint 5B.3 — Living Atlas product quality

- **Sprint 5B.3** corrects clarification continuity, return navigation, comparison integrity, evidence attribution, job expiry, public execution guards, and vague narrowing. A recorded Qloo-backed example can be opened without a provider call. See [docs/sprint-5b3/LIVING_ATLAS_PRODUCT_EXCELLENCE.md](docs/sprint-5b3/LIVING_ATLAS_PRODUCT_EXCELLENCE.md). The agent stays **`AGENT_MODEL_NOT_READY`**.

## Previous status: Sprint 5B.2 — The Living Atlas

- **Sprint 5B.2** is the product surface on the unchanged agent and query layer. A natural-language question goes through Haiku, the execution gate, and an in-process job. The Living Atlas draws the investigation as a lineage, not a measured map. See [docs/sprint-5b2/LIVING_ATLAS_IMPLEMENTATION.md](docs/sprint-5b2/LIVING_ATLAS_IMPLEMENTATION.md) and the design skill [`.agents/skills/living-atlas-design/SKILL.md`](.agents/skills/living-atlas-design/SKILL.md).
- Jobs live in the backend process. A restart drops them. This is not a serverless background worker.
- The agent itself stays **`AGENT_MODEL_NOT_READY`** (Sprint 5A.2). Query-layer readiness stays the Sprint 5B.1 result: **`QUERY_LAYER_READY`**, with the limitations recorded there.

## Previous status: Sprint 5B.1 — Query Intelligence

- **Sprint 5B.1** adds the natural-language control layer on top of the unchanged agent:
  - `POST /api/agent/interpret` (dry run), `/api/agent/query` and `/api/agent/follow-up`, sharing one interpretation policy: one Claude Haiku 5.5 structured interpretation, then a deterministic execution gate;
  - typed follow-ups (refine, switch, correct, return), linked as parent/child runs validated against server state;
  - explicit typed states for clarification, unsupported operations (competitor comparison is recognized, not executed), partial support, unavailable context and injection refusal;
  - the Living Atlas contract (`ce-query/0.1`) for Sprint 5B.2.
- Real Haiku interpretation on the frozen 58-case manifest (dry run, no Qloo): held-out targets met in 4/4 runs, 0 unsafe handoffs, ≈ $0.0003 and ≈ 1.5 s per query. Query layer: **`QUERY_LAYER_READY`** (gold labels pending owner review). The agent itself stays **`AGENT_MODEL_NOT_READY`** (5A.2). See [docs/sprint-5b1/QUERY_INTELLIGENCE.md](docs/sprint-5b1/QUERY_INTELLIGENCE.md).

### Sprint 5A.2 — Frontier Reliability

- **Sprint 5A.2** fixed the 5A.1 frontier regressions generically. It adds:
  - evidence-ranked probe types (namespace evidence, `nextProbe`);
  - runtime anchoring of a territory's own concept once it returns members;
  - validated alternate anchors;
  - dedup v2, so discovery co-occurrence is no longer duplication;
  - degraded instead of failed analysis on an incomplete optional rank panel;
  - 13 runtime evaluators and `pnpm eval:agent:replay`.

  Live final run (7/7 cases, case-matched baseline, 3-run stability, controlled scenario):
  - SAFETY 13/13;
  - competence 8/9, with the frontier criteria passing for the first time (L-E1 and L-E2);
  - controlled scenario 3 × FULL; 6 valid / 0 invalid FULL;
  - 12 useful investigations against the baseline's 8.

  Gate decision: **`AGENT_MODEL_NOT_READY`**, on C9. A timed-out Qloo call's late answer was recorded as evidence; this is fixed afterwards and not yet live-validated. See [docs/sprint-5a2/FRONTIER_RELIABILITY.md](docs/sprint-5a2/FRONTIER_RELIABILITY.md).

### Sprint 5A.1 — Haiku Investigation Reliability

- **Sprint 5A.1** made Haiku's investigations more reliable, without new agents, models or budgets. It added:
  - bounded entity-type probing;
  - shared-type planning for comparisons;
  - corrected completion arithmetic, with references anchored at proposal;
  - a fixed frontier evidence base with a canonical candidate pool;
  - canonical candidate records;
  - six deterministic runtime evaluators;
  - **readiness gate v3**, which requires SAFETY *and* COMPETENCE (including a controlled, Qloo-verified FULL scenario and prospectively defined frontier criteria).

  Live (7/7 cases, case-matched baseline, 3-run stability, controlled scenario):
  - L-C1 and L-C2 now reach **semantically valid FULL**;
  - the controlled scenario reaches FULL;
  - 7 valid / 0 invalid FULL results;
  - 0 accepted unsupported claims.

  Gate decision: **`AGENT_MODEL_NOT_READY`**. Safety passes. Competence fails on a frontier probing regression and on the frontier criteria. See [docs/sprint-5a1/INVESTIGATION_RELIABILITY.md](docs/sprint-5a1/INVESTIGATION_RELIABILITY.md).

### Sprint 5A — Haiku Agent Reliability and Semantic Evidence Quality

- **Sprint 5A** made Claude Haiku 5.5 (`claude-haiku-5-5`) the sole production agent model: no fallback, no escalation. It added a **SemanticComparisonValidator**: a FULL relative analysis now also needs a culturally meaningful comparison set, so venue-listing attributes and single-exemplar ties are never references, and an honest PARTIAL replaces a misleading FULL. It also added:
  - a deterministic reference plan, with bounded deferral of premature analysis;
  - state-grounded representation recovery;
  - a `focus` block at the top of every decision context;
  - grounded synthesis findings with per-territory numeric grounding;
  - a readiness gate that requires complete, case-matched, single-model evidence and measured frontier stability.

  Live (7/7 cases, case-matched baseline, 3-run frontier stability):
  - 0 semantically invalid FULL results;
  - 0 accepted unsupported claims;
  - model synthesis accepted in 7/7 cases (5 first attempt, 2 after one repair; Sprint 4: 0/7);
  - about $0.011 per case.

  The gate's hard checks all pass, but the sprint decision is **`AGENT_MODEL_NOT_READY`**: the final run demonstrated no meaningful reference set (0 FULL; a recovery side effect) and frontier stability is weak. See [docs/sprint-5a/HAIKU_AGENT_RELIABILITY.md](docs/sprint-5a/HAIKU_AGENT_RELIABILITY.md).
- **Sprint 4** added versioned runtime skills, just-in-time context, representation quality, concept deduplication and the live agent evaluation. See [docs/sprint-4/AGENT_COMPETENCE_AND_SKILLS.md](docs/sprint-4/AGENT_COMPETENCE_AND_SKILLS.md).

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
  src/agent/       Agentic investigation runtime: skills, typed tools, state, sufficiency, claim validation
  src/api/         HTTP routes (/health, analysis, methodology, POST /api/agent/analyze + /continue)
  scripts/         live runs and offline/live evals (eval:methodology, eval:live, eval:elasticity, eval:agent, eval:agent:live)
  scripts/capture/     Sprint 2 pinned live benchmark capture (eval tooling, outside the production build)
  scripts/feasibility/ Sprint 0/0B evidence-collection workflow and pins (eval tooling)
  scripts/synthetic/   SYNTHETIC Qloo world transport for tests and eval:agent
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
                       # one investigation; live Qloo (or --synthetic); --model auto runs Haiku 5.5 and needs ANTHROPIC_API_KEY
pnpm eval:agent:live -- --arms baseline,model --stability 3 --out backend/feasibility-output/sprint5a2-live/<name>
                       # live readiness run (live Qloo + Haiku; arms reported separately)
pnpm eval:agent:replay -- <results dir>   # offline replay of current evaluators over stored live results
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
