import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("GET /health", () => {
  const app = buildApp({ logLevel: "silent" });
  afterAll(() => app.close());

  it("reports the service as ok", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", service: "cultural-elasticity-api" });
  });

  it("returns 404 for unknown routes", async () => {
    const response = await app.inject({ method: "GET", url: "/nope" });
    expect(response.statusCode).toBe(404);
  });
});
