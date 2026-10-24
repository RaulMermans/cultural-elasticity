import { expect, test } from "@playwright/test";

const sentinelQloo = ["SENTINEL", "QLOO", "NOT", "IN", "BROWSER"].join("_");
const sentinelModel = ["SENTINEL", "MODEL", "NOT", "IN", "BROWSER"].join("_");

async function open(page: import("@playwright/test").Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  const response = await page.goto("/", { waitUntil: "domcontentloaded", timeout: 120_000 });
  if (!response || response.status() >= 500) {
    throw new Error(`Living Atlas GET / failed: status=${response?.status() ?? "none"}`);
  }
  await expect(page.getByTestId("atlas-app")).toHaveAttribute("data-admissions", /accepting|paused|unavailable/, { timeout: 30_000 });
  const admissions = await page.getByTestId("atlas-app").getAttribute("data-admissions");
  if (admissions !== "accepting") return;
  const composer = page.locator("form.composer");
  await expect(composer, "composer markup should render before hydration").toBeVisible({ timeout: 30_000 });
  try {
    await expect(composer).toHaveAttribute("data-hydrated", "true", { timeout: 30_000 });
  } catch (error) {
    const detail = `hydration failed status=${response.status()} pageErrors=${pageErrors.join(" | ") || "none"} console=${consoleErrors.join(" | ") || "none"}`;
    throw new Error(detail, { cause: error });
  }
}

function branch(page: import("@playwright/test").Page, name: RegExp) {
  return page.getByTestId("atlas-canvas").getByRole("button", { name });
}

async function ask(page: import("@playwright/test").Page, query: string) {
  await page.getByTestId("query-input").fill(query);
  await page.getByTestId("query-submit").click();
}

async function investigate(page: import("@playwright/test").Page) {
  await ask(page, "Where could Paper Lantern expand?");
  await expect(branch(page, /Coastal cooking/)).toBeVisible({ timeout: 20_000 });
}

test("the opening page states the question", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("heading", { name: "See where a brand can stretch." })).toBeVisible();
  await expect(page.locator(".landing__lede")).toContainText("cultural observatory");
  await expect(page.getByTestId("recorded-open")).toBeVisible();
  await expect(page.getByTestId("query-input")).toBeVisible();
  await expect(page.getByText("cultural distance")).toBeVisible();
});

test("a question shows progress and then territories", async ({ page }) => {
  await open(page);
  await ask(page, "Where could Paper Lantern expand?");
  const progress = page.getByTestId("progress");
  await Promise.race([
    expect(progress).toContainText("Interpreting question", { timeout: 15_000 }),
    expect(branch(page, /Coastal cooking/)).toBeVisible({ timeout: 20_000 }),
  ]);
  await expect(branch(page, /Coastal cooking/)).toBeVisible({ timeout: 20_000 });
  await expect(branch(page, /Clay studios/)).toBeVisible();
  await expect(branch(page, /No evidence/)).toBeVisible();
  await expect(progress).toHaveCount(0);
});

test("a territory opens and closes the evidence inspector", async ({ page }) => {
  await open(page);
  await investigate(page);
  await branch(page, /Coastal cooking/).click();
  await expect(page.getByRole("heading", { name: "Coastal cooking" })).toBeVisible();
  await page.getByTestId("evidence-open").click();
  await expect(page.getByTestId("evidence-inspector")).toBeVisible();
  await expect(page.getByText("Observed evidence")).toBeVisible();
  await expect(page.getByText("Synthetic evidence")).toBeVisible();
  await expect(page.getByText("not a prediction of commercial success")).toBeVisible();
  await page.getByTestId("evidence-close").click();
  await expect(page.getByTestId("evidence-inspector")).toHaveCount(0);
});

