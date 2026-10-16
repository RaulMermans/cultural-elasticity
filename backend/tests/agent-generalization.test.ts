/**
 * Generalization gates G1–G5 and benchmark isolation.
 *   G1  production backend code never imports evals/benchmarks (or the benchmark capture configs)
 *   G2  no benchmark brand / territory / exemplar in runtime source (comments stripped; one documented
 *       calibration-provenance string allowed)
 *   G3  an unseen brand runs end to end with no code change
 *   G4  an unseen territory is resolved dynamically, or transparently rejected
 *   G5  cases legitimately follow different analysis routes under the same policy
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentAnalysisResult } from "@cultural-elasticity/shared";
import { describe, expect, it } from "vitest";
import { ELASTICITY_CAPTURE } from "../src/capture/elasticity-config.js";
import { AGENT_SYSTEM_PROMPT, SYNTHESIS_SYSTEM_PROMPT } from "../src/agent/prompts.js";
import { AGENT_TOOLS } from "../src/agent/tool-registry.js";
import { runtime } from "./fixtures/synthetic/agent.js";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BENCHMARK = JSON.parse(readFileSync(join(ROOT, "evals/benchmarks/cultural-elasticity-v0/benchmark.json"), "utf8")) as { brands: { key: string; label: string }[]; territorySet: string[] };

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });
}

/** Relative-import graph reachable from an entry file. */
function reachable(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const text = readFileSync(entry, "utf8");
  for (const m of text.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/gu)) {
    const spec = (m[1] ?? m[2])!.replace(/\.js$/u, ".ts");
    const target = resolve(dirname(entry), spec);
    try {
      if (statSync(target).isFile()) reachable(target, seen);
    } catch {
      /* non-ts import */
    }
  }
  return seen;
}

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:])\/\/.*$/gmu, "$1");

/** Every benchmark brand, territory (id and label) and exemplar name. */
function benchmarkNames(): string[] {
  const names = new Set<string>();
  for (const b of BENCHMARK.brands) names.add(b.label);
  for (const t of ELASTICITY_CAPTURE.territories) {
    names.add(t.label);
    names.add(t.id);
    for (const e of t.exemplars) names.add(e.label);
  }
  for (const id of BENCHMARK.territorySet) names.add(id);
  return [...names].filter((n) => n.length >= 3);
}

const RUNTIME_ENTRIES = [join(SRC, "index.ts"), join(SRC, "agent/index.ts")];

describe("G1 benchmark isolation (imports)", () => {
  it("no production module reachable from the API or the agent imports benchmark or capture data", () => {
    const graph = new Set<string>();
    for (const entry of RUNTIME_ENTRIES) for (const f of reachable(entry)) graph.add(f);
    const rel = [...graph].map((f) => relative(SRC, f));
    expect(rel.some((f) => f.startsWith("capture/") || f.startsWith("feasibility/"))).toBe(false);
    for (const f of graph) {
      const text = readFileSync(f, "utf8");
      expect(text, relative(SRC, f)).not.toMatch(/evals\/benchmarks|benchmark\.json|cultural-elasticity-v0/u);
    }
  });

  it("no source file anywhere in src loads benchmark data, and runtime code never references benchmark labels", () => {
    // methodology/benchmark.ts defines the label SCHEMA used by eval scripts; it loads nothing and is unreachable from runtime entries.
    for (const f of files(SRC)) expect(stripComments(readFileSync(f, "utf8")), relative(SRC, f)).not.toMatch(/evals\/benchmarks|benchmark\.json/u);
    const graph = new Set<string>();
    for (const entry of RUNTIME_ENTRIES) for (const f of reachable(entry)) graph.add(f);
    for (const f of graph) expect(readFileSync(f, "utf8"), relative(SRC, f)).not.toMatch(/expected_(strong|mid|weak)/u);
    expect([...graph].map((f) => relative(SRC, f))).not.toContain("methodology/benchmark.ts");
  });
});

