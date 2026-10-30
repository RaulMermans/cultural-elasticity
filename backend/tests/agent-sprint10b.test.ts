/**
 * Sprint 10B: focus.withdrawn and the per-turn focus trace, and the decision-point evaluation harness.
 *
 * Live Haiku traces show the model calling tools a skill no longer offered once that skill closed (build_comparison_set
 * after the set was complete or infeasible; explore_candidate_territories while proposed candidates were pending).
 * focus.withdrawn states which just-withdrawn tools are closed and why, from the skill's declared preconditions. It
 * never changes exposure: the executor still refuses an unexposed tool. SYNTHETIC world (SYN- ids); not Qloo evidence.
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { auditRuns } from "../scripts/competence/audit.js";
import { CHECKS, loadDecisionManifest, runDecisionCase, wilson, type DecisionCase } from "../scripts/competence/decisions.js";

const { manifest, scenarios } = loadDecisionManifest();
const caseById = (id: string) => manifest.cases.find((c) => c.id === id)!;
const run = (c: DecisionCase, withdrawnToolNotes: boolean, policy: Parameters<typeof runDecisionCase>[3] = "reference") =>
  runDecisionCase(c, scenarios.get(c.scenario)!, { name: withdrawnToolNotes ? "new" : "before", withdrawnToolNotes }, policy, () => {
    throw new Error("no model in tests");
  });

describe("focus.withdrawn (Sprint 10B)", () => {
  it("names the comparison tools once the set is complete and build_comparison_set has closed", async () => {
    const { context } = await run(caseById("d20-set-complete-analyze"), true);
    const note = context!.focus!.withdrawn!.find((w) => w.includes("build_comparison_set closed"));
    expect(note).toMatch(/propose_territory/u);
    expect(note).toMatch(/now entityType brand, size 3/u);
    for (const w of context!.focus!.withdrawn!) for (const tool of w.split(":")[0]!.split(", ")) expect(context!.focus!.nextAllowed).not.toContain(tool);
  });

  it("names propose_territory while explore_candidate_territories is closed with candidates pending", async () => {
    const { context } = await run(caseById("d36-explore-closed-no-propose"), true);
    expect(context!.focus!.withdrawn!.some((w) => /propose_territory.*explore_candidate_territories closed \(now viable \d+, target \d+/u.test(w))).toBe(true);
  });

  it("is absent in the before arm, and the arms are otherwise the same context", async () => {
    const c = caseById("d22-infeasible-analyze");
    const before = (await run(c, false)).context!;
    const after = (await run(c, true)).context!;
    expect(before.focus!.withdrawn).toBeUndefined();
    expect(after.focus!.withdrawn?.length).toBeGreaterThan(0);
    const { withdrawn: _w, ...focusAfter } = after.focus!;
    expect(focusAfter).toEqual(before.focus);
    expect(after.tools).toEqual(before.tools);
  });

  it("does not appear before any skill has closed, and lists each tool at most once", async () => {
    const { response } = await run(caseById("d24-finish-when-sufficient"), true);
    const turns = response.trace.turns;
    expect(turns[0]!.focus?.withdrawn).toBeUndefined();
    for (const t of turns) expect(new Set(t.focus?.withdrawn ?? []).size).toBe((t.focus?.withdrawn ?? []).length);
  });

  it("records the decision's focus in every turn trace (observability)", async () => {
    const { response } = await run(caseById("d13-complete-feasible-set"), true);
    for (const t of response.trace.turns) {
      expect(t.focus?.stage).toBeTruthy();
      expect(t.focus!.outstanding.length).toBeLessThanOrEqual(3);
    }
    expect(response.trace.turns.some((t) => t.focus?.feasibility === "FEASIBLE")).toBe(true);
  });
});

describe("decision-point evaluation harness (Sprint 10B)", () => {
  it("reaches the decision point and hands exactly that turn (with its bounded repair) to the tested policy", async () => {
    const { row, context, response } = await run(caseById("d20-set-complete-analyze"), true, "instrument:eager-finish");
    expect(row.reached).toBe(true);
    const tested = response.trace.turns.find((t) => t.iteration === context!.iteration)!;
    // The finish is refused (nothing analyzed yet); the repair attempt stays with the tested policy, which finishes again.
    expect(tested.decisions.every((d) => d.action === "finish" && !d.accepted)).toBe(true);
    expect(tested.modelAttempts).toBe(2);
    // With no material gap left, the runtime analyzes itself; the comparison stays FULL.
    expect(response.trace.errors.some((e) => e.code === "RUNTIME_ANALYZED_NO_MATERIAL_GAP" && e.iteration === context!.iteration)).toBe(true);
    expect(row.outcome.fullTerritories).toBeGreaterThan(0);
    expect(row.correct).toBe(false);
    expect(row.badHits).toContain("finish");
  });

  it("scores the reference policy correct where it follows the focus", async () => {
    const { row } = await run(caseById("d13-complete-feasible-set"), false);
    expect(row).toMatchObject({ reached: true, correct: true, goodMet: true, badHits: [] });
  });

  it("names no brand, territory or id in any case (generic predicates only)", () => {
    for (const c of manifest.cases) expect(JSON.stringify({ at: c.at, good: c.good, bad: c.bad })).not.toMatch(/SYN-|urn:/u);
    for (const p of manifest.cases.flatMap((c) => [...(c.good ?? []), ...(c.bad ?? [])])) if (p.check) expect(Object.keys(CHECKS)).toContain(p.check);
  });

  it("keeps a frozen holdout split", () => {
    expect(manifest.cases.filter((c) => c.split === "holdout").length).toBeGreaterThanOrEqual(12);
  });

  it("reports Wilson intervals", () => {
    const [lo, hi] = wilson(9, 10);
    expect(lo).toBeCloseTo(0.596, 2);
    expect(hi).toBeCloseTo(0.982, 2);
  });
});

describe("decision-quality audit (Sprint 10B)", () => {
  // Stored live artefacts committed by Sprint 9G (recorded Haiku runs, read as run; never re-executed).
  const dir = fileURLToPath(new URL("../../evals/qloo-value/artifacts", import.meta.url));

  it("reads only LLM-driven runs and attributes refusals and empty probes to a cause", () => {
    const a = auditRuns([dir]);
    expect(a.runs).toBeGreaterThan(0);
    expect(a.accepted).toBeLessThanOrEqual(a.decisions);
    const closed = a.rows.find((r) => r.label === "BAD_TOOL_SELECTION" && r.cause === "CONTEXT");
    expect(closed?.n).toBeGreaterThan(0);
    const followed = a.probes.followed;
    expect(followed[0]).toBeLessThanOrEqual(followed[1]);
    expect(a.rows.every((r) => r.n > 0)).toBe(true);
  });
});