test("a narrower question becomes a child, and return restores the parent", async ({ page }) => {
  await open(page);
  await investigate(page);
  await branch(page, /Coastal cooking/).click();
  await page.getByTestId("follow-up-input").fill("Seasonal dinners");
  await page.getByTestId("follow-up-submit").click();
  await expect(branch(page, /Seasonal dinners/)).toBeVisible();
  await branch(page, /Seasonal dinners/).click();
  await page.getByTestId("return-parent").click();
  await expect(page.getByRole("heading", { name: "Coastal cooking" })).toBeVisible();
  await expect(branch(page, /Seasonal dinners/)).toBeVisible();
  await expect(page.locator(".detail")).toContainText("Partial evidence");
});

test("a vague narrowing asks for a concept instead of naming one", async ({ page }) => {
  await open(page);
  await investigate(page);
  await branch(page, /Coastal cooking/).click();
  await page.getByTestId("follow-up-input").fill("more specific");
  await page.getByTestId("follow-up-submit").click();
  await expect(page.getByTestId("clarification-dialog")).toContainText("What part of this territory would you like to explore?", { timeout: 15_000 });
  await expect(page.getByText("Continuing:")).toBeVisible();
});

test("a recorded example is labelled and does not start a job", async ({ page }) => {
  const jobs: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/agent/jobs")) jobs.push(request.url());
  });
  await open(page);
  await page.getByTestId("recorded-open").click();
  await expect(page.getByRole("note")).toContainText("Recorded example", { timeout: 15_000 });
  await expect(branch(page, /Bohemian lifestyle/).first()).toBeVisible();
  await expect(branch(page, /Partial/).first()).toBeVisible();
  expect(jobs).toEqual([]);
});

test("the landing preview keeps nested territories inside the pane", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const hospitality = page.locator("[data-preview='true']").getByRole("button", { name: /design-led boutique hospitality/i });
  await expect(hospitality).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => {
    const preview = await page.locator(".landing__preview").boundingBox();
    const node = await hospitality.boundingBox();
    if (!preview || !node) return false;
    return (
      node.x >= preview.x - 2 &&
      node.y >= preview.y - 2 &&
      node.x + node.width <= preview.x + preview.width + 2 &&
      node.y + node.height <= preview.y + preview.height + 2
    );
  }).toBe(true);
});

test("paused admissions keep the recorded example as the primary action", async ({ page }) => {
  await page.route("**/api/agent/admissions", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "paused" }) });
  });
  const jobs: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/agent/jobs")) jobs.push(request.url());
  });
  await open(page);
  await expect(page.getByTestId("recorded-open")).toBeVisible();
  await expect(page.getByTestId("query-submit")).toHaveCount(0);
  await expect(page.getByText("Live investigations are paused")).toBeVisible();
  await page.getByTestId("recorded-open").click();
  await expect(branch(page, /Bohemian lifestyle/).first()).toBeVisible();
  await expect(page.getByTestId("follow-up-submit")).toBeDisabled();
  expect(jobs).toEqual([]);
});

