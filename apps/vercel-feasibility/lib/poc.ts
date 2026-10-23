import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type PocGate = "FUNCTION_RUNTIME_COMPATIBLE" | "MCP_SUBPROCESS_COMPATIBLE" | "ACTUAL_QLOO_HARNESS_COMPATIBLE" | "LIVE_QLOO_CONNECTIVITY";
export type PocGateResult = { gate: PocGate; outcome: "PASS" | "FAIL" | "CONDITIONAL" | "NOT_TESTED"; detail: string };
const PLACEHOLDER_KEY = "placeholder-not-a-credential";

const fakeBin = fileURLToPath(new URL("../fixtures/fake-qloo-mcp.mjs", import.meta.url));

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

function harnessBin(): string | null {
  const candidates: string[] = [];
  try {
    const req = createRequire(import.meta.url);
    candidates.push(join(dirname(req.resolve("@qloo/qloo-harness/package.json")), "dist/bin.js"));
  } catch {
    /* resolve via import.meta next */
  }
  try {
    const entry = fileURLToPath(import.meta.resolve("@qloo/qloo-harness"));
    candidates.push(join(dirname(entry), "bin.js"));
  } catch {
    /* traced node_modules path last */
  }
  candidates.push(join(process.cwd(), "node_modules/@qloo/qloo-harness/dist/bin.js"));
  return candidates.find((p) => existsSync(p)) ?? null;
}

export async function runHostedPoc(): Promise<{ node: string; hosted: boolean; memoryRssMb: number; revision: string | null; gates: PocGateResult[] }> {
  const hosted = Boolean(process.env.VERCEL);
  const gates: PocGateResult[] = [
    { gate: "FUNCTION_RUNTIME_COMPATIBLE", outcome: hosted ? "PASS" : "NOT_TESTED", detail: `runtime ${process.version}` },
    { gate: "LIVE_QLOO_CONNECTIVITY", outcome: "NOT_TESTED", detail: "no Qloo credential on this preview; no live tools/call" },
  ];
  try {
    await withChild(fakeBin, ["mcp"], { ...process.env, FAKE_MCP_MODE: "ok", QLOO_API_KEY: PLACEHOLDER_KEY }, async (child) => {
      await rpc(child, { jsonrpc: "2.0", id: "init", method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ce-poc", version: "8b" } } });
      child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
      const call = await rpc(child, { jsonrpc: "2.0", id: "call", method: "tools/call", params: { name: "qloo_find_tags", arguments: { query: "synthetic" } } });
      if (!(call as { result?: { structuredContent?: unknown } }).result?.structuredContent) throw new Error("no structuredContent");
    });
    gates.push({ gate: "MCP_SUBPROCESS_COMPATIBLE", outcome: "PASS", detail: "fake MCP initialize + tools/call" });
  } catch (error) {
    gates.push({ gate: "MCP_SUBPROCESS_COMPATIBLE", outcome: "FAIL", detail: error instanceof Error ? error.message.slice(0, 200) : String(error) });
  }
  const bin = harnessBin();
  if (!bin) {
    gates.push({ gate: "ACTUAL_QLOO_HARNESS_COMPATIBLE", outcome: "FAIL", detail: "harness bin not resolvable in the function bundle" });
  } else {
    try {
      await withChild(bin, ["mcp"], { ...process.env, QLOO_API_KEY: PLACEHOLDER_KEY, QLOO_BASE_URL: "https://hackathon.api.qloo.com", QLOO_TRUSTED_BASE_URL: "https://hackathon.api.qloo.com" }, async (child) => {
        await rpc(child, { jsonrpc: "2.0", id: "init", method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ce-poc", version: "8b" } } });
      });
      gates.push({ gate: "ACTUAL_QLOO_HARNESS_COMPATIBLE", outcome: "CONDITIONAL", detail: "harness spawned and initialize returned; no live tools/call" });
    } catch (error) {
      gates.push({ gate: "ACTUAL_QLOO_HARNESS_COMPATIBLE", outcome: "FAIL", detail: error instanceof Error ? error.message.slice(0, 200) : String(error) });
    }
  }
  return {
    node: process.version,
    hosted,
    memoryRssMb: Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10,
    revision: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    gates,
  };
}
