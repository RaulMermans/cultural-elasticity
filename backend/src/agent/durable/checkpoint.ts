/**
 * Sprint 10C: versioned checkpoints of AgentRunState.
 *
 * A checkpoint is a deterministic JSON snapshot of committed run state. Maps and Sets keep their insertion order (the
 * runtime depends on it), tagged so hydration restores the same container type. Process-bound objects (abort signals,
 * span recorders, spend bounds, timers, clients) never live in AgentRunState; they sit in WeakMaps keyed by the state
 * and are rebuilt when a run resumes. A checkpoint is not evidence by itself: the provider-call journal is the ledger of
 * what Qloo and the model returned, and the checkpoint is the snapshot that ledger produced.
 *
 * `evidenceDigest` hashes a projection without timings, so a replay that reproduces the same research state yields the
 * same digest even though latencies differ.
 */
import { createHash } from "node:crypto";
import type { AgentRunState } from "../state.js";

export const CHECKPOINT_SCHEMA_VERSION = "agent-checkpoint/v1";
/** Versions this build can hydrate. A newer or unknown version is refused, never guessed. */
const HYDRATABLE = new Set([CHECKPOINT_SCHEMA_VERSION]);

export type CheckpointBoundary = "intake" | "turn" | "needs_input" | "final";

export type SerializedCheckpoint = { schemaVersion: string; state: unknown };

export class CheckpointVersionError extends Error {
  constructor(readonly version: string) {
    super(`CHECKPOINT_VERSION_UNSUPPORTED: ${version}`);
    this.name = "CheckpointVersionError";
  }
}

function encode(value: unknown): unknown {
  if (value instanceof Map) return { $map: [...value.entries()].map(([k, v]) => [encode(k), encode(v)]) };
  if (value instanceof Set) return { $set: [...value.values()].map(encode) };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined || typeof item === "function") continue;
      out[key] = encode(item);
    }
    return out;
  }
  return value;
}

function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.$map) && Object.keys(record).length === 1) return new Map((record.$map as [unknown, unknown][]).map(([k, v]) => [decode(k), decode(v)]));
    if (Array.isArray(record.$set) && Object.keys(record).length === 1) return new Set((record.$set as unknown[]).map(decode));
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) out[key] = decode(item);
    return out;
  }
  return value;
}

export function serializeRunState(state: AgentRunState): SerializedCheckpoint {
  return { schemaVersion: CHECKPOINT_SCHEMA_VERSION, state: encode(state) };
}

/** Restores a checkpoint written by this or a compatible build. Throws CheckpointVersionError otherwise. */
export function hydrateRunState(checkpoint: SerializedCheckpoint): AgentRunState {
  if (!HYDRATABLE.has(checkpoint.schemaVersion)) throw new CheckpointVersionError(checkpoint.schemaVersion);
  return decode(checkpoint.state) as AgentRunState;
}

function stable(value: unknown): string {
  if (value instanceof Map) return stable([...value.entries()]);
  if (value instanceof Set) return stable([...value.values()]);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Strips wall-clock fields (latency, timestamps) so equal research state hashes equally across processes. */
function withoutTimings(value: unknown): unknown {
  if (value instanceof Map) return new Map([...value.entries()].map(([k, v]) => [k, withoutTimings(v)]));
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return value.map(withoutTimings);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/(?:latency|Ms|At|capturedAt|timing|spans|callMeta|startedAt)$/u.test(key) || key === "timing" || key === "spans") continue;
      out[key] = withoutTimings(item);
    }
    return out;
  }
  return value;
}

/**
 * Digest of the research state: status, budgets, evidence (entities, tags, pools, profiles, cached calls), territories,
 * results and the final analysis. Equal digests mean the same validated research state.
 */
export function evidenceDigest(state: AgentRunState): string {
  const projection = {
    runId: state.runId,
    status: state.status,
    qlooCalls: state.usage.qlooCalls,
    iterations: state.usage.iterations,
    interpretation: state.interpretation,
    brand: state.brand.entity?.id ?? null,
    territories: state.territories,
    entities: [...state.entities.keys()],
    tags: [...state.tags.keys()],
    profiles: [...state.profiles.keys()],
    pools: state.pools.map((p) => ({ tagIds: p.tagIds, targetType: p.targetType, conditionedOn: p.conditionedOn, memberIds: p.memberIds, correlationId: p.call.envelope.execution.correlation_id })),
    calls: [...state.callCache.keys()],
    results: state.results,
    pendingQuestion: state.pendingQuestion,
    final: state.final ? { status: state.final.status, territories: state.final.territories } : null,
  };
  return createHash("sha256").update(stable(withoutTimings(projection))).digest("hex");
}
