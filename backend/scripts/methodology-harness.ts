/**
 * Offline methodology evaluation harness.
 *
 * Loads SYNTHETIC fixtures, validates their EvidencePackets, runs the Cultural Evidence Core, and
 * checks deterministic properties plus forbidden behaviours. It tests the engine's analytical
 * correctness. It says nothing about live Qloo evidence, and its results must never be reported as
 * Qloo validation.
 *
 * Later, recorded and live fixture classes can be added as further loaders with their own checks.
 * The checks below are about engine behaviour, not about any particular brand result.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AnalysisIngredients, Ingredient } from "@cultural-elasticity/shared";
import { z } from "zod";
import { computeAnalysisIngredients } from "../src/analysis/ingredients.js";
import { findInvariantViolations } from "../src/analysis/validate.js";
import { normalizeEvidencePacket } from "../src/evidence/normalize.js";
import { mergeProvenance, provenanceKey } from "../src/evidence/provenance.js";
import { parseEvidencePacket, type EvidenceIssue, type EvidencePacket } from "../src/evidence/schema.js";

export const SYNTHETIC_FIXTURES_DIR = fileURLToPath(new URL("../../evals/fixtures/synthetic/", import.meta.url));
export const SYNTHETIC_PROVENANCE_SOURCE = "synthetic-fixture";

const syntheticFixtureSchema = z.strictObject({
  fixtureType: z.literal("synthetic"),
  notice: z.string().startsWith("SYNTHETIC"),
  caseId: z.string().regex(/^[A-Z]$/),
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  expectedProperties: z.array(z.string()),
  packet: z.unknown(),
});

export type LoadedFixture = {
  file: string;
  caseId: string;
  name: string;
  title: string;
  packet?: EvidencePacket;
  issues: EvidenceIssue[];
};

export type FixtureResult = LoadedFixture & { ingredients?: AnalysisIngredients };

export type CheckResult = { id: string; description: string; passed: boolean; detail: string };

export type MethodologyEvalReport = {
  fixtureClass: "synthetic";
  fixtures: FixtureResult[];
  checks: CheckResult[];
  passed: boolean;
};

export function loadSyntheticFixtures(dir: string = SYNTHETIC_FIXTURES_DIR): LoadedFixture[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => loadFixture(join(dir, file), file));
}

function loadFixture(path: string, file: string): LoadedFixture {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { file, caseId: "?", name: file, title: file, issues: [{ path: "(file)", message: `unreadable JSON: ${(error as Error).message}` }] };
  }
  const envelope = syntheticFixtureSchema.safeParse(raw);
  if (!envelope.success) {
    return { file, caseId: "?", name: file, title: file, issues: envelope.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  }
  const { caseId, name, title } = envelope.data;
  const parsed = parseEvidencePacket(envelope.data.packet);
  if (!parsed.ok) return { file, caseId, name, title, issues: parsed.issues };

  const issues: EvidenceIssue[] = [];
  if (parsed.packet.origin !== "synthetic") issues.push({ path: "packet.origin", message: "synthetic fixtures must declare origin \"synthetic\"" });
  for (const source of provenanceSources(parsed.packet)) {
    if (source !== SYNTHETIC_PROVENANCE_SOURCE) issues.push({ path: "packet", message: `synthetic fixture cites provenance source "${source}"` });
  }
  return issues.length > 0 ? { file, caseId, name, title, issues } : { file, caseId, name, title, packet: parsed.packet, issues };
}

/** Every `source` string under any provenance list, so synthetic data can never cite a real provider. */
function provenanceSources(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => provenanceSources(item, out));
  else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.source === "string" && typeof record.operation === "string") out.add(record.source);
    Object.values(record).forEach((child) => provenanceSources(child, out));
  }
  return out;
}

export function analyze(packet: EvidencePacket): AnalysisIngredients {
  return computeAnalysisIngredients(normalizeEvidencePacket(packet));
}

/** Same evidence, every list reversed: a deterministic engine must not notice. */
export function permutePacket(packet: EvidencePacket): EvidencePacket {
  const copy = structuredClone(packet);
  const reverseProfile = (profile: EvidencePacket["brand"]) => {
    profile.signals.reverse();
    profile.provenance.reverse();
    for (const signal of profile.signals) signal.provenance.reverse();
  };
  reverseProfile(copy.brand);
  reverseProfile(copy.target);
  copy.ranking?.candidates.reverse();
  copy.audience?.interpretableMetrics.reverse();
  copy.bridges?.forEach((bridge) => bridge.signals.reverse());
  copy.provenance.reverse();
  return copy;
}

