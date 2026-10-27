/**
 * Sprint 9J hosted audit. Real browser, real deployment, no route stubs. Only recorded evidence is opened; no
 * step may start paid research. Network logs keep method, path and status only (no headers, bodies or tokens).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test as base, type Page } from "@playwright/test";

const evidence = fileURLToPath(new URL("../../docs/sprint-9j/evidence/hosted-playwright/", import.meta.url));
const shots = fileURLToPath(new URL("../../docs/sprint-9j/screenshots/hosted/", import.meta.url));
mkdirSync(evidence, { recursive: true });
mkdirSync(shots, { recursive: true });

const PAID = /^\/api\/(agent\/jobs|research\/(handoff|compare)\/jobs|brands\/(resolve|baselines)$)/u;
const PROVIDER_HOSTS = /qloo\.com|anthropic\.com|railway\.app/u;
const INTERNAL = /urn:|mcp-|correlation|entity_tags|QUERY_SCOPED|OBSERVED_ASSOCIATION|ADMISSIONS_PAUSED|undefined|\[object/u;
/** Optional: the real internal secret, read by the operator's shell from Railway. Checked for absence only. */
const FORBIDDEN = [process.env.E2E_FORBIDDEN_SECRET ?? "", "sk-ant-"].filter((value) => value.length > 0);

type Monitor = { failed: string[]; errors: string[]; pageErrors: string[]; consoleErrors: string[]; paidPosts: string[]; providerHosts: string[]; leaked: number; requests: number };

const test = base.extend<{ monitor: Monitor }>({
  monitor: async ({ page }, use, info) => {
    const m: Monitor = { failed: [], errors: [], pageErrors: [], consoleErrors: [], paidPosts: [], providerHosts: [], leaked: 0, requests: 0 };
    const own = new URL(info.project.use.baseURL!).host;
    page.on("request", (request) => {
      m.requests += 1;
      const url = new URL(request.url());
      if (url.host !== own && PROVIDER_HOSTS.test(url.host)) m.providerHosts.push(url.host);
      if (url.host === own && request.method() === "POST" && PAID.test(url.pathname)) m.paidPosts.push(url.pathname);
    });
    page.on("requestfailed", (request) => m.failed.push(`${request.method()} ${new URL(request.url()).pathname} ${request.failure()?.errorText ?? ""}`));
    page.on("response", async (response) => {
      const url = new URL(response.url());
      if (response.status() >= 400) m.errors.push(`${response.request().method()} ${url.pathname} ${response.status()}`);
      if (Object.keys(response.headers()).some((name) => /^x-ce-|^authorization$/iu.test(name))) m.leaked += 1;
      const type = response.headers()["content-type"] ?? "";
      if (url.host === own && /json|html|javascript/u.test(type)) {
        const body = await response.text().catch(() => "");
        if (FORBIDDEN.some((secret) => body.includes(secret))) m.leaked += 1;
      }
    });
    page.on("pageerror", (error) => m.pageErrors.push(error.message.slice(0, 300)));
    page.on("console", (message) => { if (message.type() === "error") m.consoleErrors.push(message.text().slice(0, 300)); });
    await use(m);
    const slug = `${info.project.name}--${info.title.replace(/[^a-z0-9]+/giu, "-").toLowerCase()}`.slice(0, 120);
    writeFileSync(`${evidence}${slug}.json`, `${JSON.stringify({ project: info.project.name, test: info.title, status: info.status, ...m }, null, 2)}\n`);
    expect(m.leaked, "no internal header or secret reaches the browser").toBe(0);
    expect(m.providerHosts, "the browser never calls Qloo, Anthropic or Railway directly").toEqual([]);
    expect(m.paidPosts, "no paid start was sent").toEqual([]);
    expect(m.pageErrors, "no uncaught page error").toEqual([]);
  },
});

const shot = (page: Page, name: string) => page.screenshot({ path: `${shots}${test.info().project.name}-${name}.png`, fullPage: true });
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const visibleText = (page: Page, selector: string) => page.locator(selector).first().evaluate((node) => {
  const clone = node.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("details").forEach((details) => details.remove());
  return clone.innerText;
});
const branch = (page: Page, name: RegExp) => page.getByTestId("atlas-canvas").getByRole("button", { name });

test("A. home: real service state, recorded research reachable, no enabled paid action", async ({ page, monitor }) => {
  const admissions = page.waitForResponse((response) => response.url().endsWith("/api/agent/admissions"));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Explore a brand's cultural connections." })).toBeVisible();
  const real = await (await admissions).json();
  // VERCEL_RAILWAY_CONNECTED: the deployed server reaches Railway and reports its real paused admission.
  expect(real).toEqual({ status: "paused" });
  await expect(page.getByTestId("research-availability")).toContainText("New research is temporarily unavailable.");
  await expect(page.getByRole("button", { name: "Find brand" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Start research/u })).toHaveCount(0);
  await expect(page.getByTestId("open-recorded-baseline")).toBeVisible();
  await expect(page.getByTestId("recorded-investigation")).toBeVisible();
  await page.getByLabel("Brand name").fill("loéwe");
  await page.getByRole("button", { name: "Find recorded research" }).click();
  await expect(page.getByText("Recorded research for Loewe is available.")).toBeVisible();
  await page.getByLabel("Brand name").fill("Northwind");
  await page.getByRole("button", { name: "Find recorded research" }).click();
  await expect(page.getByText(/There is no recorded research for “Northwind”/u)).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await shot(page, "01-home");
  expect(monitor.errors.filter((e) => / 5\d\d$/u.test(e))).toEqual([]);
});

