import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const legacy = JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/synthetic/brand-baseline-e2e.json", import.meta.url), "utf8")) as { fixtureType: "synthetic"; result: { scanId: string } };
const v2 = JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/synthetic/brand-baseline-e2e-v2.json", import.meta.url), "utf8")) as { fixtureType: "synthetic"; results: Record<"hypotheses" | "zeroTerritory" | "insufficient" | "partialProvider", { scanId: string; scanStatus: string }> };
const shots = fileURLToPath(new URL("../../docs/sprint-9b1/screenshots/", import.meta.url));
// Terms that must never appear in the main research view (they may appear inside "Methodology details").
const DEVELOPER_TERMS = /urn:|mcp-|correlation|entity_tags|syn-tags|QUERY_SCOPED|OBSERVED_ASSOCIATION|ce-brand-baseline|_[a-z]+_/u;

async function routeBaseline(page: Page, result: { scanId: string; scanStatus: string }, enabled = true) {
  await page.route("**/api/brands/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const respond = (value: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (path === "/api/brands/status") return respond({ enabled, semantics: "baseline_admission_only" });
    if (path === "/api/brands/resolve") return respond({ resolutionId: "00000000-0000-4000-8000-000000000030", accessToken: "syn-token", status: "RESOLVED", entity: { qlooId: "syn-brand-case", label: "SYNTHETIC House" } });
    if (path === "/api/brands/baselines" && route.request().method() === "POST") return respond({ scanId: result.scanId, scanStatus: "QUEUED", reused: false, cached: false }, 202);
    if (path === `/api/brands/baselines/${result.scanId}`) return respond({ scanStatus: result.scanStatus, providerCallCount: 5, stages: [{ stage: "tags", status: "COMPLETE" }], result });
    return respond({ error: "not_found" }, 404);
  });
}

async function startScan(page: Page) {
  await page.goto("/");
  await page.getByLabel("Brand name").fill("SYNTHETIC House");
  await page.getByRole("button", { name: "Find brand" }).click();
  await page.getByRole("button", { name: "Start cultural baseline" }).click();
  await expect(page.getByRole("heading", { name: /SYNTHETIC House · Cultural Fingerprint/u })).toBeVisible();
}

const mainText = async (page: Page) => (await page.locator(".brand-baseline__result").evaluate((node) => {
  const clone = node.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("details").forEach((details) => details.remove());
  return clone.innerText;
}));

