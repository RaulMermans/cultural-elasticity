/**
 * Evaluation over LIVE and RECORDED fixture classes. Kept apart from the SYNTHETIC methodology eval:
 *   - LIVE: sanitized evidence captured from the Qloo hackathon API (evals/fixtures/live/*.live.json);
 *   - RECORDED: historical Sprint 0A harness captures made offline without a credential.
 * Assertions are about stable structure (identity, scope, provenance, availability), never about
 * exact floating-point values, which can change between live captures.
 * Running this makes no network request.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AnalysisIngredients } from "@cultural-elasticity/shared";
import { analyzeEvidencePacket } from "../src/analysis/ingredients.js";
import { parseEvidencePacket, type EvidencePacket } from "../src/evidence/schema.js";
import { LIVE_INVESTIGATION } from "../src/feasibility/live-config.js";
import { QLOO_LIVE_SOURCE } from "../src/qloo/live-adapter.js";
import { liveFixtureSchema, LIVE_FIXTURES_DIR, type LiveFixture } from "./live-fixture.js";

export const RECORDED_FIXTURES_DIR = fileURLToPath(new URL("../tests/fixtures/recorded/", import.meta.url));

export type CheckResult = { id: string; description: string; passed: boolean; detail: string };
export type FixtureClassReport = { fixtureClass: "live" | "recorded"; files: string[]; checks: CheckResult[]; passed: boolean };

function sources(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => sources(v, out));
  else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.source === "string" && typeof record.operation === "string") out.add(record.source);
    Object.values(record).forEach((v) => sources(v, out));
  }
  return out;
}

const check = (id: string, description: string, run: () => true | string): CheckResult => {
  try {
    const outcome = run();
    return { id, description, passed: outcome === true, detail: outcome === true ? "ok" : outcome };
  } catch (error) {
    return { id, description, passed: false, detail: (error as Error).message };
  }
};

/** Key-shaped strings or header literals must never appear in a fixture. */
const FORBIDDEN = [/x-api-key/i, /QLOO_API_KEY\s*[=:]\s*\S{8,}/, /"(address|phone|images?)"\s*:/];

