/**
 * Sprint 9O competence evaluation harness: record / replay of provider answers. SYNTHETIC world (fictional SYN-
 * entities) stands in for live Qloo here; no provider is called.
 */
import { describe, expect, it } from "vitest";
import { AgentRuntime } from "../src/agent/runtime.js";
import { BaselinePolicyModel } from "../src/agent/model/baseline.js";
import { CachingRecorder, CASSETTE_SCHEMA, callKey, ReplayProvider, type Cassette } from "../scripts/competence/cassette.js";
import { scripted } from "./fixtures/synthetic/agent.js";

const request = { userQuery: "How far can Osterley Field Supply extend into Reading Rooms?", intent: "analyze_move" as const, brand: "Osterley Field Supply", territories: ["Reading Rooms"] };
const fresh = (): Cassette => ({ schema: CASSETTE_SCHEMA, caseId: "syn", recordedWith: { engineRevision: "test", model: "baseline" }, entries: [] });
const outcome = (r: Awaited<ReturnType<AgentRuntime["run"]>>) => ("territories" in r ? r.territories.map((t) => [t.key, t.analysisRoute, t.classification?.label ?? null, t.relativePosition?.position ?? null]) : r.status);

describe("Sprint 9O competence cassettes", () => {
  it("canonical keys ignore object key order", () => {
    expect(callKey("recommend", { a: 1, b: [{ y: 2, x: 1 }] })).toBe(callKey("recommend", { b: [{ x: 1, y: 2 }], a: 1 }));
  });

  it("a replay of a recorded run reproduces its outcome with no unrecorded call, labelled synthetic", async () => {
    const cassette = fresh();
    let used = 0;
    const recorder = new CachingRecorder(scripted(), cassette, { maxLiveCalls: 100, used: () => used, onLive: (n) => { used += n; } });
    const recorded = await new AgentRuntime({ model: new BaselinePolicyModel(), provider: recorder }).run(request);
    expect(cassette.entries.length).toBe(recorder.liveCalls);
    const replay = new ReplayProvider([cassette]);
    const replayed = await new AgentRuntime({ model: new BaselinePolicyModel(), provider: replay }).run(request);
    expect(outcome(replayed)).toEqual(outcome(recorded));
    expect(replay.misses).toEqual([]);
    expect("evidenceOrigin" in replayed && replayed.evidenceOrigin).toBe("synthetic");
  });

  it("an unrecorded call is a failed call (never evidence), and a recorder serves repeated calls from its cassette", async () => {
    const replay = new ReplayProvider([fresh()]);
    expect(await replay.call("find_tags", { query: "anything", semantic: true, limit: 8 })).toMatchObject({ outcome: "failed", code: "NOT_RECORDED" });
    const cassette = fresh();
    let used = 0;
    const recorder = new CachingRecorder(scripted(), cassette, { maxLiveCalls: 100, used: () => used, onLive: (n) => { used += n; } });
    await recorder.call("find_tags", { query: "Reading Rooms", semantic: true, limit: 8 });
    await recorder.call("find_tags", { limit: 8, semantic: true, query: "Reading Rooms" });
    expect([recorder.liveCalls, recorder.cacheHits, used]).toEqual([1, 1, 1]);
  });

  it("stops live calls at the allowance with a failed call", async () => {
    let used = 0;
    const recorder = new CachingRecorder(scripted(), fresh(), { maxLiveCalls: 1, used: () => used, onLive: (n) => { used += n; } });
    await recorder.call("find_tags", { query: "Reading Rooms", semantic: true, limit: 8 });
    expect(await recorder.call("find_tags", { query: "Print Studios", semantic: true, limit: 8 })).toMatchObject({ outcome: "failed", code: "EVAL_QLOO_CAP" });
    expect(used).toBe(1);
  });
});
