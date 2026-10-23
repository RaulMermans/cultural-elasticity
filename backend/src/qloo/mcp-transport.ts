/**
 * QlooTransport over the official canonical MCP server (`qloo mcp`, harness 0.1.26).
 *
 * [harness] `qloo mcp` is a newline-delimited JSON-RPC 2.0 stdio server. It exposes `qloo_capabilities`
 * and one tool per canonical workflow, named `qloo_<operation>`. A `tools/call` result carries the same
 * workflow envelope that `qloo exec` prints, in `structuredContent`, with `execution.transport = "mcp"`.
 * The harness derives `execution.correlation_id` from the JSON-RPC request id (`mcp-<id>`), so every
 * request uses a fresh UUID id: correlation ids stay unique across server restarts and runs.
 *
 * One long-lived child process serves many calls (requests are serialized). The child receives the
 * same pinned hackathon environment as the exec transport (see environment.ts); the credential reaches
 * it only through that environment and never appears in requests, results or errors.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { harnessChildEnv, requireHackathonBaseUrl } from "./environment.js";
import { QlooTransportError } from "./errors.js";
import { assertHackathonRouting, defaultHarnessBinPath, scrubSecrets, type QlooTransport, type TransportResult } from "./transport.js";
import type { QlooOperation } from "./types.js";

export const MCP_PROTOCOL_VERSION = "2024-11-05";

/** [harness] tool name for a canonical workflow operation. */
export const mcpToolName = (operation: QlooOperation) => `qloo_${operation}`;

const rpcResponseSchema = z.looseObject({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
  result: z.unknown().optional(),
  error: z.looseObject({ code: z.number(), message: z.string() }).optional(),
});
const toolResultSchema = z.looseObject({ structuredContent: z.unknown().optional(), isError: z.boolean().optional() });

export type HarnessMcpTransportOptions = {
  binPath?: string;
  timeoutMs?: number;
  /** Must route the harness to the hackathon origin. Defaults to harnessChildEnv(process.env, QLOO_API_BASE_URL). */
  env?: NodeJS.ProcessEnv;
};

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout; operation: QlooOperation | "initialize" };

export class HarnessMcpTransport implements QlooTransport {
  readonly name = "qloo-harness-mcp";
  private readonly binPath: string;
  private readonly timeoutMs: number;
  private readonly env: NodeJS.ProcessEnv;
  private child: ChildProcessWithoutNullStreams | undefined;
  private ready: Promise<void> | undefined;
  private buffer = "";
  private stderrTail = "";
  private readonly pending = new Map<string, Pending>();
  /** Calls are serialized: one request in flight keeps rate limiting and ordering simple. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Monotonic milliseconds for the most recent child start + initialize handshake (0 when the child was already ready). */
  lastStartupMs = 0;
  /** Last successful handshake duration; 0 until the first start. */
  startupDurationMs = 0;

  constructor(options: HarnessMcpTransportOptions = {}) {
    this.binPath = options.binPath ?? defaultHarnessBinPath();
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.env = options.env ?? harnessChildEnv(process.env, requireHackathonBaseUrl(process.env.QLOO_API_BASE_URL));
    assertHackathonRouting(this.env);
  }

  execute(operation: QlooOperation, input: unknown): Promise<TransportResult> {
    const run = this.queue.then(() => this.call(operation, input));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Stops the child process. Pending requests fail with a transport error. */
  close(): void {
    this.failAll("transport closed");
    this.child?.kill("SIGTERM");
    this.child = undefined;
    this.ready = undefined;
  }

  private async call(operation: QlooOperation, input: unknown): Promise<TransportResult> {
    await this.start(operation);
    const result = await this.request(operation, "tools/call", { name: mcpToolName(operation), arguments: input ?? {} });
    const parsed = toolResultSchema.safeParse(result);
    if (!parsed.success || parsed.data.structuredContent === undefined) {
      throw new QlooTransportError(operation, "MCP tools/call returned no structured workflow result", null);
    }
    // Status "error" envelopes (including QLOO_AUTH and rate limits) are interpreted by the client policy.
    return { kind: "result", raw: parsed.data.structuredContent };
  }

  private start(operation: QlooOperation): Promise<void> {
    if (this.ready) {
      this.lastStartupMs = 0;
      return this.ready;
    }
    const started = performance.now();
    const child = spawn(process.execPath, [this.binPath, "mcp"], { env: this.env, stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => this.onData(chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-4000);
    });
    child.on("error", (error) => this.failAll(`could not start harness MCP server: ${error.message}`));
    child.on("close", (code, signal) => {
      this.failAll(`harness MCP server exited (${signal ?? code})`);
      if (this.child === child) {
        this.child = undefined;
        this.ready = undefined;
      }
    });
    this.ready = this.request(operation, "initialize", { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "cultural-elasticity", version: "0.0.0" } }).then(() => {
      this.write({ jsonrpc: "2.0", method: "notifications/initialized" });
      this.lastStartupMs = Math.round(performance.now() - started);
      this.startupDurationMs = this.lastStartupMs;
    });
    this.ready.catch(() => {
      this.ready = undefined;
    });
    return this.ready;
  }

  private request(operation: QlooOperation, method: string, params: unknown): Promise<unknown> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new QlooTransportError(operation, `MCP ${method} timed out after ${this.timeoutMs} ms`, null));
        // A timed-out server may be wedged: restart it on the next call.
        this.child?.kill("SIGTERM");
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, operation: method === "initialize" ? "initialize" : operation });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  private write(message: unknown): void {
    this.child?.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > 5 * 1024 * 1024) {
      this.buffer = "";
      this.failAll("harness MCP output exceeded the size limit");
      this.child?.kill("SIGTERM");
      return;
    }
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.onLine(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  private onLine(line: string): void {
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      return; // Not a protocol message; ignored (the server writes protocol on stdout only).
    }
    const parsed = rpcResponseSchema.safeParse(json);
    if (!parsed.success || parsed.data.id === null) return;
    const id = String(parsed.data.id);
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    const operation = pending.operation === "initialize" ? "describe" : pending.operation;
    if (parsed.data.error) {
      pending.reject(new QlooTransportError(operation, scrubSecrets(`MCP error ${parsed.data.error.code}: ${parsed.data.error.message}`, this.env), null));
      return;
    }
    pending.resolve(parsed.data.result);
  }

  private failAll(reason: string): void {
    const detail = scrubSecrets(`${reason}${this.stderrTail ? ` | ${this.stderrTail.trim().split("\n").slice(-2).join(" | ")}` : ""}`, this.env);
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new QlooTransportError(pending.operation === "initialize" ? "describe" : pending.operation, detail, null));
      this.pending.delete(id);
    }
  }
}
