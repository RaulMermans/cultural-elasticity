import { buildApp } from "./app.js";
import { loadLocalEnvFile, readConfig } from "./config/env.js";

loadLocalEnvFile();
const config = readConfig();
const app = buildApp({ logLevel: config.logLevel });

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info({ qlooCredentialConfigured: config.qloo.hasCredential }, "cultural-elasticity-api ready");
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
