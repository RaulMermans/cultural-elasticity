/** SYNTHETIC in-memory run ledger for HTTP tests of a public runtime; production uses PostgreSQL (`run-ledger.ts`). */
import type { RunCounter, RunLedger } from "../../../src/ops/run-ledger.js";

export function memoryRunLedger(): RunLedger & { rows: Map<RunCounter, { limit: number; used: number }>; quotas: Map<string, { limit: number; used: number }> } {
  const rows = new Map<RunCounter, { limit: number; used: number }>();
  const quotas = new Map<string, { limit: number; used: number }>();
  const takeFrom = <K>(map: Map<K, { limit: number; used: number }>, key: K, units: number, limit: number) => {
    const row = map.get(key) ?? { limit, used: 0 };
    map.set(key, row);
    if (row.used + units > row.limit) return { ok: false as const, code: "limit_reached" as const };
    row.used += units;
    return { ok: true as const, used: row.used, limit: row.limit };
  };
  return {
    rows,
    quotas,
    async take(counter, units, limit) {
      return takeFrom(rows, counter, units, limit);
    },
    async takeQuota(scope, units, limit) {
      const row = quotas.get(scope);
      if (row && limit > row.limit) row.limit = limit;
      return takeFrom(quotas, scope, units, limit);
    },
    async releaseQuota(scope, units) {
      const row = quotas.get(scope);
      if (row) row.used = Math.max(0, row.used - units);
    },
    async peekQuota(scope) {
      const row = quotas.get(scope);
      return row ? { ...row } : null;
    },
    async release(counter, units) {
      const row = rows.get(counter);
      if (row) row.used = Math.max(0, row.used - units);
    },
    async snapshot() {
      return { qloo_calls: rows.get("qloo_calls") ?? null, model_usd_cents: rows.get("model_usd_cents") ?? null };
    },
  };
}
