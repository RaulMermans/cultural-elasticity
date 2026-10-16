/** Agent runtime errors that reach the API boundary. Messages never contain credentials. */
import type { EvidenceIssue } from "../evidence/schema.js";

export class AgentInputError extends Error {
  constructor(readonly issues: EvidenceIssue[]) {
    super(`Invalid agent request: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
    this.name = "AgentInputError";
  }
}

export class RunNotFoundError extends Error {
  constructor(readonly runId: string) {
    super(`no agent run ${runId} in this process`);
    this.name = "RunNotFoundError";
  }
}

export class RunNotWaitingError extends Error {
  constructor(
    readonly runId: string,
    readonly status: string,
  ) {
    super(`agent run ${runId} is ${status}, not NEEDS_INPUT`);
    this.name = "RunNotWaitingError";
  }
}

/** No model or no Qloo access is configured for a live run. */
export class AgentNotConfiguredError extends Error {
  constructor(
    readonly code: "AGENT_MODEL_NOT_CONFIGURED" | "QLOO_NOT_CONFIGURED" | "QLOO_HOST_NOT_VERIFIED",
    detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = "AgentNotConfiguredError";
  }
}