test("B. recorded Loewe: fingerprint, evidence with provenance, directions, summary, exported brief", async ({ page, monitor }) => {
  await page.goto("/");
  await page.getByTestId("open-recorded-baseline").click();
  await expect(page.getByRole("heading", { level: 1, name: "Loewe" })).toBeVisible();
  await expect(page.getByRole("note").first()).toContainText("Opening it did not start a new search.");
  const fingerprint = page.getByTestId("fingerprint");
  await expect(fingerprint.getByRole("heading", { level: 2 }).first()).toHaveText("We found cultural connections and 2 possible directions to research further.");
  expect(await visibleText(page, "#atlas-main")).not.toMatch(INTERNAL);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await shot(page, "02-fingerprint");

  await page.getByRole("link", { name: /Connections/u }).click();
  await page.getByRole("button", { name: "Hôtel de Crillon, A Rosewood Hotel" }).click();
  const detail = page.getByTestId("evidence-detail");
  for (const heading of ["What was observed", "What this might mean", "What we cannot conclude", "What to investigate next"]) await expect(detail.getByRole("heading", { name: heading })).toBeVisible();
  await expect(detail).toContainText("position 5 of 10 when asked for places related to Loewe");
  await expect(detail.getByText(/mcp-/u)).toBeHidden();
  await detail.getByText("Source and method").click();
  // Provenance: the recorded live call's correlation id is inspectable on request.
  await expect(detail.getByText(/mcp-[0-9a-f-]{36}/u).first()).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await shot(page, "03-connection-evidence");

  await page.getByRole("link", { name: "Directions (2)" }).click();
  await expect(page.getByRole("heading", { name: "Model", level: 3 })).toBeVisible();
  await expect(page.getByText(/not a validated finding or a recommendation/u).first()).toBeVisible();
  await page.getByRole("button", { name: "Inspect the evidence for Model" }).click();
  await expect(detail).toContainText("One Qloo tag observation. Not corroborated by an independent call.");

  // Unsupported comparison is refused transparently from real recorded evidence.
  const demo = page.getByTestId("recorded-comparative-demo");
  await expect(demo).toBeVisible();
  await expect(page.getByTestId("recorded-eligibility")).toContainText("Not eligible.");
  await expect(page.getByTestId("recorded-comparison-not-run")).toContainText("No comparison was run.");
  await expect(demo.locator("input:not([disabled]), button:not([disabled])")).toHaveCount(0);
  await expect(demo).not.toContainText(/position \d of \d|NATURAL_ADJACENCY|CREDIBLE_STRETCH|CULTURAL_BREAK/u);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await shot(page, "04-directions-and-refused-comparison");

  await page.getByRole("link", { name: "Summary" }).click();
  const summary = page.getByTestId("research-summary");
  await expect(summary.getByRole("heading", { name: "Loewe: strategic research brief" })).toBeVisible();
  await expect(summary).toContainText("Recorded Qloo research. It was captured earlier and is not a new live run.");
  await expect(summary).toContainText("Hôtel de Crillon, A Rosewood Hotel");
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await shot(page, "05-summary");
  const downloading = page.waitForEvent("download");
  await summary.getByRole("button", { name: "Download brief (HTML)" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("loewe-strategic-research-brief.html");
  const brief = readFileSync((await download.path())!, "utf8");
  // The export reflects what the page shows: the same brand, recorded-origin label and evidence items.
  expect(brief).toContain("Loewe");
  expect(brief).toContain("Recorded Qloo research");
  expect(brief).toContain("Hôtel de Crillon, A Rosewood Hotel");
  expect(brief).not.toMatch(/position \d of \d within|NATURAL_ADJACENCY|sk-ant-/u);
  if (test.info().project.name.startsWith("desktop")) writeFileSync(`${evidence}exported-loewe-brief.html`, brief);

  await page.reload();
  await expect(summary.getByRole("heading", { name: "Loewe: strategic research brief" })).toBeVisible();
  // Back returns to the previous view. On narrow screens that is the Model evidence sub-view; on desktop the list.
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Model" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Directions (2)" })).toHaveAttribute("aria-current", /page|true/u);
  expect(monitor.errors.filter((e) => / 5\d\d$/u.test(e))).toEqual([]);
});

