import { parseQueryResponse, type QueryResponse } from "@cultural-elasticity/shared";

const STATUSES = new Set(["queued", "running", "completed", "failed", "cancelled", "expired"]);
const STAGES = new Set(["queued", "interpreting", "investigating", "preparing", "done"]);

export type JobEnvelope = {
  jobId: string;
  accessToken?: string;
  status: string;
  stage: string;
  stageLabel: string;
  stopping: boolean;
  response: QueryResponse | null;
  error: { code: string; message: string } | null;
};

export function parseJobEnvelope(value: unknown): { ok: true; job: JobEnvelope } | { ok: false } {
  if (!isRecord(value)) return { ok: false };
  if (typeof value.jobId !== "string" || typeof value.status !== "string" || !STATUSES.has(value.status)) return { ok: false };
  if (typeof value.stage !== "string" || !STAGES.has(value.stage) || typeof value.stageLabel !== "string" || typeof value.stopping !== "boolean") return { ok: false };
  if (value.accessToken !== undefined && typeof value.accessToken !== "string") return { ok: false };
  let response: QueryResponse | null = null;
  if (value.response !== null) {
    const parsed = parseQueryResponse(value.response);
    if (!parsed.ok) return { ok: false };
    response = parsed.response;
  }
  if (value.error !== null && !isMessage(value.error)) return { ok: false };
  return {
    ok: true,
    job: {
      jobId: value.jobId,
      ...(typeof value.accessToken === "string" ? { accessToken: value.accessToken } : {}),
      status: value.status,
      stage: value.stage,
      stageLabel: value.stageLabel,
      stopping: value.stopping,
      response,
      error: value.error === null ? null : (value.error as { code: string; message: string }),
    },
  };
}

export function publicFailure(status: number, body: unknown): string {
  if (isMessage(body) && body.message.length > 0 && body.message.length < 240 && !body.message.includes("\n")) return body.message;
  if (status === 429) return "An investigation is already running. You can start another when it finishes.";
  if (status === 409) return "That confirmation was already used.";
  if (status === 401) return "The investigation service is not available from that origin.";
  if (status === 404) return "This investigation is no longer available. You can start a new one.";
  if (status === 503) return "The investigation service is not available right now.";
  return "The investigation could not be started.";
}

function isMessage(value: unknown): value is { code: string; message: string } {
  return isRecord(value) && typeof value.message === "string" && (typeof value.code === "string" || typeof value.error === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
