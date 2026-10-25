import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBaselineResult, groundEntityType, observationFromArtifact, tagRole } from "../src/brand-baseline/research.js";
import { baselineObservationSchema, legacyBrandBaselineResultSchema, storedBrandBaselineResultSchema } from "../src/brand-baseline/schema.js";
import { toEntitySignals, parseEnvelope } from "../src/qloo/normalize.js";
import { integrityChecks, usefulnessChecks } from "../scripts/brand-baseline-eval/evaluators.js";
import { CANARY_FIXTURES, RECORDED_PROFILE_FIXTURES, replayCanary, replayRecordedProfile } from "../scripts/brand-baseline-eval/replay.js";
import { BASELINE_CASES, BRAND } from "./fixtures/synthetic/brand-baseline-cases.js";

const project = (observations: Parameters<typeof buildBaselineResult>[0]["observations"], incompleteStages?: string[]) => buildBaselineResult({
  scanId: "00000000-0000-4000-8000-000000000001", brandId: "00000000-0000-4000-8000-000000000002", brand: BRAND, brandCapturedAt: "2026-10-25T00:00:00.000Z",
  observations, startedAt: "2026-10-25T00:00:00.000Z", finishedAt: "2026-10-25T00:01:00.000Z", providerCallCount: 5, recordedOrLive: "recorded", ...(incompleteStages ? { incompleteStages } : {}),
});

describe("SYNTHETIC cross-brand baseline cases", () => {
  it.each(BASELINE_CASES.map((item) => [item.id, item] as const))("%s", (_id, item) => {
    const result = project(item.observations, item.incompleteStages);
    expect(result.scanStatus).toBe(item.expect.scanStatus);
    expect(result.territories.map((territory) => territory.name)).toEqual(item.expect.hypotheses);
    if (item.expect.statuses) expect(result.territories.map((territory) => territory.evidenceStatus)).toEqual(item.expect.statuses);
    for (const [kind, count] of Object.entries(item.expect.typeEvidence ?? {})) expect(result.audit.typeEvidence[kind as keyof typeof result.audit.typeEvidence], kind).toBe(count);
    if (item.expect.excludedRules) expect([...new Set(result.fingerprint.excluded.map((exclusion) => exclusion.rule))]).toEqual(item.expect.excludedRules);
    if (item.expect.themes) expect(result.fingerprint.themes.map((theme) => theme.label)).toEqual(item.expect.themes);
    if (item.expect.possibleDuplicates !== undefined) expect(result.audit.possibleDuplicateTags).toBe(item.expect.possibleDuplicates);
    const failed = integrityChecks(result, item.observations, { brandQlooId: "syn-brand-case", describeCorrelationId: "syn-describe" }).filter((check) => !check.pass);
    expect(failed).toEqual([]);
    expect(usefulnessChecks(result).verdict).toBe(item.expect.usefulness);
    expect(project(item.observations, item.incompleteStages)).toEqual(result);
  });

  it("explains a zero-hypothesis result and still offers a next step", () => {
    for (const item of BASELINE_CASES.filter((candidate) => candidate.expect.hypotheses.length === 0)) {
      const result = project(item.observations, item.incompleteStages);
      expect(result.discovery.outcome, item.id).toBe("NO_HYPOTHESIS");
      expect(result.discovery.reasons.length, item.id).toBeGreaterThan(0);
      expect(result.discovery.nextSteps.length, item.id).toBeGreaterThan(0);
      expect(result.scanStatus, item.id).not.toBe("COMPLETE");
    }
  });

  it("is hard to pass with fabricated evidence", () => {
    const item = BASELINE_CASES.find((candidate) => candidate.id === "luxury-shaped")!;
    const result = project(item.observations);
    const renamed = structuredClone(result);
    renamed.territories[0]!.name = "Invented territory";
    const invented = structuredClone(result);
    invented.fingerprint.signals[0]!.source.correlationId = "syn-not-a-call";
    const retyped = structuredClone(result);
    const artist = retyped.fingerprint.signals.find((signal) => signal.domain === "artist")!;
    artist.grounding!.typeEvidence = "PROVIDER_CONFIRMED_TYPE";
    const scored = { ...structuredClone(result), elasticityScore: 0.7 } as typeof result;
    const fail = (candidate: typeof result) => integrityChecks(candidate, item.observations, { brandQlooId: "syn-brand-case", describeCorrelationId: "syn-describe" }).filter((check) => !check.pass).map((check) => check.id);
    expect(fail(renamed)).toEqual(expect.arrayContaining(["zero_fabricated_claims", "territory_evidence_sufficiency"]));
    expect(fail(invented)).toContain("provenance_integrity");
    expect(fail(retyped)).toContain("type_grounding");
    expect(fail(scored)).toEqual(expect.arrayContaining(["schema_valid", "zero_fabricated_claims"]));
  });
});

