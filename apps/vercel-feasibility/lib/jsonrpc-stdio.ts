/**
 * Bounded newline-delimited JSON-RPC 2.0 client for a stdio child.
 * Used by the isolated Vercel feasibility PoC. Not a shell. Not a Qloo credential proxy.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export type RpcId = string;
export type LifecycleStage =
  | "HARNESS_BINARY_RESOLVED"
  | "HARNESS_PROCESS_STARTED"
  | "MCP_INITIALIZE_COMPLETED"
  | "MCP_TOOL_DISCOVERY_COMPLETED"
  | "MCP_FAKE_TOOL_CALL_COMPLETED"
  | "ACTUAL_QLOO_TOOL_CALL_COMPLETED";

const MAX_BUFFER = 1024 * 1024;
const MAX_STDERR = 4000;
const MAX_STARTUP_MS = 20_000;
const MAX_REQUEST_MS = 15_000;

export function redact(text: string): string {
  return text
    .replace(/sk-ant-[a-zA-Z0-9_-]+/g, "[redacted]")
    .replace(/qloo[_-]?api[_-]?key[=:]\s*\S+/gi, "QLOO_API_KEY=[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

export class LineBuffer {
  private buf = "";
  push(chunk: string): string[] {
    this.buf += chunk;
    if (this.buf.length > MAX_BUFFER) {
      this.buf = "";
      throw new Error("stdio buffer exceeded 1MB");
    }
    const lines: string[] = [];
    let newline = this.buf.indexOf("\n");
    while (newline >= 0) {
      const line = this.buf.slice(0, newline).trim();
      this.buf = this.buf.slice(newline + 1);
      if (line) lines.push(line);
      newline = this.buf.indexOf("\n");
    }
    return lines;
  }
}

export type ChildSession = {
  child: ChildProcessWithoutNullStreams;
  startedAt: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
};

export function spawnStdio(bin: string, args: string[], env: NodeJS.ProcessEnv): ChildSession {
  const child = spawn(process.execPath, [bin, ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
  const session: ChildSession = { child, startedAt: performance.now(), exitCode: null, signal: null, stderr: "" };
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    session.stderr = redact((session.stderr + chunk).slice(-MAX_STDERR));
  });
  child.on("close", (code, signal) => {
    session.exitCode = code;
    session.signal = signal;
  });
  return session;
}

export async function rpcCall(
  session: ChildSession,
  message: { jsonrpc: "2.0"; id: RpcId; method: string; params?: unknown },
  timeoutMs: number,
): Promise<unknown> {
  const bounded = Math.min(Math.max(50, timeoutMs), MAX_REQUEST_MS);
  const buffer = new LineBuffer();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      session.child.stdout.off("data", onData);
      reject(new Error(`rpc timeout after ${bounded}ms method=${message.method} id=${message.id} exit=${session.exitCode ?? "running"} stderr=${session.stderr.slice(-240) || "none"}`));
    }, bounded);
    const onData = (chunk: Buffer | string) => {
      let lines: string[];
      try {
        lines = buffer.push(String(chunk));
      } catch (error) {
        clearTimeout(timer);
        session.child.stdout.off("data", onData);
        reject(error);
        return;
      }
      for (const line of lines) {
        if (!line.startsWith("{")) continue;
        let parsed: { id?: unknown; result?: unknown; error?: { message?: string } };
        try {
          parsed = JSON.parse(line) as { id?: unknown; result?: unknown; error?: { message?: string } };
        } catch {
          continue;
        }
        if (String(parsed.id) !== message.id) continue;
        clearTimeout(timer);
        session.child.stdout.off("data", onData);
        if (parsed.error) {
          reject(new Error(redact(parsed.error.message ?? "rpc error")));
          return;
        }
        resolve(parsed.result);
        return;
      }
    };
    session.child.stdout.on("data", onData);
    session.child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

export async function terminate(session: ChildSession): Promise<void> {
  if (session.exitCode !== null) return;
  session.child.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 50));
  if (session.exitCode === null) session.child.kill("SIGKILL");
}

export function clampStartupMs(ms: number): number {
  return Math.min(Math.max(200, ms), MAX_STARTUP_MS);
}

export const JSONRPC_BOUNDS = { MAX_BUFFER, MAX_STDERR, MAX_STARTUP_MS, MAX_REQUEST_MS };
