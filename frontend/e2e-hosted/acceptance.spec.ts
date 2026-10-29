/**
 * Sprint 9L hosted acceptance. A real browser against the deployed Vercel frontend and Railway backend: no route
 * stub, no synthetic backend, no recorded research.
 *
 * - "anonymous" tests always run and start no paid work: the page renders, the visitor sees no enabled paid
 *   control, and an anonymous paid request is refused.
 * - The LIVE journey runs only with E2E_LIVE_AUTHORIZED=1 and the operator credential (E2E_OPERATOR_TOKEN, read
 *   from a mode-600 file by the caller). It resolves a real brand in Qloo, runs one baseline scan, investigates one
 *   direction with Haiku, saves, reopens and exports. It never retries a paid start.
 *   E2E_HOSTED_URL=… [E2E_LIVE_AUTHORIZED=1 E2E_OPERATOR_TOKEN=… E2E_BRAND=Zara] \
 *     pnpm --filter frontend exec playwright test -c playwright.hosted.config.ts acceptance --project desktop-1440x900
 * Evidence (ids, statuses, outcomes; never tokens) goes to E2E_EVIDENCE_DIR (default: test-results/hosted-evidence).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const OPERATOR = process.env.E2E_OPERATOR_TOKEN ?? "";
/** Sprint 9M: the deployment runs an approved public evaluation, so anonymous visitors may start research. */
const PUBLIC_EVALUATION = process.env.E2E_PUBLIC_EVALUATION === "1";
const BRAND = process.env.E2E_BRAND ?? "Zara";
/** Optional second question, e.g. a direction expected to be inelastic for the brand. One more paid start. */
const SECOND_QUESTION = process.env.E2E_SECOND_QUESTION ?? "";
/** E2E_SKIP_DIRECTION=1 asks only the composer question (one paid investigation instead of two). */
const SKIP_DIRECTION = process.env.E2E_SKIP_DIRECTION === "1" && SECOND_QUESTION !== "";
const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? "test-results/hosted-evidence";
const PAID = /^\/api\/(agent\/jobs|research\/(handoff|compare)\/jobs|brands\/(resolve|baselines))$/u;
mkdirSync(EVIDENCE, { recursive: true });

