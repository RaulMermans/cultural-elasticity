import { defineConfig } from "@playwright/test";

const sentinelQloo = ["SENTINEL", "QLOO", "NOT", "IN", "BROWSER"].join("_");
const sentinelModel = ["SENTINEL", "MODEL", "NOT", "IN", "BROWSER"].join("_");

const production = process.env.E2E_MODE === "production";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3100",
    navigationTimeout: 120_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // The research network floats its cards; reduced motion keeps them still so clicks are stable.
    reducedMotion: "reduce",
  },
  webServer: [
    {
      command: "node e2e/synthetic-backend.mjs",
      url: "http://127.0.0.1:4100/health",
      reuseExistingServer: false,
    },
    {
      // Wait for HTTP 200 on `/`, not TCP listen. Next 16 binds the port before the first route compiles;
      // treating listen as ready made the first tests race a 30s hydration timeout against compilation.
      command: production
        ? "pnpm exec next start --port 3100 --hostname 127.0.0.1"
        : "pnpm exec next dev --port 3100 --hostname 127.0.0.1",
      url: "http://127.0.0.1:3100/",
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        BACKEND_URL: "http://127.0.0.1:4100",
        // SYNTHETIC: a production frontend needs both settings (Sprint 9J); the synthetic backend ignores it.
        CE_INTERNAL_API_SECRET: "SYNTHETIC-internal-auth-not-a-secret-00000000",
        QLOO_API_KEY: sentinelQloo,
        ANTHROPIC_API_KEY: sentinelModel,
      },
    },
  ],
});
