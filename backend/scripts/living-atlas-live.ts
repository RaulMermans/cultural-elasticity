/**
 * One live parent investigation and one live child follow-up through the product job path.
 *
 *   pnpm --filter backend living-atlas:live
 *
 * Uses Claude Haiku 5.5 and live Qloo. This is not the baseline policy. A missing credential exits 2 and
 * prints LIVE_QLOO_VALIDATION_NOT_RUN. The full responses are written under backend/feasibility-output
 * (gitignored) after secret scrubbing. The brand name below is an evaluation choice, not product routing.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseQueryResponse, type QueryResponse } from "@cultural-elasticity/shared";
import { AgentNotConfiguredError } from "../src/agent/errors.js";
import { createAgentModel, createLiveToolProvider, createQueryInterpreter } from "../src/agent/factory.js";
import { JobManager, type JobCreated, type JobView } from "../src/agent/query/jobs.js";
import { QueryService } from "../src/agent/query/service.js";
import { RunStore } from "../src/agent/run-store.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { loadLocalEnvFile } from "../src/config/env.js";
import { scrubSecrets } from "../src/qloo/transport.js";

const PARENT_QUERY = "Where could Jacquemus expand?";

function brandOf(response: QueryResponse | null): { id: string; label: string } | null {
  const result = response?.investigation?.result;
  if (!result || result.status === "NEEDS_INPUT" || !result.brand) return null;
  return { id: result.brand.id, label: result.brand.label };
}

function territoryOf(response: QueryResponse | null): { key: string; label: string } | null {
  const result = response?.investigation?.result;
  if (!result || result.status === "NEEDS_INPUT") return null;
  const territory = result.territories.find((item) => item.key && item.label);
  return territory ? { key: territory.key, label: territory.label } : null;
}

async function settle(jobs: JobManager, created: JobCreated): Promise<JobView> {
  const started = Date.now();
  let last = "";
  for (;;) {
    const view = jobs.get(created.jobId, created.accessToken);
    if (!view) throw new Error("job disappeared before it finished");
    const mark = `${view.status}:${view.stageLabel}`;
    if (mark !== last) {
      console.log(`  ${view.jobId.slice(0, 8)} ${mark}`);
      last = mark;
    }
    if (view.status !== "queued" && view.status !== "running") return view;
    if (Date.now() - started > 20 * 60 * 1000) throw new Error("job exceeded 20 minutes");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

function summarize(label: string, view: JobView): Record<string, unknown> {
  const response = view.response;
  const parsed = parseQueryResponse(response);
  const result = response?.investigation?.result;
  const analysis = result && result.status !== "NEEDS_INPUT" ? result : null;
  console.log(`\n${label}`);
  console.log(`  job ${view.status} · query ${response?.state ?? "none"} · parser ${parsed.ok ? "ok" : "REJECTED"}`);
  if (!parsed.ok && response) console.log(`  parser issues: ${parsed.issues.map((issue) => issue.path).join(", ")}`);
  console.log(`  brand ${analysis?.brand ? `${analysis.brand.label} (${analysis.brand.id})` : "none"}`);
  console.log(`  origin ${analysis?.evidenceOrigin ?? "none"} · qloo calls ${analysis?.metrics.qloo_calls ?? 0} · model ${analysis?.model.id ?? result?.model.id ?? "none"}`);
  if (analysis) {
    for (const territory of analysis.territories) console.log(`  territory ${territory.label} · ${territory.evidenceStatus ?? "no evidence mark"} · ${territory.analysisRoute}`);
  }
  if (response?.interpretation?.interpretationWarnings.length) console.log(`  warnings ${response.interpretation.interpretationWarnings.join(" | ")}`);
  return {
    status: view.status,
    state: response?.state ?? null,
    parserOk: parsed.ok,
    runId: response?.investigation?.runId ?? null,
    parentRunId: response?.investigation?.link?.parentRunId ?? null,
    brand: brandOf(response),
    evidenceOrigin: analysis?.evidenceOrigin ?? null,
    qlooCalls: analysis?.metrics.qloo_calls ?? 0,
    model: analysis?.model.id ?? null,
    warnings: response?.interpretation?.interpretationWarnings ?? [],
    territories: analysis?.territories.map((territory) => ({ label: territory.label, key: territory.key, evidenceStatus: territory.evidenceStatus ?? null, analysisRoute: territory.analysisRoute })) ?? [],
  };
}

async function main(): Promise<number> {
  loadLocalEnvFile();
  let model;
  let provider;
  let interpreter;
  try {
    model = createAgentModel("auto");
    interpreter = createQueryInterpreter("auto");
    provider = createLiveToolProvider();
  } catch (error) {
    if (error instanceof AgentNotConfiguredError) {
      console.log("LIVE_QLOO_VALIDATION_NOT_RUN");
      console.log(error.message);
      console.log("Unverified: parent investigation, child follow-up, inherited brand re-resolution, atlas parser acceptance of a live result.");
      return 2;
    }
    throw error;
  }
  console.log(`Tool provider: ${provider.name}. Model path: Haiku via the query job manager. Not the baseline policy.`);
  const store = new RunStore();
  const runtime = new AgentRuntime({ model, provider, store });
  const service = new QueryService({ runtime, interpreter });
  const jobs = new JobManager({ runnerFor: () => service });

  console.log(`\nParent: ${PARENT_QUERY}`);
  const parent = await settle(jobs, jobs.create({ kind: "execute", body: { query: PARENT_QUERY }, model: "auto" }));
  const parentSummary = summarize("Parent", parent);
  const territory = territoryOf(parent.response);
  let childSummary: Record<string, unknown> | null = null;
  let childResponse: QueryResponse | null = null;
  if (!territory || !parent.response?.investigation?.runId) {
    console.log("\nChild not started: the parent returned no territory with a key.");
  } else {
    const childQuery = `Explore ${territory.label} more specifically.`;
    console.log(`\nChild: ${childQuery}`);
    const child = await settle(jobs, jobs.create({
      kind: "execute",
      body: { query: childQuery, context: { runId: parent.response.investigation.runId, selectedTerritoryKey: territory.key } },
      model: "auto",
    }));
    childResponse = child.response;
    childSummary = summarize("Child", child);
    const parentBrand = brandOf(parent.response);
    const childBrand = brandOf(child.response);
    if (parentBrand && childBrand && parentBrand.id !== childBrand.id) {
      const warned = child.response?.interpretation?.interpretationWarnings.some((warning) => warning.startsWith("INHERITED_BRAND_MISMATCH")) ?? false;
      console.log(warned ? "Inherited brand ids differ and the mismatch warning is present." : "INHERITED_BRAND_MISMATCH was expected and was not recorded.");
      childSummary = { ...childSummary, brandMismatchWarned: warned };
    } else if (parentBrand && childBrand) {
      console.log("Inherited brand id matches the parent after re-resolution.");
    }
  }

  const dir = fileURLToPath(new URL("../feasibility-output/sprint5b2-living-atlas", import.meta.url));
  mkdirSync(dir, { recursive: true });
  const report = { generatedAt: new Date().toISOString(), label: "LIVE_QLOO", parent: parentSummary, child: childSummary };
  const raw = JSON.stringify({ report, parent: parent.response, child: childResponse }, null, 2);
  const modelKey = process.env.ANTHROPIC_API_KEY?.trim();
  const scrubbed = modelKey && modelKey.length >= 8 ? scrubSecrets(raw).split(modelKey).join("[redacted]") : scrubSecrets(raw);
  writeFileSync(join(dir, "parent-child.json"), `${scrubbed}\n`);
  console.log(`\nWrote ${join(dir, "parent-child.json")} (gitignored).`);

  const parentOk = parentSummary.parserOk === true && Number(parentSummary.qlooCalls) > 0 && parentSummary.evidenceOrigin === "live";
  const childOk = childSummary !== null && childSummary.parserOk === true && Number(childSummary.qlooCalls) > 0 && childSummary.evidenceOrigin === "live" && childSummary.parentRunId === parentSummary.runId;
  if (!parentOk || !childOk) {
    console.log("\nLIVE_QLOO_VALIDATION_INCOMPLETE");
    if (!parentOk) console.log("Unverified or failed: parent live investigation.");
    if (!childOk) console.log("Unverified or failed: child live investigation and parent link.");
    return 1;
  }
  console.log("\nLIVE_QLOO_PARENT_AND_CHILD_COMPLETED");
  return 0;
}

process.exit(await main());
