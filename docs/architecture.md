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
Cultural Elasticity Methodology  backend/src/methodology                           ← Sprint 2: deterministic, no LLM, no agent, no I/O
  (MethodologyInput: brand + territory representations + rank panels + exemplar profiles + conditioned lists)
      ↓
CulturalElasticityResult         packages/shared/src/methodology.ts                ← position · robustness · coherence · quality · class · trace
      ↓
Future Agent Interpretation      (not built: may choose investigations and explain results, never produce numbers)
      ↓
Frontend (Next.js, Vercel)       ← talks only to the backend; never sees Qloo or its credential
```

Provider-specific shapes (harness envelopes, Qloo entity/tag records, `compare_audiences` passthroughs) exist only in the adapter. Everything from `EvidencePacket` down is provider-independent, so Sprint 0B can change the adapter without touching the engine. See [sprint-1/CULTURAL_EVIDENCE_CORE.md](sprint-1/CULTURAL_EVIDENCE_CORE.md).

**Implemented so far:**

- Sprint 0: the frontend shell, `/health`, the Qloo adapter, the Qloo-side evidence record (`contracts/qloo.ts`) and the feasibility workflow.
- Sprint 1: the canonical `EvidencePacket`, the Cultural Evidence Core, `AnalysisIngredients`, `POST /api/analysis/ingredients` (offline, development only), `/dev/analysis` (development only) and the methodology eval harness.
- Sprint 2: `EvidencePacket.conditionedEntities` (brand-conditioned territory evidence, `ce-evidence/0.2`) end to end; the Cultural Elasticity Methodology v0 (`backend/src/methodology`); the live benchmark capture (`backend/src/capture`, `pnpm capture:elasticity`); `POST /api/methodology/analyze` and `/dev/methodology` (development only); `pnpm eval:elasticity` and `pnpm methodology:jacquemus`. See [sprint-2/CULTURAL_ELASTICITY_METHODOLOGY.md](sprint-2/CULTURAL_ELASTICITY_METHODOLOGY.md).
- Sprint 3: the agentic investigation runtime (`backend/src/agent`). See [sprint-3/AGENTIC_INVESTIGATION_RUNTIME.md](sprint-3/AGENTIC_INVESTIGATION_RUNTIME.md).
- Sprint 4: runtime skills, just-in-time context, representation quality and recovery, concept deduplication, frontier construction, sufficiency v2, the live agent harness (`pnpm eval:agent:live`). Capture configs, feasibility pins and the synthetic world moved to `backend/scripts/`. See [sprint-4/AGENT_COMPETENCE_AND_SKILLS.md](sprint-4/AGENT_COMPETENCE_AND_SKILLS.md).
- Sprint 0B: the hackathon host safety gate (`qloo/environment.ts`), the live Qloo → `EvidencePacket` adapter (`qloo/live-adapter.ts`, written from live output), the pinned live investigation (`feasibility/live.ts`, `live-config.ts`) and the live and recorded eval class (`pnpm eval:live`). The Sprint 1 engine ran on live data unchanged.
- Sprint 5B.1: one query interpretation policy and a deterministic execution gate. See [sprint-5b1/QUERY_INTELLIGENCE.md](sprint-5b1/QUERY_INTELLIGENCE.md).
- Sprint 9C: the brand research workspace becomes the default frontend view (`frontend/src/components/research/`); `frontend/src/lib/research-view.ts` adapts the canonical baseline result without adding evidence, and the Living Atlas moves to `?mode=atlas`. See [sprint-9c/BRAND_FIRST_RESEARCH_WORKSPACE.md](sprint-9c/BRAND_FIRST_RESEARCH_WORKSPACE.md).
- Sprint 5B.2: the Living Atlas product surface and in-process JobManager. See [sprint-5b2/LIVING_ATLAS_IMPLEMENTATION.md](sprint-5b2/LIVING_ATLAS_IMPLEMENTATION.md).
- Sprint 5B.3: Atlas product quality — clarification continuity, return navigation, comparison integrity, evidence attribution, job expiry, public guards, intelligent narrowing, and a recorded live example. See [sprint-5b3/LIVING_ATLAS_PRODUCT_EXCELLENCE.md](sprint-5b3/LIVING_ATLAS_PRODUCT_EXCELLENCE.md).
- Sprint 7A: deployment foundation — persistent backend host, server-to-server auth, visitor admission, reservation-based spend control, health/readiness, and a verified recorded example. See [sprint-7a/DEPLOYMENT_FOUNDATION.md](sprint-7a/DEPLOYMENT_FOUNDATION.md). Jobs remain in-process. A freeze-after-response host is still incompatible.
- Sprint 7B: controlled public launch — observed spend is never truncated, one visitor identity per request, readiness is admission not provider proof, operator-triggered provider probes, runtime pre-call spend bounds. See [sprint-7b/CONTROLLED_PUBLIC_LAUNCH.md](sprint-7b/CONTROLLED_PUBLIC_LAUNCH.md). Public Railway/Vercel publication still needs owner approval.
- Sprint 8A: monotonic runtime spans and latency coverage; eval-only effort/token experiment config; C9 still blocks readiness pending a live gate. Vercel-only is **not** proven. Recommended hosting remains Vercel frontend plus a persistent backend. See [sprint-8a/AGENT_PERFORMANCE_AND_VERCEL_FEASIBILITY.md](sprint-8a/AGENT_PERFORMANCE_AND_VERCEL_FEASIBILITY.md). Do not treat the Workflow/MCP local proofs as hosted compatibility.
- Sprint 8B: live parent tracing (95% span coverage), late-Qloo budget reservation, derived-view memo, focused live C9 pass on L-C2/L-E1 evaluators, SSO-protected Hobby Function preview. Agent stays **`AGENT_MODEL_NOT_READY`** (full 7-case gate not repeated). Vercel-only is **`VERCEL_ONLY_CONDITIONAL`**. See [sprint-8b/LIVE_AGENT_OPTIMIZATION_AND_VERCEL_PROOF.md](sprint-8b/LIVE_AGENT_OPTIMIZATION_AND_VERCEL_PROOF.md).
- Sprint 8C: derived-view memo proven on a live parent (227 s, context assembly 1.4 s), browser E2E restored, hosted Vercel MCP still conditional. See [sprint-8c/VERIFIED_AGENT_PERFORMANCE_AND_VERCEL_RECOVERY.md](sprint-8c/VERIFIED_AGENT_PERFORMANCE_AND_VERCEL_RECOVERY.md).
- Sprint 8D: evidence-first frontier exploration (Channel A before hypotheses; unsupported hypotheses no longer fill the candidate quota). See [sprint-8d/AGENT_RESEARCH_QUALITY_AND_COMPETENCE.md](sprint-8d/AGENT_RESEARCH_QUALITY_AND_COMPETENCE.md).
- Sprint 8E: brand-scoped evidence-base gap, live-eval budget preflight and suite spend guard, live parent re-run (0 invalid actions, 3 PARTIAL), Railway backend deployed with admissions off. Vercel integration not verified. See [sprint-8e/LIVE_AGENT_VALIDATION_AND_RAILWAY_DEPLOYMENT.md](sprint-8e/LIVE_AGENT_VALIDATION_AND_RAILWAY_DEPLOYMENT.md).
- Sprint 8F: GitHub as the intended release source; Vercel Authentication All Deployments; CI path-filtered E2E/Docker; operator Git SHA on `/ops/status`. See [sprint-8f/GITHUB_CONNECTED_DEPLOYMENTS_AND_RELEASE.md](sprint-8f/GITHUB_CONNECTED_DEPLOYMENTS_AND_RELEASE.md).
- Sprint 8F.1: existing Railway and Vercel projects GitHub-connected (`RaulMermans/cultural-elasticity`). Railway source staged `main@4c35a20`; Vercel Git-linked with All Deployments and pre-production-only Git builds. See [sprint-8f1/PLAYWRIGHT_GITHUB_DEPLOYMENT_INTEGRATION.md](sprint-8f1/PLAYWRIGHT_GITHUB_DEPLOYMENT_INTEGRATION.md).
- Sprint 8F.2: Railway `accept-deploy` of that Git source (live SHA `47a20fd`, admissions off). Protected Vercel preview of `deploy/8f2-protected-preview@47a20fd`; anonymous access refused; hosted Vercel→Railway verified while paused. See [sprint-8f2/DEPLOYMENT_ACTIVATION_AND_HOSTED_E2E.md](sprint-8f2/DEPLOYMENT_ACTIVATION_AND_HOSTED_E2E.md).
- Sprint 8D: single-agent research competence — Channel A evidence base before ungrounded hypothesis probes, unsupported hypotheses do not fill the frontier quota, unproductive empty re-probes refused. Frozen evaluators unchanged. Full live gate not run (`LIVE_GATE_BLOCKED_BY_APPROVAL`). See [sprint-8d/AGENT_RESEARCH_QUALITY_AND_COMPETENCE.md](sprint-8d/AGENT_RESEARCH_QUALITY_AND_COMPETENCE.md).

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

## Deployment (GitHub is the source)

| Part | Target | Notes |
| --- | --- | --- |
| frontend | Vercel project `cultural-elasticity` | Next.js Living Atlas. Root directory `frontend/`. Server-only `BACKEND_URL` and `CE_INTERNAL_API_SECRET` on **preview** only. No `NEXT_PUBLIC_` secrets. Vercel Authentication is **All Deployments**. Git is linked to `RaulMermans/cultural-elasticity`. A protected **preview** exists (`deploy/8f2-protected-preview@47a20fd`). Git production builds remain skipped. The production alias is unassigned (`DEPLOYMENT_NOT_FOUND`). |
| backend | Railway `cultural-elasticity-api` | Persistent Docker from `backend/Dockerfile` at the repository root (includes `packages/shared`). One replica, us-east4, 0.5 vCPU / 1 GB, sleep off, `CE_ACCEPT_INVESTIGATIONS=0`. `railway.json` watch paths cover backend/shared/lockfile only. Live source is GitHub `RaulMermans/cultural-elasticity` at `47a20fd` (deployment `77b42d21`). |

The two deploy independently. Do not host `JobManager` on freeze-after-response functions. Jobs, the run store and the spend ledger are in-memory: a Railway restart drops them. Canonical runbook: [sprint-8f2/DEPLOYMENT_ACTIVATION_AND_HOSTED_E2E.md](sprint-8f2/DEPLOYMENT_ACTIVATION_AND_HOSTED_E2E.md). Sprint 8E recovery: [sprint-8e/LIVE_AGENT_VALIDATION_AND_RAILWAY_DEPLOYMENT.md §24](sprint-8e/LIVE_AGENT_VALIDATION_AND_RAILWAY_DEPLOYMENT.md). Production domains and public paid investigations remain unexecuted.

## Validation categories

| Category | Data | Where |
| --- | --- | --- |
| Unit | Synthetic fixtures and mocks | `backend/tests/*.test.ts`, `backend/tests/fixtures/synthetic/` |
| Methodology (offline) | Synthetic EvidencePackets | `evals/fixtures/synthetic/` → `pnpm eval:methodology` |
| Integration | Recorded real harness outputs and the real harness binary (no network) | `backend/tests/fixtures/recorded/`, `feasibility-script.test.ts` |
| Live (captured) | Sanitized hackathon-API captures | `evals/fixtures/live/` → `pnpm eval:live` (offline, structural) |
| Methodology benchmark (captured live) | 6 brands × 6 territories, human-curated labels, brand-level calibration/held-out split | `evals/benchmarks/cultural-elasticity-v0/` → `pnpm eval:elasticity` (offline) |
| Live Qloo | Real credential, real responses, hackathon host only | `pnpm feasibility:qloo [-- --write-fixture]`, `pnpm capture:elasticity [-- --write-fixtures]` |
