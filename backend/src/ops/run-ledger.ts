import { createHash } from "node:crypto";
import { createBaselinePool, type Database } from "../brand-baseline/db.js";
import { paidOperatorToken, publicRuntime } from "../config/production.js";

/**
 * Sprint 9J: durable accounting for one bounded operator run. Counters live in the existing
 * `baseline_budget_accounts` table (no new migration), keyed by a hash of the paid operator credential, so a
 * process restart continues the same counters instead of granting a fresh allowance; a new allowance needs a
 * new credential. A limit is fixed when its row is first written and is never raised by a later boot. Units
 * are never returned. Any database doubt refuses the unit (fail closed).
 */
export type RunCounter = "qloo_calls" | "model_usd_cents";
export type RunTake = { ok: true; used: number; limit: number } | { ok: false; code: "limit_reached" | "ledger_unavailable" };

export interface RunLedger {
  take(counter: RunCounter, units: number, limit: number): Promise<RunTake>;
  snapshot(): Promise<Record<RunCounter, { limit: number; used: number } | null> | null>;
}

const COUNTERS: RunCounter[] = ["qloo_calls", "model_usd_cents"];

export class PostgresRunLedger implements RunLedger {
  private readonly prefix: string;
  constructor(
    private readonly pool: Database,
    credential: string,
  ) {
    this.prefix = `run:${createHash("sha256").update(credential).digest("hex").slice(0, 32)}:`;
  }

  async take(counter: RunCounter, units: number, limit: number): Promise<RunTake> {
    if (!Number.isInteger(units) || units <= 0 || !Number.isInteger(limit) || limit < 0) return { ok: false, code: "limit_reached" };
    const key = this.prefix + counter;
    try {
      await this.pool.query("INSERT INTO baseline_budget_accounts (budget_key, limit_calls) VALUES ($1,$2) ON CONFLICT (budget_key) DO NOTHING", [key, limit]);
      const result = await this.pool.query<{ used_calls: number; limit_calls: number }>(
        "UPDATE baseline_budget_accounts SET used_calls=used_calls+$2,updated_at=now() WHERE budget_key=$1 AND used_calls+$2 <= limit_calls RETURNING used_calls,limit_calls",
        [key, units],
      );
      const row = result.rows[0];
      return row ? { ok: true, used: row.used_calls, limit: row.limit_calls } : { ok: false, code: "limit_reached" };
    } catch {
      return { ok: false, code: "ledger_unavailable" };
    }
  }

  async snapshot(): Promise<Record<RunCounter, { limit: number; used: number } | null> | null> {
    try {
      const result = await this.pool.query<{ budget_key: string; used_calls: number; limit_calls: number }>(
        "SELECT budget_key,used_calls,limit_calls FROM baseline_budget_accounts WHERE budget_key = ANY($1)",
        [COUNTERS.map((counter) => this.prefix + counter)],
      );
      const out = { qloo_calls: null, model_usd_cents: null } as Record<RunCounter, { limit: number; used: number } | null>;
      for (const row of result.rows) out[row.budget_key.slice(this.prefix.length) as RunCounter] = { limit: row.limit_calls, used: row.used_calls };
      return out;
    } catch {
      return null;
    }
  }
}

/** A ledger that refuses every unit: a public runtime that needs durable accounting but cannot have it. */
export const refusingRunLedger: RunLedger = {
  async take() {
    return { ok: false, code: "ledger_unavailable" };
  },
  async snapshot() {
    return null;
  },
};

let shared: RunLedger | null | undefined;

/**
 * The process run ledger. A public runtime with a paid operator credential always gets one: a durable ledger
 * when `DATABASE_URL` is set, otherwise one that refuses everything. A private runtime without a credential
 * keeps the process-local behaviour (null).
 */
export function runLedger(env: NodeJS.ProcessEnv = process.env): RunLedger | null {
  if (shared !== undefined) return shared;
  const credential = paidOperatorToken(env);
  if (!credential) return (shared = publicRuntime(env) ? refusingRunLedger : null);
  if (!env.DATABASE_URL) return (shared = publicRuntime(env) ? refusingRunLedger : null);
  try {
    shared = new PostgresRunLedger(createBaselinePool(env.DATABASE_URL), credential);
  } catch {
    shared = refusingRunLedger;
  }
  return shared;
}

export function setRunLedgerForTests(ledger: RunLedger | null | undefined): void {
  shared = ledger;
}
