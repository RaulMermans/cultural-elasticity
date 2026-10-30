/**
 * Sprint 10C process-interruption harness: one backend worker process with durable agent jobs.
 *
 * Provider mode (CE_DURABLE_PROVIDER):
 *   synthetic (default)  SYNTHETIC world (evals/fixtures/synthetic/agent/world.json) + the deterministic baseline
 *                        reference policy + the structural interpreter. No provider call, no credential.
 *   live                 the production wiring (real Qloo + Haiku, journaled). Only for an owner-approved live run.
 *
 * Test-only controls (ignored on a public runtime):
 *   CE_DURABLE_FAULT_INJECTION=1 CE_DURABLE_FAULT=<point>:<nth>   stop at a fault point (durable/scope.ts)
 *   CE_DURABLE_DISPATCH_LOG=<file>   append one line per Qloo attempt that actually reached the transport (oracle)
 *   CE_SYNTHETIC_DELAY_MS=<ms>       delay each synthetic Qloo answer (gives a lease test time to pause the worker)
 */
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildApp } from "../../src/app.js";
import { durableAgentFromEnv } from "../../src/api/agent.js";
import { RunStore } from "../../src/agent/run-store.js";
import { AgentRuntime } from "../../src/agent/runtime.js";
import { BaselinePolicyModel } from "../../src/agent/model/baseline.js";
import { StructuralQueryInterpreter } from "../../src/agent/query/interpreter.js";
import { JournaledInterpreter, JournaledModel, JournaledToolProvider } from "../../src/agent/durable/decorators.js";
import type { AgentToolProvider, CallOptions } from "../../src/agent/tool-provider.js";
import type { QlooOperation, QlooOperationInput } from "../../src/qloo/types.js";
import { createScriptedToolProvider, syntheticWorldSchema } from "../synthetic/synthetic-world.js";

const durable = durableAgentFromEnv();
if (!durable) throw new Error("WORKER_NEEDS_CE_DURABLE_AGENT_AND_DATABASE_URL");
const runStore = new RunStore();
const mode = process.env.CE_DURABLE_PROVIDER === "live" ? "live" : "synthetic";

/** Records attempts that reached the transport (after the journal's dispatch mark), plus an optional delay. */
class OracleProvider implements AgentToolProvider {
  readonly name: string;
  readonly mode: "live" | "scripted";
  readonly evidenceSource: string;
  constructor(private readonly inner: AgentToolProvider, private readonly log: string | undefined, private readonly delayMs: number) {
    this.name = inner.name;
    this.mode = inner.mode;
    this.evidenceSource = inner.evidenceSource;
  }
  async call<O extends QlooOperation>(operation: O, input: QlooOperationInput[O], options: CallOptions = {}) {
    return this.inner.call(operation, input, {
      ...options,
      onDispatch: async () => {
        await options.onDispatch?.();
        if (this.log) appendFileSync(this.log, `${JSON.stringify({ pid: process.pid, operation, input })}\n`);
        if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      },
    });
  }
}

let options: Parameters<typeof buildApp>[0];
if (mode === "synthetic") {
  const worldPath = fileURLToPath(new URL("../../../evals/fixtures/synthetic/agent/world.json", import.meta.url));
  const world = syntheticWorldSchema.parse(JSON.parse(readFileSync(worldPath, "utf8")));
  const provider = new JournaledToolProvider(new OracleProvider(createScriptedToolProvider(world), process.env.CE_DURABLE_DISPATCH_LOG, Number(process.env.CE_SYNTHETIC_DELAY_MS ?? 0)));
  const runtime = new AgentRuntime({ model: new JournaledModel(new BaselinePolicyModel()), provider, store: runStore });
  const interpreter = new JournaledInterpreter(new StructuralQueryInterpreter());
  options = { logLevel: process.env.CE_WORKER_LOG_LEVEL ?? "info", agentRuntimeFactory: () => runtime, queryInterpreterFactory: () => interpreter, durableAgent: durable, runStore };
} else {
  options = { logLevel: "info", durableAgent: durable, runStore };
}

const app = buildApp(options);
const port = Number(process.env.PORT ?? 4310);
const stop = async () => {
  await app.close().catch(() => undefined);
  process.exit(0);
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
await app.listen({ port, host: "127.0.0.1" });
process.stderr.write(`CE_WORKER_READY ${port} ${mode}\n`);
