/**
 * Hotfix: REAL POSTGRES tests of the durable run ledger's per-network quotas. Needs DATABASE_URL of a disposable
 * database (migrations are applied here). SYNTHETIC keys only; no provider call. Run: pnpm test:db
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBaselinePool, migrate, type Database } from "../src/brand-baseline/db.js";
import { PostgresRunLedger } from "../src/ops/run-ledger.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED_FOR_REAL_POSTGRES_TESTS");
const url = process.env.DATABASE_URL;
let pool: Database;

beforeAll(async () => {
  pool = createBaselinePool(url);
  await migrate(pool);
});
afterAll(async () => { await pool?.end(); });

const network = () => randomUUID().replaceAll("-", "");
const fresh = () => new PostgresRunLedger(pool, `public-evaluation:syn-hotfix-${randomUUID()}`);

describe("REAL POSTGRES synthetic run-ledger quotas", () => {
  it("a raised limit admits a visitor at the old cap, keeps their usage and stops them at the new one", async () => {
    const ledger = fresh();
    const scope = `investigation:${network()}`;
    for (let i = 1; i <= 4; i += 1) expect(await ledger.takeQuota(scope, 1, 4)).toEqual({ ok: true, used: i, limit: 4 });
    expect(await ledger.takeQuota(scope, 1, 4)).toEqual({ ok: false, code: "limit_reached" });
    expect(await ledger.peekQuota(scope)).toEqual({ used: 4, limit: 4 });

    expect(await ledger.takeQuota(scope, 1, 12)).toEqual({ ok: true, used: 5, limit: 12 });
    for (let i = 6; i <= 12; i += 1) expect(await ledger.takeQuota(scope, 1, 12)).toEqual({ ok: true, used: i, limit: 12 });
    expect(await ledger.takeQuota(scope, 1, 12)).toEqual({ ok: false, code: "limit_reached" });
    expect(await ledger.peekQuota(scope)).toEqual({ used: 12, limit: 12 });
  });

  it("concurrent starts after a raise never pass the new limit", async () => {
    const ledger = fresh();
    const scope = `investigation:${network()}`;
    for (let i = 0; i < 4; i += 1) await ledger.takeQuota(scope, 1, 4);
    const results = await Promise.all(Array.from({ length: 30 }, () => ledger.takeQuota(scope, 1, 12)));
    expect(results.filter((r) => r.ok)).toHaveLength(8);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.code === "limit_reached")).toBe(true);
    expect(await ledger.peekQuota(scope)).toEqual({ used: 12, limit: 12 });
  });

  it("a lower configured limit neither lowers the stored one nor resets usage", async () => {
    const ledger = fresh();
    const scope = `scan:${network()}`;
    for (let i = 0; i < 6; i += 1) await ledger.takeQuota(scope, 1, 8);
    expect(await ledger.takeQuota(scope, 1, 4)).toEqual({ ok: true, used: 7, limit: 8 });
    expect(await ledger.takeQuota(scope, 1, 0)).toEqual({ ok: true, used: 8, limit: 8 });
    expect(await ledger.takeQuota(scope, 1, 4)).toEqual({ ok: false, code: "limit_reached" });
    expect(await ledger.peekQuota(scope)).toEqual({ used: 8, limit: 8 });
  });

  it("the global run counters keep their first limit; quotas are scoped to their evaluation", async () => {
    const ledger = fresh();
    expect(await ledger.take("qloo_calls", 1, 10)).toEqual({ ok: true, used: 1, limit: 10 });
    expect(await ledger.take("qloo_calls", 1, 1000)).toEqual({ ok: true, used: 2, limit: 10 });
    expect(await ledger.take("model_usd_cents", 50, 100)).toEqual({ ok: true, used: 50, limit: 100 });
    expect(await ledger.take("model_usd_cents", 60, 100_000)).toEqual({ ok: false, code: "limit_reached" });
    expect(await ledger.snapshot()).toEqual({ qloo_calls: { limit: 10, used: 2 }, model_usd_cents: { limit: 100, used: 50 } });

    const scope = `investigation:${network()}`;
    await ledger.takeQuota(scope, 1, 4);
    const other = fresh();
    expect(await other.peekQuota(scope)).toBeNull();
    expect(await ledger.takeQuota("investigation:not-a-network", 1, 4)).toEqual({ ok: false, code: "limit_reached" });
  });

  it("a returned unit never goes below zero, and an unknown key is a no-op", async () => {
    const ledger = fresh();
    const scope = `investigation:${network()}`;
    await ledger.takeQuota(scope, 1, 4);
    await ledger.releaseQuota(scope, 1);
    await ledger.releaseQuota(scope, 1);
    expect(await ledger.peekQuota(scope)).toEqual({ used: 0, limit: 4 });
    await ledger.releaseQuota(`investigation:${network()}`, 1);
    await ledger.releaseQuota("../../qloo_calls", 1);
  });

  it("database doubt fails closed", async () => {
    const broken = createBaselinePool("postgresql://ce@127.0.0.1:1/none");
    const ledger = new PostgresRunLedger(broken, "public-evaluation:syn-hotfix-broken");
    const scope = `investigation:${network()}`;
    expect(await ledger.takeQuota(scope, 1, 12)).toEqual({ ok: false, code: "ledger_unavailable" });
    expect(await ledger.peekQuota(scope)).toBe("unavailable");
    await broken.end();
  });
});
