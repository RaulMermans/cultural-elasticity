# frontend

Next.js (App Router) shell for Cultural Elasticity. It shows whether the backend is reachable. Development-only pages: `/dev/analysis` (Sprint 1 ingredients) and `/dev/methodology` (Sprint 2 methodology result for a live benchmark fixture).

```sh
pnpm --filter frontend dev     # http://localhost:3000
pnpm --filter frontend build
```

The page calls `GET {BACKEND_URL}/health` on the server (default `http://127.0.0.1:4000`). `BACKEND_URL` has no `NEXT_PUBLIC_` prefix, so it never reaches the browser.

The frontend never talks to Qloo, and it must never receive `QLOO_API_KEY`. Future deployment target: Vercel.
