/**
 * Brand-first research workspace. The recorded Loewe research is real stored Qloo evidence re-read offline;
 * every live state below is a SYNTHETIC route stub. No test here reaches Qloo or a model.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const legacy = JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/synthetic/brand-baseline-e2e.json", import.meta.url), "utf8")) as { result: { scanId: string } };
const v2 = JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/synthetic/brand-baseline-e2e-v2.json", import.meta.url), "utf8")) as { results: Record<"hypotheses" | "zeroTerritory" | "insufficient" | "partialProvider", { scanId: string; scanStatus: string }> };
const shots = fileURLToPath(new URL("../../docs/sprint-9f/screenshots/", import.meta.url));
mkdirSync(shots, { recursive: true });
/** Never allowed in the ordinary research view (methodology and source disclosures are removed first). */
const INTERNAL = /urn:|mcp-|correlation|entity_tags|QUERY_SCOPED|OBSERVED_ASSOCIATION|PARTIAL_EVIDENCE|ce-brand-baseline|ADMISSIONS_PAUSED|BRAND_CLASSIFICATION|AUDIENCE_TASTE|undefined|null|\[object/u;
const PAID = /\/api\/brands\/(resolve|baselines)|\/api\/agent\/jobs/u;

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

const mainText = (page: Page) => page.locator("#atlas-main").evaluate((node) => {
  const clone = node.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("details").forEach((details) => details.remove());
  return clone.innerText;
});
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** These tests cover the classic section view; research opens in the network, which links to it. */
async function toSections(page: Page) {
  await page.getByRole("button", { name: "Sections view" }).click();
  await expect(page.getByTestId("fingerprint")).toBeVisible();
}

async function openLoewe(page: Page) {
  await page.goto("/");
  await page.getByTestId("open-recorded-baseline").click();
  await expect(page.getByRole("heading", { level: 1, name: "Loewe" })).toBeVisible();
  await toSections(page);
}

test("paused research: the product explains itself, offers recorded research and enables no paid action", async ({ page }) => {
  const { paid } = await stub(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Explore a brand's cultural connections." })).toBeVisible();
  await expect(page.getByTestId("research-availability")).toContainText("New research is temporarily unavailable.");
  await expect(page.getByRole("button", { name: "Find brand" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Start research/u })).toHaveCount(0);
  await page.getByLabel("Brand name").fill("loéwe");
  await page.getByRole("button", { name: "Find recorded research" }).click();
  await expect(page.getByText("Recorded research for Loewe is available.")).toBeVisible();
  await page.getByLabel("Brand name").fill("Northwind");
  await page.getByRole("button", { name: "Find recorded research" }).click();
  await expect(page.getByText(/There is no recorded research for “Northwind”/u)).toBeVisible();
  expect(await mainText(page)).not.toMatch(INTERNAL);
  expect(paid).toEqual([]);
});

test("recorded journey: fingerprint, connection evidence, direction limits, summary, without a paid call", async ({ page }) => {
  const { paid } = await stub(page);
  await openLoewe(page);
  await expect(page.getByRole("note")).toContainText("Opening it did not start a new search.");
  await expect(page.getByTestId("fingerprint").getByRole("heading", { level: 2 }).first()).toHaveText("We found cultural connections and 2 possible directions to research further.");
  await expect(page.getByText(/Not verified\. Qloo returned no category tags for Loewe/u).first()).toBeVisible();
  expect(await mainText(page)).not.toMatch(INTERNAL);

  await page.getByRole("button", { name: "Hôtel de Crillon, A Rosewood Hotel" }).click();
  const detail = page.getByTestId("evidence-detail");
  for (const heading of ["What was observed", "What this might mean", "What we cannot conclude", "What to investigate next"]) await expect(detail.getByRole("heading", { name: heading })).toBeVisible();
  await expect(detail).toContainText("position 5 of 10 when asked for places related to Loewe");
  await expect(detail).toContainText("Qloo did not confirm its type individually");
  await expect(detail.getByText(/mcp-/u)).toBeHidden();
  await detail.getByText("Source and method").click();
  await expect(detail.getByText(/mcp-/u).first()).toBeVisible();

  await page.goBack();
  await expect(page.getByTestId("fingerprint")).toBeVisible();

  await page.getByRole("link", { name: "Directions (2)" }).click();
  await expect(page.getByRole("heading", { name: "Model", level: 3 })).toBeVisible();
  await expect(page.getByText(/not a validated finding or a recommendation/u).first()).toBeVisible();
  await page.getByRole("button", { name: "Inspect the evidence for Model" }).click();
  await expect(detail.getByRole("heading", { name: "What we cannot conclude" })).toBeVisible();
  await expect(detail).toContainText("One Qloo tag observation. Not corroborated by an independent call.");
  await expect(detail).toContainText("current cultural position is not verified");
  expect(await mainText(page)).not.toMatch(/strong opportunity|high potential|excellent fit/iu);

  await page.getByRole("link", { name: "Summary" }).click();
  const summary = page.getByTestId("research-summary");
  await expect(summary.getByRole("heading", { name: "Loewe: strategic research brief" })).toBeVisible();
  await expect(summary).toContainText("Recorded Qloo research. It was captured earlier and is not a new live run.");
  await expect(summary).toContainText("Model: unvalidated baseline hypothesis. Observed association");
  await expect(summary).toContainText("Hôtel de Crillon, A Rosewood Hotel");
  const download = page.waitForEvent("download");
  await summary.getByRole("button", { name: "Download brief (HTML)" }).click();
  expect((await download).suggestedFilename()).toBe("loewe-strategic-research-brief.html");
  expect(Number(await summary.getAttribute("data-generation-ms"))).toBeLessThan(50);
  expect(paid).toEqual([]);
});

test("keyboard only: tabs, arrow keys through connections, Enter to inspect, focus returns", async ({ page }) => {
  await stub(page);
  await page.goto("/?research=loewe&layout=tabs");
  await page.getByRole("link", { name: /Connections/u }).focus();
  await page.keyboard.press("Enter");
  const first = page.locator("[data-row]").first();
  await first.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("[data-row]").nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: "BLACKPINK" })).toBeFocused();
  await page.goBack();
  await expect(page.locator('[data-row]').nth(1)).toBeFocused();
  const outline = await page.locator("[data-row]").nth(1).evaluate((node) => getComputedStyle(node).outlineStyle);
  expect(outline).not.toBe("none");
});

