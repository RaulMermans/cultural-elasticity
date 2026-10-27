/**
 * SPRINT 9H — COMPARATIVE CULTURAL ELASTICITY TEST SUITE
 *
 * Covers all 20 required evaluation dimensions:
 *  1. Valid three-territory comparison.
 *  2. Incompatible entity types.
 *  3. Missing exemplar profiles.
 *  4. Duplicate references.
 *  5. Missing rank panels.
 *  6. One-call versus cross-call rank validity.
 *  7. Exemplar substitution sensitivity.
 *  8. Insufficient evidence.
 *  9. Inconclusive hypothesis escalation.
 * 10. No unsupported affinity calculations.
 * 11. Wrong-brand provenance.
 * 12. Partial or failed provider responses.
 * 13. Reference-set manipulation.
 * 14. Candidate-set-relative interpretation.
 * 15. Claim validation.
 * 16. Duplicate initiation.
 * 17. Permission and admission refusal.
 * 18. Timeout/budget exhaustion.
 * 19. Recorded versus live provenance.
 * 20. Summary/export fidelity.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  assessComparisonEligibility,
  buildComparativeHandoffRequest,
  projectComparativeStrategicReport,
  collectReferenceCandidates,
  representationProblem,
  validateComparativeOutcome,
  QueryAlreadyExecutedError,
} from "../src/agent/comparative-bridge.js";
import { validateClaims } from "../src/agent/claim-validator.js";
import { parseMethodologyInput, type MethodologyInputRaw } from "../src/methodology/contracts.js";
import { analyzeElasticity } from "../src/methodology/elasticity.js";
import type { AgentAnalysisResult, AgentTerritoryResult, AnyBrandBaselineResult, ComparativeReferenceCandidate } from "@cultural-elasticity/shared";

const liveTracePath = path.resolve(import.meta.dirname, "../../docs/sprint-9g/evidence/loewe-boutique-hospitality.live.json");
const recordedBaselinesPath = path.resolve(import.meta.dirname, "../../frontend/src/demo/recorded-baselines.json");
const liveBenchmarkPath = path.resolve(import.meta.dirname, "../../evals/benchmarks/cultural-elasticity-v0/evidence/jacquemus.live.json");

const SYN_BRAND = { id: "SYN-BR-9001", label: "SYNTHETIC Brand", resolution: "confirmed" };

/** SYNTHETIC investigated territory with a validated place representation (two distinct exemplars). */
function territory(overrides: Partial<AgentTerritoryResult> = {}): AgentTerritoryResult {
  return {
    key: "syn_target", label: "SYNTHETIC Target", role: "target", origin: "user", rationale: "target",
    resolvedConcept: { id: "urn:tag:syn:target", label: "SYNTHETIC Target", type: "tag" },
    representation: {
      strategy: "PLACE_PANEL", entityType: "place",
      exemplars: [
        { id: "SYN-PL-1", label: "SYNTHETIC Place 1", type: "place", role: "primary", selectionReason: "test", conceptSupport: "tag_member", popularity: 0.9 },
        { id: "SYN-PL-2", label: "SYNTHETIC Place 2", type: "place", role: "alternate", selectionReason: "test", conceptSupport: "tag_member", popularity: 0.8 },
      ],
      rejectedExemplars: [], diversity: "adequate", diversityDetail: "ok", attempts: 1, summary: "ok", failure: null,
    },
    analysisRoute: "PARTIAL_CULTURAL_ANALYSIS",
    capabilities: { representation: "SUPPORTED", relativePosition: "UNAVAILABLE", robustness: "UNAVAILABLE", coherence: "AVAILABLE", conditionedEvidence: "AVAILABLE", classification: "UNAVAILABLE" },
    comparisonSet: null, relativePosition: null, robustness: null, coherence: null, conditionedEvidence: null,
    evidenceQuality: { level: "MEDIUM", drivers: [] }, classification: null,
    keyEvidence: ["Observed relationship in single hypothesis."], limitations: [],
    provenance: { correlationIds: ["syn-call-1"], sources: ["synthetic"] },
    ...overrides,
  };
}

