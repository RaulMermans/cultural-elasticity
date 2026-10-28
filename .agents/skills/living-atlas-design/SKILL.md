---
name: living-atlas-design
description: Design and experience rules for the Cultural Elasticity product UI (brand research workspace and Living Atlas). Use when changing the product UI, visual language, atlas layout, evidence presentation, or motion. This is a development skill, not a runtime investigation skill.
version: "7"
---

# Living Atlas design and experience

Version 5. This file is the authority for product UI decisions. Tokens are implemented in `frontend/src/app/globals.css` and must match the values here. `docs/design/LIVING_ATLAS_DESIGN_SYSTEM.md` points here; it does not override it.

Version 5 makes the **brand research workspace** the default product view and the Living Atlas an optional exploration view (`?mode=atlas`). It keeps Cultural Observatory and every rule from versions 1–4, which still govern the Atlas. Version 4 added stage-aligned lineage edges, a docked evidence dossier, human-readable methodology presentation, and distinct connected-paused versus disconnected labels.

## Research network (version 7)

The **research network** is the only view of a brand's research (`research-network.ts`, `ResearchNetwork.tsx`, `NetworkBoard.tsx`): the brand in the middle, its baseline directions around it, and every investigation attached to the node it was asked from. Version 7 removed the section workspace and the bundled recorded research. The header offers Home, Save and go back, and a report download (PDF and HTML, stamped with the download date and time) built by `network-report.ts`.

- **Lineage only.** An edge means investigated-from. Ring, angle and card size are layout, never affinity, distance, confidence or elasticity. The board says so.
- **Opening a direction** shows its Qloo connections as small cards around it and a dossier: why it is here, its fingerprint, the connections behind it, what is unknown, and the degree of elasticity.
- **Degree of elasticity** is shown only from a deterministic classification of a comparison within one Qloo call. Otherwise it says "not measured" and why; "Measure it" pre-fills a comparison the user completes with references they name. It is never inferred from baseline evidence.
- **Agentic by default.** The composer below the board asks the agent a new question about the brand (explicit brand field) or a follow-up of the selected investigation (server run context only). The agent's validated follow-up options are offered as "Continue this path". The runtime and gate still own every decision.
- **Research library.** Scans and their networks are kept in this browser (local storage, never a URL) and reopen from the start screen. A job the server no longer holds is shown as "No longer available", never reconstructed.
- **Alive, calmly.** Dotted board with pan and zoom, cards that pop in and glide, a breathing halo while the agent works. All motion stops under reduced motion.

## Brand research workspace (version 5)

The default journey is: select brand → cultural fingerprint → connections → directions to investigate → inspect evidence → next research step, with a research summary at any point. One workspace, four sections (Cultural fingerprint, Connections, Directions, Summary). Section and selection live in the URL (`?research=<key>&view=<section>&item=<id>`), so back/forward and reload are predictable. A URL never carries a scan token.

- **Results before process.** Lead with the outcome sentence, then what Qloo shows, then uncertainty, then actions. Method, rule versions, audit counts and correlation IDs live only in "Source and method" and "Methodology details" disclosures.
- **Connections are not directions.** A connection is something Qloo returned. A direction is a research question. They use different views and different words.
- **Position classification is conservative** (`research-position/v1`, in `frontend/src/lib/research-view.ts`). The brand core comes only from Qloo's own category tags for the brand. Qloo evidence alone never makes a direction "adjacent". Without user context a direction is "Observed association, relation to the brand not established", or "Unresolved" when its source response was incomplete or it may duplicate another tag. A user may mark a direction "Already part of the brand" or "A new direction"; it is labelled "(your context)" everywhere, kept per tab, never sent to the server, and never changes evidence, strength or limitations.
- **Evidence detail has four parts:** what was observed, what this might mean, what we cannot conclude, what to investigate next. Query-scoped entities say "Returned when researching related artists. Qloo did not confirm its type individually." Positions are "position N of M" within one Qloo call, where M counts everything that call returned, and are never called a ranking.
- **Empty is useful.** Zero directions says "We found cultural connections, but not enough evidence for a new direction" and keeps the fingerprint. Insufficient evidence is missing evidence, not a finding.
- **Copy is centralised** in `frontend/src/lib/research-copy.ts`. Components never print a backend code. Unknown codes get a neutral fallback.
- **No recorded research** ships with the product. The brand box suggests only the user's own library.
- **Paused research:** Find brand is disabled; the library still opens. No enabled control may start a scan or a deep investigation while the matching admission is paused or unreachable.
- **Summary** is deterministic, built from the same view model as the screen, printable and downloadable as escaped HTML. It never adds a recommendation.

This skill is not one of the seven runtime agent skills. Do not register it in `backend/src/agent/skills/`.

## Philosophy

The Living Atlas is a cultural observatory. A visitor should immediately see what it does, open a real investigation, and inspect evidence without learning agent vocabulary.

