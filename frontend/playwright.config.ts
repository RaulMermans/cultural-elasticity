import { defineConfig } from "@playwright/test";

const sentinelQloo = ["SENTINEL", "QLOO", "NOT", "IN", "BROWSER"].join("_");
const sentinelModel = ["SENTINEL", "MODEL", "NOT", "IN", "BROWSER"].join("_");

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:3100", navigationTimeout: 120_000 },
  webServer: [
    { command: "node e2e/synthetic-backend.mjs", port: 4100, reuseExistingServer: false },
    {
      command: "pnpm exec next dev --port 3100",
      port: 3100,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        BACKEND_URL: "http://127.0.0.1:4100",
        QLOO_API_KEY: sentinelQloo,
        ANTHROPIC_API_KEY: sentinelModel,
      },
    },
  ],
});
