import { buildApp } from "./app.js";
import { assertPublicRuntimeSafe, loadLocalEnvFile, readConfig } from "./config/env.js";
import { beginShutdown, lifecycle } from "./ops/lifecycle.js";
import { opsMetrics } from "./ops/metrics.js";
import { registeredJobs } from "./ops/server.js";

loadLocalEnvFile();
const config = readConfig();
try {
  assertPublicRuntimeSafe();
} catch (error) {
  console.error(error instanceof Error ? error.message : "PUBLIC_RUNTIME_UNSAFE");
  process.exit(1);
}

const app = buildApp({ logLevel: config.logLevel });
opsMetrics().record("backend_restart");

const shutdown = async (signal: string) => {
  beginShutdown();
  registeredJobs()?.shutdown("The investigation service is stopping.");
  app.log.info({ signal, bootId: lifecycle().bootId }, "cultural-elasticity-api shutting down");
  try {
    await app.close();
  } finally {
    process.exit(0);
  }
};

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    {
      bootId: lifecycle().bootId,
      qlooCredentialConfigured: config.qloo.hasCredential,
      publicRuntime: process.env.NODE_ENV === "production" || process.env.CE_PUBLIC_DEPLOYMENT === "1",
    },
    "cultural-elasticity-api ready",
  );
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