Clarity comes first. Art direction makes that clarity recognizable. The screen is not a chatbot, a SaaS dashboard, a measured map, or a set of generic cards.

Presentation never owns analytical truth. Every number, class, evidence status, and lineage edge comes from a validated server response. Node position is investigation lineage. It is not affinity, distance, opportunity, confidence, or a recommendation.

## Art direction

Working title: Cultural Observatory.

Think: a contemporary cultural journal crossed with a museum collection instrument. Warm paper for reading. A deeper field for the atlas. Hairline plates. Territory panels as research objects. One copper accent for the primary action.

Avoid: generic SaaS chrome, chatbot transcripts, oversized empty heroes, card grids, decorative circles, neon, glassmorphism, heavy gradients, fake data viz, and continuous animation.

## Color

| Token | Value | Use |
| --- | --- | --- |
| `--ce-paper` | `#efe8db` | Page background |
| `--ce-paper-deep` | `#e4dccb` | Quiet fills, rails |
| `--ce-paper-raised` | `#f7f1e6` | Inspector, dialogs |
| `--ce-void` | `#161310` | Atlas field |
| `--ce-void-line` | `#2c2722` | Lines on the atlas field |
| `--ce-ink` | `#1a1612` | Primary text |
| `--ce-ink-soft` | `#4a433b` | Secondary prose |
| `--ce-muted` | `#5c534b` | Meta text, at least 4.5:1 on paper |
| `--ce-line` | `#d4cbb8` | Hairlines on paper |
| `--ce-copper` | `#9c4a2b` | Primary CTA, selected ring |
| `--ce-copper-ink` | `#f7f1e6` | Text on copper |
| `--ce-botanical` | `#2f4a3c` | Supported evidence accent |
| `--ce-botanical-deep` | `#1e3228` | Supported emphasis |
| `--ce-botanical-soft` | `#d7e4da` | Supported wash |
| `--ce-brass` | `#8a6540` | Partial / uncertain. Dark enough for a 3:1 border on sand |
| `--ce-sand` | `#ead6bc` | Partial wash |
| `--ce-rose` | `#7d4a47` | Hypothesis accent |
| `--ce-focus` | `#1e3228` | Focus ring |
| `--ce-danger` | `#7d3b34` | Failures only |

Do not use green to mean a business recommendation. Evidence support is not predicted success. Copper is the product accent, not a score.

## Typography

- Display: Newsreader, then Iowan Old Style, Palatino, Georgia. Self-hosted through `next/font`.
- UI: Outfit, then Avenir Next, Segoe UI. Self-hosted through `next/font`.
- Do not load a paid font and do not add a font CDN besides the build-time `next/font` fetch.
- Display type is for the product title, investigation question, and territory names.
- UI type is for controls, status, and evidence.
- Body size stays at or above 1rem. Meta text stays at or above 0.9rem.
- Display tracking is slightly tight. Meta uses small caps / wide tracking, never all-caps paragraphs.

Scale (implemented in CSS): display `clamp(2.25rem, 6vw, 4.25rem)`, title `1.85rem`, body `1.0625rem`, meta `0.9rem`.

## Space

`--ce-space-1` 0.25rem through `--ce-space-8` 5.5rem, in the steps defined in `globals.css`. Radius is `--ce-radius` (0.35rem) for plates and `--ce-radius-pill` (999px) only for the primary CTA. Territory panels are rectangular research objects with a 4px evidence mark, not ellipses.

## Components

- One job per component: shell, landing, workspace, canvas, node, connection, context rail, detail, inspector, progress, clarification, confirmation.
- Do not build a second page that owns the investigation.
- Server state and presentation state stay apart. Components receive validated responses and callbacks.
- No `dangerouslySetInnerHTML`. Model text is untrusted.
- Do not add a heavyweight UI framework for polish.

## Atlas geometry

The atlas is a **deterministic investigation tree**.

- A node is a brand investigation or a territory panel.
- An edge means investigated-from.
- Layout is a tidy left-to-right tree with measured boxes. New nodes are appended. Completed nodes keep their coordinates.
- Panels must not overlap. Labels must not clip. Long names wrap inside the panel.
- Position encodes only tree depth and sibling order. It never encodes affinity, distance, rank, or fit.
- Do not use organic silhouettes, force-directed graphs, or geographic maps.

Desktop shows the tree on the observatory field. Edges are drawn in the same coordinate space as the plates (a sized stage, not a stretched overlay). Anchor points use rendered plate geometry. Mobile does not shrink that tree: it uses a guided branch list (parent, selection, children).

## Interaction hierarchy

The opening screen (brand discovery) answers two questions above the fold: what this is and how to start. When new brand research is paused or unreachable it says so plainly.

Inside the Atlas (`?mode=atlas`), when live investigations are paused or disconnected, the primary action is **Explore the Jacquemus investigation**. Do not present an enabled Ask that can only return `ADMISSIONS_PAUSED`.

