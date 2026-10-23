import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clampStartupMs, rpcCall, spawnStdio, terminate, type LifecycleStage } from "./jsonrpc-stdio";

export type PocGate =
  | "FUNCTION_RUNTIME_COMPATIBLE"
  | "MCP_SUBPROCESS_COMPATIBLE"
  | "ACTUAL_QLOO_HARNESS_COMPATIBLE"
  | "LIVE_QLOO_CONNECTIVITY";
export type PocGateResult = { gate: PocGate; outcome: "PASS" | "FAIL" | "CONDITIONAL" | "NOT_TESTED"; detail: string };
export type StageResult = { stage: LifecycleStage; ok: boolean; ms: number; detail: string };

const PLACEHOLDER_KEY = "placeholder-not-a-credential";
const fakeBin = fileURLToPath(new URL("../fixtures/fake-qloo-mcp.mjs", import.meta.url));

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

async function mcpJourney(
  bin: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  startupMs: number,
  requestMs: number,
  callTool: boolean,
): Promise<{ stages: StageResult[]; stderr: string; exitCode: number | null }> {
  const stages: StageResult[] = [];
  const mark = (stage: LifecycleStage, ok: boolean, started: number, detail: string) => {
    stages.push({ stage, ok, ms: Math.round(performance.now() - started), detail });
  };
  const spawned = performance.now();
  const session = spawnStdio(bin, args, env);
  mark("HARNESS_PROCESS_STARTED", true, spawned, `pid=${session.child.pid ?? "unknown"}`);
  try {
    const initStarted = performance.now();
    await rpcCall(
      session,
      {
        jsonrpc: "2.0",
        id: "init-1",
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ce-poc", version: "8c" } },
      },
      startupMs,
    );
    session.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    mark("MCP_INITIALIZE_COMPLETED", true, initStarted, "initialize returned");
    if (callTool) {
      const callStarted = performance.now();
      const list = await rpcCall(session, { jsonrpc: "2.0", id: "tools-1", method: "tools/list", params: {} }, requestMs).catch(() => null);
      mark("MCP_TOOL_DISCOVERY_COMPLETED", list !== null, callStarted, list ? "tools/list returned" : "tools/list skipped or failed");
      const toolStarted = performance.now();
      const call = await rpcCall(
        session,
        { jsonrpc: "2.0", id: "call-1", method: "tools/call", params: { name: "qloo_find_tags", arguments: { query: "synthetic" } } },
        requestMs,
      );
      if (!(call as { structuredContent?: unknown }).structuredContent) throw new Error("no structuredContent");
      mark("MCP_FAKE_TOOL_CALL_COMPLETED", true, toolStarted, "tools/call structuredContent present");
    }
  } finally {
    await terminate(session);
  }
  return { stages, stderr: session.stderr, exitCode: session.exitCode };
}

export async function runHostedPoc(): Promise<{
  node: string;
  hosted: boolean;
  memoryRssMb: number;
  revision: string | null;
  gates: PocGateResult[];
  stages: StageResult[];
  coldMs: number | null;
  warmMs: number | null;
}> {
  const hosted = Boolean(process.env.VERCEL);
  const startupMs = clampStartupMs(Number(process.env.CE_POC_STARTUP_MS ?? 12_000));
  const requestMs = clampStartupMs(Number(process.env.CE_POC_REQUEST_MS ?? 8_000));
  const stages: StageResult[] = [];
  const gates: PocGateResult[] = [
    { gate: "FUNCTION_RUNTIME_COMPATIBLE", outcome: hosted ? "PASS" : "NOT_TESTED", detail: `runtime ${process.version}` },
    { gate: "LIVE_QLOO_CONNECTIVITY", outcome: "NOT_TESTED", detail: "no Qloo credential on this preview; ACTUAL_QLOO_TOOL_CALL requires a separate budget" },
  ];
  try {
    const fake = await mcpJourney(fakeBin, ["mcp"], { ...process.env, FAKE_MCP_MODE: "ok", QLOO_API_KEY: PLACEHOLDER_KEY }, startupMs, requestMs, true);
    stages.push(...fake.stages);
    gates.push({ gate: "MCP_SUBPROCESS_COMPATIBLE", outcome: "PASS", detail: "fake MCP initialize + tools/call" });
  } catch (error) {
    gates.push({ gate: "MCP_SUBPROCESS_COMPATIBLE", outcome: "FAIL", detail: error instanceof Error ? error.message.slice(0, 240) : String(error) });
  }
  const bin = harnessBin();
  stages.push({ stage: "HARNESS_BINARY_RESOLVED", ok: Boolean(bin), ms: 0, detail: bin ? bin.replace(process.cwd(), ".") : "not resolvable" });
  let coldMs: number | null = null;
  let warmMs: number | null = null;
  if (!bin) {
    gates.push({ gate: "ACTUAL_QLOO_HARNESS_COMPATIBLE", outcome: "FAIL", detail: "harness bin not resolvable in the function bundle" });
  } else {
    const env = {
      ...process.env,
      QLOO_API_KEY: PLACEHOLDER_KEY,
      QLOO_BASE_URL: "https://hackathon.api.qloo.com",
      QLOO_TRUSTED_BASE_URL: "https://hackathon.api.qloo.com",
    };
    try {
      const coldStart = performance.now();
      const cold = await mcpJourney(bin, ["mcp"], env, startupMs, requestMs, false);
      coldMs = Math.round(performance.now() - coldStart);
      stages.push(...cold.stages.map((s) => ({ ...s, detail: `cold ${s.detail}` })));
      const warmStart = performance.now();
      const warm = await mcpJourney(bin, ["mcp"], env, startupMs, requestMs, false);
      warmMs = Math.round(performance.now() - warmStart);
      stages.push(...warm.stages.map((s) => ({ ...s, detail: `warm ${s.detail}` })));
      gates.push({
        gate: "ACTUAL_QLOO_HARNESS_COMPATIBLE",
        outcome: "CONDITIONAL",
        detail: `harness initialize completed cold=${coldMs}ms warm=${warmMs}ms; no live tools/call`,
      });
    } catch (error) {
      gates.push({
        gate: "ACTUAL_QLOO_HARNESS_COMPATIBLE",
        outcome: "FAIL",
        detail: error instanceof Error ? error.message.slice(0, 240) : String(error),
      });
    }
  }
  return {
    node: process.version,
    hosted,
    memoryRssMb: Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10,
    revision: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    gates,
    stages,
    coldMs,
    warmMs,
  };
}