test("SYNTHETIC legacy 0.1 result: ambiguity, start, and provenance only inside methodology details", async ({ page }) => {
  let resolveCalls = 0;
  await page.route("**/api/brands/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const respond = (value: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (path === "/api/brands/status") return respond({ enabled: true, semantics: "baseline_admission_only" });
    if (path === "/api/brands/resolve") {
      resolveCalls += 1;
      if (resolveCalls === 1) return respond({ resolutionId: "00000000-0000-4000-8000-000000000020", accessToken: "syn-token", status: "AMBIGUOUS", candidates: [{ qlooId: "syn-brand-21", label: "Northwind Atelier", type: "brand" }, { qlooId: "syn-brand-22", label: "Northwind Atelier Studio", type: "brand" }] });
      return respond({ resolutionId: "00000000-0000-4000-8000-000000000023", accessToken: "syn-token", status: "RESOLVED", entity: { qlooId: "syn-brand-21", label: "Northwind Atelier" } });
    }
    if (path === "/api/brands/baselines" && route.request().method() === "POST") return respond({ scanId: legacy.result.scanId, scanStatus: "QUEUED", reused: false, cached: false }, 202);
    if (path === `/api/brands/baselines/${legacy.result.scanId}`) return respond({ scanStatus: "COMPLETE", providerCallCount: 0, stages: [{ stage: "tags", status: "COMPLETE" }], result: legacy.result });
    return respond({ error: "not_found" }, 404);
  });
  await page.goto("/");
  await page.getByLabel("Brand name").fill("Northwind Atelier");
  await page.getByRole("button", { name: "Find brand" }).click();
  await expect(page.getByText("Qloo found more than one brand.")).toBeVisible();
  await page.getByRole("button", { name: "Northwind Atelier", exact: true }).click();
  await expect(page.getByText("Confirmed: Northwind Atelier")).toBeVisible();
  await page.getByRole("button", { name: "Start cultural baseline" }).click();
  await expect(page.getByRole("heading", { name: /Northwind Atelier · Cultural Fingerprint/u })).toBeVisible();
  await expect(page.getByText("Recorded with an earlier method.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: /Craft One Qloo observation/u }).click();
  await expect(page.getByText("syn-corr-21")).toBeHidden();
  await page.getByText("Methodology details").click();
  await expect(page.getByText("syn-corr-21")).toBeVisible();
  expect(resolveCalls).toBe(2);
});

test("SYNTHETIC 0.2 hypotheses: why, certainty, next step, keyboard, and no developer terms", async ({ page }) => {
  await routeBaseline(page, v2.results.hypotheses);
  await startScan(page);
  await expect(page.getByRole("heading", { name: "What we found" })).toBeVisible();
  await expect(page.getByText("Returned when Qloo was asked for artists. Qloo did not confirm each result individually.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Territories worth investigating" })).toBeVisible();
  expect(await mainText(page)).not.toMatch(DEVELOPER_TERMS);
  const territory = page.getByRole("button", { name: /Runway model One Qloo observation/u });
  await territory.focus();
  await page.keyboard.press("Enter");
  await expect(territory).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Why it appeared.")).toBeVisible();
  await expect(page.getByText(/includes “Runway model”/u)).toBeVisible();
  await expect(page.getByText("How certain.")).toBeVisible();
  await expect(page.getByText(/Run a deep research comparison/u).first()).toBeVisible();
  expect(await mainText(page)).not.toMatch(DEVELOPER_TERMS);
  await page.screenshot({ path: `${shots}desktop-hypotheses.png`, fullPage: true });
  await page.getByText("Methodology details").click();
  await expect(page.getByText(/set aside as venue metadata/u)).toBeVisible();
  await page.locator(".brand-baseline__method").screenshot({ path: `${shots}desktop-methodology-details.png` });
});

test("SYNTHETIC zero-territory result says why and what to explore next", async ({ page }) => {
  await routeBaseline(page, v2.results.zeroTerritory);
  await startScan(page);
  await expect(page.getByText("Research complete, with gaps")).toBeVisible();
  await expect(page.getByText("No territory hypothesis is supported yet.")).toBeVisible();
  await expect(page.getByText(/free descriptive keywords or describe the brand's own category/u)).toBeVisible();
  await expect(page.getByRole("heading", { name: "What to explore next" })).toBeVisible();
  expect(await mainText(page)).not.toMatch(DEVELOPER_TERMS);
  await page.screenshot({ path: `${shots}desktop-zero-territory.png`, fullPage: true });
});

test("SYNTHETIC insufficient evidence is shown as such, never as an empty finding", async ({ page }) => {
  await routeBaseline(page, v2.results.insufficient);
  await startScan(page);
  await expect(page.getByText("Not enough evidence for a profile")).toBeVisible();
  await expect(page.getByText("Qloo returned no cultural tag for this brand.")).toBeVisible();
  await expect(page.getByText(/Every returned tag described store or venue listings/u)).toBeVisible();
  await page.screenshot({ path: `${shots}desktop-insufficient.png`, fullPage: true });
});

test("SYNTHETIC partial provider response is labelled partial", async ({ page }) => {
  await routeBaseline(page, v2.results.partialProvider);
  await startScan(page);
  await expect(page.getByText("Research complete, with gaps")).toBeVisible();
  await page.getByRole("button", { name: /Architecture Partial evidence/u }).click();
  await expect(page.getByText(/marked the source response partial or degraded/u)).toBeVisible();
  await expect(page.getByText(/degraded response/u)).toBeVisible();
});

test("SYNTHETIC mobile viewport keeps the research readable without horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await routeBaseline(page, v2.results.hypotheses);
  await startScan(page);
  await page.getByRole("button", { name: /Couture One Qloo observation/u }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${shots}mobile-hypotheses.png`, fullPage: true });
});

test("SYNTHETIC paused admission hides the brand research entry point", async ({ page }) => {
  await routeBaseline(page, v2.results.hypotheses, false);
  await page.goto("/");
  await expect(page.getByLabel("Brand name")).toHaveCount(0);
});
