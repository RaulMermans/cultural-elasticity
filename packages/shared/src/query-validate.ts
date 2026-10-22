// Runtime validation for ce-query/0.1 responses.
//
// The shared package stays free of runtime dependencies, so this is a structural parser rather than a second Zod
// schema. It rejects unknown states and evidence statuses. It does not coerce them into a nearby valid value.
// Nested agent results reuse isAgentRunResponse and then check the territory fields the atlas renders.

import { AGENT_RESULT_SCHEMA_VERSION, isAgentRunResponse, type AnalysisRoute, type TerritoryEvidenceStatus } from "./agent.js";
import {
  CONTEXTUAL_QUERY_INTENTS,
  DEFERRED_QUERY_INTENTS,
  EXECUTABLE_QUERY_INTENTS,
  QUERY_INTENTS,
  QUERY_SCHEMA_VERSION,
  QUERY_STATES,
  type QueryResponse,
} from "./query.js";

export type QueryParseIssue = { path: string; message: string };
export type QueryParseResult = { ok: true; response: QueryResponse } | { ok: false; issues: QueryParseIssue[] };

const STATES = new Set<string>(QUERY_STATES);
const INTENTS = new Set<string>(QUERY_INTENTS);
const AGENT_INTENTS = new Set<string>(EXECUTABLE_QUERY_INTENTS);
const OPERATIONS = new Set(["NEW_INVESTIGATION", "FOLLOW_UP", "REFINE_TERRITORY", "SWITCH_TERRITORY", "CHANGE_BRAND"]);
const DISPOSITIONS = new Set(["EXECUTABLE", "NEEDS_CLARIFICATION", "PARTIALLY_SUPPORTED", "UNSUPPORTED", "CONTEXT_UNAVAILABLE", "NAVIGATION"]);
const EVIDENCE = new Set<TerritoryEvidenceStatus>(["EVIDENCE_SUPPORTED_TERRITORY", "PARTIAL_EVIDENCE", "HYPOTHESIS_PENDING_VALIDATION", "UNSUPPORTED"]);
const ROUTES = new Set<AnalysisRoute>(["FULL_RELATIVE_ANALYSIS", "PARTIAL_CULTURAL_ANALYSIS", "DESCRIPTIVE_ANALYSIS", "INSUFFICIENT_EVIDENCE"]);
const ROLES = new Set(["target", "reference", "frontier_candidate"]);
const RUN_STATUSES = new Set(["INTAKE", "PLANNING", "RESOLVING", "INVESTIGATING", "ANALYZING", "NEEDS_INPUT", "COMPLETE", "FAILED", "BUDGET_EXHAUSTED"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const REQUIRES_INVESTIGATION = new Set(["INVESTIGATION_COMPLETED", "INVESTIGATION_INCOMPLETE", "INVESTIGATION_NEEDS_INPUT", "RETURNED_TO_INVESTIGATION"]);

export function isQueryResponse(value: unknown): value is QueryResponse {
  return parseQueryResponse(value).ok;
}

export function parseQueryResponse(value: unknown): QueryParseResult {
  const issues: QueryParseIssue[] = [];
  const fail = (path: string, message: string) => issues.push({ path, message });
  if (!isRecord(value)) return { ok: false, issues: [{ path: "(root)", message: "expected an object" }] };
  if (value.schemaVersion !== QUERY_SCHEMA_VERSION) fail("schemaVersion", `expected ${QUERY_SCHEMA_VERSION}`);
  if (typeof value.queryId !== "string" || !UUID.test(value.queryId)) fail("queryId", "expected a uuid");
  if (typeof value.state !== "string" || !STATES.has(value.state)) fail("state", "unknown query state");
  parseInterpretation(value.interpretation, "interpretation", fail);
  parseReasons(value.reasons, "reasons", fail);
  parseHandoff(value.handoff, "handoff", fail);
  parseAlternative(value.supportedAlternative, "supportedAlternative", fail);
  parseContext(value.context, "context", fail);
  parseInvestigation(value.investigation, "investigation", fail);
  parseTerritories(value.territories, "territories", fail);
  parseNext(value.nextOperations, "nextOperations", fail);
  parseTelemetry(value.telemetry, "telemetry", fail);
  if (typeof value.state === "string" && REQUIRES_INVESTIGATION.has(value.state) && value.investigation === null) {
    fail("investigation", `${value.state} requires an investigation`);
  }
  if (value.state === "NEEDS_CLARIFICATION" && isRecord(value.interpretation) && typeof value.interpretation.clarificationQuestion !== "string") {
    fail("interpretation.clarificationQuestion", "a clarification needs a question");
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, response: value as QueryResponse };
}

function parseInterpretation(value: unknown, path: string, fail: (path: string, message: string) => void): void {
  if (value === null) return;
  if (!isRecord(value)) return fail(path, "expected an object or null");
  if (value.schemaVersion !== QUERY_SCHEMA_VERSION) fail(`${path}.schemaVersion`, `expected ${QUERY_SCHEMA_VERSION}`);
  if (typeof value.rawQuery !== "string") fail(`${path}.rawQuery`, "expected a string");
  if (typeof value.primaryIntent !== "string" || !INTENTS.has(value.primaryIntent)) fail(`${path}.primaryIntent`, "unknown intent");
  if (!isStringArray(value.secondaryIntents, INTENTS)) fail(`${path}.secondaryIntents`, "unknown secondary intent");
  if (!isRecord(value.brand) || (value.brand.name !== null && typeof value.brand.name !== "string") || !["EXPLICIT", "INHERITED", "UNRESOLVED"].includes(String(value.brand.source))) {
    fail(`${path}.brand`, "invalid brand");
  } else if (value.brand.inheritedId !== undefined && typeof value.brand.inheritedId !== "string") fail(`${path}.brand.inheritedId`, "expected a string");
  if (!isStringArray(value.brandsNamed)) fail(`${path}.brandsNamed`, "expected strings");
  if (!Array.isArray(value.territories)) fail(`${path}.territories`, "expected an array");
  else {
    for (const [index, territory] of value.territories.entries()) {
      if (!isRecord(territory) || typeof territory.name !== "string" || (territory.source !== "EXPLICIT" && territory.source !== "INHERITED")) {
        fail(`${path}.territories.${index}`, "invalid territory");
      }
    }
  }
  if (!isRecord(value.references)) fail(`${path}.references`, "expected an object");
  if (!isStringArray(value.constraints) || !isStringArray(value.unresolvedReferences) || !isStringArray(value.systemDirectives) || !isStringArray(value.unsupportedCapabilities) || !isStringArray(value.interpretationWarnings)) {
    fail(path, "expected string arrays on the interpretation");
  }
  if (value.confidence !== "HIGH" && value.confidence !== "MEDIUM" && value.confidence !== "LOW") fail(`${path}.confidence`, "unknown confidence");
  if (typeof value.disposition !== "string" || !DISPOSITIONS.has(value.disposition)) fail(`${path}.disposition`, "unknown disposition");
  if (value.clarificationQuestion !== undefined && typeof value.clarificationQuestion !== "string") fail(`${path}.clarificationQuestion`, "expected a string");
  parseReasons(value.reasonCodes, `${path}.reasonCodes`, fail);
  if (!isRecord(value.interpreter) || (value.interpreter.kind !== "llm" && value.interpreter.kind !== "scripted" && value.interpreter.kind !== "structural")) {
    fail(`${path}.interpreter`, "invalid interpreter");
  }
}

function parseHandoff(value: unknown, path: string, fail: (path: string, message: string) => void): void {
  if (value === null) return;
  if (!isRecord(value)) return fail(path, "expected an object or null");
  if (typeof value.intent !== "string" || !AGENT_INTENTS.has(value.intent)) fail(`${path}.intent`, "unknown capability");
  if (typeof value.brand !== "string") fail(`${path}.brand`, "expected a string");
  if (!isStringArray(value.territories)) fail(`${path}.territories`, "expected strings");
  if (typeof value.operation !== "string" || !OPERATIONS.has(value.operation)) fail(`${path}.operation`, "unknown operation");
}

function parseAlternative(value: unknown, path: string, fail: (path: string, message: string) => void): void {
  if (value === null) return;
  if (!isRecord(value)) return fail(path, "expected an object or null");
  if (typeof value.description !== "string" || value.description.length === 0) fail(`${path}.description`, "expected a description");
  if (value.equivalent !== false) fail(`${path}.equivalent`, "an alternative is never equivalent");
  if (typeof value.confirmQueryId !== "string" || !UUID.test(value.confirmQueryId)) fail(`${path}.confirmQueryId`, "expected a uuid");
  parseHandoff(value.handoff, `${path}.handoff`, fail);
  if (value.handoff === null) fail(`${path}.handoff`, "an alternative needs a handoff");
}

function parseContext(value: unknown, path: string, fail: (path: string, message: string) => void): void {
  if (value === null) return;
  if (!isRecord(value)) return fail(path, "expected an object or null");
  parseNode(value.current, `${path}.current`, fail);
  if (!Array.isArray(value.lineage)) fail(`${path}.lineage`, "expected an array");
  else for (const [index, node] of value.lineage.entries()) parseNode(node, `${path}.lineage.${index}`, fail);
  if (typeof value.lineageTruncated !== "boolean") fail(`${path}.lineageTruncated`, "expected a boolean");
  if (!isStringArray(value.children)) fail(`${path}.children`, "expected run ids");
}

function parseNode(value: unknown, path: string, fail: (path: string, message: string) => void): void {
  if (!isRecord(value)) return fail(path, "expected an investigation node");
  if (typeof value.runId !== "string" || !UUID.test(value.runId)) fail(`${path}.runId`, "expected a uuid");
  if (value.parentRunId !== null && (typeof value.parentRunId !== "string" || !UUID.test(value.parentRunId))) fail(`${path}.parentRunId`, "expected a uuid or null");
  if (typeof value.operation !== "string" || !OPERATIONS.has(value.operation)) fail(`${path}.operation`, "unknown operation");
  if (value.selectedTerritoryKey !== null && typeof value.selectedTerritoryKey !== "string") fail(`${path}.selectedTerritoryKey`, "expected a string or null");
  if (value.intent !== null && (typeof value.intent !== "string" || !AGENT_INTENTS.has(value.intent))) fail(`${path}.intent`, "unknown intent");
  if (typeof value.status !== "string" || !RUN_STATUSES.has(value.status)) fail(`${path}.status`, "unknown run status");
  if (value.brand !== null && (!isRecord(value.brand) || typeof value.brand.id !== "string" || typeof value.brand.label !== "string")) fail(`${path}.brand`, "invalid brand");
  if (!Array.isArray(value.territories)) fail(`${path}.territories`, "expected an array");
  else {
    for (const [index, territory] of value.territories.entries()) {
      if (!isRecord(territory) || typeof territory.key !== "string" || typeof territory.label !== "string" || typeof territory.role !== "string" || !ROLES.has(territory.role)) {
        fail(`${path}.territories.${index}`, "invalid territory");
      } else {
        optionalEnum(territory.evidenceStatus, EVIDENCE, `${path}.territories.${index}.evidenceStatus`, fail);
        optionalEnum(territory.analysisRoute, ROUTES, `${path}.territories.${index}.analysisRoute`, fail);
      }
    }
  }
}

function parseInvestigation(value: unknown, path: string, fail: (path: string, message: string) => void): void {
  if (value === null) return;
  if (!isRecord(value)) return fail(path, "expected an object or null");
  if (typeof value.runId !== "string" || !UUID.test(value.runId)) fail(`${path}.runId`, "expected a uuid");
  if (typeof value.reused !== "boolean") fail(`${path}.reused`, "expected a boolean");
  if (value.link !== null) parseLink(value.link, `${path}.link`, fail);
  if (value.result === null) return;
  if (!isAgentRunResponse(value.result)) return fail(`${path}.result`, "not an agent result");
  if (value.result.schemaVersion !== AGENT_RESULT_SCHEMA_VERSION) fail(`${path}.result.schemaVersion`, "incompatible agent result");
  if (value.result.status === "NEEDS_INPUT") return;
  const territories = (value.result as { territories?: unknown }).territories;
  if (!Array.isArray(territories)) return fail(`${path}.result.territories`, "expected territories");
  for (const [index, territory] of territories.entries()) {
    if (!isRecord(territory)) {
      fail(`${path}.result.territories.${index}`, "expected an object");
      continue;
    }
    optionalEnum(territory.evidenceStatus, EVIDENCE, `${path}.result.territories.${index}.evidenceStatus`, fail);
    if (territory.analysisRoute !== undefined && territory.analysisRoute !== null && (typeof territory.analysisRoute !== "string" || !ROUTES.has(territory.analysisRoute as AnalysisRoute))) {
      fail(`${path}.result.territories.${index}.analysisRoute`, "unknown analysis route");
    }
  }
}

function parseLink(value: unknown, path: string, fail: (path: string, message: string) => void): void {
  if (!isRecord(value)) return fail(path, "expected a link");
  if (typeof value.queryId !== "string" || !UUID.test(value.queryId)) fail(`${path}.queryId`, "expected a uuid");
  if (typeof value.operation !== "string" || !OPERATIONS.has(value.operation)) fail(`${path}.operation`, "unknown operation");
  if (value.parentRunId !== null && (typeof value.parentRunId !== "string" || !UUID.test(value.parentRunId))) fail(`${path}.parentRunId`, "expected a uuid or null");
  if (value.selectedTerritoryKey !== null && typeof value.selectedTerritoryKey !== "string") fail(`${path}.selectedTerritoryKey`, "expected a string or null");
  if (value.inheritedBrand !== null && (!isRecord(value.inheritedBrand) || typeof value.inheritedBrand.id !== "string" || typeof value.inheritedBrand.label !== "string")) {
    fail(`${path}.inheritedBrand`, "invalid inherited brand");
  }
  if (!isStringArray(value.constraints)) fail(`${path}.constraints`, "expected strings");
  if (typeof value.reason !== "string") fail(`${path}.reason`, "expected a string");
}

function parseTerritories(value: unknown, path: string, fail: (path: string, message: string) => void): void {
  if (!Array.isArray(value)) return fail(path, "expected an array");
  for (const [index, territory] of value.entries()) {
    if (!isRecord(territory) || typeof territory.name !== "string" || (territory.investigationState !== "NOT_INVESTIGATED" && territory.investigationState !== "INVESTIGATED")) {
      fail(`${path}.${index}`, "invalid atlas territory");
      continue;
    }
    if (territory.territoryKey !== null && typeof territory.territoryKey !== "string") fail(`${path}.${index}.territoryKey`, "expected a string or null");
    optionalEnum(territory.evidenceStatus, EVIDENCE, `${path}.${index}.evidenceStatus`, fail);
    optionalEnum(territory.analysisRoute, ROUTES, `${path}.${index}.analysisRoute`, fail);
  }
}

function parseNext(value: unknown, path: string, fail: (path: string, message: string) => void): void {
  if (!Array.isArray(value)) return fail(path, "expected an array");
  const allowed = new Set<string>([...EXECUTABLE_QUERY_INTENTS, ...CONTEXTUAL_QUERY_INTENTS]);
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || !allowed.has(item) || DEFERRED_QUERY_INTENTS.includes(item as (typeof DEFERRED_QUERY_INTENTS)[number])) {
      fail(`${path}.${index}`, "not an executable follow-up");
    }
  }
}

