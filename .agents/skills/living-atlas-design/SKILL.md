---
name: living-atlas-design
description: Design and experience rules for the Cultural Elasticity Living Atlas. Use when changing the product UI, visual language, atlas layout, evidence presentation, or motion. This is a development skill, not a runtime investigation skill.
version: "2"
---

# Living Atlas design and experience

Version 2. This file is the authority for product UI decisions. Tokens are implemented in `frontend/src/app/globals.css` and must match the values here. `docs/design/LIVING_ATLAS_DESIGN_SYSTEM.md` points here; it does not override it. Version 2 keeps the version 1 palette and type. It adds the interaction, navigation, evidence-scope, and recorded-example rules that the product now implements.

This skill is not one of the seven runtime agent skills. Do not register it in `backend/src/agent/skills/`.

## Philosophy

The Living Atlas is an instrument for cultural investigation. It should feel artistic, serene, intelligent, premium, organic, and memorable. Clarity comes first. Art direction makes that clarity recognizable.

The investigation shapes the interface. The user's exploration shapes the next investigation. The screen is not a chatbot, a dashboard, or a measured map.

Presentation never owns analytical truth. Every number, class, evidence status, and lineage edge comes from a validated server response.

## Color

| Token | Value | Use |
| --- | --- | --- |
| `--ce-paper` | `#f3eee4` | Page background |
| `--ce-paper-deep` | `#e7e0d2` | Quiet fills |
| `--ce-paper-raised` | `#f7f3eb` | Inspector and raised surfaces |
| `--ce-ink` | `#241e18` | Primary text |
| `--ce-ink-soft` | `#4a433a` | Secondary prose |
| `--ce-muted` | `#5c534a` | Meta text, at least 4.5:1 on paper |
| `--ce-line` | `#d8d0c3` | Hairlines |
| `--ce-botanical` | `#3e5c49` | Living accent, links of inquiry |
| `--ce-botanical-deep` | `#24382c` | Emphasis and focus ink |
| `--ce-botanical-soft` | `#d5e2d6` | Soft selection wash |
| `--ce-clay` | `#8a6548` | Partial / uncertain accent. Dark enough for a 3:1 border on sand |
| `--ce-sand` | `#ead9c6` | Warm support |
| `--ce-rose` | `#8f5d58` | Hypothesis accent |
| `--ce-focus` | `#1d3428` | Focus ring |
| `--ce-danger` | `#7d3b34` | Failures only |

Do not use green to mean a business recommendation. Evidence support is not predicted success.

## Typography

- Display: Newsreader, then Iowan Old Style, Palatino, Georgia. Self-hosted through `next/font`.
- UI: Outfit, then Avenir Next, Segoe UI. Self-hosted through `next/font`.
- Do not load a paid font and do not add a font CDN besides the build-time `next/font` fetch.
- Display type is for the question, territory names, and section titles. UI type is for controls and evidence.
- Body size stays at or above 1rem. Meta text stays at or above 0.9rem.

## Space

`--ce-space-1` 0.25rem through `--ce-space-8` 5.5rem, in the steps defined in `globals.css`. Prefer those steps. Radius for sheets and the composer is `--ce-radius` (1.75rem). Nodes may use a seeded organic radius; that radius is decoration.

## Components

- One job per component: shell, composer, canvas, node, connection, detail, inspector, progress, clarification, confirmation, history, navigation.
- Do not build a second page that owns the investigation.
- Server state and presentation state stay apart. Components receive validated responses and callbacks.
- No `dangerouslySetInnerHTML`. Model text is untrusted.

## Organic language

Nodes are softly irregular. Edges are quiet cubic curves. A node silhouette is seeded from its id so it stays stable, and it encodes nothing about evidence. Do not add illustrations that imply a measured relationship.

## Motion

