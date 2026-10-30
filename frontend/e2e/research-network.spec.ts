/**
 * The unified research network in the browser. Every live response is SYNTHETIC (backend/tests/fixtures/synthetic/
 * comparative-e2e.json). No test here
 * reaches Qloo or a model.
 */
import { readFileSync } from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";

type Fixture = { baseline: { scanId: string; scanStatus: string }; parent: { created: { jobId: string }; view: unknown }; compare: { view: unknown } };
const fixture = JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/synthetic/comparative-e2e.json", import.meta.url), "utf8")) as Fixture;
const json = (route: Route, value: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });

async function stubLive(page: Page, baseline: unknown = fixture.baseline, status: () => unknown = () => ({ enabled: true, semantics: "baseline_admission_only" })) {
  const calls = { handoffs: [] as unknown[], questions: [] as unknown[] };
  await page.route("**/api/agent/admissions", (route) => json(route, { status: "accepting" }));
  await page.route("**/api/brands/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/brands/status") return json(route, status());
    if (path === "/api/brands/resolve") return json(route, { resolutionId: "00000000-0000-4000-8000-000000000030", accessToken: "syn-token", status: "RESOLVED", entity: { qlooId: "SYN-BR-3001", label: "Larkspur Velo" } });
    if (path === "/api/brands/baselines" && route.request().method() === "POST") return json(route, { scanId: fixture.baseline.scanId, scanStatus: "QUEUED", reused: false, cached: false }, 202);
    if (path === `/api/brands/baselines/${fixture.baseline.scanId}`) return json(route, { scanStatus: fixture.baseline.scanStatus, providerCallCount: 2, stages: [{ stage: "tags", status: "COMPLETE" }], result: baseline });
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
  await page.getByRole("combobox", { name: "Brand name" }).fill("Larkspur Velo");
  await page.getByRole("button", { name: "Find brand" }).click();
  await page.getByRole("button", { name: /Start research/u }).click();
  await expect(page.getByTestId("research-network")).toBeVisible();
}

test("SYNTHETIC research opens as a network: brand, directions, a direction dossier, and no agent call", async ({ page }) => {
  const calls = await stubLive(page);
  await startLarkspur(page);
  await expect(page.getByTestId("network-node-brand")).toHaveCount(1);
  await expect(page.getByTestId("network-node-direction").first()).toBeVisible();
  await expect(page.getByTestId("network-dossier")).toContainText("Cultural fingerprint");
  await page.getByRole("treeitem", { name: /Direction: Slow Touring/u }).click();
  const dossier = page.getByTestId("network-dossier");
  await expect(dossier.getByRole("heading", { name: "Why it is here" })).toBeVisible();
  await expect(dossier.getByTestId("network-elasticity")).toContainText("Not measured yet");
  await expect(page.getByTestId("network-node-connection").first()).toBeVisible();
  await expect(page.getByText("distance on the board is not cultural distance")).toBeVisible();
  expect([...calls.handoffs, ...calls.questions]).toEqual([]);
});

test("SYNTHETIC tapping a tag drafts a question about it into the composer and sends nothing", async ({ page }) => {
  const calls = await stubLive(page);
  await startLarkspur(page);
  await page.getByTestId("network-dossier").getByTestId("tag-chip").filter({ hasText: "Slow Touring" }).first().click();
  await expect(page.getByLabel(/Ask a research question about/u)).toHaveValue("How far can Larkspur Velo extend into Slow Touring?");
  await expect(page.getByLabel(/Ask a research question about/u)).toBeFocused();
  expect([...calls.handoffs, ...calls.questions]).toEqual([]);
});

test("SYNTHETIC investigating a direction attaches the agent's validated result to it", async ({ page }) => {
  const calls = await stubLive(page);
  await startLarkspur(page);
  await page.getByRole("treeitem", { name: /Direction: Slow Touring/u }).click();
  await page.getByTestId("network-investigate").click();
  await expect(page.getByTestId("network-node-inquiry")).toHaveCount(1);
  // Sprint 12: the research conclusion leads; the missing comparison is stated in its own, later section.
  const reading = page.getByTestId("network-dossier").getByTestId("network-reading");
  await expect(reading.getByTestId("research-conclusion")).toBeVisible();
  await expect(reading.getByTestId("evidence-measurement")).toBeVisible();
  await expect(reading.getByTestId("network-verdict")).toContainText("Not established comparatively");
  expect(await reading.evaluate((root) => {
    const order = ["research-conclusion", "evidence-measurement", "network-elasticity"].map((id) => root.querySelector(`[data-testid="${id}"]`));
    return order.every((el, i) => el && (i === 0 || Boolean(order[i - 1]!.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)));
  })).toBe(true);
  await expect(reading.getByTestId("decision-finding")).not.toContainText(/^Not measured/u);
  expect(calls.handoffs).toHaveLength(1);
  const body = calls.handoffs[0] as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(["idempotencyKey", "scanId", "territoryId"]);
  expect(page.url()).not.toContain("syn-token");
  // Sprint 9L: an unmeasured reading offers one click that can measure it; nothing is left inconclusive without a next step.
  await page.getByTestId("network-measure").click();
  await expect(page.getByTestId("network-node-inquiry")).toHaveCount(2);
  expect((calls.questions.at(-1) as { query: string }).query).toBe("How far can Larkspur Velo extend into Slow Touring?");
});

