import { describe, expect, it } from "vitest";
import { buildBaselineResult } from "../src/brand-baseline/research.js";
import { buildDeepInvestigationRequest, HandoffError } from "../src/api/baseline-handoff.js";
import { syntheticBrand, syntheticTag, syntheticTagObservation } from "./fixtures/synthetic/brand-baseline.js";

const result = () => buildBaselineResult({
  scanId: "syn-scan-1", brandId: "syn-internal-brand-1", brand: syntheticBrand("Northwind Atelier", "syn-brand-1"),
  brandCapturedAt: "2026-10-25T00:00:00.000Z", observations: [syntheticTagObservation([syntheticTag("urn:tag:interests:qloo:maker_culture", "Maker culture")])],
  startedAt: "2026-10-25T00:00:00.000Z", finishedAt: "2026-10-25T00:01:00.000Z", providerCallCount: 2, recordedOrLive: "recorded" as const,
});

describe("SYNTHETIC baseline handoff", () => {
  it("derives the research scope only from a canonical scan and preserves source references", () => {
    const scan = result();
    const prepared = buildDeepInvestigationRequest(scan, scan.territories[0]!.id);
    expect(prepared.brand).toEqual({ name: "Northwind Atelier", qlooId: "syn-brand-1" });
    expect(prepared.agentRequest).toMatchObject({ intent: "analyze_move", brand: "Northwind Atelier", territories: [scan.territories[0]!.name] });
    expect(prepared.evidence[0]?.correlationId).toBe("syn-tags");
    expect(prepared.authorization).toBe("BASELINE_TOKEN_AND_AGENT_ADMISSION");
  });

  it("refuses a territory outside the scan or an unsupported reference", () => {
    const scan = result();
    expect(() => buildDeepInvestigationRequest(scan, "syn-other-territory")).toThrowError(HandoffError);
    const tampered = { ...scan, territories: [{ ...scan.territories[0]!, supportingReferences: [{ ...scan.territories[0]!.supportingReferences[0]!, correlationId: "syn-unrecorded" }] }] };
    expect(() => buildDeepInvestigationRequest(tampered, tampered.territories[0]!.id)).toThrow("TERRITORY_UNSUPPORTED");
  });
});
