/**
 * Sprint 12 research-completion replay (offline, no provider call). It projects STORED results through the production
 * decision card (before) and the Sprint 12 card and evidence assessment (after), case by case, from the same evidence.
 *
 *   pnpm --filter backend exec tsx scripts/eval-research-completion.ts \
 *     [--dir <stored results dir>]... [--baseline-shared <main's packages/shared/dist/index.js>] [--out <dir>]
 *
 * Inputs are results exactly as stored: the committed live artefacts in evals/qloo-value/artifacts and any --dir of
 * stored live results (e.g. a gitignored durable-live session). Results without Sprint 12 direct-evidence facts are
 * assessed from what the stored result shows (basis DERIVED_FROM_STORED_RESULT). Nothing is re-run, fetched or rewritten.
 * This is evidence about the projection's usefulness, never about Qloo or about live model behaviour.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assessResearch, decisionCard, decisionCardViolations, evidenceAssessmentViolations, type AgentAnalysisResult } from "@cultural-elasticity/shared";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const args = process.argv.slice(2);
const many = (flag: string) => args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1]!] : []));
const one = (flag: string, fallback: string | null = null) => many(flag)[0] ?? fallback;

const dirs = [join(root, "evals/qloo-value/artifacts"), ...many("--dir")];
const baselinePath = one("--baseline-shared", join(homedir(), "dev/ce-11/packages/shared/dist/index.js"))!;
const out = one("--out");

type Before = { finding: string; implication: string; next: string[] };

async function loadBaseline(): Promise<((r: AgentAnalysisResult, key: string) => Before | null) | null> {
  if (!existsSync(baselinePath)) return null;
  const mod = (await import(pathToFileURL(baselinePath).href)) as { decisionCard: (r: unknown, k: string, c?: unknown) => { finding: string; implication: { label: string }; nextActions: { kind: string; text: string }[] } | null };
  return (r, key) => {
    const card = mod.decisionCard(r, key);
    return card ? { finding: card.finding, implication: card.implication.label, next: card.nextActions.map((a) => `${a.kind}: ${a.text}`) } : null;
  };
}

function results(): { file: string; result: AgentAnalysisResult }[] {
  const list: { file: string; result: AgentAnalysisResult }[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
      const raw = JSON.parse(readFileSync(join(dir, f), "utf8")) as { status?: string; territories?: unknown };
      if (!Array.isArray(raw.territories) || raw.status === "NEEDS_INPUT") continue;
      list.push({ file: `${basename(dir)}/${f}`, result: raw as AgentAnalysisResult });
    }
  }
  return list;
}

const before = await loadBaseline();
const rows = [];
for (const { file, result } of results()) {
  const research = assessResearch(result);
  for (const a of research.territories) {
    const card = decisionCard(result, a.territoryKey)!;
    const t = result.territories.find((x) => x.key === a.territoryKey)!;
    rows.push({
      file,
      origin: result.evidenceOrigin,
      brand: result.brand?.label ?? null,
      question: result.userQuery,
      territory: t.label,
      route: t.analysisRoute,
      before: before?.(result, a.territoryKey) ?? null,
      after: {
        conclusion: `${a.label}: ${a.conclusion}`,
        rule: a.rule,
        basis: a.basis,
        observed: a.observed.map((o) => o.text),
        limitations: a.limitations,
        missing: a.missing,
        comparative: card.comparative.text,
        implication: card.implication.label,
        next: card.nextActions.map((x) => `${x.kind}: ${x.text}`),
      },
      violations: [...evidenceAssessmentViolations(a), ...decisionCardViolations(card, result)],
      coverage: research.coverage,
    });
  }
}

const notMeasuredLead = (s: string | undefined) => Boolean(s && /^not measured/iu.test(s));
const summary = {
  label: "OFFLINE_REPLAY_OF_STORED_RESULTS (no provider call; not Qloo or live-model validation)",
  baseline: before ? baselinePath : "BASELINE_NOT_AVAILABLE",
  targets: rows.length,
  beforeLedWithNotMeasured: rows.filter((r) => notMeasuredLead(r.before?.finding)).length,
  afterLedWithNotMeasured: rows.filter((r) => notMeasuredLead(r.after.conclusion)).length,
  outcomes: rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.after.conclusion.split(":")[0]!]: (acc[r.after.conclusion.split(":")[0]!] ?? 0) + 1 }), {}),
  violations: rows.reduce((n, r) => n + r.violations.length, 0),
};

const md = [
  "# Sprint 12 research-completion replay",
  "",
  `${summary.label}. Baseline card: ${summary.baseline}.`,
  "",
  `Targets: ${summary.targets}. Led with "Not measured": before ${summary.beforeLedWithNotMeasured}, after ${summary.afterLedWithNotMeasured}. Violations after: ${summary.violations}.`,
  "",
  ...rows.flatMap((r) => [
    `## ${r.brand} × ${r.territory} (${r.file}, ${r.origin}, ${r.route})`,
    "",
    `Question: ${r.question}`,
    "",
    `**Before** (production card): ${r.before ? `${r.before.finding} *${r.before.implication}.* Next: ${r.before.next.join(" | ")}` : "n/a"}`,
    "",
    `**After**: ${r.after.conclusion} *(${r.after.implication}; rule: ${r.after.rule}; ${r.after.basis})*`,
    "",
    ...r.after.observed.map((o) => `- Observed: ${o}`),
    ...r.after.limitations.map((o) => `- Limit: ${o}`),
    ...r.after.missing.map((o) => `- Would change the answer: ${o}`),
    `- Comparative: ${r.after.comparative}`,
    ...r.after.next.map((o) => `- Next: ${o}`),
    ...(r.violations.length ? [`- VIOLATIONS: ${r.violations.join("; ")}`] : []),
    "",
  ]),
].join("\n");

if (out) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "research-completion-replay.json"), JSON.stringify({ summary, rows }, null, 2));
  writeFileSync(join(out, "research-completion-replay.md"), md);
}
console.log(JSON.stringify(summary, null, 2));
if (summary.violations > 0) process.exitCode = 1;
