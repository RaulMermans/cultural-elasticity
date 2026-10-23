/**
 * Sprint 8A isolated Vercel feasibility proofs. Local only.
 * Hosted Vercel Functions/Workflow behaviour is NOT_TESTED.
 */
import { describe, expect, it } from "vitest";
import { DURABLE_STATE_REQUIREMENTS, DurableWorkflow, runSyntheticInvestigation, UnsafeRetryError } from "../scripts/vercel-feasibility/durable-workflow.js";
import { runLocalMcpPoc } from "../scripts/vercel-feasibility/mcp-poc.js";
import { harnessChildEnv, QLOO_HACKATHON_ORIGIN } from "../src/qloo/environment.js";
import { HarnessMcpTransport } from "../src/qloo/mcp-transport.js";
import { fileURLToPath } from "node:url";

const fakeBin = fileURLToPath(new URL("./fixtures/fake-qloo-mcp.mjs", import.meta.url));
const TEST_KEY = "test-key-not-real-0123456789";

describe("R–S workflow step retry and replay idempotency", () => {
  it("retries a failed local step and replays a committed result without re-execution", async () => {
    const wf = new DurableWorkflow();
    let attempts = 0;
    const value = await wf.step({ operationId: "flaky", maxRetries: 2 }, async () => {
      attempts += 1;
      if (attempts < 2) throw new Error("transient");
      return 7;
    });
    expect(value).toBe(7);
    expect(attempts).toBe(2);
    const replayed = await wf.step({ operationId: "flaky" }, async () => {
      throw new Error("must not re-execute");
    });
    expect(replayed).toBe(7);
    expect(wf.replay("flaky")).toBe(7);
  });

  it("refuses to automatically retry an external step that started without a committed result", async () => {
    const wf = new DurableWorkflow();
    await expect(wf.step({ operationId: "qloo_find_tags", external: true, retryable: true }, async () => {
      throw new Error("transport dropped");
    })).rejects.toBeInstanceOf(UnsafeRetryError);
    await expect(wf.step({ operationId: "qloo_find_tags", external: true }, async () => ({ ok: true }))).rejects.toBeInstanceOf(UnsafeRetryError);
  });

  it("runs the eight-step synthetic investigation including persist-and-resume", async () => {
    const out = await runSyntheticInvestigation();
    expect(out.ok).toBe(true);
    expect(out.steps).toHaveLength(8);
    expect(out.result).toEqual({ status: "COMPLETE", findings: 1 });
  });
});

describe("T–V mock Qloo subprocess, MCP handshake, subprocess failure", () => {
  it("starts a fake MCP server, completes initialize, and returns structuredContent", async () => {
    const poc = await runLocalMcpPoc();
    expect(poc.handshake).toBe(true);
    expect(poc.startupMs).toBeGreaterThanOrEqual(0);
    expect(poc.gates.find((g) => g.gate === "QLOO_MCP_SUBPROCESS_COMPATIBLE")?.outcome).toBe("PASS");
    expect(poc.gates.find((g) => g.gate === "FUNCTION_RUNTIME_COMPATIBLE")?.outcome).toBe("NOT_TESTED");
  });

  it("does not treat qloo --help as MCP compatibility: tools/call is required", async () => {
    const env = harnessChildEnv({ ...process.env, QLOO_API_KEY: TEST_KEY, FAKE_MCP_MODE: "ok" }, QLOO_HACKATHON_ORIGIN);
    const t = new HarnessMcpTransport({ binPath: fakeBin, env, timeoutMs: 1_000 });
    try {
      const result = await t.execute("describe", { entity: "synthetic" });
      expect(result.kind).toBe("result");
      expect(t.startupDurationMs).toBeGreaterThanOrEqual(0);
    } finally {
      t.close();
    }
  });

  it("turns a dead child into a transport error without leaking the credential", async () => {
    const env = harnessChildEnv({ ...process.env, QLOO_API_KEY: TEST_KEY, FAKE_MCP_MODE: "leaky-exit" }, QLOO_HACKATHON_ORIGIN);
    const t = new HarnessMcpTransport({ binPath: fakeBin, env, timeoutMs: 1_000 });
    const error = await t.execute("describe", { entity: "x" }).catch((e: unknown) => e);
    expect(String(error)).not.toContain(TEST_KEY);
    t.close();
  });
});

describe("function / MCP poc (local; hosted is a separate gate)", () => {
  it("spawns the fake MCP server, completes initialize, and calls tools/call", async () => {
    const { runFunctionPoc } = await import("../scripts/vercel-feasibility/function-poc.js");
    const poc = await runFunctionPoc();
    expect(poc.node).toMatch(/^v22\./u);
    expect(poc.gates.find((g) => g.gate === "MCP_SUBPROCESS_COMPATIBLE")?.outcome).toBe("PASS");
    expect(poc.gates.find((g) => g.gate === "LIVE_QLOO_CONNECTIVITY")?.outcome).toBe("NOT_TESTED");
    expect(JSON.stringify(poc)).not.toMatch(/sk-ant-|QLOO_API_KEY=/u);
  });
});

describe("official Workflow SDK source (compiler is a separate hosted gate)", () => {
  it("runs the documented journey as TypeScript and refuses an uncertain external retry", async () => {
    const { syntheticInvestigationWorkflow, investigationRequestSchema, UnsafeExternalRetryError } = await import("../scripts/vercel-feasibility/official-workflow.js");
    expect(investigationRequestSchema.safeParse({ query: "", brand: "x" }).success).toBe(false);
    const out = await syntheticInvestigationWorkflow({ query: "Where could a synthetic brand expand?", brand: "SYN-BRAND" });
    expect(out.status).toBe("COMPLETE");
    expect(out.findings).toBe(1);
    expect((out.resumed as { uncertain: string }).uncertain).toBe("refused");
    await expect(Promise.reject(new UnsafeExternalRetryError("qloo_find_tags"))).rejects.toBeInstanceOf(UnsafeExternalRetryError);
  });
});

describe("W durable state requirements", () => {
  it("names each state class separately and marks spend as requiring durability", () => {
    const kinds = DURABLE_STATE_REQUIREMENTS.map((r) => r.kind);
    expect(kinds).toEqual(["RUN_STATE", "SHORT_TERM_WORKING_MEMORY", "INVESTIGATION_LINEAGE", "CHECKPOINTS", "ARTIFACTS", "LOGS", "SPEND_STATE"]);
    expect(DURABLE_STATE_REQUIREMENTS.every((r) => r.durable)).toBe(true);
    expect(DURABLE_STATE_REQUIREMENTS.find((r) => r.kind === "SPEND_STATE")?.reason).toMatch(/in-memory is not/u);
  });
});
