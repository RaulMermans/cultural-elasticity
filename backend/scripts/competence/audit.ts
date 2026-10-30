/**
 * Sprint 10B decision-quality audit (`pnpm eval:competence -- --audit <dir> [<dir> …] [--json file]`).
 *
 * Reads stored agent results (*.json, recursively) and groups what went wrong in the LLM-driven runs by the Sprint 10B
 * taxonomy and by cause (model decision, context, deterministic policy, Qloo data, infrastructure). Files only: no
 * provider call, and nothing read is relabelled (an old engine's trace is reported as that engine's). A run driven by
 * the baseline or a script is skipped: it says nothing about a model's decisions.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentAnalysisResult } from "@cultural-elasticity/shared";

type Cause = "MODEL_DECISION" | "CONTEXT" | "DETERMINISTIC_POLICY" | "QLOO_DATA" | "INFRASTRUCTURE";
type Finding = { label: string; cause: Cause; note: string };

/** Refusal code → (taxonomy label, cause). Refusals cost a decision (and a repair call), never a Qloo call. */
const REFUSALS: Record<string, Finding> = {
  NOT_EXPOSED: { label: "BAD_TOOL_SELECTION", cause: "CONTEXT", note: "tool of a skill that had closed (focus gave no reason before Sprint 10B)" },
  UNKNOWN_TOOL: { label: "BAD_TOOL_SELECTION", cause: "MODEL_DECISION", note: "tool that does not exist" },
  WRONG_PHASE: { label: "BAD_TOOL_SELECTION", cause: "MODEL_DECISION", note: "tool outside its phase" },
  INVALID_MODEL_OUTPUT: { label: "MODEL_OUTPUT_INVALID", cause: "MODEL_DECISION", note: "unparseable or schema-invalid turn" },
  INVALID_ARGUMENTS: { label: "MODEL_OUTPUT_INVALID", cause: "MODEL_DECISION", note: "arguments failed the tool schema" },
  INVALID_DECISION: { label: "MODEL_OUTPUT_INVALID", cause: "MODEL_DECISION", note: "decision failed the decision schema" },
  DUPLICATE_ACTION: { label: "UNNECESSARY_CONTINUATION", cause: "MODEL_DECISION", note: "exact repeat of a call already made" },
  NO_VALUE_ACTION: { label: "UNNECESSARY_CONTINUATION", cause: "MODEL_DECISION", note: "call that could not change the result" },
  EARLY_STOP: { label: "UNNECESSARY_CONTINUATION", cause: "MODEL_DECISION", note: "call after its evidence was already complete" },
  COMPARISON_INFEASIBLE: { label: "UNNECESSARY_CONTINUATION", cause: "MODEL_DECISION", note: "reference call after FULL became infeasible" },
  PROBE_LIMIT_REACHED: { label: "INVALID_ENTITY_TYPE", cause: "MODEL_DECISION", note: "probe past the empty-type bound" },
  NAMESPACE_TYPE_BARREN: { label: "INVALID_ENTITY_TYPE", cause: "MODEL_DECISION", note: "type already barren in the namespace" },
  ALTERNATE_ANCHOR_REFUSED: { label: "SEMANTIC_MISMATCH", cause: "MODEL_DECISION", note: "anchor to a different concept than the candidate's" },
  REFERENCE_NAMESPACE_BARREN: { label: "UNPRODUCTIVE_REFERENCE", cause: "MODEL_DECISION", note: "reference from a namespace barren for the type" },
  REFERENCE_PROBE_LIMIT: { label: "UNPRODUCTIVE_REFERENCE", cause: "MODEL_DECISION", note: "reference probe past the bound" },
  FINISH_BEFORE_SUFFICIENCY: { label: "PREMATURE_STOP", cause: "MODEL_DECISION", note: "finish with an unresolved blocker (refused)" },
  NOTHING_ANALYZED: { label: "PREMATURE_STOP", cause: "MODEL_DECISION", note: "finish before any analysis (refused)" },
  REFERENCES_PENDING: { label: "PREMATURE_STOP", cause: "MODEL_DECISION", note: "analysis while references were still obtainable (deferred)" },
  SKILL_BUDGET_EXHAUSTED: { label: "BUDGET_EXHAUSTED", cause: "DETERMINISTIC_POLICY", note: "skill budget spent" },
};

type ProbeRec = { iteration: number; conceptKey: string; type: string; priority: string };
type Run = AgentAnalysisResult & { trace: AgentAnalysisResult["trace"] & { probeRecommendations?: ProbeRec[]; completion?: { iteration: number; fullAnalysisFeasible?: boolean }[] } };

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : f.endsWith(".json") ? [p] : [];
  });
}

function load(dirs: readonly string[]): Run[] {
  const seen = new Set<string>();
  return dirs.flatMap(files).flatMap((p) => {
    let v: unknown;
    try {
      v = JSON.parse(readFileSync(p, "utf8"));
    } catch {
      return [];
    }
    const r = v as Partial<Run>;
    if (!r || typeof r !== "object" || !r.trace?.turns || r.model?.kind !== "llm" || !r.runId || seen.has(r.runId)) return [];
    seen.add(r.runId);
    return [r as Run];
  });
}

