/**
 * Operator link: `/operator#token=…` stores the credential through the session route without the form, removes
 * it from the address bar before the request leaves, and returns to brand research. The token is a SYNTHETIC
 * placeholder; the session route never checks it (Railway does, on every paid start), so no provider is reached.
 */
import { expect, test } from "@playwright/test";

const SYNTHETIC_TOKEN = "synthetic-operator-token-0000000000000000";

test("an operator link authorizes the browser and returns home without leaving the token in the URL", async ({ page, context }) => {
  const sessionPosts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/operator/session") sessionPosts.push(page.url());
  });
  await page.goto(`/operator#token=${SYNTHETIC_TOKEN}`);
  await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 });
  expect(sessionPosts).toHaveLength(1);
  expect(sessionPosts[0]).not.toContain(SYNTHETIC_TOKEN);
  expect(page.url()).not.toContain(SYNTHETIC_TOKEN);
  const cookie = (await context.cookies()).find((entry) => entry.httpOnly && entry.value === SYNTHETIC_TOKEN);
  expect(cookie).toBeDefined();
});

test("a rejected operator link stays on the page and says nothing was stored", async ({ page }) => {
  await page.goto("/operator#token=short");
  await expect(page.getByTestId("operator-status")).toContainText("This link was not accepted.");
  expect(page.url()).not.toContain("short");
});

test("the operator page has no credential screen and returns home without a link", async ({ page }) => {
  await page.goto("/operator");
  await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 });
  await expect(page.getByLabel("Operator credential")).toHaveCount(0);
});
