/** One bounded live Qloo canary. No model import and no Anthropic call. */
import { randomBytes, randomUUID } from "node:crypto";
import { loadLocalEnvFile } from "../src/config/env.js";
import { createBaselinePool, migrate } from "../src/brand-baseline/db.js";
import { BaselineRepository, payloadHash } from "../src/brand-baseline/repository.js";
import { resolveBrand } from "../src/brand-baseline/research.js";
import { BaselineWorker, createLiveBaselineCallGate } from "../src/brand-baseline/worker.js";

loadLocalEnvFile();
const brandName = process.argv[2]?.trim() || "Loewe";
const selectedQlooId = process.argv[3]?.trim() || undefined;
const pool = createBaselinePool(process.env.DATABASE_URL);
const repository = new BaselineRepository(pool);
let gate: ReturnType<typeof createLiveBaselineCallGate> | null = null;
try {
  await migrate(pool);
  const before = await repository.budgetSnapshot();
  if (before.usedCalls !== 0) throw new Error("CANARY_DATABASE_MUST_HAVE_ZERO_PRIOR_CALLS");
  await repository.setQlooCallLimit(7);
  gate = createLiveBaselineCallGate(repository);
  const scope = `canary-${randomUUID()}`;
  const accessToken = randomBytes(32).toString("base64url");
  const resolutionId = await repository.createResolution(scope, accessToken, brandName, selectedQlooId);
  const resolution = await resolveBrand(gate.scoped({ resolutionId }), brandName, selectedQlooId);
  await repository.finishResolution(resolutionId, resolution.status === "RESOLVED" ? { status: "RESOLVED", entity: resolution.entity } : resolution.status === "AMBIGUOUS" ? { status: "AMBIGUOUS", candidates: resolution.candidates } : { status: resolution.status }, resolution.status === "RESOLVED" ? resolution.entity.provenance[0]?.correlationId : undefined);
  if (resolution.status !== "RESOLVED") {
    console.log(JSON.stringify({ canary: "NOT_COMPLETED", resolutionStatus: resolution.status, candidates: resolution.status === "AMBIGUOUS" ? resolution.candidates : [], usedCalls: (await repository.budgetSnapshot()).usedCalls }));
    process.exitCode = 2;
  } else {
    const idempotencyKey = `canary-${randomUUID()}`;
    const requestHash = payloadHash({ resolutionId });
    const created = await repository.createScan({ resolutionId, scope, accessToken, idempotencyKey, requestHash });
    const worker = new BaselineWorker(repository, gate);
    const started = performance.now();
    await worker.run(created.id);
    const first = await repository.readScan(created.id, accessToken);
    const beforeRepeat = await repository.budgetSnapshot();
    const repeated = await repository.createScan({ resolutionId, scope, accessToken, idempotencyKey, requestHash });
    const afterRepeat = await repository.budgetSnapshot();
    if (!repeated.reused || repeated.id !== created.id || afterRepeat.usedCalls !== beforeRepeat.usedCalls) throw new Error("IDEMPOTENT_REPEAT_FAILED");
    const calls = await pool.query<{ operation: string; status: string; provider_correlation_id: string | null; outcome_category: string | null; duration_ms: number | null }>("SELECT operation,status,provider_correlation_id,outcome_category,duration_ms FROM baseline_provider_calls WHERE resolution_id=$1 OR scan_id=$2 ORDER BY dispatched_at,id", [resolutionId, created.id]);
    if (calls.rows.length > 7) throw new Error("CANARY_CALL_CAP_BREACHED");
    await pool.end();
    const reopened = createBaselinePool(process.env.DATABASE_URL);
    let persisted: Awaited<ReturnType<BaselineRepository["readScan"]>>;
    try { persisted = await new BaselineRepository(reopened).readScan(created.id, accessToken); } finally { await reopened.end(); }
    console.log(JSON.stringify({
      canary: persisted?.result ? "COMPLETED" : "INCOMPLETE",
      scanId: created.id,
      resolutionStatus: resolution.status,
      scanStatus: persisted?.status,
      totalQlooCalls: calls.rows.length,
      scanQlooCalls: first?.providerCallCount,
      durationMs: Math.round(performance.now() - started),
      idempotentRepeatNewCalls: afterRepeat.usedCalls - beforeRepeat.usedCalls,
      persistedAfterReconnect: Boolean(persisted?.result),
      calls: calls.rows,
      coverage: persisted?.result?.fingerprint.domainCoverage,
      signals: persisted?.result?.fingerprint.signals.map((signal) => ({ id: signal.id, name: signal.name, domain: signal.domain, correlationId: signal.source.correlationId })),
      territories: persisted?.result?.territories.map((territory) => ({ name: territory.name, concept: territory.canonicalConcept, status: territory.evidenceStatus, correlationIds: territory.supportingReferences.map((ref) => ref.correlationId) })),
      limitations: persisted?.result?.fingerprint.limitations,
    }));
    if (!persisted?.result) process.exitCode = 3;
  }
} catch (error) {
  console.error(error instanceof Error && /^(CANARY_|IDEMPOTENT_|DATABASE_NOT_CONFIGURED|QLOO_NOT_CONFIGURED|QLOO_HOST_NOT_VERIFIED|BASELINE_QLOO_SPACING_UNSAFE)/u.test(error.message) ? error.message : "LIVE_QLOO_BASELINE_FAILED");
  process.exitCode = 1;
} finally {
  gate?.close();
  if (!pool.ended) await pool.end();
}
