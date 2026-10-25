/**
 * Offline replay of RECORDED live Qloo evidence through the current projection. No Qloo or model call:
 * the inputs are frozen files. The stored as-run result is read, never modified. Evaluation code only.
 */
import { readFileSync } from "node:fs";
import { BRAND_BASELINE_LEGACY_TEMPLATE_VERSION, type BrandBaselineResult } from "@cultural-elasticity/shared";
import { buildBaselineResult, observationFromArtifact, type BaselineObservation } from "../../src/brand-baseline/research.js";
import { baselineObservationSchema } from "../../src/brand-baseline/schema.js";
import type { CulturalSignal, ResolvedConcept } from "../../src/contracts/qloo.js";

const root = new URL("../../../", import.meta.url);
const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8")) as Record<string, unknown>;

type CanaryFixture = {
  fixtureType: "live_qloo_canary_record";
  source: { scanId: string };
  brand: { name: string; qlooId: string; describeCorrelationId: string };
  observations: { stage: string; schemaVersion: string; payload: unknown }[];
  asRunResult?: { schemaVersion: string; payload: Record<string, unknown> };
};

const brandConcept = (name: string, qlooId: string, correlationId: string): ResolvedConcept => ({
  kind: "entity", input: name, label: name, qlooId, type: "urn:entity:brand", confirmation: "unambiguous", alternatives: [],
  provenance: [{ operation: "describe", correlationId, status: "ok", warnings: [], degraded: false, partial: false }],
});

export type Replay = { label: string; evidence: "LIVE_RECORDED_REPLAY"; brand: { brandQlooId: string; describeCorrelationId: string }; observations: BaselineObservation[]; result: BrandBaselineResult; asRun?: Record<string, unknown> };

/** A stored scan, re-projected as a separate derived artifact with lineage. */
export function replayCanary(path: string): Replay {
  const fixture = readJson(path) as CanaryFixture;
  if (fixture.fixtureType !== "live_qloo_canary_record") throw new Error("NOT_A_CANARY_RECORD");
  const observations = fixture.observations.map((item) => observationFromArtifact(baselineObservationSchema.parse(item.payload), item.schemaVersion));
  const asRun = fixture.asRunResult?.payload;
  const execution = (asRun?.execution ?? {}) as Record<string, unknown>;
  const result = buildBaselineResult({
    scanId: fixture.source.scanId,
    brandId: (asRun?.brand as { id?: string } | undefined)?.id ?? "00000000-0000-4000-8000-000000000000",
    brand: brandConcept(fixture.brand.name, fixture.brand.qlooId, fixture.brand.describeCorrelationId),
    brandCapturedAt: (asRun?.brand as { source?: { capturedAt?: string } } | undefined)?.source?.capturedAt ?? observations[0]?.capturedAt ?? "2026-10-25T00:00:00.000Z",
    observations,
    startedAt: typeof execution.startedAt === "string" ? execution.startedAt : observations[0]?.capturedAt ?? "2026-10-25T00:00:00.000Z",
    finishedAt: typeof execution.finishedAt === "string" ? execution.finishedAt : observations.at(-1)?.capturedAt ?? "2026-10-25T00:00:00.000Z",
    providerCallCount: typeof execution.providerCallCount === "number" ? execution.providerCallCount : observations.length,
    recordedOrLive: "recorded",
    templateVersion: BRAND_BASELINE_LEGACY_TEMPLATE_VERSION,
    derivedFrom: { scanId: fixture.source.scanId, schemaVersion: fixture.asRunResult?.schemaVersion ?? "none (scan interrupted before a result)", note: "Offline re-projection of stored observations. The stored as-run result is unchanged." },
  });
  return { label: path, evidence: "LIVE_RECORDED_REPLAY", brand: { brandQlooId: fixture.brand.qlooId, describeCorrelationId: fixture.brand.describeCorrelationId }, observations, result, ...(asRun ? { asRun } : {}) };
}

/**
 * Tag-only replay of a recorded take-20 brand profile (Sprint 0B methodology evidence). It shows how the
 * v2 tag rules classify real profiles; it has no recommendation stages and is not a baseline scan.
 */
export function replayRecordedProfile(path: string): Replay {
  const fixture = readJson(path) as { brandKey: string; input: { brand: { subject: { id: string; label: string }; signals: { id: string; label: string; category?: string }[]; provenance: { correlationId: string; capturedAt: string }[] } } };
  const profile = fixture.input.brand;
  const source = profile.provenance[0]!;
  const tags: CulturalSignal[] = profile.signals.map((signal) => ({ kind: "tag", qlooId: signal.id, label: signal.label, ...(signal.category ? { type: signal.category } : {}), sourceCorrelationId: source.correlationId }));
  const observations: BaselineObservation[] = [{ domain: "tags", capturedAt: source.capturedAt, outcome: { kind: "ok", data: { subjects: [], tags }, provenance: { operation: "entity_tags", correlationId: source.correlationId, status: "ok", warnings: [], degraded: false, partial: false } } }];
  const describeCorrelationId = "recorded-profile-identity-not-in-fixture";
  const result = buildBaselineResult({
    scanId: "00000000-0000-4000-8000-0000000000aa", brandId: "00000000-0000-4000-8000-0000000000ab",
    brand: brandConcept(profile.subject.label, profile.subject.id, describeCorrelationId), brandCapturedAt: source.capturedAt,
    observations, startedAt: source.capturedAt, finishedAt: source.capturedAt, providerCallCount: 1, recordedOrLive: "recorded",
  });
  return { label: fixture.brandKey, evidence: "LIVE_RECORDED_REPLAY", brand: { brandQlooId: profile.subject.id, describeCorrelationId }, observations, result };
}

export const CANARY_FIXTURES = ["evals/fixtures/live/loewe-baseline-canary-2.live.json", "evals/fixtures/live/loewe-baseline-canary-1.live.json"] as const;
export const RECORDED_PROFILE_FIXTURES = ["alienware", "jacquemus", "lululemon", "muji", "nintendo", "patagonia"].map((key) => `evals/benchmarks/cultural-elasticity-v0/evidence/${key}.live.json`);
