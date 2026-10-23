/**
 * Builds the public recorded example from a previously verified live query response.
 *
 * Usage: pnpm --filter backend exec tsx scripts/demo/build-recorded-example.ts <source.json>
 * The source is a local live artifact. The output drops traces, prompts and anything that looks like a secret.
 * It does not call Qloo.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseQueryResponse, type QueryResponse } from "@cultural-elasticity/shared";

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error("Pass the path of a verified live parent-child artifact.");
  process.exit(1);
}

const SECRET = /sk-ant-|api[_-]?key|authorization|bearer\s+|QLOO_API_KEY|ANTHROPIC_API_KEY/iu;
const source = JSON.parse(readFileSync(sourcePath, "utf8")) as {
  report?: { generatedAt?: string; parent?: { qlooCalls?: number }; child?: { qlooCalls?: number } };
  parent: QueryResponse;
  child?: QueryResponse;
};

function slimTerritory(territory: Record<string, unknown>) {
  return {
    key: territory.key,
    label: territory.label,
    role: territory.role,
    evidenceStatus: territory.evidenceStatus,
    analysisRoute: territory.analysisRoute,
    keyEvidence: territory.keyEvidence ?? [],
    limitations: territory.limitations ?? [],
    provenance: territory.provenance ?? { correlationIds: [], sources: [] },
    classification: territory.classification ?? null,
    relativePosition: territory.relativePosition ?? null,
    robustness: territory.robustness ?? null,
  };
}

function slimResult(result: Record<string, unknown>) {
  const layers = result.layers as {
    qlooEvidence?: { brand?: unknown; concepts?: unknown[]; exemplars?: unknown[]; qlooCalls?: number };
    systemAnalysis?: { routes?: unknown[] };
    agentInterpretation?: { summary?: string; source?: string; claimValidationPassed?: boolean };
  } | undefined;
  const trace = result.trace as { investigationLink?: unknown; stopReason?: unknown; model?: unknown } | undefined;
  return {
    schemaVersion: result.schemaVersion,
    runId: result.runId,
    status: result.status,
    intent: result.intent,
    userQuery: result.userQuery,
    brand: result.brand,
    territories: Array.isArray(result.territories) ? result.territories.map((territory) => slimTerritory(territory as Record<string, unknown>)) : [],
    summary: result.summary,
    limitations: result.limitations ?? [],
    evidenceOrigin: result.evidenceOrigin,
    model: result.model,
    failureCategory: result.failureCategory ?? null,
    layers: {
      qlooEvidence: {
        brand: layers?.qlooEvidence?.brand ?? null,
        concepts: (layers?.qlooEvidence?.concepts ?? []).map((concept) => {
          const item = concept as { territoryKey?: string; id?: string; label?: string; correlationIds?: string[] };
          return { territoryKey: item.territoryKey, id: item.id, label: item.label, correlationIds: item.correlationIds ?? [] };
        }),
        exemplars: (layers?.qlooEvidence?.exemplars ?? []).slice(0, 8).map((exemplar) => {
          const item = exemplar as { territoryKey?: string; id?: string; label?: string };
          return { territoryKey: item.territoryKey, id: item.id, label: item.label };
        }),
        qlooCalls: layers?.qlooEvidence?.qlooCalls ?? 0,
      },
      systemAnalysis: { routes: layers?.systemAnalysis?.routes ?? [] },
      agentInterpretation: {
        summary: layers?.agentInterpretation?.summary ?? "",
        source: layers?.agentInterpretation?.source ?? "deterministic_template",
        claimValidationPassed: layers?.agentInterpretation?.claimValidationPassed ?? false,
      },
    },
    trace: {
      toolCalls: [],
      investigationLink: trace?.investigationLink ?? null,
      stopReason: trace?.stopReason ?? null,
      model: trace?.model ?? result.model,
    },
  };
}

function publish(response: QueryResponse): QueryResponse {
  const copy = structuredClone(response);
  if (copy.investigation?.result && copy.investigation.result.status !== "NEEDS_INPUT") {
    copy.investigation.result = slimResult(copy.investigation.result as unknown as Record<string, unknown>) as unknown as typeof copy.investigation.result;
  }
  if (copy.interpretation) {
    copy.interpretation.interpretationWarnings = [...new Set([...copy.interpretation.interpretationWarnings, "RECORDED_EXAMPLE"])];
  }
  return copy;
}

const responses = [publish(source.parent), ...(source.child ? [publish(source.child)] : [])];
for (const response of responses) {
  const parsed = parseQueryResponse(response);
  if (!parsed.ok) {
    console.error(parsed.issues);
    process.exit(1);
  }
}
const encoded = JSON.stringify({ responses });
if (SECRET.test(encoded)) {
  console.error("Refusing to write a demo artifact that matches a secret pattern.");
  process.exit(1);
}

const recordedAt = source.report?.generatedAt ?? new Date().toISOString();
const artifact = {
  kind: "RECORDED_EXAMPLE",
  recordedAt,
  evidenceOrigin: "live",
  model: "claude-haiku-5-5",
  qlooCalls: { parent: source.report?.parent?.qlooCalls ?? null, child: source.report?.child?.qlooCalls ?? null },
  sourceSha256: createHash("sha256").update(readFileSync(sourcePath)).digest("hex"),
  note: "Recorded from a verified live investigation. Partial evidence stays partial. This file does not call a provider.",
  responses,
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../frontend/src/demo");
mkdirSync(root, { recursive: true });
writeFileSync(resolve(root, "recorded-example.json"), `${JSON.stringify(artifact, null, 2)}\n`);
const meta = { ...artifact, responses: undefined, responseCount: responses.length, runIds: responses.map((response) => response.investigation?.runId ?? null) };
writeFileSync(resolve(root, "recorded-example.meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
console.log(`Wrote ${responses.length} recorded responses from ${recordedAt}.`);
