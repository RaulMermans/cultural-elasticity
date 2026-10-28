/** SYNTHETIC in-memory run ledger for HTTP tests of a public runtime; production uses PostgreSQL (`run-ledger.ts`). */
import type { RunCounter, RunLedger } from "../../../src/ops/run-ledger.js";

export function memoryRunLedger(): RunLedger & { rows: Map<RunCounter, { limit: number; used: number }> } {
  const rows = new Map<RunCounter, { limit: number; used: number }>();
  return {
    rows,
    async take(counter, units, limit) {
      const row = rows.get(counter) ?? { limit, used: 0 };
      rows.set(counter, row);
      if (row.used + units > row.limit) return { ok: false, code: "limit_reached" };
      row.used += units;
      return { ok: true, used: row.used, limit: row.limit };
    },
    async snapshot() {
      return { qloo_calls: rows.get("qloo_calls") ?? null, model_usd_cents: rows.get("model_usd_cents") ?? null };
    },
  };
}
