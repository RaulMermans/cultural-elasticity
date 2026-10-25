import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluate } from "../scripts/eval-qloo-value.js";

const root = resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(readFileSync(resolve(root, "evals/qloo-value/cases.json"), "utf8"));
const read = (path: string) => readFileSync(resolve(root, path));

describe("recorded-live Qloo value benchmark harness", () => {
  it("audits seven pinned real artifacts without claiming an unrun comparison", () => {
    const first = evaluate(manifest, read);
    expect(first).toEqual(evaluate(manifest, read));
    expect(first.caseCount).toBe(7);
    expect(first.comparisonStatus).toBe("NOT_RUN");
    expect(first.conditionB.sourceLinkedCases).toBeGreaterThan(0);
  });
  it("refuses checksum drift and non-live evidence", () => {
    const changed = structuredClone(manifest);
    changed.cases[0].conditionB.sha256 = createHash("sha256").update("changed").digest("hex");
    expect(() => evaluate(changed, read)).toThrow(/ARTIFACT_CHECKSUM_MISMATCH/u);
    const wrong = structuredClone(manifest);
    wrong.fixtureType = "synthetic";
    expect(() => evaluate(wrong, read)).toThrow("BENCHMARK_MANIFEST_INVALID");
  });
});
