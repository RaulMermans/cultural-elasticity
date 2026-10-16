# frontend

Next.js (App Router) shell for Cultural Elasticity. During Sprint 0 it only shows whether the backend is reachable.

```sh
pnpm --filter frontend dev     # http://localhost:3000
pnpm --filter frontend build
```

The page calls `GET {BACKEND_URL}/health` on the server (default `http://127.0.0.1:4000`). `BACKEND_URL` has no `NEXT_PUBLIC_` prefix, so it never reaches the browser.

The frontend never talks to Qloo, and it must never receive `QLOO_API_KEY`. Future deployment target: Vercel.
