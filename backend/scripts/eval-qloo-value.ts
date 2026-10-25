/** Offline reproducibility audit. A model-only arm requires separately approved spend and human review. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentAnalysisResult } from "@cultural-elasticity/shared";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
type Case = { id: string; question: string; brand: string; conditionB: { artifact: string; sha256: string }; conditionA: { status: "NOT_RUN" } };
type Manifest = { schemaVersion: string; fixtureType: string; cases: Case[] };

export function evaluate(manifest: Manifest, read: (path: string) => Buffer) {
  if (manifest.schemaVersion !== "ce-qloo-value-benchmark/0.1" || manifest.fixtureType !== "recorded_live" || manifest.cases.length < 6 || manifest.cases.length > 10) throw new Error("BENCHMARK_MANIFEST_INVALID");
  const ids = new Set<string>();
  const cases = manifest.cases.map((entry) => {
    if (ids.has(entry.id) || entry.conditionA.status !== "NOT_RUN" || !/^backend\/feasibility-output\/sprint5a2-live\/final\/live_model-L-[A-Z][0-9]\.json$/u.test(entry.conditionB.artifact)) throw new Error("BENCHMARK_CASE_INVALID");
    ids.add(entry.id);
    const bytes = read(entry.conditionB.artifact);
    if (createHash("sha256").update(bytes).digest("hex") !== entry.conditionB.sha256) throw new Error(`ARTIFACT_CHECKSUM_MISMATCH:${entry.id}`);
    const result = JSON.parse(bytes.toString("utf8")) as AgentAnalysisResult;
    if (result.evidenceOrigin !== "live" || result.model.id !== "claude-haiku-5-5" || result.brand?.label !== entry.brand || result.userQuery !== entry.question || result.status !== "COMPLETE") throw new Error(`ARTIFACT_PROVENANCE_INVALID:${entry.id}`);
    const targetTerritories = result.territories.filter((item) => item.role === "target" || item.role === "frontier_candidate");
    return {
      id: entry.id,
      question: entry.question,
      brand: entry.brand,
      conditionA: "NOT_RUN" as const,
      conditionB: {
        origin: "recorded_live" as const,
        model: result.model.id,
        runId: result.runId,
        territoryCount: targetTerritories.length,
        eligibleTerritoriesSourceLinked: targetTerritories.every((item) => item.analysisRoute === "INSUFFICIENT_EVIDENCE" || item.provenance.correlationIds.length > 0),
        acceptedSummaryPassedValidator: result.summary.claimValidation.passed,
        rejectedSummaryClaims: result.summary.claimValidation.violations.length,
        nextStepsPresent: result.followUpOptions.length > 0,
        insufficientTerritories: targetTerritories.filter((item) => item.analysisRoute === "INSUFFICIENT_EVIDENCE").length,
        artifact: entry.conditionB.artifact,
        sha256: entry.conditionB.sha256,
      },
    };
  });
  return {
    schemaVersion: "ce-qloo-value-benchmark-report/0.1",
    comparisonStatus: "NOT_RUN" as const,
    finding: "No measured Qloo-versus-LLM-only value difference is available.",
    caseCount: cases.length,
    conditionB: {
      sourceLinkedCases: cases.filter((item) => item.conditionB.eligibleTerritoriesSourceLinked).length,
      acceptedSummaryValidatorPasses: cases.filter((item) => item.conditionB.acceptedSummaryPassedValidator).length,
      rejectedSummaryClaims: cases.reduce((total, item) => total + item.conditionB.rejectedSummaryClaims, 0),
      casesWithNextSteps: cases.filter((item) => item.conditionB.nextStepsPresent).length,
    },
    cases,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(readFileSync(resolve(root, "evals/qloo-value/cases.json"), "utf8")) as Manifest;
  const report = evaluate(manifest, (path) => readFileSync(resolve(root, path)));
  const output = process.argv.indexOf("--out");
  if (output >= 0 && process.argv[output + 1]) writeFileSync(resolve(process.argv[output + 1]!), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
