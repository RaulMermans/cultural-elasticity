/**
 * Isolated Vercel Workflow semantics proof. This is NOT the Vercel compiler and NOT a production runtime.
 *
 * It models: named steps, checkpointed results, default retries, replay without re-execution, and
 * unsafe retry of an external call that started but did not commit. Hosted `"use workflow"` compilation
 * is WORKFLOW_COMPILATION_PASS only for this local semantic equivalent.
 */
export type StepStatus = "started" | "completed" | "failed" | "uncertain";

export type StepRecord<T = unknown> = {
  operationId: string;
  status: StepStatus;
  attempts: number;
  result?: T;
  error?: string;
  charged: boolean;
  external: boolean;
  committed: boolean;
};

export type StepOptions = {
  operationId: string;
  external?: boolean;
  maxRetries?: number;
  retryable?: boolean;
};

export class UnsafeRetryError extends Error {
  constructor(readonly operationId: string) {
    super(`retrying ${operationId} is unsafe: the provider call may have happened without a committed result`);
    this.name = "UnsafeRetryError";
  }
}

export class DurableWorkflow {
  readonly log: StepRecord[] = [];
  constructor(private readonly existing: StepRecord[] = []) {
    this.log = existing.map((s) => ({ ...s }));
  }

  record(id: string): StepRecord | undefined {
    return [...this.log].reverse().find((s) => s.operationId === id);
  }

  /**
   * Exactly-once is not claimed. Completed steps replay from the log. An external step left `started`
   * is `uncertain` and must not be retried automatically.
   */
  async step<T>(options: StepOptions, fn: () => Promise<T>): Promise<T> {
    const prior = this.record(options.operationId);
    if (prior?.status === "completed" && prior.committed) return prior.result as T;
    if (prior?.status === "uncertain" || (prior?.status === "started" && prior.external)) {
      throw new UnsafeRetryError(options.operationId);
    }
    const maxRetries = options.maxRetries ?? 3;
    const retryable = options.retryable ?? true;
    const external = options.external ?? false;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      const rec: StepRecord = { operationId: options.operationId, status: "started", attempts: attempt, charged: false, external, committed: false };
      this.log.push(rec);
      try {
        const result = await fn();
        rec.status = "completed";
        rec.result = result;
        rec.charged = external;
        rec.committed = true;
        return result;
      } catch (error) {
        lastError = error;
        rec.status = external ? "uncertain" : "failed";
        rec.error = error instanceof Error ? error.message : String(error);
        rec.charged = external;
        if (!retryable || attempt > maxRetries || external) {
          if (external) throw new UnsafeRetryError(options.operationId);
          throw error;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  replay<T>(operationId: string): T {
    const rec = this.record(operationId);
    if (!rec || rec.status !== "completed" || !rec.committed) throw new Error(`no committed result for ${operationId}`);
    return rec.result as T;
  }
}

export const DURABLE_STATE_REQUIREMENTS = [
  { kind: "RUN_STATE", durable: true, reason: "phase, limits, usage, status must resume after a freeze" },
  { kind: "SHORT_TERM_WORKING_MEMORY", durable: true, reason: "current evidence and decision context are the investigation" },
  { kind: "INVESTIGATION_LINEAGE", durable: true, reason: "parent/child links cannot be reconstructed from the browser" },
  { kind: "CHECKPOINTS", durable: true, reason: "valid recovery points after a step completes" },
  { kind: "ARTIFACTS", durable: true, reason: "evidence packets and final reports outlive the process" },
  { kind: "LOGS", durable: true, reason: "traces and operational metrics for audit" },
  { kind: "SPEND_STATE", durable: true, reason: "reservations and observed usage are financial authority; in-memory is not" },
] as const;

export type InvestigationStep =
  | "structured_query"
  | "deterministic_validation"
  | "mocked_agent_decision"
  | "mocked_qloo_tool_call"
  | "persist_step_result"
  | "simulated_retry"
  | "resumption"
  | "final_structured_result";

export async function runSyntheticInvestigation(workflow = new DurableWorkflow()): Promise<{ ok: true; steps: InvestigationStep[]; result: { status: string; findings: number } }> {
  const query = await workflow.step({ operationId: "structured_query" }, async () => ({ brand: "SYN-BRAND", intent: "analyze_move" }));
  const valid = await workflow.step({ operationId: "deterministic_validation" }, async () => (query.brand.startsWith("SYN-") ? { ok: true as const } : { ok: false as const }));
  if (!valid.ok) throw new Error("validation failed");
  await workflow.step({ operationId: "mocked_agent_decision" }, async () => ({ action: "call_tool", tool: "qloo_find_tags" }));
  await workflow.step({ operationId: "mocked_qloo_tool_call", external: true, retryable: false }, async () => ({ tags: 1, correlationId: "syn-corr-1" }));
  await workflow.step({ operationId: "persist_step_result" }, async (): Promise<{ stored: boolean }> => ({ stored: true }));
  const retried = await workflow.step({ operationId: "persist_step_result" }, async (): Promise<{ stored: boolean }> => {
    throw new Error("should not re-execute a committed step");
  });
  if (!retried.stored) throw new Error("replay lost the persisted result");
  await workflow.step({ operationId: "simulated_retry" }, async () => ({ recovered: true }));
  await workflow.step({ operationId: "resumption" }, async () => ({ continued: true }));
  const result = await workflow.step({ operationId: "final_structured_result" }, async () => ({ status: "COMPLETE", findings: 1 }));
  return {
    ok: true,
    steps: ["structured_query", "deterministic_validation", "mocked_agent_decision", "mocked_qloo_tool_call", "persist_step_result", "simulated_retry", "resumption", "final_structured_result"],
    result,
  };
}
