/**
 * Sprint 10B decision-point competence evaluation (`pnpm eval:competence -- --decisions`).
 *
 * Full-run evals (eval:agent, eval:d2d) drive the deterministic reference policy, so they never exercise a model's
 * choices. A decision case freezes one decision instead: the reference policy drives a SYNTHETIC scenario until the
 * case's decision point (a predicate on the decision context the runtime built), the policy under test takes exactly
 * that turn, and the reference policy finishes the run. The tested turn is scored from the runtime's own trace
 * (accepted or refused, the Qloo answer it got), never from the model's prose, against named, generic predicates
 * evaluated on the context the policy saw (no ids, brands or territories are written into a case).
 *
 * Arms are runtime switches (evals/competence/decisions.json); the policy, world, budgets and methodology are identical
 * across arms. Synthetic world only: no Qloo call is ever made. A model policy (`--model haiku`) calls Anthropic for the
 * tested turn only and needs an owner-approved ceiling (`--approved-usd`); everything else is provider-free.
 * Results are labelled synthetic; a baseline or instrument run is never a model validation.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AgentAnalysisResult, AgentRunResponse, AgentTurnTrace } from "@cultural-elasticity/shared";
import { BaselinePolicyModel } from "../../src/agent/model/baseline.js";
import { ScriptedAgentModel } from "../../src/agent/model/scripted.js";
import type { AgentDecisionContext, AgentModel } from "../../src/agent/model/provider.js";
import { contextSize } from "../../src/agent/context.js";
import { AgentRuntime } from "../../src/agent/runtime.js";
import { SCENARIOS_PATH, type Scenario } from "../agent-eval-harness.js";
import { runMetrics } from "../d2d/harness.js";
import { createScriptedToolProvider, syntheticWorldSchema } from "../synthetic/synthetic-world.js";

export const DECISIONS_PATH = fileURLToPath(new URL("../../../evals/competence/decisions.json", import.meta.url));
const WORLD_PATH = fileURLToPath(new URL("../../../evals/fixtures/synthetic/agent/world.json", import.meta.url));

/** Where the tested turn happens: the first (or `occurrence`-th) context matching every given field. */
export type DecisionPoint = {
  stage?: string;
  skill?: string;
  notSkill?: string;
  feasibility?: string;
  blocker?: string;
  outstanding?: string;
  rejected?: string;
  tool?: string;
  noTool?: string;
  /** brand.status in the context (resolved, ambiguous, not_found, unresolved). */
  brand?: string;
  occurrence?: number;
};

/** A decision pattern: action and tool are exact; `check` names a generic predicate (CHECKS) on decision + context. */
export type Pattern = { action?: string; tool?: string; check?: keyof typeof CHECKS };

export type DecisionCase = {
  id: string;
  split: "dev" | "holdout";
  dimension: string;
  /** The Sprint 10B taxonomy label this case tempts (a wrong decision would be this failure). */
  label: string;
  description: string;
  scenario: string;
  at: DecisionPoint;
  /** At least one ACCEPTED decision of the tested turn matches one of these (when given). */
  good?: Pattern[];
  /** No decision of the tested turn (accepted or refused) may match any of these. */
  bad?: Pattern[];
};

export type DecisionManifest = {
  schema: string;
  arms: Record<string, { withdrawnToolNotes: boolean; description: string }>;
  cases: DecisionCase[];
};

type Decision = { action: string; tool?: string; arguments?: Record<string, unknown>; accepted: boolean; rejection?: string };

const tagsOf = (d: Decision) => ((d.arguments?.tagIds as string[] | undefined) ?? (d.arguments?.evidenceTagIds as string[] | undefined) ?? []);
const idsOf = (d: Decision) => ((d.arguments?.entityIds as string[] | undefined) ?? (d.arguments?.ids as string[] | undefined) ?? (typeof d.arguments?.entityId === "string" ? [d.arguments.entityId] : []));
const isQloo = (d: Decision) => d.action === "call_tool" && (d.tool ?? "").startsWith("qloo_");
const rejectionText = (c: AgentDecisionContext) => [...c.focus!.rejectedApproaches, ...(c.lastTurn?.rejections ?? []).map((r) => `${r.action}: ${r.code} — ${r.reason}`)].join("\n");

