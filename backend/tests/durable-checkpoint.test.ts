/**
 * Sprint 10C unit tests (SYNTHETIC world, no database, no provider call): checkpoint serialization and hydration,
 * equivalent deterministic analysis from a restored checkpoint, the recovery decision rules, and the journal protocol
 * against an in-memory fake store. The real-process, real-PostgreSQL tests are tests/durable-process.db.test.ts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runAnalysis } from "../src/agent/analysis-runner.js";
import { CheckpointVersionError, evidenceDigest, hydrateRunState, serializeRunState } from "../src/agent/durable/checkpoint.js";
import { decideRecovery } from "../src/agent/durable/recovery.js";
import { durableId, journaled, OutcomeUnknownError, RunSuspendedError, runInScope, type DurableScope, type JournalCodec } from "../src/agent/durable/scope.js";
import { LeaseLostError, type CallRow, type DurableAgentStore } from "../src/agent/durable/store.js";
import { BaselinePolicyModel } from "../src/agent/model/baseline.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import type { AgentRunState } from "../src/agent/state.js";
import { openToolTrace } from "../src/agent/tool-executor.js";
import type { AgentToolProvider } from "../src/agent/tool-provider.js";
import { createScriptedToolProvider, syntheticWorldSchema } from "../scripts/synthetic/synthetic-world.js";

const WORLD = syntheticWorldSchema.parse(JSON.parse(readFileSync(fileURLToPath(new URL("../../evals/fixtures/synthetic/agent/world.json", import.meta.url)), "utf8")));

async function completedRun(): Promise<AgentRunState> {
  const runtime = new AgentRuntime({ model: new BaselinePolicyModel(), provider: createScriptedToolProvider(WORLD) });
  const response = await runtime.run({ userQuery: "For Saffron & Salt compare tableware, skincare and slow travel", brand: "Saffron & Salt", territories: ["Tableware", "Skincare", "Slow Travel"] });
  expect(response.status).toBe("COMPLETE");
  return runtime.store.get(response.runId)!;
}

const roundTrip = (state: AgentRunState) => hydrateRunState(JSON.parse(JSON.stringify(serializeRunState(state))));

describe("Sprint 10C checkpoints", () => {
  it("round-trips Maps, Sets and evidence through JSON with the same research digest", async () => {
    const state = await completedRun();
    const restored = roundTrip(state);
    expect(restored.entities).toBeInstanceOf(Map);
    expect(restored.executedCalls).toBeInstanceOf(Set);
    expect([...restored.entities.keys()]).toEqual([...state.entities.keys()]);
    expect([...restored.callCache.keys()]).toEqual([...state.callCache.keys()]);
    expect([...restored.settledOperationIds]).toEqual([...state.settledOperationIds]);
    expect(restored.usage).toEqual(state.usage);
    expect(evidenceDigest(restored)).toBe(evidenceDigest(state));
    expect(JSON.stringify(serializeRunState(restored))).toBe(JSON.stringify(serializeRunState(state)));
  });

  it("produces the same deterministic analysis from the restored evidence without any provider call", async () => {
    const state = await completedRun();
    const restored = roundTrip(state);
    const analyzed = restored.territories.filter((t) => t.status === "analyzed").map((t) => t.key);
    expect(analyzed.length).toBeGreaterThan(0);
    restored.results = new Map();
    restored.methodologyRuns = [];
    for (const t of restored.territories) if (t.status === "analyzed") t.status = "represented";
    const refusing: AgentToolProvider = { name: "refusing", mode: "scripted", evidenceSource: "none", call: () => Promise.reject(new Error("a restored analysis must not call a provider")) };
    const outcome = await runAnalysis(restored, refusing, analyzed, (tool, permission, args) => openToolTrace(restored, tool, permission, args));
    expect(outcome.ok).not.toBe(false);
    for (const key of analyzed) {
      const before = state.results.get(key)!;
      const after = restored.results.get(key)!;
      expect(after.analysisRoute).toBe(before.analysisRoute);
      expect(after.classification).toEqual(before.classification);
      expect(after.relativePosition).toEqual(before.relativePosition);
      expect(after.provenance.correlationIds).toEqual(before.provenance.correlationIds);
    }
  });

  it("refuses a checkpoint version it does not know instead of guessing", () => {
    expect(() => hydrateRunState({ schemaVersion: "agent-checkpoint/v999", state: {} })).toThrow(CheckpointVersionError);
  });
});

describe("Sprint 10C recovery rules", () => {
  const job = { cancelRequested: false, deadlineAt: new Date(Date.now() + 60_000), attempt: 2 };
  const done = (opKey: string) => ({ opKey, status: "COMPLETED" as const });
  it("cancellation wins over everything", () => {
    expect(decideRecovery({ ...job, cancelRequested: true }, [{ opKey: "q", status: "DISPATCHING" }], new Date()).action).toBe("cancel");
  });
  it("an unknown outcome quarantines, even past the deadline", () => {
    expect(decideRecovery({ ...job, deadlineAt: new Date(0) }, [done("a"), { opKey: "b", status: "DISPATCHING" }], new Date()).action).toBe("quarantine");
    expect(decideRecovery(job, [{ opKey: "b", status: "OUTCOME_UNKNOWN" }], new Date()).unknown).toEqual(["b"]);
  });
  it("an operator-accepted unknown outcome no longer blocks", () => {
    expect(decideRecovery(job, [done("a"), { opKey: "b", status: "UNKNOWN_ACCEPTED" }], new Date()).action).toBe("resume");
  });
  it("the deadline is never reset by a restart, and attempts are bounded", () => {
    expect(decideRecovery({ ...job, deadlineAt: new Date(0) }, [done("a")], new Date()).action).toBe("timeout");
    expect(decideRecovery({ ...job, attempt: 4 }, [done("a")], new Date()).action).toBe("attempts_exhausted");
  });
  it("resumes with the committed calls a replay will reuse", () => {
    const decision = decideRecovery(job, [done("a"), { opKey: "b", status: "RESERVED" }, { opKey: "c", status: "FAILED" }], new Date());
    expect(decision.action).toBe("resume");
    expect(decision.committed).toEqual(["a", "c"]);
  });
});

/** In-memory stand-in for the journal part of DurableAgentStore (SYNTHETIC). */
class FakeJournal {
  rows = new Map<string, CallRow>();
  lost = false;
  private check() {
    if (this.lost) throw new LeaseLostError("job");
  }
  async getCall(_jobId: string, opKey: string) {
    return this.rows.get(opKey) ?? null;
  }
  async reserveCall(_lease: unknown, call: { opKey: string; provider: CallRow["provider"]; operation: string; fingerprint: string }) {
    this.check();
    const existing = this.rows.get(call.opKey);
    this.rows.set(call.opKey, { jobId: "job", opKey: call.opKey, provider: call.provider, operation: call.operation, fingerprint: call.fingerprint, status: "RESERVED", attempt: (existing?.attempt ?? 0) + 1, dispatchCount: existing?.dispatchCount ?? 0, leaseEpoch: 1, correlationId: null, result: null, usage: null, discarded: false, errorCode: null });
  }
  async markDispatching(_lease: unknown, opKey: string) {
    this.check();
    const row = this.rows.get(opKey)!;
    row.status = "DISPATCHING";
    row.dispatchCount += 1;
  }
  async completeCall(_lease: unknown, opKey: string, outcome: { status: "COMPLETED" | "FAILED"; result: unknown }) {
    this.check();
    const row = this.rows.get(opKey)!;
    row.status = outcome.status;
    row.result = JSON.parse(JSON.stringify(outcome.result));
  }
}

