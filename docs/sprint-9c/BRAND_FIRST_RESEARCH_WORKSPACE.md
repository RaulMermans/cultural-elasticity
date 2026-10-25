# Sprint 9C: Brand-first cultural research workspace

Branch `sprint/9c-brand-first-research-workspace`, based on `origin/main` at `5d7c8b8` (PR #25, which merged Sprint 9B.1 head `2f998fc`). No Qloo call, no Anthropic call, no database migration and no production change was made. All research shown in this sprint is either **recorded live Qloo evidence re-read offline** or **SYNTHETIC** test fixtures, and each is labelled as such.

## 1. Outcome

The default product view is now a brand research workspace. The journey is: **explore a brand → cultural fingerprint → connections → directions to investigate → inspect evidence → next research step**, and a deterministic research summary is available at any point. The Living Atlas is still there as an optional exploration view (`?mode=atlas`), unchanged, and the recorded Jacquemus investigation still opens in it.

The workspace is a view over the canonical `ce-brand-baseline` result. It adds no evidence, no score and no opportunity ranking, and it never calls a model or Qloo to show a result.

The product interpretation now separates four things:

| Concept | Source | Loewe (recorded) |
| --- | --- | --- |
| A. Brand core | Qloo's own category tags for the brand (`BRAND_CLASSIFICATION`) only | **Not verified.** Qloo returned no category tags for Loewe |
| B. Cultural connections | every retained Qloo signal, grouped by the domain it was requested for | 10 artists, 10 places, 10 films, 10 books, 2 cultural tags, 2 keywords |
| C. Directions to investigate | the server's territory hypotheses, classified by `research-position/v1` | Model and Fashion: "Observed association, relation to the brand not established" |
| D. Open questions | position unknown, ungrouped associations, partial or duplicate evidence, empty domains | 2 (current position; what links the 40 associations) |

"Fashion" is no longer presented as an expansion direction, and neither is "Model". Both are shown as observed associations whose relation to Loewe's existing position is explicitly not established.

## 2. Research quality gate and the position rule

Before any screen was designed, the displayed evidence was checked. The recorded Loewe result is byte-identical to the Sprint 9B.1 derived artifact (`RT-01`). Its 44 retained signals have these properties:

- every entity is `QUERY_SCOPED` (40/40);
- no `PROVIDER_CONFIRMED_TYPE`;
- no brand-category tag;
- one facet theme (media keywords);
- two hypotheses from tag positions 1 and 9 of 10.

**`research-position/v1`** (`frontend/src/lib/research-view.ts`) is deliberately conservative:

1. **Brand core** comes only from Qloo's category tags for the brand. With none, the core is "Not verified".
2. **Qloo evidence alone never makes a direction adjacent.** A tag ID that differs from the brand's category tags says nothing about cultural distance (a fashion house's "Fashion" tag differs from its "Ready To Wear" category). Even with a verified core, a direction says "whether it sits inside that position or beyond it has not been checked" (`RT-06`).
3. Without user context, a direction is classed **OBSERVED** ("relation to the brand not established"). It is **UNRESOLVED** if its source response was partial or degraded, or if its tag may duplicate another.
4. **User-provided context** is the only route to "Already part of the brand" (ESTABLISHED) or "A new direction" (ADJACENT). It is labelled "(your context)" wherever it appears and is stored per tab in session storage. It is never sent to the server, and it never changes evidence, strength, limitations or source references (`RT-07`, `RT-08`).
5. Directions keep Qloo's order. There are no scores, percentages or probabilities (`RT-09`, `RT-10`).

## 3. What was built

| Deliverable | Where |
| --- | --- |
| Brand discovery (default landing) | `components/research/BrandDiscovery.tsx` |
| Brand identity resolution and confirmation (live only; ambiguity flow) | `BrandDiscovery.tsx`, `use-brand-research.ts` |
| Cultural fingerprint overview | `FingerprintOverview.tsx` |
| Connection explorer (list + docked detail, arrow keys, narrow-screen back) | `ConnectionExplorer.tsx` |
| Directions to investigate, open questions, next steps | `DirectionList.tsx` |
| Four-part evidence inspection with provenance disclosure | `EvidenceDetail.tsx` |
| Research summary (screen, print, HTML download) | `ResearchSummaryView.tsx`, `lib/research-summary.ts` |
| Provenance-preserving adapter | `lib/research-view.ts` |
| Centralised plain-language copy | `lib/research-copy.ts` |
| URL state (back/forward, deep links, no token) | `lib/research-route.ts`, `ResearchApp.tsx` |
| Recorded research catalog | `demo/recorded-baselines.json`, `app/api/demo/baselines` (static), `lib/recorded-research.ts` |
| Recorded artifact builder (offline, schema-validated, SHA-256 of source) | `backend/scripts/demo/build-recorded-baseline.ts` |
| Optional Living Atlas | `?mode=atlas`; `AtlasApp` gains the mode nav, local auto-open of the recorded example, and a prefilled question |

