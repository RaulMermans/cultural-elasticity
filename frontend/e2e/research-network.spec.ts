/**
 * The unified research network in the browser. Every live response is SYNTHETIC (backend/tests/fixtures/synthetic/
 * comparative-e2e.json); the recorded Loewe research is real stored Qloo evidence re-read offline. No test here
 * reaches Qloo or a model.
 */
import { readFileSync } from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";

type Fixture = { baseline: { scanId: string; scanStatus: string }; parent: { created: { jobId: string }; view: unknown }; compare: { view: unknown } };
const fixture = JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/synthetic/comparative-e2e.json", import.meta.url), "utf8")) as Fixture;
const json = (route: Route, value: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });

async function stubLive(page: Page) {
  const calls = { handoffs: [] as unknown[], questions: [] as unknown[] };
  await page.route("**/api/agent/admissions", (route) => json(route, { status: "accepting" }));
  await page.route("**/api/brands/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/brands/status") return json(route, { enabled: true, semantics: "baseline_admission_only" });
    if (path === "/api/brands/resolve") return json(route, { resolutionId: "00000000-0000-4000-8000-000000000030", accessToken: "syn-token", status: "RESOLVED", entity: { qlooId: "SYN-BR-3001", label: "Larkspur Velo" } });
    if (path === "/api/brands/baselines" && route.request().method() === "POST") return json(route, { scanId: fixture.baseline.scanId, scanStatus: "QUEUED", reused: false, cached: false }, 202);
    if (path === `/api/brands/baselines/${fixture.baseline.scanId}`) return json(route, { scanStatus: fixture.baseline.scanStatus, providerCallCount: 2, stages: [{ stage: "tags", status: "COMPLETE" }], result: fixture.baseline });
    return json(route, { error: "not_found" }, 404);
  });
  await page.route("**/api/research/handoff/jobs", (route) => { calls.handoffs.push(route.request().postDataJSON()); return json(route, fixture.parent.created, 202); });
  // Each SYNTHETIC question gets its own job id; every job reads back the same SYNTHETIC completed view.
  await page.route("**/api/agent/jobs", (route) => {
    calls.questions.push(route.request().postDataJSON());
    return json(route, { ...fixture.parent.created, jobId: `00000000-0000-4000-8000-${String(calls.questions.length).padStart(12, "0")}` }, 202);
  });
  await page.route("**/api/agent/jobs/*", (route) => json(route, fixture.parent.view));
  return calls;
}

async function startLarkspur(page: Page) {
  await page.goto("/");
  await page.getByLabel("Brand name").fill("Larkspur Velo");
  await page.getByRole("button", { name: "Find brand" }).click();
  await page.getByRole("button", { name: /Start research/u }).click();
  await expect(page.getByTestId("research-network")).toBeVisible();
}

test("recorded research opens as a network: brand, directions, a direction dossier, and no paid call", async ({ page }) => {
  const paid: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST" && /\/api\/(agent|research|brands)\//u.test(request.url())) paid.push(request.url()); });
  await page.goto("/?research=loewe");
  await expect(page.getByTestId("network-node-brand")).toHaveCount(1);
  await expect(page.getByTestId("network-node-direction")).toHaveCount(2);
  await expect(page.getByTestId("network-dossier")).toContainText("Cultural fingerprint");
  await page.getByRole("treeitem", { name: "Direction: Model, Direction" }).click();
  const dossier = page.getByTestId("network-dossier");
  await expect(dossier.getByRole("heading", { name: "Why it is here" })).toBeVisible();
  await expect(dossier.getByTestId("network-elasticity")).toContainText("Not measured yet");
  await expect(page.getByTestId("network-node-connection").first()).toBeVisible();
  await expect(page.getByText("distance on the board is not cultural distance")).toBeVisible();
  expect(paid).toEqual([]);
});

test("SYNTHETIC investigating a direction attaches the agent's validated result to it", async ({ page }) => {
  const calls = await stubLive(page);
  await startLarkspur(page);
  await page.getByRole("treeitem", { name: /Direction: Slow Touring/u }).click();
  await page.getByTestId("network-investigate").click();
  await expect(page.getByTestId("network-node-inquiry")).toHaveCount(1);
  await expect(page.getByTestId("network-dossier")).toContainText("Inconclusive");
  expect(calls.handoffs).toHaveLength(1);
  const body = calls.handoffs[0] as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(["idempotencyKey", "scanId", "territoryId"]);
  expect(page.url()).not.toContain("syn-token");
});

