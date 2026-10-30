# AGENTS.md

Rules for any human or AI agent working in this repository.

## Priorities

**Qloo evidence first. Methodology second. Agent third. Interface fourth.** Methodology comes before polish.

## Non-negotiables

1. **Never fabricate Qloo evidence.** No invented entity IDs, tags, affinities, schemas or "example" responses presented as real. Synthetic test fixtures must be labelled SYNTHETIC, use placeholder IDs, and live under `backend/tests/fixtures/synthetic/` (unit tests) or `evals/fixtures/synthetic/` (methodology evals and the agent's synthetic world, `"fixtureType": "synthetic"`). Agent eval scenarios live in `evals/agent/` and are labelled synthetic too.
2. **Deterministic code owns every number.** Scores, rankings, overlaps and any future Elasticity metric are computed by tested code from Qloo evidence.
3. **LLMs may not invent core scores.** The agent may choose what to investigate and may interpret an evidence packet. It may not produce, adjust or "estimate" a metric.
4. **No secrets in the repo, logs, prompts, docs or fixtures.** `QLOO_API_KEY` is read only by the backend and the Qloo harness child process. Run `pnpm check:secrets` before committing.
5. **Report mocked and live validation separately.** Never describe fixture-based results as live, and never call work complete on mocks when live validation is required. If live validation could not run, say `LIVE_QLOO_VALIDATION_NOT_RUN` and list what is unverified.
6. **Do not present unsupported metrics as fact.** Qloo exposes no graph distance. Use "Cultural Distance Proxy" and "Qloo-supported intermediate cultural signals", never "distance" or "path".
7. **Preserve provenance.** Every Qloo-derived number keeps the correlation ID of the call it came from, and affinities are compared only within one call.

## Generalization (permanent, from Sprint 3)

1. **No benchmark-specific brand, territory, exemplar or label** may be encoded in production methodology or agent logic.
2. **Benchmark data may only be imported by evaluation code.** Direction is eval → product, never product → eval (`tests/agent-generalization.test.ts` enforces it).
3. **The runtime resolves entities and territory representations dynamically** from Qloo evidence.
4. **Different cases may follow different evidence and methodology routes.** Never force one fixed workflow on every territory.
5. **Unsupported evidence degrades capability; it never triggers fabrication.** Missing measures are reported as unavailable, never as zero or prose.
6. **LLM output never owns deterministic numerical truth.** Routes, positions, robustness, quality and classes come from code.
7. **Every agent claim must trace to a deterministic result or to Qloo evidence.** Model synthesis passes the claim validator or is replaced by the deterministic template.
8. **Adding a new Qloo-resolvable brand or territory must not require methodology code changes.**

## Agent runtime and skills (permanent, from Sprint 4)

1. **The runtime owns truth and control; the model proposes actions.** State, permissions, tool availability, budgets, retries, validation, methodology, sufficiency, claim validation and stopping belong to code.
2. **Skills are bounded, reusable competencies, not autonomous agents.** Each declares its tools, actions, context needs, budget, stopping conditions and failure modes (`backend/src/agent/skills/`).
3. **Tools stay atomic and typed.** A skill groups tools; it never becomes a tool or a script.
4. **Only relevant skills and tools enter model context.** Skills are selected just in time from state; the executor refuses tools no active skill exposes.
5. **No benchmark-specific logic in the production runtime.** Capture configs, feasibility pins and the synthetic world live in `backend/scripts/`, never in `backend/src/`.
6. **Representation quality must be validated** (`representation-quality.ts`) before a panel is used; a weak panel is never forced through to reach a fuller route.
7. **Different cases may use different evidence paths** (entity types, recovery strategies, concept-only evidence).
8. **Unsupported cases remain unsupported.** Hypotheses without Qloo support are dropped, never analyzed as real.
9. **Runtime decisions and skill versions must be traceable** (per turn and per tool call).
10. **Skill improvements require eval evidence before promotion.** Changing a skill's procedure, tools, stopping conditions or output semantics bumps its version.
11. **No automatic self-modification.** No skill, prompt or memory is edited by the runtime or the model; `SkillEvalOutcome` is an offline review input only.
12. **No model output may override deterministic methodology.** Model judgments (semantic relevance, concept duplicates) are advisory, stored apart from Qloo evidence, and combined only by explicit rules that can remove, never add, support.

Agent runs report the model honestly: a run driven by the scripted model or the baseline reference policy is not a live agent-model validation (`LIVE_AGENT_MODEL_VALIDATION_NOT_RUN`).

## Model and semantic validity (permanent, from Sprint 5A)

1. **Claude Haiku 5.5 (`claude-haiku-5-5`) is the sole production model.** No fallback model, no escalation, no router. `AGENT_MODEL` may override it for development only; readiness is judged on Haiku runs alone, and model id and effort are recorded in every trace.
2. **Structural validity is not semantic validity.** A FULL relative analysis also requires the SemanticComparisonValidator (`semantic-comparison.ts`) to accept its comparison set. Venue-listing attributes and operational tags are never references, and a reference needs a Qloo tie to the question. A model judgment can veto a reference; it can never make one meaningful.
3. **An honest PARTIAL beats a misleading FULL.** Do not optimize the FULL rate. Evaluations report semantically valid and invalid FULL results and meaningful PARTIAL results separately from the historical route mix.
4. **Readiness needs complete, case-matched evidence.** Every prescribed case must run on the readiness model, errors and omissions stay in the denominator, the baseline covers the same cases, and frontier stability is measured. Anything less is `AGENT_MODEL_NOT_READY`.
5. **Numbers are grounded per scope.** A claim may only use values of the territory (and the result fields) it is about. Validator changes need evidence from traces: fix a proven false positive, never relax a rule to raise acceptance.

## Investigation reliability (permanent, from Sprint 5A.1)

1. **Probing is bounded and honest.** At most 3 empty entity types per concept and 6 empty probes per territory with no member (`probe-policy.ts`); then the concept or territory is unsupported. Only answers Qloo returned as empty count: a failed call is never a probe, and a partial or degraded empty answer is "unreliable". A type that returned members is never refused.
2. **Comparisons plan a shared entity type before anchoring** (`representation-alignment.ts`). Alignment is steered (guidance plus one bounded anchor deferral per target), never forced: no type conversion, no tag-as-entity, no cross-call comparison. With no common type, the result stays PARTIAL.
3. **Completion arithmetic is deterministic and counts the open turn** (`turnsAvailable`, `completionCost`). Already-probed usable references need no probe turn. The last turn is reserved for analysis.
4. **Frontier discovery has two stages.** A fixed evidence base (a fixed related take, the first related profiles in Qloo order) feeds a canonical, deduplicated, stably ordered candidate pool, and the model chooses from it or adds hypotheses that Qloo must validate. A candidate's canonical identity is its grounding tag. Aliases are recorded as uncertain and never merged to raise overlap.
5. **Readiness is SAFETY and COMPETENCE** (`agent-readiness-gate-v3`). Competence criteria are defined before a live run and versioned (`evals/agent/stability-criteria.json`). A green gate is never overridden to red by hand: a missing criterion is added to the gate.
6. **Controlled scenarios use real, verified Qloo evidence** (`evals/agent/controlled-cases.json`). They are re-verified live before each run (`PRECONDITION_CHANGED` otherwise) and kept outside the prescribed-case denominator.

## Frontier reliability (permanent, from Sprint 5A.2)

1. **Probe types are ranked by observed evidence** (`probe-policy-v2`). The order is: members for the concept, then members for the same tag namespace, then the comparison's shared type, then structural observations, then bounded exploration. There is no fixed place- or brand-first order once evidence exists.
2. **Namespace evidence is scoped, never proof.** It applies only within its namespace and run. A namespace's English name never implies an entity type. A type barren for two other concepts of a namespace is deferred, not banned.
3. **Grounded identity is preserved.** A candidate whose grounding tag returns members is anchored to it by the runtime. An alternate anchor must be the same concept (same canonical name or an alias), with observed members, after the grounding tag returned none. A different concept is a different candidate. Every anchoring is recorded in `trace.anchorDecisions`.
4. **Discovery artefacts are not evidence.** Co-occurrence in the profiles a candidate was discovered from never makes two concepts duplicates.
5. **Optional evidence degrades; it never invalidates.** An incomplete optional rank panel is excluded with a limitation. The primary panel is never dropped.
6. **No support twice is not stability.** Runs with no supported candidate score 0 supported overlap (`frontier-stability-metrics-v3`). Stored live results are rescored only by replay (`pnpm eval:agent:replay`), alongside the as-run reports, never in place of them.
7. **A failed call is never evidence, even if Qloo answers late.** A tool call that timed out has its late answer discarded (counted against the budget, never cached or recorded).

## Query layer (permanent, from Sprint 5B.1)

1. **One interpretation policy.** Natural-language requests enter through `backend/src/agent/query/` (`/interpret`, `/query`, `/follow-up`): one Haiku structured interpretation (no tools, ≤ 1 schema repair), then the deterministic gate (`gate.ts`). The runtime receives the gate's interpretation through `applyInterpretation`, shared with the `interpret_request` tool; never interpret the same query twice.
2. **Only EXECUTABLE runs.** The model proposes; the gate approves. No user text or model output may authorize tools, budgets, evidence, entity ids or run ids, and the proposal schema has no field for them. System directives are refused, never executed, and never answered with a benign question.
3. **No keyword, brand or category routing** in production query code. Routing reads typed proposal fields, the caller's structured fields and server state only. Explicit fields always win; a contradiction is a clarification, never a merge.
4. **Recognized is not supported.** Deferred operations (competitor comparison, whitespace, bridges, portfolios) are reported as unsupported. A smaller alternative is offered as non-equivalent and runs only on confirmation. A compound or partially supported request is never reported as complete.
5. **Context comes from the server.** A follow-up is a new bounded child run linked to its parent; only the brand identity is carried over, and it is re-resolved in Qloo. Classifications, positions and evidence are never inherited. A parent the process no longer holds is `CONTEXT_UNAVAILABLE`, never reconstructed. `/continue` is only for NEEDS_INPUT clarifications.
6. **Query evals are labelled honestly.** The offline `pnpm eval:query` replays gold-derived proposals; it is never language-understanding evidence. `--live` is `LIVE_HAIKU_INTERPRETATION` (no Qloo call), never agent or Qloo validation. HELD_OUT and ADVERSARIAL cases stay frozen (`evals/query/manifest.json`), and changes are recorded as amendments with the original results kept. Failures are fixed generally, never as case rules.

## Living Atlas (permanent, from Sprint 5B.2)

1. **The Living Atlas presents validated query responses.** It does not own scores, evidence, or lineage. Since Sprint 9C it is the optional exploration view (`?mode=atlas`); the default product view is the brand research workspace (below).
2. **Geometry is investigation lineage.** An edge means investigated-from. Spacing is not cultural distance, affinity, confidence, elasticity, or a recommendation.
3. **Visual decisions follow** `.agents/skills/living-atlas-design/SKILL.md` (version 7). That is a development skill, not a runtime investigation skill. Tokens live in `frontend/src/app/globals.css` and match the skill. The product art direction is Cultural Observatory.
4. **Jobs are in-process by default.** `POST /api/agent/jobs` detaches work from the HTTP request inside one Node process. Without `CE_DURABLE_AGENT=1` they are not durable across restarts (Sprint 10C adds the opt-in durable mode below). They are never safe on a host that freezes after the response. The browser talks only to the Next.js routes.
5. **A system directive cannot be confirmed.** A rejected directive does not become a confirmable alternative, and a second confirmation is refused.
6. **Not investigated is not unsupported.** Incomplete or interrupted is not "no usable evidence." Evidence support is not an investment recommendation.

## Brand research workspace (permanent, from Sprint 9C)

1. **Brand-first is the default UX.** The research network (design skill version 7) is the only view over the canonical baseline result; the section workspace was removed. It never adds evidence, scores, ranks by opportunity, or calls a model or Qloo to display a result.
2. **Core versus adjacent is never inferred from Qloo evidence alone** (`research-position/v1`). The brand core comes only from Qloo's category tags for the brand; adjacency only from clearly labelled user context, which never changes evidence.
3. **The product ships no recorded research.** The bundled Loewe, Jacquemus and comparative demos were removed (Sprint 9K); research comes only from the user's own scans. *(Amended in Sprints 9M and 9N: the home page links two static reports recorded from live runs on 2026-10-29, Patagonia and Crocs. They are byte-identical to stored evidence, dated, labelled as recorded, and opening them runs nothing. No interactive recorded demo is bundled.)* Stored live evidence lives in `evals/` and `docs/` for tests only. The downloadable report (`network-report.ts`) restates results on the board: counts and per-comparison ranks, never a cross-call score or forecast.
4. **No scan token in a URL**, and no enabled paid action while its admission is paused. Canonical record: `docs/sprint-9c/BRAND_FIRST_RESEARCH_WORKSPACE.md`.

## Agentic research handoff (Sprint 9D)

1. **A baseline direction is a hypothesis.** The server rereads the authorized scan, verifies territory ownership and supporting provenance, and pins the canonical Qloo brand ID before using the existing agent runtime. Selection does not upgrade support.
2. **The research finding and brief are projections.** They preserve source scope, validated claims and recorded/live origin. Comparison reads completed same-brand results only and makes no provider call or cross-call numerical ranking. Canonical record: `docs/sprint-9d/AGENTIC_INTELLIGENCE_AND_STRATEGIC_DECISION.md`.
3. **Agent jobs are in process unless durable mode is on** (Sprint 10C). Handoff idempotency and comparative plans still disappear on backend restart. Public paid investigations remain disabled pending separate readiness and durability decisions. *(Superseded for the approved window 2026-10-29 → 2026-11-06T05:00Z by the Sprint 9M public evaluation below; outside an approved evaluation this rule still holds.)* The Sprint 9D benchmark has no LLM-only arm yet; do not claim measured comparative Qloo value.

## Comparative handoff and cross-domain relationships (Sprint 9I)

1. **A comparison starts only from a completed investigation, through the server.** `/api/agent/handoff/compare/{options,preview,jobs}` re-read the scan by its token, the parent job by its token, and sibling investigations by scan ownership. The browser sends identifiers only. Target, references, types, evidence and budgets come from the server. The run is the existing `compare_territories` runtime.
2. **A reference type is evidence, never a declaration** (`comparative-bridge.ts`). It needs a validated representation from a completed investigation, or Qloo returning the tag in the profile of an entity of that type. A missing type is `REFERENCE_TYPE_UNVERIFIED`. It is never copied from the target. Baseline tag directions are shown but cannot be selected until investigated.
3. **Eligibility is not authorization.** Paid admission is decided at job dispatch (`admitCreate`, spend reservation) and per call by the runtime, never by the gate or the browser.
4. **The finished run is checked against the authorized plan** (`validateComparativeOutcome`). A brand change, missing target, mixed panel, unsourced or unrepresented ranked territory, or a target concept drift is `INTEGRITY_FAILED` and shows no position. Only a numeric `position` counts as ranked, and `INSUFFICIENT_EVIDENCE` is not a relative class.
5. **Cross-domain relationships explain; they never rank** (`packages/shared/src/connections.ts`). `DIRECT_QLOO_OBSERVATION`, `DERIVED_PROFILE_OVERLAP` and `AGENT_INTERPRETATION` stay separate, and every relationship is `rankable: false`. A reference of another entity type is qualitative evidence with an explicit comparison limitation, never a cross-type score.
6. **The recorded comparative demo is built, not written** (`backend/scripts/demo/build-recorded-comparative.ts`) from live-origin evidence with source checksums. It must not contain a ranking that no recorded run produced. Canonical record: `docs/sprint-9i/CROSS_DOMAIN_COMPARATIVE_RESEARCH_REPORT.md`.

## Paid access and live validation (permanent, from Sprint 9J)

1. **Internal auth is not user authorization.** The Next.js proxy injects `CE_INTERNAL_API_SECRET` for every visitor. Every paid start also needs the scoped, expiring operator credential (`CE_PAID_OPERATOR_TOKEN`, `x-ce-paid-operator`), checked on Railway at dispatch. It is required on any public runtime and fails closed. Never open admission on a build without this gate.
2. **The browser never holds paid authority beyond the operator's own cookie.** It is forwarded only on paid POST routes. Admission views show *paused* to anonymous visitors.
3. **One run-wide Qloo ceiling per approved run** (`CE_PROCESS_QLOO_CALL_LIMIT`) covers every phase, retries and uncertain attempts. It, the spend ledger and idempotency are process-local: a restart resets them, so no unattended or public paid launch is allowed without durable accounting and a provider-side cap.
4. **A ranked comparison must be the authorized comparison.** A ranked reference whose concept drifted, or a ranked territory outside the authorized set, withholds every position (`INTEGRITY_FAILED`).
5. **Report each evidence class separately:** offline, synthetic browser, hosted recorded browser, local live provider, hosted live provider. A recorded-evidence browser pass is not live validation.
6. **Tests must pass from a fresh clone.** Pinned live artifacts that tests read are tracked byte-for-byte with their original checksums, never regenerated.

Canonical record: `docs/sprint-9j/LIVE_VALIDATION_AND_RELEASE_REPORT.md`.

## Public evaluation (Sprint 9M)

1. **Anonymous paid research only inside an approved public evaluation.** It requires `CE_PUBLIC_EVALUATION=1`, an id, a future expiry, an explicit `CE_PROCESS_QLOO_CALL_LIMIT` and `DATABASE_URL`, and it fails closed without any of them. Open it only with `scripts/public-evaluation-open.sh` and an owner-approved Qloo and USD total.
2. **Caps are durable and global.** The ledger is keyed by the evaluation id. Per-network quotas are keyed by an HMAC of the client address, never the address itself. A restart, a new cookie or a new visitor never grants a fresh allowance.
3. **Verify with `--expect-admissions public`.** Its probes cannot dispatch. The kill switch is `scripts/public-evaluation-close.sh`.

## Discovery to decision (permanent, from Sprint 9N)

1. **Comparison feasibility is a projection, not a planner** (`comparison-feasibility/v1`, `backend/src/agent/feasibility.ts`). FEASIBLE, UNCERTAIN or INFEASIBLE come from readiness, `referencePlan` and the probe ledger. UNCERTAIN is never INFEASIBLE. The model reads `focus.feasibility` and cannot change it. No threshold of the methodology or the semantic validator moves with it.
2. **Prefer observed type evidence.** A reference candidate seen on the profile of an entity of the comparison type ranks first. A namespace's name never implies a type.
3. **Reference probing is bounded.** After 4 empty reference probes, with references still missing and no usable probed candidate, FULL is not feasible (`NO_REFERENCE_YIELD`). Probes that cannot change the outcome are refused. Deferrals of type-less probes apply only with ≥ 2 turns of slack and are never bans.
4. **Co-occurrence in a reference's discovery profiles is not duplication.** The target's exemplar profiles are its discovery source. Pool overlap still decides duplicates.
5. **One decision card for every surface** (`packages/shared/src/decision-card.ts`). The live reading, the report and the evals use the same projection. It shows recorded values only, interprets evidence without forecasting outcomes, and never suggests asking a question again that Qloo's evidence blocked (`repeat: LIKELY_REPEATS`).
6. **Report the arms honestly.** `pnpm eval:d2d` compares `observe` (the Sprint 9M flow) with `enforce` on identical synthetic fixtures, and reads recorded live artefacts as run. It is never live evidence and has no independent holdout. `CE_FEASIBILITY_POLICY=observe` is the rollback. Canonical record: `docs/sprint-9n/DISCOVERY_TO_DECISION_OPTIMIZATION.md`.

## Opportunity discovery (permanent, from Sprint 10A)

1. **Signal, interpretation, territory and status stay separate** (`packages/shared/src/opportunity.ts`). An agent hypothesis never inherits the evidentiary status of the signals that motivated it. `opportunity-status/v1` is computed by code; `QLOO_SUPPORTED` and `RELATIVELY_MEASURED` need brand-independent recommend members in the run (a profile carrying the tag is not a member).
2. **Seeds are observations, never support.** The explore handoff (`explore: true`) passes the authorized scan's brand-conditioned entities, re-read and provenance-checked on the server, never from client text or in the query text. At most 3 are profiled per run. The free baseline stays model-free and never starts an agent run.
3. **Motivation must be observed.** `motivatedBy` cites only tags or entities returned in the run, or seeds; an unobserved id is refused.
4. **Pool order is a recorded rule** (`frontier-pool/v2`, `candidatePoolRule`). Facets come from the tag URN, never from names. `domainRelation` is a structural fact about the brand's profile facets, not novelty and not core versus adjacent. Do not add a novelty score. Concepts the bounded pool cuts are recorded with a reason.
5. **Discovery quality needs human and live evidence.** `pnpm eval:discovery` replays real recorded pools and checks mechanism and safety only. A quality claim needs the blinded rating (`docs/sprint-10a/evaluation/rating-sheet.md`) and the frozen holdouts (`docs/sprint-10a/PREREGISTRATION.md`), which are never tuned on.

## Agent decision competence (permanent, from Sprint 10B)

1. **Measure decisions, not only runs.** `eval:competence -- --decisions` freezes one turn per case (`evals/competence/decisions.json`, pre-registered, dev/holdout). Cases use generic predicates only. The reference policy is a scorer ceiling, never a model validation.
2. **Attribute before fixing.** `eval:competence -- --audit <dirs>` groups stored LLM runs by label and cause. Do not answer a Qloo-data or deterministic-policy cause with prompt text.
3. **Context states why, never grants.** `focus.withdrawn` explains tools a closed skill no longer offers. Exposure and validation stay in code. Every turn records its focus (`turn.focus`).
4. **A context change is an arm.** Ship it behind a runtime switch so the paired Haiku run compares like with like. Offline results of deterministic policies say nothing about its effect.

## Durable agent execution (permanent, from Sprint 10C)

Canonical record: `docs/sprint-10c/DURABLE_AGENT_EXECUTION_AND_LIVE_RELIABILITY.md`.

1. **Durable mode is opt-in and explicit.** It needs `CE_DURABLE_AGENT=1`, `DATABASE_URL` and migration `002_durable_agent.sql`, applied by `pnpm db:migrate` and never by the API. A missing schema refuses durable admission (503).
2. **Recovery is deterministic replay of the provider-call journal** (`backend/src/agent/durable/`). A committed answer is reused and never sent again. The runtime is not rewritten; persistence wraps it.
3. **A call that may have been dispatched without a committed answer is never repeated automatically.** It becomes `OUTCOME_UNKNOWN` and the job is quarantined (`INTERRUPTED_UNCERTAIN`). Only an explicit operator decision (`pnpm agent:recovery -- authorize <jobId>`) resumes it; the unknown calls stay charged. Do not claim exactly-once execution.
4. **Every advancing write is lease-fenced** (owner, epoch, unexpired lease, under a row lock). A worker that lost its lease commits nothing and halts before it reserves a call. Only one worker plus a fenced stale worker is validated; do not claim distributed execution.
5. **Restarts never reset budgets or deadlines.** Recovered jobs keep their original model reservation and authorization, and replayed calls never reach the dispatch counter. `deadline_at` is persisted.
6. **Recovery rules are code, in fixed order:** cancel, then quarantine on unknown, then timeout, then attempt limit, then resume. No model decides how to recover. Replay divergence (a fingerprint or checkpoint digest mismatch, or unreproduced committed rows) quarantines.
7. **Checkpoints are versioned** (`agent-checkpoint/v1`). An unknown version is refused, never guessed. Process-bound objects never enter `AgentRunState`.
8. **A local stateful policy must implement `AgentModel.replay()`.** A provider adapter must stay stateless per call, otherwise replay is invalid.
9. **Durability is validated with real process interruption** (`pnpm test:durable`: SIGKILL, SIGSTOP, SIGTERM against disposable PostgreSQL, synthetic provider). Fault injection (`CE_DURABLE_FAULT`) is test-only and ignored on a public runtime.
10. **Infrastructure recovery is not research quality.** A resumed job is not evidence that the research is useful; report the two separately. Live acceptance (`pnpm durable:live`) runs locally, only with owner approval.

## Deployment provenance (permanent, from Sprint 8F)

1. **GitHub is the canonical source.** `RaulMermans/cultural-elasticity` is the only release repository. Do not deploy from copied archives as the ordinary process.
2. **`main` is the release branch.** `sprint/*` is for development. Do not merge to `main` or connect production auto-deploy without explicit release authorization.
3. **Vercel Authentication is All Deployments** before any new frontend deployment. `all_except_custom_domains` left the production alias public in Sprint 8E. If a supposedly protected URL returns the app anonymously, stop automation and report `VERCEL_PROTECTION_GATE_FAILED`.
4. **PRs never consume Anthropic or Qloo credits.** `.github/workflows/ci.yml` has `contents: read` and empty provider keys. Do not add `pull_request_target`, deploy tokens, or `eval:agent:live` to pull-request CI.
5. **Railway stays one replica, admissions off, until a live run is separately approved.** Connecting GitHub must not enable PR environments or unreviewed auto-deploys.
6. **Operator `/ops/status` may expose Git SHA and branch.** It must never expose secrets, commit messages, or provider keys.
7. **Every release ends in a verdict** (Sprint 9L): `RELEASE_VERIFIED`, `RELEASE_DEGRADED` or `RELEASE_FAILED` from `node scripts/release/verify-production.mjs`, after `node scripts/release/preflight.mjs`. Follow the `/cultural-elasticity-release` skill (`.claude/skills/cultural-elasticity-release/SKILL.md`) to deploy, verify, repair drift or run a bounded live window. Green provider deployments alone are not a release.

## Deployment regression prevention (permanent, October 27, 2026)

Canonical release contract: `docs/operations/DEPLOYMENT_RELEASE_CONTRACT.md`. Run `pnpm check:deployment-config` before any release branch merge. The offline check must pass, but **cannot** attest to live Vercel/Railway dashboard settings.

1. **Never reintroduce the Vercel pre-production-only Ignored Build Step.** It previously canceled every `main` deployment. Remote Vercel `commandForIgnoringBuildStep` must be cleared, and `main` must not be disabled in `frontend/vercel.json`.
2. **Keep the Vercel monorepo build configured for `frontend` with files outside root enabled.** A `READY` preview is not proof of a `READY` production deployment. Verify both the target and source SHA.
3. **Keep Vercel Authentication set to All Deployments until the separately approved public launch.** Do not disable protection simply to make a probe return HTTP 200.
4. **Vercel server-only production env needs `BACKEND_URL` and `CE_INTERNAL_API_SECRET`.** Verify metadata and actual protected frontend → Railway integration without printing secrets. Missing permissions or missing metadata mean NOT_VERIFIED, never PASS.
5. **Railway service source must follow `RaulMermans/cultural-elasticity` `main`, with no stale commit pin.** Confirm the actual deployed SHA, one replica, Dockerfile path, healthcheck, unchanged database and stopped paid admissions before changing release status.
6. **Railway now automatically builds from `main`.** Any merge may change the running backend. Require successful relevant local tests and owner-reviewed release impact before a merge; GitHub Actions billing currently prevents CI from acting as an effective gate. If a release fails, restore the last verified deployment; never reinterpret a previous `SUCCESS` as proof that current code is healthy.
7. **Do not publish or enable paid research during routine config repair.** Public access, provider limits, spending, migrations, secrets and new services need explicit review and authorization. Keep transient agent jobs and process-local spend limitations visible.
8. **Remote release preflight is mandatory, not optional because an offline check passed.** Inspect the real provider metadata and run the fail-closed sanitized snapshot check in `scripts/check-deployment-contract.mjs --snapshot <path>`. Without accessible production env metadata, matching SHA and hosted smoke, report RELEASE_NOT_VERIFIED.

## Brand baseline durability (Sprint 9B)

1. **The brand baseline is deterministic and model-free.** It uses the existing `QlooClient`; the existing agent remains separately admission-gated and in-memory. A baseline candidate is an observed association, never a commercial recommendation or a FULL relative analysis.
2. **PostgreSQL durability applies only to new baseline scans.** Migrations are explicit, additive and checksum-pinned. Do not auto-reset, auto-migrate, or claim that existing agent jobs became crash-resumable.
3. **Provider dispatches are reserved before they leave the process.** Seven calls per scan includes retries; unknown outcomes consume quota and are never replayed automatically. Preserve minimal normalized artifacts and correlation IDs.
4. **Both baseline admission flags default off.** Keep `CE_BASELINE_ENABLED=0`, `CE_BASELINE_LIVE_ENABLED=0`, `CE_BASELINE_TOTAL_QLOO_CALLS=0`, and `CE_ACCEPT_INVESTIGATIONS=0` on public/production deployments unless a separate release decision authorizes provider use.
5. **The canonical Sprint 9B design, backup procedure, and live evidence are in** `docs/sprint-9b/BRAND_INTELLIGENCE_AND_DURABLE_INFRASTRUCTURE.md`. Synthetic tests are not live Qloo validation.

## Baseline evidence grounding (Sprint 9B.1)

1. **Observations, themes and hypotheses stay separate** (`ce-brand-baseline/0.2`). The observed profile never depends on finding a territory, and a hypothesis is always `UNVALIDATED`.
2. **Query scope is not entity type.** A generic `urn:entity` returned by a type-filtered query is `QUERY_SCOPED`, never relabelled as a confirmed type. Keep Qloo's `subtype` and the harness-recorded `filter.type` verbatim.
3. **The tag URN is authoritative** for facet and operational classification; a returned type label never overrides it. Names are never used to classify, only to flag possible duplicates, which are never merged or counted twice.
4. **Stored results are never rewritten.** Re-projections of stored observations are separate derived artifacts with `execution.derivedFrom`. Canonical record: `docs/sprint-9b1/CULTURAL_INTELLIGENCE_GROUNDING_REPORT.md`.

## Engineering

- Keep **frontend/backend boundaries clean.** The frontend talks only to the backend. Only the backend talks to Qloo, through `QlooClient` (`backend/src/qloo`).
- Product code depends on the `QlooClient` and `QlooTransport` interfaces, not on shell commands.
- Validate at boundaries (zod). Contracts are derived from verified Qloo output, never designed first.
- Handle Qloo statuses explicitly:
  - `needs_input` is never silently continued;
  - `partial` and `degraded` are flagged;
  - `error` is retried at most once, and only when Qloo marks it retryable.
- Do not add complexity without a measured requirement. No databases, queues, auth or abstractions "for later".
- Keep hackathon scope tight. Smallest reliable change, no unrelated refactors, and never delete tests to make CI pass.

## Verification before calling work done

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm check:secrets && pnpm check:deployment-config
pnpm eval:methodology   # offline, synthetic; never report as Qloo validation
pnpm eval:agent         # offline, synthetic world; never report as Qloo or live-model validation
pnpm eval:agent:budget -- --approved-usd <N>
                        # deterministic spend preflight (Sprint 8E); no provider call
pnpm eval:agent:live -- --arms baseline,model --stability 3 --approved-usd <N>
                        # live Qloo + Haiku: all 7 cases, case-matched baseline, frontier stability (model arm needs ANTHROPIC_API_KEY)
                        # refuses (exit 4, no call) unless the owner-approved ceiling covers the reserved exposure
pnpm eval:agent:replay -- <dir>
                        # offline replay of current evaluators/stability metrics over stored live results
pnpm eval:d2d           # offline Discovery-to-Decision suite: observe vs enforce arms (synthetic) + recorded live artefacts as run
pnpm eval:d2d -- --score <dir> [<dir>]
                        # score stored agent results with the same metrics (offline half of a model comparison)
pnpm eval:discovery     # offline; real recorded frontier pools + Loewe scan seeds (mechanism/safety), never discovery-quality or live evidence
pnpm eval:competence -- --decisions
                        # decision points on the synthetic world (reference + instruments); never a model validation
                        # --policy haiku needs ANTHROPIC_API_KEY and --approved-usd (no Qloo call): LIVE_HAIKU_DECISIONS
pnpm eval:competence -- --audit <dirs>
                        # decision-quality audit of stored LLM runs (files only)
pnpm eval:query         # offline gate/handoff replay over the query manifest (synthetic); never NLU evidence
DATABASE_URL=<disposable> pnpm db:migrate && pnpm test:durable
                        # Sprint 10C real process-interruption recovery (synthetic provider, disposable PostgreSQL)
pnpm durable:live -- --plan
                        # Sprint 10C live acceptance plan; the run itself needs owner approval (local only)
pnpm eval:query -- --live
pnpm test:e2e           # browser tests against a SYNTHETIC job API; never live Qloo or Haiku
                        # real Haiku interpretation, dry run (no Qloo): LIVE_HAIKU_INTERPRETATION
pnpm feasibility:qloo   # live; report its result separately
pnpm smoke:offline
pnpm smoke:docker       # local image; no provider network for the MCP handshake
node scripts/release/preflight.mjs   # release candidate on main: records local evidence while CI is billing-blocked
node scripts/release/verify-production.mjs --public-mode --expect-admissions closed
                        # read-only: fresh Vercel/Railway metadata + HTTP; prints the release verdict; no paid call
pnpm smoke:remote -- https://<backend-origin>
                        # deployed backend, admissions paused only; no paid call (secrets from env)
node scripts/vercel-protection-probe.mjs https://<vercel-url>
                        # anonymous fetch; HTTP 200 of the app is VERCEL_PROTECTION_GATE_FAILED
                        # HTTP 404 DEPLOYMENT_NOT_FOUND on an unassigned alias is a pass
```