Removed: `BrandBaselinePanel.tsx`, whose logic moved into `use-brand-research.ts` rather than being duplicated. The new hook also fixes a defect in the old panel: polling continued every 2.5 s after a scan had finished. It now stops at a terminal status.

**Architecture is unchanged.** There is no new dependency, no new agent, framework, database, store, model provider or backend route. The browser still talks only to Next.js routes. The scan token stays in session storage and is sent as a header. It is never put in a URL (`research-route.test.ts`, e2e "token never enters the URL").

## 4. Experience notes

- **Discovery.** The page explains what the research produces in three steps. When new research is paused or unreachable, the primary action opens the recorded research. The brand field still works for that case: it finds recorded research by an accent- and case-insensitive exact name match (the button reads "Find recorded research"), and an unknown brand gets a plain "no recorded research" message. "Find brand" and "Start research" are rendered only when `/api/brands/status` reports enabled.
- **Fingerprint.** The page leads with an outcome sentence, then "What Qloo shows" by domain ("Artists returned by Qloo…") with the query-scope qualifier, then the brand's position, the directions, uncertainty and coverage. It notes once that Qloo's order is not a ranking.
- **Connection card.** Each card gives the name, then the domain only where it adds information, then the four-part detail: "position N of M when asked for places related to Loewe", the type qualifier, what it might mean, what cannot be concluded, and the next step. Correlation IDs and the provider type and subtype sit only behind "Source and method".
- **Directions** are qualitatively different from connections. Each one shows why it appeared, the supporting signal and its strength, its relation to the current position, what is still unknown, the next research question, an evidence inspector, and the optional "Your context" control. With no directions, the page says "We found cultural connections, but the available evidence does not yet support a specific direction" and lists the server's reasons.
- **Deep investigation.** "Ask this in a deep investigation" appears only when agent admissions are accepting. It opens the Atlas with the question prefilled and does not submit it. When admissions are paused, the page says so in words.
- **Status copy.** Live scans show only real backend stages and statuses, with no percentage and no simulated activity.

## 5. Recorded demo choice

| Candidate | Provenance | Decision |
| --- | --- | --- |
| Loewe baseline (canary 2, re-read with 0.2) | live Qloo, stored scan `b3a92759…`, observations 0.2 | **Used.** It is the only provenance-valid baseline-contract recording. Its connections are specific; its directions are weak, and the UI says so |
| Jacquemus deep investigation | live Qloo + Haiku, recorded 2026-10-23 | **Used** as the second example, in the Living Atlas |
| Six take-20 tag profiles (Patagonia, Muji, …) | live Qloo, 2026-10-16, tag-only, no identity call, different workflow | **Not used.** They are benchmark data (`evals/benchmarks/`), which product code may not import (AGENTS Generalization rule 2), and they are not baseline scans |
| Loewe canary 1 / as-run 0.1 | live | Readable (`PV-03`), but weaker than canary 2 |

No synthetic result is presented as a real example (`PV-05`).

## 6. Evaluation (deterministic graders)

**Unit tests: `frontend/src/lib/research-view.test.ts` (34) and `research-route.test.ts` (5).**

| Group | Scenarios |
| --- | --- |
| Research truth | RT-01 recorded result unmodified · RT-02 no added connection · RT-03 Loewe never adjacent/established · RT-04 core unverified · RT-05 core only from category tags · RT-06 verified core still no adjacency · RT-07 adjacency only from user context · RT-08 context never changes evidence · RT-09 Qloo order kept · RT-10 no score/percentage · RT-11 query-scoped never "confirmed" · RT-12 confirmed vs unresolved wording · RT-13 positions within one call · RT-14 zero directions useful · RT-15 insufficient = missing evidence · RT-16 partial → unresolved · RT-17 empty domain ≠ no connection · RT-18 no invented entity themes · RT-19 duplicates flagged, not promoted |
| Provenance | PV-01 every item traces to a recorded call · PV-02 recorded origin, capture time, derivation · PV-03 as-run 0.1 Loewe readable · PV-04 legacy 0.1 honest · PV-05 catalog is live-origin only · PV-06 one source per call |
| UX / copy | UX-01 no internal codes in user copy · UX-02 no promotional language · UX-03 every connection answers why/meaning/cannot/next · UX-04 all codes map to sentences |
| Summary | SM-01 summary matches canonical findings · SM-02 zero directions stated · SM-03 user context labelled · SM-04 HTML escaped, no script · SM-05 deterministic |
| Security (route) | URL round-trip · malformed keys rejected · atlas parameters isolated · no token in URL · exact name match only |

