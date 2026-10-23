import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Heavy fixture files exceed Vitest's 5s default when the suite runs in parallel.
    testTimeout: 20_000,
    // Unit and fixture tests must never reach live Qloo, even if a developer has a key exported.
    env: { QLOO_API_KEY: "" },
  },
});
