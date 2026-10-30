# frontend

Next.js (App Router) product. `/` is the brand research workspace: brand search, the cultural network, agent investigations, readings, reports and the saved library (`src/components/research/`). The Living Atlas is the optional exploration view at `/?mode=atlas` (`src/components/atlas/`). `/operator` is the operator console. Development-only pages under `/dev/` return 404 in production.

Design decisions: [`.agents/skills/living-atlas-design/SKILL.md`](../.agents/skills/living-atlas-design/SKILL.md); tokens in `src/app/globals.css`. Implementation notes: [`docs/sprint-5b2/LIVING_ATLAS_IMPLEMENTATION.md`](../docs/sprint-5b2/LIVING_ATLAS_IMPLEMENTATION.md).

```sh
pnpm --filter frontend dev     # http://localhost:3000
pnpm --filter frontend build
```

The browser calls this app's `/api/*` routes (brands, agent jobs, research handoff and comparison). Those routes call `{BACKEND_URL}` (default `http://127.0.0.1:4000`). `BACKEND_URL` has no `NEXT_PUBLIC_` prefix, so it never reaches the browser.

```sh
pnpm --filter frontend test       # presentation rules: readings, reports, eligibility, network
pnpm test:e2e                     # browser tests, SYNTHETIC job API, not live Qloo
```

The frontend never talks to Qloo, and it must never receive `QLOO_API_KEY`. It is deployed on Vercel from `main`.