test("C. Living Atlas: recorded Jacquemus graph, selection, dossier, read-only comparison, return", async ({ page, monitor }) => {
  await page.goto("/");
  await page.getByTestId("recorded-investigation").click();
  await expect(page.getByRole("note").filter({ hasText: "Recorded example" })).toBeVisible();
  await expect(page.getByTestId("atlas-canvas")).toBeVisible();
  const nodes = page.getByTestId("atlas-canvas").getByRole("button");
  expect(await nodes.count()).toBeGreaterThan(3);
  const desktop = test.info().project.name.startsWith("desktop");
  if (desktop) expect(await page.locator("[data-testid='atlas-edges'] path").count()).toBeGreaterThan(0);
  // Supported, partial and incomplete states are labelled, not hidden.
  await expect(branch(page, /Partial/u).first()).toBeVisible();
  await shot(page, "06-atlas");

  await branch(page, /Bohemian lifestyle/u).first().click();
  const finding = page.locator(".finding");
  await expect(finding.getByRole("heading", { name: "Bohemian lifestyle" })).toBeVisible();
  await expect(finding).toContainText("Isabel Marant");
  await page.getByTestId("evidence-open").click();
  const inspector = page.getByTestId("evidence-inspector");
  await expect(inspector).toBeVisible();
  await page.getByTestId("evidence-technical").locator("summary").click();
  await expect(inspector).toContainText("Canonical identifier");
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await shot(page, "07-atlas-dossier");
  await page.keyboard.press("Escape");

  // Narrow screens show a guided canvas (parent, selection, children, siblings): a nested territory is reached
  // through its parent, as a user would.
  const reach = async (name: RegExp) => {
    if (!(await branch(page, name).first().isVisible())) {
      await page.getByRole("navigation", { name: "Path through this investigation" }).getByRole("button", { name: "Jacquemus" }).click();
      if (!(await branch(page, name).first().isVisible())) await branch(page, /Art and culture/u).first().click();
    }
    await branch(page, name).first().click();
  };
  await reach(/design-led boutique hospitality/iu);
  await expect(finding.getByRole("heading", { name: /design-led boutique hospitality/iu })).toBeVisible();

  // Read-only comparison of two recorded territories: no ranking is invented.
  await reach(/Bohemian lifestyle/u);
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await reach(/design-led boutique hospitality/iu);
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await page.getByTestId("compare-existing").click();
  const comparison = page.getByTestId("read-only-comparison");
  await expect(comparison).toContainText("no numerical ranking");
  await shot(page, "08-atlas-read-only-comparison");

  await page.getByRole("navigation", { name: "Research navigation" }).getByRole("link", { name: "Back to brand research" }).click();
  await expect(page.getByTestId("brand-discovery")).toBeVisible();
  expect(monitor.errors.filter((e) => / 5\d\d$/u.test(e))).toEqual([]);
});

test("C2. Living Atlas keyboard selection and reduced motion", async ({ page, monitor }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?mode=atlas");
  await expect(page.getByTestId("atlas-app")).toHaveAttribute("data-admissions", "paused", { timeout: 30_000 });
  await expect(page.getByText("Live research temporarily unavailable.")).toBeVisible();
  await expect(page.getByTestId("query-submit")).toHaveCount(0);
  await page.getByTestId("recorded-open").click();
  const territory = branch(page, /Bohemian lifestyle/u).first();
  await expect(territory).toBeVisible();
  await expect(territory).toHaveAttribute("data-reduced", "true");
  await territory.focus();
  await page.keyboard.press("Enter");
  await expect(territory).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("follow-up-submit")).toBeDisabled();
  expect(monitor.errors.filter((e) => / 5\d\d$/u.test(e))).toEqual([]);
});

test("G2. direct requests to every paid route are refused on the public deployment", async ({ page, monitor }) => {
  await page.goto("/");
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    page.request.post(path, { data: body, headers: { "content-type": "application/json", ...headers }, failOnStatusCode: false });
  const results = {
    agentJob: (await post("/api/agent/jobs", { query: "Where could Loewe expand?" })).status(),
    brandResolve: (await post("/api/brands/resolve", { name: "Loewe" })).status(),
    brandBaseline: (await post("/api/brands/baselines", { resolutionId: "00000000-0000-4000-8000-000000000000", idempotencyKey: "00000000-0000-4000-8000-000000000001" }, { "x-baseline-token": "x" })).status(),
    handoffJob: (await post("/api/research/handoff/jobs", { scanId: "00000000-0000-4000-8000-000000000000", proposedDirection: "Boutique hospitality", idempotencyKey: "00000000-0000-4000-8000-000000000002" }, { "x-baseline-token": "x" })).status(),
    compareJob: (await post("/api/research/compare/jobs", { scanId: "00000000-0000-4000-8000-000000000000", parentJobId: "00000000-0000-4000-8000-000000000003", referenceIds: ["a", "b"], idempotencyKey: "00000000-0000-4000-8000-000000000004" }, { "x-baseline-token": "x", "x-job-token": "y" })).status(),
  };
  writeFileSync(`${evidence}${test.info().project.name}--direct-paid-route-statuses.json`, `${JSON.stringify(results, null, 2)}\n`);
  for (const status of Object.values(results)) expect(status).toBeGreaterThanOrEqual(400);
  // A browser cannot set the operator credential through a public header.
  expect((await post("/api/agent/jobs", { query: "x" }, { "x-ce-paid-operator": "A".repeat(40) })).status()).toBeGreaterThanOrEqual(400);
  expect(monitor.paidPosts).toEqual([]);
});