describe("type and facet rules", () => {
  it("never upgrades query scope into an entity-level type", () => {
    expect(groundEntityType({ type: "urn:entity" }, "urn:entity:artist", "RECORDED_PROVIDER_REQUEST")).toBe("QUERY_SCOPED");
    expect(groundEntityType({ type: "urn:entity" }, "urn:entity:artist", null)).toBe("GENERIC_TYPE_UNRESOLVED");
    expect(groundEntityType({ type: "urn:entity", subtype: "urn:entity:artist" }, "urn:entity:artist", null)).toBe("PROVIDER_CONFIRMED_TYPE");
    expect(groundEntityType({ type: "urn:entity:place" }, "urn:entity:artist", "RECORDED_PROVIDER_REQUEST")).toBe("CONFLICTING_TYPE");
    expect(groundEntityType({}, "urn:entity:book", "BASELINE_TEMPLATE_STAGE")).toBe("QUERY_SCOPED");
  });

  it("classifies tags by URN facet, not by name", () => {
    expect(tagRole("genre:media")).toBe("AUDIENCE_TASTE");
    expect(tagRole("lifestyle:qloo")).toBe("AUDIENCE_TASTE");
    expect(tagRole("keyword:media")).toBe("DESCRIPTIVE_KEYWORD");
    expect(tagRole("keyword:qloo")).toBe("AUDIENCE_TASTE");
    expect(tagRole("genre:brand")).toBe("BRAND_CLASSIFICATION");
    expect(tagRole("product_service:qloo")).toBe("BRAND_CLASSIFICATION");
  });

  it("keeps the harness subtype through normalization instead of dropping it", () => {
    const envelope = parseEnvelope("recommend", {
      schema_version: "1.0-preview.1", operation: "recommend", status: "ok",
      results: [{ entity_id: "syn-e1", name: "SYNTHETIC", type: "urn:entity", subtype: "urn:entity:artist" }],
      execution: { transport: "mcp", transport_name: "syn", correlation_id: "syn-corr", duration_ms: 1 },
    });
    expect(toEntitySignals("recommend", envelope)[0]).toMatchObject({ type: "urn:entity", subtype: "urn:entity:artist" });
  });
});

