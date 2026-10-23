# Sprint 5B.2 — The Living Atlas

The product surface for Cultural Elasticity. The agent, the query gate, and the methodology are unchanged. This sprint adds the investigation a person can actually walk through.

Sprint 5B.3 continues this surface: [LIVING_ATLAS_PRODUCT_EXCELLENCE.md](../sprint-5b3/LIVING_ATLAS_PRODUCT_EXCELLENCE.md). The design skill is now version 2.

## 1. Architecture decision

```
browser
  → Next.js routes /api/agent/jobs
  → Fastify JobManager
  → QueryService (one Haiku interpretation, then the gate)
  → AgentRuntime
  → Qloo + versioned skills
  → ce-query/0.1 response
  → Living Atlas
```

There is no second agent, no second interpreter, and no second evidence system. The browser never calls Qloo or Anthropic. Presentation code does not compute a score.

## 2. Starting state

Branch `sprint/5b2-living-atlas`, cut from `sprint/5b1-query-intelligence` at `bf7d5fd7bc98c26532dfb3dd0f22349a15a576d3` (Sprint 5B.1, committed and clean). Sprint 5B.1 did not need a checkpoint.

## 3. Product UX vision

The first screen asks “Where could your brand go next?” A question becomes an investigation. Territories appear as a lineage the person can select, inspect, narrow, compare, or leave. The screen stays quiet. Detail opens beside the branch, not all at once.

## 4. Design and experience skill

Authority: `.agents/skills/living-atlas-design/SKILL.md`, version 1. It is a development skill. It is not registered as a runtime investigation skill. `docs/design/LIVING_ATLAS_DESIGN_SYSTEM.md` repeats the tokens and defers to the skill. Root and frontend `AGENTS.md` point at it.

## 5. Visual tokens

Implemented in `frontend/src/app/globals.css` and listed in the skill. Paper `#f3eee4`, ink `#241e18`, botanical `#3e5c49`, clay `#8a6548`, sand `#ead9c6`, rose `#8f5d58`. Display type is Newsreader. UI type is Outfit. Both come from `next/font` with system fallbacks. Clay was darkened so a partial-evidence border clears 3:1 on sand. Status is also written in words.

## 6. Component architecture

`AtlasApp` composes the screen. `useAtlas` holds server responses separately from selection, the inspector, comparison, and layout. `atlas-model.ts` turns validated responses into nodes. It does not invent evidence.

- `AtlasShell` — frame, skip link
- `QueryComposer` — the question
- `InvestigationProgress` — the stage the job actually reported
- `InvestigationCanvas`, `AtlasNode`, `AtlasConnection` — the branch
- `AtlasNavigation`, `InvestigationHistory` — the same branch as buttons
- `TerritoryDetail` — selection, follow-up, return, compare
- `EvidenceInspector` — observed, calculated, inferred, unavailable
- `ClarificationDialog`, `AlternativeConfirmation` — the gate’s questions

## 7. Atlas geometry

A deterministic tree. Column 248, row 120. A node keeps its coordinates when a later branch appears. Edges mean investigated-from (`InvestigationOperation`). A brand mismatch starts a new root so one brand is not drawn under another. The organic radius is a hash of the node id and encodes nothing. There is no physics simulation and no spacing by affinity, distance, confidence, or success.

On a narrow viewport the canvas shows the selected node, its parent, and its children. The desktop edges are not shrunk onto a phone.

## 8. Evidence presentation

| What the server said | What the atlas says |
| --- | --- |
| No investigation yet | Not yet investigated |
| `EVIDENCE_SUPPORTED_TERRITORY` | Evidence supports a comparison. Not a recommendation |
| `PARTIAL_EVIDENCE` | Partial evidence |
| `UNSUPPORTED` | No usable evidence |
| `HYPOTHESIS_PENDING_VALIDATION` | Hypothesis |
| `INVESTIGATION_INCOMPLETE` | Incomplete. Stopped before enough evidence |
| `INVESTIGATION_CANCELLED` | Interrupted. Not kept as a finding |
| Failed | Could not finish |

Color is paired with those words. Green is not used to mean a good business move. The inspector separates Qloo evidence, system analysis, agent wording, limitations, and provenance. Synthetic results say they are synthetic. Raw JSON is not shown.

## 9. Natural-language UX