/** Generic predicates. Each reads only the decision and the context the policy saw at the decision point. */
export const CHECKS = {
  /** A brand-independent probe of a (tag, type) some territory's nextProbe recommends. */
  followsNextProbe: (d: Decision, c: AgentDecisionContext) => d.tool === "qloo_recommend" && c.territories.some((t) => t.nextProbe && tagsOf(d).includes(t.nextProbe.tagId) && d.arguments?.targetType === t.nextProbe.entityType),
  /** A probe of a (tag, type) the probe ledger already shows empty for that concept. */
  reprobesEmptyType: (d: Decision, c: AgentDecisionContext) => d.tool === "qloo_recommend" && c.territories.some((t) => (t.probes ?? []).some((p) => tagsOf(d).includes(p.tagId) && p.probes.some((x) => x.type === d.arguments?.targetType && x.members === 0))),
  /** Repeats a call whose tool and tag (or entity id) appear in a refusal the policy was shown. */
  repeatsRefusal: (d: Decision, c: AgentDecisionContext) => {
    const text = rejectionText(c);
    const keys = [...tagsOf(d), ...idsOf(d)];
    return d.action === "call_tool" && text.includes(`${d.tool}:`) && keys.some((k) => text.includes(k));
  },
  /** Proposes a reference from referenceCandidates (MEANINGFUL, not barren, as listed). */
  proposesListedReference: (d: Decision, c: AgentDecisionContext) => d.tool === "propose_territory" && d.arguments?.role === "reference" && tagsOf(d).some((tag) => (c.evidence.referenceCandidates ?? []).some((r) => r.tagId === tag)),
  /** Probes or proposes a reference the deterministic plan rejected, or a candidate outside referenceCandidates. */
  usesUnlistedReference: (d: Decision, c: AgentDecisionContext) => {
    if (!c.evidence.referenceCandidates) return false;
    const listed = new Set(c.evidence.referenceCandidates.map((r) => r.tagId));
    const own = new Set(c.territories.flatMap((t) => (t.concept ? [t.concept.id] : [])));
    const reference = (d.tool === "propose_territory" && d.arguments?.role === "reference") || (d.tool === "qloo_recommend" && d.arguments?.conditionOnBrand === false);
    return reference && tagsOf(d).length > 0 && tagsOf(d).every((tag) => !listed.has(tag) && !own.has(tag));
  },
  /** Re-requests an entity profile or tag query the context lists as already collected. */
  duplicateCollection: (d: Decision, c: AgentDecisionContext) => {
    const done = c.evidence.alreadyCollected;
    if (!done) return false;
    if (d.tool === "qloo_get_entity_tags") return idsOf(d).some((id) => done.profiledEntityIds.includes(id));
    if (d.tool === "qloo_find_tags") return done.searchedQueries.some((q) => q.toLowerCase().includes(String(d.arguments?.query ?? "").toLowerCase()));
    return false;
  },
  /** Profiles discovery seeds (qloo_get_entity_tags on seed ids). */
  profilesSeed: (d: Decision, c: AgentDecisionContext) => d.tool === "qloo_get_entity_tags" && idsOf(d).some((id) => (c.evidence.seeds ?? []).some((s) => s.id === id)),
  /** Any Qloo-facing call (spends provider budget). */
  qlooCall: (d: Decision) => isQloo(d),
  /** Calls a tool the policy was not offered this turn. */
  unexposedTool: (d: Decision, c: AgentDecisionContext) => d.action === "call_tool" && !c.focus!.nextAllowed.includes(d.tool ?? ""),
  /** A propose_territory with origin agent_hypothesis (a lateral hypothesis Qloo must still validate). */
  hypothesis: (d: Decision) => d.tool === "propose_territory" && d.arguments?.origin === "agent_hypothesis",
} satisfies Record<string, (d: Decision, c: AgentDecisionContext) => boolean>;

const matches = (p: Pattern, d: Decision, c: AgentDecisionContext) =>
  (!p.action || d.action === p.action) && (!p.tool || d.tool === p.tool) && (!p.check || CHECKS[p.check](d, c));

