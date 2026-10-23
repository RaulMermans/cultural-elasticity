/**
 * Isolated Function / MCP subprocess diagnostic. Safe to run locally and on a protected Vercel preview.
 * Does not accept a shell command from the caller. Does not send a live Qloo tools/call.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type PocGate =
  | "FUNCTION_BUILD_COMPATIBLE"
  | "FUNCTION_RUNTIME_COMPATIBLE"
  | "MCP_SUBPROCESS_COMPATIBLE"
  | "ACTUAL_QLOO_HARNESS_COMPATIBLE"
  | "LIVE_QLOO_CONNECTIVITY";

export type PocGateResult = { gate: PocGate; outcome: "PASS" | "FAIL" | "CONDITIONAL" | "NOT_TESTED"; detail: string };

const fakeBin = fileURLToPath(new URL("../../tests/fixtures/fake-qloo-mcp.mjs", import.meta.url));
const PLACEHOLDER_KEY = "placeholder-not-a-credential";

function rpc(child: ReturnType<typeof spawn>, message: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("rpc timeout")), 4_000);
    const onData = (chunk: Buffer | string) => {
      const line = String(chunk).split("\n").find((l) => l.trim().startsWith("{"));
      if (!line) return;
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(error);
      }
    };
    child.stdout?.on("data", onData);
    child.stdin?.write(`${JSON.stringify(message)}\n`);
  });
}

async function withChild<T>(bin: string, args: string[], env: NodeJS.ProcessEnv, fn: (child: ReturnType<typeof spawn>) => Promise<T>): Promise<T> {
  const child = spawn(process.execPath, [bin, ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
  try {
    return await fn(child);
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 50));
    if (!child.killed) child.kill("SIGKILL");
  }
}

async function initialize(child: ReturnType<typeof spawn>): Promise<unknown> {
  const result = await rpc(child, {
    jsonrpc: "2.0",
    id: "init",
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ce-poc", version: "8b" } },
  });
  child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  return result;
}

function harnessBin(): string | null {
  const candidates: string[] = [];
  try {
    const req = createRequire(import.meta.url);
    candidates.push(join(dirname(req.resolve("@qloo/qloo-harness/package.json")), "dist/bin.js"));
  } catch {
    /* import.meta next */
  }
  try {
    const entry = fileURLToPath(import.meta.resolve("@qloo/qloo-harness"));
    candidates.push(join(dirname(entry), "bin.js"));
  } catch {
    /* cwd last */
  }
  candidates.push(join(process.cwd(), "node_modules/@qloo/qloo-harness/dist/bin.js"));
  return candidates.find((p) => existsSync(p)) ?? null;
}

export async function runFunctionPoc(options: { hosted?: boolean } = {}): Promise<{
  node: string;
  hosted: boolean;
  memoryRssMb: number;
  gates: PocGateResult[];
}> {
  const hosted = options.hosted === true;
  const gates: PocGateResult[] = [
    { gate: "FUNCTION_BUILD_COMPATIBLE", outcome: "PASS", detail: `Node ${process.version}; child_process available` },
    { gate: "FUNCTION_RUNTIME_COMPATIBLE", outcome: hosted ? "PASS" : "NOT_TESTED", detail: hosted ? `hosted runtime ${process.version}` : "not running on Vercel" },
    { gate: "LIVE_QLOO_CONNECTIVITY", outcome: "NOT_TESTED", detail: "preview has no Qloo credential; no live tools/call was sent" },
  ];
  try {
    const started = performance.now();
    await withChild(fakeBin, ["mcp"], { ...process.env, FAKE_MCP_MODE: "ok", QLOO_API_KEY: PLACEHOLDER_KEY }, async (child) => {
      await initialize(child);
      const call = await rpc(child, { jsonrpc: "2.0", id: "call", method: "tools/call", params: { name: "qloo_find_tags", arguments: { query: "synthetic" } } });
      const structured = (call as { result?: { structuredContent?: unknown } }).result?.structuredContent;
      if (!structured) throw new Error("fake tools/call returned no structuredContent");
    });
    gates.push({ gate: "MCP_SUBPROCESS_COMPATIBLE", outcome: "PASS", detail: `fake MCP initialize + tools/call in ${Math.round(performance.now() - started)} ms` });
  } catch (error) {
    gates.push({ gate: "MCP_SUBPROCESS_COMPATIBLE", outcome: "FAIL", detail: error instanceof Error ? error.message.slice(0, 200) : String(error) });
  }
  const bin = harnessBin();
  if (!bin) {
    gates.push({ gate: "ACTUAL_QLOO_HARNESS_COMPATIBLE", outcome: "FAIL", detail: "@qloo/qloo-harness bin.js was not resolvable" });
  } else {
    try {
      const started = performance.now();
      await withChild(
        bin,
        ["mcp"],
        {
          ...process.env,
          QLOO_API_KEY: PLACEHOLDER_KEY,
          QLOO_BASE_URL: "https://hackathon.api.qloo.com",
          QLOO_TRUSTED_BASE_URL: "https://hackathon.api.qloo.com",
        },
        async (child) => {
          await initialize(child);
        },
      );
      gates.push({ gate: "ACTUAL_QLOO_HARNESS_COMPATIBLE", outcome: "CONDITIONAL", detail: `harness spawned and initialize returned in ${Math.round(performance.now() - started)} ms; no live tools/call` });
    } catch (error) {
      gates.push({
        gate: "ACTUAL_QLOO_HARNESS_COMPATIBLE",
        outcome: hosted ? "FAIL" : "CONDITIONAL",
        detail: `harness spawn/initialize: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`,
      });
    }
  }
  return {
    node: process.version,
    hosted,
    memoryRssMb: Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10,
    gates,
  };
}
