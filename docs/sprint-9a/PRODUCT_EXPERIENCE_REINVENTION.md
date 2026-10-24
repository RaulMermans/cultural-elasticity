# Sprint 9A — Product experience reinvention

Branch: `sprint/9a-product-experience-reinvention`  
Scope: Living Atlas frontend only. No Qloo calls, no Anthropic prompts, no evidence-class changes, no paid investigations, no production promotion.

This sprint replaces the organic-ellipse Atlas with **Cultural Observatory**: an editorial research instrument that makes the recorded Jacquemus investigation the first thing a visitor can actually use.

Design authority: [`.agents/skills/living-atlas-design/SKILL.md`](../../.agents/skills/living-atlas-design/SKILL.md) version 3. `docs/design/LIVING_ATLAS_DESIGN_SYSTEM.md` points here and does not override it.

## 1. UX audit of the original interface

Evidence: hosted Sprint 8F.2 screenshots in `docs/sprint-8f2/`, plus Playwright captures in `docs/sprint-9a/before/`.

| Surface | What was wrong |
| --- | --- |
| Landing 1440×900 | Display title consumed the fold. The atlas was hidden. The recorded example was an underline. Ask was the visual primary even when it could only fail. Two paragraphs of methodology sat above the product. |
| Recorded atlas | Territory nodes overlapped (Avant-garde vs Japanese drama). Long names clipped. Cubic edges were hard to read as parent–child. Organic radii made research objects look like decorative blobs. |
| Selected territory | Status copy, recorded disclaimer, and actions competed. “Why this matters” was missing. Follow-up looked live while admissions were paused. |
| Evidence inspector | Three recorded/not-commercial paragraphs before any finding. Methodology wall. Whole-investigation summary presented in the territory dossier. |
| Comparison | Compare was an underline with little selection feedback. |
| Admissions paused | Hosted mobile showed an enabled Ask next to “New investigations are not being accepted right now.” |
| Tablet / mobile | Ellipses survived on small screens because silhouette radii were inline. Horizontal overflow. Essential actions sat below a shrunken graph. |

Compilation and unit tests were green. Visual quality was not.

## 2. Art direction

**Cultural Observatory.** A contemporary cultural journal crossed with a museum collection instrument.

- Warm paper for reading (`#efe8db`).
- Near-black field for the atlas (`#161310`).
- Copper for the one primary action (`#9c4a2b`).
- Botanical and brass only as evidence-state marks, never as recommendations.
- Rectangular territory plates with a 4px evidence mark. No ellipses, no decorative circles, no glass, no neon.

Geometry remains investigation lineage. Position is not affinity, distance, opportunity, or a score.

## 3. Design system

Version 3 tokens live in `frontend/src/app/globals.css` and the skill. Type is still Newsreader + Outfit via `next/font`. Motion tokens: `--ce-motion-fast` 160ms, `--ce-motion-med` 240ms, removed under `prefers-reduced-motion`.

Breakpoints: ≥1100px three columns (context, atlas, finding); 721–1099px compact header, full-width atlas, finding beneath (so a third lineage column is not clipped); ≤720px guided branch list. The landing preview scales the recorded tree to fit its pane.

## 4. What changed in the product

- Landing: short value proposition, **Explore the Jacquemus investigation** as primary CTA, atlas preview from the recorded artifact, How it works dialog. Ask is mounted only when `/api/agent/admissions` reports `accepting`.
- Admissions probe: Next.js `GET /api/agent/admissions` reads backend `/ready` and returns `{ status: "accepting" \| "paused" \| "unavailable" }` only. No boot id, credentials, or spend.
- Atlas layout: measured tidy tree (`layoutAtlas`) with collision resolution. Recorded Jacquemus (five+ territories, long names) lays out with zero overlapping boxes.
- Landing preview scales that tree to fit its pane, so nested territories such as design-led boutique hospitality are not clipped.
- Workspace: context rail, observatory canvas, selected finding. Below 1100px the finding stacks under a full-width atlas so a third lineage column stays in view.
- Territory: status, key finding, why it is here, next action. Follow-up and new comparisons are disabled when live questions are not accepting, with the reason at that decision point.
- Evidence: dossier with a lead finding, then observed / calculated / inferred / missing. Whole-run notes and provenance sit behind disclosures.
- Mobile: stacked territory plates, parent–child still in the list, no shrunken graph, primary CTA above the fold at 390×844.

Backend research behaviour is unchanged.

## 5. Playwright before / after

| Before | After |
| --- | --- |
| `docs/sprint-9a/before/01-desktop-landing-1440x900.png` | `docs/sprint-9a/after/01-desktop-landing-1440x900.png` |
| `docs/sprint-9a/before/02-desktop-recorded-investigation.png` | `docs/sprint-9a/after/02-desktop-recorded-investigation.png` |
| `docs/sprint-9a/before/03-desktop-selected-territory.png` | `docs/sprint-9a/after/03-desktop-selected-territory.png` |
| `docs/sprint-9a/before/04-desktop-evidence-inspector.png` | `docs/sprint-9a/after/04-desktop-evidence-inspector.png` |
| Hosted mobile paused: `docs/sprint-8f2/vercel-preview-mobile-admissions-paused.png` | `docs/sprint-9a/after/05-mobile-landing-390.png`, `06-mobile-recorded-390.png`, `07-narrow-mobile-320.png`, `08-tablet-768.png` |

