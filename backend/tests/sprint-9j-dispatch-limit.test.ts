/** Sprint 9J: the run-wide Qloo dispatch ceiling. SYNTHETIC transport; no Qloo call. */
import { afterEach, describe, expect, it } from "vitest";
import { DispatchLimitedTransport, processDispatchCounter, QlooDispatchCounter, resetProcessDispatchCounter, withProcessDispatchLimit } from "../src/qloo/dispatch-limit.js";
import type { QlooTransport, TransportResult } from "../src/qloo/transport.js";

afterEach(() => resetProcessDispatchCounter());

function fake(outcomes: ("ok" | "throw")[]) {
  let sent = 0;
  const transport: QlooTransport = {
    name: "SYNTHETIC",
    async execute() {
      const outcome = outcomes[sent++] ?? "ok";
      if (outcome === "throw") throw new Error("SYNTHETIC uncertain outcome");
      return { ok: true } as unknown as TransportResult;
    },
  };
  return { transport, sent: () => sent };
}

describe("process Qloo dispatch ceiling", () => {
  it("counts every attempt, including failed and uncertain ones, and sends nothing once spent", async () => {
    const inner = fake(["ok", "throw", "ok"]);
    const counter = new QlooDispatchCounter(2);
    const limited = new DispatchLimitedTransport(inner.transport, counter);
    await limited.execute("describe" as never, {});
    await expect(limited.execute("describe" as never, {})).rejects.toThrow("SYNTHETIC uncertain outcome");
    await expect(limited.execute("describe" as never, {})).rejects.toThrow(/PROCESS_QLOO_CALL_LIMIT_REACHED/u);
    expect(inner.sent()).toBe(2);
    expect(counter.snapshot()).toEqual({ limit: 2, used: 2, remaining: 0 });
  });

  it("one counter is shared by every transport in the process (baseline and agent phases)", async () => {
    const env = { CE_PROCESS_QLOO_CALL_LIMIT: "3" };
    const a = fake([]);
    const b = fake([]);
    const baseline = withProcessDispatchLimit(a.transport, env);
    const agent = withProcessDispatchLimit(b.transport, env);
    await baseline.execute("describe" as never, {});
    await agent.execute("describe" as never, {});
    await agent.execute("describe" as never, {});
    await expect(baseline.execute("describe" as never, {})).rejects.toThrow(/PROCESS_QLOO_CALL_LIMIT_REACHED/u);
    expect(a.sent() + b.sent()).toBe(3);
  });

  it("is absent when unset and fails closed on an invalid value", async () => {
    expect(processDispatchCounter({})).toBeNull();
    resetProcessDispatchCounter();
    const inner = fake([]);
    const limited = withProcessDispatchLimit(inner.transport, { CE_PROCESS_QLOO_CALL_LIMIT: "seventy" });
    await expect(limited.execute("describe" as never, {})).rejects.toThrow(/PROCESS_QLOO_CALL_LIMIT_REACHED/u);
    expect(inner.sent()).toBe(0);
  });
});
