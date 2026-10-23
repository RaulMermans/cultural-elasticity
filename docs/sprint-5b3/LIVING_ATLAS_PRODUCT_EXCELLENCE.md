# Sprint 5B.3 — Living Atlas product excellence

Corrective product-quality sprint on the existing Living Atlas. The agent architecture, Haiku 5.5, and contracts `ce-query/0.1` and `ce-agent-result/0.3` are unchanged except for additive optional fields.

## 1. Starting State

Branch `sprint/5b3-living-atlas-product-quality`, cut from `sprint/5b2-living-atlas` at `98612a9c968a40d0ab53e1543c11f8022490024f` (Sprint 5B.2, `ENGINEERING_COMPLETE` / `LIVING_ATLAS_READY`). The worktree was clean. Node 22 and pnpm 10.26.0. Agent readiness remained `AGENT_MODEL_NOT_READY` and is reported separately.

## 2. Root Cause Analysis

Issues A–G were reproduced in the 5B.2 code, then fixed with tests. They were not assumed.

| ID | Observed failure | Responsible code | Fix |
| --- | --- | --- | --- |
| A | Query clarification submitted `{ query: answer }`, dropping the original question and starting an unrelated root. Agent `NEEDS_INPUT` already used `continueRunId`. | `AtlasApp` onAnswer; no `clarifyQueryId` body | `QueryService.answerClarification` composes original + question + answer. UI sends `{ clarifyQueryId, clarification }`. |
| B | Return sent a new NL job. `buildAtlas` skipped every reused response, so selection and viewport did not restore. | `AtlasApp` onReturn; `buildAtlas` skip-all-reused | `navigateToRunId` reads `RunStore` only. Reused responses materialize if that run is not already drawn. Client `focusRequest` selects the territory. |
| C | Compare joined display names under one arbitrary `context.runId`. Cross-brand and cross-panel ranks could be implied. | `TerritoryDetail` / `AtlasApp` compare | Client `assessComparison` plus server `comparisonFromSources`. Cross-brand is `CROSS_RUN_BRAND`. Same brand starts a **new** `compare_territories` with server labels and no inherited panel. |
| D | Evidence matched `norm(label)` only. Duplicate names shared a node id. A miss dumped every concept and the investigation summary onto the selected territory. | `evidenceSections`, node ids | Node id is `territory:${runId}:${key}`. Match by key, then unique name, else “Territory-specific evidence is unavailable.” Run-id mismatch fails closed. Aggregate is labelled separately. |
| E | Terminal jobs lived until a post-expiry read. A late success after abort could finish as completed. | `JobManager.sweep` / `finish` | Sweep nulls payloads past `expiresAt` and deletes after `expiresAt + ttl`. Abort forces cancelled and drops a non-cancelled response. |
| F | `model: "baseline"` and `/analyze`, `/continue`, analysis, methodology were reachable in a public process. No job create rate limit. | `agent.ts`, analysis, methodology | `CE_PUBLIC_DEPLOYMENT=1` or `NODE_ENV=production` closes those routes and refuses baseline. Per-IP and global create limits. Cancel 60/min. Smaller body limits. |
| G | Haiku plus the gate accepted “Bohemian lifestyle, more specific” as a territory. | Gate; interpreter prompt | Additive `interpretation.refinement`. `assessRefinement` requires a specific concept that is in the user’s words or already observed. Residue words are not a taxonomy. |

## 3. Clarification Continuity

Query-interpretation clarification (`NEEDS_CLARIFICATION`) and agent clarification (`INVESTIGATION_NEEDS_INPUT`) are different bodies. The first continues the stored query. The second continues the waiting run. A missing query record is `CONTEXT_UNAVAILABLE` / `QUERY_NOT_FOUND`. A query that is not pending is `CLARIFICATION_NOT_PENDING`. The dialog shows the original raw query. Regression: `backend/tests/sprint-5b3.test.ts` and the clarification E2E.

## 4. Navigation Corrections

`{ navigateToRunId, territoryKey? }` is a read of a held run. No interpreter. No `runtime.run`. Missing run: `ANCESTOR_UNAVAILABLE`. Waiting run: `PARENT_AWAITING_INPUT`. Unknown key: `SELECTED_TERRITORY_UNKNOWN`. Recorded-example return is local focus, because the server does not hold those run ids. Returning is not a new cultural investigation.

## 5. Comparison Integrity

