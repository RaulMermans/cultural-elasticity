/**
 * Sprint 11 research-intelligence evaluation, tier T1 (pre-registered in evals/research-intelligence/cases.json).
 *
 *   pnpm eval:research-intelligence                      dry run: cases, gold checks and the spend ceiling; no provider call
 *   pnpm eval:research-intelligence -- --paired [--live --approved-qloo <N> --approved-usd <N> --out <dir>]
 *                                                        tier T2: paired A (v0) / B (v1) research runs on the holdouts with
 *                                                        shared Qloo recordings and a blinded rating sheet (dry run by default)
 *   pnpm eval:research-intelligence -- --live --approved-usd <N> --out <dir>
 *                                                        real Claude Haiku 5.5 interpretation (research policy v1) over the
 *                                                        development and holdout queries. No Qloo call. LIVE_HAIKU_INTERPRETATION:
 *                                                        never agent, Qloo or research-quality validation.
 *
 * Refuses (exit 4, no call) unless the owner-approved ceiling covers the worst case. Grading is deterministic and
 * reported per pre-registered criterion; the raw briefs are written for human review.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadLocalEnvFile } from "../src/config/env.js";
import { DEFAULT_AGENT_MODEL } from "../src/agent/model/anthropic.js";
import { AnthropicQueryInterpreter } from "../src/agent/query/interpreter.js";
import type { PairedCase } from "./research-intelligence/paired.js";
import { HAIKU_CONSERVATIVE, INTERPRET_MAX_OUTPUT_TOKENS, DEFAULT_INTERPRET_INPUT_TOKENS, priceUsd } from "../src/ops/pricing.js";

type Concept = { name: string; meaning: string; notEquivalent: string[] };
type Case = { id: string; brand: string; query: string; concepts: Concept[]; acceptableApproaches: string[]; structure?: string };
type Manifest = { development: Case[]; holdout: Case[]; thresholds: { interpretationTier: string } };

const CASES_PATH = fileURLToPath(new URL("../../evals/research-intelligence/cases.json", import.meta.url));
const manifest = JSON.parse(readFileSync(CASES_PATH, "utf8")) as Manifest;
const cases = [...manifest.development.map((c) => ({ ...c, split: "development" })), ...manifest.holdout.map((c) => ({ ...c, split: "holdout" }))];

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const live = process.argv.includes("--live");
// Worst case: one bounded repair per query (2 requests), each at the interpreter's input estimate and output ceiling.
const perRequestUsd = (DEFAULT_INTERPRET_INPUT_TOKENS * HAIKU_CONSERVATIVE.input + INTERPRET_MAX_OUTPUT_TOKENS * HAIKU_CONSERVATIVE.output) / 1_000_000;
const ceilingUsd = Number((cases.length * 2 * perRequestUsd).toFixed(4));

// ---- T2: paired A/B research runs on the holdouts (live Qloo + Haiku; owner approval required) ----
if (process.argv.includes("--paired")) {
  const { pairedBudget, runPaired } = await import("./research-intelligence/paired.js");
  const only = arg("--cases")?.split(",");
  const holdouts = (manifest.holdout as unknown as PairedCase[]).filter((c) => !only || only.includes(c.id));
  const budget = pairedBudget(holdouts);
  console.log(`Sprint 11 T2 — paired A (v0) / B (v1) on ${holdouts.length} holdout(s): ${budget.runs} runs, worst case ${budget.worstCaseQloo} Qloo dispatches (before shared recordings), model reservation ceiling $${budget.modelReserveUsd}.`);
  if (!live) {
    console.log("DRY RUN: no provider call. Re-run with --paired --live --approved-qloo <N> --approved-usd <N> --out <dir> [--cases ids] [--seed s] after owner approval.");
    process.exit(0);
  }
  loadLocalEnvFile();
  const approvedQloo = Number(arg("--approved-qloo"));
  const approvedUsd = Number(arg("--approved-usd"));
  const out = arg("--out");
  const missing = ["QLOO_API_KEY", "ANTHROPIC_API_KEY"].filter((k) => !process.env[k]?.trim());
  if (!out || !Number.isFinite(approvedQloo) || !Number.isFinite(approvedUsd) || approvedQloo <= 0 || approvedUsd <= 0 || missing.length) {
    console.error(`REFUSED: --out, --approved-qloo and --approved-usd are required${missing.length ? `; missing ${missing.join(", ")}` : ""}. No call was made.`);
    process.exit(4);
  }
  process.exit(await runPaired({ cases: holdouts, out, approvedQloo, approvedUsd, seed: arg("--seed") ?? "sprint-11" }));
}

const COMPOUND = new Set(["d2-vinted-repair-upcycling", "h06", "h07"]);
const NEAR_MATCH = new Set(["h08", "h09", "h10", "h18"]);

console.log(`Sprint 11 T1 — interpretation only (research policy v1). ${cases.length} queries (${manifest.development.length} development, ${manifest.holdout.length} holdout).`);
console.log(`Spend ceiling (conservative Haiku price, one repair each): $${ceilingUsd}. Qloo calls: 0.`);
if (!live) {
  console.log("DRY RUN: no provider call. Re-run with --live --approved-usd <N> --out <dir> after owner approval.");
  process.exit(0);
}
loadLocalEnvFile();
const approved = Number(arg("--approved-usd"));
const out = arg("--out");
if (!Number.isFinite(approved) || approved < ceilingUsd || !out) {
  console.error(`REFUSED: --approved-usd must cover the ceiling ($${ceilingUsd}) and --out is required. No call was made.`);
  process.exit(4);
}
if (!process.env.ANTHROPIC_API_KEY?.trim()) {
  console.error("REFUSED: ANTHROPIC_API_KEY is not set. LIVE_HAIKU_INTERPRETATION_NOT_RUN.");
  process.exit(4);
}

const interpreter = new AnthropicQueryInterpreter({ researchPolicy: "v1" });
mkdirSync(out, { recursive: true });
const rows: Record<string, unknown>[] = [];
let spent = 0;
for (const c of cases) {
  const outcome = await interpreter.interpret({ query: c.query, explicit: {}, context: null });
  const usd = priceUsd(DEFAULT_AGENT_MODEL, { uncachedInputTokens: outcome.usage.inputTokens, outputTokens: outcome.usage.outputTokens, cacheReadTokens: outcome.usage.cacheReadTokens ?? 0, cacheCreationTokens: outcome.usage.cacheCreationTokens ?? 0 }) ?? perRequestUsd * 2;
  spent += usd;
  const proposal = outcome.ok ? outcome.proposal : null;
  const brief = proposal?.researchBrief ?? null;
  const grades = {
    briefPresent: brief !== null,
    approachAcceptable: brief ? c.acceptableApproaches.includes(brief.approach) || (c.acceptableApproaches.includes("clarify") && Boolean(proposal?.clarificationQuestion)) : false,
    ...(COMPOUND.has(c.id) && { compoundSplit: (brief?.concepts.length ?? 0) >= c.concepts.length }),
    // Proxy for "states a notEquivalent distinction or ambiguity"; the human reviewer checks the text.
    ...(NEAR_MATCH.has(c.id) && { distinctionStated: Boolean(brief?.concepts.some((x) => x.notThis.length > 0)) || Boolean(proposal?.clarificationQuestion) }),
  };
  rows.push({ id: c.id, split: c.split, structure: c.structure ?? null, query: c.query, ok: outcome.ok, error: outcome.ok ? null : outcome.code, primaryIntent: proposal?.primaryIntent ?? null, territories: proposal?.territories ?? null, clarificationQuestion: proposal?.clarificationQuestion ?? null, researchBrief: brief, grades, usd: Number(usd.toFixed(6)), latencyMs: outcome.latencyMs });
  console.log(`${c.id.padEnd(30)} ${outcome.ok ? "ok " : "ERR"} ${JSON.stringify(grades)}`);
  if (spent > approved) {
    console.error(`STOPPED: observed spend $${spent.toFixed(4)} exceeded the approval. Later cases NOT_RUN.`);
    break;
  }
}
const pick = (key: string, ids: Set<string>) => rows.filter((r) => ids.has(r.id as string)).map((r) => (r.grades as Record<string, boolean>)[key]);
const compound = pick("compoundSplit", COMPOUND);
const near = pick("distinctionStated", new Set([...NEAR_MATCH].filter((id) => id.startsWith("h"))));
const verdict = {
  label: "LIVE_HAIKU_INTERPRETATION",
  notice: "Interpretation only. No Qloo call, no agent run: not agent, Qloo or research-quality validation.",
  model: DEFAULT_AGENT_MODEL,
  ran: rows.length,
  of: cases.length,
  observedUsd: Number(spent.toFixed(4)),
  preregistered: manifest.thresholds.interpretationTier,
  compoundSplit: `${compound.filter(Boolean).length}/${compound.length} (required: all)`,
  nearMatchDistinction: `${near.filter(Boolean).length}/${near.length} (required: ≥ 3 of 4)`,
  passed: compound.length === COMPOUND.size && compound.every(Boolean) && near.filter(Boolean).length >= 3,
};
writeFileSync(`${out}/t1-interpretation.json`, `${JSON.stringify({ verdict, rows }, null, 2)}\n`);
console.log(JSON.stringify(verdict, null, 2));
