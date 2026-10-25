/** Explicit operator deployment command. The API never auto-runs migrations. */
import { createBaselinePool, migrate } from "./db.js";

const pool = createBaselinePool(process.env.DATABASE_URL);
try {
  const applied = await migrate(pool);
  console.log(`BASELINE_MIGRATIONS_OK applied=${applied.length}`);
} catch (error) {
  console.error(error instanceof Error && error.message.startsWith("MIGRATION_CHECKSUM_MISMATCH") ? error.message : "BASELINE_MIGRATION_FAILED");
  process.exitCode = 1;
} finally {
  await pool.end();
}