Before a comparison job, every selected territory is tied to its `runId` and `territoryKey`. Brands must match. Labels must be distinct. Stored relative positions are not reused. A valid same-brand set becomes a fresh `compare_territories` investigation. Cross-brand is refused and is not offered as equivalent to `compare_territories`. Competitor comparison remains a deferred, non-equivalent operation.

## 6. Evidence Attribution

`evidenceSections(response, { territoryKey, territoryName, runId })` matches one territory by key. A name match is used only when no key is given and exactly one label matches. Zero or many matches, a missing record, or a run-id mismatch return the unavailable sentence and move investigation-wide lines to the aggregate. Tests cover duplicate names, similar names, a missing key, a wrong run, and aggregate-only evidence.

## 7. Job Lifecycle

Still in-process. Defaults stay 2 running, 4 queued, 20-minute run cap, 30-minute readable TTL after finish. Completed, failed, cancelled, and queued jobs expire. Running jobs are not swept. Concurrency is released in `finally`. A cancelled job cannot become completed. The first post-expiry read can still return `expired` with no payload; a later sweep deletes the handle. Stale tokens still 404.

## 8. Public Execution Safety

| Control | Behaviour |
| --- | --- |
| Baseline | 403 `baseline_disabled` when public |
| `/api/agent/analyze`, `/continue`, analysis, methodology | 404 when public. Dev Next pages were already `notFound()` in production |
| Job create | Default 500 / 10 min outside public (so the shared test IP does not 429). Public default 24 / 10 min per IP, global = 4×. `CE_JOB_CREATE_LIMIT`, `CE_GLOBAL_JOB_LIMIT` override |
| Cancel | 60 / minute per IP |
| Body limits | Jobs 16 KiB; query routes 32 KiB |
| Tokens | Existing sha256 + timingSafeEqual. Wrong token = missing job |
| Cost ceiling | Request-count cap, not a dollar cap. Documented as a remaining limitation |
| Accounts | Not added. A UI-hidden control is not an authorization boundary |

If a public host cannot keep the Node process alive for the 20-minute cap, deployment stays blocked. See §17.

## 9. Design & Experience Skill v2

`.agents/skills/living-atlas-design/SKILL.md` is version 2. Palette, type, and organic language are unchanged. Version 2 adds interaction hierarchy, selected-node emphasis, return navigation, recorded-example rules, narrowing honesty, evidence scope, loading copy, focus, and regression checks. It is a development skill. It is not registered in the agent skill registry. `frontend/AGENTS.md`, root `AGENTS.md`, and `docs/design/LIVING_ATLAS_DESIGN_SYSTEM.md` point at version 2.

## 10. Intelligent Narrowing

A follow-up that only asks to go deeper is an intent. It is not a territory name. The model may propose a child concept and a relationship (`NARROWER` / `ALTERNATIVE` / `RELATED` / `UNCLEAR`) with a basis (`USER_EXPLICIT` / `OBSERVED_EVIDENCE` / `AGENT_HYPOTHESIS` / `UNVERIFIED`). The runtime accepts the concept only when it is specific (a content token remains after removing the parent label and residue words) and is either in the user’s words or already observed on the parent run. `OBSERVED_EVIDENCE` is downgraded when the parent does not record the concept. A hypothesis is labelled. No brand or category taxonomy is encoded.

## 11. Narrowing Validation

Empty refinements (“more specific”, “something narrower”, “explore deeper”) clarify with “What part of this territory would you like to explore?” An explicit named concept (`design-led guesthouses`) executes as `REFINE_TERRITORY`. The child is a new investigation: it does not inherit the parent’s classification, ranking, robustness, sufficiency, or scores. The edge means `INVESTIGATED_FROM`. A recorded-example follow-up starts a **new** live question that names brand and territory in the text; it does not pretend the recorded run is still held.

## 12. Recorded Demo Architecture

`backend/scripts/demo/build-recorded-example.ts` reads a verified live parent-child artifact, drops turns and tool arguments, adds `RECORDED_EXAMPLE` to `interpretationWarnings`, validates with `parseQueryResponse`, refuses secret patterns, and writes `frontend/src/demo/recorded-example.json` plus `.meta.json`. `GET /api/demo/recorded` serves that module. It does not call Qloo or Haiku. The atlas labels the banner, inspector, and detail as recorded. The artifact is data, not routing.

## 13. Demo Provenance