test("back and forward move through research views predictably", async ({ page }) => {
  await stub(page);
  await openLoewe(page);
  await page.getByRole("link", { name: /Directions/u }).click();
  await page.getByRole("link", { name: "Summary" }).click();
  await expect(page).toHaveURL(/view=summary/u);
  await page.goBack();
  await expect(page).toHaveURL(/view=directions/u);
  await page.goBack();
  await expect(page.getByTestId("fingerprint")).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("brand-discovery")).toBeVisible();
  await page.goForward();
  await expect(page.getByTestId("fingerprint")).toBeVisible();
});

test("Living Atlas stays available and opens the recorded Jacquemus investigation locally", async ({ page }) => {
  const { paid } = await stub(page);
  await page.goto("/");
  await page.getByTestId("recorded-investigation").click();
  await expect(page.getByRole("note").filter({ hasText: "Recorded example" })).toBeVisible();
  await expect(page.getByTestId("atlas-canvas")).toBeVisible();
  await page.screenshot({ path: `${shots}desktop-1440-atlas-jacquemus.png` });
  await page.getByRole("navigation", { name: "Research navigation" }).getByRole("link", { name: "Back to brand research" }).click();
  await expect(page.getByTestId("brand-discovery")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "See where a brand can stretch." })).toBeVisible();
  expect(paid).toEqual([]);
});

test("recorded baseline cannot claim a live handoff without an authorized scan", async ({ page }) => {
  await stub(page, { agent: "paused" });
  await page.goto("/?research=loewe&view=directions");
  await expect(page.getByTestId("deep-research-unavailable")).toBeVisible();
  await expect(page.getByRole("button", { name: /Prepare investigation/u })).toHaveCount(0);
  await page.unrouteAll();
  await stub(page, { agent: "accepting" });
  await page.reload();
  await expect(page.getByRole("button", { name: /Prepare investigation/u })).toHaveCount(0);
  await expect(page.getByTestId("deep-research-unavailable")).toBeVisible();
});

