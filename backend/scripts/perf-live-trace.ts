/**
 * `pnpm perf:live-trace`: ONE fresh live Haiku + live Qloo investigation with span coverage.
 * Frozen prompt: the recorded Living Atlas parent ("Where could Jacquemus expand?").
 * Never rewrite historical 810s numbers. Label LIVE_QLOO / LIVE_HAIKU honestly.
 *
 * Sprint 8E: paid. Refuses (exit 4, no call) unless `--approved-usd N` covers one run's conservative ceiling
 * (scripts/live-gate-budget.ts); the run then carries a SpendBound of that ceiling. `--out <dir>` overrides the output.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentNotConfiguredError } from "../src/agent/errors.js";
import { createAgentModel, createLiveToolProvider, hasModelCredential, LIVE_AGENT_MODEL_VALIDATION_NOT_RUN } from "../src/agent/factory.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { loadLocalEnvFile } from "../src/config/env.js";
import { buildPerfReport, formatPerfReport } from "../src/ops/perf-report.js";
import { computeGateExposure, loadGateManifest, SuiteSpendGuard } from "./live-gate-budget.js";
import { scrubSecrets } from "../src/qloo/transport.js";
import type { AgentRunResponse } from "@cultural-elasticity/shared";

const backendRoot = fileURLToPath(new URL("..", import.meta.url));
const REQUEST = {
  userQuery: "Where could Jacquemus expand?",
  brand: "Jacquemus",
  territories: [] as string[],
};

function credentialPresent(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

async function main(): Promise<number> {
  loadLocalEnvFile();
  console.log("perf:live-trace");
  console.log(`QLOO_API_KEY present: ${credentialPresent("QLOO_API_KEY")}`);
  console.log(`ANTHROPIC_API_KEY present: ${credentialPresent("ANTHROPIC_API_KEY")}`);
  console.log(`model live: ${hasModelCredential()}`);
  console.log(`QLOO_API_BASE_URL set: ${credentialPresent("QLOO_API_BASE_URL")}`);
  console.log(`QLOO_CALL_SPACING_MS: ${process.env.QLOO_CALL_SPACING_MS ?? "(default)"}`);
  if (!credentialPresent("QLOO_API_KEY") || !hasModelCredential()) {
    console.log("LIVE_QLOO_VALIDATION_NOT_RUN");
    console.log(LIVE_AGENT_MODEL_VALIDATION_NOT_RUN);
    return 3;
  }
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const approved = flag("--approved-usd") === undefined ? null : Number(flag("--approved-usd"));
  const perRunCeiling = computeGateExposure(loadGateManifest()).perRun.ceilingUsd;
  console.log(`budget: approved $${approved ?? "none"} · one-run conservative ceiling $${perRunCeiling}`);
  const bound = approved !== null && Number.isFinite(approved) ? new SuiteSpendGuard(approved, perRunCeiling).nextRun() : null;
  if (!bound) {
    console.log(approved === null ? "LIVE_GATE_BLOCKED_BY_APPROVAL: no --approved-usd; no model or Qloo call was made." : `CEILING_BELOW_RESERVED_EXPOSURE: $${approved} < $${perRunCeiling}; no model or Qloo call was made.`);
    return 4;
  }
  let provider;
  try {
    provider = createLiveToolProvider();
  } catch (error) {
    if (error instanceof AgentNotConfiguredError) {
      console.log(`${error.message}\nLIVE_QLOO_VALIDATION_NOT_RUN`);
      return 3;
    }
    throw error;
  }
  const model = createAgentModel("auto");
  console.log(`provider ${provider.name} · model ${model.info.id} effort ${model.info.effort ?? "n/a"}`);
  const runtime = new AgentRuntime({ model, provider });
  const started = Date.now();
  const result = await runtime.run(REQUEST, undefined, { spend: bound });
  const wall = Date.now() - started;
  const report = buildPerfReport(result);
  const outDir = flag("--out") ?? join(backendRoot, "feasibility-output", "sprint8e-live-trace");
  mkdirSync(outDir, { recursive: true });
  const payload = {
    notice: "LIVE Haiku + LIVE Qloo. One run. Not a full readiness gate.",
    request: REQUEST,
    wallMsObserved: wall,
    status: result.status,
    model: result.model,
    report,
    metrics: result.metrics,
    spanCount: result.trace.spans?.length ?? 0,
    investigation: investigationSummary(result),
    spend: { approvedUsd: approved, boundUsd: bound.authorizedUsd, observedOrCeilingUsd: bound.observedUsd() },
  };
  const text = JSON.stringify(payload, null, 2);
  if (scrubSecrets(text) !== text) throw new Error("credential material detected; not written");
  writeFileSync(join(outDir, "report.json"), `${text}\n`, { mode: 0o600 });
  console.log(formatPerfReport(report));
  console.log(`wrote ${join(outDir, "report.json")}`);
  provider.close?.();
  return result.status === "FAILED" ? 1 : 0;
}

function investigationSummary(result: AgentRunResponse) {
  if (result.status === "NEEDS_INPUT") {
    return { intent: null, territories: [], invalidActionCodes: [], earlyStops: [] };
  }
  return {
    intent: result.intent,
    territories: result.territories.map((t) => ({
      key: t.key,
      label: t.label,
      role: t.role,
      origin: t.origin,
      evidenceStatus: t.evidenceStatus ?? null,
      analysisRoute: t.analysisRoute,
      resolvedConcept: t.resolvedConcept ? { id: t.resolvedConcept.id, label: t.resolvedConcept.label } : null,
      representation: t.representation.summary,
    })),
    invalidActionCodes: result.trace.turns.flatMap((t) =>
      t.decisions.flatMap((d) => (d.rejection ? [d.rejection.split(":")[0]!] : [])),
    ),
    earlyStops: result.trace.earlyStops.map((e) => ({ tool: e.tool, code: e.code, reason: e.reason.slice(0, 220) })),
    channelA: channelA(result),
  };
}

/** Sprint 8E: Channel A acquisition order and probe yield, for the before/after comparison with the 8C parent. */
function channelA(result: AgentRunResponse) {
  const calls = result.trace.toolCalls;
  const firstIteration = (pred: (c: (typeof calls)[number]) => boolean) => calls.find(pred)?.iteration ?? null;
  const probes = calls.filter((c) => c.tool === "qloo_recommend" && (c.arguments as { conditionOnBrand?: boolean } | null)?.conditionOnBrand === false);
  return {
    relatedEntitiesIteration: firstIteration((c) => c.tool === "qloo_related_entities" && c.status !== "rejected"),
    profileCalls: calls.filter((c) => c.tool === "qloo_get_entity_tags" && c.status !== "rejected").length,
    firstProbeIteration: firstIteration((c) => c.tool === "qloo_recommend" && c.status !== "rejected"),
    brandIndependentProbes: probes.filter((c) => c.status !== "rejected").length,
    emptyProbes: probes.filter((c) => c.status === "empty").length,
    rejectedToolCalls: calls.filter((c) => c.status === "rejected").length,
    toolSequence: calls.map((c) => `${c.iteration}:${c.tool}:${c.status}`),
  };
}

process.exit(await main());