The composer sends the question to `POST /api/agent/jobs`. It does not choose a model, a tool, or a namespace. Example sentences are not wired into production routing. Territories are whatever the runtime returns. If the runtime offers no narrower candidate, the detail panel asks the person to type a more specific direction.

## 10. Async execution

`POST /api/agent/jobs` returns 202 with an opaque job id and an access token. `GET /api/agent/jobs/:id` requires `x-job-token`. A wrong token and an unknown id both answer 404. The work runs in `JobManager` on the same `QueryService` as the synchronous routes. The HTTP request does not stay open for the investigation.

Stages actually emitted: queued, interpreting, investigating, preparing, done. “Evaluating comparisons” is used only when the intent is `compare_territories`. There is no “resolving entities” stage, because the service does not emit one. There is no percentage.

## 11. Job lifecycle and deployment constraints

In-process memory only. Defaults: 2 running, 4 queued, 30 minutes readable after finish, 20 minutes maximum run. Overflow is 429. A second confirmation of the same query id while one is in flight is 409. A finished job’s first read after expiry is `expired` with no response; the next read is 404.

This requires a continuously running Node.js process. A restart drops jobs and runs. A serverless host that freezes after the response cannot use this manager. No Redis, queue, or database was added.

Cancellation aborts at the next turn. The in-flight Qloo or model call finishes and is not recorded as a finding. The slot is released. The terminal state is `INVESTIGATION_CANCELLED`. Leaving the browser does not cancel the job, so a refresh can resume while the process still holds it. Bounds stop an abandoned job from running forever.

Qloo calls stay serialized in the shared tool provider, including across jobs.

## 12. Session and investigation navigation

`sessionStorage` keeps job id and token only, at most 12. On load the client re-reads each job. If the process no longer has it, the screen says the investigation cannot be resumed and offers a new one. Client metadata is never turned back into evidence.

A follow-up hangs from the selected territory. A brand change or a brand mismatch does not hang under the previous brand. Return sends “Return to the previous investigation.” with the current run id. The server decides which ancestor that is.

## 13. Follow-up integration

`POST /api/agent/jobs` accepts the same body as a follow-up: `query` plus `context.runId` and an optional `selectedTerritoryKey`. The child re-resolves the inherited brand. Parent classifications are not copied. An unsupported narrower concept stays unsupported.

## 14. Clarification and confirmation

A `NEEDS_CLARIFICATION` or `NEEDS_INPUT` response opens a dialog. The answer is a new job, not a hidden retry with extra authority.

A system directive is `UNSUPPORTED_OPERATION` with no alternative. Confirming that query id returns `DIRECTIVE_BLOCKS_CONFIRMATION` and does not call Qloo. A second confirm is rejected. This closes the path where a directive-bearing request could still be executed through a confirmable alternative.

A recognized competitor operation (`compare_brands`, `competitor_whitespace`) is explained as not available. A smaller alternative, when the gate offers one, is labelled non-equivalent and runs only after confirmation. The atlas does not silently run `compare_territories` for a brand comparison. No competitor score was added.

## 15. API and schema validation

`packages/shared/src/query-validate.ts` parses a `ce-query/0.1` response, including interpretation, handoff, context, investigation, territories, evidence status, lineage, next operations, and alternatives. Unknown states are rejected. An alternative with `equivalent: true` is rejected. The Next.js routes run the same parser and answer 502 rather than render a malformed body. The shared package still has no runtime dependency.

## 16. Accessibility

Skip link, labelled question, buttons for every node, dialogs with names, a live region for progress, and text for every evidence state. Focus moves to the inspector’s close control. Essential actions are not hover-only. The SVG edges are `aria-hidden`. Keyboard activation of a node is covered by the browser suite. Contrast of the text tokens is above 4.5:1 on paper. Reduced motion removes the node breath; the suite checks `data-reduced`.

## 17. Responsive behavior

Desktop is a canvas plus a detail column. Below 900px the detail stacks and the inspector becomes a bottom sheet. Below 720px the branch is a list of the current node, its parent, and its children. The browser suite checks a 390×844 viewport.

## 18. Runtime integration

Jobs call `QueryService.execute`, `confirm`, and `continueRun`. The runtime accepts an `AbortSignal` and checks it between turns. Preview responses published before a long run are `INVESTIGATION_STARTED` with territories still `NOT_INVESTIGATED`. They are not logged as the final outcome.

