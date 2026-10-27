import "server-only";
import { interpretAdmissionProbe, type AdmissionView } from "./admissions";
import { backendBaseUrl, backendConfigIssues } from "./backend-url";
import { admissionForVisitor, PAID_OPERATOR_HEADER } from "./operator";
import {
  isAgentRunResponse,
  isAnalysisIngredients,
  isCulturalElasticityResult,
  isHealthResponse,
  isQueryResponse,
  type AgentRunResponse,
  type AnalysisIngredients,
  type CulturalElasticityResult,
  type QueryResponse,
} from "@cultural-elasticity/shared";

export type BackendStatus = "connected" | "unavailable";
export { backendBaseUrl };

function internalHeaders(extra?: HeadersInit, visitorId?: string, operator?: string | null): Headers {
  const headers = new Headers(extra);
  const secret = process.env.CE_INTERNAL_API_SECRET?.trim();
  if (secret) headers.set("x-ce-internal-auth", secret);
  if (visitorId) headers.set("x-ce-visitor", visitorId);
  if (operator) headers.set(PAID_OPERATOR_HEADER, operator);
  return headers;
}

export async function getBackendHealth(): Promise<BackendStatus> {
  const baseUrl = backendBaseUrl();
  if (!baseUrl) return "unavailable";
  try {
    const response = await fetch(new URL("/health", baseUrl), {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return "unavailable";
    return isHealthResponse(await response.json()) ? "connected" : "unavailable";
  } catch {
    return "unavailable";
  }
}

export type AnalysisResult =
  | { status: "ok"; ingredients: AnalysisIngredients }
  | { status: "rejected"; detail: string }
  | { status: "unavailable" };

/** Development only: sends an EvidencePacket to the backend's offline analysis endpoint. */
export async function postAnalysisIngredients(packet: unknown): Promise<AnalysisResult> {
  const baseUrl = backendBaseUrl();
  if (!baseUrl) return { status: "unavailable" };
  try {
    const response = await fetch(new URL("/api/analysis/ingredients", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(packet),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const body: unknown = await response.json();
    if (response.ok && isAnalysisIngredients(body)) return { status: "ok", ingredients: body };
    return { status: "rejected", detail: JSON.stringify(body).slice(0, 2000) };
  } catch {
    return { status: "unavailable" };
  }
}

export type MethodologyResult =
  | { status: "ok"; result: CulturalElasticityResult }
  | { status: "rejected"; detail: string }
  | { status: "unavailable" };

/** Development only: sends an assembled methodology input to the backend's deterministic methodology endpoint. */
export async function postMethodology(input: unknown): Promise<MethodologyResult> {
  const baseUrl = backendBaseUrl();
  if (!baseUrl) return { status: "unavailable" };
  try {
    const response = await fetch(new URL("/api/methodology/analyze", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const body: unknown = await response.json();
    if (response.ok && isCulturalElasticityResult(body)) return { status: "ok", result: body };
    return { status: "rejected", detail: JSON.stringify(body).slice(0, 2000) };
  } catch {
    return { status: "unavailable" };
  }
}

export type AgentResponse = { status: "ok"; response: AgentRunResponse } | { status: "rejected"; detail: string } | { status: "unavailable" };

/**
 * Development only: runs (or continues) an agent investigation through the backend. A live run makes
 * spaced Qloo calls and can take several minutes, hence the long timeout.
 */
export async function postAgent(path: "/api/agent/analyze" | "/api/agent/continue", body: unknown): Promise<AgentResponse> {
  const baseUrl = backendBaseUrl();
  if (!baseUrl) return { status: "unavailable" };
  try {
    const response = await fetch(new URL(path, baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15 * 60_000),
    });
    const json: unknown = await response.json();
    if (response.ok && isAgentRunResponse(json)) return { status: "ok", response: json };
    return { status: "rejected", detail: JSON.stringify(json).slice(0, 2000) };
  } catch {
    return { status: "unavailable" };
  }
}

export type QueryResult = { status: "ok"; response: QueryResponse } | { status: "rejected"; detail: string } | { status: "unavailable" };

/**
 * Sprint 5B.1: the natural-language query layer. /interpret is a dry run (no Qloo call); /query starts a new
 * investigation; /follow-up starts a new linked child run from an existing one. The backend validates every run id.
 */
export async function postQuery(path: "/api/agent/interpret" | "/api/agent/query" | "/api/agent/follow-up", body: unknown): Promise<QueryResult> {
  const baseUrl = backendBaseUrl();
  if (!baseUrl) return { status: "unavailable" };
  try {
    const response = await fetch(new URL(path, baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(path === "/api/agent/interpret" ? 60_000 : 15 * 60_000),
    });
    const json: unknown = await response.json();
    if (response.ok && isQueryResponse(json)) return { status: "ok", response: json };
    return { status: "rejected", detail: JSON.stringify(json).slice(0, 2000) };
  } catch {
    return { status: "unavailable" };
  }
}

/** `operator` is forwarded only by the paid-start callers below; Railway verifies it independently. */
async function backendFetch(path: string, init: RequestInit, timeoutMs: number, visitorId?: string, operator?: string | null): Promise<{ status: number; body: unknown } | null> {
  const baseUrl = backendBaseUrl();
  if (!baseUrl) return null;
  try {
    const response = await fetch(new URL(path, baseUrl), {
      ...init,
      headers: internalHeaders(init.headers, visitorId, operator),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body: unknown = await response.json().catch(() => null);
    return { status: response.status, body };
  } catch {
    return null;
  }
}

/** Server-only brand baseline proxy. The browser supplies only an opaque scan token, never the internal secret. */
export async function brandBaselineFetch(path: string, init: RequestInit = {}, visitorId?: string, operator?: string | null): Promise<{ status: number; body: unknown } | null> {
  if (!/^\/api\/brands\/(?:status|resolve|baselines(?:\/[0-9a-f-]{36}(?:\/(?:territories|evidence))?)?)$/u.test(path)) return null;
  // Resolution and a new scan dispatch Qloo calls; reads never carry the operator credential.
  const paid = init.method === "POST" && (path === "/api/brands/resolve" || path === "/api/brands/baselines");
  return backendFetch(path, init, 15_000, visitorId, paid ? operator : null);
}

export type AdmissionProbe = AdmissionView;

/**
 * Admission only. Proxies `/ready` (and `/health` if needed) and returns a public
 * view with no boot id, credential flags, or spend figures. This is not a paid
 * provider call. A reachable service that is not accepting is paused, never disconnected.
 */
export async function getAdmissionStatus(operatorPresent = false): Promise<AdmissionProbe> {
  if (backendConfigIssues().length > 0) return { status: "unavailable" };
  const ready = await backendFetch("/ready", {}, 2500);
  const readyBody = ready && isRecord(ready.body) ? ready.body : null;
  const dependencies = isRecord(readyBody?.dependencies) ? readyBody.dependencies : null;
  // An older backend without the field is treated as requiring the operator: fail closed.
  const operatorRequired = dependencies?.paidOperatorRequired !== false;
  if (readyBody?.acceptingInvestigations === true) return admissionForVisitor({ status: "accepting" }, { operatorRequired, operatorPresent });
  if (readyBody?.acceptingInvestigations === false) return { status: "paused" };
  const health = ready ? null : await backendFetch("/health", {}, 2000);
  return interpretAdmissionProbe({ ready, health });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Product path. The browser never calls the investigation API directly. */
export async function createJob(body: unknown, visitorId?: string, operator?: string | null): Promise<{ status: number; body: unknown } | null> {
  return backendFetch("/api/agent/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, 15_000, visitorId, operator);
}

export async function baselineHandoff(mode: "preview" | "jobs", body: unknown, token: string, visitorId?: string, operator?: string | null): Promise<{ status: number; body: unknown } | null> {
  return backendFetch(`/api/agent/handoff/${mode}`, { method: "POST", headers: { "content-type": "application/json", "x-baseline-token": token }, body: JSON.stringify(body) }, 15_000, visitorId, mode === "jobs" ? operator : null);
}

/** Sprint 9I comparative handoff. The browser sends identifiers and its two tokens; evidence stays on the server. */
export async function comparativeHandoff(mode: "options" | "preview" | "jobs", body: unknown, scanToken: string, jobToken: string, visitorId?: string, operator?: string | null): Promise<{ status: number; body: unknown } | null> {
  return backendFetch(`/api/agent/handoff/compare/${mode}`, { method: "POST", headers: { "content-type": "application/json", "x-baseline-token": scanToken, "x-job-token": jobToken }, body: JSON.stringify(body) }, 15_000, visitorId, mode === "jobs" ? operator : null);
}

export async function comparativeReport(id: string, jobToken: string, visitorId?: string): Promise<{ status: number; body: unknown } | null> {
  return backendFetch(`/api/agent/handoff/compare/${encodeURIComponent(id)}/report`, { headers: { "x-job-token": jobToken } }, 10_000, visitorId);
}

export async function readJob(id: string, token: string, visitorId?: string): Promise<{ status: number; body: unknown } | null> {
  return backendFetch(`/api/agent/jobs/${encodeURIComponent(id)}`, { headers: { "x-job-token": token } }, 10_000, visitorId);
}

export async function cancelJob(id: string, token: string, visitorId?: string): Promise<{ status: number; body: unknown } | null> {
  return backendFetch(`/api/agent/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST", headers: { "x-job-token": token } }, 10_000, visitorId);
}
