import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Unit and fixture tests must never reach live Qloo, even if a developer has a key exported.
    env: { QLOO_API_KEY: "" },
  },
});