export function auditRuns(dirs: readonly string[]) {
  const runs = load(dirs);
  const counts = new Map<string, { label: string; cause: Cause; note: string; n: number }>();
  const add = (f: Finding, n = 1) => {
    const key = `${f.label}|${f.cause}|${f.note}`;
    const e = counts.get(key) ?? { ...f, n: 0 };
    e.n += n;
    counts.set(key, e);
  };
  let decisions = 0;
  let accepted = 0;
  let turns = 0;
  let firstValid = 0;
  const probes = { followed: [0, 0], deviated: [0, 0], unranked: [0, 0], unrecorded: [0, 0] } as Record<"followed" | "deviated" | "unranked" | "unrecorded", [number, number]>;
  let prematureStops = 0;
  let nonFullTargets = 0;
  for (const r of runs) {
    const t = r.trace;
    for (const turn of t.turns) {
      turns += 1;
      if (turn.firstAttemptValid) firstValid += 1;
      for (const d of turn.decisions) {
        decisions += 1;
        if (d.accepted) accepted += 1;
        else if (d.rejection) add(REFUSALS[d.rejection.split(":")[0]!] ?? { label: "OTHER_REFUSAL", cause: "MODEL_DECISION", note: d.rejection.split(":")[0]! });
      }
    }
    const recs = t.probeRecommendations ?? [];
    for (const c of t.toolCalls) {
      const a = (c.arguments ?? {}) as { tagIds?: string[]; targetType?: string; conditionOnBrand?: boolean };
      if (c.status === "failed") add({ label: "PROVIDER_FAILURE", cause: "INFRASTRUCTURE", note: "tool call failed (timeout, transport or contract)" });
      if (c.tool !== "qloo_recommend" || a.conditionOnBrand !== false || (c.status !== "ok" && c.status !== "empty")) continue;
      // Recommendations are recorded before the turn counter moves, so a call at iteration i follows those of i − 1.
      const offered = recs.filter((p) => p.iteration === c.iteration - 1);
      const kind = recs.length === 0 ? "unrecorded" : offered.some((p) => a.tagIds?.[0] === p.conceptKey && a.targetType === p.type) ? "followed" : offered.length > 0 ? "deviated" : "unranked";
      probes[kind][1] += 1;
      if (c.status === "empty") probes[kind][0] += 1;
    }
    const target = r.territories?.find((x) => x.role === "target");
    if (target && target.analysisRoute !== "FULL_RELATIVE_ANALYSIS" && t.completion?.length) {
      nonFullTargets += 1;
      if (t.completion.at(-1)!.fullAnalysisFeasible) prematureStops += 1;
    }
    if (r.status === "BUDGET_EXHAUSTED") add({ label: "BUDGET_EXHAUSTED", cause: "DETERMINISTIC_POLICY", note: "run ended on its budget" });
  }
  add({ label: "QLOO_DATA_INSUFFICIENT", cause: "QLOO_DATA", note: "empty probe that followed the runtime's evidence-ranked nextProbe" }, probes.followed[0]);
  add({ label: "INVALID_ENTITY_TYPE", cause: "MODEL_DECISION", note: "empty probe of a (tag, type) the runtime did not recommend that turn" }, probes.deviated[0]);
  add({ label: "UNPRODUCTIVE_REFERENCE", cause: "DETERMINISTIC_POLICY", note: "empty probe with no ranked recommendation that turn (reference / representation probes)" }, probes.unranked[0]);
  add({ label: "UNATTRIBUTED_EMPTY_PROBE", cause: "DETERMINISTIC_POLICY", note: "empty probe in a run whose engine recorded no probe ranking (before Sprint 5A.2)" }, probes.unrecorded[0]);
  add({ label: "PREMATURE_STOP", cause: "MODEL_DECISION", note: "non-FULL target whose last completion record still said FULL was feasible" }, prematureStops);
  const rows = [...counts.values()].filter((e) => e.n > 0).sort((a, b) => b.n - a.n);
  return { runs: runs.length, turns, firstValid, decisions, accepted, probes, nonFullTargets, prematureStops, rows };
}

export function auditCli(argv: readonly string[]): number {
  const i = argv.indexOf("--audit");
  const dirs = argv.slice(i + 1).filter((a, k, all) => !a.startsWith("--") && all[k - 1] !== "--json");
  if (dirs.length === 0) throw new Error("--audit needs at least one directory of stored agent results");
  const a = auditRuns(dirs);
  const pct = (k: number, n: number) => (n ? `${((100 * k) / n).toFixed(0)}%` : "n/a");
  console.log(`Decision-quality audit of stored LLM runs (as run; files only, no provider call): ${a.runs} runs, ${a.turns} turns`);
  console.log(`  valid-action rate ${a.accepted}/${a.decisions} (${pct(a.accepted, a.decisions)}); first-attempt-valid turns ${a.firstValid}/${a.turns} (${pct(a.firstValid, a.turns)})`);
  for (const [k, [e, n]] of Object.entries(a.probes)) console.log(`  brand-independent probes ${k.padEnd(9)} ${e}/${n} empty (${pct(e, n)})`);
  console.log(`  non-FULL targets stopped while FULL was still feasible: ${a.prematureStops}/${a.nonFullTargets}`);
  console.log("  label                      cause                 count  note");
  for (const r of a.rows) console.log(`  ${r.label.padEnd(26)} ${r.cause.padEnd(21)} ${String(r.n).padStart(5)}  ${r.note}`);
  const byCause = new Map<string, number>();
  for (const r of a.rows) byCause.set(r.cause, (byCause.get(r.cause) ?? 0) + r.n);
  console.log(`  by cause: ${[...byCause].sort((x, y) => y[1] - x[1]).map(([c, n]) => `${c} ${n}`).join(", ")}`);
  const j = argv.indexOf("--json");
  if (j >= 0 && argv[j + 1]) writeFileSync(argv[j + 1]!, `${JSON.stringify({ schema: "ce-decision-audit/1", dirs, ...a }, null, 2)}\n`);
  return 0;
}
