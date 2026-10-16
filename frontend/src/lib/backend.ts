import "server-only";
import {
  isAgentRunResponse,
  isAnalysisIngredients,
  isCulturalElasticityResult,
  isHealthResponse,
  type AgentRunResponse,
  type AnalysisIngredients,
  type CulturalElasticityResult,
} from "@cultural-elasticity/shared";

export type BackendStatus = "connected" | "unavailable";

const DEFAULT_BACKEND_URL = "http://127.0.0.1:4000";

export async function getBackendHealth(): Promise<BackendStatus> {
  const baseUrl = process.env.BACKEND_URL ?? DEFAULT_BACKEND_URL;
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
  const baseUrl = process.env.BACKEND_URL ?? DEFAULT_BACKEND_URL;
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
  const baseUrl = process.env.BACKEND_URL ?? DEFAULT_BACKEND_URL;
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
  const baseUrl = process.env.BACKEND_URL ?? DEFAULT_BACKEND_URL;
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