test("SYNTHETIC a question from the composer names the brand; a follow-up carries only its run context", async ({ page }) => {
  const calls = await stubLive(page);
  await startLarkspur(page);
  await page.getByLabel(/Ask a research question about/u).fill("Where could Larkspur Velo go next?");
  await page.getByRole("button", { name: "Ask the agent" }).click();
  await expect(page.getByTestId("network-node-inquiry")).toHaveCount(1);
  expect(calls.questions[0]).toEqual({ query: "Where could Larkspur Velo go next?", brand: "Larkspur Velo" });
  await page.getByLabel(/Continue from/u).fill("Narrow it to gravel events");
  await page.getByRole("button", { name: "Ask the agent" }).click();
  await expect(page.getByTestId("network-node-inquiry")).toHaveCount(2);
  const followUp = calls.questions[1] as { query: string; context?: { runId: string }; brand?: string };
  expect(followUp.brand).toBeUndefined();
  expect(typeof followUp.context?.runId).toBe("string");
});

test("SYNTHETIC the network is kept in the research library and reopens with its investigations", async ({ page }) => {
  await stubLive(page);
  await startLarkspur(page);
  await page.getByRole("treeitem", { name: /Direction: Slow Touring/u }).click();
  await page.getByTestId("network-investigate").click();
  await expect(page.getByTestId("network-node-inquiry")).toHaveCount(1);
  await page.getByRole("button", { name: "Research library" }).click();
  await page.getByTestId("research-library").getByRole("button", { name: /Larkspur Velo/u }).click();
  await expect(page.getByTestId("network-node-inquiry")).toHaveCount(1);
});

test("SYNTHETIC a lost investigation can be tried again and takes the failed card's place", async ({ page }) => {
  const calls = await stubLive(page);
  await page.route("**/api/agent/jobs/*", (route) => route.request().url().endsWith("000000000001")
    ? json(route, { error: "not_found" }, 404)
    : json(route, fixture.parent.view));
  await startLarkspur(page);
  await page.getByLabel(/Ask a research question about/u).fill("Where could Larkspur Velo go next?");
  await page.getByRole("button", { name: "Ask the agent" }).click();
  await expect(page.getByTestId("network-dossier")).toContainText("No longer available");
  await page.getByTestId("network-retry").click();
  await expect(page.getByTestId("network-dossier")).not.toContainText("No longer available");
  await expect(page.getByTestId("network-node-inquiry")).toHaveCount(1);
  expect(calls.questions).toEqual([
    { query: "Where could Larkspur Velo go next?", brand: "Larkspur Velo" },
    { query: "Where could Larkspur Velo go next?", brand: "Larkspur Velo" },
  ]);
});

test("the zoom controls zoom the board and fit it again", async ({ page }) => {
  await page.goto("/?research=loewe");
  const layer = page.getByTestId("network-canvas").locator("svg > g");
  const scale = async () => Number((await layer.getAttribute("transform"))?.match(/scale\(([\d.]+)\)/u)?.[1]);
  // The board fits itself once it knows its size; read the scale only after it has settled.
  let fitted = 0;
  await expect(async () => { const first = await scale(); await page.waitForTimeout(200); fitted = await scale(); expect(fitted).toBe(first); }).toPass();
  await page.getByRole("button", { name: "Zoom in" }).click();
  expect(await scale()).toBeGreaterThan(fitted);
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  expect(await scale()).toBeLessThan(fitted);
  await page.getByRole("button", { name: "Fit the network" }).click();
  expect(await scale()).toBeCloseTo(fitted, 5);
});

test("SYNTHETIC a running investigation shows the agent's live steps", async ({ page }) => {
  await stubLive(page);
  const running = { ...(fixture.parent.view as Record<string, unknown>), status: "running", stage: "investigating", stageLabel: "Investigating available evidence", response: null,
    activity: [
      { kind: "step", label: "Looked up an entity in Qloo", detail: "SYNTHETIC: resolve the brand first.", status: "info" },
      { kind: "tool", label: "Asked Qloo for associated entities", detail: "SYNTHETIC: 12 entities returned", status: "ok" },
    ] };
  await page.route("**/api/agent/jobs/*", (route) => json(route, running));
  await startLarkspur(page);
  await page.getByLabel(/Ask a research question about/u).fill("Where could Larkspur Velo go next?");
  await page.getByRole("button", { name: "Ask the agent" }).click();
  const activity = page.getByTestId("network-activity");
  await expect(activity).toContainText("Asked Qloo for associated entities");
  await expect(activity).toContainText("SYNTHETIC: resolve the brand first.");
  await expect(activity.getByLabel("The agent is thinking")).toBeVisible();
});

