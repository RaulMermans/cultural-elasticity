/**
 * One-shot visual QA captures. SYNTHETIC backend + recorded demo. Not a live provider run.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const dir = fileURLToPath(new URL("../test-results/visual-qa/", import.meta.url));
mkdirSync(dir, { recursive: true });
const shot = (name) => join(dir, name);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://127.0.0.1:3100/", { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.getByTestId("atlas-app").waitFor();
await page.screenshot({ path: shot("01-opening.png"), fullPage: true });

await page.getByTestId("recorded-open").click();
await page.getByRole("note").waitFor();
await page.screenshot({ path: shot("02-recorded.png"), fullPage: true });

await page.getByTestId("atlas-canvas").getByRole("button", { name: /Bohemian lifestyle/ }).first().click();
await page.getByRole("heading", { name: /Bohemian lifestyle/ }).waitFor();
await page.screenshot({ path: shot("03-selected.png"), fullPage: true });

await page.getByTestId("evidence-open").click();
await page.getByTestId("evidence-inspector").waitFor();
await page.screenshot({ path: shot("04-inspector.png"), fullPage: true });
await page.getByTestId("evidence-close").click();

await page.getByTestId("follow-up-input").waitFor();
await page.screenshot({ path: shot("05-narrowing.png"), fullPage: true });

await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: shot("06-mobile.png"), fullPage: true });

await page.setViewportSize({ width: 1280, height: 800 });
await page.getByTestId("query-input").fill("Where could Paper Lantern expand?");
await page.getByTestId("query-submit").click();
await page.getByTestId("progress").waitFor();
await page.screenshot({ path: shot("07-running.png"), fullPage: true });
await page.getByTestId("progress-stop").click();
await page.getByText("was stopped").waitFor();
await page.screenshot({ path: shot("08-cancelled.png"), fullPage: true });

await browser.close();
console.log(`Wrote visual QA captures to ${dir}`);
