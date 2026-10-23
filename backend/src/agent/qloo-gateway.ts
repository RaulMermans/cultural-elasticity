/**
 * Qloo gateway: every Qloo request of a run goes through `callQloo`, which
 *   - answers identical requests from the run cache (no second upstream call, no budget use);
 *   - refuses a call when the Qloo budget is spent, and caps retries so a retry cannot exceed it;
 *   - counts every upstream attempt against the budget;
 *   - records operations and correlation ids on the calling tool's trace entry;
 * and the `record*` functions write observed evidence into run state (entities, tags, pools, profiles).
 * Nothing here interprets a value.
 */
import type { AgentToolCallTrace } from "@cultural-elasticity/shared";
import { toEntitySignals, toTagSignals } from "../qloo/normalize.js";
import type { LiveCall } from "../qloo/live-adapter.js";
import type { QlooOperation, QlooOperationInput } from "../qloo/types.js";
import { recorderOf } from "../ops/spans.js";
import { shortEntityType, type RankableType } from "./contracts.js";
import { recordEntity, recordTag, remainingQlooCalls, type AgentRunState } from "./state.js";
import type { AgentToolProvider, QlooCallMeta, QlooCallResult } from "./tool-provider.js";

const EMPTY_META = (operationId: string): QlooCallMeta => ({ operationId, spacingMs: 0, rateLimitMs: 0, startupMs: 0 });

/** [live] The harness caps entity_tags at 20; tie order depends on take, so one fixed take everywhere. */
export const PROFILE_TAKE = 20;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function cacheKey(operation: QlooOperation, input: unknown): string {
  return `${operation}:${stable(input)}`;
}

/**
 * Sprint 5A.2 (live, final run): tool calls the executor abandoned on TOOL_TIMEOUT. The Qloo request keeps running; an
 * answer that arrives afterwards is discarded (counted against the budget, never cached or recorded), because the trace
 * already reports the call as failed and a failed call is never evidence.
 */
export const abandonedToolCalls = new WeakSet<AgentToolCallTrace>();

function refuse(code: string, detail: string, attempts: number, callMeta: QlooCallMeta): QlooCallResult {
  return { outcome: "failed", code, retryable: false, detail, attempts, callMeta };
}

/**
 * Charge at most `attempts` against the run budget. The first unit is reserved at dispatch; extra
 * retries settle here. Never exceeds `maxQlooCalls`. Returns how many units were newly charged.
 */
function settleAttempts(state: AgentRunState, operationId: string, observedAttempts: number, reserved: number): number {
  if (state.settledOperationIds.has(operationId)) return 0;
  state.settledOperationIds.add(operationId);
  const extra = Math.max(0, observedAttempts - reserved);
  const room = Math.max(0, state.limits.maxQlooCalls - state.usage.qlooCalls);
  const chargeExtra = Math.min(extra, room);
  state.usage.qlooCalls += chargeExtra;
  state.usage.retries += extra;
  return reserved + chargeExtra;
}

