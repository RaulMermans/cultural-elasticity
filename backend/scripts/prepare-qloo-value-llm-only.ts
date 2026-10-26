/** Offline condition-A request preparation. This file never invokes a model or Qloo. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_AGENT_EFFORT, DEFAULT_AGENT_MODEL } from "../src/agent/model/anthropic.js";

type Case = { id: string; question: string; brand: string; conditionA: { status: "NOT_RUN" } };
type Manifest = { schemaVersion: string; fixtureType: string; cases: Case[] };

const system = "You are researching a brand's cultural direction. Use only the question and general knowledge. You have no Qloo access or source documents. Do not claim to have observed provider evidence. Distinguish ideas from evidence and identify what would need verification. Return JSON only.";
const outputSchema = {
  type: "object", additionalProperties: false,
  required: ["answer", "evidence_claims", "uncertainties", "next_steps", "citations"],
  properties: {
    answer: { type: "string" },
    evidence_claims: { type: "array", items: { type: "string" } },
    uncertainties: { type: "array", items: { type: "string" } },
    next_steps: { type: "array", items: { type: "string" } },
    citations: { type: "array", items: { type: "string" }, maxItems: 0 },
  },
} as const;

export function prepareConditionA(manifest: Manifest) {
  if (manifest.schemaVersion !== "ce-qloo-value-benchmark/0.1" || manifest.fixtureType !== "recorded_live" || manifest.cases.length !== 7 || new Set(manifest.cases.map((item) => item.id)).size !== 7 || manifest.cases.some((item) => item.conditionA.status !== "NOT_RUN")) throw new Error("BENCHMARK_MANIFEST_INVALID");
  const tasks = manifest.cases.map((item) => ({
    caseId: item.id,
    model: DEFAULT_AGENT_MODEL,
    effort: DEFAULT_AGENT_EFFORT,
    maxOutputTokens: 1200,
    tools: [],
    sourceAccess: "question_only" as const,
    system,
    user: item.question,
    outputSchema,
    expectedCapture: ["raw_request", "raw_response", "model_id", "effort", "input_tokens", "output_tokens", "spend_usd", "timestamp", "sha256"],
  }));
  const requestHash = createHash("sha256").update(JSON.stringify(tasks)).digest("hex");
  return { schemaVersion: "ce-qloo-value-condition-a-requests/0.1", status: "HARNESS_ONLY_LLM_ARM_NOT_RUN", requestHash, tasks };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
  const manifest = JSON.parse(readFileSync(resolve(root, "evals/qloo-value/cases.json"), "utf8")) as Manifest;
  const prepared = prepareConditionA(manifest);
  const path = process.argv.indexOf("--out");
  const serialized = `${JSON.stringify(prepared, null, 2)}\n`;
  if (path >= 0 && process.argv[path + 1]) writeFileSync(resolve(process.argv[path + 1]!), serialized);
  else process.stdout.write(serialized);
}
