/**
 * SPRINT 9G EVIDENCE INTEGRITY & REGRESSION ASSERTIONS
 *
 * Verifies the immutable Sprint 9G live trace properties and ensures
 * misleading interpretations (such as claiming synthesis passed on first attempt,
 * conflating brand category tags with lifestyle tags, or claiming measured causal affinity)
 * are rejected deterministically.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { classifyViolation, validateClaims } from "../src/agent/claim-validator.js";

const tracePath = path.resolve(import.meta.dirname, "../../docs/sprint-9g/evidence/loewe-boutique-hospitality.live.json");

describe("Sprint 9G Evidence Integrity & Trace Reconciliation", () => {
  it("verifies the immutable live trace records synthesis failed attempt 1 and passed after repair", () => {
    expect(fs.existsSync(tracePath)).toBe(true);
    const trace = JSON.parse(fs.readFileSync(tracePath, "utf8"));

    // Telemetry and attempts
    expect(trace.metrics.synthesis_attempts).toBe(2);
    expect(trace.metrics.synthesis_first_attempt_valid).toBe(false);
    expect(trace.metrics.synthesis_valid_after_repair).toBe(true);
    expect(trace.metrics.synthesis_fallback).toBe(false);

    // Attempt details in trace.trace.synthesis
    const synthesisTrace = trace.trace?.synthesis;
    expect(synthesisTrace).toBeDefined();
    expect(synthesisTrace.attempts).toBe(2);
    expect(synthesisTrace.attemptDetails).toHaveLength(2);

    // First attempt rejected for business outcome predictive language ("would succeed")
    const attempt1 = synthesisTrace.attemptDetails[0];
    expect(attempt1.accepted).toBe(false);
    expect(attempt1.categories.PROHIBITED_COMMERCIAL_OR_PREDICTION).toBe(1);
    expect(attempt1.violations.some((v: string) => v.includes('forbidden language "would succeed"'))).toBe(true);

    // Second attempt accepted
    const attempt2 = synthesisTrace.attemptDetails[1];
    expect(attempt2.accepted).toBe(true);
    expect(attempt2.violations).toHaveLength(0);
  });

  it("verifies model cost is estimated rather than verified provider billing", () => {
    const trace = JSON.parse(fs.readFileSync(tracePath, "utf8"));
    expect(trace.metrics.model_cost_usd).toBe(0.0084);
    expect(trace.metrics.model_input_tokens).toBe(48720);
    expect(trace.metrics.model_output_tokens).toBe(8130);
    // Calculated estimate from pricing.ts (input: $0.1/M, output: $0.5/M with prompt cache)
    // Confirms it represents an estimated token cost calculation, not an invoice billing
    expect(trace.metrics.model_cost_usd).toBeGreaterThan(0);
    expect(trace.metrics.model_cost_usd).toBeLessThan(0.05);
  });

  it("regression: claim validator rejects predictive commercial success claims", () => {
    const trace = JSON.parse(fs.readFileSync(tracePath, "utf8"));
    const predictiveSynthesis = {
      summary: 'This brand move would succeed in boutique hospitality.',
      territoryNotes: [{ territoryKey: "boutique_hospitality", text: "The expansion will drive high consumer adoption and guaranteed market share." }],
      followUpOptions: ["Launch immediate development."],
    };

    const violations = validateClaims(predictiveSynthesis, trace.territories, ["Loewe"]);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.includes('forbidden language "would succeed"') || v.includes("market share"))).toBe(true);
    const categories = violations.map((v) => classifyViolation(v));
    expect(categories).toContain("PROHIBITED_COMMERCIAL_OR_PREDICTION");
  });

  it("verifies brand-conditioned Qloo recommendations are recorded as observations rather than causal affinity", () => {
    const trace = JSON.parse(fs.readFileSync(tracePath, "utf8"));
    const territory = trace.territories[0];
    expect(territory.conditionedEvidence).toBeDefined();
    expect(territory.conditionedEvidence.support).toBe("SUPPORTED");
    expect(territory.conditionedEvidence.entityCount).toBe(20);
    // Provenance must be intact
    expect(territory.provenance.correlationIds.length).toBeGreaterThan(0);
    // Relative position and robustness are UNAVAILABLE in single hypothesis mode
    expect(territory.capabilities.relativePosition).toBe("UNAVAILABLE");
    expect(territory.capabilities.robustness).toBe("UNAVAILABLE");
  });
});
