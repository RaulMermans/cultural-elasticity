/** Methodology contracts, provenance, the dev API and the layer's import boundary. SYNTHETIC inputs. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ELASTICITY_RESULT_SCHEMA_VERSION, isCulturalElasticityResult } from "@cultural-elasticity/shared";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hasCorrelation } from "../src/evidence/provenance.js";
import { METHODOLOGY_VERSION } from "../src/methodology/config.js";
import { MethodologyInputError } from "../src/methodology/contracts.js";
import { analyzeElasticity } from "../src/methodology/elasticity.js";
import { clone, synInput } from "./fixtures/synthetic/methodology.js";

describe("CulturalElasticityResult contract", () => {
  const result = analyzeElasticity(synInput());

  it("carries versions, origin, the brand and an explicit comparison set", () => {
    expect(result.schemaVersion).toBe(ELASTICITY_RESULT_SCHEMA_VERSION);
    expect(result.methodologyVersion).toBe(METHODOLOGY_VERSION);
    expect(result.evidenceOrigin).toBe("synthetic");
    expect(result.brand.id).toBe("syn-brand");
    expect(result.comparisonSet.territories.map((t) => t.id)).toEqual(["t1", "t2", "t3", "t4"]);
    expect(result.comparisonSet.panels).toEqual(["A", "B"]);
    expect(isCulturalElasticityResult(result)).toBe(true);
  });

  it("keeps the four dimensions separate for every territory", () => {
    for (const t of result.territories) {
      expect(t.relativePosition.semantics).toBe("relative_candidate_position");
      expect(t.robustness.level).toBeDefined();
      expect(t.coherenceRaw.view).toBe("RAW");
      expect(t.coherenceFiltered.view).toBe("CULTURAL_FILTERED");
      expect(t.evidenceQuality.level).toBeDefined();
      expect(t.classification.status).toBe("PROVISIONAL");
    }
  });

  it("states what is not measured", () => {
    expect(result.semantics.notMeasured.join(" ")).toMatch(/commercial success/);
    expect(result.semantics.notMeasured.join(" ")).toMatch(/purchase intent/);
    expect(result.semantics.notMeasured.join(" ")).toMatch(/individual's preference/);
  });

  it("has no field named confidence anywhere", () => {
    expect(JSON.stringify(result)).not.toMatch(/"[^"]*confidence[^"]*":/i);
  });

  it("returns a reconstructable trace", () => {
    expect(result.trace.steps.map((s) => s.step)).toEqual(["brand", "territory_representations", "panel_calls", "aggregation", "robustness", "tag_filtering", "overlap", "classification", "index"]);
    for (const a of result.trace.aggregation) expect(a.percentiles.length).toBe(result.territories.find((t) => t.territory.id === a.territoryId)!.panelEvidence.length);
    expect(JSON.stringify(result.trace)).not.toMatch(/"raw"\s*:|x-api-key/i);
  });
});

describe("provenance", () => {
  const result = analyzeElasticity(synInput());

  it("keeps a correlation id on every panel observation and every territory", () => {
    for (const t of result.territories) {
      expect(t.panelEvidence.every((o) => o.correlationId.startsWith("syn-corr-panel-"))).toBe(true);
      expect(hasCorrelation(t.provenance)).toBe(true);
      expect(t.provenance.some((p) => p.correlationId === "syn-corr-conditioned-" + t.territory.id)).toBe(true);
    }
    expect(hasCorrelation(result.provenance)).toBe(true);
  });

  it("panel values are labelled within-call, keyed to their own panel", () => {
    for (const p of result.panels) for (const o of p.order) expect(typeof o.withinCallValue === "number" || o.withinCallValue === null).toBe(true);
  });
});

describe("input validation", () => {
  it("throws MethodologyInputError with paths", () => {
    const input = clone(synInput());
    input.tagTake = 1;
    try {
      analyzeElasticity(input);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MethodologyInputError);
      expect((error as MethodologyInputError).issues[0]!.path).toBe("brand.signals");
    }
  });

  it("rejects conditioned evidence for an unknown concept or another subject", () => {
    const input = clone(synInput());
    input.conditioned[0]!.territory.id = "syn-unknown";
    expect(() => analyzeElasticity(input)).toThrow(/not the concept of any territory/);
    const other = clone(synInput());
    other.conditioned[0]!.conditionedOn.id = "syn-other";
    expect(() => analyzeElasticity(other)).toThrow(/conditioned on the brand/);
  });
});

describe("POST /api/methodology/analyze", () => {
  it("returns the result for valid input and 400 with issues for invalid input", async () => {
    const app = buildApp({ logLevel: "silent" });
    const ok = await app.inject({ method: "POST", url: "/api/methodology/analyze", payload: synInput() });
    expect(ok.statusCode).toBe(200);
    expect(isCulturalElasticityResult(ok.json())).toBe(true);
    const bad = await app.inject({ method: "POST", url: "/api/methodology/analyze", payload: { schemaVersion: "nope" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("invalid_methodology_input");
    await app.close();
  });

  it("is deterministic across requests", async () => {
    const app = buildApp({ logLevel: "silent" });
    const a = await app.inject({ method: "POST", url: "/api/methodology/analyze", payload: synInput() });
    const b = await app.inject({ method: "POST", url: "/api/methodology/analyze", payload: synInput() });
    expect(a.body).toBe(b.body);
    await app.close();
  });
});

describe("layer boundary", () => {
  it("the methodology imports no LLM, agent, frontend, Fastify, MCP, network or child_process code", () => {
    const dir = fileURLToPath(new URL("../src/methodology/", import.meta.url));
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const source = readFileSync(join(dir, file), "utf8");
      const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
      for (const spec of imports) {
        expect(spec, `${file} imports ${spec}`).not.toMatch(/child_process|fastify|mcp|anthropic|openai|llm|agent|frontend|qloo|transport|node:http|node:net|feasibility|capture/i);
      }
    }
  });
});
