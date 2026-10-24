<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Living Atlas

The product page is the Living Atlas. Follow `.agents/skills/living-atlas-design/SKILL.md` (version 5). Tokens live in `src/app/globals.css`. The opening screen is an empty observatory. Do not hardcode a brand, territory tree, or recorded investigation into the product UI. A recorded artifact may be served from `src/app/api/demo/recorded` and is labelled `RECORDED_EXAMPLE`; it is not a live investigation and is not the landing. When live admissions are paused, never present an enabled Ask that can only return ADMISSIONS_PAUSED.

The browser calls only the Next.js routes under `src/app/api/agent/jobs`. Those routes call the backend. Do not put `QLOO_API_KEY` or `ANTHROPIC_API_KEY` in client code, and do not give the client a backend URL.

Atlas layout is investigation lineage. Do not space nodes by affinity, distance, or a score. Do not hardcode a brand or territory tree. A synthetic browser fixture is not a live investigation.
