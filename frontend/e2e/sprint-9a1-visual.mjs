/**
 * Sprint 9A.1 visual captures. SYNTHETIC backend + recorded demo. Not a live provider run.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(new URL("../../docs/sprint-9a1/after/", import.meta.url)));
const dir = join(root, "after");
mkdirSync(dir, { recursive: true });
const shot = (name) => join(dir, name);

const browser = await chromium.launch();
const page = await browser.newPage();

async function pausedLanding() {
  await page.route("**/api/agent/admissions", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "paused" }) });
  });
}

await pausedLanding();
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto("http://127.0.0.1:3100/", { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.getByTestId("atlas-app").waitFor();
await page.getByTestId("landing-empty").waitFor({ timeout: 20_000 });
await page.screenshot({ path: shot("01-homepage-1440x900.png") });

await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: shot("02-homepage-390x844.png") });

await page.setViewportSize({ width: 1440, height: 900 });
await page.goto("http://127.0.0.1:3100/?recorded=1", { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.getByRole("note").waitFor();
await page.getByTestId("atlas-stage").waitFor();
await page.screenshot({ path: shot("03-desktop-atlas-1440x900.png") });

await page.setViewportSize({ width: 1920, height: 1080 });
await page.screenshot({ path: shot("04-desktop-atlas-1920x1080.png") });

await page.setViewportSize({ width: 1440, height: 900 });
await page.getByTestId("atlas-canvas").getByRole("button", { name: /Art and culture/ }).first().click();
await page.getByRole("heading", { name: "Art and culture" }).waitFor();
await page.screenshot({ path: shot("05-selected-territory.png") });

await page.getByTestId("atlas-canvas").getByRole("button", { name: /design-led boutique hospitality/ }).first().click();
await page.getByRole("heading", { name: /design-led boutique hospitality/ }).waitFor();
await page.screenshot({ path: shot("06-nested-territory.png") });

await page.getByTestId("atlas-canvas").getByRole("button", { name: /Bohemian lifestyle/ }).first().click();
await page.getByRole("heading", { name: "Bohemian lifestyle" }).waitFor();
await page.screenshot({ path: shot("09-inspector-closed.png") });
await page.getByTestId("evidence-open").click();
await page.getByTestId("evidence-inspector").waitFor();
await page.screenshot({ path: shot("07-evidence-dossier.png") });
await page.screenshot({ path: shot("08-inspector-open.png") });
await page.getByTestId("evidence-close").click();

await page.setViewportSize({ width: 768, height: 1024 });
await page.screenshot({ path: shot("10-tablet-768x1024.png") });

await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: shot("11-mobile-390x844.png"), fullPage: true });

await page.setViewportSize({ width: 320, height: 700 });
await page.screenshot({ path: shot("12-narrow-mobile-320x700.png"), fullPage: true });

await browser.close();
console.log(`Wrote Sprint 9A.1 captures to ${dir}`);
