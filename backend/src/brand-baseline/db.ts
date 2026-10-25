import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
export type Database = InstanceType<typeof Pool>;

/** Bounded pool. Connection strings are never included in errors or logs. */
export function createBaselinePool(connectionString: string | undefined): Database {
  if (!connectionString) throw new Error("DATABASE_NOT_CONFIGURED");
  return new Pool({ connectionString, max: 4, min: 0, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30_000, maxUses: 500 });
}

export async function databaseReady(pool: Database): Promise<boolean> {
  try {
    const result = await pool.query("SELECT 1 AS ready");
    return result.rows[0]?.ready === 1;
  } catch {
    return false;
  }
}

/** SQL migrations are checksum pinned and serialized by a PostgreSQL advisory lock. */
export async function migrate(pool: Database): Promise<string[]> {
  const directory = fileURLToPath(new URL("../../migrations/", import.meta.url));
  const files = (await readdir(directory)).filter((name) => /^\d+_[a-z0-9_-]+\.sql$/u.test(name)).sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock(9026009)");
    await client.query("CREATE TABLE IF NOT EXISTS baseline_schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    for (const name of files) {
      const sql = await readFile(new URL(`../../migrations/${name}`, import.meta.url), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query<{ checksum: string }>("SELECT checksum FROM baseline_schema_migrations WHERE name = $1", [name]);
      if (existing.rows.length) {
        if (existing.rows[0]?.checksum !== checksum) throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${name}`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO baseline_schema_migrations (name, checksum) VALUES ($1,$2)", [name, checksum]);
        await client.query("COMMIT");
        applied.push(name);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return applied;
  } finally {
    await client.query("SELECT pg_advisory_unlock(9026009)").catch(() => undefined);
    client.release();
  }
}
