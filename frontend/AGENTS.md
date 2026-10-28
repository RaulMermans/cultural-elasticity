<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Brand research workspace and Living Atlas

The default product page is brand search, then the research network (`src/components/research/`); the Living Atlas is the optional `?mode=atlas` view. Follow `.agents/skills/living-atlas-design/SKILL.md` (version 7). Research copy lives in `src/lib/research-copy.ts`; the result adapter is `src/lib/research-view.ts`; the downloadable report is `src/lib/network-report.ts`. Tokens live in `src/app/globals.css`. The product bundles no recorded research. When live admissions are paused, no enabled control may start paid work; research already in the user's library still opens.

The browser calls only the Next.js routes under `src/app/api/agent/jobs`. Those routes call the backend. Do not put `QLOO_API_KEY` or `ANTHROPIC_API_KEY` in client code, and do not give the client a backend URL.

Atlas layout is investigation lineage. Do not space nodes by affinity, distance, or a score. Do not hardcode a brand or territory tree. A synthetic browser fixture is not a live investigation.
