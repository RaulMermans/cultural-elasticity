import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { analyzeEvidencePacket } from "../src/analysis/ingredients.js";
import { packet } from "./fixtures/synthetic/evidence.js";

describe("POST /api/analysis/ingredients", () => {
  const app = buildApp({ logLevel: "silent" });
  afterAll(() => app.close());

  it("returns AnalysisIngredients for a valid packet, identical to the engine", async () => {
    const input = packet();
    const response = await app.inject({ method: "POST", url: "/api/analysis/ingredients", payload: input });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(JSON.parse(JSON.stringify(analyzeEvidencePacket(input))));
  });

  it("works offline on a committed synthetic fixture", async () => {
    const fixture = JSON.parse(readFileSync(new URL("../../evals/fixtures/synthetic/case-h-cross-call-ranking.json", import.meta.url), "utf8")) as { packet: unknown };
    const response = await app.inject({ method: "POST", url: "/api/analysis/ingredients", payload: fixture.packet as object });
    expect(response.statusCode).toBe(200);
    expect(response.json().ranking.status).toBe("not_comparable");
  });

  it("rejects an invalid packet with 400 and validation issues", async () => {
    const response = await app.inject({ method: "POST", url: "/api/analysis/ingredients", payload: { ...packet(), origin: "made-up" } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "invalid_evidence_packet", issues: [{ path: "origin" }] });
  });

  it("rejects a missing or non-JSON body", async () => {
    const empty = await app.inject({ method: "POST", url: "/api/analysis/ingredients" });
    expect(empty.statusCode).toBe(400);
    const text = await app.inject({ method: "POST", url: "/api/analysis/ingredients", headers: { "content-type": "application/json" }, payload: "{oops" });
    expect(text.statusCode).toBe(400);
  });

  it("does not expose transport or credential details", async () => {
    const response = await app.inject({ method: "POST", url: "/api/analysis/ingredients", payload: packet() });
    expect(response.body).not.toMatch(/QLOO|api[_-]?key|harness/i);
  });
});
