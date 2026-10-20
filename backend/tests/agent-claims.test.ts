/** Claim validation of model synthesis, and the deterministic template that must always pass it. SYNTHETIC. */
import type { AgentAnalysisResult, AgentTerritoryResult } from "@cultural-elasticity/shared";
import { describe, expect, it } from "vitest";
import { validateClaims } from "../src/agent/claim-validator.js";
import { templateSynthesis } from "../src/agent/finalizer.js";
import { runtime } from "./fixtures/synthetic/agent.js";

async function fullResult(): Promise<AgentAnalysisResult> {
  return (await runtime().runtime.run({ userQuery: "q", brand: "Northwind Atelier", territories: ["Boutique Hospitality"] })) as AgentAnalysisResult;
}

const synth = (summary: string, notes: { territoryKey: string; text: string }[] = [], followUpOptions: string[] = []) => ({ summary, territoryNotes: notes, followUpOptions });

describe("claim validator", () => {
  it("accepts statements that restate deterministic results", async () => {
    const r = await fullResult();
    const t = r.territories.find((x) => x.key === "boutique_hospitality")!;
    expect(t.analysisRoute).toBe("FULL_RELATIVE_ANALYSIS");
    // Restate whatever class and robustness level the methodology assigned (the claim must match them).
    const phrase = { NATURAL_ADJACENCY: "a natural adjacency", CREDIBLE_STRETCH: "a credible stretch", UNCERTAIN_REPRESENTATION_SENSITIVE: "uncertain and representation-sensitive", CULTURAL_BREAK: "a cultural break" }[t.classification!.label as string];
    const ok = synth(`Boutique Hospitality sits at position ${t.relativePosition!.position} of ${t.relativePosition!.of}; Qloo evidence makes it ${phrase} relative to this comparison set, with ${t.robustness!.level.toLowerCase()} robustness.`);
    expect(validateClaims(ok, r.territories, ["Northwind Atelier"])).toEqual([]);
  });

  it("rejects a class the methodology did not assign", async () => {
    const r = await fullResult();
    const v = validateClaims(synth("Boutique Hospitality is a natural adjacency for the brand."), r.territories);
    expect(v.join(" ")).toMatch(/NATURAL_ADJACENCY.*does not match/u);
  });

  it("rejects class language detached from a territory and in a note for a territory without a class", async () => {
    const r = await fullResult();
    expect(validateClaims(synth("This is clearly a cultural break."), r.territories).join(" ")).toMatch(/not attached/u);
    const partial: AgentTerritoryResult = { ...r.territories[0]!, key: "x", label: "Xland", classification: null, analysisRoute: "PARTIAL_CULTURAL_ANALYSIS" };
    expect(validateClaims(synth("ok.", [{ territoryKey: "x", text: "A credible stretch." }]), [partial]).join(" ")).toMatch(/no class/u);
  });

  it("rejects numbers that are not in the results, percentages and probabilities", async () => {
    const r = await fullResult();
    const v = validateClaims(synth("Boutique Hospitality has an 82% chance of success and 7 strong signals."), r.territories);
    expect(v.join(" ")).toMatch(/percentages/u);
    expect(v.join(" ")).toMatch(/probability/u);
    expect(v.join(" ")).toMatch(/number 7 does not appear|number 82 does not appear/u);
  });

  it("rejects business-outcome predictions and unsupported metrics", async () => {
    const r = await fullResult();
    for (const text of ["Customers will definitely buy this.", "Qloo predicts the expansion will succeed.", "The territory scores well.", "The cultural distance is short.", "There is a clear path from the brand to hotels.", "We have high confidence."]) {
      expect(validateClaims(synth(text), r.territories).length, text).toBeGreaterThan(0);
    }
  });

  it("checks robustness and evidence-quality levels against each territory", async () => {
    const r = await fullResult();
    const t = r.territories.find((x) => x.robustness !== null && x.evidenceQuality !== null)!;
    const wrongRobustness = t.robustness!.level === "HIGH" ? "low" : "high";
    const wrongQuality = t.evidenceQuality!.level === "LOW" ? "high" : "low";
    expect(validateClaims(synth("ok.", [{ territoryKey: t.key, text: `Robustness is ${wrongRobustness}.` }]), r.territories).join(" ")).toMatch(new RegExp(`robustness ${wrongRobustness.toUpperCase()} does not match`, "u"));
    expect(validateClaims(synth("ok.", [{ territoryKey: t.key, text: `Evidence quality is ${wrongQuality}.` }]), r.territories).join(" ")).toMatch(new RegExp(`evidence quality ${wrongQuality.toUpperCase()}`, "u"));
    expect(validateClaims(synth("ok.", [{ territoryKey: t.key, text: `Robustness is ${t.robustness!.level.toLowerCase()}.` }]), r.territories)).toEqual([]);
    expect(validateClaims(synth("ok.", [{ territoryKey: "nope", text: "x" }]), r.territories).join(" ")).toMatch(/unknown territory/u);
  });

  it("ignores digits inside names", async () => {
    const r = await fullResult();
    const named = { ...r.territories[0]!, label: "Studio 54 Culture", key: "studio_54" };
    expect(validateClaims(synth("Studio 54 Culture has partial evidence."), [named])).toEqual([]);
  });
});

describe("deterministic template", () => {
  it("always passes claim validation across routes", async () => {
    const results = [
      ((await runtime().runtime.run({ userQuery: "q", brand: "Northwind Atelier", territories: ["Boutique Hospitality"] })) as AgentAnalysisResult),
      ((await runtime().runtime.run({ userQuery: "q", brand: "Saffron & Salt", territories: ["Tableware", "Skincare", "Slow Travel"] })) as AgentAnalysisResult),
      ((await runtime().runtime.run({ userQuery: "q", brand: "Lumen Play", territories: ["Moonlight Rituals", "Quantum Gastronomy"] })) as AgentAnalysisResult),
      ((await runtime().runtime.run({ userQuery: "q", brand: "Kestrel Outfitters", territories: [] })) as AgentAnalysisResult),
    ];
    for (const r of results) {
      expect(r.summary.claimValidation.passed).toBe(true);
      expect(validateClaims(templateSynthesis(r.brand?.label ?? null, r.territories), r.territories, r.brand ? [r.brand.label] : [])).toEqual([]);
    }
  });
});