describe("G2 no benchmark-specific runtime logic", () => {
  const names = benchmarkNames();
  const pattern = new RegExp(`(^|[^a-z0-9])(${names.map((n) => n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/[_ ]/gu, "[_ ]")).join("|")})([^a-z0-9]|$)`, "iu");
  const ALLOWED = [{ file: "methodology/config.ts", line: /basis:/u }]; // calibration provenance text, emitted as metadata

  it("the agent runtime contains no benchmark name, even in comments", () => {
    for (const f of files(join(SRC, "agent"))) expect(readFileSync(f, "utf8"), relative(SRC, f)).not.toMatch(pattern);
  });

  it("runtime code (comments stripped) reachable from the API and agent contains no benchmark name", () => {
    const graph = new Set<string>();
    for (const entry of RUNTIME_ENTRIES) for (const f of reachable(entry)) graph.add(f);
    const offenders: string[] = [];
    for (const f of graph) {
      const rel = relative(SRC, f);
      stripComments(readFileSync(f, "utf8"))
        .split("\n")
        .forEach((line, i) => {
          if (pattern.test(line) && !ALLOWED.some((a) => rel === a.file && a.line.test(line))) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 80)}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("prompts and tool descriptions name no benchmark brand, territory or exemplar", () => {
    const text = [AGENT_SYSTEM_PROMPT, SYNTHESIS_SYSTEM_PROMPT, ...AGENT_TOOLS.map((t) => t.description)].join("\n");
    expect(text).not.toMatch(pattern);
  });
});

describe("G3/G4/G5 generalization (synthetic world, baseline reference policy)", () => {
  const run = async (brand: string, territories: string[]) => (await runtime().runtime.run({ userQuery: `${brand}: ${territories.join(", ") || "frontier"}`, brand, territories })) as AgentAnalysisResult;

  it("G3: brands absent from the benchmark resolve and analyze with no code change", async () => {
    for (const brand of ["Saffron & Salt", "Lumen Play", "Kestrel Outfitters"]) {
      expect(BENCHMARK.brands.some((b) => b.label === brand)).toBe(false);
      const r = await run(brand, brand === "Kestrel Outfitters" ? [] : ["Skincare"]);
      expect(r.status, brand).toBe("COMPLETE");
      expect(r.brand?.label).toBe(brand);
      expect(r.territories.length).toBeGreaterThan(0);
      expect(r.territories.some((t) => t.analysisRoute !== "INSUFFICIENT_EVIDENCE"), brand).toBe(true);
    }
  });

  it("G4: unseen territories are resolved dynamically or transparently rejected", async () => {
    const r = await run("Lumen Play", ["Esports", "Moonlight Rituals", "Quantum Gastronomy"]);
    const by = Object.fromEntries(r.territories.map((t) => [t.key, t]));
    expect(by.esports!.resolvedConcept?.id).toBe("urn:tag:interests:syn:esports");
    expect(by.esports!.representation.exemplars).toHaveLength(1); // Qloo has only one brand: robustness cannot be tested
    expect(by.moonlight_rituals!.representation.strategy).toBe("DESCRIPTIVE_ONLY");
    expect(by.moonlight_rituals!.analysisRoute).toBe("INSUFFICIENT_EVIDENCE");
    expect(by.quantum_gastronomy!.representation).toMatchObject({ strategy: "UNSUPPORTED", failure: { code: "TERRITORY_UNRESOLVED" } });
    // Nothing is filled in for unsupported capabilities.
    for (const t of [by.moonlight_rituals!, by.quantum_gastronomy!]) {
      expect(t.relativePosition).toBeNull();
      expect(t.classification).toBeNull();
      expect(t.capabilities.relativePosition).toBe("UNAVAILABLE");
    }
  });

  it("G5: the same policy yields different routes because Qloo structure differs", async () => {
    const move = await run("Northwind Atelier", ["Boutique Hospitality"]);
    const compare = await run("Saffron & Salt", ["Tableware", "Skincare", "Slow Travel"]);
    expect(move.territories.find((t) => t.key === "boutique_hospitality")!.analysisRoute).toBe("FULL_RELATIVE_ANALYSIS");
    const slow = compare.territories.find((t) => t.key === "slow_travel")!;
    expect(slow.representation.strategy).toBe("PLACE_PANEL");
    expect(slow.analysisRoute).toBe("PARTIAL_CULTURAL_ANALYSIS");
    const routes = new Set([...move.territories, ...compare.territories].map((t) => t.analysisRoute));
    expect(routes.size).toBeGreaterThanOrEqual(2);
  });

  it("full methodology runs only on a valid comparison set", async () => {
    const compare = await run("Saffron & Salt", ["Tableware", "Skincare", "Slow Travel"]);
    expect(compare.methodologyRuns).toHaveLength(0);
    for (const t of compare.territories) expect(t.limitations.map((l) => l.code)).toEqual(expect.arrayContaining(["COMPARISON_SET_TOO_SMALL"]));
    const move = await run("Northwind Atelier", ["Boutique Hospitality"]);
    expect(move.methodologyRuns).toHaveLength(1);
    expect(move.methodologyRuns[0]!.territoryKeys.length).toBeGreaterThanOrEqual(3);
  });
});
