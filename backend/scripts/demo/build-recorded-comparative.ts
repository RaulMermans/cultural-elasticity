/**
 * Sprint 9I: builds the recorded comparative demonstration from stored live evidence only.
 *
 * Usage: pnpm --filter backend exec tsx scripts/demo/build-recorded-comparative.ts
 *
 * Sources (live-origin, verified earlier, read offline):
 *   docs/sprint-9g/evidence/loewe-boutique-hospitality.live.json   live Haiku + Qloo single-direction investigation
 *   frontend/src/demo/recorded-baselines.json (key "loewe")         live Loewe baseline scan
 *
 * It applies the production bridge (reference candidates, eligibility) and the relationship projection to that
 * evidence. No provider is called, nothing is invented: the stored evidence supports no comparison, and the
 * output says so instead of manufacturing a ranking.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectCulturalConnections, type AgentAnalysisResult, type AnyBrandBaselineResult } from "@cultural-elasticity/shared";
import { assessComparisonEligibility, collectReferenceCandidates, representationProblem } from "../../src/agent/comparative-bridge.js";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const investigationPath = "docs/sprint-9g/evidence/loewe-boutique-hospitality.live.json";
const baselinePath = "frontend/src/demo/recorded-baselines.json";
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const investigationText = read(investigationPath);
const baselineText = read(baselinePath);
const investigation = JSON.parse(investigationText) as AgentAnalysisResult;
const recorded = JSON.parse(baselineText) as { items: { key: string; evidenceOrigin: string; recordedAt: string; result: AnyBrandBaselineResult }[] };
const baselineItem = recorded.items.find((item) => item.key === "loewe");
if (!baselineItem || baselineItem.evidenceOrigin !== "live") throw new Error("the recorded Loewe baseline must be live-origin");
if (investigation.evidenceOrigin !== "live" || investigation.status !== "COMPLETE") throw new Error("the source investigation must be a completed live run");
const baseline = baselineItem.result;
if (investigation.brand?.id !== baseline.brand.qlooId) throw new Error("the investigation and the baseline resolve different brands");

const target = investigation.territories.find((territory) => territory.role === "target");
if (!target) throw new Error("the investigation has no target territory");
const brand = { id: baseline.brand.qlooId, label: baseline.brand.name, resolution: investigation.brand.resolution };

// The stored result keeps no exemplar tag profiles, and no other investigation of this brand was recorded.
const references = collectReferenceCandidates({ brandId: brand.id, target, exemplarProfiles: [], siblings: [], baseline });
const eligibility = assessComparisonEligibility(brand, target, references, { expectedBrandId: brand.id });
const connections = projectCulturalConnections({ brand: { id: brand.id, name: brand.label }, evidenceOrigin: "recorded", baseline, runs: [investigation] });
const assessment = investigation.hypothesisAssessment;

const output = {
  kind: "RECORDED_COMPARATIVE_DEMO",
  evidenceOrigin: "live",
  note: "Built offline from stored live Qloo evidence with the production comparison gate. It does not call a provider and contains no comparative ranking, because no recorded comparative run exists.",
  sources: [
    { path: investigationPath, sha256: sha256(investigationText), model: investigation.model.id },
    { path: baselinePath, key: "loewe", sha256: sha256(baselineText), recordedAt: baselineItem.recordedAt },
  ],
  brand: { qlooId: brand.id, name: brand.label },
  investigation: {
    runId: investigation.runId,
    question: assessment?.question ?? investigation.userQuery,
    outcome: assessment?.outcome ?? null,
    observed: assessment?.observed ?? [],
    limitations: assessment?.limitations ?? [],
    unknowns: assessment?.unknowns ?? [],
    nextStep: assessment?.nextStep ?? null,
    correlationIds: assessment?.correlationIds ?? target.provenance.correlationIds,
    target: {
      label: target.label,
      conceptId: target.resolvedConcept?.id ?? null,
      entityType: target.representation.entityType,
      exemplars: target.representation.exemplars.map((exemplar) => ({ label: exemplar.label, type: exemplar.type })),
      canAnchor: representationProblem(target) === null,
    },
  },
  references,
  eligibility,
  connections,
  comparison: {
    status: "NOT_RUN",
    reason: "No reference has Qloo evidence of a place representation: the two baseline directions are tags only, and the stored investigation keeps no exemplar tag profiles. A comparison would need new authorized live calls.",
    request: "docs/sprint-9i/LIVE_VALIDATION_REQUEST.md",
  },
};

const text = `${JSON.stringify(output, null, 2)}\n`;
if (/sk-ant-|api[_-]?key|bearer\s+|QLOO_API_KEY|ANTHROPIC_API_KEY/iu.test(text)) throw new Error("refusing to write something that looks like a credential");
writeFileSync(resolve(root, "frontend/src/demo/recorded-comparative.json"), text);
console.log(`wrote frontend/src/demo/recorded-comparative.json: ${references.length} references, eligibility ${eligibility.code}, ${connections.relationships.length} relationships`);
