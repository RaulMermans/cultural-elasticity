/**
 * Sprint 9J hosted LIVE journey. Real browser → deployed frontend → Railway → real Qloo (hackathon host) and real
 * Claude Haiku. It runs only when the owner authorized the bounded run and the operator credential is supplied:
 *   E2E_LIVE_AUTHORIZED=1 E2E_OPERATOR_TOKEN=… E2E_HOSTED_URL=… playwright test -c playwright.hosted.config.ts hosted-live
 * No route is stubbed and nothing is injected but the operator's own credential (via the session route) and the
 * user's choices. Evidence files keep job ids, statuses and outcomes; never job tokens or the operator credential.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const evidence = fileURLToPath(new URL("../../docs/sprint-9j/evidence/live/", import.meta.url));
const shots = fileURLToPath(new URL("../../docs/sprint-9j/screenshots/live/", import.meta.url));
mkdirSync(evidence, { recursive: true });
mkdirSync(shots, { recursive: true });
const OPERATOR = process.env.E2E_OPERATOR_TOKEN ?? "";
const EXPECTED_BRAND_ID = process.env.E2E_EXPECTED_BRAND_ID ?? "";
const TARGET = "Boutique hospitality";
const REFERENCES = (process.env.E2E_REFERENCES ?? "Luxury hotels|Fine dining").split("|");
const PAID = /^\/api\/(agent\/jobs|research\/(handoff|compare)\/jobs|brands\/(resolve|baselines))$/u;

test.skip(process.env.E2E_LIVE_AUTHORIZED !== "1" || OPERATOR.length < 32, "Live run not authorized for this invocation.");
test.describe.configure({ mode: "serial" });

type Ledger = { step: string; at: string; detail: Record<string, unknown> }[];
const ledger: Ledger = [];
const note = (step: string, detail: Record<string, unknown> = {}) => {
  ledger.push({ step, at: new Date().toISOString(), detail });
  writeFileSync(`${evidence}journey-ledger.json`, `${JSON.stringify(ledger, null, 2)}\n`);
};
const handles: { label: string; jobId: string; token: string }[] = [];
const resolvedBrandIds: string[] = [];

function watch(page: Page) {
  const paid: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && PAID.test(path)) paid.push(path);
  });
  page.on("response", async (response) => {
    const path = new URL(response.url()).pathname;
    if (path === "/api/brands/resolve" && response.request().method() === "POST") {
      const body = (await response.json().catch(() => null)) as { status?: string; entity?: { qlooId?: string } } | null;
      if (body?.entity?.qlooId) resolvedBrandIds.push(body.entity.qlooId);
      note("brand_resolve_response", { status: response.status(), resolution: body?.status ?? null, qlooId: body?.entity?.qlooId ?? null });
      return;
    }
    if (response.request().method() !== "POST" || !/^\/api\/research\/(handoff|compare)\/jobs$/u.test(path)) return;
    const body = (await response.json().catch(() => null)) as { jobId?: string; accessToken?: string } | null;
    if (body?.jobId && body.accessToken) handles.push({ label: path, jobId: body.jobId, token: body.accessToken });
    note("paid_start_response", { path, status: response.status(), jobId: body?.jobId ?? null });
  });
  return paid;
}

const shot = (page: Page, name: string) => page.screenshot({ path: `${shots}${name}.png`, fullPage: true });

async function investigate(page: Page, direction: string): Promise<string> {
  await page.getByRole("link", { name: /Directions/u }).click();
  const field = page.getByLabel("Have a specific cultural direction in mind?");
  await field.fill(direction);
  await field.press("Enter");
  const panel = page.getByTestId("deep-investigation");
  await expect(panel.getByRole("button", { name: "Start live investigation" })).toBeEnabled({ timeout: 30_000 });
  await panel.getByRole("button", { name: "Start live investigation" }).click();
  await expect(panel.getByRole("status")).toContainText(/Investigation finished|failed|cancelled|expired|unavailable/u, { timeout: 25 * 60_000 });
  const status = (await panel.getByRole("status").innerText()).replace(/\s+/gu, " ").slice(0, 300);
  note("investigation_settled", { direction, status, jobId: handles.at(-1)?.jobId ?? null });
  await shot(page, `investigation-${direction.toLowerCase().replace(/\s+/gu, "-")}`);
  return status;
}

test("LIVE: Loewe baseline → references → Boutique hospitality → governed comparison → report", async ({ page }) => {
  test.setTimeout(120 * 60_000);
  const paid = watch(page);
  // The operator authorizes this browser through the operator page; Railway verifies the credential on each paid start.
  await page.goto("/operator");
  await page.getByLabel("Operator credential").fill(OPERATOR);
  await page.getByRole("button", { name: "Authorize this browser" }).click();
  await expect(page.getByTestId("operator-status")).toContainText("Credential stored", { timeout: 15_000 });
  await page.goto("/");
  await expect(page.getByTestId("research-availability")).toContainText("New brand research available.", { timeout: 30_000 });
  note("operator_session_established");

  // Stage A: live baseline.
  await page.getByLabel("Brand name").fill("Loewe");
  await page.getByRole("button", { name: "Find brand" }).click();
  const ambiguous = page.getByText("Qloo found more than one brand with this name.");
  const start = page.getByRole("button", { name: /^Start research on /u });
  await expect(ambiguous.or(start)).toBeVisible({ timeout: 120_000 });
  if (await ambiguous.isVisible()) {
    note("brand_ambiguous");
    await page.getByRole("button", { name: new RegExp(`ID ${EXPECTED_BRAND_ID}`, "u") }).click();
  }
  await shot(page, "a1-brand-resolved");
  // Stop rule: the canonical Qloo identity must be the one recorded for Loewe in earlier live evidence.
  await expect.poll(() => resolvedBrandIds.at(-1) ?? null, { timeout: 30_000 }).not.toBeNull();
  if (EXPECTED_BRAND_ID && resolvedBrandIds.at(-1) !== EXPECTED_BRAND_ID) {
    note("STOP", { reason: "brand identity differs from the recorded Loewe Qloo id", resolved: resolvedBrandIds.at(-1) });
    throw new Error("BRAND_IDENTITY_CHANGED");
  }
  note("brand_resolved", { button: await start.innerText() });
  await start.click();
  await expect(page.getByTestId("fingerprint")).toBeVisible({ timeout: 15 * 60_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Loewe" })).toBeVisible();
  await expect(page.getByRole("note").first()).toContainText(/live/iu);
  await shot(page, "a2-live-fingerprint");
  note("baseline_complete", { url: page.url().replace(/[?&]token=[^&]*/u, "") });
  expect(page.url()).not.toMatch(/token/iu);

  // Stage C first, so the target's comparison panel can offer the completed references; then stage B.
  const statuses: Record<string, string> = {};
  for (const reference of REFERENCES) {
    statuses[reference] = await investigate(page, reference);
    await page.getByTestId("deep-investigation").getByRole("button", { name: "Close investigation" }).click();
  }
  statuses[TARGET] = await investigate(page, TARGET);
  note("single_direction_statuses", statuses);
  if (!/Investigation finished/u.test(statuses[TARGET]!)) {
    note("STOP", { reason: "target investigation did not complete" });
    return;
  }

  // Stage D: the server offers references; the browser sends identifiers and the user's authorization only.
  const panel = page.getByTestId("comparative-research");
  await expect(panel).toBeVisible({ timeout: 60_000 });
  await shot(page, "d1-comparison-options");
  const offered: Record<string, boolean> = {};
  for (const reference of REFERENCES) {
    const box = panel.getByRole("checkbox", { name: new RegExp(reference, "iu") });
    offered[reference] = (await box.count()) > 0 && (await box.first().isEnabled());
  }
  note("references_offered", { offered, panelText: (await panel.innerText()).replace(/\s+/gu, " ").slice(0, 1500) });
  if (!REFERENCES.every((reference) => offered[reference])) {
    note("STOP", { reason: "a reference was not offered as eligible by the server; no substitution" });
    return;
  }
  for (const reference of REFERENCES) await panel.getByRole("checkbox", { name: new RegExp(reference, "iu") }).first().check();
  await panel.getByRole("button", { name: "Check comparison" }).click();
  const eligibility = page.getByTestId("comparison-eligibility");
  await expect(eligibility).toBeVisible({ timeout: 60_000 });
  const eligible = await eligibility.getAttribute("data-eligible");
  note("eligibility", { eligible, text: (await eligibility.innerText()).replace(/\s+/gu, " ").slice(0, 800) });
  await shot(page, "d2-eligibility");
  if (eligible !== "true") {
    note("STOP", { reason: "comparison not eligible" });
    return;
  }
  const authorization = page.getByTestId("comparison-authorization");
  note("authorization_limits", { text: (await authorization.innerText()).replace(/\s+/gu, " ").slice(0, 800) });
  await authorization.getByLabel(/I authorize these paid provider calls/u).check();
  const startComparison = authorization.getByRole("button", { name: "Start comparison" });
  await startComparison.click();
  // A repeated click must never dispatch a second comparison.
  await startComparison.click({ timeout: 2_000 }).catch(() => undefined);
  const report = page.getByTestId("comparative-report");
  await expect(report).toBeVisible({ timeout: 30 * 60_000 });
  const outcome = await report.getAttribute("data-outcome");
  note("comparison_report", { outcome, text: (await report.innerText()).replace(/\s+/gu, " ").slice(0, 3000) });
  await shot(page, "d3-comparative-report");

  await page.getByRole("button", { name: "Review and export the research brief" }).click();
  const summary = page.getByTestId("research-summary");
  await expect(summary).toBeVisible();
  const downloading = page.waitForEvent("download");
  await summary.getByRole("button", { name: "Download brief (HTML)" }).click();
  const brief = readFileSync((await (await downloading).path())!, "utf8");
  writeFileSync(`${evidence}exported-live-brief.html`, brief);
  expect(brief).not.toMatch(/sk-ant-|x-ce-/u);
  await shot(page, "d4-summary");

  const comparisonStarts = paid.filter((path) => path === "/api/research/compare/jobs").length;
  note("paid_posts", { all: paid, comparisonStarts });
  expect(comparisonStarts).toBeLessThanOrEqual(1);

  // The same live jobs in the Living Atlas, restored from session handles as the Atlas itself does.
  await page.evaluate((list) => sessionStorage.setItem("ce.atlas.handles", JSON.stringify(list)), handles.map(({ jobId, token }) => ({ jobId, token })));
  await page.goto("/?mode=atlas");
  await expect(page.getByTestId("atlas-canvas")).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(3_000);
  await shot(page, "e1-living-atlas-live-jobs");
  note("atlas_nodes", { nodes: (await page.getByTestId("atlas-canvas").getByRole("button").allInnerTexts()).map((t) => t.replace(/\s+/gu, " ")) });
});
