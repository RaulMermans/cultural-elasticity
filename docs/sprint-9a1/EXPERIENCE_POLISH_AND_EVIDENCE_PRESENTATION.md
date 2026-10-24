# Sprint 9A.1 — Experience polish and evidence presentation

Branch: `sprint/9a1-experience-polish`  
Scope: Living Atlas frontend only. No Qloo calls, no Anthropic prompts, no evidence-class changes, no paid investigations, no production promotion.

This sprint refines the Cultural Observatory from Sprint 9A. It does not rebuild the product.

Design authority: [`.agents/skills/living-atlas-design/SKILL.md`](../../.agents/skills/living-atlas-design/SKILL.md) version 4.

## 1. Git baseline

Verified against GitHub `main` with `git ls-remote` (full `git fetch` was blocked by leftover Finder-duplicate refs with a zero SHA). Those local copy refs were removed.

| | |
| --- | --- |
| `origin/main` | `b8848ed205f2bc2c0f38ac9af4aa974ee964e4b8` (PR #22 merge) |
| Sprint 9A tip | `0bb12b3` (same tree as the merge) |
| This branch | created from `b8848ed` |

## 2. Visual audit

Baseline: Sprint 9A captures in `docs/sprint-9a/after/`, plus Playwright interaction with the local app. Hosted Sprint 9A preview was protected (All Deployments). The “Not connected” mast in 9A screenshots is an **environment** issue: those captures ran without a reachable `/ready`. It is not proof that Railway was down.

| Screen | Component | Observed (9A) | Expected | Severity |
| --- | --- | --- | --- | --- |
| Desktop atlas 1440 | Lineage edges | Orthogonal stubs floating in the field; Japanese drama and hospitality disconnected | Edges meet parent right-middle and child left-middle | P0 |
| Evidence dossier | Calculated copy | `UNCERTAIN_REPRESENTATION_SENSITIVE` in ordinary prose | Human label; canonical code in technical details | P0 |
| Selected finding | Key finding / why | Generic “Evidence supports a comparison” / “Investigated as a cultural territory” | Grounded observation from recorded evidence | P0 |
| Mast | Admissions | “Not connected” while investigations were paused | Distinct paused vs disconnected labels | P0 |
| Inspector | Overlay | Dossier covered nested plates on the right | Finding column hosts the dossier; atlas stays selectable | P0 |
| Mobile 390 / 320 | Guided list | Usable; Next.js N badge is local-dev only | Keep guided list, no shrunken graph | P1 |

## 3. Atlas geometry

Cause: `.canvas__edges` was stretched to `width/height: 100%` of the scrollport while plates used layout pixels. The SVG and the plates did not share a coordinate space.

Fix:

- Wrap the tree in a sized `.canvas__stage`.
- Draw the SVG at the stage’s explicit width and height (no stretch).
- Anchor edges from **rendered** plate geometry (`offsetLeft/Top/Width/Height`).
- Word-aware `nodeSize` and slightly larger column/row gaps for connector room. Spacing is still lineage depth and sibling order, never affinity or distance.

## 4. Territory hierarchy

Plates keep rectangular research-object form, 4px evidence marks, and written status (Supported / Partial / No evidence / Incomplete). Hover uses a copper border; selection keeps the copper ring. Partial is not styled as strong support.

## 5. Evidence presentation mapping

Centralised in `frontend/src/lib/evidence-presentation.ts`. Canonical backend values are not mutated.

| Canonical | Label | Explanation |
| --- | --- | --- |
| `UNCERTAIN_REPRESENTATION_SENSITIVE` | Representation-sensitive interpretation | The finding may depend on how the territory is represented. |
| Unknown `SNAKE_CASE` | Recorded technical detail | Kept in technical details. No invented meaning. |

Numbers in relative position, percentiles, and counts are preserved. Territory-key prefixes and `urn:tag:…` identifiers are stripped from ordinary lines. Canonical codes remain behind “Source and methodology details”.

The browser bundle must not contain the token `QLOO`. Recorded artifact lines that mention the evidence provider by name are therefore left as recorded; they are data, not a methodology class.

## 6. Finding panel

Reading order: territory name, evidence status, most relevant grounded observation (examples, then concepts, then comparison position), why that observation matters, limitations, then evidence.

Fallbacks stay honest: “Insufficient evidence to establish a territory-specific connection.” Partial evidence is described as incomplete, not as a recommendation.

## 7. Dossier

Docked in the finding column (not a full-viewport overlay). Order: lead finding, supporting observations, calculated evidence, agent interpretation, missing evidence, then provenance/methodology disclosure. Duplicate route/class lines are omitted when `keyEvidence` already carries them.

## 8. Inspector behaviour

Escape closes. Focus moves to Close on open and returns to **See the evidence**. Selection is preserved. Nested plates remain in the observatory pane; the pane may need a short scroll on a narrow desktop column.

## 9. Admission states

`interpretAdmissionProbe` maps `/ready` and `/health`:

| Probe | UI |
| --- | --- |
| `acceptingInvestigations: true` | Live research available. Ask enabled. |
| `acceptingInvestigations: false` or HTTP 503 | Live research temporarily unavailable. Ask absent. |
| `/health` 200 when `/ready` is unreachable | Paused, not disconnected. Ask absent. |
| Neither reachable | Service connection unavailable. Ask absent. |

A reachable paused backend is never labelled disconnected.

## 10. Screenshots

After captures (paused admissions stub, SYNTHETIC backend, Next.js **N** badge is local-dev only):

| | |
| --- | --- |
| Homepage 1440×900 | `docs/sprint-9a1/after/01-homepage-1440x900.png` |
| Homepage 390×844 | `docs/sprint-9a1/after/02-homepage-390x844.png` |
| Desktop atlas 1440×900 | `docs/sprint-9a1/after/03-desktop-atlas-1440x900.png` |
| Desktop atlas 1920×1080 | `docs/sprint-9a1/after/04-desktop-atlas-1920x1080.png` |
| Selected territory | `docs/sprint-9a1/after/05-selected-territory.png` |
| Nested territory | `docs/sprint-9a1/after/06-nested-territory.png` |
| Evidence dossier | `docs/sprint-9a1/after/07-evidence-dossier.png` |
| Inspector open / closed | `08-inspector-open.png`, `09-inspector-closed.png` |
| Tablet 768×1024 | `docs/sprint-9a1/after/10-tablet-768x1024.png` |
| Mobile 390×844 | `docs/sprint-9a1/after/11-mobile-390x844.png` |
| Narrow 320×700 | `docs/sprint-9a1/after/12-narrow-mobile-320x700.png` |

Baseline: `docs/sprint-9a/after/`.

## 11. Accessibility

- Skip link, labelled fields, dialog name on the dossier.
- Status in words.
- Arrow keys still move parent / child / siblings.
- Inspector focus in/out verified in Playwright.
- `prefers-reduced-motion` still removes the running-node breath and transitions.
- Contrast tokens unchanged.

## 12. Regression

| Command | Result |
| --- | --- |
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | frontend 29, backend 756 / 60 files |
| `pnpm build` | pass |
| `pnpm check:secrets` | pass |
| `pnpm test:e2e` | **22 passed** (SYNTHETIC job API; not live Qloo or Haiku) |

New coverage: paused vs disconnected labels, methodology mapping, unknown-code fallback, grounded selected finding, inspector Escape/focus, deterministic layout, measured edge anchors, mobile guided list, reduced motion.

`pnpm eval:methodology` / `pnpm eval:agent` were not required: backend evidence computation is unchanged. Backend unit contracts still passed.

## 13. Remaining defects

- Local screenshots include the Next.js **N** overlay. Production/preview builds do not.
- Recorded `keyEvidence` lines may still mention the evidence provider by name; that wording is in the artifact. The client mapper cannot rewrite `Qloo` without failing `check:secrets`.
- A nested plate on the far right can meet the observatory clip when the dossier is open; scroll reveals it. Close restores the finding column.
- On 390×844 the landing preview still meets the fold; the primary CTA stays above it. Opening the recorded example uses the guided list.
- Admissions stay paused until a later, separately authorised sprint.

## 14. Release readiness

**Not ready for public release.** Protected preview only. Admissions stay off. Do not start Sprint 9B from this work automatically.
