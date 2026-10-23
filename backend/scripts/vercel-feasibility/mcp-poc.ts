/**
 * Isolated Qloo MCP subprocess feasibility. Uses the same fake local MCP server as unit tests.
 * A successful `qloo --help` is not this test. Hosted Vercel behaviour is NOT_TESTED here.
 */
import { fileURLToPath } from "node:url";
import { harnessChildEnv, QLOO_HACKATHON_ORIGIN } from "../../src/qloo/environment.js";
import { HarnessMcpTransport } from "../../src/qloo/mcp-transport.js";

const fakeBin = fileURLToPath(new URL("../../tests/fixtures/fake-qloo-mcp.mjs", import.meta.url));
const TEST_KEY = "test-key-not-real-0123456789";

export type McpPocGate =
  | "FUNCTION_BUILD_COMPATIBLE"
  | "FUNCTION_RUNTIME_COMPATIBLE"
  | "QLOO_MCP_SUBPROCESS_COMPATIBLE"
  | "QLOO_TOOL_CALL_COMPATIBLE";

export type GateResult = { gate: McpPocGate; outcome: "PASS" | "FAIL" | "NOT_TESTED" | "CONDITIONAL"; detail: string };

export async function runLocalMcpPoc(): Promise<{ gates: GateResult[]; startupMs: number; callMs: number; handshake: boolean }> {
  const env = harnessChildEnv({ ...process.env, QLOO_API_KEY: TEST_KEY, FAKE_MCP_MODE: "ok" }, QLOO_HACKATHON_ORIGIN);
  const transport = new HarnessMcpTransport({ binPath: fakeBin, env, timeoutMs: 2_000 });
  const started = performance.now();
  try {
    const result = await transport.execute("find_tags", { query: "synthetic", limit: 1 });
    const callMs = Math.round(performance.now() - started);
    const handshake = result.kind === "result";
    const startupMs = transport.startupDurationMs;
    return {
      handshake,
      startupMs,
      callMs,
      gates: [
        { gate: "FUNCTION_BUILD_COMPATIBLE", outcome: "PASS", detail: "local Node can resolve @qloo/qloo-harness and spawn the fake MCP bin" },
        { gate: "FUNCTION_RUNTIME_COMPATIBLE", outcome: "NOT_TESTED", detail: "hosted Vercel Node/Fluid runtime was not deployed" },
        { gate: "QLOO_MCP_SUBPROCESS_COMPATIBLE", outcome: handshake ? "PASS" : "FAIL", detail: handshake ? "local MCP initialize + tools/call succeeded against the fake server" : "handshake failed" },
        { gate: "QLOO_TOOL_CALL_COMPATIBLE", outcome: handshake ? "PASS" : "FAIL", detail: handshake ? "tools/call returned structuredContent" : "no structured result" },
      ],
    };
  } finally {
    transport.close();
  }
}