## 19. E2E tests

`pnpm test:e2e` runs Playwright against the Next.js app and `frontend/e2e/synthetic-backend.mjs`. The fixture is labelled SYNTHETIC, checked with `parseQueryResponse`, and is not a Qloo or Haiku run. It covers the opening screen, progress, nodes, selection, the inspector, a follow-up, return, clarification, an unsupported competitor request, confirmation, an invalid payload, keyboard selection, reduced motion, a phone-width layout, a missing job, cancellation, and the absence of provider sentinels in the browser.

On 22 October 2026, after the inspector layout change, that suite passed 14/14 in 49.4s.

## 20. Live Qloo validation

`pnpm --filter backend living-atlas:live` runs one parent and one child through `JobManager` and the real Haiku interpreter. It is not the baseline policy.

Recorded on 22 October 2026 (gitignored `backend/feasibility-output/sprint5b2-living-atlas/parent-child.json`):

- Parent query: “Where could Jacquemus expand?”
- State `INVESTIGATION_COMPLETED`, parser accepted, model `claude-haiku-5-5`, evidence origin `live`, 30 Qloo calls.
- Brand Jacquemus, id `93A50AC5-FCF2-4F47-87C0-E821E0B9F823`, run `8813537d-3e73-4411-b7c0-d42d3cfc26e0`.
- Territories: Bohemian lifestyle and Japanese drama (`PARTIAL_EVIDENCE`), Art and culture and Avant-garde experimental fashion (`UNSUPPORTED`).
- Child query: “Explore Bohemian lifestyle more specifically.”, run `d083c0aa-c4bf-4e08-a7c0-007bc28eb3e6`, parent link to the run above, 5 Qloo calls, origin `live`.
- The child re-resolved the same brand id. Its territory, “Bohemian lifestyle, more specific”, came back `UNSUPPORTED` / `INSUFFICIENT_EVIDENCE`. That is an honest result, not a promoted finding.
- The atlas parser accepted both responses. The browser suite that renders nodes uses the synthetic fixture, not this live payload.

The name Jacquemus appears only in that evaluation script.

## 21. Security

Provider keys stay in the backend process. The Next routes do not forward them. Job access is an unguessable token, not a list of runs. A bad token is indistinguishable from a missing job. Directive confirmation cannot start an investigation. Model text is rendered as text. The browser suite plants sentinel values in the server environment and checks they do not appear in the page or in JSON responses.

There is no account system. A person who has a job id and its token can read that job until it expires. Tokens are not enumerable through the API.

## 22. Performance

An investigation may take minutes. The page stays interactive because the request returns when the job is accepted. The client polls every 1.5 seconds. Navigation of a finished result does not start a new run. The atlas layout is a tree walk, not a force simulation.

The production frontend build (Next.js 16.4.2) compiled successfully. `frontend/.next/static` is 908K, of which the JS chunks are 624K. Next did not print a per-route first-load figure. A cold compile took about 2.2 minutes; a later compile on a warm cache took about 1 second. No frame-rate number was measured.

## 23. Known limitations

- Jobs and runs die with the process.
- Cancellation is cooperative between turns.
- Closing the tab does not cancel a job.
- The visible UI follows one running job even though the server allows two.
- Competitor comparison, whitespace, bridges, and portfolios are recognized and not executed.
- No recorded live investigation is offered as a demo. The empty state is the invitation. The Jacquemus packet in `evals/fixtures/live` is an evidence packet, not an agent result, and was not turned into a fake atlas.
- The query gold labels remain author-written. The new contextual file is synthetic routing and state coverage, not language-understanding evidence.
- The agent remains `AGENT_MODEL_NOT_READY` from Sprint 5A.2. This sprint does not change that.
- The live child territory name included the words “more specific”. The gate investigated what Haiku named. It did not invent support.

## 24. Deployment readiness

Not production-ready. The job manager is an in-process hackathon runtime. A durable host, authentication, and a decision about serverless versus a long-lived Node process are still open. Local success is not deployment readiness.

## 25. Sprint 6 recommendations

Competitor comparison can be added as a new executable intent behind the same gate and the same atlas. The unsupported state and the confirmation dialog are already the seam. Do not add a score, a second map, or a second agent to get there. Advanced exploration should keep using follow-up runs and lineage, not a new geometry.