function parseTelemetry(value: unknown, path: string, fail: (path: string, message: string) => void): void {
  if (!isRecord(value)) return fail(path, "expected telemetry");
  if (value.schemaVersion !== QUERY_SCHEMA_VERSION) fail(`${path}.schemaVersion`, `expected ${QUERY_SCHEMA_VERSION}`);
  if (typeof value.queryId !== "string" || !UUID.test(value.queryId)) fail(`${path}.queryId`, "expected a uuid");
  if (value.intent !== null && (typeof value.intent !== "string" || !INTENTS.has(value.intent))) fail(`${path}.intent`, "unknown intent");
  if (!isStringArray(value.secondaryIntents, INTENTS)) fail(`${path}.secondaryIntents`, "unknown intent");
  if (!isStringArray(value.explicitFields) || !isStringArray(value.inheritedFieldNames) || !isStringArray(value.errorCodes)) fail(path, "expected string arrays");
  if (typeof value.clarificationRequired !== "boolean") fail(`${path}.clarificationRequired`, "expected a boolean");
  if (value.validationOutcome !== null && (typeof value.validationOutcome !== "string" || !DISPOSITIONS.has(value.validationOutcome))) fail(`${path}.validationOutcome`, "unknown disposition");
  if (value.selectedCapability !== null && (typeof value.selectedCapability !== "string" || !AGENT_INTENTS.has(value.selectedCapability))) fail(`${path}.selectedCapability`, "unknown capability");
  if (typeof value.routingOutcome !== "string" || !STATES.has(value.routingOutcome)) fail(`${path}.routingOutcome`, "unknown state");
  if (value.parentRunId !== null && (typeof value.parentRunId !== "string" || !UUID.test(value.parentRunId))) fail(`${path}.parentRunId`, "expected a uuid or null");
  if (value.childRunId !== null && (typeof value.childRunId !== "string" || !UUID.test(value.childRunId))) fail(`${path}.childRunId`, "expected a uuid or null");
  if (typeof value.interpretationLatencyMs !== "number" || typeof value.repairAttempts !== "number" || typeof value.queryChars !== "number") fail(path, "expected numbers");
  if (!isRecord(value.interpretationTokens) || typeof value.interpretationTokens.input !== "number" || typeof value.interpretationTokens.output !== "number") fail(`${path}.interpretationTokens`, "expected token counts");
  if (value.interpretationCostUsd !== null && typeof value.interpretationCostUsd !== "number") fail(`${path}.interpretationCostUsd`, "expected a number or null");
  if (value.executionHandOffStatus !== "NOT_ATTEMPTED" && value.executionHandOffStatus !== "HANDED_OFF" && value.executionHandOffStatus !== "REFUSED") {
    fail(`${path}.executionHandOffStatus`, "unknown handoff status");
  }
  if (typeof value.queryHash !== "string") fail(`${path}.queryHash`, "expected a string");
}

function parseReasons(value: unknown, path: string, fail: (path: string, message: string) => void): void {
  if (!Array.isArray(value)) return fail(path, "expected an array");
  for (const [index, reason] of value.entries()) {
    if (!isRecord(reason) || typeof reason.code !== "string" || typeof reason.detail !== "string") fail(`${path}.${index}`, "expected a code and a detail");
  }
}

function optionalEnum(value: unknown, allowed: Set<string>, path: string, fail: (path: string, message: string) => void): void {
  if (value === undefined || value === null) return;
  if (typeof value !== "string" || !allowed.has(value)) fail(path, "unknown value");
}

function isStringArray(value: unknown, allowed?: Set<string>): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && (!allowed || allowed.has(item)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