function atPoint(at: DecisionPoint, c: AgentDecisionContext): boolean {
  const f = c.focus;
  if (!f) return false;
  const skills = f.activeSkills.map((s) => s.split(" ")[0]!);
  const re = (s: string) => new RegExp(s, "u");
  return (
    (!at.stage || f.stage === at.stage) &&
    (!at.skill || skills.includes(at.skill)) &&
    (!at.notSkill || !skills.includes(at.notSkill)) &&
    (!at.feasibility || f.feasibility?.status === at.feasibility) &&
    (!at.blocker || re(at.blocker).test(f.blocker ?? "")) &&
    (!at.outstanding || f.outstanding.some((o) => re(at.outstanding!).test(o))) &&
    (!at.rejected || re(at.rejected).test(rejectionText(c))) &&
    (!at.tool || f.nextAllowed.includes(at.tool)) &&
    (!at.noTool || !f.nextAllowed.includes(at.noTool)) &&
    (!at.brand || c.brand.status === at.brand)
  );
}

/**
 * The scenario's own policy (its script, or the reference policy) drives the run to the decision point, the policy under
 * test takes that turn, and a fresh reference policy finishes the run (a script's later steps assume its own turn).
 * A policy that keeps per-run memory never sees the tested turn's context, as in a live handover.
 */
class Handover implements AgentModel {
  private matched = 0;
  context: AgentDecisionContext | null = null;
  testedIteration: number | null = null;
  constructor(private readonly prefix: AgentModel, private readonly tested: AgentModel, private readonly suffix: AgentModel, private readonly at: DecisionPoint) {}
  get info() {
    return this.tested.info;
  }
  decide(context: AgentDecisionContext) {
    if (this.testedIteration === null && !context.repair && atPoint(this.at, context) && ++this.matched === (this.at.occurrence ?? 1)) {
      this.context = context;
      this.testedIteration = context.iteration;
    }
    // The bounded repair attempt of the tested turn (same iteration) stays with the tested policy.
    if (this.testedIteration === context.iteration) return this.tested.decide(context);
    return (this.testedIteration === null ? this.prefix : this.suffix).decide(context);
  }
  get synthesize() {
    return this.suffix.synthesize?.bind(this.suffix);
  }
}

export type DecisionRow = {
  caseId: string;
  split: string;
  dimension: string;
  label: string;
  arm: string;
  policy: string;
  reached: boolean;
  correct: boolean | null;
  goodMet: boolean | null;
  badHits: string[];
  firstAttemptValid: boolean | null;
  repaired: boolean;
  refusals: string[];
  qlooCalls: number;
  productiveCalls: number;
  emptyProbes: number;
  contextChars: number | null;
  inputTokens: number;
  outputTokens: number;
  outcome: { status: string; fullTerritories: number; safetyViolations: number };
  decisions: string[];
};

/** Policies available offline. `instrument:*` reproduce failure classes observed in live Haiku traces (evaluator sensitivity), never a model. */
export type PolicyName = "reference" | "haiku" | "instrument:eager-finish" | "instrument:ignore-guidance";

/** Live L-C and L-M behaviour: finishes as soon as finish is offered, whatever the focus says. */
class EagerFinish implements AgentModel {
  constructor(private readonly inner: AgentModel) {}
  get info() {
    return { id: "instrument:eager-finish", kind: "scripted" as const, live: false };
  }
  decide(c: AgentDecisionContext) {
    if (c.actions.includes("finish")) return Promise.resolve({ decisions: [{ action: "finish", resultIds: [], reasonSummary: "instrument: finish when offered" }] });
    if (c.actions.includes("analyze")) return Promise.resolve({ decisions: [{ action: "analyze", targetIds: c.territories.filter((t) => t.status !== "analyzed" && t.status !== "dropped").map((t) => t.key), reasonSummary: "instrument: analyze when offered" }] });
    return this.inner.decide(c);
  }
}

/**
 * Live 5A.2 behaviour (28 of 34 deviating probes empty): probes an observed tag that is not the recommended one, with
 * the default first type, instead of the focus' nextProbe; otherwise defers to the reference policy.
 */
class IgnoreGuidance implements AgentModel {
  constructor(private readonly inner: AgentModel) {}
  get info() {
    return { id: "instrument:ignore-guidance", kind: "scripted" as const, live: false };
  }
  decide(c: AgentDecisionContext) {
    const recommended = new Set(c.territories.flatMap((t) => (t.nextProbe ? [t.nextProbe.tagId] : [])));
    const tag = (c.evidence.observedTags ?? []).find((t) => !recommended.has(t.id)) ?? (c.evidence.referenceCandidates ?? []).at(-1);
    const id = tag && ("id" in tag ? tag.id : tag.tagId);
    if (id && c.focus?.nextAllowed.includes("qloo_recommend")) return Promise.resolve({ decisions: [{ action: "call_tool", tool: "qloo_recommend", arguments: { targetType: "place", tagIds: [id], conditionOnBrand: false }, reasonSummary: "instrument: probe an unrecommended observed tag" }] });
    return this.inner.decide(c);
  }
}