export function runLiveEval(dir: string = LIVE_FIXTURES_DIR): FixtureClassReport {
  const files = readdirSync(dir).filter((f) => f.endsWith(".live.json")).sort();
  const checks: CheckResult[] = [check("live.present", "at least one live fixture exists", () => files.length > 0 || "no *.live.json in evals/fixtures/live")];
  for (const file of files) {
    const text = readFileSync(join(dir, file), "utf8");
    let fixture: LiveFixture | undefined;
    let packet: EvidencePacket | undefined;
    let ingredients: AnalysisIngredients | undefined;
    checks.push(
      check(`${file}.schema`, "fixture envelope is fixtureType live, hackathon environment", () => {
        fixture = liveFixtureSchema.parse(JSON.parse(text));
        return true;
      }),
    );
    if (!fixture) continue;
    const f = fixture;
    checks.push(
      check(`${file}.sanitized`, "no credential, header or personal/location fields", () => {
        const hit = FORBIDDEN.find((p) => p.test(text));
        return hit === undefined || `matches ${hit}`;
      }),
      check(`${file}.packet`, "packet validates as origin=live", () => {
        const parsed = parseEvidencePacket(f.packet);
        if (!parsed.ok) return parsed.issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join("; ");
        packet = parsed.packet;
        return packet.origin === "live" || `origin ${packet.origin}`;
      }),
    );
    if (!packet) continue;
    const p = packet;
    checks.push(
      check(`${file}.provenance`, "every provenance ref cites the hackathon API source and a correlation id", () => {
        const s = [...sources(p)];
        if (s.some((x) => x !== QLOO_LIVE_SOURCE)) return `sources: ${s.join(", ")}`;
        const refs = JSON.stringify(p).match(/"source":"[^"]+","operation":"[^"]+"(?!,"correlationId")/g);
        return refs === null || `${refs.length} ref(s) without correlationId`;
      }),
      check(`${file}.identity`, "brand and target are the pinned entities", () =>
        (p.brand.subject.id === LIVE_INVESTIGATION.brand.id && p.target.subject.id === LIVE_INVESTIGATION.territory.pinnedTag.id) || `${p.brand.subject.id} / ${p.target.subject.id}`,
      ),
      check(`${file}.affinity_scope`, "brand values are within_call with no invented scale", () =>
        p.brand.signals.every((s) => s.numeric === undefined || (s.numeric.comparisonScope === "within_call" && s.numeric.scale === undefined)) || "scope/scale violated",
      ),
      check(`${file}.target_derived`, "target profile is derived: no numeric values, ≥ 5 signals, documented in limitations", () =>
        (p.target.signals.every((s) => s.numeric === undefined) && p.target.signals.length >= 5 && p.limitations.some((l) => l.code === "TARGET_IS_DERIVED_REPRESENTATION")) || `signals ${p.target.signals.length}`,
      ),
      check(`${file}.audience_opaque`, "audience evidence promotes no interpretable metric", () =>
        p.audience === undefined || p.audience.interpretableMetrics.length === 0 || "an audience metric was promoted",
      ),
      check(`${file}.engine`, "the Cultural Evidence Core runs on the live packet", () => {
        ingredients = analyzeEvidencePacket(p);
        return ingredients.evidenceOrigin === "live" || ingredients.evidenceOrigin;
      }),
    );
    if (!ingredients) continue;
    const i = ingredients;
    checks.push(
      check(`${file}.no_score`, "ingredients contain no score, weight or recommendation", () => !/"(elasticity|distance)?score"|"weights?"|"recommendation"/i.test(JSON.stringify(i)) || "score-like field present"),
      check(`${file}.overlap`, "overlap is available and Jaccard is a set ratio in [0,1]", () => (i.overlap.status === "available" && i.overlap.jaccard !== null && i.overlap.jaccard >= 0 && i.overlap.jaccard <= 1) || i.overlap.status),
      check(`${file}.weighted_refused`, "cross-profile weighted overlap is withheld (values come from different calls)", () => i.overlap.weightedSharedOverlap.value === null || "weighted overlap computed across calls"),
      check(`${file}.stability`, "top-N stability is reported at N = 5, 10, 15, 20", () => JSON.stringify(i.stability.points.map((x) => x.n)) === "[5,10,15,20]" || JSON.stringify(i.stability.points.map((x) => x.n))),
      check(`${file}.ranking_scope`, "ranking is a verified single call", () => (i.ranking.scope?.verified === true) || `ranking ${i.ranking.status}`),
      check(`${file}.audience_insufficient`, "audience ingredient is not available (no documented metric)", () => i.audience.status !== "available" || "audience available"),
      check(`${file}.bridges`, "bridge evidence is observed; its values stay within_call and no bridge strength exists", () => {
        if (i.bridges.status !== "available") return `bridges ${i.bridges.status}`;
        if (i.bridges.signals.some((s) => s.numeric !== undefined && (s.numeric.comparisonScope !== "within_call" || s.numeric.scale !== undefined))) return "bridge value with non-call scope or invented scale";
        return !/strength/i.test(JSON.stringify(i.bridges)) || "strength field present";
      }),
      check(`${file}.gates`, "core gates G1 and G2 pass in the captured run", () => (["G1", "G2"].every((id) => f.gates.find((g) => g.id === id)?.status === "PASS")) || JSON.stringify(f.gates.map((g) => [g.id, g.status]))),
    );
  }
  return { fixtureClass: "live", files, checks, passed: checks.every((c) => c.passed) };
}

export function runRecordedEval(dir: string = RECORDED_FIXTURES_DIR): FixtureClassReport {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const checks = files.map((file) =>
    check(`${file}.historical`, "recorded harness capture is labelled and made no credentialed request", () => {
      const json = JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, unknown>;
      const meta = json._recorded as Record<string, unknown> | undefined;
      if (!meta?.recordedAt) return "missing _recorded metadata";
      const text = JSON.stringify(json);
      if (text.includes("production_server") && typeof meta.historical !== "string") return "mentions production_server without a historical label";
      return !/x-api-key/i.test(text) || "header literal present";
    }),
  );
  return { fixtureClass: "recorded", files, checks, passed: checks.every((c) => c.passed) };
}

export function formatClassReport(report: FixtureClassReport): string {
  const header = report.fixtureClass === "live" ? "LIVE fixtures (Qloo hackathon API captures; structural checks, offline)" : "RECORDED fixtures (historical Sprint 0A harness captures, no credential)";
  const lines = [header, `  files: ${report.files.join(", ") || "none"}`];
  for (const c of report.checks) lines.push(`  ${c.passed ? "PASS" : "FAIL"} ${c.id} — ${c.description}${c.passed ? "" : ` (${c.detail})`}`);
  lines.push(`  ${report.checks.filter((c) => c.passed).length}/${report.checks.length} passed`);
  return lines.join("\n");
}
