// Contracts shared across the frontend/backend boundary.
// Keep this package free of runtime dependencies and of anything Qloo-specific:
// Qloo evidence contracts live in the backend until a frontend consumer exists.

export const API_SERVICE_NAME = "cultural-elasticity-api" as const;

export type HealthResponse = {
  status: "ok";
  service: typeof API_SERVICE_NAME;
};

export function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.status === "ok" && record.service === API_SERVICE_NAME;
}
