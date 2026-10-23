# Living Atlas design system

The authority is [`.agents/skills/living-atlas-design/SKILL.md`](../../.agents/skills/living-atlas-design/SKILL.md), version 2. This page records the same tokens for people reading the docs. If the two disagree, the skill and `frontend/src/app/globals.css` are corrected together. Do not invent a third palette.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--ce-paper` | `#f3eee4` | Page background |
| `--ce-paper-deep` | `#e7e0d2` | Quiet fills |
| `--ce-paper-raised` | `#f7f3eb` | Inspector and raised surfaces |
| `--ce-ink` | `#241e18` | Primary text |
| `--ce-ink-soft` | `#4a433a` | Secondary prose |
| `--ce-muted` | `#5c534a` | Meta text |
| `--ce-line` | `#d8d0c3` | Hairlines |
| `--ce-botanical` | `#3e5c49` | Living accent |
| `--ce-botanical-deep` | `#24382c` | Emphasis |
| `--ce-botanical-soft` | `#d5e2d6` | Soft wash |
| `--ce-clay` | `#8a6548` | Partial border |
| `--ce-sand` | `#ead9c6` | Warm support |
| `--ce-rose` | `#8f5d58` | Hypothesis border |
| `--ce-focus` | `#1d3428` | Focus |
| `--ce-danger` | `#7d3b34` | Failures |

Ink on paper is about 14:1. Muted on paper is about 6.5:1. Clay is a border, darkened so it clears 3:1 on sand. Status is never color alone.

Display type is Newsreader. UI type is Outfit. Both are loaded with `next/font` at build time, with system fallbacks.

## What the atlas is allowed to draw

A node is a brand investigation or a territory. An edge is an investigation step (`INVESTIGATED_FROM`). Position is a stable tree: new nodes are appended, completed nodes stay put. The organic radius is a hash of the node id. It is decoration.

The atlas does not draw cultural distance, affinity, a rank across calls, or a chance of success.