test("SYNTHETIC live scan previews a server handoff before any paid job", async ({ page }) => {
  const { paid } = await stub(page, { brands: "available", agent: "accepting", result: v2.results.hypotheses });
  const territory = v2.results.hypotheses.territories[0]!;
  await page.route("**/api/research/handoff/preview", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    version: "ce-deep-investigation/0.1", objective: "SYNTHETIC research question", brand: { name: "SYNTHETIC House", qlooId: "syn-brand-21" },
    territory: { id: territory.id, name: territory.name }, limitations: ["SYNTHETIC evidence is unvalidated"], evidence: [{ correlationId: "syn-source", operation: "entity_tags" }],
  }) }));
  await page.goto("/");
  await page.getByLabel("Brand name").fill("SYNTHETIC House");
  await page.getByRole("button", { name: "Find brand" }).click();
  await page.getByRole("button", { name: /Start research/u }).click();
  await toSections(page);
  await page.getByRole("link", { name: /Directions/u }).click();
  await page.getByRole("button", { name: `Prepare investigation of ${territory.name}` }).click();
  await expect(page.getByTestId("deep-investigation")).toContainText("SYNTHETIC research question");
  await expect(page.getByRole("button", { name: "Start live investigation" })).toBeVisible();
  expect(paid.filter((entry) => entry.includes("/api/agent/jobs"))).toEqual([]);
});