export async function runDecisionCase(dc: DecisionCase, scenario: Scenario, arm: { name: string; withdrawnToolNotes: boolean }, policy: PolicyName, makeModel: () => AgentModel): Promise<{ row: DecisionRow; response: AgentRunResponse; context: AgentDecisionContext | null }> {
  const world = syntheticWorldSchema.parse(JSON.parse(readFileSync(WORLD_PATH, "utf8")));
  // One reference instance throughout a reference-driven scenario keeps its per-run memory (a fresh one would re-search).
  const reference = new BaselinePolicyModel();
  const prefix = scenario.policy === "scripted" ? new ScriptedAgentModel(scenario.steps ?? [], scenario.synthesis ?? [], scenario.id) : reference;
  const tested = policy === "reference" ? reference : policy === "instrument:eager-finish" ? new EagerFinish(reference) : policy === "instrument:ignore-guidance" ? new IgnoreGuidance(reference) : makeModel();
  const model = new Handover(prefix, tested, reference, dc.at);
  const runtime = new AgentRuntime({ model, provider: createScriptedToolProvider(world, scenario.faults ?? []), withdrawnToolNotes: arm.withdrawnToolNotes, ...(scenario.feasibilityPolicy && { feasibilityPolicy: scenario.feasibilityPolicy }) });
  let response = await runtime.run(scenario.request, undefined, scenario.seeds ? { discoverySeeds: scenario.seeds } : {});
  if (response.status === "NEEDS_INPUT" && scenario.answer) response = await runtime.continue(response.runId, scenario.answer);
  const m = runMetrics(response);
  const outcome = { status: response.status, fullTerritories: m.fullTerritories, safetyViolations: m.unsupportedClassifications + m.crossCallComparisons + m.cards.reduce((n, c) => n + c.violations.length, 0) };
  const base = { caseId: dc.id, split: dc.split, dimension: dc.dimension, label: dc.label, arm: arm.name, policy, outcome };
  const turn: AgentTurnTrace | undefined = model.testedIteration === null ? undefined : response.trace.turns.find((t) => t.iteration === model.testedIteration);
  const context = model.context;
  if (!turn || !context) {
    return { row: { ...base, reached: false, correct: null, goodMet: null, badHits: [], firstAttemptValid: null, repaired: false, refusals: [], qlooCalls: 0, productiveCalls: 0, emptyProbes: 0, contextChars: null, inputTokens: 0, outputTokens: 0, decisions: [] }, response, context };
  }
  const decisions = turn.decisions as Decision[];
  const goodMet = dc.good ? decisions.some((d) => d.accepted && dc.good!.some((p) => matches(p, d, context))) : null;
  const badHits = [...new Set(decisions.flatMap((d) => (dc.bad ?? []).filter((p) => matches(p, d, context)).map((p) => p.check ?? `${p.action ?? ""}${p.tool ? `:${p.tool}` : ""}`)))];
  const calls = response.trace.toolCalls.filter((c) => c.iteration === turn.iteration && c.qlooOperations.length > 0);
  const probes = calls.filter((c) => c.tool === "qloo_recommend" && (c.arguments as { conditionOnBrand?: boolean })?.conditionOnBrand === false);
  return {
    row: {
      ...base,
      reached: true,
      correct: (goodMet ?? true) && badHits.length === 0,
      goodMet,
      badHits,
      firstAttemptValid: turn.firstAttemptValid ?? null,
      repaired: (turn.modelAttempts ?? 1) > 1,
      refusals: decisions.filter((d) => !d.accepted).map((d) => (d.rejection ?? "").split(":")[0]!),
      qlooCalls: calls.reduce((n, c) => n + c.qlooOperations.length, 0),
      productiveCalls: calls.filter((c) => c.status === "ok").length,
      emptyProbes: probes.filter((c) => c.status === "empty").length,
      contextChars: contextSize(context).chars,
      inputTokens: (turn.usage?.inputTokens ?? 0) + (turn.usage?.cacheReadTokens ?? 0) + (turn.usage?.cacheCreationTokens ?? 0),
      outputTokens: turn.usage?.outputTokens ?? 0,
      decisions: decisions.map((d) => `${d.action === "call_tool" ? d.tool : d.action}${d.accepted ? "" : `✗${(d.rejection ?? "").split(":")[0]}`}`),
    },
    response,
    context,
  };
}