describe("LIVE_RECORDED_REPLAY of stored Qloo evidence (offline, no provider call)", () => {
  it("re-projects the second Loewe canary as a separate derived artifact without touching the as-run result", () => {
    const fixtureText = readFileSync(new URL(`../../${CANARY_FIXTURES[0]}`, import.meta.url), "utf8");
    const before = JSON.parse(fixtureText) as { asRunResult: { payload: unknown } };
    const replay = replayCanary(CANARY_FIXTURES[0]);
    const asRun = legacyBrandBaselineResultSchema.parse(replay.asRun);
    expect(asRun.scanStatus).toBe("COMPLETE");
    expect(asRun.territories).toEqual([]);
    expect(asRun.fingerprint.signals).toHaveLength(10);
    expect(storedBrandBaselineResultSchema.parse(replay.asRun).schemaVersion).toBe("ce-brand-baseline/0.1");
    expect(replay.asRun).toEqual(before.asRunResult.payload);

    const result = replay.result;
    expect(result.execution.derivedFrom).toMatchObject({ scanId: asRun.scanId, schemaVersion: "ce-brand-baseline/0.1" });
    expect(result.execution.templateVersion).toBe("ce-brand-baseline/v1");
    expect(result.audit).toEqual({
      returnedTags: 10, operationalTags: 6, culturalTags: 4, possibleDuplicateTags: 0, returnedEntities: 40,
      typeEvidence: { PROVIDER_CONFIRMED_TYPE: 0, QUERY_SCOPED: 40, GENERIC_TYPE_UNRESOLVED: 0, CONFLICTING_TYPE: 0 },
      retainedAssociations: 40, excludedEntities: 0, themes: 1, hypotheses: 2,
    });
    expect(result.territories.map((territory) => [territory.name, territory.canonicalConcept, territory.evidenceStatus])).toEqual([
      ["Model", "urn:tag:genre:person:model", "OBSERVED_ASSOCIATION"],
      ["Fashion", "urn:tag:genre:media:fashion", "OBSERVED_ASSOCIATION"],
    ]);
    expect(result.fingerprint.signals.filter((signal) => signal.kind === "entity").every((signal) => signal.grounding?.scopeBasis === "BASELINE_TEMPLATE_STAGE" && signal.grounding.providerType === "urn:entity")).toBe(true);
    expect(result.discovery.nextSteps[0]).toMatch(/20-tag profile/u);
    expect(integrityChecks(result, replay.observations, replay.brand).filter((check) => !check.pass)).toEqual([]);
  });

  it("refuses evidence from the first canary's artifacts, which never recorded call provenance", () => {
    const replay = replayCanary(CANARY_FIXTURES[1]);
    expect(replay.result.scanStatus).toBe("INSUFFICIENT_EVIDENCE");
    expect(replay.result.fingerprint.signals).toEqual([]);
    expect(replay.result.discovery.reasons[0]).toMatch(/could not be traced/u);
    expect(integrityChecks(replay.result, replay.observations, replay.brand).filter((check) => !check.pass)).toEqual([]);
  });

  it.each(RECORDED_PROFILE_FIXTURES.map((path) => [path.split("/").pop()!, path] as const))("classifies the recorded take-20 profile %s", (_name, path) => {
    const replay = replayRecordedProfile(path);
    expect(replay.result.audit.returnedTags).toBe(20);
    expect(replay.result.fingerprint.signals.every((signal) => signal.kind === "tag" && signal.role)).toBe(true);
    expect(replay.result.territories.length).toBeLessThanOrEqual(5);
    expect(integrityChecks(replay.result, replay.observations, replay.brand).filter((check) => !check.pass)).toEqual([]);
  });

  it("reads legacy 0.2 observation artifacts as template-scoped, and 0.3 as provider-recorded", () => {
    const base = { domain: "artist", capturedAt: "2026-10-25T00:00:00.000Z", kind: "ok" as const, operation: "recommend" as const, correlationId: "syn-c", sourceStatus: "ok" as const, signals: [{ id: "syn-a", name: "SYNTHETIC", kind: "entity" as const, type: "urn:entity", sourceCorrelationId: "syn-c" }] };
    expect(observationFromArtifact(baselineObservationSchema.parse(base), "ce-brand-baseline-observation/0.2").scopeFromTemplateStage).toBe(true);
    const recorded = observationFromArtifact(baselineObservationSchema.parse({ ...base, recordedRequestType: "urn:entity:artist" }), "ce-brand-baseline-observation/0.3");
    expect(recorded.scopeFromTemplateStage).toBeUndefined();
    expect(recorded.recordedRequestType).toBe("urn:entity:artist");
  });
});

describe("baseline isolation", () => {
  it("imports no model client, agent runtime, or benchmark data in production baseline code", () => {
    const dir = new URL("../src/brand-baseline/", import.meta.url);
    for (const file of readdirSync(dir)) {
      const source = readFileSync(new URL(file, dir), "utf8");
      expect(source, file).not.toMatch(/anthropic|from "\.\.\/agent\/|evals\/|benchmarks|scripts\//iu);
    }
  });
});
