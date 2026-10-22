# frontend

Next.js (App Router) product shell. `/` is the Living Atlas: a question, an investigation, and a lineage of territories. Development-only pages remain at `/dev/analysis` and `/dev/methodology`.

Design decisions: [`.agents/skills/living-atlas-design/SKILL.md`](../.agents/skills/living-atlas-design/SKILL.md). Implementation notes: [`docs/sprint-5b2/LIVING_ATLAS_IMPLEMENTATION.md`](../docs/sprint-5b2/LIVING_ATLAS_IMPLEMENTATION.md).

```sh
pnpm --filter frontend dev     # http://localhost:3000
pnpm --filter frontend build
```

The browser calls `/api/agent/jobs` on this app. Those routes call `{BACKEND_URL}` (default `http://127.0.0.1:4000`). `BACKEND_URL` has no `NEXT_PUBLIC_` prefix, so it never reaches the browser.

```sh
pnpm --filter frontend test       # atlas presentation rules
pnpm test:e2e                     # browser tests, SYNTHETIC job API, not live Qloo
```

The frontend never talks to Qloo, and it must never receive `QLOO_API_KEY`. Future deployment target: Vercel.
