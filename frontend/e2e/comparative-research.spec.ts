/**
 * Sprint 9I comparative research journey in the browser.
 * Every live response below is SYNTHETIC: it was recorded from the real backend routes over the synthetic agent
 * world (backend/scripts/synthetic/build-comparative-e2e.ts). The recorded Loewe demonstration is real stored
 * Qloo evidence re-read offline. No test here reaches Qloo or a model.
 */
import { readFileSync } from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";

type Fixture = {
  baseline: { scanId: string; scanStatus: string };
  parent: { created: { jobId: string }; view: unknown };
  options: { admission: { accepting: boolean } };
  ids: string[];
  espresso: string;
  preview: unknown;
  incompatible: unknown;
  compare: { created: { jobId: string }; view: unknown };
  report: unknown;
};
const fixture = JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/synthetic/comparative-e2e.json", import.meta.url), "utf8")) as Fixture;
const INTERNAL = /urn:|mcp-|correlation|entity_tags|QUERY_SCOPED|ce-brand-baseline|ADMISSIONS_PAUSED|undefined|\[object/u;

const json = (route: Route, value: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });

async function stubSession(page: Page, options: { accepting?: boolean } = {}) {
  const calls = { compareJobs: 0, compareBodies: [] as unknown[], compareHeaders: [] as Record<string, string>[] };
  await page.route("**/api/agent/admissions", (route) => json(route, { status: "accepting" }));
  await page.route("**/api/brands/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/brands/status") return json(route, { enabled: true, semantics: "baseline_admission_only" });
    if (path === "/api/brands/resolve") return json(route, { resolutionId: "00000000-0000-4000-8000-000000000030", accessToken: "syn-token", status: "RESOLVED", entity: { qlooId: "SYN-BR-3001", label: "Larkspur Velo" } });
    if (path === "/api/brands/baselines" && route.request().method() === "POST") return json(route, { scanId: fixture.baseline.scanId, scanStatus: "QUEUED", reused: false, cached: false }, 202);
    if (path === `/api/brands/baselines/${fixture.baseline.scanId}`) return json(route, { scanStatus: fixture.baseline.scanStatus, providerCallCount: 2, stages: [{ stage: "tags", status: "COMPLETE" }], result: fixture.baseline });
    return json(route, { error: "not_found" }, 404);
  });
  await page.route("**/api/research/handoff/preview", (route) => json(route, {
    version: "ce-deep-investigation/0.2", objective: "SYNTHETIC: investigate Gravel Riding for Larkspur Velo", brand: { name: "Larkspur Velo", qlooId: "SYN-BR-3001" },
    territory: { id: "user:gravel riding", name: "Gravel Riding" }, limitations: ["SYNTHETIC: proposed by the user"], evidence: [],
  }));
  await page.route("**/api/research/handoff/jobs", (route) => json(route, fixture.parent.created, 202));
  await page.route("**/api/agent/jobs/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    if (id === fixture.parent.created.jobId) return json(route, fixture.parent.view);
    if (id === fixture.compare.created.jobId) return json(route, fixture.compare.view);
    return json(route, { error: "job_not_found" }, 404);
  });
  await page.route("**/api/research/compare/*", (route) => {
    const mode = new URL(route.request().url()).pathname.split("/").at(-1);
    const body = route.request().postDataJSON() as { referenceIds?: string[] };
    calls.compareBodies.push(body);
    calls.compareHeaders.push(route.request().headers());
    if (mode === "options") return json(route, { ...fixture.options, admission: { accepting: options.accepting !== false } });
    if (mode === "preview") {
      const value = (body.referenceIds ?? []).includes(fixture.espresso) ? fixture.incompatible : fixture.preview;
      return json(route, { ...(value as object), admission: { accepting: options.accepting !== false } });
    }
    calls.compareJobs += 1;
    return options.accepting === false ? json(route, { error: "admissions_paused" }, 503) : json(route, fixture.compare.created, 202);
  });
  await page.route("**/api/research/compare/report/*", (route) => json(route, fixture.report));
  return calls;
}