test("a clarification can be answered", async ({ page }) => {
  await open(page);
  await ask(page, "Ask without naming a brand");
  await expect(page.getByTestId("clarification-dialog")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Which brand should the investigation follow?")).toBeVisible();
  await page.getByTestId("clarification-input").fill("Paper Lantern");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(branch(page, /Coastal cooking/)).toBeVisible();
  await expect(page.getByTestId("clarification-dialog")).toHaveCount(0);
});

test("an unsupported competitor request is explained and waits for confirmation", async ({ page }) => {
  await open(page);
  await ask(page, "Compare Paper Lantern with another brand in clay studios");
  await expect(page.getByTestId("alternative-dialog")).toBeVisible();
  await expect(page.getByText("Comparing two brands is recognized")).toBeVisible();
  await expect(page.getByText("does not compare brands")).toBeVisible();
  await expect(branch(page, /Not yet investigated/).first()).toBeVisible();
  await page.getByTestId("alternative-confirm").click();
  await expect(branch(page, /Partial/).first()).toBeVisible();
});

test("competitor whitespace is explained without an investigation", async ({ page }) => {
  await open(page);
  await ask(page, "Where is the open space competitors leave?");
  await expect(page.getByTestId("query-outcome")).toContainText("not available yet");
  await expect(page.getByTestId("alternative-dialog")).toHaveCount(0);
});

test("an invalid payload fails without a stack trace", async ({ page, request }) => {
  const rejected = await request.post("/api/agent/jobs", { data: {} });
  expect(rejected.status()).toBe(400);
  const body = await rejected.text();
  expect(body).toContain("could not be accepted");
  expect(body).not.toContain("at ");
  await open(page);
  await ask(page, "Return a malformed investigation");
  await expect(page.locator(".notice")).toContainText("cannot show");
});

test("keyboard navigation selects a territory", async ({ page }) => {
  await open(page);
  await page.getByTestId("query-input").focus();
  await page.keyboard.type("Where could Paper Lantern expand?");
  await page.keyboard.press("Enter");
  const territory = branch(page, /Coastal cooking/);
  await expect(territory).toBeVisible();
  await territory.focus();
  await page.keyboard.press("Enter");
  await expect(territory).toHaveAttribute("aria-pressed", "true");
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("nodes opt out of the breathing animation", async ({ page }) => {
    await open(page);
    await investigate(page);
    await expect(branch(page, /Coastal cooking/)).toHaveAttribute("data-reduced", "true");
  });
});

test.describe("tablet", () => {
  test.use({ viewport: { width: 768, height: 1024 } });
  test("the recorded tree keeps nested territories in view", async ({ page }) => {
    await open(page);
    await page.getByTestId("recorded-open").click();
    const hospitality = branch(page, /design-led boutique hospitality/);
    await expect(hospitality).toBeVisible({ timeout: 15_000 });
    await expect(hospitality).toBeInViewport();
    const box = await hospitality.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.x).toBeGreaterThanOrEqual(-2);
    expect(box!.x + box!.width).toBeLessThanOrEqual(770);
  });
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("the branch stays usable without the desktop canvas", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("heading", { name: "See where a brand can stretch." })).toBeVisible();
    await investigate(page);
    await expect(page.locator(".canvas__edges")).toHaveCount(0);
    const territory = branch(page, /Coastal cooking/);
    await expect(territory).toBeInViewport();
    await territory.click();
    await expect(page.getByTestId("follow-up-input")).toBeVisible();
  });
});

test("a missing investigation offers a new one", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("ce.atlas.handles", JSON.stringify([{ jobId: "00000000-0000-4000-8000-000000000077", token: "missing" }]));
  });
  await open(page);
  await expect(page.getByText("cannot be resumed")).toBeVisible();
  await page.getByRole("button", { name: "Start a new investigation" }).click();
  await expect(page.getByRole("heading", { name: "See where a brand can stretch." })).toBeVisible();
});

test("stopping an investigation keeps an interrupted state", async ({ page }) => {
  await open(page);
  await ask(page, "Stop this investigation");
  await expect(page.getByTestId("progress")).toBeVisible();
  await page.getByTestId("progress-stop").click();
  await expect(page.getByText("was stopped")).toBeVisible({ timeout: 15_000 });
  await expect(branch(page, /Interrupted/)).toBeVisible();
});

test("provider secrets never reach the browser", async ({ page }) => {
  const bodies: string[] = [];
  page.on("response", async (response) => {
    const type = response.headers()["content-type"] ?? "";
    if (type.includes("json") || type.includes("html") || type.includes("javascript")) {
      bodies.push(await response.text().catch(() => ""));
    }
  });
  await open(page);
  await investigate(page);
  const html = await page.content();
  const combined = `${html}\n${bodies.join("\n")}`;
  expect(combined).not.toContain(sentinelQloo);
  expect(combined).not.toContain(sentinelModel);
  expect(combined).not.toContain("sk-ant-");
});
