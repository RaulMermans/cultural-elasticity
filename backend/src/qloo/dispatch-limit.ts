import { QlooTransportError } from "./errors.js";
import type { QlooOperation } from "./types.js";
import type { QlooTransport, TransportResult } from "./transport.js";

/**
 * Sprint 9J: one process-wide ceiling on upstream Qloo attempts for a bounded operator run, across every
 * phase (baseline scans and agent runs). A unit is taken before the attempt leaves the process, so retries
 * and attempts with an uncertain outcome are counted; nothing is returned on failure. Unset means no extra
 * ceiling beyond each run's own budget.
 */
export class QlooDispatchCounter {
  private usedCalls = 0;
  constructor(readonly limit: number) {}

  take(): boolean {
    if (this.usedCalls >= this.limit) return false;
    this.usedCalls += 1;
    return true;
  }

  snapshot(): { limit: number; used: number; remaining: number } {
    return { limit: this.limit, used: this.usedCalls, remaining: Math.max(0, this.limit - this.usedCalls) };
  }
}

let shared: QlooDispatchCounter | null | undefined;

/** The process counter from `CE_PROCESS_QLOO_CALL_LIMIT`. An invalid value refuses every dispatch. */
export function processDispatchCounter(env: NodeJS.ProcessEnv = process.env): QlooDispatchCounter | null {
  if (shared !== undefined) return shared;
  const raw = env.CE_PROCESS_QLOO_CALL_LIMIT?.trim();
  if (!raw) return (shared = null);
  const limit = Number(raw);
  shared = new QlooDispatchCounter(Number.isInteger(limit) && limit >= 0 ? limit : 0);
  return shared;
}

export function resetProcessDispatchCounter(): void {
  shared = undefined;
}

export class DispatchLimitedTransport implements QlooTransport {
  readonly name: string;
  constructor(
    private readonly inner: QlooTransport,
    private readonly counter: QlooDispatchCounter,
  ) {
    this.name = inner.name;
  }

  async execute(operation: QlooOperation, input: unknown): Promise<TransportResult> {
    if (!this.counter.take()) throw new QlooTransportError(operation, "PROCESS_QLOO_CALL_LIMIT_REACHED: the run-wide Qloo call ceiling is spent; nothing was sent", null);
    return this.inner.execute(operation, input);
  }

  close(): void {
    (this.inner as { close?: () => void }).close?.();
  }
}

/** Wraps a transport with the process counter when one is configured. */
export function withProcessDispatchLimit(transport: QlooTransport, env: NodeJS.ProcessEnv = process.env): QlooTransport {
  const counter = processDispatchCounter(env);
  return counter ? new DispatchLimitedTransport(transport, counter) : transport;
}