| Field | Value |
| --- | --- |
| Source | gitignored `backend/feasibility-output/sprint5b2-living-atlas/parent-child.json` |
| Recorded at | 2026-10-22T17:17:09.352Z |
| Origin | live Qloo, model `claude-haiku-5-5` |
| Parent run | `8813537d-3e73-4411-b7c0-d42d3cfc26e0` · Jacquemus · 30 Qloo calls |
| Child run | `d083c0aa-c4bf-4e08-a7c0-007bc28eb3e6` · 5 Qloo calls |
| Parent territories | Bohemian lifestyle and Japanese drama `PARTIAL_EVIDENCE`; Art and culture and Avant-garde experimental fashion `UNSUPPORTED` |
| Child territory | “Bohemian lifestyle, more specific” `UNSUPPORTED` — kept honestly. Not rewritten. Not presented as a successful narrowing. |
| Source SHA-256 | `ab023fe8b8746d9359cf8bfedb2d2c829de01ffc39d5c1a5eeba37d1c040662c` |

The Jacquemus name appears in the recorded artifact and in the live eval script. It is not product routing.

## 14. Product UX Changes

- Opening lede states the product and offers “Open a recorded investigation”.
- Selected node: 2.5px botanical-deep border and a 4px soft ring, plus written status.
- Meta text 0.9rem (skill floor). Mobile `h1` uses `clamp`.
- Clarification dialog shows “Continuing:” plus the original query.
- Compare copy: “Compare these in a new investigation.” Invalid sets get an explicit limitation.
- Narrowing label: “Name a more specific cultural concept.”
- Recorded banner and inspector caution. Workflow states stay separate from evidence states.
- Return on a live child uses `navigateToRunId`. Return inside the recording uses local focus.

## 15. Accessibility

Skip link, labelled fields, dialog names, live region for progress, status in words, visible focus, keyboard node activation, and `prefers-reduced-motion` removing the node breath (`data-reduced`). Essential actions are buttons, not hover-only SVG. Contrast of the text tokens remains above 4.5:1 on paper.

## 16. Async Execution

`JobManager` is unchanged in role. The page stays interactive. Stages are the stages the server emits. There is no percentage. Cancel, timeout, disconnect, expired, and malformed bodies have explicit copy. Navigating a finished result does not start the agent. Session storage still holds at most 12 job handles.

## 17. Deployment Architecture

Do not deploy from this sprint. Do not purchase infrastructure.

**Requirement that rules out freeze-after-response serverless:** a live investigation can run up to 20 minutes. Jobs and runs live in one Node process. A host that freezes after the HTTP response drops the work. Vercel serverless / typical lambda is **not compatible** with `JobManager`.

**Smallest viable hackathon host:**

1. Frontend: Next.js on a static or serverless host is acceptable for the UI and for `/api/demo/recorded` (the recorded module is static).
2. Backend: a persistently running Node 22 process (Railway, Render, Fly.io, a small VM). Process memory must survive for the 20-minute cap plus the 30-minute TTL.
3. The Next.js `/api/agent/jobs` routes proxy to that origin. The browser never receives the backend URL as a public client config if a same-origin proxy is used.
4. Environment: `QLOO_API_KEY` and `ANTHROPIC_API_KEY` on the backend only. `CE_PUBLIC_DEPLOYMENT=1`. `CE_JOB_CREATE_LIMIT` set for the expected judge traffic. CORS allow the frontend origin only.
5. Health: existing `/health`. Restart semantics: in-memory jobs and runs are gone; the UI must show the recovery state (already implemented).
6. TLS at the host edge. Request concurrency: 2 running, 4 queued, plus the public create limit.
7. Logs: existing redaction paths. Do not log raw queries or tokens.

A restart is an honest failure, not a reconstructed investigation. No database was added. If a chosen host cannot keep the process alive, it is incompatible.

## 18. Runtime Evaluation

Offline `pnpm eval:methodology`, `pnpm eval:agent`, and `pnpm eval:query` remain synthetic or gold-replay. They are not Qloo validation and not live-model readiness. `eval:query --live` is `LIVE_HAIKU_INTERPRETATION` only. Agent readiness remains `AGENT_MODEL_NOT_READY`.

## 19. Browser E2E

`pnpm test:e2e` against Next.js + `frontend/e2e/synthetic-backend.mjs` (SYNTHETIC, `parseQueryResponse`). Added: return restores the parent heading; vague narrowing opens the focused question; recorded example is labelled and does not POST `/api/agent/jobs`. Existing opening, progress, inspector, clarification, competitor, keyboard, reduced-motion, mobile, recovery, cancel, and secret-sentinel tests remain.

## 20. Live Provider Tests

