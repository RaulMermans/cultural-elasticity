// Contracts shared across the frontend/backend boundary.
// Keep this package free of runtime dependencies and of anything Qloo-specific:
// Qloo evidence contracts live in the backend. Provider-independent analysis output types live in
// ./analysis.ts because the frontend consumes them.

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

export * from "./analysis.js";
export * from "./methodology.js";
export * from "./agent.js";
export * from "./query.js";
export * from "./query-validate.js";
export * from "./brand-baseline.js";
export * from "./connections.js";
export * from "./decision-card.js";
export * from "./evidence-assessment.js";
export * from "./opportunity.js";