export function loadDecisionManifest(): { manifest: DecisionManifest; scenarios: Map<string, Scenario> } {
  const manifest = JSON.parse(readFileSync(DECISIONS_PATH, "utf8")) as DecisionManifest;
  const scenarios = new Map((JSON.parse(readFileSync(SCENARIOS_PATH, "utf8")).scenarios as Scenario[]).map((s) => [s.id, s]));
  for (const c of manifest.cases) if (!scenarios.has(c.scenario)) throw new Error(`decision case ${c.id}: unknown scenario ${c.scenario}`);
  return { manifest, scenarios };
}

type Summary = { cases: number; reached: number; correct: number; firstAttemptValid: number; qlooCalls: number; productiveCalls: number; emptyProbes: number; safetyViolations: number; fullTerritories: number };

export function summarize(rows: readonly DecisionRow[]): Summary {
  const reached = rows.filter((r) => r.reached);
  return {
    cases: rows.length,
    reached: reached.length,
    correct: reached.filter((r) => r.correct).length,
    firstAttemptValid: reached.filter((r) => r.firstAttemptValid).length,
    qlooCalls: reached.reduce((n, r) => n + r.qlooCalls, 0),
    productiveCalls: reached.reduce((n, r) => n + r.productiveCalls, 0),
    emptyProbes: reached.reduce((n, r) => n + r.emptyProbes, 0),
    safetyViolations: rows.reduce((n, r) => n + r.outcome.safetyViolations, 0),
    fullTerritories: rows.reduce((n, r) => n + r.outcome.fullTerritories, 0),
  };
}

/** Wilson 95% interval for k of n (small samples: the interval, not the point estimate, is the finding). */
export function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export const isAnalysis = (r: AgentRunResponse): r is AgentAnalysisResult => r.status !== "NEEDS_INPUT";

const LABEL_OFFLINE = "SYNTHETIC decision points (reference policy and trace-derived instruments; no provider call; never a model validation)";
const LABEL_HAIKU = "LIVE_HAIKU_DECISIONS on a SYNTHETIC world (Anthropic for the tested turn only; no Qloo call; never Qloo validation)";

/**
 * `eval:competence -- --decisions [--policy reference,instrument:eager-finish,instrument:ignore-guidance|haiku]
 *   [--arms before,new] [--split dev,holdout] [--repeats N] [--approved-usd X] [--json file]`
 * Exit 0 when the offline pass bar holds (safety, sensitivity, reachability). The Haiku improvement criterion is only
 * evaluated on a Haiku run; offline it is reported as LIVE_AGENT_MODEL_VALIDATION_NOT_RUN.
 */
