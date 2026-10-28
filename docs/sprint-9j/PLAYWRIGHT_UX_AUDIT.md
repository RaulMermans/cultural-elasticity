# Sprint 9J: Playwright UX audit

## Result

**`HOSTED_RECORDED_PLAYWRIGHT_PASS`.** 15 of 15 journeys passed: 5 journeys × 3 viewports.

| | |
| --- | --- |
| Kind of test | Real Chromium against the deployed production frontend |
| URL | `https://cultural-elasticity-raulmermans-projects.vercel.app` |
| Revision | `0b0f8cd` (`main`), redeployed with the repaired Production environment |
| Backend | Real Railway backend at `0b0f8cd`, admissions paused |
| Route stubs | None |
| Synthetic backend | None |
| Paid provider calls | None |

This is a **hosted real-browser test using recorded evidence**. It is not a live-provider test.

- Spec: `frontend/e2e-hosted/hosted-recorded.spec.ts`
- Config: `frontend/playwright.hosted.config.ts` (projects `desktop-1440x900`, `tablet-768x1024`, `mobile-390x844`)
- Run: `E2E_HOSTED_URL=<url> pnpm --filter frontend exec playwright test -c playwright.hosted.config.ts hosted-recorded`
- Evidence: `docs/sprint-9j/evidence/hosted-playwright/`. Each test writes method, path and status only: no headers, bodies or tokens.
- Screenshots: `docs/sprint-9j/screenshots/hosted/`

## Journeys and assertions

**A. Home**

- First render and the product statement.
- The real `/api/agent/admissions` returns `{"status":"paused"}`. This is the first sign of `VERCEL_RAILWAY_CONNECTED`; before 9J it returned `unavailable`.
- "New research is temporarily unavailable." is shown.
- No "Find brand" or "Start research" control is rendered.
- Recorded Loewe and the recorded Jacquemus Atlas are reachable.
- Recorded-research lookup:
  - `loéwe` finds the recorded Loewe research;
  - `Northwind` is refused honestly.
- No horizontal overflow.

**B. Recorded Loewe**

1. **Fingerprint.**
   - "We found cultural connections and 2 possible directions to research further."
   - The recorded-origin note: "Opening it did not start a new search."
   - No internal codes in visible text.
2. **Connection evidence.** Hôtel de Crillon shows all four evidence headings and "position 5 of 10 when asked for places related to Loewe".
3. **Provenance.** The `mcp-…` correlation id stays hidden until "Source and method" is opened.
4. **Directions.** "Model" is presented as "not a validated finding or a recommendation". Its evidence reads: "One Qloo tag observation. Not corroborated by an independent call."
5. **Unsupported comparison.**
   - The recorded comparative demo shows "Not eligible." and "No comparison was run."
   - It has no enabled control, and no position or class.
6. **Summary.** "Loewe: strategic research brief", labelled recorded.
7. **Export.** The downloaded `loewe-strategic-research-brief.html` contains:
   - the brand;
   - the "Recorded Qloo research" label;
   - the same evidence items;
   - no ranking.

   A copy is kept at `evidence/hosted-playwright/exported-loewe-brief.html`.
8. **Refresh and Back.** Reload keeps the summary. Back returns to the previous view.

**C. Living Atlas (recorded Jacquemus)**

- More than 3 nodes are rendered, and on desktop the edges render as SVG paths.
- Supported, Partial, No-evidence and Incomplete states are all labelled.
- Selecting "Bohemian lifestyle" updates the finding (Isabel Marant).
- The dossier opens. Its technical details reveal "Canonical identifier". It closes with Escape.
- Selecting "design-led boutique hospitality" updates the finding.
- The read-only comparison shows "no numerical ranking".
- "Back to brand research" returns to the workspace.

**C2. Keyboard and motion**

- With reduced motion, nodes carry `data-reduced="true"`.
- Focus + Enter selects a node (`aria-pressed="true"`).
- With admission paused, the follow-up is disabled and no Ask control is rendered.

**G2. Paid routes**

- Direct POSTs to all five paid routes are refused: 503 (paused) or 404 (no authorized scan or job).
- A forged browser operator header is refused.

**Monitors on every test**

