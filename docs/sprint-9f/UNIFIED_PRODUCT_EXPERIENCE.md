# Sprint 9F — Unified product experience

## Starting point and evidence boundary

Work started from `origin/main@5182bfcd9252c74222b4ab467c97dedfb44385a8` (Sprint 9E PR #29), with a clean tree. The Sprint 9E single-hypothesis route and `hypothesisAssessment` contract are available. The Sprint 9D Loewe artifact is a live **baseline** result. No new trustworthy single-hypothesis Loewe canary artifact was found in the repository. `LIVE_AGENT_MODEL_VALIDATION_NOT_RUN` and `RESEARCH_USEFULNESS: NOT_EVALUATED` therefore remain the operative statements for this sprint. No paid provider execution was initiated.

## Ownership audit and decisions

| Surface | Decision | Evidence and owner |
| --- | --- | --- |
| `/`, `ResearchApp`, `BrandDiscovery` | KEEP, CONSOLIDATE | Entry to recorded baselines and authorized live brand resolution. A single submitted search uses the existing server `describe` path. The recorded catalog is a quick start, explicitly incomplete as a brand catalog. |
| `ResearchWorkspace`, fingerprint, connections, directions, evidence detail, summary | KEEP | The canonical baseline view, query-scoped qualifiers, user-context isolation and deterministic export already live here. URL sections and items remain backward compatible. |
| `DeepResearchPanel`, handoff routes, `JobManager` | KEEP, CONSOLIDATE | Preview and explicit start remain server-governed. A failed preview stops loading; lost job status stops polling and never silently starts a replacement. The complete finding points to the same summary used by export. |
| `?mode=atlas`, Atlas components | RESTRICT TO ARCHIVED COMPATIBILITY | The global two-product navigation was removed. Existing Atlas deep links and the recorded Jacquemus historical investigation remain readable, with a return to brand research. The active brand journey has no second top-level product mode. Atlas internals remain because recorded result readers, browser tests and historical links still own them. |
| `/dev/*`, synthetic worlds and eval fixtures | RESTRICT TO DEVELOPMENT | Methodology, agent and analysis diagnostics are retained for their tests and evaluation; they are not linked from the primary product journey. |
| Qloo client, baseline repository, agent runtime, shared contracts | KEEP | Canonical source, provenance, deterministic numbers, admission, persisted baseline scans and in-process agent jobs remain in their existing owners. |

Deletion inventory: `ModeNav` and its `.mode-nav` CSS were removed; `ResearchApp` owns the sole primary navigation. References checked in the frontend source, route tests and browser tests. Legacy `?mode=atlas` still resolves, and its recorded example browser regression covers compatibility. Historical artifacts and schemas were not deleted.

## Product journey

1. **Select:** choose a clearly labelled recorded baseline, or submit a brand name when baseline admission is available. Ambiguous Qloo candidates show name, type and Qloo ID; the backend resolves the selected ID again before a scan.
2. **Explore:** fingerprint, connections and directions read the same canonical baseline view. Brand core comes only from observed category tags. A connection is an observation; a direction remains a question.
3. **Investigate:** an authorized session scan can prepare a grounded direction or a clearly labelled user hypothesis. The server verifies scan ownership, identity and provenance. The preview shows the actual question, limits and stored references. Only an explicit start can create a job.
4. **Conclude:** the completed single-hypothesis result shows its qualitative outcome, observed signals, support, uncertainty, next step and source IDs. `WORTH_FURTHER_INVESTIGATION` is a research judgment, never a business opportunity score. Incomplete, failed, cancelled and expired jobs do not become negative cultural findings.
5. **Inspect and export:** the summary and escaped HTML download derive from `buildSummary` over the validated baseline and matching completed agent result. A recorded baseline with no matching completed investigation exports only its actual observations and unvalidated hypotheses.

The URL retains `research`, `view` and `item` for navigation; no scan or job token enters it. Session scan access stays in this tab. In-process agent jobs cannot resume after backend restart.

## Qloo brand search contract and safe fallback

Qloo's [official Entity Search reference](https://github.com/qloo/docs-public/blob/main/reference/get-search.md) documents a text `query`, category `types`, bounded `take` (1–100), `page` (1–100), match sorting and 404/429 outcomes. The installed `@qloo/qloo-harness@0.1.26` `describe` workflow instead uses typed entity resolution and can return `needs_input` with candidates. This product continues to use that narrower verified adapter through `POST /api/brands/resolve`, not a new unaudited direct search endpoint. `resolveBrand` accepts only brand type, requires a clean provider status, exposes ambiguity, and rechecks the exact selected Qloo ID. The API enforces internal authentication, visitor scope, baseline admission, PostgreSQL call reservation and total Qloo call cap. The frontend submits at two characters and at most 200 characters, cancels stale results logically, and makes no lookup for every keystroke. A repeated uncertain scan start reuses its idempotency key.

This is a **submit-to-search safe fallback**, not an autocomplete or proof of partial-name coverage. The installed contract does not establish pagination or a complete candidate catalog for `describe`; no such claim is made. A dedicated autocomplete must first have a typed adapter, verified actual response shape, per-visitor attempt limits and a separately approved paid admission plan. Search and live scan are unavailable under the production default flags. Recorded examples do not pretend to be all Qloo brands.

## Origin, security and lifecycle

`RECORDED` means bundled historical live Qloo evidence, `LIVE` means an authorized current execution, and `SYNTHETIC` is confined to tests and clearly labelled fixtures. User context and a proposed direction add no provider evidence. Only the backend holds Qloo and model credentials, validates handoff, pins the brand ID, checks scan ownership and controls paid admission. The browser never supplies evidence, tools, budgets, model ID or provider settings. React escapes provider text; the HTML export escapes every string. No schema, migration, flag, key, production service or paid provider call changed.

The UI shows the server's actual queued/running stage, then completed/failed/cancelled/expired status. A preview failure has no start control. A lost job or network error stops polling and warns that an uncertain dispatch must not be replayed automatically. Cancellation does not promise a refund. Baseline scans are durable in PostgreSQL; agent jobs and handoff idempotency are process-local.

## Verification and release boundary

The browser suite uses a SYNTHETIC API and never calls Qloo or Haiku. Focused cases cover recorded research, ambiguity and verified IDs, stale response ordering, preview failure, paused admission, keyboard evidence inspection, reduced motion, historical Atlas access, URL navigation and responsive widths. `pnpm --filter frontend exec playwright test --workers=1` passed **50/50** on Node 22. A further SYNTHETIC uncertain paid-start case was added and passed **1/1** after the full run. The recorded journey, keyboard path and responsive checks cover 320, 375, 390, 768, 1440 and 1920px without horizontal overflow. Representative [mobile opening](screenshots/375x812-01-home.png) and [desktop directions](screenshots/1440x900-04-directions.png) are preserved. Other generated screenshots were kept outside the repo; Sprint 9D and 9E artifacts remain unchanged. The summary browser case measured under 50 ms for the deterministic in-browser projection. A full browser performance trace for live provider latency was not taken.

Lint, typecheck, production build and `check:secrets` passed on Node 22. Frontend unit tests passed 71/71. The first backend unit run in the sandbox passed 830/834 and blocked four HTTP cases at `listen EPERM`; the authorized local-loopback rerun passed 833/834 and the remaining offline benchmark-preparation case timed out under heavy local load, then passed alone. A bounded two-worker rerun passed **834/834** backend tests. Offline methodology, agent, query, baseline and Qloo-value evaluations plus offline smoke passed. These are **synthetic or replay** checks, not fresh provider validation. The query eval retains historical adversarial case X06's gold-label mismatch.

An owner-approved isolated PostgreSQL database `ce9f_regression` was created under `/private/tmp` on a private Unix socket with TCP disabled, role `ce9f_operator`, and zero user tables before migration. The first 17-case run passed 16; the real process-restart case timed out while an orphan browser test server consumed a CPU core, and then passed alone after that server stopped. A clean rerun passed **17/17**. No Railway database was contacted. The local cluster was stopped after testing.

The Vercel project was inspected before preview deployment: `ssoProtection.enabled=true` and `deploymentType=all`. Git created a [protected preview](https://cultural-elasticity-qyl9esfkf-raulmermans-projects.vercel.app) for code commit `097fd6318fbc310e52b41a0e327806411d9c1e66`; Vercel reported `READY`, and the repository's anonymous protection probe returned HTTP 401 with `servedApp=false` (`VERCEL_PROTECTION_PROBE_PASS`). The preview is not production. Public paid admission remains OFF; production release and hackathon submission remain pending Sprint 9G.

## Gate summary

| Gate | Status | Limit |
| --- | --- | --- |
| PRODUCT_JOURNEY | PARTIAL | Recorded and synthetic browser journeys pass; a fresh completed Haiku investigation was not run. |
| QLOO_BRAND_DISCOVERY | SAFE_FALLBACK | Explicit submitted `describe` resolution; partial-name coverage and autocomplete remain unverified. |
| AGENT_INTEGRATION | PARTIAL | Existing runtime and handoff retained; no fresh live agent execution. |
| FRESH_HAIKU_COMPETENCE | NOT_RUN | No trustworthy new single-hypothesis canary artifact. |
| RESEARCH_USEFULNESS | NOT_EVALUATED | No blinded human review. |
| EVIDENCE_INTEGRITY | PASS | Canonical baseline and claim validators remain authoritative; offline regressions pass. |
| RECORDED_LIVE_SEPARATION | PASS | Origin labels and export scope checked offline. |
| LEGACY_CONSOLIDATION | PARTIAL | Competing top-level Atlas navigation removed; archived compatibility view remains. |
| ACCESSIBILITY | PARTIAL | Keyboard, reduced motion and responsive browser cases pass; no independent WCAG audit. |
| DATABASE_REGRESSION | PASS | 17/17 on isolated real PostgreSQL. |
| FULL_REGRESSION | PASS | Offline gates and protected preview build pass; live provider gates were outside this sprint. |
| PUBLIC_PAID_ADMISSION | OFF | No production flag changed. |
| PRODUCTION_RELEASE | NOT_DEPLOYED | Sprint 9G decision required. |
| HACKATHON_SUBMISSION | NOT_SUBMITTED | Sprint 9G decision required. |

## Sprint 9G release blockers

- No fresh Haiku single-hypothesis competence artifact or blinded human usefulness review. The Loewe live evidence remains baseline-only.
- Submit-to-search fallback does not establish partial-name search coverage or a complete searchable Qloo catalog; an autocomplete endpoint requires a verified live contract and explicit paid traffic budget.
- Agent jobs and handoff idempotency remain process-local; a backend restart loses them.
- Production paid admissions remain off. Release requires a separate decision, protected preview check and deployment review.
