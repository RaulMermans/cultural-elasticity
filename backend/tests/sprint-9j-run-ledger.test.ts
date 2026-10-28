/** Sprint 9J: durable, fail-closed run accounting. SYNTHETIC pool and transport; no database, Qloo or model call. */
import { afterEach, describe, expect, it } from "vitest";
import { PostgresRunLedger, refusingRunLedger, runLedger, setRunLedgerForTests } from "../src/ops/run-ledger.js";
import { DispatchLimitedTransport, processDispatchCounter, QlooDispatchCounter, resetProcessDispatchCounter } from "../src/qloo/dispatch-limit.js";
import type { QlooTransport, TransportResult } from "../src/qloo/transport.js";
import type { Database } from "../src/brand-baseline/db.js";

afterEach(() => {
  setRunLedgerForTests(undefined);
  resetProcessDispatchCounter();
});

/** SYNTHETIC stand-in for the three statements the ledger issues against `baseline_budget_accounts`. */
function fakePool(options: { fail?: boolean } = {}) {
  const rows = new Map<string, { limit: number; used: number }>();
  const pool = {
    async query(sql: string, params: unknown[]) {
      if (options.fail) throw new Error("SYNTHETIC connection refused");
      if (sql.startsWith("INSERT")) {
        const [key, limit] = params as [string, number];
        if (!rows.has(key)) rows.set(key, { limit, used: 0 });
        return { rows: [] };
      }
      if (sql.startsWith("UPDATE")) {
        const [key, units] = params as [string, number];
        const row = rows.get(key);
        if (!row || row.used + units > row.limit) return { rows: [] };
        row.used += units;
        return { rows: [{ used_calls: row.used, limit_calls: row.limit }] };
      }
      const keys = (params as [string[]])[0];
      return { rows: keys.filter((key) => rows.has(key)).map((key) => ({ budget_key: key, used_calls: rows.get(key)!.used, limit_calls: rows.get(key)!.limit })) };
    },
  };
  return { pool: pool as unknown as Database, rows };
}

function fakeTransport() {
  let sent = 0;
  const transport: QlooTransport = {
    name: "SYNTHETIC",
    async execute() {
      sent += 1;
      return { ok: true } as unknown as TransportResult;
    },
  };
  return { transport, sent: () => sent };
}

const CREDENTIAL = "SYNTHETIC-paid-operator-credential-0000000000";

describe("durable run ledger", () => {
  it("continues the same counters after a restart and never raises a limit fixed by an earlier boot", async () => {
    const { pool } = fakePool();
    const first = new PostgresRunLedger(pool, CREDENTIAL);
    expect(await first.take("qloo_calls", 1, 2)).toEqual({ ok: true, used: 1, limit: 2 });
    // A restart (new process, new in-memory counter) with a higher configured limit.
    const second = new PostgresRunLedger(pool, CREDENTIAL);
    expect(await second.take("qloo_calls", 1, 75)).toEqual({ ok: true, used: 2, limit: 2 });
    expect(await second.take("qloo_calls", 1, 75)).toEqual({ ok: false, code: "limit_reached" });
    // A different credential is a different allowance.
    expect(await new PostgresRunLedger(pool, `${CREDENTIAL}-other`).take("qloo_calls", 1, 2)).toMatchObject({ ok: true, used: 1 });
  });

  it("never stores the credential itself", async () => {
    const { pool, rows } = fakePool();
    await new PostgresRunLedger(pool, CREDENTIAL).take("model_usd_cents", 50, 200);
    expect([...rows.keys()].join()).not.toContain(CREDENTIAL);
    expect([...rows.keys()][0]).toMatch(/^run:[0-9a-f]{32}:model_usd_cents$/u);
  });

  it("refuses a unit when the database is unavailable", async () => {
    const { pool } = fakePool({ fail: true });
    expect(await new PostgresRunLedger(pool, CREDENTIAL).take("qloo_calls", 1, 75)).toEqual({ ok: false, code: "ledger_unavailable" });
  });

  it("a restarted process cannot dispatch past the durable ceiling, and a ledger failure sends nothing", async () => {
    const { pool } = fakePool();
    const before = fakeTransport();
    const a = new DispatchLimitedTransport(before.transport, new QlooDispatchCounter(2), new PostgresRunLedger(pool, CREDENTIAL));
    await a.execute("describe" as never, {});
    await a.execute("describe" as never, {});
    const after = fakeTransport();
    const b = new DispatchLimitedTransport(after.transport, new QlooDispatchCounter(2), new PostgresRunLedger(pool, CREDENTIAL));
    await expect(b.execute("describe" as never, {})).rejects.toThrow(/PROCESS_QLOO_CALL_LIMIT_REACHED/u);
    expect(after.sent()).toBe(0);
    const broken = fakeTransport();
    const c = new DispatchLimitedTransport(broken.transport, new QlooDispatchCounter(5), refusingRunLedger);
    await expect(c.execute("describe" as never, {})).rejects.toThrow(/RUN_LEDGER_UNAVAILABLE/u);
    expect(broken.sent()).toBe(0);
  });

  it("a public runtime with a credential fails closed without a database or an explicit ceiling", () => {
    const env = { CE_PUBLIC_DEPLOYMENT: "1", CE_PAID_OPERATOR_TOKEN: CREDENTIAL };
    expect(runLedger(env)).toBe(refusingRunLedger);
    setRunLedgerForTests(undefined);
    expect(runLedger({})).toBeNull();
    expect(processDispatchCounter(env)?.limit).toBe(0);
  });
});
