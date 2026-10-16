import "server-only";
import { isHealthResponse } from "@cultural-elasticity/shared";

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