- No uncaught page error.
- No browser request to Qloo, Anthropic or Railway.
- No paid POST.
- No `x-ce-*` or `authorization` header in a response.
- The real internal secret (loaded into the test process from Railway, never printed) appears in no HTML, JSON or JS response.

Across all 15 tests: 255 browser requests, **0 responses ≥ 400**, 0 failed requests, 0 console errors.

## Responsive behaviour

All three viewports passed with no horizontal page overflow at any checkpoint.

The first run failed 3 of 15. All three failures were **wrong assumptions in the new spec, not product defects**:

1. **Back after Summary, tablet and mobile.** On narrow screens, inspecting a direction is its own sub-view ("Back to all directions"). Back correctly returns to that sub-view, not to the list.
2. **Atlas on mobile.** The narrow Atlas is a guided canvas that shows the selected node's parent, children and siblings. "design-led boutique hospitality" is a child of "Art and culture", so it is reached through its parent or through the "Path through this investigation" breadcrumb, as a user would. Confirmed by probing the live DOM.

The spec now navigates the way a user on that viewport does. No product code was changed for the hosted recorded journeys.

## Issues observed (not fixed; minor)

| Issue | Where | Severity |
| --- | --- | --- |
| The header briefly reads "Checking the research service." before admission resolves | Atlas, desktop | Cosmetic. C2 confirms it settles to the real paused state. |
| "Back to brand research" uses the browser's default link blue instead of the design tokens | Atlas header | Cosmetic |
| The comparison report section of the brief is lost when the user navigates away (in-memory) | Comparative panel | Known 9I limitation; unchanged |

## Fixed in 9J (user-visible)

- **Production frontend could not reach Railway.** `/api/agent/admissions` returned `unavailable` and `/api/brands/status` returned 503 `baseline_unavailable`. The cause was configuration, not code: `BACKEND_URL` and `CE_INTERNAL_API_SECRET` existed only in Vercel's **Preview** environment. Both were added to Production, with the secret piped from Railway and never printed, and the reviewed revision was redeployed. See `LIVE_VALIDATION_AND_RELEASE_REPORT.md` §2.
- **Clearer refusals.** A refused paid start (403 `operator_required` / `operator_expired`) now says "restricted to an authorized research operator. No paid call was started." Before, it was shown as an uncertain start that "may have reached the provider".
- **Half-configured production.** A production server with only one of `BACKEND_URL` / `CE_INTERNAL_API_SECRET` now reports the service as unavailable, not "paused". Before, `/ready` needs no internal auth, so the server looked connected while every action was refused.

## Synthetic browser suite (separate)

`pnpm test:e2e` uses the synthetic job API: it is never live Qloo or Haiku. Results:

- **First run after the 9J changes: 14 of 54 failed.** The synthetic backend's `/ready` had no `dependencies.paidOperatorRequired`, and the frontend now treats that as "operator required" (fail closed), so accepting states rendered as paused. The synthetic private backend now states `paidOperatorRequired: false`.
- **Second run, production mode: 14 failed, a different cause.** The new half-configuration check flagged the synthetic production setup (an `http://` backend URL and no internal secret) as unavailable. Two fixes:
  - the check now accepts `http:` origins (private networking is legitimate) and still rejects missing or unparseable URLs;
  - the synthetic web server receives a SYNTHETIC internal secret, as production does.
- **Final:**
  - research and comparative specs: 29/29;
  - Living Atlas: 22/25 in the full run, with the remaining 3 passing 3/3 on rerun. Those were timeouts at load average ~33 and pass in isolation.

## Live journey (prepared, not run)

`frontend/e2e-hosted/hosted-live.spec.ts` drives the full authorized journey through the real UI. It is skipped unless `E2E_LIVE_AUTHORIZED=1` and an operator credential are supplied.

Steps:

1. Live Loewe baseline. Stops if the Qloo brand id differs from the recorded `628AFDF5-…`.
2. References "Luxury hotels" and "Fine dining".
3. Target "Boutique hospitality".
4. Server-offered references and eligibility; stops on any refusal and never substitutes a reference.
5. One authorized comparison. A second click must not dispatch.
6. Report, exported brief, and the same live jobs opened in the Living Atlas from session handles.

It records job ids and outcomes, never job tokens. It was not executed (see `SPEND_AND_ACCESS_SAFETY.md` §5).
