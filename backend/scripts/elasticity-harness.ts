/**
 * `pnpm eval:elasticity` harness: replays the LIVE benchmark fixtures OFFLINE through the methodology and
 * measures it against the human-curated benchmark. Makes no network request; its results describe
 * captured live evidence and are not a new live validation.
 *
 * Structural checks (exit 1 on failure): fixture coverage and provenance, determinism, invariants,
 * calibration drift (configured thresholds must equal the re-derived ones), and decision consistency
 * (the index decision may be APPROVED only if every brand passes the gate).
 */
import { readFileSync } from "node:fs";
import type { CulturalElasticityResult } from "@cultural-elasticity/shared";
import { benchmarkSchema, pairwiseAssertions, subsetOf, type Benchmark } from "./benchmark/benchmark.js";
import { calibrateThresholds, classCases, evaluatePairwise, summarizePairwise, type CalibrationOutcome, type PairwiseSummary } from "./benchmark/calibration.js";
import { CLASSIFICATION_POLICY, METHODOLOGY_VERSION, RELATIVE_INDEX_DECISION } from "../src/methodology/config.js";
import { parseMethodologyInput, type MethodologyInput } from "../src/methodology/contracts.js";
import { analyzeElasticity } from "../src/methodology/elasticity.js";
import { QLOO_LIVE_SOURCE } from "../src/qloo/live-adapter.js";
import { BENCHMARK_FILE, EVIDENCE_DIR, loadElasticityFixtures } from "./elasticity-fixture.js";

export type Check = { id: string; passed: boolean; detail: string };

export type FilterEffect = { brandKey: string; territoryId: string; exemplar: string; raw: number; filtered: number; removedShared: string[] };

export type ElasticityEvalReport = {
  methodologyVersion: string;
  benchmarkVersion: string;
  brands: string[];
  cases: number;
  pairwise: { all: PairwiseSummary; calibration: PairwiseSummary; heldOut: PairwiseSummary; strongVsWeak: PairwiseSummary; failures: string[] };
  repeatDeterminism: { identical: number; total: number };
  robustness: { stable: number; total: number; byLevel: Record<string, number> };
  insufficientEvidence: number;
  unresolvedEntities: { unresolved: number; total: number; detail: string[] };
  filter: { pairs: number; reduced: number; unchanged: number; operationalOnly: number; examples: FilterEffect[]; rulePrevalence: Record<string, number>; profiles: number };
  classes: { calibration: { agree: number; total: number }; heldOut: { agree: number; total: number }; uncertain: number; changesUnderSubstitution: number; territories: number };
  calibration: CalibrationOutcome;
  gate: { overall: "PASS" | "FAIL"; byBrand: { brandKey: string; status: string; failing: string[] }[]; checkPassCounts: Record<string, number> };
  conditioned: { supported: number; sparse: number; empty: number; notCollected: number; exemplarsFound: number };
  results: Map<string, CulturalElasticityResult>;
  checks: Check[];
  passed: boolean;
};

const check = (id: string, run: () => true | string): Check => {
  try {
    const outcome = run();
    return { id, passed: outcome === true, detail: outcome === true ? "ok" : outcome };
  } catch (error) {
    return { id, passed: false, detail: (error as Error).message };
  }
};

function sourcesOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => sourcesOf(v, out));
  else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.source === "string" && typeof record.operation === "string") out.add(record.source);
    Object.values(record).forEach((v) => sourcesOf(v, out));
  }
  return out;
}

