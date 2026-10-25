/**
 * Builds the recorded brand research shown by the product without a provider call.
 *
 * Usage: pnpm --filter backend exec tsx scripts/demo/build-recorded-baseline.ts
 * The source is a stored live canary record. Its observations are re-projected offline by the current
 * baseline code (a derived artifact with `execution.derivedFrom`); the stored as-run result is untouched.
 * The output is validated by the backend result schema and carries the source file's SHA-256.
 * It does not call Qloo or a model. Only real captured evidence may be listed here: never a synthetic fixture
 * and never benchmark profiles (those are evaluation inputs, not product evidence).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { brandBaselineResultSchema } from "../../src/brand-baseline/schema.js";
import { replayCanary } from "../brand-baseline-eval/replay.js";

const SECRET = /sk-ant-|api[_-]?key|authorization|bearer\s+|QLOO_API_KEY|ANTHROPIC_API_KEY|x-baseline-token|accessToken/iu;
const root = new URL("../../../", import.meta.url);
const SOURCES = [{ key: "loewe", fixture: "evals/fixtures/live/loewe-baseline-canary-2.live.json" }] as const;

const items = SOURCES.map(({ key, fixture }) => {
  const replay = replayCanary(fixture);
  const result = brandBaselineResultSchema.parse(replay.result);
  return {
    key,
    kind: "RECORDED_BASELINE" as const,
    evidenceOrigin: "live" as const,
    recordedAt: result.brand.source.capturedAt,
    sourceFixture: fixture,
    sourceSha256: createHash("sha256").update(readFileSync(new URL(fixture, root))).digest("hex"),
    note: "Recorded from a live Qloo baseline scan and re-read with the current method. Opening it does not call Qloo.",
    result,
  };
});

const output = JSON.stringify({ kind: "RECORDED_BASELINE_CATALOG", items }, null, 2) + "\n";
if (SECRET.test(output)) throw new Error("RECORDED_BASELINE_CONTAINS_SECRET_PATTERN");
const target = fileURLToPath(new URL("frontend/src/demo/recorded-baselines.json", root));
writeFileSync(target, output);
console.log(`Wrote ${items.length} recorded baseline(s) to ${target}`);
