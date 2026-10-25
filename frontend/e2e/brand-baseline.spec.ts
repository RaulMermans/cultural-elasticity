import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const fixture = JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/synthetic/brand-baseline-e2e.json", import.meta.url), "utf8")) as { fixtureType: "synthetic"; result: { scanId: string } };

test("SYNTHETIC brand-first flow resolves ambiguity, starts, polls, and inspects provenance", async ({ page }) => {
  let resolveCalls = 0;
  await page.route("**/api/brands/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const respond = (value: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (path === "/api/brands/status") return respond({ enabled: true, semantics: "baseline_admission_only" });
    if (path === "/api/brands/resolve") {
      resolveCalls += 1;
      if (resolveCalls === 1) return respond({ resolutionId: "00000000-0000-4000-8000-000000000020", accessToken: "syn-token", status: "AMBIGUOUS", candidates: [{ qlooId: "syn-brand-21", label: "Northwind Atelier", type: "brand" }, { qlooId: "syn-brand-22", label: "Northwind Atelier Studio", type: "brand" }] });
      return respond({ resolutionId: "00000000-0000-4000-8000-000000000023", accessToken: "syn-token", status: "RESOLVED", entity: { qlooId: "syn-brand-21", label: "Northwind Atelier" } });
    }
    if (path === "/api/brands/baselines" && route.request().method() === "POST") return respond({ scanId: fixture.result.scanId, scanStatus: "QUEUED", reused: false, cached: false }, 202);
    if (path === `/api/brands/baselines/${fixture.result.scanId}`) return respond({ scanStatus: "COMPLETE", providerCallCount: 0, stages: [{ stage: "tags", status: "COMPLETE" }], result: fixture.result });
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
  await page.getByText("Craft · tags").click();
  await expect(page.getByText("urn:tag:interests:qloo:craft").first()).toBeVisible();
  await page.getByRole("button", { name: /Craft Observed association/u }).click();
  await expect(page.getByText("syn-corr-21")).toHaveCount(2);
  expect(resolveCalls).toBe(2);
});