export function loadBenchmark(file: string = BENCHMARK_FILE): Benchmark {
  return benchmarkSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

export function runElasticityEval(options: { benchmarkFile?: string; evidenceDir?: string } = {}): ElasticityEvalReport {
  const benchmark = loadBenchmark(options.benchmarkFile);
  const fixtures = loadElasticityFixtures(options.evidenceDir ?? EVIDENCE_DIR);
  const checks: Check[] = [];
  const inputs = new Map<string, MethodologyInput>();

  for (const fixture of fixtures) {
    const parsed = parseMethodologyInput(fixture.input);
    checks.push(
      check(`${fixture.brandKey}.input`, () => (parsed.ok ? true : parsed.issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join("; "))),
    );
    if (!parsed.ok) continue;
    const input = parsed.input;
    checks.push(
      check(`${fixture.brandKey}.live_provenance`, () => {
        if (input.origin !== "live") return `origin ${input.origin}`;
        const sources = [...sourcesOf(input)];
        if (sources.some((s) => s !== QLOO_LIVE_SOURCE)) return `sources: ${sources.join(", ")}`;
        const refs = JSON.stringify(input).match(/"source":"[^"]+","operation":"[^"]+"(?!,"correlationId")/g);
        return refs === null || `${refs.length} provenance ref(s) without a correlation id`;
      }),
    );
    inputs.set(fixture.brandKey, input);
  }
  for (const brand of benchmark.brands) checks.push(check(`${brand.key}.fixture`, () => inputs.has(brand.key) || "no valid live fixture for this benchmark brand"));

  const results = new Map<string, CulturalElasticityResult>();
  for (const [key, input] of inputs) {
    const first = analyzeElasticity(input);
    const second = analyzeElasticity(structuredClone(input));
    checks.push(check(`${key}.deterministic`, () => JSON.stringify(first) === JSON.stringify(second) || "two runs on the same input differ"));
    results.set(key, first);
  }

  // Pairwise ordering.
  const outcomes = evaluatePairwise(results, pairwiseAssertions(benchmark));
  const bySubset = (subset: "calibration" | "heldOut") => outcomes.filter((o) => subsetOf(benchmark, o.brandKey) === subset);
  const pairwise = {
    all: summarizePairwise(outcomes),
    calibration: summarizePairwise(bySubset("calibration")),
    heldOut: summarizePairwise(bySubset("heldOut")),
    strongVsWeak: summarizePairwise(outcomes.filter((o) => o.basis === "expected_strong>expected_weak")),
    failures: outcomes.filter((o) => o.outcome !== "correct").map((o) => `${o.brandKey}: ${o.higher} > ${o.lower} → ${o.outcome} (${o.higherPercentile ?? "n/a"} vs ${o.lowerPercentile ?? "n/a"})`),
  };

  const all = [...results.values()];
  const territories = all.flatMap((r) => r.territories);
  const repeats = all.flatMap((r) => r.repeatChecks);
  const byLevel: Record<string, number> = {};
  for (const t of territories) byLevel[t.robustness.level] = (byLevel[t.robustness.level] ?? 0) + 1;

  // Unresolved entities: benchmark brands without evidence, and exemplars without profile or panel evidence.
  const unresolvedDetail: string[] = benchmark.brands.filter((b) => !inputs.has(b.key)).map((b) => `brand ${b.key}`);
  const exemplarStatus = new Map<string, boolean>();
  for (const r of all) for (const t of r.territories) for (const e of t.territory.exemplars) {
    const ok = t.panelEvidence.some((o) => o.exemplarId === e.id) && t.coherenceRaw.perExemplar.some((c) => c.exemplarId === e.id && c.status !== "unavailable");
    exemplarStatus.set(e.label, (exemplarStatus.get(e.label) ?? true) && ok);
  }
  for (const [label, ok] of exemplarStatus) if (!ok) unresolvedDetail.push(`exemplar ${label}`);

  // Operational filter effect, per brand × exemplar.
  const effects: FilterEffect[] = [];
  for (const [brandKey, r] of results) for (const t of r.territories) {
    const filtered = new Map(t.coherenceFiltered.perExemplar.map((e) => [e.exemplarId, e]));
    for (const raw of t.coherenceRaw.perExemplar) {
      const f = filtered.get(raw.exemplarId);
      if (raw.sharedCount === null || f?.sharedCount === null || f === undefined) continue;
      const kept = new Set(f.shared.map((s) => s.id));
      effects.push({ brandKey, territoryId: t.territory.id, exemplar: raw.exemplarLabel, raw: raw.sharedCount, filtered: f.sharedCount as number, removedShared: raw.shared.filter((s) => !kept.has(s.id)).map((s) => s.label) });
    }
  }
  const rulePrevalence: Record<string, number> = {};
  const profileFilters = all.length > 0 ? [all[0]!.brandTagFilter, ...all.slice(1).map((r) => r.brandTagFilter)] : [];
  for (const report of profileFilters) for (const rule of new Set(report.excluded.map((e) => e.rule))) rulePrevalence[rule] = (rulePrevalence[rule] ?? 0) + 1;

  // Classes.
  const cases = classCases(benchmark, results);
  const subsetCases = (subset: "calibration" | "heldOut") => cases.filter((c) => subsetOf(benchmark, c.brandKey) === subset);
  const t = CLASSIFICATION_POLICY;
  const panelClass = (p: number) => (p >= t.naturalAdjacencyMinMedianPercentile ? "NA" : p <= t.culturalBreakMaxMedianPercentile ? "CB" : "CS");
  const changes = territories.filter((x) => new Set(x.panelEvidence.map((o) => panelClass(o.percentile))).size > 1).length;

  const calibration = calibrateThresholds(benchmark, inputs);
  checks.push(
    check("calibration.no_drift", () =>
      (calibration.chosen.naturalAdjacencyMin === t.naturalAdjacencyMinMedianPercentile && calibration.chosen.culturalBreakMax === t.culturalBreakMaxMedianPercentile) ||
      `configured ${t.naturalAdjacencyMinMedianPercentile}/${t.culturalBreakMaxMedianPercentile} but calibration chooses ${calibration.chosen.naturalAdjacencyMin}/${calibration.chosen.culturalBreakMax}`,
    ),
  );

  const byBrand = [...results.entries()].map(([brandKey, r]) => ({ brandKey, status: r.indexGate.status, failing: r.indexGate.checks.filter((c) => c.status !== "PASS").map((c) => `${c.id}:${c.status}`) }));
  const checkPassCounts: Record<string, number> = {};
  for (const r of all) for (const c of r.indexGate.checks) checkPassCounts[c.id] = (checkPassCounts[c.id] ?? 0) + (c.status === "PASS" ? 1 : 0);
  const overall = byBrand.length > 0 && byBrand.every((b) => b.status === "PASS") ? "PASS" : "FAIL";
  checks.push(check("index.decision_consistent", () => RELATIVE_INDEX_DECISION.decision !== "APPROVED" || overall === "PASS" || "index APPROVED although the benchmark gate fails"));
  checks.push(check("index.absent_when_rejected", () => RELATIVE_INDEX_DECISION.decision === "APPROVED" || territories.every((x) => x.relativeElasticityIndex === undefined) || "index present although REJECTED_FOR_NOW"));

  const conditioned = territories.map((x) => x.conditionedEvidence);
  return {
    methodologyVersion: METHODOLOGY_VERSION,
    benchmarkVersion: benchmark.benchmarkVersion,
    brands: [...results.keys()],
    cases: territories.length,
    pairwise,
    repeatDeterminism: { identical: repeats.filter((r) => r.status === "identical").length, total: repeats.length },
    robustness: { stable: territories.filter((x) => x.robustness.level === "HIGH" || x.robustness.level === "MEDIUM").length, total: territories.length, byLevel },
    insufficientEvidence: territories.filter((x) => x.classification.label === "INSUFFICIENT_EVIDENCE").length,
    unresolvedEntities: { unresolved: unresolvedDetail.length, total: benchmark.brands.length + exemplarStatus.size, detail: unresolvedDetail },
    filter: {
      pairs: effects.length,
      reduced: effects.filter((e) => e.filtered < e.raw).length,
      unchanged: effects.filter((e) => e.filtered === e.raw).length,
      operationalOnly: effects.filter((e) => e.raw > 0 && e.filtered === 0).length,
      examples: [...effects].sort((a, b) => b.raw - b.filtered - (a.raw - a.filtered) || (a.brandKey + a.exemplar < b.brandKey + b.exemplar ? -1 : 1)).slice(0, 5),
      rulePrevalence,
      profiles: profileFilters.length,
    },
    classes: {
      calibration: { agree: subsetCases("calibration").filter((c) => c.agrees).length, total: subsetCases("calibration").length },
      heldOut: { agree: subsetCases("heldOut").filter((c) => c.agrees).length, total: subsetCases("heldOut").length },
      uncertain: territories.filter((x) => x.classification.label === "UNCERTAIN_REPRESENTATION_SENSITIVE").length,
      changesUnderSubstitution: changes,
      territories: territories.length,
    },
    calibration,
    gate: { overall, byBrand, checkPassCounts },
    conditioned: {
      supported: conditioned.filter((c) => c?.support === "SUPPORTED").length,
      sparse: conditioned.filter((c) => c?.support === "SPARSE").length,
      empty: conditioned.filter((c) => c?.support === "EMPTY").length,
      notCollected: conditioned.filter((c) => c === null).length,
      exemplarsFound: conditioned.filter((c) => (c?.declaredExemplarsFound.length ?? 0) > 0).length,
    },
    results,
    checks,
    passed: checks.every((c) => c.passed),
  };
}

const ratio = (s: PairwiseSummary) => `${s.correct}/${s.total - s.unresolved}${s.accuracy === null ? "" : ` = ${s.accuracy.toFixed(3)}`}${s.ties ? ` (${s.ties} ties)` : ""}`;

export function formatElasticityEval(r: ElasticityEvalReport): string {
  const lines = [
    "Cultural Elasticity benchmark — LIVE fixtures replayed OFFLINE (not a new live validation)",
    "",
    `Methodology version: ${r.methodologyVersion}`,
    `Benchmark: ${r.benchmarkVersion} (human-curated labels, not objective truth)`,
    "",
    `Brands: ${r.brands.length} (${r.brands.join(", ")})`,
    `Territories: ${r.cases} brand × territory cases`,
    `Pairwise assertions: ${r.pairwise.all.total}`,
    "",
    `Pairwise accuracy: ${ratio(r.pairwise.all)}`,
    `  calibration brands: ${ratio(r.pairwise.calibration)}`,
    `  held-out brands:    ${ratio(r.pairwise.heldOut)}`,
    `  strong vs weak:     ${ratio(r.pairwise.strongVsWeak)}`,
    `Repeat determinism: ${r.repeatDeterminism.identical}/${r.repeatDeterminism.total} repeat panels identical`,
    `Representation-stable territories (robustness HIGH or MEDIUM): ${r.robustness.stable}/${r.robustness.total}  ${JSON.stringify(r.robustness.byLevel)}`,
    `Insufficient-evidence cases: ${r.insufficientEvidence}`,
    `Unresolved entity rate: ${r.unresolvedEntities.unresolved}/${r.unresolvedEntities.total}${r.unresolvedEntities.detail.length ? ` (${r.unresolvedEntities.detail.join(", ")})` : ""}`,
    `Operational-filter changes: ${r.filter.reduced}/${r.filter.pairs} brand×exemplar overlaps reduced, ${r.filter.unchanged} unchanged, ${r.filter.operationalOnly} entirely operational`,
    `  rule prevalence on brand profiles (of ${r.filter.profiles}): ${JSON.stringify(r.filter.rulePrevalence)}`,
    ...r.filter.examples.map((e) => `  e.g. ${e.brandKey} × ${e.exemplar}: ${e.raw} → ${e.filtered} (removed: ${e.removedShared.join(", ")})`),
    `Class agreement with labels: calibration ${r.classes.calibration.agree}/${r.classes.calibration.total}, held-out ${r.classes.heldOut.agree}/${r.classes.heldOut.total}; UNCERTAIN ${r.classes.uncertain}/${r.classes.territories}`,
    `Class changes under exemplar substitution (per-panel class differs): ${r.classes.changesUnderSubstitution}/${r.classes.territories}`,
    `Calibration (calibration brands only): chosen natural ≥ ${r.calibration.chosen.naturalAdjacencyMin}, break ≤ ${r.calibration.chosen.culturalBreakMax}; grid ${r.calibration.grid.map((g) => `${g.naturalAdjacencyMin}/${g.culturalBreakMax}:${g.agreements}/${g.cases}`).join(" ")}`,
    `Brand-conditioned evidence: ${r.conditioned.supported} supported, ${r.conditioned.sparse} sparse, ${r.conditioned.empty} empty, ${r.conditioned.notCollected} not collected; declared exemplars returned in ${r.conditioned.exemplarsFound}`,
    `Score gate: ${r.gate.overall}  (per check, brands passing: ${Object.entries(r.gate.checkPassCounts).map(([id, n]) => `${id} ${n}/${r.brands.length}`).join(", ")})`,
    ...r.gate.byBrand.map((b) => `  ${b.brandKey}: ${b.status}${b.failing.length ? ` (${b.failing.join(", ")})` : ""}`),
    `Relative Elasticity Index decision: ${RELATIVE_INDEX_DECISION.decision}`,
    "",
    "Pairwise misses:",
    ...(r.pairwise.failures.length ? r.pairwise.failures.map((f) => `  ${f}`) : ["  none"]),
    "",
    "Per-brand order (median panel percentile, robustness, class):",
    ...[...r.results.entries()].map(
      ([key, res]) => `  ${key}: ${res.territories.map((x) => `${x.territory.id} ${x.relativePosition.medianPercentile ?? "n/a"} ${x.robustness.level} ${x.classification.label}`).join(" | ")}`,
    ),
    "",
    "Structural checks:",
    ...r.checks.map((c) => `  ${c.passed ? "PASS" : "FAIL"} ${c.id}${c.passed ? "" : ` (${c.detail})`}`),
    `  ${r.checks.filter((c) => c.passed).length}/${r.checks.length} passed`,
  ];
  return lines.join("\n");
}
