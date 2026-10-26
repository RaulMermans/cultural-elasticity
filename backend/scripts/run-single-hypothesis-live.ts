/**
 * Sprint 9G live single-hypothesis canary investigation.
 * Executes ONLY with explicit authorization.
 * Target: Brand "Loewe", Territory "Boutique hospitality".
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentAnalysisResult } from "@cultural-elasticity/shared";
import { createAgentModel, createLiveToolProvider } from "../src/agent/factory.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { RunStore } from "../src/agent/run-store.js";
import { scrubSecrets } from "../src/qloo/transport.js";

// Load .env safely across ESM
const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const candidatePaths = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "backend/.env"),
  resolve(scriptDir, "../.env"),
];

for (const p of candidatePaths) {
  if (existsSync(p)) {
    const content = readFileSync(p, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, ...rest] = trimmed.split("=");
      const val = rest.join("=").trim();
      if (key && !process.env[key]) {
        process.env[key] = val;
      }
    }
    break;
  }
}

async function main() {
  console.log("=== SPRINT 9G LIVE CANARY PREFLIGHT ===");
  const apiKey = process.env.QLOO_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !anthropicKey) {
    console.error("FATAL: Required credentials missing from environment.");
    process.exit(1);
  }

  const modelChoice = "anthropic";
  const model = createAgentModel(modelChoice);
  const provider = createLiveToolProvider();
  const store = new RunStore();
  const runtime = new AgentRuntime({ model, provider, store });

  console.log("Model initialized:", model.info);
  console.log("Tool provider:", provider.name, "Mode:", provider.mode);

  const request = {
    userQuery: "Does the available cultural evidence support investigating Loewe in boutique hospitality?",
    brand: "Loewe",
    intent: "analyze_move" as const,
    territories: ["Boutique hospitality"],
    researchMode: "single_hypothesis_v1" as const,
    limits: {
      maxQlooCalls: 12,
      maxAgentIterations: 8,
    },
  };

  console.log("Starting live single hypothesis run...");
  const startTime = Date.now();
  const result = await runtime.run(request);
  const totalMs = Date.now() - startTime;

  console.log("\n=== INVESTIGATION COMPLETED ===");
  console.log("Status:", result.status);
  console.log("Total Duration:", (totalMs / 1000).toFixed(2), "s");
  console.log("Qloo Dispatches:", result.metrics.qloo_calls);
  console.log("Input Tokens:", result.metrics.model_input_tokens);
  console.log("Output Tokens:", result.metrics.model_output_tokens);
  console.log("Model Cost USD:", result.metrics.model_cost_usd);

  if (result.status !== "NEEDS_INPUT") {
    const analysis = result as AgentAnalysisResult;
    if (analysis.hypothesisAssessment) {
      console.log("\n--- Hypothesis Assessment ---");
      console.log("Outcome:", analysis.hypothesisAssessment.outcome);
      console.log("Supports:", analysis.hypothesisAssessment.supports);
      console.log("Limitations:", analysis.hypothesisAssessment.limitations);
      console.log("Next Step:", analysis.hypothesisAssessment.nextStep);
    }
  }

  // Preserve evidence
  const outDir = resolve(process.cwd(), "docs/sprint-9g/evidence");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, "loewe-boutique-hospitality.live.json");
  const scrubbed = JSON.parse(scrubSecrets(JSON.stringify(result, null, 2)));
  writeFileSync(outFile, JSON.stringify(scrubbed, null, 2), "utf8");
  console.log(`\nEvidence written to ${outFile}`);
}

main().catch((err) => {
  console.error("Investigation failed with error:", err);
  process.exit(1);
});
