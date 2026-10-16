/**
 * Transport boundary between product code and the official Qloo harness.
 *
 * Product logic depends only on `QlooTransport`. Sprint 0 ships one implementation that drives
 * `qloo exec` (the harness's model-free, non-interactive workflow runner). A future
 * `qloo mcp`-backed transport can implement the same interface: both return the same normalized
 * result envelope [contract].
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { harnessChildEnv, QlooEnvironmentError, requireHackathonBaseUrl } from "./environment.js";
import { QlooTransportError } from "./errors.js";
import type { QlooOperation } from "./types.js";

export type TransportFailure = {
  code: string;
  layer: string;
  retryable: boolean;
  recovery: string;
  correlationId: string | undefined;
};

export type TransportResult =
  | { kind: "result"; raw: unknown }
  | { kind: "failure"; failure: TransportFailure; exitCode: number | null };

export interface QlooTransport {
  readonly name: string;
  execute(operation: QlooOperation, input: unknown): Promise<TransportResult>;
}

// [harness] exec.js: non-JSONL failure output, printed on stdout with a non-zero exit code.
const execFailureSchema = z.looseObject({
  error: z.strictObject({ code: z.string(), layer: z.string(), retryable: z.boolean(), recovery: z.string() }),
  operation: z.string(),
  correlation_id: z.string().optional(),
});

const MAX_STDOUT_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

export type HarnessExecTransportOptions = {
  /** Path to the harness bin script. Defaults to the pinned @qloo/qloo-harness dependency. */
  binPath?: string;
  timeoutMs?: number;
  /**
   * Child environment. Must route the harness to the hackathon origin (see harnessChildEnv).
   * Defaults to harnessChildEnv(process.env, QLOO_API_BASE_URL), which throws when that is unset.
   */
  env?: NodeJS.ProcessEnv;
};

export function defaultHarnessBinPath(): string {
  const entry = fileURLToPath(import.meta.resolve("@qloo/qloo-harness"));
  return join(dirname(entry), "bin.js");
}

const API_KEY_HEADER = /(x-api-key["']?\s*[:=]\s*["']?)[^\s"',}]+/giu;

/** Removes the credential, and any X-Api-Key header value, from text that could reach an error or log. */
export function scrubSecrets(text: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = env.QLOO_API_KEY?.trim();
  const withoutKey = key && key.length >= 4 ? text.split(key).join("[redacted]") : text;
  return withoutKey.replace(API_KEY_HEADER, "$1[redacted]");
}

/**
 * Refuses a child environment that would let the harness choose its own upstream: QLOO_BASE_URL
 * must be the validated hackathon origin and QLOO_TRUSTED_BASE_URL must equal it.
 */
export function assertHackathonRouting(env: NodeJS.ProcessEnv): void {
  const origin = requireHackathonBaseUrl(env.QLOO_BASE_URL);
  if (env.QLOO_TRUSTED_BASE_URL !== origin) {
    throw new QlooEnvironmentError("QLOO_WRONG_ENVIRONMENT", "QLOO_TRUSTED_BASE_URL must equal the hackathon origin for harness calls.");
  }
}

export class HarnessExecTransport implements QlooTransport {
  readonly name = "qloo-harness-exec";
  private readonly binPath: string;
  private readonly timeoutMs: number;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: HarnessExecTransportOptions = {}) {
    this.binPath = options.binPath ?? defaultHarnessBinPath();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.env = options.env ?? harnessChildEnv(process.env, requireHackathonBaseUrl(process.env.QLOO_API_BASE_URL));
    assertHackathonRouting(this.env);
  }

  execute(operation: QlooOperation, input: unknown): Promise<TransportResult> {
    return new Promise((resolve, reject) => {
      // Same Node binary as the backend; the credential reaches the child only through its environment.
      const child = spawn(process.execPath, [this.binPath, "exec", operation], {
        env: this.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let overflow = false;
      const timer = setTimeout(() => child.kill("SIGTERM"), this.timeoutMs);

      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        if (stdout.length + chunk.length > MAX_STDOUT_BYTES) {
          overflow = true;
          child.kill("SIGTERM");
          return;
        }
        stdout += chunk;
      });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-4000);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new QlooTransportError(operation, scrubSecrets(`could not start harness: ${error.message}`, this.env), null));
      });
      child.on("close", (exitCode, signal) => {
        clearTimeout(timer);
        if (overflow) return reject(new QlooTransportError(operation, "harness output exceeded the size limit", exitCode));
        if (signal) return reject(new QlooTransportError(operation, `harness terminated by ${signal}`, exitCode));
        const text = stdout.trim();
        let parsed: unknown;
        try {
          parsed = text ? JSON.parse(text) : undefined;
        } catch {
          parsed = undefined;
        }
        if (exitCode === 0) {
          if (parsed === undefined) return reject(new QlooTransportError(operation, "harness exited 0 without a JSON result", exitCode));
          return resolve({ kind: "result", raw: parsed });
        }
        const failure = execFailureSchema.safeParse(parsed);
        if (failure.success) {
          return resolve({
            kind: "failure",
            exitCode,
            failure: { ...failure.data.error, correlationId: failure.data.correlation_id },
          });
        }
        const detail = scrubSecrets(stderr.trim().split("\n").slice(-3).join(" | ") || "no diagnostic output", this.env);
        reject(new QlooTransportError(operation, `harness exited ${exitCode}: ${detail}`, exitCode));
      });

      child.stdin.end(JSON.stringify(input));
    });
  }
}
