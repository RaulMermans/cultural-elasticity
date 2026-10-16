import type { QlooOperation } from "./types.js";

/** Base class. Messages must never contain credential material. */
export class QlooError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** No Qloo credential is available. Maps to LIVE_QLOO_VALIDATION_NOT_RUN in the feasibility report. */
export class QlooNotConfiguredError extends QlooError {
  constructor(public readonly operation: QlooOperation | "readiness") {
    super("Qloo credential is not configured (set QLOO_API_KEY in backend/.env or run `qloo setup`).");
  }
}

/** The harness returned a structured `status: "error"` envelope (or a failed exec event). */
export class QlooWorkflowError extends QlooError {
  constructor(
    public readonly operation: QlooOperation,
    public readonly code: string,
    public readonly layer: string,
    public readonly retryable: boolean,
    public readonly recovery: string,
    public readonly attempts: number,
  ) {
    super(`Qloo ${operation} failed with ${code} (${layer}, retryable=${retryable}, attempts=${attempts}). ${recovery}`);
  }
}

/** The harness output did not match the verified envelope contract. Never retried. */
export class QlooContractError extends QlooError {
  constructor(
    public readonly operation: QlooOperation,
    detail: string,
  ) {
    super(`Qloo ${operation} returned data that does not match the verified contract: ${detail}`);
  }
}

/** The harness process could not be started or exited without producing a result. */
export class QlooTransportError extends QlooError {
  constructor(
    public readonly operation: QlooOperation,
    detail: string,
    public readonly exitCode: number | null,
  ) {
    super(`Qloo transport failed for ${operation}: ${detail}`);
  }
}