type Results = Map<string, AnalysisIngredients>;
type Check = { id: string; description: string; run: (results: Results, fixtures: FixtureResult[]) => string | true };

const need = (results: Results, caseId: string): AnalysisIngredients => {
  const result = results.get(caseId);
  if (!result) throw new Error(`case ${caseId} is missing or invalid`);
  return result;
};

const isWithheld = (ingredient: Ingredient<unknown>, status?: string) => ingredient.value === null && (status === undefined || ingredient.status === status);

const codes = (result: AnalysisIngredients) => new Set(result.limitations.map((l) => l.code));

export const CHECKS: Check[] = [
  {
    id: "fixtures.all_valid",
    description: "every synthetic fixture validates and is labelled synthetic",
    run: (_r, fixtures) => {
      const invalid = fixtures.filter((f) => !f.packet);
      return invalid.length === 0 || `invalid: ${invalid.map((f) => `${f.file} (${f.issues[0]?.path}: ${f.issues[0]?.message})`).join("; ")}`;
    },
  },
  {
    id: "fixtures.minimum_cases",
    description: "cases A–J are all present",
    run: (results) => {
      const missing = "ABCDEFGHIJ".split("").filter((id) => !results.has(id));
      return missing.length === 0 || `missing cases: ${missing.join(", ")}`;
    },
  },
  {
    id: "overlap.ordering",
    description: "high-overlap A > moderate B > low C in shared signal count and Jaccard",
    run: (results) => {
      const [a, b, c] = ["A", "B", "C"].map((id) => need(results, id).overlap);
      const ok = a!.sharedSignalCount > b!.sharedSignalCount && b!.sharedSignalCount > c!.sharedSignalCount && a!.jaccard! > b!.jaccard! && b!.jaccard! > c!.jaccard!;
      return ok || `shared ${a!.sharedSignalCount}/${b!.sharedSignalCount}/${c!.sharedSignalCount}, jaccard ${a!.jaccard}/${b!.jaccard}/${c!.jaccard}`;
    },
  },
  {
    id: "weighted.available_only_when_comparable",
    description: "A's verified same-scale values give a weighted overlap; B (no values) is insufficient_evidence, not 0",
    run: (results) => {
      const a = need(results, "A").overlap.weightedSharedOverlap;
      const b = need(results, "B").overlap.weightedSharedOverlap;
      return (a.status === "available" && isWithheld(b, "insufficient_evidence")) || `A: ${a.status}, B: ${b.status} (${String(b.value)})`;
    },
  },
  {
    id: "audience.missing_is_unavailable",
    description: "D (no audience) → audience unavailable and audienceMetrics null, not 0",
    run: (results) => {
      const d = need(results, "D");
      return (d.audience.status === "unavailable" && isWithheld(d.distanceProxy.audienceMetrics, "unavailable")) || `status ${d.audience.status}`;
    },
  },
  {
    id: "bridges.missing_is_unavailable",
    description: "E (no bridges) → bridge evidence unavailable and bridgeSignalCount null, not 0",
    run: (results) => {
      const e = need(results, "E");
      return (e.bridges.status === "unavailable" && e.bridges.signalCount === null && isWithheld(e.distanceProxy.bridgeSignalCount, "unavailable")) || `status ${e.bridges.status}, count ${e.bridges.signalCount}`;
    },
  },
  {
    id: "quality.truncation_surfaced",
    description: "F (truncated) → quality surfaces truncation and overlap ingredients carry it",
    run: (results) => {
      const f = need(results, "F");
      const c = codes(f);
      const jaccardCodes = f.distanceProxy.jaccardOverlap.limitations.map((l) => l.code);
      const ok = c.has("BRAND_PROFILE_TRUNCATED") && c.has("TARGET_PROFILE_TRUNCATED") && f.evidenceQuality.indicators.profileCoverage.level === "limited" && jaccardCodes.includes("TARGET_PROFILE_TRUNCATED");
      return ok || `codes: ${[...c].join(", ")}; profileCoverage ${f.evidenceQuality.indicators.profileCoverage.level}`;
    },
  },
  {
    id: "comparability.conflicting_scales_refused",
    description: "G (different scales) → weighted overlap not_comparable with a null value",
    run: (results) => {
      const w = need(results, "G").overlap.weightedSharedOverlap;
      return isWithheld(w, "not_comparable") || `status ${w.status}`;
    },
  },
  {
    id: "audience.opaque_not_promoted",
    description: "G → opaque numeric fields are listed but never become metrics; the neutral metric is not usable",
    run: (results) => {
      const audience = need(results, "G").audience;
      const metricIds = audience.metrics.map((m) => m.id);
      const promoted = audience.opaqueFields.numericPaths.filter((path) => metricIds.includes(path));
      const ok =
        audience.opaqueFields.numericPaths.length > 0 &&
        promoted.length === 0 &&
        audience.metrics.every((m) => !m.usableAsIngredient) &&
        audience.status === "insufficient_evidence" &&
        isWithheld(need(results, "G").distanceProxy.audienceMetrics);
      return ok || `status ${audience.status}, numericPaths ${audience.opaqueFields.numericPaths.join(",")}`;
    },
  },
  {
    id: "ranking.cross_call_refused",
    description: "H (candidates from two calls) → relative ranking refused, percentile null",
    run: (results) => {
      const h = need(results, "H");
      const ok = h.ranking.status === "not_comparable" && h.ranking.scope?.verified === false && isWithheld(h.distanceProxy.relativeRankPercentile, "not_comparable") && h.ranking.target !== null && isWithheld(h.ranking.target.rankPosition);
      return ok || `ranking ${h.ranking.status}, percentile ${h.distanceProxy.relativeRankPercentile.status}`;
    },
  },
  {
    id: "ranking.single_call_positions",
    description: "A/B/C single-call rankings give percentiles 1 (top), 0.5 (middle), 0 (bottom)",
    run: (results) => {
      const p = ["A", "B", "C"].map((id) => need(results, id).distanceProxy.relativeRankPercentile.value);
      return (p[0] === 1 && p[1] === 0.5 && p[2] === 0) || `percentiles ${p.join(", ")}`;
    },
  },
  {
    id: "quality.missing_provenance",
    description: "I (missing provenance) → provenance insufficient and overall LOW",
    run: (results) => {
      const i = need(results, "I");
      const c = codes(i);
      const ok = i.evidenceQuality.indicators.provenance.level === "insufficient" && c.has("MISSING_PROVENANCE") && c.has("MISSING_CORRELATION_ID") && i.evidenceQuality.overall.level === "LOW";
      return ok || `provenance ${i.evidenceQuality.indicators.provenance.level}, overall ${i.evidenceQuality.overall.level}`;
    },
  },
  {
    id: "overlap.empty_target_not_zero",
    description: "J (empty target) → overlap ratios and shared count are null/insufficient_evidence, not 0",
    run: (results) => {
      const j = need(results, "J");
      const dp = j.distanceProxy;
      const ok =
        j.overlap.status === "insufficient_evidence" &&
        j.overlap.jaccard === null &&
        isWithheld(dp.jaccardOverlap, "insufficient_evidence") &&
        isWithheld(dp.sharedSignalCount, "insufficient_evidence") &&
        isWithheld(dp.overlapCoefficient) &&
        j.evidenceQuality.overall.level === "LOW";
      return ok || `overlap ${j.overlap.status}, sharedSignalCount ${dp.sharedSignalCount.status}`;
    },
  },
  {
    id: "quality.discriminates",
    description: "complete evidence (A) is HIGH; refused comparisons (G, H) cap at MEDIUM; weak evidence (I, J) is LOW; absent optional evidence (D, E) stays HIGH",
    run: (results) => {
      const expected: Record<string, string> = { A: "HIGH", D: "HIGH", E: "HIGH", G: "MEDIUM", H: "MEDIUM", I: "LOW", J: "LOW" };
      const wrong = Object.entries(expected).filter(([id, level]) => need(results, id).evidenceQuality.overall.level !== level);
      return wrong.length === 0 || wrong.map(([id, level]) => `${id}: expected ${level}, got ${need(results, id).evidenceQuality.overall.level}`).join("; ");
    },
  },
  {
    id: "forbidden.invariants",
    description: "no NaN/Infinity, no withheld ingredient with a value, no score/elasticity/confidence keys (all cases)",
    run: (results) => {
      const failures = [...results].flatMap(([id, r]) => findInvariantViolations(r).map((v) => `${id} ${v.path}: ${v.message}`));
      return failures.length === 0 || failures.slice(0, 5).join("; ");
    },
  },
  {
    id: "forbidden.no_distance_formula",
    description: "distance proxy declares no formula in every case",
    run: (results) => {
      const bad = [...results].filter(([, r]) => r.distanceProxy.formula !== "NOT_DEFINED").map(([id]) => id);
      return bad.length === 0 || `cases with a formula: ${bad.join(", ")}`;
    },
  },
  {
    id: "provenance.synthetic_only",
    description: "every result is marked synthetic and cites only synthetic provenance",
    run: (results) => {
      const bad = [...results].filter(([, r]) => r.evidenceOrigin !== "synthetic" || r.provenance.some((p) => p.source !== SYNTHETIC_PROVENANCE_SOURCE)).map(([id]) => id);
      return bad.length === 0 || `non-synthetic origin or provenance in: ${bad.join(", ")}`;
    },
  },
  {
    id: "provenance.shared_signals_trace_both_sides",
    description: "each shared signal's provenance is exactly the union of its brand-side and target-side observations",
    run: (_r, fixtures) => {
      const bad: string[] = [];
      for (const f of fixtures) {
        if (!f.packet || !f.ingredients) continue;
        for (const shared of f.ingredients.overlap.shared) {
          const sources = [f.packet.brand, f.packet.target].flatMap((p) => p.signals.filter((s) => s.id === shared.id).map((s) => s.provenance));
          const expected = mergeProvenance(...sources).map(provenanceKey);
          if (JSON.stringify(shared.provenance.map(provenanceKey)) !== JSON.stringify(expected)) bad.push(`${f.caseId}:${shared.id}`);
        }
      }
      return bad.length === 0 || `provenance mismatch: ${bad.slice(0, 5).join(", ")}`;
    },
  },
  {
    id: "determinism.order_independent",
    description: "reversing every input list yields identical AnalysisIngredients (all cases)",
    run: (_r, fixtures) => {
      const bad = fixtures.filter((f) => f.packet && JSON.stringify(analyze(permutePacket(f.packet))) !== JSON.stringify(f.ingredients)).map((f) => f.caseId);
      return bad.length === 0 || `order-dependent: ${bad.join(", ")}`;
    },
  },
];

