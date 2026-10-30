/**
 * Sprint 10C: the exportable run manifest of a durable job (`ce-run-manifest/v1`), built only from the database, so a
 * run can be evaluated later (Sprint 10D) without process memory and without repeating a paid call.
 *
 * It keeps execution evidence (the provider-call journal with Qloo answers and correlation ids, checkpoint digests,
 * recovery events) apart from the research result (decisions with their short justifications, routes, provenance,
 * stop reason). It never contains a token, a credential, a prompt or the model's internal reasoning; model decisions
 * appear as the actions and one-line `reasonSummary` the runtime already validated.
 */
import type { AgentAnalysisResult, AgentRunResponse, AgentTrace, QueryResponse } from "@cultural-elasticity/shared";
import type { DurableAgentStore } from "./store.js";

export const RUN_MANIFEST_VERSION = "ce-run-manifest/v1";

export async function buildRunManifest(store: DurableAgentStore, jobId: string, options: { includeEvidence?: boolean } = {}) {
  const job = await store.getJob(jobId);
  if (!job) return null;
  const [calls, checkpoints, events] = await Promise.all([store.calls(jobId), store.jobCheckpoints(jobId), store.events(jobId)]);
  const response = (job.result as QueryResponse | null) ?? null;
  const run = (response?.investigation?.result as AgentRunResponse | null | undefined) ?? null;
  const trace: AgentTrace | null = run && "trace" in run ? (run.trace as AgentTrace) : null;
  const analysis = run && run.status !== "NEEDS_INPUT" ? (run as AgentAnalysisResult) : null;
  const request = job.request as { kind: string; body?: { query?: string; brand?: string; territories?: string[]; intent?: string } };
  const qloo = calls.filter((c) => c.provider === "qloo");
  const model = calls.filter((c) => c.provider !== "qloo");
  return {
    manifestVersion: RUN_MANIFEST_VERSION,
    labels: {
      evidence: trace?.toolProvider.mode === "live" ? "LIVE_QLOO" : trace ? "SYNTHETIC_OR_SCRIPTED" : "UNKNOWN",
      model: trace?.model.kind === "llm" ? "LIVE_MODEL" : trace ? "NOT_A_LIVE_MODEL" : "UNKNOWN",
      note: "Infrastructure recovery and research quality are separate dimensions; a recovered job is not evidence of useful research.",
    },
    job: {
      id: job.id,
      kind: job.kind,
      status: job.status,
      attempts: job.attempt,
      recovered: job.attempt > 1,
      cancelRequested: job.cancelRequested,
      unknownAuthorizedAt: job.unknownAuthorizedAt,
      errorCode: job.errorCode,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
      deadlineAt: job.deadlineAt,
      runId: job.runId,
      parentRunId: job.parentRunId,
    },
    question: {
      text: request.body?.query ?? null,
      brand: request.body?.brand ?? null,
      territories: request.body?.territories ?? null,
      requestedIntent: request.body?.intent ?? null,
      interpretedIntent: trace?.intent ?? null,
      interpretedRequest: trace?.interpretedRequest ?? null,
    },
    model: trace ? { ...trace.model, interpretationSource: trace.interpretationSource ?? null } : null,
    toolProvider: trace?.toolProvider ?? null,
    limits: trace?.limits ?? null,
    skills: trace?.skillUsage ?? [],
    turns: (trace?.turns ?? []).map((turn) => ({
      iteration: turn.iteration,
      skills: turn.skills ?? [],
      toolsExposed: turn.toolsExposed ?? [],
      focus: turn.focus ?? null,
      modelAttempts: turn.modelAttempts ?? null,
      usage: turn.usage,
      latencyMs: turn.latencyMs,
      decisions: turn.decisions.map((d) => ({ action: d.action, tool: d.tool ?? null, accepted: d.accepted, rejection: d.rejection ?? null, reasonSummary: d.reasonSummary })),
    })),
    toolCalls: (trace?.toolCalls ?? []).map((c) => ({ id: c.id, iteration: c.iteration, tool: c.tool, status: c.status, summary: c.summary, correlationIds: c.correlationIds, attempts: c.attempts, error: c.error ?? null })),
    providerCalls: {
      qloo: qloo.map((c) => ({ opKey: c.opKey, operation: c.operation, status: c.status, attempt: c.attempt, dispatchCount: c.dispatchCount, correlationId: c.correlationId, discarded: c.discarded, errorCode: c.errorCode, ...(options.includeEvidence !== false && { answer: c.result }) })),
      model: model.map((c) => ({ opKey: c.opKey, provider: c.provider, operation: c.operation, status: c.status, attempt: c.attempt, dispatchCount: c.dispatchCount, usage: c.usage })),
      totals: {
        qlooCommitted: qloo.filter((c) => c.status === "COMPLETED" || c.status === "FAILED").length,
        qlooDispatches: qloo.reduce((n, c) => n + c.dispatchCount, 0),
        unknownOutcomes: calls.filter((c) => c.status === "OUTCOME_UNKNOWN" || c.status === "UNKNOWN_ACCEPTED" || c.status === "DISPATCHING").length,
        modelCalls: model.length,
      },
    },
    representations: trace?.representations ?? [],
    representationQuality: trace?.representationQuality ?? [],
    anchorDecisions: trace?.anchorDecisions ?? [],
    feasibility: trace?.feasibility ?? [],
    referenceDiscovery: trace?.referenceDiscovery ?? null,
    earlyStops: trace?.earlyStops ?? [],
    stopReason: trace?.stopReason ?? null,
    errors: trace?.errors ?? [],
    result: analysis
      ? {
          status: analysis.status,
          territories: analysis.territories.map((t) => ({ key: t.key, label: t.label, role: t.role, route: t.analysisRoute, classification: t.classification?.label ?? null, provenance: t.provenance })),
          metrics: analysis.metrics ?? null,
          summarySource: trace?.synthesis?.source ?? null,
        }
      : run
        ? { status: run.status, territories: [], metrics: null, summarySource: null }
        : null,
    checkpoints: checkpoints.map((c) => ({ seq: c.seq, boundary: c.boundary, schemaVersion: c.schemaVersion, digest: c.digest, leaseEpoch: c.leaseEpoch, createdAt: c.createdAt })),
    recoveryEvents: events,
  };
}
