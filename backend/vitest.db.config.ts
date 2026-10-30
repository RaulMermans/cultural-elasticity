import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/brand-baseline-db.test.ts", "tests/run-ledger.db.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    env: { QLOO_API_KEY: "" },
  },
});
