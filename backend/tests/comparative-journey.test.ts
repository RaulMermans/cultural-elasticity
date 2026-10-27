/**
 * Sprint 9I: the comparative research journey through the real API routes (SYNTHETIC world, SYN- ids).
 * Baseline policy + structural interpreter + scripted Qloo provider: no Qloo, no model, no network.
 *
 *   single-direction handoff jobs ─→ compare/options ─→ compare/preview ─→ compare/jobs ─→ job ─→ compare/:id/report
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnyBrandBaselineResult, ComparativeReferenceCandidate } from "@cultural-elasticity/shared";
import { buildApp } from "../src/app.js";
import { BaselinePolicyModel } from "../src/agent/model/baseline.js";
import { StructuralQueryInterpreter } from "../src/agent/query/interpreter.js";
import { RunStore } from "../src/agent/run-store.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { buildBaselineResult } from "../src/brand-baseline/research.js";
import { resetAdmission } from "../src/api/admission.js";
import { resetLifecycle } from "../src/ops/lifecycle.js";
import { resetSpend } from "../src/ops/spend.js";
import { scripted } from "./fixtures/synthetic/agent.js";
import { syntheticBrand, syntheticTag, syntheticTagObservation } from "./fixtures/synthetic/brand-baseline.js";

const SECRET = "ce-synthetic-internal-auth-secret-9i";
const KEYS = ["CE_INTERNAL_API_SECRET", "CE_ACCEPT_INVESTIGATIONS", "CE_SPEND_BUDGET_USD", "CE_INVESTIGATION_RESERVE_USD", "CE_PUBLIC_DEPLOYMENT"] as const;
const previous = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
afterEach(() => {
  for (const key of KEYS) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  resetAdmission();
  resetSpend();
  resetLifecycle();
});

type Scan = { token: string; result: AnyBrandBaselineResult };

function scanFor(label: string, qlooId: string): Scan {
  const scanId = randomUUID();
  const result = buildBaselineResult({
    scanId, brandId: `syn-internal-${scanId}`, brand: syntheticBrand(label, qlooId), brandCapturedAt: "2026-10-27T00:00:00.000Z",
    observations: [syntheticTagObservation([syntheticTag("urn:tag:interests:syn:slow_touring", "Slow Touring")])],
    startedAt: "2026-10-27T00:00:00.000Z", finishedAt: "2026-10-27T00:01:00.000Z", providerCallCount: 2, recordedOrLive: "recorded",
  });
  return { token: randomUUID(), result };
}

function harness(options: { accepting?: boolean } = {}) {
  process.env.CE_INTERNAL_API_SECRET = SECRET;
  process.env.CE_ACCEPT_INVESTIGATIONS = options.accepting === false ? "0" : "1";
  resetLifecycle();
  resetSpend();
  resetAdmission();
  const scans = new Map<string, Scan>();
  const runtime = new AgentRuntime({ model: new BaselinePolicyModel(), provider: scripted(), store: new RunStore() });
  const app = buildApp({
    logLevel: "silent",
    agentRuntimeFactory: () => runtime,
    queryInterpreterFactory: () => new StructuralQueryInterpreter(),
    baselineReader: {
      readScan: async (id: string, token: string) => {
        const scan = scans.get(id);
        return scan && scan.token === token ? { status: scan.result.scanStatus, providerCallCount: 2, result: scan.result, stages: [] } : null;
      },
    },
  });
  const auth = (extra: Record<string, string> = {}) => ({ "x-ce-internal-auth": SECRET, "x-ce-visitor": "visitor-sprint9i-aaaaaa01", ...extra });
  const addScan = (scan: Scan) => { scans.set(scan.result.scanId, scan); return scan; };

  async function waitFor(jobId: string, token: string) {
    for (let i = 0; i < 400; i += 1) {
      const view = (await app.inject({ method: "GET", url: `/api/agent/jobs/${jobId}`, headers: auth({ "x-job-token": token }) })).json();
      if (["completed", "failed", "cancelled", "expired"].includes(view.status)) return view;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("job did not finish");
  }
  async function investigate(scan: Scan, direction: string) {
    const response = await app.inject({ method: "POST", url: "/api/agent/handoff/jobs", headers: auth({ "x-baseline-token": scan.token }), payload: { scanId: scan.result.scanId, proposedDirection: direction, idempotencyKey: randomUUID() } });
    expect(response.statusCode, response.body).toBe(202);
    const job = response.json() as { jobId: string; accessToken: string };
    const view = await waitFor(job.jobId, job.accessToken);
    expect(view.status).toBe("completed");
    return { ...job, view };
  }
  const compare = (mode: "options" | "preview" | "jobs", scan: Scan, parent: { jobId: string; accessToken: string }, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    app.inject({ method: "POST", url: `/api/agent/handoff/compare/${mode}`, headers: auth({ "x-baseline-token": scan.token, "x-job-token": parent.accessToken, ...headers }), payload: { scanId: scan.result.scanId, parentJobId: parent.jobId, ...body } });
  const report = (jobId: string, token: string) => app.inject({ method: "GET", url: `/api/agent/handoff/compare/${jobId}/report`, headers: auth({ "x-job-token": token }) });
  return { app, runtime, auth, addScan, investigate, compare, report, waitFor };
}

const LARKSPUR = () => scanFor("Larkspur Velo", "SYN-BR-3001");
const byLabel = (references: ComparativeReferenceCandidate[], label: string) => references.find((r) => r.label === label)!;

describe("SYNTHETIC Sprint 9I comparative journey (API)", () => {
  it("1/11/13: completed hypothesis → server-offered references → governed comparison → validated panel and report", async () => {
    const h = harness();
    const scan = h.addScan(LARKSPUR());
    const parent = await h.investigate(scan, "Gravel Riding");
    await h.investigate(scan, "Alpine Hiking");
    await h.investigate(scan, "Mountain Town");

    const options = await h.compare("options", scan, parent);
    expect(options.statusCode, options.body).toBe(200);
    const offered = options.json();
    expect(offered.target).toMatchObject({ label: "Gravel Riding", entityType: "place", canAnchor: true });
    expect(offered.limits).toMatchObject({ maxQlooCalls: 32, maxPanelOptions: 6, model: "claude-haiku-5-5" });
    const alpine = byLabel(offered.references, "Alpine Hiking");
    const town = byLabel(offered.references, "Mountain Town");
    expect(alpine).toMatchObject({ source: "completed_investigation", typeEvidence: { entityType: "place", basis: "VALIDATED_REPRESENTATION" }, blocked: null });
    expect(town.typeEvidence?.entityType).toBe("place");
    // A baseline tag direction is shown, but cannot be selected without type evidence.
    expect(byLabel(offered.references, "Slow Touring")).toMatchObject({ source: "baseline_direction", typeEvidence: null, blocked: { code: "REFERENCE_TYPE_UNVERIFIED" } });
    expect(offered.connections.relationships.every((r: { rankable: boolean }) => r.rankable === false)).toBe(true);

    const preview = (await h.compare("preview", scan, parent, { referenceIds: [alpine.id, town.id] })).json();
    expect(preview.eligibility).toMatchObject({ eligible: true, code: "ELIGIBLE", candidateSet: ["Gravel Riding", "Alpine Hiking", "Mountain Town"] });
    expect(preview.eligibility.validatedReferences.map((r: { typeBasis: string }) => r.typeBasis)).toEqual(["VALIDATED_REPRESENTATION", "VALIDATED_REPRESENTATION"]);

    const started = await h.compare("jobs", scan, parent, { referenceIds: [alpine.id, town.id], idempotencyKey: randomUUID() });
    expect(started.statusCode, started.body).toBe(202);
    const job = started.json() as { jobId: string; accessToken: string };
    const view = await h.waitFor(job.jobId, job.accessToken);
    expect(view.status).toBe("completed");
    const result = view.response.investigation.result;
    expect(result).toMatchObject({ intent: "compare_territories", brand: { id: "SYN-BR-3001" }, evidenceOrigin: "synthetic" });

    const envelope = (await h.report(job.jobId, job.accessToken)).json();
    const r = envelope.report;
    expect(r.schemaVersion).toBe("ce-comparative-report/0.2");
    expect(r.outcome).toBe("RELATIVE_POSITION_ESTABLISHED");
    expect(r.checks.every((c: { passed: boolean }) => c.passed)).toBe(true);
    expect(r.evidenceOrigin).toBe("synthetic");
    // Panel evidence: the report repeats the deterministic result, it never computes a number of its own.
    const target = result.territories.find((t: { label: string }) => t.label === "Gravel Riding");
    expect(r.targetTerritory.relativePosition).toEqual({ position: target.relativePosition.position, of: target.relativePosition.of, medianPercentile: target.relativePosition.medianPercentile });
    expect(r.targetTerritory.provisionalClassification.label).toBe(target.classification.label);
    expect(r.targetTerritory.candidateSet).toEqual(target.comparisonSet.labels);
    expect(r.targetTerritory.entityType).toBe("place");
    for (const alt of r.alternativesEvaluated) {
      const source = result.territories.find((t: { key: string }) => t.key === alt.key);
      expect(alt.relativePosition?.position ?? null).toBe(source.relativePosition?.position ?? null);
      if (alt.classification) expect(alt.relativePosition).not.toBeNull();
    }
    // 13: every established statement is either the run's own key evidence or names its exemplars.
    for (const exemplar of target.representation.exemplars) expect(r.whatEvidenceEstablishes.join(" ")).toContain(exemplar.label);
    expect(r.provenance.correlationIds.length).toBeGreaterThan(0);
    expect(envelope.connections.relationships.some((rel: { kind: string }) => rel.kind === "DIRECT_QLOO_OBSERVATION")).toBe(true);
    await h.app.close();
  });

  it("2/3: an unverified reference or an incompatible type is refused with an actionable reason, not ranked", async () => {
    const h = harness();
    const scan = h.addScan(LARKSPUR());
    const parent = await h.investigate(scan, "Gravel Riding");
    await h.investigate(scan, "Alpine Hiking");
    await h.investigate(scan, "Espresso");
    const offered = (await h.compare("options", scan, parent)).json();
    const alpine = byLabel(offered.references, "Alpine Hiking");
    const espresso = byLabel(offered.references, "Espresso");
    const touring = byLabel(offered.references, "Slow Touring");
    expect(espresso.typeEvidence?.entityType).toBe("brand");

    const tooFew = (await h.compare("preview", scan, parent, { referenceIds: [alpine.id] })).json();
    expect(tooFew.eligibility).toMatchObject({ eligible: false, code: "INSUFFICIENT_REFERENCES" });
    const unverified = (await h.compare("preview", scan, parent, { referenceIds: [alpine.id, touring.id] })).json();
    expect(unverified.eligibility).toMatchObject({ eligible: false, code: "REFERENCE_TYPE_UNVERIFIED" });
    expect(unverified.eligibility.reason).toMatch(/Investigate this direction first/u);
    const mixed = (await h.compare("preview", scan, parent, { referenceIds: [alpine.id, espresso.id] })).json();
    expect(mixed.eligibility).toMatchObject({ eligible: false, code: "INCOMPATIBLE_ENTITY_TYPES" });
    expect(mixed.eligibility.reason).toMatch(/qualitative cross-domain evidence/u);
    const refused = await h.compare("jobs", scan, parent, { referenceIds: [alpine.id, espresso.id], idempotencyKey: randomUUID() });
    expect(refused.statusCode).toBe(422);
    expect(h.runtime.store.size).toBe(3);
    await h.app.close();
  });

  it("5/7: scan and job ownership, forged references and browser-supplied evidence are refused", async () => {
    const h = harness();
    const scan = h.addScan(LARKSPUR());
    const other = h.addScan(LARKSPUR());
    const parent = await h.investigate(scan, "Gravel Riding");
    await h.investigate(scan, "Alpine Hiking");
    expect((await h.compare("options", scan, parent, {}, { "x-baseline-token": "wrong" })).statusCode).toBe(404);
    expect((await h.compare("options", scan, parent, {}, { "x-job-token": "wrong" })).statusCode).toBe(404);
    // A job started from one scan cannot be compared under another scan, even by the same visitor.
    expect((await h.compare("options", other, parent)).statusCode).toBe(404);
    const forged = await h.compare("preview", scan, parent, { referenceIds: ["investigation:forged:alpine_hiking", "profile-tag:urn:tag:keyword:syn:mountain_town"] });
    expect(forged.statusCode).toBe(422);
    expect(forged.json().error).toBe("reference_not_offered");
    // The body has no field for types, evidence, scores or budgets; adding one is rejected outright.
    const smuggled = await h.compare("preview", scan, parent, { referenceIds: [], entityType: "place", maxQlooCalls: 120 });
    expect(smuggled.statusCode).toBe(400);
    await h.app.close();
  });

  it("8: paused paid admission still previews eligibility but starts no job", async () => {
    const h = harness();
    const scan = h.addScan(LARKSPUR());
    const parent = await h.investigate(scan, "Gravel Riding");
    const sibling = await h.investigate(scan, "Alpine Hiking");
    await h.investigate(scan, "Mountain Town");
    process.env.CE_ACCEPT_INVESTIGATIONS = "0";
    resetLifecycle();
    const offered = (await h.compare("options", scan, parent)).json();
    expect(offered.admission.accepting).toBe(false);
    const ids = [byLabel(offered.references, "Alpine Hiking").id, byLabel(offered.references, "Mountain Town").id];
    expect((await h.compare("preview", scan, parent, { referenceIds: ids })).json().eligibility.eligible).toBe(true);
    const runsBefore = h.runtime.store.size;
    const blocked = await h.compare("jobs", scan, parent, { referenceIds: ids, idempotencyKey: randomUUID() });
    expect(blocked.statusCode).toBe(503);
    expect(h.runtime.store.size).toBe(runsBefore);
    expect(sibling.view.status).toBe("completed");
    await h.app.close();
  });

  it("9: a repeated start never dispatches twice; an exhausted spend budget refuses the start", async () => {
    const h = harness();
    const scan = h.addScan(LARKSPUR());
    const parent = await h.investigate(scan, "Gravel Riding");
    await h.investigate(scan, "Alpine Hiking");
    await h.investigate(scan, "Mountain Town");
    const offered = (await h.compare("options", scan, parent)).json();
    const pair = [byLabel(offered.references, "Alpine Hiking").id, byLabel(offered.references, "Mountain Town").id];
    const key = randomUUID();
    const first = await h.compare("jobs", scan, parent, { referenceIds: pair, idempotencyKey: key });
    expect(first.statusCode, first.body).toBe(202);
    const again = await h.compare("jobs", scan, parent, { referenceIds: pair, idempotencyKey: key });
    expect(again.statusCode).toBe(200);
    expect(again.json().jobId).toBe(first.json().jobId);
    const conflict = await h.compare("jobs", scan, parent, { referenceIds: [pair[0]], idempotencyKey: key });
    expect(conflict.statusCode).toBe(409);
    await h.waitFor(first.json().jobId, first.json().accessToken);

    // The remaining authorized spend cannot cover one more conservative reservation: nothing is dispatched.
    process.env.CE_SPEND_BUDGET_USD = "0.5";
    process.env.CE_INVESTIGATION_RESERVE_USD = "1";
    resetSpend();
    const runsBefore = h.runtime.store.size;
    const over = await h.compare("jobs", scan, parent, { referenceIds: pair, idempotencyKey: randomUUID() });
    expect(over.statusCode).toBe(429);
    expect(over.json().error).toBe("budget_exhausted");
    expect(h.runtime.store.size).toBe(runsBefore);
    await h.app.close();
  });

  it("10: a failed or expired comparison yields no report, and an unknown job is not reconstructed", async () => {
    const h = harness();
    const scan = h.addScan(LARKSPUR());
    const parent = await h.investigate(scan, "Gravel Riding");
    await h.investigate(scan, "Alpine Hiking");
    await h.investigate(scan, "Mountain Town");
    const offered = (await h.compare("options", scan, parent)).json();
    const ids = [byLabel(offered.references, "Alpine Hiking").id, byLabel(offered.references, "Mountain Town").id];

    // SYNTHETIC runtime failure: the job fails, and the report endpoint shows no ranking for it.
    const run = h.runtime.run.bind(h.runtime);
    h.runtime.run = async () => { throw new Error("SYNTHETIC runtime failure"); };
    const failed = (await h.compare("jobs", scan, parent, { referenceIds: ids, idempotencyKey: randomUUID() })).json();
    expect((await h.waitFor(failed.jobId, failed.accessToken)).status).toBe("failed");
    expect((await h.report(failed.jobId, failed.accessToken)).json()).toMatchObject({ status: "failed", report: null, connections: null });
    h.runtime.run = run;

    const job = (await h.compare("jobs", scan, parent, { referenceIds: ids, idempotencyKey: randomUUID() })).json();
    expect((await h.waitFor(job.jobId, job.accessToken)).status).toBe("completed");
    expect((await h.report(job.jobId, job.accessToken)).json().report).not.toBeNull();
    // After its retention window the in-process result is gone: expired, never rebuilt.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
      expect((await h.report(job.jobId, job.accessToken)).json()).toMatchObject({ status: "expired", report: null });
    } finally { vi.useRealTimers(); }
    expect((await h.report(randomUUID(), job.accessToken)).statusCode).toBe(404);
    expect((await h.report(job.jobId, "wrong")).statusCode).toBe(404);
    // A single-direction job is not a comparison: no report is invented for it.
    expect((await h.report(parent.jobId, parent.accessToken)).statusCode).toBe(404);
    await h.app.close();
  });
});
