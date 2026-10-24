# Living Atlas design system

The authority is [`.agents/skills/living-atlas-design/SKILL.md`](../../.agents/skills/living-atlas-design/SKILL.md), version 3. This page records the same tokens for people reading the docs. If the two disagree, the skill and `frontend/src/app/globals.css` are corrected together. Do not invent a third palette.

## Direction

Cultural Observatory. Editorial research on warm paper, with the atlas drawn as a lineage instrument on a deeper field. Territory panels are rectangular research objects. Geometry is investigation lineage, never a measured map.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--ce-paper` | `#efe8db` | Page background |
| `--ce-paper-deep` | `#e4dccb` | Quiet fills |
| `--ce-paper-raised` | `#f7f1e6` | Inspector and dialogs |
| `--ce-void` | `#161310` | Atlas field |
| `--ce-void-line` | `#2c2722` | Lines on the atlas |
| `--ce-ink` | `#1a1612` | Primary text |
| `--ce-ink-soft` | `#4a433b` | Secondary prose |
| `--ce-muted` | `#5c534b` | Meta text |
| `--ce-line` | `#d4cbb8` | Hairlines |
| `--ce-copper` | `#9c4a2b` | Primary CTA |
| `--ce-copper-ink` | `#f7f1e6` | Text on copper |
| `--ce-botanical` | `#2f4a3c` | Supported evidence |
| `--ce-botanical-deep` | `#1e3228` | Supported emphasis |
| `--ce-botanical-soft` | `#d7e4da` | Supported wash |
| `--ce-brass` | `#8a6540` | Partial border |
| `--ce-sand` | `#ead6bc` | Partial wash |
| `--ce-rose` | `#7d4a47` | Hypothesis |
| `--ce-focus` | `#1e3228` | Focus |
| `--ce-danger` | `#7d3b34` | Failures |

Ink on paper is about 14:1. Muted on paper is about 6.4:1. Brass is a border, darkened so it clears 3:1 on sand. Status is never color alone.

Display type is Newsreader. UI type is Outfit. Both are loaded with `next/font` at build time, with system fallbacks.

## What the atlas is allowed to draw

A node is a brand investigation or a territory. An edge is an investigation step (`INVESTIGATED_FROM`). Position is a stable measured tree: new nodes are appended, completed nodes stay put, boxes do not overlap.

The atlas does not draw cultural distance, affinity, a rank across calls, or a chance of success.