async function completeHypothesis(page: Page) {
  await page.goto("/");
  await page.getByLabel("Brand name").fill("Larkspur Velo");
  await page.getByRole("button", { name: "Find brand" }).click();
  await page.getByRole("button", { name: /Start research/u }).click();
  // The comparison journey runs in the classic section view, linked from the research network.
  await page.getByRole("button", { name: "Sections view" }).click();
  await page.getByRole("link", { name: /Directions/u }).click();
  const field = page.getByLabel("Have a specific cultural direction in mind?");
  await field.fill("Gravel Riding");
  await field.press("Enter");
  await page.getByRole("button", { name: "Start live investigation" }).click();
  await expect(page.getByTestId("comparative-research")).toBeVisible({ timeout: 20_000 });
}

test("SYNTHETIC comparative journey: hypothesis → server references → authorization → validated report → exported brief", async ({ page }) => {
  const calls = await stubSession(page);
  await completeHypothesis(page);
  const panel = page.getByTestId("comparative-research");
  await expect(panel).toContainText("Gravel Riding, represented by place exemplars");
  const touring = panel.getByRole("checkbox", { name: /Slow Touring/u });
  await expect(touring).toBeDisabled();
  await expect(panel).toContainText("Investigate this direction first");

  // Incompatible type: refused with an actionable reason, and no start is offered.
  await panel.getByRole("checkbox", { name: /Alpine Hiking/u }).check();
  await panel.getByRole("checkbox", { name: /Espresso/u }).check();
  await panel.getByRole("button", { name: "Check comparison" }).click();
  await expect(page.getByTestId("comparison-eligibility")).toHaveAttribute("data-eligible", "false");
  await expect(page.getByTestId("comparison-eligibility")).toContainText("qualitative cross-domain evidence");
  await expect(panel.getByRole("button", { name: "Start comparison" })).toHaveCount(0);

  // Keyboard selection of a compatible reference.
  await panel.getByRole("checkbox", { name: /Espresso/u }).uncheck();
  await panel.getByRole("checkbox", { name: /Mountain Town/u }).focus();
  await page.keyboard.press("Space");
  await expect(panel.getByRole("checkbox", { name: /Mountain Town/u })).toBeChecked();
  await panel.getByRole("button", { name: "Check comparison" }).click();
  await expect(page.getByTestId("comparison-eligibility")).toHaveAttribute("data-eligible", "true");
  const authorization = page.getByTestId("comparison-authorization");
  await expect(authorization).toContainText("up to 32 Qloo calls");
  await expect(authorization).toContainText("claude-haiku-5-5");
  const start = authorization.getByRole("button", { name: "Start comparison" });
  await expect(start).toBeDisabled();
  expect(calls.compareJobs).toBe(0);
  await authorization.getByLabel(/I authorize these paid provider calls/u).check();
  await start.click();

  const report = page.getByTestId("comparative-report");
  await expect(report).toBeVisible({ timeout: 20_000 });
  expect(calls.compareJobs).toBe(1);
  await expect(report).toHaveAttribute("data-outcome", "RELATIVE_POSITION_ESTABLISHED");
  await expect(report).toContainText("SYNTHETIC evidence (test world, not Qloo)");
  await expect(report.getByRole("row", { name: /Gravel Riding \(proposed\)/u })).toContainText("3 of 3");
  await expect(report.getByRole("row", { name: /Gravel Riding \(proposed\)/u })).toContainText("CULTURAL_BREAK");
  await expect(report.getByRole("row", { name: /Mountain Town/u })).toContainText("NATURAL_ADJACENCY");
  await expect(page.getByTestId("cultural-connections").first()).toContainText("Observed by Qloo");

  // The browser only ever sent identifiers: no evidence, type, score or budget field.
  for (const body of calls.compareBodies) expect(Object.keys(body as object).sort()).toEqual(expect.arrayContaining(["parentJobId", "scanId"]));
  expect(calls.compareBodies.every((body) => !/entityType|typeEvidence|relativePosition|maxQlooCalls|correlationIds/u.test(JSON.stringify(body)))).toBe(true);
  expect(calls.compareHeaders.every((headers) => headers["x-baseline-token"] === "syn-token" && Boolean(headers["x-job-token"]))).toBe(true);
  expect(page.url()).not.toContain("syn-token");

  await page.getByRole("button", { name: "Review and export the research brief" }).click();
  const summary = page.getByTestId("research-summary");
  await expect(summary).toContainText("Comparative Cultural Elasticity Assessment");
  await expect(summary).toContainText("Gravel Riding (proposed): position 3 of 3 (0th percentile). Classification: CULTURAL_BREAK.");
  await expect(summary).toContainText("SYNTHETIC test world, not Qloo");
  await expect(summary).toContainText("Cultural Relationships Across Domains");
  const download = page.waitForEvent("download");
  await summary.getByRole("button", { name: "Download brief (HTML)" }).click();
  const html = readFileSync(await (await download).path(), "utf8");
  expect(html).toContain("Gravel Riding (proposed): position 3 of 3 (0th percentile). Classification: CULTURAL_BREAK.");
  expect(html).toContain("Mountain Town: position 1 of 3 (100th percentile). Classification: NATURAL_ADJACENCY.");
  expect(html).toContain("SYNTHETIC test world, not Qloo");
});