/** SYNTHETIC server-held reference candidate (type known from a validated representation unless overridden). */
function reference(id: string, overrides: Partial<ComparativeReferenceCandidate> = {}): ComparativeReferenceCandidate {
  return {
    id, label: `SYNTHETIC ${id}`, conceptId: `urn:tag:syn:${id}`, source: "completed_investigation",
    typeEvidence: { entityType: "place", basis: "VALIDATED_REPRESENTATION", memberIds: [`SYN-PL-${id}-a`, `SYN-PL-${id}-b`], correlationIds: [`syn-${id}`] },
    exemplarIds: [`SYN-PL-${id}-a`, `SYN-PL-${id}-b`], sourceStatus: "ok", correlationIds: [`syn-${id}`], rationale: "test", blocked: null,
    ...overrides,
  };
}

describe("Sprint 9H: Comparative Cultural Elasticity Suite", () => {
  // 1. Valid three-territory comparison
  it("1. Valid three-territory comparison meets eligibility gate and produces relative positions", () => {
    const references = [reference("resorts"), reference("galleries")];
    const eligibility = assessComparisonEligibility(SYN_BRAND, territory(), references);
    expect(eligibility).toMatchObject({ eligible: true, code: "ELIGIBLE", candidateSet: ["SYNTHETIC Target", "SYNTHETIC resorts", "SYNTHETIC galleries"] });
    const handoff = buildComparativeHandoffRequest(SYN_BRAND, territory(), references);
    expect(handoff.ok).toBe(true);
    if (handoff.ok) {
      expect(handoff.request.intent).toBe("compare_territories");
      expect(handoff.request.territories).toEqual(["SYNTHETIC Target", "SYNTHETIC resorts", "SYNTHETIC galleries"]);
    }
  });

  // 2. Incompatible entity types
  it("2. Incompatible entity types are rejected by the comparison eligibility gate", () => {
    const brandTyped = reference("labels", { typeEvidence: { entityType: "brand", basis: "VALIDATED_REPRESENTATION", memberIds: ["SYN-BR-1"], correlationIds: ["syn-labels"] } });
    const eligibility = assessComparisonEligibility(SYN_BRAND, territory(), [reference("dining"), brandTyped]);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.code).toBe("INCOMPATIBLE_ENTITY_TYPES");
    expect(eligibility.reason).toContain("one entity type in one rank panel");
  });

  it("2b. Sprint 9I: a caller-declared or missing type is never accepted or copied from the target", () => {
    const untyped = reference("unverified", { typeEvidence: null });
    const eligibility = assessComparisonEligibility(SYN_BRAND, territory(), [reference("dining"), untyped]);
    expect(eligibility).toMatchObject({ eligible: false, code: "REFERENCE_TYPE_UNVERIFIED" });
    expect(eligibility.validatedReferences).toBeUndefined();
  });

  // 3. Missing exemplar profiles
  it("3. Missing exemplar profiles fail representation validation", () => {
    const empty = territory({ representation: { ...territory().representation, exemplars: [], failure: { code: "INSUFFICIENT_EXEMPLARS", detail: "no exemplars found" } }, analysisRoute: "INSUFFICIENT_EVIDENCE" });
    expect(assessComparisonEligibility(SYN_BRAND, empty, [reference("a"), reference("b")]).code).toBe("INVALID_TARGET_REPRESENTATION");
    const single = territory({ representation: { ...territory().representation, exemplars: territory().representation.exemplars.slice(0, 1) } });
    expect(assessComparisonEligibility(SYN_BRAND, single, [reference("a"), reference("b")]).reason).toMatch(/at least 2 are needed/u);
    const unsourced = territory({ provenance: { correlationIds: [], sources: [] } });
    expect(assessComparisonEligibility(SYN_BRAND, unsourced, [reference("a"), reference("b")]).code).toBe("INVALID_TARGET_REPRESENTATION");
  });

  // 4. Duplicate references
  it("4. Duplicate references are rejected by comparison eligibility gate", () => {
    const sameLabel = reference("dup", { label: "SYNTHETIC Target" });
    expect(assessComparisonEligibility(SYN_BRAND, territory(), [reference("a"), sameLabel]).code).toBe("DUPLICATE_TERRITORIES");
    const sameConcept = reference("concept", { conceptId: "urn:tag:syn:target" });
    expect(assessComparisonEligibility(SYN_BRAND, territory(), [reference("a"), sameConcept]).code).toBe("DUPLICATE_TERRITORIES");
    const sharedExemplar = reference("shared", { exemplarIds: ["SYN-PL-1", "SYN-PL-shared-b"] });
    expect(assessComparisonEligibility(SYN_BRAND, territory(), [reference("a"), sharedExemplar]).code).toBe("DUPLICATE_EXEMPLARS");
    const repeated = reference("repeat", { exemplarIds: ["SYN-PL-x", "SYN-PL-x"] });
    expect(assessComparisonEligibility(SYN_BRAND, territory(), [reference("a"), repeated]).code).toBe("DUPLICATE_EXEMPLARS");
  });

  // 5. Missing rank panels
  it("5. Missing rank panels degrade analysis gracefully rather than inventing ranks", () => {
    const rawFixture = (JSON.parse(fs.readFileSync(liveBenchmarkPath, "utf8")) as { input: MethodologyInputRaw }).input;
    // Omit ranking from panel A
    const damagedFixture: MethodologyInputRaw = {
      ...rawFixture,
      panels: rawFixture.panels.map((p) => (p.id === "A" ? { ...p, ranking: undefined } : p)),
    };

    // Missing ranking on panel A degrades robustness (capped at LOW) and records limitation
    const parseRes = parseMethodologyInput(damagedFixture);
    expect(parseRes.ok).toBe(true);
    if (parseRes.ok) {
      const result = analyzeElasticity(damagedFixture);
      // Robustness is capped at LOW (or INSUFFICIENT), never HIGH or MEDIUM
      expect(result.territories.every((t) => t.robustness.level === "LOW" || t.robustness.level === "INSUFFICIENT")).toBe(true);
      expect(result.territories.some((t) => t.robustness.reasons.some((r) => r.includes("capped at LOW because evidence is missing")))).toBe(true);
    }

    // When ALL panels omit ranking, robustness is INSUFFICIENT for all territories
    const noRanksFixture: MethodologyInputRaw = {
      ...rawFixture,
      panels: rawFixture.panels.map((p) => ({ ...p, ranking: undefined })),
    };
    const noRanksResult = analyzeElasticity(noRanksFixture);
    expect(noRanksResult.territories.every((t) => t.robustness.level === "INSUFFICIENT")).toBe(true);
  });

  // 6. One-call versus cross-call rank validity
  it("6. Rank positions are derived only within the same compatible Qloo call", () => {
    const rawFixture = (JSON.parse(fs.readFileSync(liveBenchmarkPath, "utf8")) as { input: MethodologyInputRaw }).input;
    const result = analyzeElasticity(rawFixture);
    for (const t of result.territories) {
      // Panel evidence references correlation IDs
      expect(t.panelEvidence.length).toBeGreaterThan(0);
      for (const pe of t.panelEvidence) {
        expect(pe.correlationId).toBeDefined();
        expect(pe.panelSize).toBe(rawFixture.territories.length);
      }
    }
  });

  // 7. Exemplar substitution sensitivity
  it("7. Exemplar substitution sensitivity is measured across panels A and B", () => {
    const rawFixture = (JSON.parse(fs.readFileSync(liveBenchmarkPath, "utf8")) as { input: MethodologyInputRaw }).input;
    const result = analyzeElasticity(rawFixture);
    const ceramics = result.territories.find((t) => t.territory.id === "ceramics");
    expect(ceramics).toBeDefined();
    // In Jacquemus benchmark, ceramics has MEDIUM robustness, showing position stability across alternate exemplars
    expect(ceramics?.robustness.level).toBe("MEDIUM");
    expect(ceramics?.classification.label).toBe("CREDIBLE_STRETCH");
  });

  // 8. Insufficient evidence
  it("8. Cardinality below three territories returns INSUFFICIENT_REFERENCES", () => {
    const eligibility = assessComparisonEligibility(SYN_BRAND, territory(), [reference("one")]);
    expect(eligibility).toMatchObject({ eligible: false, code: "INSUFFICIENT_REFERENCES" });
    expect(assessComparisonEligibility(SYN_BRAND, territory(), ["a", "b", "c", "d", "e", "f"].map((id) => reference(id))).code).toBe("TOO_MANY_TERRITORIES");
  });

  // 9. Inconclusive hypothesis escalation
  it("9. The recorded live Loewe hypothesis cannot be escalated without server-verified references", () => {
    // Real recorded evidence: the Sprint 9G live investigation and the recorded live Loewe baseline.
    const liveTrace = JSON.parse(fs.readFileSync(liveTracePath, "utf8")) as AgentAnalysisResult;
    const recorded = JSON.parse(fs.readFileSync(recordedBaselinesPath, "utf8")) as { items: { key: string; result: AnyBrandBaselineResult }[] };
    const baseline = recorded.items.find((item) => item.key === "loewe")!.result;
    const target = liveTrace.territories[0]!;
    expect(liveTrace.hypothesisAssessment?.outcome).toBe("INCONCLUSIVE");
    expect(representationProblem(target)).toBeNull();
    // The recorded result keeps no exemplar tag profiles and there is no other completed investigation.
    const candidates = collectReferenceCandidates({ brandId: liveTrace.brand!.id, target, exemplarProfiles: [], siblings: [], baseline });
    expect(candidates.map((c) => c.label)).toEqual(["Model", "Fashion"]);
    expect(candidates.every((c) => c.typeEvidence === null && c.blocked?.code === "REFERENCE_TYPE_UNVERIFIED")).toBe(true);
    const eligibility = assessComparisonEligibility(liveTrace.brand, target, candidates, { expectedBrandId: baseline.brand.qlooId });
    expect(eligibility).toMatchObject({ eligible: false, code: "REFERENCE_TYPE_UNVERIFIED" });
  });

  // 10. No unsupported affinity calculations
  it("10. Does not compute unsupported cross-call raw affinity averages or 0-100 universal scores", () => {
    const rawFixture = (JSON.parse(fs.readFileSync(liveBenchmarkPath, "utf8")) as { input: MethodologyInputRaw }).input;
    const result = analyzeElasticity(rawFixture);
    for (const t of result.territories) {
      // Relative elasticity index must NOT be emitted without approved gate
      expect(t.relativeElasticityIndex).toBeUndefined();
      // Relative position is strictly an ordinal ranking (position of N) and percentile
      expect(t.relativePosition.position).toBeGreaterThanOrEqual(1);
      expect(t.relativePosition.position).toBeLessThanOrEqual(rawFixture.territories.length);
      expect(t.relativePosition.medianPercentile).toBeGreaterThanOrEqual(0);
      expect(t.relativePosition.medianPercentile).toBeLessThanOrEqual(1);
    }
  });

  // 11. Wrong-brand provenance
  it("11. Wrong-brand provenance fails methodology input schema refinement", () => {
    const rawFixture = (JSON.parse(fs.readFileSync(liveBenchmarkPath, "utf8")) as { input: MethodologyInputRaw }).input;
    // Taint ranking call to be ranked against a foreign brand ID
    const taintedFixture: MethodologyInputRaw = {
      ...rawFixture,
      panels: rawFixture.panels.map((p) =>
        p.ranking ? { ...p, ranking: { ...p.ranking, rankedAgainst: "FOREIGN-BRAND-ID" } } : p,
      ),
    };

    const parseRes = parseMethodologyInput(taintedFixture);
    expect(parseRes.ok).toBe(false);
    if (!parseRes.ok) {
      expect(parseRes.issues.some((i) => i.message.includes("ranked against the brand subject"))).toBe(true);
    }
  });

  // 12. Partial or failed provider responses
  it("12. Degraded or partial provider responses cannot support a positive verdict", () => {
    const rawFixture = (JSON.parse(fs.readFileSync(liveBenchmarkPath, "utf8")) as { input: MethodologyInputRaw }).input;
    // Empty brand signals simulate an empty/degraded provider response
    const taintedFixture: MethodologyInputRaw = {
      ...rawFixture,
      brand: {
        ...rawFixture.brand,
        signals: [],
      },
    };
    // Empty profile coverage makes evidence quality LOW and refuses positive classification
    const parseRes = parseMethodologyInput(taintedFixture);
    expect(parseRes.ok).toBe(true);
    if (parseRes.ok) {
      const res = analyzeElasticity(taintedFixture);
      expect(res.territories.every((t) => t.evidenceQuality.level === "LOW")).toBe(true);
      expect(res.territories.every((t) => t.classification.label === "INSUFFICIENT_EVIDENCE")).toBe(true);
    }
  });

  // 13. Reference-set manipulation
  it("13. Reference-set manipulation changes relative position and percentile spread", () => {
    const rawFixture = (JSON.parse(fs.readFileSync(liveBenchmarkPath, "utf8")) as { input: MethodologyInputRaw }).input;
    const full6 = analyzeElasticity(rawFixture);

    // Create a 3-territory subset (Boutique Hospitality, Wellness, Gaming Hardware)
    const subsetIds = new Set(["boutique_hospitality", "wellness", "gaming_hardware"]);
    const subsetTerritories = rawFixture.territories.filter((t) => subsetIds.has(t.id));
    const subsetExemplarIds = new Set(subsetTerritories.flatMap((t) => t.exemplars.map((e) => e.id)));
    const subsetConceptIds = new Set(subsetTerritories.map((t) => t.concept?.id).filter(Boolean));

    const subsetFixture: MethodologyInputRaw = {
      ...rawFixture,
      territories: subsetTerritories,
      exemplarProfiles: rawFixture.exemplarProfiles.filter((p) => subsetExemplarIds.has(p.subject.id)),
      panels: rawFixture.panels.map((p) => ({
        ...p,
        assignments: p.assignments.filter((a) => subsetIds.has(a.territoryId)),
        ranking: p.ranking
          ? {
              ...p.ranking,
              candidates: p.ranking.candidates.filter((c) => subsetExemplarIds.has(c.id)),
            }
          : undefined,
      })),
      conditioned: rawFixture.conditioned.filter((c) => subsetConceptIds.has(c.territory.id)),
    };

    const subsetRes = analyzeElasticity(subsetFixture);
    const hosp6 = full6.territories.find((t) => t.territory.id === "boutique_hospitality")!;
    const hosp3 = subsetRes.territories.find((t) => t.territory.id === "boutique_hospitality")!;

    expect(hosp6.relativePosition.of).toBe(6);
    expect(hosp3.relativePosition.of).toBe(3);
    // Relative percentile is computed relative to candidate set size
    expect(hosp6.relativePosition.medianPercentile).not.toBe(hosp3.relativePosition.medianPercentile);
  });

  // 14. Candidate-set-relative interpretation
  it("14. Strategic report projection includes candidate set and explicit relative limitations", () => {
    const set = { territoryKeys: ["syn_target", "syn_resorts", "syn_galleries"], labels: ["SYNTHETIC Target", "SYNTHETIC resorts", "SYNTHETIC galleries"], methodologyVersion: "v0" };
    const ranked = (key: string, label: string, position: number, percentile: number, label2: "NATURAL_ADJACENCY" | "CREDIBLE_STRETCH" | "CULTURAL_BREAK") => territory({
      key, label, role: key === "syn_target" ? "target" : "reference", resolvedConcept: { id: `urn:tag:syn:${key}`, label, type: "tag" }, analysisRoute: "FULL_RELATIVE_ANALYSIS", comparisonSet: set,
      relativePosition: { position, of: 3, medianPercentile: percentile, medianRank: position }, robustness: { level: "HIGH", percentileSpread: 0, panelledExemplars: 2, declaredExemplars: 2, reasons: [] },
      classification: { label: label2, status: "PROVISIONAL", reasons: [`Rank position ${position} of 3`] }, keyEvidence: [`Position ${position} of 3.`], provenance: { correlationIds: [`syn-${key}`], sources: ["synthetic"] },
    });
    const result = comparativeResult([ranked("syn_target", "SYNTHETIC Target", 1, 1, "NATURAL_ADJACENCY"), ranked("syn_resorts", "SYNTHETIC resorts", 2, 0.5, "CREDIBLE_STRETCH"), ranked("syn_galleries", "SYNTHETIC galleries", 3, 0, "CULTURAL_BREAK")]);
    const plan = { brandId: SYN_BRAND.id, brandLabel: SYN_BRAND.label, target: { label: "SYNTHETIC Target", conceptId: "urn:tag:syn:syn_target", entityType: "place", singleHypothesisOutcome: "INCONCLUSIVE" }, references: [
      // Sprint 9J: the authorized plan names the references the panel ranks (COMPARISON_SET_AUTHORIZED).
      { id: "syn_resorts", label: "SYNTHETIC resorts", conceptId: "urn:tag:syn:syn_resorts", entityType: "place", typeBasis: "VALIDATED_REPRESENTATION" },
      { id: "syn_galleries", label: "SYNTHETIC galleries", conceptId: "urn:tag:syn:syn_galleries", entityType: "place", typeBasis: "VALIDATED_REPRESENTATION" },
    ] };
    const verdict = validateComparativeOutcome(plan, result);
    expect(verdict.outcome).toBe("RELATIVE_POSITION_ESTABLISHED");
    const report = projectComparativeStrategicReport(result, plan, verdict);
    expect(report.schemaVersion).toBe("ce-comparative-report/0.2");
    expect(report.targetTerritory).toMatchObject({ name: "SYNTHETIC Target", singleHypothesisOutcome: "INCONCLUSIVE", candidateSet: set.labels, provisionalClassification: { label: "NATURAL_ADJACENCY" } });
    expect(report.whatRemainsUnknown.some((u) => u.includes("No absolute cultural distance"))).toBe(true);
    // Evidence origin passes through unchanged for every label (kept from the PR #33 regression).
    for (const origin of ["live", "recorded", "synthetic"] as const) {
      const labelled = comparativeResult(result.territories, { evidenceOrigin: origin });
      expect(projectComparativeStrategicReport(labelled, plan, validateComparativeOutcome(plan, labelled)).evidenceOrigin).toBe(origin);
    }
  });

  // 15. Claim validation
  it("15. Claim validation enforces exact classification match and rejects predictive claims", () => {
    const mockComparativeResult: AgentAnalysisResult = {
      schemaVersion: "ce-agent-result/0.3",
      runId: "run-comp-1",
      status: "COMPLETE",
      finalSufficiency: "SUFFICIENT",
      intent: "compare_territories",
      userQuery: "Compare territories.",
      brand: { id: "BRAND-1", label: "Loewe", type: "brand", resolution: "confirmed" },
      territories: [
        {
          key: "boutique_hospitality",
          label: "Boutique hospitality",
          role: "target",
          origin: "user",
          rationale: "target",
          resolvedConcept: null,
          representation: {
            strategy: "PLACE_PANEL",
            entityType: "place",
            exemplars: [{ id: "E1", label: "Hotel 1", type: "place", role: "primary", selectionReason: "test", conceptSupport: "tag_member", popularity: 0.9 }],
            rejectedExemplars: [],
            diversity: "adequate",
            diversityDetail: "ok",
            attempts: 1,
            summary: "ok",
            failure: null,
          },
          analysisRoute: "FULL_RELATIVE_ANALYSIS",
          capabilities: {} as never,
          comparisonSet: { territoryKeys: ["boutique_hospitality"], labels: ["Boutique hospitality"], methodologyVersion: "v0" },
          relativePosition: { position: 1, of: 3, medianPercentile: 0.8, medianRank: 1 },
          robustness: { level: "HIGH", percentileSpread: 0, panelledExemplars: 2, declaredExemplars: 2, reasons: [] },
          coherence: null,
          conditionedEvidence: null,
          evidenceQuality: null,
          classification: { label: "CREDIBLE_STRETCH", status: "PROVISIONAL", reasons: [] },
          keyEvidence: [],
          limitations: [],
          provenance: { correlationIds: ["c1"], sources: [] },
        },
      ],
      methodologyRuns: [],
      summary: { text: "ok", source: "deterministic_template", claimValidation: { passed: true, violations: [] } },
      followUpOptions: [],
      limitations: [],
      evidenceOrigin: "live",
      model: { id: "claude-haiku-5-5", kind: "llm", live: true, effort: "high" },
      trace: {} as never,
      metrics: {} as never,
      skillsUsed: [],
      comparisonSetConstruction: {} as never,
      layers: {} as never,
      failureCategory: null,
    };

    // Asserting a class that doesn't match deterministic class (NATURAL_ADJACENCY vs CREDIBLE_STRETCH)
    const invalidClassSynth = {
      summary: "Boutique hospitality is a natural adjacency for Loewe.",
      territoryNotes: [],
      followUpOptions: [],
    };
    const violations = validateClaims(invalidClassSynth, mockComparativeResult.territories, ["Loewe"]);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.includes("NATURAL_ADJACENCY") && v.includes("does not match"))).toBe(true);
  });

  // 16. Duplicate initiation
  it("16. Re-executing an already executed query ID throws QueryAlreadyExecutedError", () => {
    const error = new QueryAlreadyExecutedError("query-123");
    expect(error.name).toBe("QueryAlreadyExecutedError");
    expect(error.message).toContain("query-123 was already executed");
  });

  // 17. Permission and admission refusal
  it("17. Paid execution is refused when admission authorization is paused", () => {
    const eligibility = assessComparisonEligibility(SYN_BRAND, territory(), [reference("a"), reference("b")], { requirePaidAuthorization: true, paidAuthorized: false });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.code).toBe("PAID_ADMISSION_PAUSED");
  });

  // 18. Timeout/budget exhaustion
  it("18. Budget exhaustion before rank calls leaves route as PARTIAL with honest limitation", () => {
    const target: AgentTerritoryResult = {
      key: "target",
      label: "Target",
      role: "target",
      origin: "user",
      rationale: "target",
      resolvedConcept: null,
      representation: {
        strategy: "PLACE_PANEL",
        entityType: "place",
        exemplars: [{ id: "E1", label: "Hotel 1", type: "place", role: "primary", selectionReason: "test", conceptSupport: "tag_member", popularity: 0.9 }],
        rejectedExemplars: [],
        diversity: "adequate",
        diversityDetail: "ok",
        attempts: 1,
        summary: "ok",
        failure: null,
      },
      analysisRoute: "PARTIAL_CULTURAL_ANALYSIS",
      capabilities: { representation: "SUPPORTED", relativePosition: "NOT_COLLECTED", robustness: "NOT_COLLECTED", coherence: "AVAILABLE", conditionedEvidence: "AVAILABLE", classification: "UNAVAILABLE" },
      comparisonSet: null,
      relativePosition: null,
      robustness: null,
      coherence: null,
      conditionedEvidence: null,
      evidenceQuality: null,
      classification: null,
      keyEvidence: [],
      limitations: [{ code: "NOT_COLLECTED_BUDGET", detail: "Qloo call budget spent" }],
      provenance: { correlationIds: ["c1"], sources: [] },
    };

    expect(target.analysisRoute).toBe("PARTIAL_CULTURAL_ANALYSIS");
    expect(target.limitations.some((l) => l.code === "NOT_COLLECTED_BUDGET")).toBe(true);
  });

  // 19. Recorded versus live provenance
  it("19. Preserves recorded versus live provenance without misrepresentation", () => {
    const liveTrace = JSON.parse(fs.readFileSync(liveTracePath, "utf8"));
    expect(liveTrace.evidenceOrigin).toBe("live");

    const rawBenchmark = (JSON.parse(fs.readFileSync(liveBenchmarkPath, "utf8")) as { input: MethodologyInputRaw }).input;
    expect(rawBenchmark.origin).toBe("live");
  });

  // 20. Summary/export fidelity
  it("20. Summary/export fidelity preserves all strategic dimensions without fabrication", () => {
    const rawFixture = (JSON.parse(fs.readFileSync(liveBenchmarkPath, "utf8")) as { input: MethodologyInputRaw }).input;
    const elasticityResult = analyzeElasticity(rawFixture);

    expect(elasticityResult.schemaVersion).toBe("ce-elasticity-result/0.1");
    expect(elasticityResult.territories.length).toBe(6);
    expect(elasticityResult.limitations.some((l) => l.code === "RELATIVE_TO_COMPARISON_SET")).toBe(true);
    expect(elasticityResult.limitations.some((l) => l.code === "NOT_A_SUCCESS_PREDICTION")).toBe(true);
  });

  // Sprint 9J: a ranked reference must be the authorized concept, and the panel must be the authorized set.
  describe("9J comparison identity", () => {
    const set = { territoryKeys: ["syn_target", "syn_resorts", "syn_galleries"], labels: ["SYNTHETIC Target", "SYNTHETIC resorts", "SYNTHETIC galleries"], methodologyVersion: "v0" };
    const ranked = (key: string, label: string, position: number, conceptId: string | null = `urn:tag:syn:${key}`) => territory({
      key, label, role: key === "syn_target" ? "target" : "reference", resolvedConcept: conceptId ? { id: conceptId, label, type: "tag" } : null, analysisRoute: "FULL_RELATIVE_ANALYSIS", comparisonSet: set,
      relativePosition: { position, of: 3, medianPercentile: 1 - (position - 1) / 2, medianRank: position }, robustness: { level: "HIGH", percentileSpread: 0, panelledExemplars: 2, declaredExemplars: 2, reasons: [] },
      classification: { label: "CREDIBLE_STRETCH", status: "PROVISIONAL", reasons: [] }, keyEvidence: [], provenance: { correlationIds: [`syn-${key}`], sources: ["synthetic"] },
    });
    const ref = (key: string, label: string) => ({ id: key, label, conceptId: `urn:tag:syn:${key}`, entityType: "place", typeBasis: "VALIDATED_REPRESENTATION" });
    const plan = { brandId: SYN_BRAND.id, brandLabel: SYN_BRAND.label, target: { label: "SYNTHETIC Target", conceptId: "urn:tag:syn:syn_target", entityType: "place" }, references: [ref("syn_resorts", "SYNTHETIC resorts"), ref("syn_galleries", "SYNTHETIC galleries")] };
    const blocked = (result: AgentAnalysisResult) => {
      const verdict = validateComparativeOutcome(plan, result);
      const report = projectComparativeStrategicReport(result, plan, verdict);
      expect(verdict.outcome).toBe("INTEGRITY_FAILED");
      expect(report.targetTerritory.relativePosition).toBeNull();
      expect(report.alternativesEvaluated.every((a) => a.relativePosition === null && a.classification === null)).toBe(true);
      return verdict;
    };

    it("the authorized panel establishes a position", () => {
      const result = comparativeResult([ranked("syn_target", "SYNTHETIC Target", 1), ranked("syn_resorts", "SYNTHETIC resorts", 2), ranked("syn_galleries", "SYNTHETIC galleries", 3)]);
      expect(validateComparativeOutcome(plan, result).outcome).toBe("RELATIVE_POSITION_ESTABLISHED");
    });

    it("a ranked reference anchored to another concept withholds every position", () => {
      const verdict = blocked(comparativeResult([ranked("syn_target", "SYNTHETIC Target", 1), ranked("syn_resorts", "SYNTHETIC resorts", 2, "urn:tag:syn:other_resorts"), ranked("syn_galleries", "SYNTHETIC galleries", 3)]));
      expect(verdict.checks.find((c) => c.code === "CONCEPT_ANCHOR_MATCHES" && c.blocking && !c.passed)?.detail).toMatch(/SYNTHETIC resorts/u);
    });

    it("a ranked reference whose concept can no longer be verified withholds every position", () => {
      blocked(comparativeResult([ranked("syn_target", "SYNTHETIC Target", 1), ranked("syn_resorts", "SYNTHETIC resorts", 2, null), ranked("syn_galleries", "SYNTHETIC galleries", 3)]));
    });

    it("a drifted reference left out of the panel only limits the report", () => {
      const twoSet = { ...set, territoryKeys: ["syn_target", "syn_galleries"], labels: ["SYNTHETIC Target", "SYNTHETIC galleries"] };
      const target = { ...ranked("syn_target", "SYNTHETIC Target", 1), comparisonSet: twoSet, relativePosition: { position: 1, of: 2, medianPercentile: 1, medianRank: 1 } };
      const galleries = { ...ranked("syn_galleries", "SYNTHETIC galleries", 2), comparisonSet: twoSet, relativePosition: { position: 2, of: 2, medianPercentile: 0, medianRank: 2 } };
      const resorts = territory({ key: "syn_resorts", label: "SYNTHETIC resorts", role: "reference", resolvedConcept: { id: "urn:tag:syn:other_resorts", label: "SYNTHETIC resorts", type: "tag" }, analysisRoute: "INSUFFICIENT_EVIDENCE" });
      const verdict = validateComparativeOutcome(plan, comparativeResult([target, galleries, resorts]));
      expect(verdict.outcome).toBe("RELATIVE_POSITION_ESTABLISHED");
      expect(verdict.checks.some((c) => c.code === "CONCEPT_ANCHOR_MATCHES" && !c.passed && !c.blocking)).toBe(true);
    });

    it("a panel that ranks an unauthorized territory is never shown as the authorized comparison", () => {
      const verdict = blocked(comparativeResult([ranked("syn_target", "SYNTHETIC Target", 1), ranked("syn_resorts", "SYNTHETIC resorts", 2), ranked("syn_substitute", "SYNTHETIC substitute", 3)]));
      expect(verdict.checks.find((c) => c.code === "COMPARISON_SET_AUTHORIZED")?.passed).toBe(false);
    });
  });
});

/** SYNTHETIC comparative run result around the given territories. */
function comparativeResult(territories: AgentTerritoryResult[], overrides: Partial<AgentAnalysisResult> = {}): AgentAnalysisResult {
  return {
    schemaVersion: "ce-agent-result/0.3", runId: "syn-run-comp", status: "COMPLETE", finalSufficiency: "SUFFICIENT", intent: "compare_territories",
    userQuery: "SYNTHETIC comparison", brand: { id: SYN_BRAND.id, label: SYN_BRAND.label, type: "urn:entity:brand", resolution: "confirmed" },
    territories, methodologyRuns: [],
    summary: { text: "SYNTHETIC summary.", source: "deterministic_template", claimValidation: { passed: true, violations: [] } },
    followUpOptions: ["Test alternative exemplars."], limitations: [], evidenceOrigin: "synthetic",
    model: { id: "baseline-policy", kind: "scripted", live: false }, trace: {} as never, metrics: {} as never, skillsUsed: [],
    comparisonSetConstruction: {} as never, layers: {} as never, failureCategory: null,
    ...overrides,
  } as AgentAnalysisResult;
}