test("cards can be dragged with their branch, the arrangement is kept, and Tidy restores it", async ({ page }) => {
  await page.goto("/?research=loewe");
  const card = page.getByRole("treeitem", { name: "Direction: Model, Direction" });
  const where = async () => card.evaluate((element) => (element as SVGGElement).style.transform);
  const before = await where();
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 80, { steps: 8 });
  await page.mouse.up();
  const after = await where();
  expect(after).not.toBe(before);
  await expect(page.getByTestId("network-dossier")).not.toContainText("Why it is here");
  await page.reload();
  await expect.poll(where).toBe(after);
  await page.getByRole("button", { name: "Tidy the layout" }).click();
  await expect.poll(where).toBe(before);
});

test("SYNTHETIC questions branch from a direction: a brand question joins or opens one, and a repeat opens the answer", async ({ page }) => {
  const calls = await stubLive(page);
  await startLarkspur(page);
  await page.getByLabel(/Ask a research question about/u).fill("How far can Larkspur Velo extend into Gravel Riding?");
  await page.getByRole("button", { name: "Ask the agent" }).click();
  // The SYNTHETIC answer is about Gravel Riding, which the baseline did not list: it opens a new direction.
  await expect(page.getByRole("treeitem", { name: "Direction: Gravel Riding, New direction" })).toBeVisible();
  await expect(page.getByTestId("network-node-finding")).toHaveCount(0);
  await page.getByRole("treeitem", { name: /Direction: Slow Touring/u }).click();
  await expect(page.getByText(/Ask about/u)).toContainText("Slow Touring");
  await page.getByLabel(/Ask about/u).fill("Which audiences overlap?");
  await page.getByRole("button", { name: "Ask the agent" }).click();
  await expect(page.getByTestId("network-node-inquiry")).toHaveCount(2);
  expect(calls.questions[1]).toEqual({ query: "Which audiences overlap?", brand: "Larkspur Velo", territories: ["Slow Touring"] });
  await page.getByRole("treeitem", { name: /Direction: Slow Touring/u }).click();
  await page.getByLabel(/Ask about/u).fill("which audiences  overlap?");
  await page.getByRole("button", { name: "Ask the agent" }).click();
  await expect(page.getByText("You already asked this")).toBeVisible();
  expect(calls.questions).toHaveLength(2);
});

test("SYNTHETIC a compared territory explains its result in plain words and shows its evidence", async ({ page }) => {
  await stubLive(page);
  await page.route("**/api/agent/jobs/*", (route) => json(route, fixture.compare.view));
  await startLarkspur(page);
  await page.getByLabel(/Ask a research question about/u).fill("Compare Gravel Riding with Alpine Hiking and Mountain Town");
  await page.getByRole("button", { name: "Ask the agent" }).click();
  await page.getByRole("treeitem", { name: /Territory: Mountain Town/u }).click();
  const dossier = page.getByTestId("network-dossier");
  await expect(dossier.getByTestId("network-verdict")).toContainText("Natural fit");
  await expect(dossier.getByRole("list", { name: /Where it sits/u }).locator("[aria-current]")).toHaveText("Natural fit");
  await expect(dossier.getByRole("heading", { name: "How it ranked" })).toBeVisible();
  await expect(dossier.locator(".rr-rank li[data-current]")).toContainText("Mountain Town");
  await expect(dossier).toContainText("not a forecast of sales");
  await expect(dossier.getByRole("button", { name: "Investigate Mountain Town further" })).toBeVisible();
});