## 6. Desktop and mobile walkthrough

Desktop: mast identifies the observatory. The fold shows the promise and a live preview of the Jacquemus tree. The copper button opens the recorded run. The rail names the brand and question. The dark field holds collision-free plates. The right column states evidence status and the next action. Evidence opens as a dossier.

Mobile: the copper CTA is in the first screen. After open, context → territory list → finding → evidence. Nodes are full-width plates, not ellipses.

## 7. Accessibility

- Skip link, labelled fields, dialog names, visible focus (`--ce-focus`).
- Status is written in words (Supported / Partial / No evidence / Incomplete), not colour alone.
- Territory plates are buttons. Arrow keys move parent / child / siblings.
- Inspector and How it works move focus in and dismiss on Escape.
- `prefers-reduced-motion` removes the running-node breath and inspector entrance.
- Contrast: ink on paper ~14:1; muted on paper ≥4.5:1; brass borders ≥3:1 on sand.

Remaining: the Next.js dev overlay is not in production. Long methodology strings inside calculated results are still agent language; they are not invented, and they sit below the lead finding.

## 8. Regression

Frontend unit tests cover recorded parse, evidence scope, collision-free layout (including the Jacquemus artifact and long names), admissions parsing, and visitor identity.

Browser suite (`pnpm test:e2e`) is synthetic: no Qloo, no Haiku. **19 passed.** Coverage: recorded primary CTA, paused admissions (Ask absent, follow-up disabled, no job POST), landing-preview fit, tablet nested-territory visibility, responsive branch list, keyboard selection, reduced motion.

Also run: `pnpm lint` (pass), `pnpm typecheck` (pass), `pnpm test` (frontend 17, backend 756 / 60 files), `pnpm check:secrets` (pass), `pnpm build` (pass; new route `GET /api/agent/admissions`).

## 9. Protected Vercel preview

Preview of this branch only. No `--prod`. SSO protection is `deploymentType: all`.

| | |
| --- | --- |
| Deployment | `dpl_F3PQzUqA8xrvZeQgL5oJ9ugbCuk8` (READY, `target: null`) |
| Unique URL | `https://cultural-elasticity-n6bih6rjx-raulmermans-projects.vercel.app` |
| Branch alias | `https://cultural-elasticity-git-sprint-9a-p-ed0ba1-raulmermans-projects.vercel.app` |
| Project | `cultural-elasticity` (`prj_AHQcMcLFwGUOpRmepvwcc89LyOYo`) |
| Anonymous probe | **VERCEL_PROTECTION_PROBE_PASS** — both URLs HTTP 401, `servedApp=false` |

A later commit on this branch will create a new protected preview of the same Git ref. Do not promote production.

## 10. Git

Branch: `sprint/9a-product-experience-reinvention` (from `sprint/8f2-deployment-activation`).  
Implementation: `ab77f81e8316ff6648d43757c167dc9e2935ba2b` — *Sprint 9A: reinvent the Living Atlas as a Cultural Observatory.*  
Layout follow-up: `d2a79fb563cbd8ef5bddfb465720dc06c4059032` — landing preview fit, tablet stack, recaptured after screenshots.  
Report SHA (first cut): `0237d521a8c392c35894bc4d0e37e4278cf60d45`.

## 11. Remaining visual defects

- Calculated evidence still contains methodology identifiers such as `UNCERTAIN_REPRESENTATION_SENSITIVE`. Rewriting those strings would change analytical copy owned by the backend; they stay as recorded.
- On 390×844 the landing preview sits on the fold; the last plate can meet the viewport edge. The primary CTA is above the fold. Opening the recorded example uses the guided list, not that peek.
- The evidence inspector overlays the atlas. A nested territory on the right edge can sit under the dossier while the inspector is open. Close returns it.
- Orthogonal lineage edges are sometimes sparse on the wide desktop field. Parent–child remains readable from column and connector.
- In-process jobs and admissions stay paused until a later, separately authorised sprint.

## 12. Release readiness

**Not ready for public release.** This is a product-experience sprint on a protected preview. Admissions stay off. The agent remains `AGENT_MODEL_NOT_READY`. Do not start the public release sprint from this work.

### Acceptance

- [x] Opening screen has a clear primary CTA.
- [x] Recorded example is immediately accessible.
- [x] New visitor can read the purpose above the fold.
- [x] Atlas has no overlapping nodes (unit-tested on the recorded tree).
- [x] Territory text is legible, including long names.
- [x] Evidence states are understandable in words.
- [x] Navigation and selected context are clear.
- [x] Mobile is a list, not a shrunken graph.
- [x] Evidence inspector has a lead finding and grouped sections.
- [x] Paused / disconnected live questions are not presented as Ask.
- [x] Essential actions are keyboard accessible.
- [x] Responsive screenshots inspected in Playwright.
- [x] Backend research behaviour unchanged.
- [x] No paid API calls introduced (admissions probe is `/ready` only).
- [x] Design skill updated to version 3.

## Functional safety

`GET /api/agent/admissions` is the only new network path. It proxies `/ready`. Recorded demo remains `/api/demo/recorded`. Job routes are unchanged. Comparison constraints, territory-keyed evidence, and recovery copy are unchanged.