Admission labels:

| State | Short label |
| --- | --- |
| Checking | Checking the research service. |
| Connected and accepting | Live research available. |
| Connected and paused | Live research temporarily unavailable. |
| Unreachable | Service connection unavailable. |

Never label a reachable paused backend as disconnected.

When live investigations are accepting, expose them as a clearly labelled **Ask a cultural question** entry.

Territory actions (inspect, narrow, compare, return) appear after a territory is selected. One selected territory is the active context. Status is written in words, not carried by color alone.

## Navigation

Returning to an earlier investigation restores that run and the selected territory. It does not start another cultural investigation. If the server no longer holds the run, show the recovery state. Do not rebuild evidence in the browser.

A recorded example is local to the artifact. Moving inside it does not call the live agent. A follow-up from a recorded territory starts a new live question only when admissions are accepting. Otherwise say that live questions are paused.

Do not show several competing navigations. Desktop: context rail, atlas, selected finding. Mobile: context → branch list → finding → evidence.

## Evidence

Say what was observed, what was calculated, what the agent inferred, and what could not be established. Lead with the key finding. Provenance stays behind a disclosure. Synthetic results say they are synthetic. Recorded results say they are recorded.

Ordinary explanations use the presentation mapping in `frontend/src/lib/evidence-presentation.ts`. Canonical methodology codes stay in a technical-details disclosure. Unknown codes receive a generic fallback and are never given a fabricated meaning. Do not mutate backend evidence.

The selected-finding column leads with territory, evidence status, the most relevant grounded observation, why that observation matters, then limitations. If there is no meaningful observation, say so.

Match evidence by territory key and source run. Investigation-wide findings stay in a separate, labelled aggregate. Do not present that aggregate as the selected territory's evidence.

Keep these apart:

- Not yet investigated, versus investigated and unsupported.
- No usable evidence, versus stopped before enough evidence was collected.
- Interrupted, failed, and incomplete.
- Hypothesis, partial evidence, and evidence that supports a comparison.

A supported comparison is not an investment recommendation. Say that once, at the evidence decision point, not as a paragraph on every surface.

## Loading and failure

Progress copy comes from the job stage the server reported. Do not show a percentage. A timeout, cancellation, disconnect, or expired job is a workflow state. It is not evidence that a territory is unsupported.

## Motion

Use motion to change selection, highlight the active edge, open the inspector, and enter the workspace. Duration tokens: `--ce-motion-fast` 160ms, `--ce-motion-med` 240ms. Honor `prefers-reduced-motion` by removing transitions and the running-node breath. Animation must not trap keyboard focus, obscure evidence, or delay the primary action.

## Focus

Opening a clarification, a confirmation, or the inspector moves focus into that surface and returns it on dismiss. The inspector occupies the finding column; it does not overlay nested plates. Escape closes it. The selected node is the thing `scrollIntoView` follows. Arrow keys move between parent, children, and siblings. Essential actions are available without hover.

## Accessibility

Target WCAG 2.2 AA. Visible focus, labels on fields, dialogs with names, status text not carried by color alone, and a live region for progress and errors.

## Responsive

- ≥1100px: context rail, atlas, selected finding. The dossier occupies the finding column. Below 1440px it stays the finding-column width so the atlas does not shrink further.
- 721–1099px: compact context header, full-width atlas, finding or dossier beneath. Do not force a third column that clips the tree.
- ≤720px: guided branch list. No desktop graph. No horizontal overflow.

Primary CTA remains above the fold at 1440×900 and 390×844.

## Anti-patterns

Dense dashboards, consoles, card grids, chatbot transcripts, neon, heavy gradients, force-directed graphs, organic ellipses, invented scores, cultural-distance spacing, hover-only actions, enabled paused Ask, and hardcoded brand or territory trees in the product UI.

## Regression

A UI change needs the atlas model tests, evidence-presentation tests, research-view and research-route tests, admissions tests, and the synthetic browser suite (`pnpm test:e2e`). Workspace changes are checked at 320 / 390 / 768 / 1440 / 1920. A change to tokens, type, or evidence language needs a look at the rendered opening screen, a synthetic investigation, a selected territory, the inspector, a paused live entry, a failure, and 320 / 390 / 768 / 1440 viewports. Check keyboard access and `prefers-reduced-motion`. Do not treat a successful compile as visual acceptance. No overlap, clipped label, or dangling edge is acceptable.

## Review

- Does a first-time visitor understand what this is without scrolling?
- Does the screen still read as one investigation, not a dashboard?
- Could a spacing or color be mistaken for a measurement or a recommendation?
- Is every status also written in words?
- Are paused live investigations represented honestly?
- Does keyboard access reach the same actions as the pointer?
- Does reduced motion remove the breath without removing the action?
- Is any model text inserted as HTML?
