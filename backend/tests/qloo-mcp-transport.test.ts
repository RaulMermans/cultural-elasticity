import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { harnessChildEnv, QLOO_HACKATHON_ORIGIN } from "../src/qloo/environment.js";
import { QlooTransportError } from "../src/qloo/errors.js";
import { HarnessMcpTransport, mcpToolName } from "../src/qloo/mcp-transport.js";

const fakeBin = fileURLToPath(new URL("./fixtures/fake-qloo-mcp.mjs", import.meta.url));
const TEST_KEY = "test-key-not-real-0123456789";
const open: HarnessMcpTransport[] = [];

function transport(mode: string, timeoutMs?: number) {
  const t = new HarnessMcpTransport({ binPath: fakeBin, env: harnessChildEnv({ ...process.env, FAKE_MCP_MODE: mode, QLOO_API_KEY: TEST_KEY }, QLOO_HACKATHON_ORIGIN), ...(timeoutMs ? { timeoutMs } : {}) });
  open.push(t);
  return t;
}

afterEach(() => {
  for (const t of open.splice(0)) t.close();
});

describe("HarnessMcpTransport (against a fake qloo mcp server)", () => {
  it("maps operations to canonical tool names", () => {
    expect(mcpToolName("find_tags")).toBe("qloo_find_tags");
    expect(mcpToolName("entity_tags")).toBe("qloo_entity_tags");
  });

  it("initializes once, calls tools and returns structuredContent as the raw envelope", async () => {
    const t = transport("ok");
    const a = await t.execute("find_tags", { query: "x", limit: 1 });
    const b = await t.execute("describe", { entity: "y" });
    expect(a.kind).toBe("result");
    if (a.kind === "result") expect(a.raw).toMatchObject({ operation: "find_tags", echo: { query: "x", limit: 1 } });
    if (b.kind === "result") expect(b.raw).toMatchObject({ operation: "describe" });
  });

  it("uses a fresh UUID request id per call, so correlation ids are unique", async () => {
    const t = transport("ok");
    const ids = new Set<string>();
    for (let i = 0; i < 3; i += 1) {
      const r = await t.execute("describe", { entity: "z" });
      if (r.kind === "result") ids.add((r.raw as { execution: { correlation_id: string } }).execution.correlation_id);
    }
    expect(ids.size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^mcp-[0-9a-f-]{36}$/u);
  });

  it("turns JSON-RPC errors and missing structured results into transport errors", async () => {
    await expect(transport("rpc-error").execute("describe", { entity: "x" })).rejects.toBeInstanceOf(QlooTransportError);
    await expect(transport("no-structured").execute("describe", { entity: "x" })).rejects.toBeInstanceOf(QlooTransportError);
  });

  it("times out instead of hanging", async () => {
    await expect(transport("hang", 300).execute("describe", { entity: "x" })).rejects.toThrow(/timed out/u);
  });

  it("never leaks the credential when the server dies", async () => {
    const error = await transport("leaky-exit").execute("describe", { entity: "x" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QlooTransportError);
    expect((error as Error).message).not.toContain(TEST_KEY);
  });

  it("refuses an environment that is not pinned to the hackathon origin", () => {
    expect(() => new HarnessMcpTransport({ binPath: fakeBin, env: { ...process.env, QLOO_BASE_URL: "https://api.qloo.com" } })).toThrow();
  });
});