Use motion to reveal a branch, move focus, open the inspector, and return to an ancestor. One slow breath on a node is enough. Honor `prefers-reduced-motion` by removing that breath. Animation must not trap keyboard focus or block a click. Do not animate progress that the server did not report.

## Interaction hierarchy

The opening screen answers three questions before any control: what this is, what to ask, and that a recorded investigation can be opened without waiting. The composer is the primary action. The recorded example is secondary and labelled as recorded. Territory actions (inspect, narrow, compare, return) appear only after a territory is selected.

One selected territory is the active context. Its border is botanical-deep with a soft ring. Status is also written in words. Do not rely on the ring alone.

## Navigation

The atlas is a tree of investigations. An edge means investigated-from. It does not mean distance, affinity, rank, or fit. Completed nodes keep their coordinates when a new branch arrives. Provide the same actions as buttons and links, not only as SVG. Mobile shows the selected branch, its parent, and its children, not a shrunken desktop canvas.

Returning to an earlier investigation restores that run and the selected territory. It does not start another cultural investigation. If the server no longer holds the run, show the recovery state. Do not rebuild evidence in the browser.

A recorded example is local to the artifact. Moving inside it does not call the live agent. A follow-up from a recorded territory starts a new live question that names the brand and the territory in the text. It does not pretend the recorded run is still held.

## Narrowing

A follow-up that only says to go deeper is a request for a concept, not a territory name. Ask which part of the territory to explore. An explicit concept may start a child investigation. The child does not inherit the parent's classification, ranking, robustness, or scores. The edge still means investigated-from.

## Evidence scope

Match evidence by territory key and source run. A display name is not enough when more than one territory shares it, or when the key is missing. Then say "Territory-specific evidence is unavailable." Investigation-wide findings stay in a separate, labelled aggregate. Do not present that aggregate as the selected territory's evidence.

## Loading and failure

Progress copy comes from the job stage the server reported. Do not show a percentage. A timeout, cancellation, disconnect, or expired job is a workflow state. It is not evidence that a territory is unsupported. A lost run says the investigation is no longer held and offers a new question.

## Focus

Opening a clarification, a confirmation, or the inspector moves focus into that surface and returns it on dismiss. The selected node is the thing `scrollIntoView` follows. Keyboard access reaches the same actions as the pointer.

## Evidence

Say what was observed, what was calculated, what the agent inferred, and what could not be established. Provenance stays behind a disclosure. Synthetic results say they are synthetic.

Keep these apart:

- Not yet investigated, versus investigated and unsupported.
- No usable evidence, versus stopped before enough evidence was collected.
- Interrupted, failed, and incomplete.
- Hypothesis, partial evidence, and evidence that supports a comparison.

A supported comparison is not an investment recommendation. Say that in the inspector.

## Accessibility

Target WCAG 2.2 AA. Visible focus, labels on fields, dialogs with names, status text not carried by color alone, and a live region for progress and errors. Essential actions are available without hover.

## Responsive

Desktop: canvas plus a detail column. Below 900px: one column, inspector as a bottom sheet. Below 720px: guided branch list, edges hidden.

## Anti-patterns

Dense dashboards, consoles, card grids, chatbot transcripts, neon, heavy gradients, force-directed graphs, invented scores, cultural-distance spacing, hover-only actions, and hardcoded brand or territory trees in the product UI.

## Regression

A UI change needs the atlas model tests and the synthetic browser suite (`pnpm test:e2e`). A change to tokens, type, or evidence language needs a look at the rendered opening screen, the recorded example, a selected territory, the inspector, a narrowing prompt, a failure, and a narrow viewport. Check keyboard access and `prefers-reduced-motion`. Do not treat a successful compile as visual acceptance.

## Review

- Does the screen still read as one investigation, not a dashboard?
- Could a spacing or color be mistaken for a measurement or a recommendation?
- Is every status also written in words?
- Does keyboard access reach the same actions as the pointer?
- Does reduced motion remove the breath without removing the action?
- Is any model text inserted as HTML?
