import { defineConfig, devices } from "@playwright/test";

/**
 * Sprint 9J hosted audit: a real browser against a deployed frontend, with no web server, route stub or
 * synthetic backend. It reads recorded evidence only and must never start paid research.
 *   E2E_HOSTED_URL=https://<deployment> pnpm --filter frontend exec playwright test -c playwright.hosted.config.ts
 */
const baseURL = process.env.E2E_HOSTED_URL;
if (!baseURL) throw new Error("E2E_HOSTED_URL is required for the hosted audit.");

export default defineConfig({
  testDir: "./e2e-hosted",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  // Failure traces stay local: they can hold full page content. The specs write their own redacted evidence.
  outputDir: "test-results/hosted",
  use: {
    baseURL,
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-1440x900", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "tablet-768x1024", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: "mobile-390x844", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  ],
});