Recorded 23 October 2026 (`backend/feasibility-output/sprint5b3-living-atlas/parent-child.json`, gitignored). Script: `pnpm --filter backend living-atlas:live`. Model `claude-haiku-5-5`. Tool provider `qloo-mcp`. Not the baseline.

- Parent: “Where could Jacquemus expand?” Job completed. Query state `INVESTIGATION_INCOMPLETE`. Parser accepted. Brand Jacquemus, id `93A50AC5-FCF2-4F47-87C0-E821E0B9F823`. Origin live. 32 Qloo calls. Territories: Art and culture, Bohemian lifestyle, and Avant-garde experimental fashion are `EVIDENCE_SUPPORTED_TERRITORY` / `FULL_RELATIVE_ANALYSIS`. Japanese drama is `UNSUPPORTED` / `INSUFFICIENT_EVIDENCE`.
- Child: “Investigate design-led boutique hospitality as a narrower part of Art and culture.” Query state `INVESTIGATION_COMPLETED`. Parser accepted. Same brand id after re-resolution. Origin live. 19 Qloo calls. Territory name is `design-led boutique hospitality` (`PARTIAL_EVIDENCE` / `PARTIAL_CULTURAL_ANALYSIS`). That is a named concept, not a “more specific” suffix.
- Result: `LIVE_QLOO_PARENT_AND_CHILD_COMPLETED`.

The recorded demo still uses the 5B.2 artifact, including the unsupported poorly named child, shown honestly. The 5B.3 live child is a separate verification, not a rewritten demo.

## 21. Visual QA

Captured 23 October 2026 with Playwright Chromium against Next.js + the synthetic job API and the recorded module (`frontend/e2e/visual-qa.mjs` → `frontend/test-results/visual-qa/`, gitignored). Also inspected the opening screen in the Cursor browser.

- Opening: ivory paper, botanical sprig, Newsreader headline, recorded control secondary to the composer. Purpose is readable without docs.
- Recorded: banner labelled recorded, Jacquemus root, partial and unsupported territories, selected Bohemian node with a botanical ring, the 5B.2 child kept as unsupported.
- Inspector: “Evidence for Bohemian lifestyle.”, recorded caution, observed/calculated/inferred sections. Not a commercial prediction.
- Narrowing field: “Name a more specific cultural concept.”
- Mobile 390×844: branch list, no desktop edges, selected detail still reachable.
- Running and cancelled jobs: stage copy from the server; cancelled is interrupted, not unsupported.

The Cursor browser screenshot of Newsreader looks “doubled” to a vision pass. Computed style is `Newsreader` and the Playwright captures plus the accessibility tree show the intended letterforms. That is a capture artifact, not a product font stack change.

The last territory on a tall recorded branch can sit near the canvas edge. Nodes remain selectable through the branch list. No invented ranking axis.

## 22. Performance

The recorded example is a static JSON import (~32 KiB). Time-to-recorded should be a single same-origin fetch, not a Qloo call. Live jobs still take minutes; the page must show acceptance immediately (202). Atlas layout remains a tree walk. Bundle figures belong in the verification section after `pnpm build`.

## 23. Security

No new secrets in the repo. The recorded artifact is scrubbed and checked for secret patterns. Public baseline is closed. Development analysis routes 404 when public. Job tokens are unchanged. There is no account system. Deployment without a persistent process and without the public guards is blocked.

## 24. Remaining Limitations

- Agent remains `AGENT_MODEL_NOT_READY`.
- Jobs and runs die with the process.
- Cancellation is cooperative between turns.
- Cost ceiling is a request count, not spend.
- Competitor comparison, whitespace, bridges, and portfolios stay deferred.
- The recorded child is an unsupported, poorly named 5B.2 result, shown honestly.
- No human usability study was run.
- In-process JobManager is incompatible with freeze-after-response serverless.

## 25. Sprint 6 Recommendations

Do not start Sprint 6 from this document automatically. When it starts: add competitor comparison as a new executable intent behind the same gate, with its own Qloo evidence, not a reuse of historical ranks. Keep narrowing as validated concepts, not a taxonomy. Do not add a second agent or a distance geometry.

## 26. Sprint 7 Deployment Blockers

1. Need a persistent Node host; serverless freeze-after-response is incompatible.
2. Need `CE_PUBLIC_DEPLOYMENT=1` and tuned create limits on that host.
3. Need a spend ceiling or an operator-held key budget; request counts are not dollars.
4. Agent competence gate is still red.
5. Restart drops all live investigations.
6. No account system: possession of a job token is access to that job.