test("SYNTHETIC an unsupported question is not an investigation: it says no credit was used and re-reads the allowance", async ({ page }) => {
  let statusReads = 0;
  await stubLive(page, fixture.baseline, () => { statusReads += 1; return { enabled: true, semantics: "baseline_admission_only" }; });
  // SYNTHETIC: the gate's answer to a bridge question (no investigation was started).
  const base = fixture.parent.view as { response: Record<string, unknown> & { interpretation: Record<string, unknown> } };
  const unsupported = { ...base, status: "completed", response: { ...base.response, state: "UNSUPPORTED_OPERATION", investigation: null, territories: [], reasons: [{ code: "UNSUPPORTED_OPERATION", detail: "bridge_builder is recognized but not implemented" }], interpretation: { ...base.response.interpretation, primaryIntent: "bridge_builder", unsupportedCapabilities: ["bridge_builder"] } } };
  await page.route("**/api/agent/jobs/*", (route) => json(route, unsupported));
  await startLarkspur(page);
  const before = statusReads;
  await page.getByLabel(/Ask a research question about/u).fill("What connects Larkspur Velo with Syn Artist?");
  await page.getByRole("button", { name: "Ask the agent" }).click();
  await expect(page.getByTestId("inquiry-no-credit")).toContainText("used no investigation credit");
  await expect(page.getByTestId("network-dossier")).not.toContainText("Investigated");
  // Once at the start and once when the answer settles.
  await expect.poll(() => statusReads - before).toBeGreaterThanOrEqual(2);
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
  await page.getByTestId("network-home").click();
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

test("SYNTHETIC the zoom controls zoom the board and fit it again", async ({ page }) => {
  await stubLive(page);
  await startLarkspur(page);
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

test("SYNTHETIC cards can be dragged with their branch, the arrangement is kept, and Tidy restores it", async ({ page }) => {
  await stubLive(page);
  await startLarkspur(page);
  await page.getByTestId("network-dossier").getByRole("heading").first().waitFor();
  const card = page.getByRole("treeitem", { name: /Direction: Slow Touring/u });
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
  await expect(page.getByTestId("network-dossier").getByTestId("research-conclusion-label")).toHaveText("Limited evidence");
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

test("SYNTHETIC the brand box suggests your research as you type, without calling Qloo", async ({ page }) => {
  await stubLive(page);
  await startLarkspur(page);
  await page.getByTestId("network-home").click();
  const resolves: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/brands/resolve")) resolves.push(request.url()); });
  const box = page.getByRole("combobox", { name: "Brand name" });
  await box.fill("lark");
  const list = page.getByTestId("brand-suggestions");
  await expect(list.getByRole("option")).toHaveCount(2);
  await expect(list.getByRole("option").first()).toContainText("Larkspur Velo");
  await expect(list.getByRole("option").first()).toContainText("Your research");
  await expect(list.getByRole("option").last()).toContainText("Find “lark” in Qloo");
  // Nothing of yours matches: the list stays closed and Find brand does the search.
  await box.fill("zzz");
  await expect(list).toHaveCount(0);
  await box.fill("lark");
  await box.press("ArrowDown");
  await box.press("Enter");
  await expect(page.getByTestId("research-network")).toBeVisible();
  expect(resolves).toEqual([]);
});

test("SYNTHETIC Sprint 10A: the scan's cross-domain signals can be explored with the agent, only on request", async ({ page }) => {
  // SYNTHETIC: the fixture's baseline plus one related artist observed by a recommend call of the scan.
  const baseline = structuredClone(fixture.baseline) as unknown as { fingerprint: { signals: unknown[]; provenance: { correlationId: string; sourceId: string }[] } };
  const source = { operation: "recommend", correlationId: "syn-10a-artists", sourceId: "SYN-AR-10A9", capturedAt: "2026-10-29T00:00:00.000Z", sourceStatus: "ok", scope: "artist" };
  baseline.fingerprint.signals.push({ id: "SYN-AR-10A9", name: "SYNTHETIC Cellar Band", kind: "entity", domain: "artist", source, rankWithinCall: 1, grounding: { typeEvidence: "QUERY_SCOPED", providerType: null, providerSubtype: null, requestedType: "urn:entity:artist", scopeBasis: "RECORDED_PROVIDER_REQUEST" } });
  baseline.fingerprint.provenance.push(source);
  const calls = await stubLive(page, baseline);
  await startLarkspur(page);
  const explore = page.getByTestId("network-explore-signals");
  await expect(explore).toContainText("starting points, not evidence of a fit");
  expect(calls.handoffs).toEqual([]);
  await explore.getByRole("button", { name: "Explore these signals with the agent" }).click();
  await expect(page.getByTestId("network-node-inquiry")).toHaveCount(1);
  expect(calls.handoffs).toHaveLength(1);
  const body = calls.handoffs[0] as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(["explore", "idempotencyKey", "scanId"]);
  expect(body.explore).toBe(true);
  await expect(page.getByTestId("network-dossier")).toContainText("Agent exploration");
});

// Hotfix: SYNTHETIC per-caller eligibility, as `/api/brands/status` reports it for a public-evaluation visitor.
const allowance = (investigationsUsed: number, scansUsed = 1) => ({ endsAt: "2026-11-06T05:00:00.000Z", searches: { used: 1, limit: 20 }, scans: { used: scansUsed, limit: 8 }, investigations: { used: investigationsUsed, limit: 12 } });
const eligible = (newBrandResearch: string, investigations: string, used = 4, scansUsed = 1) => ({ enabled: true, admissionsOpen: true, operator: "authorized", semantics: "baseline_admission_for_caller", research: { newBrandResearch, investigations, allowance: allowance(used, scansUsed) } });

test("SYNTHETIC HOTFIX the homepage shows this network's allowance left and still lets a raised allowance start", async ({ page }) => {
  await stubLive(page, fixture.baseline, () => eligible("available", "available", 4));
  await page.goto("/");
  await expect(page.getByTestId("research-availability")).toContainText("New brand research available.");
  await expect(page.getByTestId("public-allowance")).toContainText("7 of 8 brand research runs, 8 of 12 investigations and 19 of 20 brand searches left, until 6 Nov 2026, 05:00 UTC");
  await expect(page.getByRole("button", { name: "Find brand" })).toBeEnabled();
});

test("SYNTHETIC HOTFIX a used brand research allowance says so on the homepage and disables the search", async ({ page }) => {
  await stubLive(page, fixture.baseline, () => eligible("visitor_allowance_used", "available", 4, 8));
  await page.goto("/");
  await expect(page.getByTestId("research-availability")).toContainText("This network has used its brand research allowance.");
  await expect(page.getByText("New brand research available.")).toHaveCount(0);
  await page.getByRole("combobox", { name: "Brand name" }).fill("Larkspur Velo");
  await expect(page.getByRole("button", { name: "Find brand" })).toBeDisabled();
});

test("SYNTHETIC HOTFIX a used investigation allowance replaces Measure cultural fit with the reason and turns the composer off", async ({ page }) => {
  const calls = await stubLive(page, fixture.baseline, () => eligible("available", "visitor_allowance_used", 12));
  await startLarkspur(page);
  await page.getByRole("treeitem", { name: /Direction: Slow Touring/u }).click();
  await expect(page.getByTestId("network-investigate")).toHaveCount(0);
  await expect(page.getByTestId("network-investigate-blocked")).toContainText("This network has used its investigation allowance");
  await expect(page.getByTestId("network-live-note")).toContainText("This network has used its investigation allowance");
  await expect(page.getByLabel(/Ask about/u)).toBeDisabled();
  expect([...calls.handoffs, ...calls.questions]).toEqual([]);
});

test("SYNTHETIC HOTFIX a server 429 shows its own reason and the controls follow the re-read status", async ({ page }) => {
  // The status changes only once the server has refused, however often the page reads it before that.
  let refused = false;
  await stubLive(page, fixture.baseline, () => (refused ? eligible("available", "visitor_allowance_used", 12) : eligible("available", "available", 11)));
  await page.route("**/api/research/handoff/jobs", (route) => { refused = true; return json(route, { error: "visitor_quota_reached", message: "This network has used its allowance of 12 investigations for this evaluation, which runs until 6 Nov 2026, 05:00 UTC. Saved research and the recorded example remain available." }, 429); });
  await startLarkspur(page);
  await page.getByRole("treeitem", { name: /Direction: Slow Touring/u }).click();
  await page.getByTestId("network-investigate").click();
  await expect(page.getByTestId("network-composer").getByRole("alert")).toContainText("This network has used its allowance of 12 investigations");
  await expect(page.getByTestId("network-investigate")).toHaveCount(0);
  await expect(page.getByTestId("network-investigate-blocked")).toBeVisible();
});

test("SYNTHETIC HOTFIX a shared-budget 429 is not reported as the visitor's allowance", async ({ page }) => {
  await stubLive(page, fixture.baseline, () => eligible("available", "available", 2));
  await page.route("**/api/research/handoff/jobs", (route) => json(route, { error: "budget_exhausted" }, 429));
  await startLarkspur(page);
  await page.getByRole("treeitem", { name: /Direction: Slow Touring/u }).click();
  await page.getByTestId("network-investigate").click();
  await expect(page.getByTestId("network-composer").getByRole("alert")).toContainText("shared research budget");
  await expect(page.getByTestId("network-composer").getByRole("alert")).not.toContainText("allowance");
});
