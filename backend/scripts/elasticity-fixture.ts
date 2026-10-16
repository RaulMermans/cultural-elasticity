/**
 * Live methodology fixtures (evals/benchmarks/cultural-elasticity-v0/evidence/<brand>.live.json).
 * Sanitized, canonical MethodologyInput captured from the Qloo hackathon API by
 * `pnpm capture:elasticity -- --write-fixtures`. No key, headers, raw payloads, addresses or images.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { QLOO_HACKATHON_ORIGIN } from "../src/qloo/environment.js";
import { QLOO_LIVE_SOURCE } from "../src/qloo/live-adapter.js";

export const BENCHMARK_DIR = fileURLToPath(new URL("../../evals/benchmarks/cultural-elasticity-v0/", import.meta.url));
export const BENCHMARK_FILE = join(BENCHMARK_DIR, "benchmark.json");
export const EVIDENCE_DIR = join(BENCHMARK_DIR, "evidence");

export const elasticityFixtureSchema = z.strictObject({
  fixtureType: z.literal("live"),
  notice: z.string().startsWith("LIVE"),
  brandKey: z.string().min(1),
  captureDate: z.iso.datetime({ offset: true }),
  apiEnvironment: z.literal(QLOO_HACKATHON_ORIGIN),
  harnessVersion: z.string(),
  provenanceSource: z.literal(QLOO_LIVE_SOURCE),
  sourceOperations: z.array(z.strictObject({ id: z.string(), operation: z.string(), outcome: z.string(), correlationId: z.string().optional() })),
  /** Validated as a MethodologyInput by the consumer. */
  input: z.unknown(),
});
export type ElasticityFixture = z.infer<typeof elasticityFixtureSchema>;

export const FIXTURE_NOTICE =
  "LIVE: sanitized evidence captured from the Qloo hackathon API. Affinity values are comparable only within one call (same correlationId); ranks are compared across panels, values never are.";

export function fixturePath(brandKey: string): string {
  return join(EVIDENCE_DIR, `${brandKey}.live.json`);
}

export function loadElasticityFixtures(dir: string = EVIDENCE_DIR): ElasticityFixture[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".live.json"))
    .sort()
    .map((file) => elasticityFixtureSchema.parse(JSON.parse(readFileSync(join(dir, file), "utf8"))));
}

export type FixtureStep = { id: string; operation: string; outcome: string; correlationId?: string };

export function buildElasticityFixture(args: { brandKey: string; capturedAt: string; apiEnvironment: string; harnessVersion: string; steps: FixtureStep[]; input: unknown }): ElasticityFixture {
  return elasticityFixtureSchema.parse({
    fixtureType: "live",
    notice: FIXTURE_NOTICE,
    brandKey: args.brandKey,
    captureDate: args.capturedAt,
    apiEnvironment: args.apiEnvironment,
    harnessVersion: args.harnessVersion,
    provenanceSource: QLOO_LIVE_SOURCE,
    sourceOperations: args.steps.map((s) => ({ id: s.id, operation: s.operation, outcome: s.outcome, ...(s.correlationId && { correlationId: s.correlationId }) })),
    input: args.input,
  });
}
