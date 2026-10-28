/**
 * Brand search, research states and the network's header actions. Every response is a SYNTHETIC route stub
 * (backend/tests/fixtures/synthetic/). No test here reaches Qloo or a model.
 */
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const legacy = JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/synthetic/brand-baseline-e2e.json", import.meta.url), "utf8")) as { result: { scanId: string } };
const v2 = JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/synthetic/brand-baseline-e2e-v2.json", import.meta.url), "utf8")) as { results: Record<"hypotheses" | "zeroTerritory" | "insufficient" | "partialProvider", { scanId: string; scanStatus: string }> };
const comparative = JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/synthetic/comparative-e2e.json", import.meta.url), "utf8")) as { compare: { created: { jobId: string }; view: unknown } };
const PAID = /\/api\/brands\/(resolve|baselines)|\/api\/agent\/jobs|\/api\/research\/handoff/u;
const INTERNAL = /urn:|mcp-|correlation|entity_tags|QUERY_SCOPED|OBSERVED_ASSOCIATION|ce-brand-baseline|ADMISSIONS_PAUSED|undefined|\[object/u;

type Stub = { brands?: "available" | "paused" | "unavailable"; agent?: "accepting" | "paused"; result?: { scanId: string; scanStatus: string }; ambiguous?: boolean };

async function stub(page: Page, options: Stub = {}) {
  const paid: string[] = [];
  page.on("request", (request) => { if (PAID.test(new URL(request.url()).pathname)) paid.push(`${request.method()} ${new URL(request.url()).pathname}`); });
  await page.route("**/api/agent/admissions", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: options.agent ?? "paused" }) }));
  let resolves = 0;
  await page.route("**/api/brands/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const respond = (value: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    const brands = options.brands ?? "paused";
    if (path === "/api/brands/status") return brands === "unavailable" ? respond({ error: "baseline_unavailable" }, 503) : respond({ enabled: brands === "available", semantics: "baseline_admission_only" });
    if (brands !== "available") return respond({ error: "baseline_paused" }, 503);
    if (path === "/api/brands/resolve") {
      resolves += 1;
      if (options.ambiguous && resolves === 1) return respond({ resolutionId: "00000000-0000-4000-8000-000000000020", accessToken: "syn-token", status: "AMBIGUOUS", candidates: [{ qlooId: "syn-brand-21", label: "Northwind Atelier", type: "brand" }, { qlooId: "syn-brand-22", label: "Northwind Atelier Studio", type: "brand" }] });
      return respond({ resolutionId: "00000000-0000-4000-8000-000000000030", accessToken: "syn-token", status: "RESOLVED", entity: { qlooId: "syn-brand-21", label: "SYNTHETIC House" } });
    }
    const result = options.result!;
    if (path === "/api/brands/baselines" && route.request().method() === "POST") return respond({ scanId: result.scanId, scanStatus: "QUEUED", reused: false, cached: false }, 202);
    if (path === `/api/brands/baselines/${result.scanId}`) {
      if (route.request().headers()["x-baseline-token"] !== "syn-token") return respond({ error: "not_found" }, 404);
      return respond({ scanStatus: result.scanStatus, providerCallCount: 5, stages: [{ stage: "tags", status: "COMPLETE" }], result });
    }
    return respond({ error: "not_found" }, 404);
  });
  return { paid, resolves: () => resolves };
}

async function startResearch(page: Page) {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Brand name" }).fill("SYNTHETIC House");
  await page.getByRole("button", { name: "Find brand" }).click();
  await page.getByRole("button", { name: /Start research/u }).click();
  await expect(page.getByTestId("research-network")).toBeVisible();
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("paused research: the page explains itself and enables no paid action", async ({ page }) => {
  const { paid } = await stub(page);
  await page.goto("/");
  await expect(page.getByTestId("research-availability")).toBeVisible();
  await expect(page.getByRole("button", { name: "Find brand" })).toBeDisabled();
  await expect(page.getByText("Recorded research")).toHaveCount(0);
  expect(paid).toEqual([]);
});

test("SYNTHETIC live research: ambiguity, confirmation, then the network; the token never enters the URL", async ({ page }) => {
  const { resolves } = await stub(page, { brands: "available", ambiguous: true, result: v2.results.hypotheses });
  await page.goto("/");
  await expect(page.getByTestId("research-availability")).toContainText("New brand research available.");
  await page.getByRole("combobox", { name: "Brand name" }).fill("Northwind Atelier");
  await page.getByRole("button", { name: "Find brand" }).click();
  await expect(page.getByText("Qloo found more than one brand with this name.")).toBeVisible();
  await page.getByRole("button", { name: /Northwind Atelier · brand · ID syn-brand-21/u }).click();
  await page.getByRole("button", { name: "Start research on SYNTHETIC House" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "SYNTHETIC House" })).toBeVisible();
  expect(page.url()).not.toContain("syn-token");
  expect(page.url()).toContain("research=session");
  expect(resolves()).toBe(2);
  const text = await page.getByTestId("network-dossier").innerText();
  expect(text).not.toMatch(INTERNAL);
});