function scopeOver(journal: FakeJournal, options: Partial<DurableScope> = {}): DurableScope {
  return {
    jobId: "11111111-1111-4111-8111-111111111111",
    store: journal as unknown as DurableAgentStore,
    lease: { jobId: "job", owner: "w", epoch: 1 },
    recovering: false,
    unconsumed: new Set(),
    occurrences: new Map(),
    idCounters: new Map(),
    checkpointSeq: 0,
    halt: null,
    metrics: { reused: 0, dispatched: 0, refusedUnknown: 0, checkpoints: 0, checkpointMs: 0 },
    onHalt: () => undefined,
    lastCheckpoint: new Map(),
    writeCheckpoint: async () => undefined,
    ...options,
  };
}

const codec: JournalCodec<{ value: number }> = { encode: (v) => ({ status: "COMPLETED", result: v }), decode: (stored) => stored as { value: number } };

describe("Sprint 10C journal protocol", () => {
  it("commits an answer before returning it, and a later replay reuses it without calling the provider", async () => {
    const journal = new FakeJournal();
    let calls = 0;
    const call = () => journaled("qloo", "recommend", { tag: "t1" }, codec, async (dispatching) => {
      await dispatching();
      calls += 1;
      return { value: 42 };
    });
    expect(await runInScope(scopeOver(journal), call)).toEqual({ value: 42 });
    const [row] = [...journal.rows.values()];
    expect(row).toMatchObject({ status: "COMPLETED", dispatchCount: 1 });
    const replay = scopeOver(journal, { recovering: true, unconsumed: new Set([row!.opKey]) });
    expect(await runInScope(replay, call)).toEqual({ value: 42 });
    expect(calls).toBe(1);
    expect(replay.metrics.reused).toBe(1);
    expect(replay.unconsumed.size).toBe(0);
  });

  it("identical requests get distinct keys by occurrence, so a retry after a failure is a new operation", async () => {
    const journal = new FakeJournal();
    const scope = scopeOver(journal);
    await runInScope(scope, async () => {
      await journaled("qloo", "op", { a: 1 }, codec, async () => ({ value: 1 }));
      await journaled("qloo", "op", { a: 1 }, codec, async () => ({ value: 2 }));
    });
    expect([...journal.rows.keys()].map((k) => k.split(":").at(-1))).toEqual(["0", "1"]);
  });

  it("never repeats a call whose dispatch may have happened (OUTCOME_UNKNOWN halts the job)", async () => {
    const journal = new FakeJournal();
    await runInScope(scopeOver(journal), () => journaled("qloo", "op", {}, codec, async () => ({ value: 1 }))).catch(() => undefined);
    const row = [...journal.rows.values()][0]!;
    row.status = "DISPATCHING";
    let halted: RunSuspendedError | null = null;
    let executed = false;
    const scope = scopeOver(journal, { recovering: true, onHalt: (e) => (halted = e) });
    await expect(runInScope(scope, () => journaled("qloo", "op", {}, codec, async () => {
      executed = true;
      return { value: 2 };
    }))).rejects.toBeInstanceOf(RunSuspendedError);
    expect(executed).toBe(false);
    expect(halted!.reason).toBe("outcome_unknown");
    expect(new OutcomeUnknownError("k").message).toContain("not repeated");
  });

  it("refuses to dispatch anything new while committed answers were not reproduced (replay divergence)", async () => {
    const journal = new FakeJournal();
    const scope = scopeOver(journal, { recovering: true, unconsumed: new Set(["qloo:never-requested:0"]) });
    let executed = false;
    await expect(runInScope(scope, () => journaled("qloo", "other", {}, codec, async () => {
      executed = true;
      return { value: 1 };
    }))).rejects.toMatchObject({ reason: "replay_diverged" });
    expect(executed).toBe(false);
    expect(journal.rows.size).toBe(0);
  });

  it("a worker that lost its lease halts before anything is sent", async () => {
    const journal = new FakeJournal();
    journal.lost = true;
    let executed = false;
    let halted: RunSuspendedError | null = null;
    await expect(runInScope(scopeOver(journal, { onHalt: (e) => (halted = e) }), () => journaled("qloo", "op", {}, codec, async () => {
      executed = true;
      return { value: 1 };
    }))).rejects.toBeInstanceOf(RunSuspendedError);
    expect(executed).toBe(false);
    expect(halted!.reason).toBe("lease_lost");
  });

  it("replays a stored failure as the same thrown error", async () => {
    const journal = new FakeJournal();
    const failing = () => journaled("model", "decide", { c: 1 }, codec, async () => {
      throw new Error("provider exploded");
    });
    await expect(runInScope(scopeOver(journal), failing)).rejects.toThrow("provider exploded");
    const replayCodec: JournalCodec<{ value: number }> = { ...codec, decode: (stored) => (typeof (stored as { thrown?: string }).thrown === "string" ? new Error((stored as { thrown: string }).thrown) : (stored as { value: number })) };
    await expect(runInScope(scopeOver(journal), () => journaled("model", "decide", { c: 1 }, replayCodec, async () => ({ value: 1 })))).rejects.toThrow("provider exploded");
  });

  it("derives the same ids for the same job on every replay, and random ids without a scope", async () => {
    const ids = async () => runInScope(scopeOver(new FakeJournal()), async () => [durableId("run"), durableId("run"), durableId("query")]);
    const first = await ids();
    expect(await ids()).toEqual(first);
    expect(new Set(first).size).toBe(3);
    expect(first[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(durableId("run")).not.toBe(durableId("run"));
  });
});
