import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { QlooTransportError } from "../src/qloo/errors.js";
import { defaultHarnessBinPath, HarnessExecTransport, scrubSecrets } from "../src/qloo/transport.js";

const fakeBin = fileURLToPath(new URL("./fixtures/fake-qloo-bin.mjs", import.meta.url));
const TEST_KEY = "test-key-not-real-0123456789";

function transport(mode: string, timeoutMs?: number) {
  return new HarnessExecTransport({
    binPath: fakeBin,
    env: { ...process.env, FAKE_QLOO_MODE: mode, QLOO_API_KEY: TEST_KEY },
    ...(timeoutMs ? { timeoutMs } : {}),
  });
}

describe("HarnessExecTransport (against a fake qloo binary)", () => {
  it("passes input on stdin and returns the parsed envelope", async () => {
    const result = await transport("ok").execute("find_tags", { query: "sneakers", limit: 1 });
    expect(result.kind).toBe("result");
    if (result.kind === "result") expect(result.raw).toMatchObject({ operation: "find_tags", echo: { query: "sneakers", limit: 1 } });
  });

  it("maps the exec failure object (exit 4) to a structured failure", async () => {
    const result = await transport("auth").execute("describe", { entity: "x" });
    expect(result).toMatchObject({ kind: "failure", exitCode: 4, failure: { code: "QLOO_AUTH", retryable: false } });
  });

  it("rejects non-JSON output", async () => {
    await expect(transport("garbage").execute("describe", { entity: "x" })).rejects.toBeInstanceOf(QlooTransportError);
  });

  it("never leaks the credential into error messages", async () => {
    const error = await transport("crash-leaky").execute("describe", { entity: "x" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QlooTransportError);
    expect((error as Error).message).not.toContain(TEST_KEY);
    expect((error as Error).message).toContain("[redacted]");
  });

  it("kills a hung harness after the timeout", async () => {
    await expect(transport("hang", 300).execute("describe", { entity: "x" })).rejects.toBeInstanceOf(QlooTransportError);
  });

  it("resolves the pinned official harness binary", () => {
    expect(defaultHarnessBinPath()).toMatch(/@qloo[/\\]qloo-harness[/\\]dist[/\\]bin\.js$/);
  });
});

describe("scrubSecrets", () => {
  it("redacts the configured key and leaves other text alone", () => {
    expect(scrubSecrets(`a ${TEST_KEY} b`, { QLOO_API_KEY: TEST_KEY })).toBe("a [redacted] b");
    expect(scrubSecrets("nothing here", { QLOO_API_KEY: TEST_KEY })).toBe("nothing here");
    expect(scrubSecrets("no key set", {})).toBe("no key set");
  });
});