export async function callQloo<O extends QlooOperation>(
  state: AgentRunState,
  provider: AgentToolProvider,
  trace: AgentToolCallTrace,
  operation: O,
  input: QlooOperationInput[O],
): Promise<QlooCallResult> {
  const key = cacheKey(operation, input);
  const cached = state.callCache.get(key);
  if (cached) {
    trace.qlooOperations.push(`${operation} (cached)`);
    if ("call" in cached) trace.correlationIds.push(cached.call.envelope.execution.correlation_id);
    recorderOf(state)?.record({
      runId: state.runId,
      turnIndex: state.usage.iterations,
      phase: "QLOO_REQUEST",
      operation: `${operation}:cached`,
      startOffsetMs: recorderOf(state)?.offsetMs() ?? 0,
      durationMs: 0,
      outcome: "cached",
    });
    return cached;
  }
  if (state.finalized) {
    return refuse("RUN_FINALIZED", "the investigation already finalized; a pending provider call cannot become evidence", 0, EMPTY_META(`${trace.id}:${operation}:finalized`));
  }
  const remaining = remainingQlooCalls(state);
  if (remaining < 1) return refuse("BUDGET_EXHAUSTED", `Qloo call budget (${state.limits.maxQlooCalls}) is spent`, 0, EMPTY_META(`${trace.id}:${operation}:budget`));

  const operationId = `${state.runId}:${trace.id}:${operation}:${state.usage.qlooCalls}`;
  state.usage.qlooCalls += 1;
  state.qlooInFlight += 1;
  trace.attempts += 1;
  const reserved = 1;

  const started = performance.now();
  const rec = recorderOf(state);
  const requestSpan = rec?.start({ runId: state.runId, turnIndex: state.usage.iterations, phase: "QLOO_REQUEST", operation, parentSpanId: null });
  try {
    const result = await provider.call(operation, input, { maxRetries: Math.min(state.limits.maxRetryPerToolCall, remaining - 1) });
    const elapsed = Math.round(performance.now() - started);
    const meta: QlooCallMeta = result.callMeta ?? EMPTY_META(operationId);
    const abandoned = abandonedToolCalls.has(trace);
    const afterFinalization = state.finalized;
    const observedAttempts = Math.max(reserved, result.attempts);
    const charged = afterFinalization ? reserved : settleAttempts(state, operationId, observedAttempts, reserved);
    if (afterFinalization) {
      state.settledOperationIds.add(operationId);
      state.lateSettlements.push({ operationId, observedAttempts, charged: reserved, discarded: true, afterFinalization: true });
    } else if (abandoned) {
      state.lateSettlements.push({ operationId, observedAttempts, charged, discarded: true, afterFinalization: false });
    }
    if (!afterFinalization) {
      state.usage.qlooLatencyMs += elapsed;
      if (meta.spacingMs + meta.rateLimitMs > 0) state.usage.qlooSpacingMs += meta.spacingMs + meta.rateLimitMs;
      if (observedAttempts > reserved) trace.attempts += observedAttempts - reserved;
    }
    if (rec && requestSpan && !afterFinalization) {
      const origin = rec.offsetMs() - elapsed;
      if (meta.spacingMs + meta.rateLimitMs > 0) {
        rec.record({ runId: state.runId, turnIndex: state.usage.iterations, phase: "QLOO_SPACING", operation: `${operation}:spacing`, parentSpanId: requestSpan.spanId, startOffsetMs: Math.max(0, origin), durationMs: meta.spacingMs + meta.rateLimitMs });
      }
      if (meta.startupMs > 0) {
        rec.record({ runId: state.runId, turnIndex: state.usage.iterations, phase: "QLOO_TRANSPORT_STARTUP", operation: `${operation}:startup`, parentSpanId: requestSpan.spanId, startOffsetMs: Math.max(0, origin + meta.spacingMs + meta.rateLimitMs), durationMs: meta.startupMs });
      }
    }
    const qlooOutcome = result.outcome === "ok" || result.outcome === "empty" ? result.outcome : result.outcome === "needs_input" ? "ok" : "error";
    if (!afterFinalization) {
      requestSpan?.end(abandoned ? "timeout" : qlooOutcome, "code" in result ? result.code : undefined);
      rec?.record({
        runId: state.runId,
        turnIndex: state.usage.iterations,
        phase: "QLOO_RESPONSE",
        operation: `${operation}:${abandoned ? "timeout" : result.outcome}`,
        parentSpanId: requestSpan?.spanId ?? null,
        startOffsetMs: rec.offsetMs(),
        durationMs: 0,
        outcome: abandoned ? "timeout" : qlooOutcome,
      });
    }
    if (abandoned || afterFinalization) {
      if (!afterFinalization) trace.qlooOperations.push(`${operation} (late answer discarded)`);
      return refuse(
        afterFinalization ? "RUN_FINALIZED" : "TOOL_TIMEOUT",
        afterFinalization
          ? "the Qloo answer arrived after the investigation finalized and was discarded"
          : "the Qloo answer arrived after the tool timeout and was discarded",
        observedAttempts,
        meta,
      );
    }
    trace.qlooOperations.push(operation);
    if ("call" in result) {
      trace.correlationIds.push(result.call.envelope.execution.correlation_id);
      state.flags.push(...result.flags);
      state.callCache.set(key, result);
    } else if (result.correlationId) {
      trace.correlationIds.push(result.correlationId);
    }
    return result;
  } catch (error) {
    if (!state.settledOperationIds.has(operationId) && !state.finalized) settleAttempts(state, operationId, reserved, reserved);
    requestSpan?.end("error", error instanceof Error ? error.name.slice(0, 80) : "QLOO_ERROR");
    throw error;
  } finally {
    state.qlooInFlight = Math.max(0, state.qlooInFlight - 1);
  }
}

