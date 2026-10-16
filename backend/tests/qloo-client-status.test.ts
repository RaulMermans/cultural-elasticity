import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HarnessQlooClient } from "../src/qloo/client.js";
import { QlooContractError, QlooNotConfiguredError, QlooWorkflowError } from "../src/qloo/errors.js";
import { compactEntity, envelope, failure, FixtureTransport, interpreted, syntheticId } from "./fixtures/synthetic/envelopes.js";

const recorded = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/recorded/${name}`, import.meta.url), "utf8"));

const okDescribe = () =>
  envelope("describe", "ok", {
    interpretation: { entity: interpreted("Example", syntheticId(1), "Example") },
    results: [compactEntity(syntheticId(1), "Example")],
  });

describe("HarnessQlooClient status handling", () => {
  it("ok → data", async () => {
    const client = new HarnessQlooClient(new FixtureTransport(() => okDescribe()));
    const outcome = await client.describe({ entity: "Example" });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") expect(outcome.data.entity.qlooId).toBe(syntheticId(1));
  });

  it("entity not found → needs_input with no candidates (not silently continued)", async () => {
    const transport = new FixtureTransport(() =>
      envelope("describe", "needs_input", { summary: "Choose the intended Qloo entity.", resolution: { issues: [{ input: "Nope", kind: "not_found" }] } }),
    );
    const outcome = await new HarnessQlooClient(transport).describe({ entity: "Nope" });
    expect(outcome.kind).toBe("needs_input");
    if (outcome.kind === "needs_input") expect(outcome.issues[0]).toMatchObject({ input: "Nope", kind: "not_found", candidates: [] });
  });

  it("ambiguous entity → needs_input carrying candidates; no automatic choice", async () => {
    const transport = new FixtureTransport(() =>
      envelope("describe", "needs_input", {
        resolution: { issues: [{ input: "Twin", kind: "ambiguous", candidates: [{ id: syntheticId(2), name: "Twin A" }, { id: syntheticId(3), name: "Twin B" }] }] },
      }),
    );
    const outcome = await new HarnessQlooClient(transport).describe({ entity: "Twin" });
    expect(outcome.kind).toBe("needs_input");
    if (outcome.kind === "needs_input") expect(outcome.issues[0]?.candidates).toHaveLength(2);
    expect(transport.calls).toHaveLength(1);
  });

  it("empty status → empty", async () => {
    const outcome = await new HarnessQlooClient(new FixtureTransport(() => envelope("describe", "empty", { summary: "nothing" }))).describe({ entity: "x" });
    expect(outcome).toMatchObject({ kind: "empty", summary: "nothing" });
  });

  it("ok with zero results on a list workflow → empty", async () => {
    const outcome = await new HarnessQlooClient(new FixtureTransport(() => envelope("find_tags", "ok", { results: [] }))).findTags({ query: "x" });
    expect(outcome.kind).toBe("empty");
  });

  it("partial → data kept, partial flag and warnings preserved", async () => {
    const transport = new FixtureTransport(() =>
      envelope("recommend", "partial", { warnings: ["one signal dropped"], interpretation: { signals: [] }, results: [compactEntity(syntheticId(4), "A")] }),
    );
    const outcome = await new HarnessQlooClient(transport).recommend({ target_type: "brand", signals: ["A"] });
    expect(outcome.kind).toBe("ok");
    expect(outcome.provenance).toMatchObject({ partial: true, warnings: ["one signal dropped"] });
  });

  it("degraded → data kept, marked degraded", async () => {
    const transport = new FixtureTransport(() => envelope("recommend", "degraded", { interpretation: { signals: [] }, results: [compactEntity(syntheticId(5), "A")] }));
    const outcome = await new HarnessQlooClient(transport).recommend({ target_type: "brand", signals: ["A"] });
    expect(outcome.kind).toBe("ok");
    expect(outcome.provenance.degraded).toBe(true);
  });

  it("non-retryable error → thrown after exactly one attempt", async () => {
    const transport = new FixtureTransport(() => failure("QLOO_CONTRACT", false));
    await expect(new HarnessQlooClient(transport).describe({ entity: "x" })).rejects.toMatchObject({ code: "QLOO_CONTRACT", attempts: 1 });
    expect(transport.calls).toHaveLength(1);
  });

  it("retryable error → retried once, then succeeds", async () => {
    let calls = 0;
    const transport = new FixtureTransport(() => (++calls === 1 ? failure("QLOO_TIMEOUT", true) : okDescribe()));
    const outcome = await new HarnessQlooClient(transport).describe({ entity: "x" });
    expect(outcome.kind).toBe("ok");
    expect(transport.calls).toHaveLength(2);
  });

  it("retryable error twice → gives up after one retry (no unbounded loop)", async () => {
    const transport = new FixtureTransport(() => failure("QLOO_RATE_LIMIT", true));
    const error = await new HarnessQlooClient(transport).describe({ entity: "x" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QlooWorkflowError);
    expect((error as QlooWorkflowError).attempts).toBe(2);
    expect(transport.calls).toHaveLength(2);
  });

  it("retryable error inside a status:error envelope is also retried once", async () => {
    const transport = new FixtureTransport(() =>
      envelope("describe", "error", { error: { code: "QLOO_UPSTREAM", layer: "qloo", retryable: true, recovery: "retry" } }),
    );
    await expect(new HarnessQlooClient(transport).describe({ entity: "x" })).rejects.toBeInstanceOf(QlooWorkflowError);
    expect(transport.calls).toHaveLength(2);
  });

  it("malformed envelope → contract error, never retried", async () => {
    const transport = new FixtureTransport(() => ({ hello: "world" }));
    await expect(new HarnessQlooClient(transport).describe({ entity: "x" })).rejects.toBeInstanceOf(QlooContractError);
    expect(transport.calls).toHaveLength(1);
  });
});

describe("missing credential (RECORDED real harness output, no network)", () => {
  it("qloo exec QLOO_AUTH failure → QlooNotConfiguredError", async () => {
    const { stdout } = recorded("exec-describe-no-credential.json");
    const transport = new FixtureTransport(() => ({ kind: "failure", exitCode: 4, failure: { ...stdout.error, correlationId: stdout.correlation_id } }));
    await expect(new HarnessQlooClient(transport).describe({ entity: "Jacquemus", type: "brand" })).rejects.toBeInstanceOf(QlooNotConfiguredError);
    expect(transport.calls).toHaveLength(1);
  });

  it("qloo mcp status:error QLOO_AUTH envelope → QlooNotConfiguredError", async () => {
    const { envelope: mcpEnvelope } = recorded("mcp-describe-no-credential.json");
    const transport = new FixtureTransport(() => mcpEnvelope);
    await expect(new HarnessQlooClient(transport).describe({ entity: "Jacquemus", type: "brand" })).rejects.toBeInstanceOf(QlooNotConfiguredError);
  });
});
