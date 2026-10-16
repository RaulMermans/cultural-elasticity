import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CHECKS, SYNTHETIC_FIXTURES_DIR, analyze, formatReport, loadSyntheticFixtures, runMethodologyEval } from "../scripts/methodology-harness.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function copyFixtures(mutate: (name: string, doc: Record<string, unknown>) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "ce-synthetic-"));
  tempDirs.push(dir);
  for (const file of readdirSync(SYNTHETIC_FIXTURES_DIR).filter((f) => f.endsWith(".json"))) {
    const doc = JSON.parse(readFileSync(join(SYNTHETIC_FIXTURES_DIR, file), "utf8")) as Record<string, unknown>;
    mutate(file, doc);
    writeFileSync(join(dir, file), JSON.stringify(doc));
  }
  return dir;
}

describe("methodology eval harness", () => {
  it("passes every check on the committed synthetic fixtures", () => {
    const report = runMethodologyEval();
    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
    expect(report.fixtures).toHaveLength(10);
    expect(report.fixtureClass).toBe("synthetic");
    expect(formatReport(report)).toMatch(/LIVE_QLOO_VALIDATION_NOT_RUN/);
  });

  it("every committed fixture declares fixtureType synthetic", () => {
    for (const file of readdirSync(SYNTHETIC_FIXTURES_DIR).filter((f) => f.endsWith(".json"))) {
      const doc = JSON.parse(readFileSync(join(SYNTHETIC_FIXTURES_DIR, file), "utf8")) as { fixtureType: string; packet: { origin: string } };
      expect(doc.fixtureType, file).toBe("synthetic");
      expect(doc.packet.origin, file).toBe("synthetic");
    }
  });

  it("rejects a fixture that is not labelled synthetic or cites a real provider", () => {
    const dir = copyFixtures((name, doc) => {
      if (name.startsWith("case-a")) doc.fixtureType = "live";
      if (name.startsWith("case-b")) (doc.packet as { provenance: unknown[] }).provenance = [{ source: "qloo", operation: "rank", correlationId: "x" }];
      if (name.startsWith("case-c")) (doc.packet as { origin: string }).origin = "live";
    });
    const fixtures = loadSyntheticFixtures(dir);
    const invalid = fixtures.filter((f) => !f.packet).map((f) => f.file.slice(0, 6));
    expect(invalid).toEqual(["case-a", "case-b", "case-c"]);
    const report = runMethodologyEval(fixtures);
    expect(report.passed).toBe(false);
    expect(report.checks.find((c) => c.id === "fixtures.all_valid")?.passed).toBe(false);
  });

  it("detects forbidden behaviour: missing evidence reported as zero", () => {
    const fixtures = loadSyntheticFixtures();
    const results = new Map(fixtures.map((f) => [f.caseId, analyze(f.packet!)]));
    const e = results.get("E")!;
    e.bridges.signalCount = 0;
    e.distanceProxy.bridgeSignalCount = { value: 0, status: "available", provenance: [], limitations: [] };
    const check = CHECKS.find((c) => c.id === "bridges.missing_is_unavailable")!;
    expect(check.run(results, [])).not.toBe(true);
  });

  it("detects forbidden behaviour: cross-call ranking merged", () => {
    const fixtures = loadSyntheticFixtures();
    const results = new Map(fixtures.map((f) => [f.caseId, analyze(f.packet!)]));
    const h = results.get("H")!;
    h.ranking.status = "available";
    h.distanceProxy.relativeRankPercentile = { value: 0.75, status: "available", provenance: [], limitations: [] };
    expect(CHECKS.find((c) => c.id === "ranking.cross_call_refused")!.run(results, [])).not.toBe(true);
  });

  it("reports unreadable fixtures instead of crashing", () => {
    const dir = copyFixtures(() => {});
    writeFileSync(join(dir, "case-z-broken.json"), "{not json");
    const broken = loadSyntheticFixtures(dir).find((f) => f.file === "case-z-broken.json");
    expect(broken?.packet).toBeUndefined();
    expect(broken?.issues[0]?.message).toMatch(/unreadable JSON/);
  });
});