const corr = (call: LiveCall) => call.envelope.execution.correlation_id;

/** Entities returned by recommend/rank. [live] recommend reports member type "urn:entity"; the requested type is authoritative. */
function entitySignals(call: LiveCall) {
  return toEntitySignals(call.operation, call.envelope);
}

export function recordPool(state: AgentRunState, call: LiveCall, scope: { tagIds: string[]; targetType: RankableType; conditionedOn: string | null }): string[] {
  const memberIds: string[] = [];
  for (const signal of entitySignals(call)) {
    recordEntity(
      state,
      { id: signal.qlooId, label: signal.label, type: scope.targetType },
      { kind: scope.conditionedOn ? "conditioned" : "tag_member", tagIds: scope.tagIds, conditionedOn: scope.conditionedOn, correlationId: corr(call), popularity: signal.popularity ?? null },
    );
    memberIds.push(signal.qlooId);
  }
  state.pools.push({ tagIds: scope.tagIds, targetType: scope.targetType, conditionedOn: scope.conditionedOn, call, memberIds });
  return memberIds;
}

export function recordRelated(state: AgentRunState, call: LiveCall, subjectId: string, targetType: RankableType): string[] {
  const memberIds = entitySignals(call).map((signal) => {
    recordEntity(state, { id: signal.qlooId, label: signal.label, type: targetType }, { kind: "related", tagIds: [], conditionedOn: subjectId, correlationId: corr(call), popularity: signal.popularity ?? null });
    return signal.qlooId;
  });
  state.related.push({ subjectId, targetType, call, memberIds });
  return memberIds;
}

export function recordProfile(state: AgentRunState, subjectId: string, call: LiveCall): string[] {
  const tags = toTagSignals(call.operation, call.envelope);
  for (const tag of tags) recordTag(state, { id: tag.qlooId, label: tag.label, type: tag.type ?? "unknown" }, { kind: "profile", query: null, subjectId, correlationId: corr(call) });
  const tagIds = tags.map((t) => t.qlooId);
  state.profiles.set(subjectId, { subjectId, call, tagIds, take: PROFILE_TAKE });
  return tagIds;
}

export function recordFindTags(state: AgentRunState, call: LiveCall, query: string) {
  const tags = toTagSignals(call.operation, call.envelope);
  for (const tag of tags) recordTag(state, { id: tag.qlooId, label: tag.label, type: tag.type ?? "unknown" }, { kind: "find_tags", query, subjectId: null, correlationId: corr(call) });
  return tags;
}

/** describe → the resolved entity (type from the interpretation, e.g. "urn:entity:brand"). */
export function describedEntity(call: LiveCall): { id: string; label: string; type: string; match: string | null } | undefined {
  const entity = (call.envelope.interpretation as { entity?: { entityId?: string; name?: string; type?: string; match?: string } } | undefined)?.entity;
  if (!entity?.entityId) return undefined;
  return { id: entity.entityId, label: (entity.name ?? entity.entityId).trim() || entity.entityId, type: entity.type ?? "unknown", match: entity.match ?? null };
}

export function recordResolved(state: AgentRunState, call: LiveCall): { id: string; label: string; type: string; match: string | null } | undefined {
  const entity = describedEntity(call);
  if (!entity) return undefined;
  const popularity = entitySignals(call).find((e) => e.qlooId === entity.id)?.popularity ?? null;
  recordEntity(state, { id: entity.id, label: entity.label, type: shortEntityType(entity.type) }, { kind: "resolved", tagIds: [], conditionedOn: null, correlationId: corr(call), popularity });
  return entity;
}

export function provenanceOf(state: AgentRunState, operation: QlooOperation, correlationId: string) {
  return { source: state.toolProvider.evidenceSource, operation, correlationId };
}
