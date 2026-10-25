import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AgentAnalysisResult } from "@cultural-elasticity/shared";
import { buildResearchFinding } from "./research-findings.ts";

const recorded = JSON.parse(readFileSync(new URL("../demo/recorded-example.json", import.meta.url), "utf8")) as { responses: { investigation?: { result?: AgentAnalysisResult } }[] };
const result = recorded.responses.find((item) => item.investigation?.result?.status === "COMPLETE")?.investigation?.result;

test("recorded-live finding keeps scope and provider references", () => {
  assert.ok(result && result.status === "COMPLETE");
  const target = result.territories.find((item) => item.role === "target")!;
  const finding = buildResearchFinding(result, target.key);
  assert.ok(finding);
  assert.equal(finding.schemaVersion, "ce-research-finding/0.1");
  assert.equal(finding.brand.id, result.brand?.id);
  assert.equal(finding.origin, "live");
  assert.deepEqual(finding.evidenceReferences, [...new Set(target.provenance.correlationIds)]);
  assert.equal(finding.evidenceScope.route, target.analysisRoute);
});

test("missing provider support cannot become an observation or interpretation", () => {
  assert.ok(result && result.status === "COMPLETE");
  const target = result.territories.find((item) => item.role === "target")!;
  const changed = structuredClone(result);
  changed.territories = changed.territories.map((item) => item.key === target.key ? { ...item, provenance: { ...item.provenance, correlationIds: [] } } : item);
  const finding = buildResearchFinding(changed, target.key)!;
  assert.equal(finding.status, "INSUFFICIENT");
  assert.equal(finding.observation, null);
  assert.deepEqual(finding.interpretations, []);
});
