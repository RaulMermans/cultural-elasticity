import { API_SERVICE_NAME, type HealthResponse } from "@cultural-elasticity/shared";
import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async (): Promise<HealthResponse> => ({ status: "ok", service: API_SERVICE_NAME }));
}