type Problems = { console: string[]; pageErrors: string[]; serverErrors: string[] };
function observe(page: Page): Problems {
  const problems: Problems = { console: [], pageErrors: [], serverErrors: [] };
  page.on("console", (message) => { if (message.type() === "error") problems.console.push(message.text().slice(0, 300)); });
  page.on("pageerror", (error) => problems.pageErrors.push(error.message.slice(0, 300)));
  page.on("response", (response) => { if (response.status() >= 500 && response.status() !== 503) problems.serverErrors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  return problems;
}
const redact = (text: string) => (OPERATOR ? text.split(OPERATOR).join("[operator]") : text);

test.describe("anonymous visitor", () => {
  test(PUBLIC_EVALUATION ? "home renders, brand search is offered to an anonymous visitor, and nothing paid is sent on load" : "home renders, brand search is not offered as available, and nothing paid is sent", async ({ page }) => {
    const problems = observe(page);
    const paid: string[] = [];
    page.on("request", (request) => { if (request.method() === "POST" && PAID.test(new URL(request.url()).pathname)) paid.push(request.url()); });
    await page.goto("/");
    const availability = page.getByTestId("research-availability");
    await expect(availability).not.toContainText("Checking", { timeout: 30_000 });
    if (PUBLIC_EVALUATION) {
      await expect(availability).toContainText("New brand research available.");
    } else {
      await expect(availability).not.toContainText("New brand research available.");
      await expect(page.getByRole("button", { name: "Find brand" })).toBeDisabled();
    }
    await page.screenshot({ path: join(EVIDENCE, `anonymous-home-${test.info().project.name}.png`), fullPage: true });
    expect(paid).toEqual([]);
    expect(problems.pageErrors).toEqual([]);
    expect(problems.serverErrors).toEqual([]);
  });

  test("DIAGNOSTIC (not a user journey): anonymous paid requests are refused before any provider call", async ({ request }) => {
    if (PUBLIC_EVALUATION) {
      // Admitted, then refused for the malformed body before any quota, model or Qloo call.
      expect((await request.post("/api/brands/resolve", { data: { name: "x" } })).status()).toBe(400);
      expect((await request.post("/api/agent/jobs", { data: {} })).status()).toBe(400);
      expect((await (await request.get("/api/brands/status")).json()).enabled).toBe(true);
      return;
    }
    const resolve = await request.post("/api/brands/resolve", { data: { name: "Release verification probe" } });
    expect([403, 503]).toContain(resolve.status());
    const job = await request.post("/api/agent/jobs", { data: { query: "probe" } });
    expect(job.status()).toBeGreaterThanOrEqual(400);
    expect(job.status()).not.toBe(500);
    const status = await (await request.get("/api/brands/status")).json();
    expect(status.enabled).toBe(false);
  });
});

test.describe("LIVE authorized journey", () => {
  test.skip(process.env.E2E_LIVE_AUTHORIZED !== "1" || (OPERATOR.length < 32 && !PUBLIC_EVALUATION), "Live run not authorized for this invocation.");

  test(`LIVE: ${BRAND} → baseline → network → Haiku investigation → save → reopen → PDF and HTML`, async ({ page }) => {
    test.setTimeout(60 * 60_000);
    const problems = observe(page);
    const ledger: { step: string; at: string; detail?: Record<string, unknown> }[] = [];
    const note = (step: string, detail?: Record<string, unknown>) => {
      ledger.push({ step, at: new Date().toISOString(), ...(detail ? { detail } : {}) });
      writeFileSync(join(EVIDENCE, "live-ledger.json"), redact(JSON.stringify({ brand: BRAND, ledger, problems }, null, 2)) + "\n");
    };
    const shot = (name: string) => page.screenshot({ path: join(EVIDENCE, `live-${name}.png`), fullPage: true });
    const paidStarts: { path: string; status: number; detail: Record<string, unknown> }[] = [];
    page.on("response", async (response) => {
      const path = new URL(response.url()).pathname;
      if (response.request().method() !== "POST" || !PAID.test(path)) return;
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      const entity = body?.entity as { qlooId?: string; label?: string } | undefined;
      const detail = { status: body?.status ?? body?.scanStatus ?? null, error: body?.error ?? null, qlooId: entity?.qlooId ?? null, label: entity?.label ?? null, jobId: body?.jobId ?? null, scanId: body?.scanId ?? null };
      paidStarts.push({ path, status: response.status(), detail });
      note("paid_request", { path, status: response.status(), ...detail });
    });

    // 1. One-time private authorization; the fragment never reaches a server and leaves the URL at once.
    //    In a public evaluation the visitor is anonymous, exactly like a judge.
    if (PUBLIC_EVALUATION) {
      await page.goto("/");
      note("anonymous_public_evaluation_visitor");
    } else {
      await page.goto(`/operator#token=${OPERATOR}`);
      await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
      expect(page.url()).not.toContain(OPERATOR);
      note("operator_authorized");
    }
    await expect(page.getByTestId("research-availability")).toContainText("New brand research available.", { timeout: 30_000 });

    // 2. Brand search and real Qloo resolution.
    await page.getByRole("combobox", { name: "Brand name" }).fill(BRAND);
    await shot("01-brand-search");
    await page.getByRole("button", { name: "Find brand" }).click();
    const start = page.getByRole("button", { name: /^Start research on /u });
    const ambiguous = page.getByText(/more than one brand/u);
    await expect(start.or(ambiguous).first()).toBeVisible({ timeout: 3 * 60_000 });
    if (await ambiguous.isVisible().catch(() => false)) {
      note("brand_ambiguous_first_candidate_chosen");
      await page.getByRole("button", { name: /ID /u }).first().click();
      await expect(start).toBeVisible({ timeout: 3 * 60_000 });
    }
    await shot("02-brand-resolved");
    note("brand_resolved", { button: await start.innerText() });

    // 3. Baseline scan (a fixed set of Qloo calls, spaced 7 s apart) and the network.
    await start.click();
    await expect(page.getByTestId("research-network")).toBeVisible({ timeout: 20 * 60_000 });
    await expect(page.getByTestId("network-node-brand")).toHaveCount(1);
    await expect(page.getByTestId("network-dossier")).toContainText("Cultural fingerprint", { timeout: 60_000 });
    const directions = page.getByTestId("network-node-direction");
    const directionCount = await directions.count();
    note("baseline_network", { directions: directionCount, url: page.url() });
    await shot("03-network-fingerprint");
    if (directionCount === 0) {
      note("STOP", { reason: "baseline produced no direction to investigate; recorded as a genuine partial result" });
      return;
    }

    // 4. Select a direction and investigate it with Haiku (one paid start, never retried).
    let inquiries = 0;
    if (!SKIP_DIRECTION) {
      const first = directions.first();
      const label = (await first.getAttribute("aria-label")) ?? "";
      await first.click();
      await expect(page.getByTestId("network-dossier").getByRole("heading", { name: "Why it is here" })).toBeVisible();
      await shot("04-direction-selected");
      await page.getByTestId("network-investigate").click();
      note("investigation_started", { direction: label });
      await expect(page.getByTestId("network-node-inquiry")).toHaveCount(1, { timeout: 60_000 });
      await page.waitForTimeout(20_000);
      await shot("05-investigation-running");
      const inquiry = page.getByTestId("network-node-inquiry").first();
      await expect(inquiry).not.toHaveAttribute("data-tone", "running", { timeout: 40 * 60_000 });
      const outcome = (await inquiry.getAttribute("aria-label")) ?? "";
      await inquiry.click();
      const dossier = (await page.getByTestId("network-dossier").innerText()).replace(/\s+/gu, " ");
      note("investigation_settled", { outcome, tone: await inquiry.getAttribute("data-tone"), dossier: dossier.slice(0, 2500), nodes: await page.locator("[data-testid^='network-node-']").count() });
      await shot("06-investigation-result");
      inquiries = 1;
    }

    // 4b. A second, contrasting question from the composer (expected to be inelastic). Never retried.
    if (SECOND_QUESTION) {
      await page.getByTestId("network-node-brand").click();
      await page.getByLabel(/Ask a research question about/u).fill(SECOND_QUESTION);
      await page.getByRole("button", { name: "Ask the agent" }).click();
      note("second_question_started", { question: SECOND_QUESTION });
      await expect(page.getByTestId("network-node-inquiry")).toHaveCount(inquiries + 1, { timeout: 60_000 });
      const second = page.getByTestId("network-node-inquiry").nth(inquiries);
      inquiries += 1;
      await expect(second).not.toHaveAttribute("data-tone", "running", { timeout: 40 * 60_000 });
      await second.click();
      const reading = (await page.getByTestId("network-dossier").innerText()).replace(/\s+/gu, " ");
      note("second_question_settled", { outcome: await second.getAttribute("aria-label"), tone: await second.getAttribute("data-tone"), dossier: reading.slice(0, 2500) });
      await shot("06b-second-question-result");
    }

    // 5. Export HTML and PDF from the same research.
    for (const format of ["HTML", "PDF"] as const) {
      const downloading = page.waitForEvent("download");
      await page.getByTestId("network-report").getByRole("button", { name: format }).click();
      const download = await downloading;
      const path = join(EVIDENCE, `live-report.${format.toLowerCase()}`);
      await download.saveAs(path);
      const size = readFileSync(path).length;
      note("report_exported", { format, file: download.suggestedFilename(), bytes: size });
      expect(size).toBeGreaterThan(1000);
    }

    // 6. Save, return home and reopen from the library.
    await page.getByTestId("network-save-back").click();
    const library = page.getByTestId("research-library");
    await expect(library).toBeVisible({ timeout: 20_000 });
    await shot("07-library");
    await library.getByRole("button").first().click();
    await expect(page.getByTestId("research-network")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("network-node-inquiry")).toHaveCount(inquiries, { timeout: 30_000 });
    await shot("08-reopened");
    note("reopened_from_library");

    note("done", { paidStarts: paidStarts.length });
    expect(problems.pageErrors).toEqual([]);
    expect(problems.serverErrors).toEqual([]);
  });
});