test("SYNTHETIC paused admission: eligibility can be checked, but no paid comparison control is enabled", async ({ page }) => {
  const calls = await stubSession(page, { accepting: false });
  await completeHypothesis(page);
  const panel = page.getByTestId("comparative-research");
  await panel.getByRole("checkbox", { name: /Alpine Hiking/u }).check();
  await panel.getByRole("checkbox", { name: /Mountain Town/u }).check();
  await panel.getByRole("button", { name: "Check comparison" }).click();
  await expect(page.getByTestId("comparison-eligibility")).toHaveAttribute("data-eligible", "true");
  await expect(page.getByTestId("comparison-paused")).toContainText("Live comparisons are paused");
  await expect(page.getByRole("button", { name: "Start comparison" })).toHaveCount(0);
  expect(calls.compareJobs).toBe(0);
});

test("recorded Loewe comparative demonstration stops honestly at the evidence boundary, on desktop and mobile", async ({ page }) => {
  const paid: string[] = [];
  page.on("request", (request) => { if (/\/api\/(agent\/jobs|research\/compare|research\/handoff|brands\/(resolve|baselines))/u.test(new URL(request.url()).pathname)) paid.push(request.url()); });
  await page.route("**/api/agent/admissions", (route) => json(route, { status: "paused" }));
  await page.route("**/api/brands/status", (route) => json(route, { enabled: false, semantics: "baseline_admission_only" }));
  await page.goto("/?research=loewe&view=directions");
  const demo = page.getByTestId("recorded-comparative-demo");
  await expect(demo).toBeVisible();
  await expect(demo.getByRole("note").first()).toContainText("Nothing on this page starts a new search.");
  await expect(demo).toContainText("Boutique hospitality");
  await expect(demo).toContainText("Hotel Ritta Höppner");
  await expect(demo.getByTestId("recorded-reference")).toHaveCount(2);
  await expect(page.getByTestId("recorded-eligibility")).toContainText("Not eligible.");
  await expect(page.getByTestId("recorded-comparison-not-run")).toContainText("No comparison was run.");
  const connections = demo.getByTestId("cultural-connections");
  await expect(connections).toContainText("Observed by Qloo");
  await expect(connections).toContainText("Agent interpretation");
  // The cross-domain chain from the recorded investigation: brand → Qloo tag → member hotels, and brand-conditioned places.
  await expect(connections).toContainText("Boutique Hospitality → Casa Art Hotel");
  await expect(connections).toContainText("Loewe → J.K. Place Capri");
  await expect(connections).toContainText("No cultural tag is shared by the Loewe profile and the Boutique hospitality exemplar profiles");
  await expect(demo.locator("input:not([disabled]), button:not([disabled])")).toHaveCount(0);
  await expect(demo).not.toContainText(/position \d of \d|NATURAL_ADJACENCY|CREDIBLE_STRETCH|CULTURAL_BREAK/u);
  const text = await demo.evaluate((node) => { const clone = node.cloneNode(true) as HTMLElement; clone.querySelectorAll("details").forEach((d) => d.remove()); return clone.innerText; });
  expect(text).not.toMatch(INTERNAL);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(demo).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  expect(paid).toEqual([]);
});