test("SYNTHETIC user direction previews a single question on desktop and mobile without starting a job", async ({ page }) => {
  const { paid } = await stub(page, { brands: "available", agent: "accepting", result: v2.results.hypotheses });
  const requested: unknown[] = [];
  await page.route("**/api/research/handoff/preview", (route) => {
    requested.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      version: "ce-deep-investigation/0.2", objective: "SYNTHETIC: investigate a user-proposed direction", brand: { name: "SYNTHETIC House", qlooId: "syn-brand-21" },
      territory: { id: "user:ritual hospitality", name: "Ritual hospitality" }, limitations: ["SYNTHETIC: no prior direction evidence"], evidence: [],
    }) });
  });
  await page.goto("/");
  await page.getByLabel("Brand name").fill("SYNTHETIC House");
  await page.getByRole("button", { name: "Find brand" }).click();
  await page.getByRole("button", { name: /Start research/u }).click();
  await toSections(page);
  await page.getByRole("link", { name: /Directions/u }).click();
  const field = page.getByLabel("Have a specific cultural direction in mind?");
  await field.fill("Ritual hospitality");
  await field.press("Enter");
  await expect(page.getByTestId("deep-investigation")).toContainText("SYNTHETIC: investigate a user-proposed direction");
  await expect(page.getByTestId("deep-investigation")).toContainText("no supporting Qloo evidence yet");
  expect(requested.length).toBeGreaterThan(0);
  expect(requested.every((entry) => (entry as { proposedDirection?: string }).proposedDirection === "Ritual hospitality")).toBe(true);
  expect(paid.filter((entry) => entry.includes("/api/agent/jobs"))).toEqual([]);
  const dir = fileURLToPath(new URL("../../docs/sprint-9f/screenshots/", import.meta.url));
  mkdirSync(dir, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: `${dir}/desktop-proposed-direction.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Start live investigation" })).toBeVisible();
  await page.screenshot({ path: `${dir}/mobile-proposed-direction.png`, fullPage: true });
});

test("SYNTHETIC live research: ambiguity, confirmation, progress, then a fingerprint; the token never enters the URL", async ({ page }) => {
  const { resolves } = await stub(page, { brands: "available", ambiguous: true, result: v2.results.hypotheses });
  await page.goto("/");
  await expect(page.getByTestId("research-availability")).toContainText("New brand research available.");
  await page.getByLabel("Brand name").fill("Northwind Atelier");
  await page.getByRole("button", { name: "Find brand" }).click();
  await expect(page.getByText("Qloo found more than one brand with this name.")).toBeVisible();
  await page.getByRole("button", { name: /Northwind Atelier · brand · ID syn-brand-21/u }).click();
  await page.getByRole("button", { name: "Start research on SYNTHETIC House" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "SYNTHETIC House" })).toBeVisible();
  await toSections(page);
  // The badge follows the result's own canonical origin field (this SYNTHETIC fixture says "recorded"), never the route taken.
  await expect(page.getByRole("note")).toContainText("Recorded Qloo research, captured earlier.");
  expect(page.url()).not.toContain("syn-token");
  expect(page.url()).toContain("research=session");
  expect(resolves()).toBe(2);
  expect(await mainText(page)).not.toMatch(INTERNAL);
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
  await page.getByLabel("Brand name").fill("First Brand");
  await page.getByRole("button", { name: "Find brand" }).click();
  await page.getByLabel("Brand name").fill("Second Brand");
  await page.getByRole("button", { name: "Find brand" }).click();
  await expect(page.getByRole("button", { name: "Start research on Second Brand" })).toBeVisible();
  releaseFirst?.();
  await expect(page.getByRole("button", { name: "Start research on Second Brand" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start research on First Brand" })).toHaveCount(0);
});

test("SYNTHETIC failed preview stops loading and never enables a paid start", async ({ page }) => {
  const { paid } = await stub(page, { brands: "available", agent: "accepting", result: v2.results.hypotheses });
  await page.route("**/api/research/handoff/preview", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "baseline_unavailable" }) }));
  await page.goto("/");
  await page.getByLabel("Brand name").fill("SYNTHETIC House");
  await page.getByRole("button", { name: "Find brand" }).click();
  await page.getByRole("button", { name: /Start research/u }).click();
  await toSections(page);
  await page.getByRole("link", { name: /Directions/u }).click();
  await page.getByRole("button", { name: /Prepare investigation of/u }).first().click();
  await expect(page.getByTestId("deep-investigation").getByRole("alert")).toContainText("This direction cannot be prepared");
  await expect(page.getByText("Checking the selected research direction…")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start live investigation" })).toHaveCount(0);
  expect(paid.filter((entry) => entry.includes("/api/agent/jobs"))).toEqual([]);
});

test("SYNTHETIC uncertain job start cannot be repeated from the same preview", async ({ page }) => {
  await stub(page, { brands: "available", agent: "accepting", result: v2.results.hypotheses });
  const territory = v2.results.hypotheses.territories[0]!;
  await page.route("**/api/research/handoff/preview", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    version: "ce-deep-investigation/0.1", objective: "SYNTHETIC research question", brand: { name: "SYNTHETIC House", qlooId: "syn-brand-21" },
    territory: { id: territory.id, name: territory.name }, limitations: [], evidence: [],
  }) }));
  let starts = 0;
  await page.route("**/api/research/handoff/jobs", (route) => { starts += 1; return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "unknown_outcome" }) }); });
  await page.goto("/");
  await page.getByLabel("Brand name").fill("SYNTHETIC House");
  await page.getByRole("button", { name: "Find brand" }).click();
  await page.getByRole("button", { name: /Start research/u }).click();
  await toSections(page);
  await page.getByRole("link", { name: /Directions/u }).click();
  await page.getByRole("button", { name: /Prepare investigation of/u }).first().click();
  const start = page.getByRole("button", { name: "Start live investigation" });
  await start.click();
  await expect(page.getByTestId("deep-investigation").getByRole("alert")).toContainText("could not be confirmed");
  await expect(start).toBeDisabled();
  expect(starts).toBe(1);
});

test("SYNTHETIC zero-direction result stays useful and says why", async ({ page }) => {
  await stub(page, { brands: "available", result: v2.results.zeroTerritory });
  await page.goto("/");
  await page.getByLabel("Brand name").fill("SYNTHETIC House");
  await page.getByRole("button", { name: "Find brand" }).click();
  await page.getByRole("button", { name: /Start research/u }).click();
  await toSections(page);
  await expect(page.getByText("We found cultural connections, but not enough evidence for a new direction.")).toBeVisible();
  await expect(page.getByText(/These describe the brand itself, not new directions/u).first()).toBeVisible();
  await page.getByRole("link", { name: /Directions/u }).click();
  await expect(page.getByTestId("no-directions")).toContainText("the available evidence does not yet support a specific direction");
  await expect(page.getByRole("heading", { name: "Next research steps" })).toBeVisible();
  await page.screenshot({ path: `${shots}desktop-1440-synthetic-zero-directions.png`, fullPage: true });
});

test("SYNTHETIC insufficient evidence and partial responses are labelled honestly", async ({ page }) => {
  await stub(page, { brands: "available", result: v2.results.insufficient });
  await page.goto("/");
  await page.getByLabel("Brand name").fill("SYNTHETIC House");
  await page.getByRole("button", { name: "Find brand" }).click();
  await page.getByRole("button", { name: /Start research/u }).click();
  await toSections(page);
  await expect(page.getByText("Qloo didn't return enough cultural evidence for a profile.")).toBeVisible();
  await expect(page.getByRole("note")).toContainText("Not enough evidence for a profile.");
  await page.unrouteAll();
  await stub(page, { brands: "available", result: v2.results.partialProvider });
  await page.reload();
  await page.getByRole("link", { name: /Directions/u }).click();
  await expect(page.getByText("Unresolved direction").first()).toBeVisible();
  await expect(page.getByText(/response behind it was incomplete/u).first()).toBeVisible();
});

test("SYNTHETIC legacy 0.1 research renders as stored, marked as an earlier method", async ({ page }) => {
  await stub(page, { brands: "available", result: { ...legacy.result, scanStatus: "COMPLETE" } });
  await page.goto("/");
  await page.getByLabel("Brand name").fill("SYNTHETIC House");
  await page.getByRole("button", { name: "Find brand" }).click();
  await page.getByRole("button", { name: /Start research/u }).click();
  await toSections(page);
  await expect(page.getByRole("note")).toContainText("Recorded with an earlier method and shown as stored.");
  await page.getByRole("link", { name: /Directions/u }).click();
  await expect(page.getByText(/Why it appeared was not recorded/u).first()).toBeVisible();
});

test("backend outage is shown honestly and recorded research still opens", async ({ page }) => {
  await stub(page, { brands: "unavailable" });
  await page.goto("/");
  await expect(page.getByTestId("research-availability")).toContainText("The research service can't be reached right now.");
  await page.getByTestId("recorded-loewe").click();
  await expect(page.getByRole("heading", { level: 1, name: "Loewe" })).toBeVisible();
});

test("a session scan from another tab is not reconstructed", async ({ page }) => {
  await stub(page, { brands: "available", result: v2.results.hypotheses });
  await page.goto("/?research=session");
  await expect(page.getByRole("heading", { name: "This research isn't available in this tab" })).toBeVisible();
});

test("reduced motion: the journey works with no running animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await stub(page);
  await openLoewe(page);
  await page.getByRole("link", { name: /Connections/u }).click();
  await page.getByRole("button", { name: "Red Velvet" }).click();
  await expect(page.getByTestId("evidence-detail")).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === "running").length)).toBe(0);
});

test("provider secrets never reach the research pages", async ({ page }) => {
  const bodies: string[] = [];
  page.on("response", async (response) => {
    const type = response.headers()["content-type"] ?? "";
    if (/json|html|javascript/u.test(type)) bodies.push(await response.text().catch(() => ""));
  });
  await stub(page);
  await openLoewe(page);
  await page.getByRole("link", { name: "Summary" }).click();
  await expect(page.getByTestId("research-summary")).toBeVisible();
  const joined = bodies.join("\n");
  expect(joined).not.toContain(["SENTINEL", "QLOO", "NOT", "IN", "BROWSER"].join("_"));
  expect(joined).not.toContain(["SENTINEL", "MODEL", "NOT", "IN", "BROWSER"].join("_"));
});

for (const [width, height] of [[1440, 900], [1920, 1080], [768, 1024], [390, 844], [375, 812], [320, 700]] as const) {
  test(`viewport ${width}x${height}: no horizontal overflow, CTA above the fold, screenshots`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await stub(page);
    await page.goto("/");
    const cta = page.getByTestId("open-recorded-baseline");
    await expect(cta).toBeVisible();
    if (height >= 844) await expect(cta).toBeInViewport();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${shots}${width}x${height}-01-home.png`, fullPage: true });
    await cta.click();
    await expect(page.getByTestId("research-network")).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await toSections(page);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${shots}${width}x${height}-02-fingerprint.png`, fullPage: true });
    await page.getByRole("link", { name: /Connections/u }).click();
    await page.getByRole("button", { name: "Four Seasons Hotel George V, Paris" }).click();
    await expect(page.getByTestId("evidence-detail")).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${shots}${width}x${height}-03-connection.png`, fullPage: true });
    await page.getByRole("link", { name: /Directions/u }).click();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${shots}${width}x${height}-04-directions.png`, fullPage: true });
    await page.getByRole("link", { name: "Summary" }).click();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${shots}${width}x${height}-05-summary.png`, fullPage: true });
  });
}
