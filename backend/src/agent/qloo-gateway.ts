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
import { shortEntityType, type RankableType } from "./contracts.js";
import { recordEntity, recordTag, remainingQlooCalls, type AgentRunState } from "./state.js";
import type { AgentToolProvider, QlooCallResult } from "./tool-provider.js";

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
    return cached;
  }
  const remaining = remainingQlooCalls(state);
  if (remaining < 1) return { outcome: "failed", code: "BUDGET_EXHAUSTED", retryable: false, detail: `Qloo call budget (${state.limits.maxQlooCalls}) is spent`, attempts: 0 };

  const result = await provider.call(operation, input, { maxRetries: Math.min(state.limits.maxRetryPerToolCall, remaining - 1) });
  state.usage.qlooCalls += result.attempts;
  state.usage.retries += Math.max(0, result.attempts - 1);
  trace.attempts += result.attempts;
  trace.qlooOperations.push(operation);
  if ("call" in result) {
    trace.correlationIds.push(result.call.envelope.execution.correlation_id);
    state.flags.push(...result.flags);
    state.callCache.set(key, result);
  } else if (result.correlationId) {
    trace.correlationIds.push(result.correlationId);
  }
  return result;
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