**Browser tests: `frontend/e2e/research-workspace.spec.ts` (20).** They cover:

- paused admission with no paid action and recorded lookup;
- the full recorded journey with zero paid requests (connection → evidence → back → direction limits → summary → HTML download);
- user context;
- keyboard only (tabs, arrow keys, Enter, focus returns on back);
- back and forward;
- Atlas and Jacquemus;
- the deep-investigation gate;
- a SYNTHETIC live flow (ambiguity → confirm → start, token not in URL);
- SYNTHETIC zero-direction, insufficient, partial and legacy results;
- backend outage;
- a session scan opened from another tab;
- reduced motion with no running animation;
- no provider secret in any response;
- five viewports (1440×900, 1920×1080, 768×1024, 390×844, 320×700) with no horizontal overflow, the CTA above the fold, and screenshots.

The 24 existing Living Atlas tests run unchanged against `?mode=atlas`.

A bug was found by these tests and fixed: "position 9 of 4". The denominator counted only retained tags; it now counts everything the call returned, including set-aside items.

**Structured UX review (the implementing agent's, not a human review; the owner's review is pending).** Against the §20 journey:

1. what the product does: stated above the fold;
2. open research: 1 click;
3. a meaningful connection: named Paris palace hotels, auteur films and K-pop artists are visible on the fingerprint;
4. observed versus proposed: separate sections with separate wording;
5. why it was included: the first observed line;
6. a limitation: "What we cannot conclude";
7. next action: present on every detail and direction;
8. summary: one tab, printable and downloadable.

Inspecting a finding takes 2 clicks from the home page. No step requires knowing about agents, APIs or graphs. Automated tests do not prove the research is commercially valuable.

## 7. Accessibility

Accessibility checks:

- skip link;
- the existing visible focus ring on every control;
- the heading is focused after in-app navigation, but not on first load;
- `aria-current` on tabs, mode nav and selected rows;
- arrow keys, Home and End in lists;
- a labelled `fieldset` and `legend` for user context;
- `role="status"` and `role="alert"` for availability and errors;
- no hover-only action;
- no animation (verified under reduced motion).

Text uses the skill's tokens: `--ce-muted` on paper meets 4.5:1 as documented in the skill. No new colour was introduced. The status meaning is always written in words; the colour of the direction mark is supplementary.

## 8. Regression (Node 22.23.2, local)

| Check | Result |
| --- | --- |
| `pnpm lint`, `typecheck`, `build` | pass |
| `pnpm check:secrets` | pass (516 repo files, 19 bundle files) |
| `pnpm test` | backend 797/797; frontend 68/68 (was 29) |
| `pnpm test:e2e` (SYNTHETIC API + recorded evidence) | 44/44 in dev mode and 44/44 against the production build |
| `pnpm test:db` (isolated local PostgreSQL 16, `ce9b1_test`) | 15/15 |
| `pnpm eval:brand-baseline` | 41/41 |
| `eval:methodology`, `eval:agent`, `eval:query`, `smoke:offline` | pass; still report `LIVE_QLOO_VALIDATION_NOT_RUN`, `LIVE_AGENT_MODEL_VALIDATION_NOT_RUN`, `LIVE_HAIKU_QUERY_VALIDATION_NOT_RUN` |

These diffs are empty against `origin/main`: `backend/src`, `packages/shared`, `evals/`, migrations, API routes, budgets and idempotency. So 0.1, 0.2 and observation 0.3 contracts and the stored scan IDs and provenance are unchanged by construction. The test suites above confirm they are still read correctly.

Playwright ran through the repository runner. The Playwright MCP server is not attached to this session. Cloud CI was not triggered and is not claimed.

## 9. Performance and cost (measured locally, production build, synthetic backend, 5 runs)

| Metric | Result |
| --- | --- |
| Home DOMContentLoaded / FCP (warm) | ~20 ms / ~30 ms (first cold run 108 / 116 ms) |
| Reads on home | 2 free reads (`/api/brands/status`, `/api/agent/admissions`) |
| Opening recorded Loewe | ~125 ms; 1 request (`/api/demo/baselines`, static) |
| Deep link `?research=loewe` | ~31 ms; server-rendered, 0 extra API requests |
| Steps to inspect a finding | 2 clicks from home |
| Summary generation | < 1 ms in the browser (e2e asserts < 50 ms) |
| Client JS, all static chunks | 652,955 → 697,845 bytes raw (+44.9 KB); 195,490 → 208,766 gzip (+13.3 KB, +6.8%) |
| Console errors | none from the app. The synthetic backend lacks `/api/brands/status`, which produces one 404 there |

Viewing results makes no Qloo or Anthropic call. There is no new infrastructure and no new dependency.

## 10. Known research limitations

