/**
 * Sprint 8C: isolated Vercel feasibility diagnostics (buffered JSON-RPC, subprocess cleanup).
 * SYNTHETIC. Never live Qloo. Never a production deploy.
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { LineBuffer, redact, rpcCall, spawnStdio, terminate } from "../../apps/vercel-feasibility/lib/jsonrpc-stdio.js";

const fakeBin = fileURLToPath(new URL("../../apps/vercel-feasibility/fixtures/fake-qloo-mcp.mjs", import.meta.url));
const TEST_KEY = ["test", "key", "not", "real", "0123456789"].join("-");

describe("buffered JSON-RPC parser", () => {
  it("does not parse a JSON object split across chunks until the newline arrives", () => {
    const buf = new LineBuffer();
    expect(buf.push('{"jsonrpc":"2.0","id":"init"')).toEqual([]);
    expect(buf.push(',"result":{}}\n')).toEqual(['{"jsonrpc":"2.0","id":"init","result":{}}']);
  });

  it("ignores banner lines and keeps a later JSON message", () => {
    const buf = new LineBuffer();
    expect(buf.push("starting harness\n{\"jsonrpc\":\"2.0\",\"id\":\"1\",\"result\":true}\n")).toEqual([
      "starting harness",
      "{\"jsonrpc\":\"2.0\",\"id\":\"1\",\"result\":true}",
    ]);
  });
});

describe("hosted MCP timeout and cleanup", () => {
  it("times out a hanging fake MCP initialize and still terminates the child", async () => {
    const session = spawnStdio(fakeBin, ["mcp"], { ...process.env, FAKE_MCP_MODE: "hang-init", QLOO_API_KEY: TEST_KEY });
    const error = await rpcCall(
      session,
      { jsonrpc: "2.0", id: "init-hang", method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ce-poc", version: "8c" } } },
      200,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/rpc timeout/u);
    expect((error as Error).message).not.toContain(TEST_KEY);
    await terminate(session);
    expect(session.child.killed || session.exitCode !== null).toBe(true);
  });

  it("completes initialize against the fake MCP with a stable request id", async () => {
    const session = spawnStdio(fakeBin, ["mcp"], { ...process.env, FAKE_MCP_MODE: "ok", QLOO_API_KEY: TEST_KEY });
    try {
      const result = await rpcCall(
        session,
        { jsonrpc: "2.0", id: "init-1", method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ce-poc", version: "8c" } } },
        2_000,
      );
      expect(result).toMatchObject({ protocolVersion: "2024-11-05" });
    } finally {
      await terminate(session);
    }
  });

  it("redacts provider secrets from diagnostic text", () => {
    const fakeModel = ["sk", "ant", "api03", "abcdefghijklmnopqrstuvwxyz"].join("-");
    expect(redact(`${fakeModel} and QLOO_API_KEY=abc Bearer tok`)).not.toMatch(/sk-ant-api03|QLOO_API_KEY=abc|Bearer tok/u);
  });
});