test("SYNTHETIC late brand lookup cannot replace a newer Qloo identity", async ({ page }) => {
  await stub(page, { brands: "available", result: v2.results.hypotheses });
  let releaseFirst: (() => void) | undefined;
  await page.route("**/api/brands/resolve", async (route) => {
    const name = (route.request().postDataJSON() as { name: string }).name;
    if (name === "First Brand") await new Promise<void>((resolve) => { releaseFirst = resolve; });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ resolutionId: "00000000-0000-4000-8000-000000000030", accessToken: "syn-token", status: "RESOLVED", entity: { qlooId: `syn-${name}`, label: name } }) });
  });
  await page.goto("/");
  const box = page.getByRole("combobox", { name: "Brand name" });
  await box.fill("First Brand");
  await page.getByRole("button", { name: "Find brand" }).click();
  await box.fill("Second Brand");
  await page.getByRole("button", { name: "Find brand" }).click();
  await expect(page.getByRole("button", { name: "Start research on Second Brand" })).toBeVisible();
  releaseFirst?.();
  await expect(page.getByRole("button", { name: "Start research on Second Brand" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start research on First Brand" })).toHaveCount(0);
});

test("SYNTHETIC zero-direction result still opens a useful network and says why", async ({ page }) => {
  await stub(page, { brands: "available", result: v2.results.zeroTerritory });
  await startResearch(page);
  await expect(page.getByTestId("network-node-direction")).toHaveCount(0);
  await expect(page.getByTestId("network-dossier")).toContainText("No direction had enough evidence");
});

test("SYNTHETIC insufficient and legacy results open as stored", async ({ page }) => {
  await stub(page, { brands: "available", result: v2.results.insufficient });
  await startResearch(page);
  await expect(page.getByTestId("network-dossier")).toContainText("Qloo didn't return enough cultural evidence");
  await page.unrouteAll();
  await stub(page, { brands: "available", result: { ...legacy.result, scanStatus: "COMPLETE" } });
  await page.getByTestId("network-home").click();
  await startResearch(page);
  await expect(page.getByTestId("network-node-brand")).toHaveCount(1);
});

test("backend outage is shown honestly", async ({ page }) => {
  await stub(page, { brands: "unavailable" });
  await page.goto("/");
  await expect(page.getByTestId("research-availability")).toContainText("The research service can't be reached right now.");
});

test("a session scan from another tab is not reconstructed, and an unknown research link says so", async ({ page }) => {
  await stub(page, { brands: "available", result: v2.results.hypotheses });
  await page.goto("/?research=session");
  await expect(page.getByRole("heading", { name: "This research isn't available in this tab" })).toBeVisible();
  await page.goto("/?research=loewe");
  await expect(page.getByRole("heading", { name: "This research link isn't available" })).toBeVisible();
});

test("SYNTHETIC Home and Save and go back leave the network, which reopens from the library", async ({ page }) => {
  await stub(page, { brands: "available", result: v2.results.hypotheses });
  await startResearch(page);
  await page.getByTestId("network-home").click();
  await expect(page.getByTestId("brand-discovery")).toBeVisible();
  await page.getByTestId("research-library").getByRole("button", { name: /SYNTHETIC House/u }).click();
  await expect(page.getByTestId("research-network")).toBeVisible();
  await page.getByTestId("network-save-back").click();
  await expect(page.getByTestId("brand-discovery")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sections view" })).toHaveCount(0);
});

test("SYNTHETIC the report downloads as HTML and PDF, stamped with the date and time", async ({ page }) => {
  await stub(page, { brands: "available", agent: "accepting", result: v2.results.hypotheses });
  await page.route("**/api/agent/jobs", (route) => route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify(comparative.compare.created) }));
  await page.route("**/api/agent/jobs/*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(comparative.compare.view) }));
  await startResearch(page);
  await page.getByLabel(/Ask a research question about/u).fill("Compare Gravel Riding with Alpine Hiking and Mountain Town");
  await page.getByRole("button", { name: "Ask the agent" }).click();
  await expect(page.getByTestId("network-node-inquiry")).toHaveCount(1);
  const report = page.getByTestId("network-report");
  const [html] = await Promise.all([page.waitForEvent("download"), report.getByRole("button", { name: "HTML" }).click()]);
  expect(html.suggestedFilename()).toMatch(/^synthetic-house-cultural-research_\d{4}-\d{2}-\d{2}_\d{4}\.html$/u);
  const body = readFileSync((await html.path())!, "utf8");
  expect(body).toMatch(/Generated .*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u);
  expect(body).toContain("Mountain Town");
  expect(body).toContain("Patterns you might overlook");
  expect(body).not.toMatch(/syn-token|<script/u);
  const [pdf] = await Promise.all([page.waitForEvent("download"), report.getByRole("button", { name: "PDF" }).click()]);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/u);
  expect(readFileSync((await pdf.path())!).subarray(0, 5).toString()).toBe("%PDF-");
});

test("provider secrets never reach the research pages", async ({ page }) => {
  const bodies: string[] = [];
  page.on("response", async (response) => {
    const type = response.headers()["content-type"] ?? "";
    if (/json|html|javascript/u.test(type)) bodies.push(await response.text().catch(() => ""));
  });
  await stub(page, { brands: "available", result: v2.results.hypotheses });
  await startResearch(page);
  const joined = bodies.join("\n");
  expect(joined).not.toContain(["SENTINEL", "QLOO", "NOT", "IN", "BROWSER"].join("_"));
  expect(joined).not.toContain(["SENTINEL", "MODEL", "NOT", "IN", "BROWSER"].join("_"));
});

for (const [width, height] of [[1440, 900], [1920, 1080], [768, 1024], [390, 844], [375, 812], [320, 700]] as const) {
  test(`viewport ${width}x${height}: no horizontal overflow on the search page or the network`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await stub(page, { brands: "available", result: v2.results.hypotheses });
    await page.goto("/");
    await expect(page.getByRole("combobox", { name: "Brand name" })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await startResearch(page);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
}
