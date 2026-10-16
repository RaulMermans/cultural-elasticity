import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().min(1).default("127.0.0.1"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  // Optional: absence is a reportable state (LIVE_QLOO_VALIDATION_NOT_RUN), not a startup failure.
  QLOO_API_KEY: z
    .string()
    .optional()
    .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined)),
  // Override for the harness executable; defaults to the pinned dependency's bin.
  QLOO_BIN: z.string().min(1).optional(),
  // Non-secret, backend-only. No default: live runs fail closed without it (see qloo/environment.ts).
  QLOO_API_BASE_URL: z
    .string()
    .optional()
    .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined)),
});

export type BackendConfig = {
  port: number;
  host: string;
  logLevel: z.infer<typeof envSchema>["LOG_LEVEL"];
  qloo: {
    hasCredential: boolean;
    bin: string | undefined;
    /** As configured; validated by requireHackathonBaseUrl before any live call. */
    apiBaseUrl: string | undefined;
  };
};

/** Loads backend/.env if present (Node built-in; no dotenv dependency). Existing env vars win. */
export function loadLocalEnvFile(): void {
  const envPath = fileURLToPath(new URL("../../.env", import.meta.url));
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

/**
 * The credential value is intentionally not part of BackendConfig: only the Qloo child process
 * receives it, through its inherited environment. Nothing else in the app can log it by accident.
 */
export function readConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  const parsed = envSchema.parse(env);
  return {
    port: parsed.PORT,
    host: parsed.HOST,
    logLevel: parsed.LOG_LEVEL,
    qloo: { hasCredential: parsed.QLOO_API_KEY !== undefined, bin: parsed.QLOO_BIN, apiBaseUrl: parsed.QLOO_API_BASE_URL },
  };
}