export async function decisionsCli(argv: readonly string[], makeHaiku: () => AgentModel, price: { input: number; output: number }): Promise<number> {
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const { manifest, scenarios } = loadDecisionManifest();
  const policies = (arg("--policy")?.split(",") ?? ["reference", "instrument:eager-finish", "instrument:ignore-guidance"]) as PolicyName[];
  const arms = arg("--arms")?.split(",") ?? Object.keys(manifest.arms);
  const splits = arg("--split")?.split(",") ?? ["dev", "holdout"];
  const repeats = Number(arg("--repeats") ?? 1);
  const cases = manifest.cases.filter((c) => splits.includes(c.split));
  const haiku = policies.includes("haiku");
  if (haiku) {
    const approved = Number(arg("--approved-usd") ?? NaN);
    // Conservative reservation: every tested turn may take a repair attempt; context measured on the reference run.
    let chars = 0;
    for (const c of cases) chars += (await runDecisionCase(c, scenarios.get(c.scenario)!, { name: "before", withdrawnToolNotes: false }, "reference", makeHaiku)).row.contextChars ?? 40_000;
    const turns = arms.length * repeats * 2;
    const reserve = ((chars / 3 + cases.length * 6_000) * turns * price.input + cases.length * turns * 1_500 * price.output) / 1e6;
    console.log(`Haiku decision run: ${cases.length} cases × ${arms.length} arm(s) × ${repeats} repeat(s); reserved exposure $${reserve.toFixed(3)}`);
    if (!process.env.ANTHROPIC_API_KEY) { console.log("ANTHROPIC_API_KEY is not set: LIVE_AGENT_MODEL_VALIDATION_NOT_RUN"); return 4; }
    if (!(approved >= reserve)) { console.log(`refused: --approved-usd ${Number.isNaN(approved) ? "(missing)" : approved} does not cover the reserved exposure; no call made`); return 4; }
  }
  const rows: DecisionRow[] = [];
  for (const policy of policies) {
    for (const armName of arms) {
      const arm = { name: armName, withdrawnToolNotes: manifest.arms[armName]!.withdrawnToolNotes };
      for (let r = 0; r < (policy === "haiku" ? repeats : 1); r += 1) {
        for (const c of cases) rows.push((await runDecisionCase(c, scenarios.get(c.scenario)!, arm, policy, makeHaiku)).row);
      }
    }
  }

  const line = (rs: DecisionRow[]) => {
    const s = summarize(rs);
    const [lo, hi] = wilson(s.correct, s.reached);
    return `correct ${s.correct}/${s.reached} [${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%] | first-attempt valid ${s.firstAttemptValid}/${s.reached} | Qloo ${s.qlooCalls} (${s.productiveCalls} productive, ${s.emptyProbes} empty probes) | reached ${s.reached}/${s.cases} | safety violations ${s.safetyViolations}`;
  };
  console.log(`\n${haiku ? LABEL_HAIKU : LABEL_OFFLINE}`);
  for (const policy of policies) for (const arm of arms) for (const split of splits) {
    const rs = rows.filter((x) => x.policy === policy && x.arm === arm && x.split === split);
    if (rs.length) console.log(`  ${policy.padEnd(27)} ${arm.padEnd(6)} ${split.padEnd(7)} ${line(rs)}`);
  }
  const wrong = rows.filter((r) => r.reached && !r.correct && r.policy === "reference");
  for (const w of wrong) console.log(`  reference wrong: ${w.caseId} [${w.arm}] good=${w.goodMet} bad=${w.badHits.join(",") || "-"} decisions=${w.decisions.join(",")}`);
  for (const r of rows.filter((x) => !x.reached && x.policy === "reference" && x.arm === arms[0])) console.log(`  NOT_REACHED ${r.caseId}`);

  const ref = rows.filter((r) => r.policy === "reference");
  const correct = (rs: DecisionRow[]) => rs.filter((r) => r.reached && r.correct).length;
  const checks = [
    { name: "safety: no unsupported class, cross-call comparison or card violation", pass: rows.every((r) => r.outcome.safetyViolations === 0), value: rows.reduce((n, r) => n + r.outcome.safetyViolations, 0) },
    ...(policies.includes("reference") ? [{ name: "reachability: the reference policy reaches ≥ 90% of decision points", pass: ref.filter((r) => r.reached).length >= 0.9 * ref.length, value: `${ref.filter((r) => r.reached).length}/${ref.length}` }] : []),
    ...policies.filter((p) => p.startsWith("instrument:")).map((p) => {
      const inst = rows.filter((r) => r.policy === p);
      const reachedBoth = inst.filter((r) => r.reached && ref.some((x) => x.caseId === r.caseId && x.arm === r.arm && x.reached));
      const refSame = ref.filter((x) => reachedBoth.some((r) => r.caseId === x.caseId && r.arm === x.arm));
      return { name: `sensitivity: ${p} scores below the reference policy`, pass: policies.includes("reference") && correct(reachedBoth) < correct(refSame), value: `${correct(reachedBoth)} < ${correct(refSame)}` };
    }),
  ];
  for (const c of checks) console.log(`  [${c.pass ? "PASS" : "FAIL"}] ${c.name}: ${c.value}`);
  if (!haiku) console.log("  [NOT_RUN] improvement (Haiku before → new on holdout): LIVE_AGENT_MODEL_VALIDATION_NOT_RUN");
  const out = arg("--json");
  if (out) (await import("node:fs")).writeFileSync(out, `${JSON.stringify({ schema: "ce-decision-report/1", label: haiku ? LABEL_HAIKU : LABEL_OFFLINE, generatedAt: new Date().toISOString(), rows, checks }, null, 2)}\n`);
  return checks.every((c) => c.pass) ? 0 : 1;
}