- **Loewe usefulness is still INSUFFICIENT for expansion strategy.** Its connections are specific and interesting but cannot be grouped from Qloo evidence. Its two directions are generic, and its brand core is unverified, so nothing can be called adjacent without the user's own context.
- Every entity is query-scoped. Whether `recommend` fills `subtype` is still unverified live.
- There is only one provenance-valid baseline recording. A second, stronger recorded brand needs a live scan.
- Classification adjacency depends on user context by design. That is honest, but it puts the judgement on the strategist.
- The "Ask about this finding" feature was not built and is not enabled.

## 11. Live Qloo canary: authorization request (not run)

**Status: `LIVE_QLOO_VALIDATION_NOT_RUN`.** The Sprint 9C request did not authorize provider dispatch, and none was made.

| Item | Proposal |
| --- | --- |
| Purpose | (a) whether `recommend` fills `subtype`; (b) Loewe tags 11–20 under template v2 |
| Command | `DATABASE_URL=postgresql://localhost:55432/<new empty db> pnpm baseline:canary Loewe` |
| Ceiling | **7 dispatched Qloo calls including retries** (the script sets the limit to 7 and refuses a database with any prior call); **0 Anthropic calls** |
| Expected sequence | 1 describe, 1 `entity_tags` (limit 20), 4 `recommend`; 1 dispatch spare for one justified retry |
| Host | hackathon host only (`backend/src/qloo/environment.ts` gate) |
| Isolation | a new local database on the isolated cluster; no production database; public admission flags stay off |
| Pre-checks already done | offline gates green (§8); the pinned template is `ce-brand-baseline/v2`; observation 0.3 captures `subtype` and `recordedRequestType`; the secret scanner is clean |
| Pre-checks at run time | verify the provider quota on the hackathon key; record this approval with its date |
| Stop conditions | any `UNKNOWN` dispatch, contract drift, or 7 reservations |
| Success | **contract verification**: the real request scope and subtype are captured and the integrity evaluators pass. **Product usefulness**: reported separately, only if the findings are specific and defensible |
| Not included | the optional second-stage `entity_tags` over returned artists needs its own approval |

If it is approved and succeeds, the new scan can be added to the recorded catalog with the existing builder, after review.

## 12. Hosted preview

The implementation commit `548f1d2` was pushed to `sprint/9c-brand-first-research-workspace`; it is not merged to `main`. The Vercel Git integration built preview `cultural-elasticity-2m0xpjt2u-raulmermans-projects.vercel.app` (target `preview`, Ready) in the existing project.

`node scripts/vercel-protection-probe.mjs` gave these results:

- the preview returned **HTTP 401** (not served anonymously);
- `/api/demo/baselines` redirected anonymous requests to SSO (302);
- the production alias returned **404 `DEPLOYMENT_NOT_FOUND`** (unassigned): `VERCEL_PROTECTION_PROBE_PASS`.

No protection bypass token was created, so the authenticated page was not rendered by the agent. The owner should open the preview while signed in to confirm it visually.

Railway (still `9fc12a6`), production, the admission flags and the database were not touched. The preview's brand research uses the bundled recorded artifact and the existing server-side backend proxy. Backend admissions are off, so live research reads as "temporarily unavailable".

## 13. Sprint 9D handoff

- Run the §11 canary if approved, then decide whether Loewe stays the lead demo.
- Ground entity themes (approved second stage) so associations can be grouped from evidence.
- Build the full strategic brief and the advanced comparison on top of `research-summary.ts`.
- Build a validated "Ask about this finding" endpoint, governed like the query layer, before any UI enables it.
- Get owner human review of the workspace copy and of `research-position/v1`.

## Final statuses

```
BRAND_FIRST_UX:                    PASS
CULTURAL_FINGERPRINT_PRESENTATION: PASS
TERRITORY_INTERPRETATION:          PARTIAL   (honest and conservative; adjacency only from user context; Loewe core unverified)
EVIDENCE_INTEGRITY:                PASS
USER_JOURNEY:                      PASS      (automated + agent review; owner review pending)
RESEARCH_USEFULNESS:               INSUFFICIENT (Loewe directions weak; connections specific but ungrouped)
DATABASE_REGRESSION:               PASS      (local isolated PostgreSQL 16)
FULL_REGRESSION:                   PASS      (local; cloud CI not run)
LIVE_QLOO_VALIDATION:              NOT_RUN   (LIVE_QLOO_VALIDATION_NOT_RUN; canary awaiting approval)
HOSTED_PREVIEW:                    VERIFIED  (Ready preview, SSO-protected 401; authenticated rendering not inspected by the agent)
PUBLIC_RELEASE_READY:              NO
AGENT_MODEL_READY:                 UNCHANGED — NOT_READY
```