test("SYNTHETIC a branch is removed only after a second confirmation, and a kept answer survives a lost job", async ({ page }) => {
  await stubLive(page);
  await startLarkspur(page);
  await page.getByLabel(/Ask a research question about/u).fill("How far can Larkspur Velo extend into Gravel Riding?");
  await page.getByRole("button", { name: "Ask the agent" }).click();
  await expect(page.getByTestId("network-dossier")).toContainText("Inconclusive");
  // The server forgets the job; the answer already kept in this browser stays.
  await page.route("**/api/agent/jobs/*", (route) => json(route, { error: "not_found" }, 404));
  await page.reload();
  await page.getByRole("treeitem", { name: /Question: How far can Larkspur Velo extend into Gravel Riding/u }).click();
  await expect(page.getByTestId("network-dossier")).not.toContainText("No longer available");
  await page.getByRole("treeitem", { name: "Direction: Gravel Riding, New direction" }).click();
  await page.getByRole("button", { name: "Remove this branch…" }).click();
  await page.getByRole("button", { name: "Keep it" }).click();
  await expect(page.getByTestId("network-node-inquiry")).toHaveCount(1);
  await page.getByRole("button", { name: "Remove this branch…" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Remove these 2 cards");
  await page.getByRole("button", { name: /Yes, remove/u }).click();
  await expect(page.getByTestId("network-node-inquiry")).toHaveCount(0);
  await expect(page.getByRole("treeitem", { name: /Gravel Riding/u })).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("network-node-inquiry")).toHaveCount(0);
});

test("SYNTHETIC investigating a found territory grows its own branch instead of opening a new direction", async ({ page }) => {
  const calls = await stubLive(page);
  await page.route("**/api/agent/jobs/*", (route) => json(route, fixture.compare.view));
  await startLarkspur(page);
  await page.getByLabel(/Ask a research question about/u).fill("Compare Gravel Riding with Alpine Hiking and Mountain Town");
  await page.getByRole("button", { name: "Ask the agent" }).click();
  await page.getByRole("treeitem", { name: /Territory: Mountain Town/u }).click();
  await page.getByRole("button", { name: "Investigate Mountain Town further" }).click();
  await expect(page.getByTestId("network-node-inquiry")).toHaveCount(2);
  expect(calls.questions[1]).toEqual({ query: "How far can Larkspur Velo extend into Mountain Town?", brand: "Larkspur Velo" });
  await expect(page.getByRole("treeitem", { name: /Direction: Mountain Town/u })).toHaveCount(0);
});

test("SYNTHETIC cards on different branches that share Qloo identifiers are tied, and the dossier says what they share", async ({ page }) => {
  await stubLive(page);
  // The second SYNTHETIC answer is about another territory represented by the same SYNTHETIC example entities.
  const other = structuredClone(fixture.parent.view) as { response: { territories: { name: string; territoryKey: string }[]; investigation: { result: { territories: { key: string; label: string; resolvedConcept: unknown }[] } } } };
  other.response.territories = other.response.territories.map((item) => ({ ...item, name: "Trail Running", territoryKey: "trail_running" }));
  other.response.investigation.result.territories = other.response.investigation.result.territories.map((item) => ({ ...item, key: "trail_running", label: "Trail Running", resolvedConcept: null }));
  await page.route("**/api/agent/jobs/*", (route) => json(route, route.request().url().endsWith("000000000001") ? fixture.parent.view : other));
  await startLarkspur(page);
  await page.getByLabel(/Ask a research question about/u).fill("How far can Larkspur Velo extend into Gravel Riding?");
  await page.getByRole("button", { name: "Ask the agent" }).click();
  await expect(page.getByTestId("network-node-inquiry")).toHaveCount(1);
  await page.getByRole("treeitem", { name: /Direction: Slow Touring/u }).click();
  await page.getByLabel(/Ask about/u).fill("How far can Larkspur Velo extend into Trail Running?");
  await page.getByRole("button", { name: "Ask the agent" }).click();
  await expect(page.getByTestId("network-tie")).toHaveCount(1);
  await page.getByRole("treeitem", { name: /Territory: Trail Running/u }).click();
  await expect(page.getByTestId("network-shared").getByRole("button", { name: "Gravel Riding" })).toBeVisible();
  await expect(page.getByTestId("network-shared")).toContainText("not a similarity score");
});

test("SYNTHETIC a broad question stays on the brand and a later question about one of its finds grows from that card", async ({ page }) => {
  await stubLive(page);
  const broad = structuredClone(fixture.compare.view) as { response: { handoff: { intent: string } | null } };
  if (broad.response.handoff) broad.response.handoff.intent = "explore_frontier";
  await page.route("**/api/agent/jobs/*", (route) => json(route, route.request().url().endsWith("000000000001") ? broad : fixture.parent.view));
  await startLarkspur(page);
  await page.getByLabel(/Ask a research question about/u).fill("Where could Larkspur Velo go next outdoors?");
  await page.getByRole("button", { name: "Ask the agent" }).click();
  await expect(page.getByTestId("network-node-finding")).toHaveCount(3);
  await page.getByRole("treeitem", { name: /Brand: Larkspur Velo/u }).click();
  await page.getByLabel(/Ask a research question about/u).fill("How far can Larkspur Velo extend into Gravel Riding?");
  await page.getByRole("button", { name: "Ask the agent" }).click();
  await expect(page.getByTestId("network-node-inquiry")).toHaveCount(2);
  await expect(page.getByRole("treeitem", { name: /New direction/u })).toHaveCount(0);
});

test("SYNTHETIC a connection opens as its own card, proposes questions, and its questions branch from it", async ({ page }) => {
  const calls = await stubLive(page);
  const other = structuredClone(fixture.parent.view) as { response: { territories: { name: string; territoryKey: string }[]; investigation: { result: { territories: { key: string; label: string; resolvedConcept: unknown }[] } } } };
  other.response.territories = other.response.territories.map((item) => ({ ...item, name: "Trail Running", territoryKey: "trail_running" }));
  other.response.investigation.result.territories = other.response.investigation.result.territories.map((item) => ({ ...item, key: "trail_running", label: "Trail Running", resolvedConcept: null }));
  await page.route("**/api/agent/jobs/*", (route) => json(route, route.request().url().endsWith("000000000001") ? fixture.parent.view : other));
  await startLarkspur(page);
  await page.getByLabel(/Ask a research question about/u).fill("How far can Larkspur Velo extend into Gravel Riding?");
  await page.getByRole("button", { name: "Ask the agent" }).click();
  await expect(page.getByTestId("network-node-inquiry")).toHaveCount(1);
  await page.getByRole("treeitem", { name: /Direction: Slow Touring/u }).click();
  await page.getByLabel(/Ask about/u).fill("How far can Larkspur Velo extend into Trail Running?");
  await page.getByRole("button", { name: "Ask the agent" }).click();
  const tie = page.getByRole("button", { name: /Explore the connection/u });
  await tie.focus();
  await tie.press("Enter");
  const bridge = page.getByRole("treeitem", { name: /Connection: .*Gravel Riding.*Trail Running|Connection: .*Trail Running.*Gravel Riding/u });
  await expect(bridge).toBeVisible();
  const questions = page.getByTestId("network-connection-questions");
  await expect(questions).not.toContainText("Where could");
  await questions.getByRole("button", { name: /^Compare / }).click();
  await expect(page.getByTestId("network-node-inquiry")).toHaveCount(3);
  // The answer is about one of the connection's ends, which is never repeated as a new card under the question.
  await expect(page.getByRole("treeitem", { name: /Territory: Trail Running/u })).toHaveCount(1);
  const asked = calls.questions[2] as { query: string; brand: string; context?: unknown };
  expect(asked.query).toMatch(/^Compare (Gravel Riding with Trail Running|Trail Running with Gravel Riding) for Larkspur Velo$/u);
  expect(asked).toEqual({ query: asked.query, brand: "Larkspur Velo" });
  // The new question hangs from the connection card, which stays on the board after the selection moves on.
  await page.getByRole("treeitem", { name: /Brand: Larkspur Velo/u }).click();
  await expect(bridge).toBeVisible();
  await expect(page.getByTestId("network-tie")).toHaveCount(0);
});

test("SYNTHETIC the brand box suggests your research and recorded brands as you type, without calling Qloo", async ({ page }) => {
  await stubLive(page);
  await startLarkspur(page);
  await page.getByRole("button", { name: "Research library" }).click();
  const resolves: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/brands/resolve")) resolves.push(request.url()); });
  const box = page.getByRole("combobox", { name: "Brand name" });
  await box.fill("lark");
  const list = page.getByTestId("brand-suggestions");
  await expect(list.getByRole("option")).toHaveCount(2);
  await expect(list.getByRole("option").first()).toContainText("Larkspur Velo");
  await expect(list.getByRole("option").first()).toContainText("Your research");
  await expect(list.getByRole("option").last()).toContainText("Find “lark” in Qloo");
  await box.fill("loe");
  await expect(list.getByRole("option").first()).toContainText("Recorded research");
  await box.fill("lark");
  await box.press("ArrowDown");
  await box.press("Enter");
  await expect(page.getByTestId("research-network")).toBeVisible();
  expect(resolves).toEqual([]);
});
