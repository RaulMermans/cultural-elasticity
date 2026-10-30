import { defineConfig } from "vitest/config";

/** Sprint 10C real process-interruption tests: disposable PostgreSQL (DATABASE_URL), synthetic provider only. */
export default defineConfig({
  test: {
    include: ["tests/**/*.db.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    env: { QLOO_API_KEY: "", ANTHROPIC_API_KEY: "" },
  },
});
