/**
 * Sprint 9I: records the SYNTHETIC comparative journey through the real backend routes, for the browser tests.
 *
 * Usage: pnpm --filter backend exec tsx scripts/synthetic/build-comparative-e2e.ts
 *
 * Baseline policy + structural interpreter + scripted provider over the synthetic world (SYN- ids): no Qloo, no
 * model, no network. Writes backend/tests/fixtures/synthetic/comparative-e2e.json, labelled SYNTHETIC.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildApp } from "../../src/app.js";
import { BaselinePolicyModel } from "../../src/agent/model/baseline.js";
import { StructuralQueryInterpreter } from "../../src/agent/query/interpreter.js";
import { RunStore } from "../../src/agent/run-store.js";
import { AgentRuntime } from "../../src/agent/runtime.js";
import { buildBaselineResult } from "../../src/brand-baseline/research.js";
import { resetLifecycle } from "../../src/ops/lifecycle.js";
import { scripted } from "../../tests/fixtures/synthetic/agent.js";
import { syntheticBrand, syntheticTag, syntheticTagObservation } from "../../tests/fixtures/synthetic/brand-baseline.js";

process.env.CE_ACCEPT_INVESTIGATIONS = "1";
delete process.env.CE_INTERNAL_API_SECRET;
resetLifecycle();

const scanId = "00000000-0000-4000-8000-0000000009a1";
const token = "syn-token";
const baseline = buildBaselineResult({
  scanId, brandId: "syn-internal-brand-9i", brand: syntheticBrand("Larkspur Velo", "SYN-BR-3001"), brandCapturedAt: "2026-10-27T00:00:00.000Z",
  observations: [syntheticTagObservation([syntheticTag("urn:tag:interests:syn:slow_touring", "Slow Touring")])],
  startedAt: "2026-10-27T00:00:00.000Z", finishedAt: "2026-10-27T00:01:00.000Z", providerCallCount: 2, recordedOrLive: "recorded",
});
const runtime = new AgentRuntime({ model: new BaselinePolicyModel(), provider: scripted(), store: new RunStore() });
const app = buildApp({
  logLevel: "silent",
  agentRuntimeFactory: () => runtime,
  queryInterpreterFactory: () => new StructuralQueryInterpreter(),
  baselineReader: { readScan: async (id, presented) => (id === scanId && presented === token ? { status: baseline.scanStatus, providerCallCount: 2, result: baseline, stages: [] } : null) },
});
const headers = { "x-ce-visitor": "visitor-sprint9i-e2e00001" };

async function finished(jobId: string, accessToken: string) {
  for (let i = 0; i < 400; i += 1) {
    const view = (await app.inject({ method: "GET", url: `/api/agent/jobs/${jobId}`, headers: { ...headers, "x-job-token": accessToken } })).json();
    if (["completed", "failed", "cancelled", "expired"].includes(view.status)) return view;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("job did not finish");
}
async function investigate(direction: string) {
  const created = (await app.inject({ method: "POST", url: "/api/agent/handoff/jobs", headers: { ...headers, "x-baseline-token": token }, payload: { scanId, proposedDirection: direction, idempotencyKey: randomUUID() } })).json();
  return { created, view: await finished(created.jobId, created.accessToken) };
}

const parent = await investigate("Gravel Riding");
await investigate("Alpine Hiking");
await investigate("Mountain Town");
await investigate("Espresso");
const compareHeaders = { ...headers, "x-baseline-token": token, "x-job-token": parent.created.accessToken };
const body = { scanId, parentJobId: parent.created.jobId };
const options = (await app.inject({ method: "POST", url: "/api/agent/handoff/compare/options", headers: compareHeaders, payload: body })).json();
const ids = ["Alpine Hiking", "Mountain Town"].map((label) => options.references.find((r: { label: string }) => r.label === label).id);
const espresso = options.references.find((r: { label: string }) => r.label === "Espresso").id;
const preview = (await app.inject({ method: "POST", url: "/api/agent/handoff/compare/preview", headers: compareHeaders, payload: { ...body, referenceIds: ids } })).json();
const incompatible = (await app.inject({ method: "POST", url: "/api/agent/handoff/compare/preview", headers: compareHeaders, payload: { ...body, referenceIds: [ids[0], espresso] } })).json();
const compareCreated = (await app.inject({ method: "POST", url: "/api/agent/handoff/compare/jobs", headers: compareHeaders, payload: { ...body, referenceIds: ids, idempotencyKey: randomUUID() } })).json();
const compareView = await finished(compareCreated.jobId, compareCreated.accessToken);
const report = (await app.inject({ method: "GET", url: `/api/agent/handoff/compare/${compareCreated.jobId}/report`, headers: { ...headers, "x-job-token": compareCreated.accessToken } })).json();
await app.close();

if (report.report?.outcome !== "RELATIVE_POSITION_ESTABLISHED") throw new Error(`unexpected outcome ${report.report?.outcome}`);
/** Browser fixture only: the token is replaced and the large agent trace and methodology runs are omitted. */
const strip = ({ accessToken: _token, ...view }: Record<string, unknown>) => {
  const result = (view.response as { investigation?: { result?: Record<string, unknown> } } | null)?.investigation?.result;
  if (result) Object.assign(result, { trace: { omitted: "SYNTHETIC browser fixture: trace not included" }, methodologyRuns: [] });
  return view;
};
const fixture = {
  fixtureType: "synthetic",
  notice: "SYNTHETIC: recorded from the real backend routes over the synthetic agent world (baseline policy, structural interpreter, scripted provider). Not Qloo evidence and not a model run.",
  baseline,
  parent: { created: { ...parent.created, accessToken: "syn-parent-job-token" }, view: strip(parent.view) },
  options,
  ids,
  espresso,
  preview,
  incompatible,
  compare: { created: { ...compareCreated, accessToken: "syn-compare-job-token" }, view: strip(compareView) },
  report,
};
writeFileSync(fileURLToPath(new URL("../../tests/fixtures/synthetic/comparative-e2e.json", import.meta.url)), `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`wrote comparative-e2e.json (outcome ${report.report.outcome}, ${options.references.length} references)`);
