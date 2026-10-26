import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareConditionA } from "../scripts/prepare-qloo-value-llm-only.js";

describe("offline LLM-only benchmark preparation", () => {
  it("pins all seven questions without giving condition A Qloo artifacts or source access", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../evals/qloo-value/cases.json", import.meta.url), "utf8"));
    const result = prepareConditionA(manifest);
    expect(result.status).toBe("HARNESS_ONLY_LLM_ARM_NOT_RUN");
    expect(result.tasks.map((task) => task.caseId)).toEqual(manifest.cases.map((item: { id: string }) => item.id));
    expect(result.tasks.map((task) => task.user)).toEqual(manifest.cases.map((item: { question: string }) => item.question));
    expect(result.tasks.every((task) => task.tools.length === 0 && task.sourceAccess === "question_only" && task.outputSchema.properties.citations.maxItems === 0)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("backend/feasibility-output/");
    expect(prepareConditionA(manifest).requestHash).toBe(result.requestHash);
  });
});