export function runMethodologyEval(fixtures: LoadedFixture[] = loadSyntheticFixtures()): MethodologyEvalReport {
  const results: FixtureResult[] = fixtures.map((fixture) => (fixture.packet ? { ...fixture, ingredients: analyze(fixture.packet) } : fixture));
  const byCase: Results = new Map(results.flatMap((r) => (r.ingredients ? [[r.caseId, r.ingredients] as const] : [])));
  const checks = CHECKS.map(({ id, description, run }) => {
    let outcome: string | true;
    try {
      outcome = run(byCase, results);
    } catch (error) {
      outcome = (error as Error).message;
    }
    return { id, description, passed: outcome === true, detail: outcome === true ? "ok" : outcome };
  });
  return { fixtureClass: "synthetic", fixtures: results, checks, passed: checks.every((check) => check.passed) };
}

export function formatReport(report: MethodologyEvalReport): string {
  const lines = ["Methodology eval: offline, SYNTHETIC fixtures only (this is not Qloo validation)", ""];
  const valid = report.fixtures.filter((f) => f.ingredients).length;
  lines.push(`Fixtures: ${report.fixtures.length} loaded, ${valid} valid`);
  for (const f of report.fixtures) {
    if (!f.ingredients) {
      lines.push(`  ✗ ${f.file}: ${f.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
      continue;
    }
    const r = f.ingredients;
    const fmt = (i: Ingredient<number>) => (i.value === null ? i.status : Number(i.value.toFixed(3)).toString());
    lines.push(
      `  ${f.caseId} ${f.name.padEnd(20)} shared=${fmt(r.distanceProxy.sharedSignalCount).padEnd(21)} jaccard=${fmt(r.distanceProxy.jaccardOverlap).padEnd(21)} ` +
        `rank%=${fmt(r.distanceProxy.relativeRankPercentile).padEnd(21)} quality=${r.evidenceQuality.overall.level}`,
    );
  }
  const passed = report.checks.filter((c) => c.passed).length;
  lines.push("", `Checks: ${passed}/${report.checks.length} passed`);
  for (const c of report.checks) lines.push(`  ${c.passed ? "✓" : "✗"} ${c.id}: ${c.description}${c.passed ? "" : `\n      → ${c.detail}`}`);
  lines.push("", "LIVE_QLOO_VALIDATION_NOT_RUN: these results describe engine behaviour on synthetic data only.");
  return lines.join("\n");
}
