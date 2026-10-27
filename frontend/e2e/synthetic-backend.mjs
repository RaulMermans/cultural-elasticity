/**
 * SYNTHETIC job API for browser tests. Not Qloo, not Haiku, not a live investigation.
 * Responses are labelled synthetic and checked with the same parser the atlas uses.
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { parseQueryResponse } from "../../packages/shared/dist/query-validate.js";

const QUERY = "ce-query/0.1";
const AGENT = "ce-agent-result/0.3";
const PORT = Number(process.env.PORT ?? 4100);

const jobs = new Map();

function checked(response) {
  const parsed = parseQueryResponse(response);
  if (!parsed.ok) throw new Error(`synthetic response is not a query response: ${JSON.stringify(parsed.issues)}`);
  return response;
}

function telemetry(queryId, state, intent, handoff) {
  return {
    queryId,
    schemaVersion: QUERY,
    intent,
    secondaryIntents: [],
    explicitFields: [],
    inheritedFieldNames: [],
    clarificationRequired: state === "NEEDS_CLARIFICATION",
    validationOutcome: state === "NEEDS_CLARIFICATION" ? "NEEDS_CLARIFICATION" : state === "UNSUPPORTED_OPERATION" ? "UNSUPPORTED" : state === "CONTEXT_UNAVAILABLE" ? "CONTEXT_UNAVAILABLE" : "EXECUTABLE",
    selectedCapability: handoff ? handoff.intent : null,
    routingOutcome: state,
    parentRunId: null,
    childRunId: null,
    interpretationLatencyMs: 8,
    interpretationTokens: { input: 1, output: 1 },
    interpretationCostUsd: null,
    repairAttempts: 0,
    executionHandOffStatus: handoff ? "HANDED_OFF" : "REFUSED",
    errorCodes: [],
    queryChars: 24,
    queryHash: "synthetic0001",
  };
}

function interpretation(query, intent, extra = {}) {
  return {
    schemaVersion: QUERY,
    rawQuery: query,
    primaryIntent: intent,
    secondaryIntents: [],
    brand: { name: "Paper Lantern", source: "EXPLICIT" },
    brandsNamed: ["Paper Lantern"],
    territories: [],
    references: {},
    constraints: [],
    unresolvedReferences: [],
    systemDirectives: [],
    confidence: "HIGH",
    disposition: "EXECUTABLE",
    unsupportedCapabilities: [],
    interpretationWarnings: [],
    reasonCodes: [],
    interpreter: { kind: "scripted", model: "synthetic-fixture" },
    ...extra,
  };
}

function analysis(runId, territories) {
  return {
    schemaVersion: AGENT,
    runId,
    status: "COMPLETE",
    trace: { toolCalls: [] },
    brand: { id: "SYN-BR-PAPER", label: "Paper Lantern", type: "brand", resolution: "synthetic" },
    territories: territories.map((territory) => ({
      key: territory.key,
      label: territory.label ?? territory.name,
      role: "frontier_candidate",
      evidenceStatus: territory.evidenceStatus,
      analysisRoute: territory.analysisRoute,
      keyEvidence: ["Observed inside one synthetic response. Not a live Qloo call."],
      limitations: [{ code: "SYNTHETIC", detail: "Synthetic fixture. Not a live investigation." }],
      provenance: { correlationIds: ["SYN-CORR-1"] },
    })),
    summary: { text: "Synthetic fixture. This is not a live finding and not a recommendation.", source: "deterministic_template", claimValidation: { passed: true, violations: [] } },
    limitations: [{ code: "SYNTHETIC", detail: "Synthetic fixture. Not a live investigation." }],
    evidenceOrigin: "synthetic",
    layers: {
      qlooEvidence: {
        concepts: territories.map((territory) => ({ territoryKey: territory.key, label: `${territory.label ?? territory.name} concept`, correlationIds: ["SYN-CORR-1"] })),
        exemplars: [],
        qlooCalls: 0,
      },
      systemAnalysis: {
        routes: territories.map((territory) => ({ territoryKey: territory.key, route: territory.analysisRoute, classification: null, robustness: null, position: null })),
      },
    },
  };
}

const PARENT_TERRITORIES = [
  { name: "Coastal cooking", key: "coastal_cooking", evidenceStatus: "PARTIAL_EVIDENCE", analysisRoute: "PARTIAL_CULTURAL_ANALYSIS" },
  { name: "Clay studios", key: "clay_studios", evidenceStatus: "UNSUPPORTED", analysisRoute: "INSUFFICIENT_EVIDENCE" },
];

function investigated(queryId, runId, territories, link = null) {
  const handoff = { intent: "explore_frontier", brand: "Paper Lantern", territories: territories.map((territory) => territory.name), operation: link?.operation ?? "NEW_INVESTIGATION" };
  return checked({
    schemaVersion: QUERY,
    queryId,
    state: "INVESTIGATION_COMPLETED",
    interpretation: interpretation("synthetic", link ? "refine_territory" : "explore_frontier"),
    reasons: [],
    handoff,
    supportedAlternative: null,
    context: null,
    investigation: { runId, reused: false, link, result: analysis(runId, territories) },
    territories: territories.map((territory) => ({
      name: territory.name,
      investigationState: "INVESTIGATED",
      territoryKey: territory.key,
      evidenceStatus: territory.evidenceStatus,
      analysisRoute: territory.analysisRoute,
    })),
    nextOperations: link ? ["refine_territory", "switch_territory", "return_to_parent"] : ["refine_territory", "switch_territory", "analyze_move"],
    telemetry: telemetry(queryId, "INVESTIGATION_COMPLETED", "explore_frontier", handoff),
  });
}

function clarification(queryId, query) {
  return checked({
    schemaVersion: QUERY,
    queryId,
    state: "NEEDS_CLARIFICATION",
    interpretation: interpretation(query, "analyze_move", {
      brand: { name: null, source: "UNRESOLVED" },
      brandsNamed: [],
      disposition: "NEEDS_CLARIFICATION",
      clarificationQuestion: "Which brand should the investigation follow?",
      reasonCodes: [{ code: "BRAND_MISSING", detail: "No brand was named." }],
    }),
    reasons: [{ code: "BRAND_MISSING", detail: "No brand was named." }],
    handoff: null,
    supportedAlternative: null,
    context: null,
    investigation: null,
    territories: [],
    nextOperations: [],
    telemetry: telemetry(queryId, "NEEDS_CLARIFICATION", "analyze_move", null),
  });
}

function competitor(queryId) {
  const confirmQueryId = randomUUID();
  return {
    confirmQueryId,
    response: checked({
      schemaVersion: QUERY,
      queryId,
      state: "UNSUPPORTED_OPERATION",
      interpretation: interpretation("synthetic", "compare_brands", {
        brandsNamed: ["Paper Lantern", "Other Brand"],
        unsupportedCapabilities: ["compare_brands"],
        disposition: "UNSUPPORTED",
        territories: [{ name: "Clay studios", source: "EXPLICIT" }],
      }),
      reasons: [{ code: "UNSUPPORTED_OPERATION", detail: "compare_brands is recognized and not executable." }],
      handoff: null,
      supportedAlternative: {
        description: "Investigate Paper Lantern in clay studios. This does not compare brands.",
        equivalent: false,
        confirmQueryId,
        handoff: { intent: "analyze_move", brand: "Paper Lantern", territories: ["Clay studios"], operation: "NEW_INVESTIGATION" },
      },
      context: null,
      investigation: null,
      territories: [{ name: "Clay studios", investigationState: "NOT_INVESTIGATED", territoryKey: null, evidenceStatus: null, analysisRoute: null }],
      nextOperations: [],
      telemetry: telemetry(queryId, "UNSUPPORTED_OPERATION", "compare_brands", null),
    }),
  };
}

function whitespace(queryId) {
  return checked({
    schemaVersion: QUERY,
    queryId,
    state: "UNSUPPORTED_OPERATION",
    interpretation: interpretation("synthetic", "competitor_whitespace", {
      unsupportedCapabilities: ["competitor_whitespace"],
      disposition: "UNSUPPORTED",
    }),
    reasons: [{ code: "UNSUPPORTED_OPERATION", detail: "competitor_whitespace is recognized and not executable." }],
    handoff: null,
    supportedAlternative: null,
    context: null,
    investigation: null,
    territories: [],
    nextOperations: [],
    telemetry: telemetry(queryId, "UNSUPPORTED_OPERATION", "competitor_whitespace", null),
  });
}

function returned(queryId, parent, territoryKey = null) {
  return checked({
    schemaVersion: QUERY,
    queryId,
    state: "RETURNED_TO_INVESTIGATION",
    interpretation: interpretation("Return to the previous investigation.", "return_to_parent", {
      disposition: "NAVIGATION",
      references: { returnToRunId: parent.investigation.runId, ...(territoryKey ? { selectedTerritoryKey: territoryKey } : {}) },
    }),
    reasons: [],
    handoff: null,
    supportedAlternative: null,
    context: null,
    investigation: { runId: parent.investigation.runId, reused: true, link: parent.investigation.link, result: parent.investigation.result },
    territories: parent.territories,
    nextOperations: ["refine_territory", "switch_territory", "analyze_move"],
    telemetry: telemetry(queryId, "RETURNED_TO_INVESTIGATION", "return_to_parent", null),
  });
}

function interrupted(queryId, runId) {
  return checked({
    schemaVersion: QUERY,
    queryId,
    state: "INVESTIGATION_FAILED",
    interpretation: interpretation("Stop this investigation", "explore_frontier"),
    reasons: [{ code: "INVESTIGATION_CANCELLED", detail: "Stopped before a finding." }],
    handoff: null,
    supportedAlternative: null,
    context: null,
    investigation: { runId, reused: false, link: null, result: null },
    territories: [],
    nextOperations: [],
    telemetry: telemetry(queryId, "INVESTIGATION_FAILED", "explore_frontier", null),
  });
}

function responseFor(body) {
  const queryId = randomUUID();
  const runId = randomUUID();
  if (body.confirmQueryId) {
    return investigated(queryId, runId, [{ name: "Clay studios", key: "clay_studios", evidenceStatus: "PARTIAL_EVIDENCE", analysisRoute: "DESCRIPTIVE_ANALYSIS" }]);
  }
  if (body.navigateToRunId) {
    const parent = findRun(body.navigateToRunId);
    if (!parent) return missingParent(queryId);
    return returned(queryId, parent, body.territoryKey ?? null);
  }
  if (body.clarifyQueryId) return investigated(queryId, runId, PARENT_TERRITORIES);
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (query === "Ask without naming a brand") return clarification(queryId, query);
  if (query === "Where is the open space competitors leave?") return whitespace(queryId);
  if (query === "Compare Paper Lantern with another brand in clay studios") return competitor(queryId).response;
  if (query === "Return to the previous investigation.") {
    const parent = findRun(body.context?.runId);
    if (!parent) return missingParent(queryId);
    return returned(queryId, parent);
  }
  if (query === "more specific" || query === "explore deeper" || query === "something narrower") {
    return checked({
      schemaVersion: QUERY,
      queryId,
      state: "NEEDS_CLARIFICATION",
      interpretation: interpretation(query, "refine_territory", {
        disposition: "NEEDS_CLARIFICATION",
        clarificationQuestion: "What part of this territory would you like to explore?",
        reasonCodes: [{ code: "REFINEMENT_NOT_A_CONCEPT", detail: "The message does not name a cultural concept." }],
        references: { parentRunId: body.context?.runId },
      }),
      reasons: [{ code: "REFINEMENT_NOT_A_CONCEPT", detail: "The message does not name a cultural concept." }],
      handoff: null,
      supportedAlternative: null,
      context: null,
      investigation: null,
      territories: [],
      nextOperations: [],
      telemetry: telemetry(queryId, "NEEDS_CLARIFICATION", "refine_territory", null),
    });
  }
  if (body.context?.runId) {
    const parent = findRun(body.context.runId);
    if (!parent) return missingParent(queryId);
    const name = query.replace(/\.$/u, "");
    return investigated(queryId, runId, [{ name, key: "seasonal_dinners", evidenceStatus: "HYPOTHESIS_PENDING_VALIDATION", analysisRoute: "DESCRIPTIVE_ANALYSIS" }], {
      queryId,
      operation: "REFINE_TERRITORY",
      parentRunId: body.context.runId,
      selectedTerritoryKey: body.context.selectedTerritoryKey ?? null,
      inheritedBrand: { id: "SYN-BR-PAPER", label: "Paper Lantern" },
      constraints: [],
      reason: "The user asked for a narrower direction.",
    });
  }
  if (query === "Stop this investigation") return null;
  if (query === "Return a malformed investigation") return { schemaVersion: QUERY, queryId, state: "SUCCESS" };
  return investigated(queryId, runId, PARENT_TERRITORIES);
}

function missingParent(queryId) {
  return checked({
    schemaVersion: QUERY,
    queryId,
    state: "CONTEXT_UNAVAILABLE",
    interpretation: null,
    reasons: [{ code: "PARENT_NOT_FOUND", detail: "The earlier investigation is not held." }],
    handoff: null,
    supportedAlternative: null,
    context: null,
    investigation: null,
    territories: [],
    nextOperations: [],
    telemetry: telemetry(queryId, "CONTEXT_UNAVAILABLE", null, null),
  });
}

function findRun(runId) {
  if (!runId) return null;
  for (const job of jobs.values()) {
    const response = job.response;
    if (response?.investigation?.runId === runId && response.investigation.reused !== true) return response;
  }
  return null;
}

function envelope(job, includeToken) {
  return {
    jobId: job.jobId,
    ...(includeToken ? { accessToken: job.token } : {}),
    status: job.status,
    stage: job.stage,
    stageLabel: job.stageLabel,
    stopping: job.stopping,
    response: job.response,
    error: job.error,
  };
}

function accept(body) {
  if (!body || typeof body !== "object") return { status: 400, body: { error: "invalid_job_request", message: "The question could not be accepted." } };
  if (!body.confirmQueryId && !body.continueRunId && !body.clarifyQueryId && !body.navigateToRunId && (typeof body.query !== "string" || body.query.trim().length === 0)) {
    return { status: 400, body: { error: "invalid_job_request", message: "The question could not be accepted." } };
  }
  const job = {
    jobId: randomUUID(),
    token: randomUUID(),
    status: "running",
    stage: "interpreting",
    stageLabel: "Interpreting question",
    stopping: false,
    response: null,
    error: null,
    hang: body.query === "Stop this investigation",
  };
  jobs.set(job.jobId, job);
  const delay = job.hang ? 0 : 1200;
  if (!job.hang) {
    setTimeout(() => {
      if (job.status !== "running") return;
      const response = responseFor(body);
      if (body.query === "Return a malformed investigation") {
        job.status = "completed";
        job.stage = "done";
        job.stageLabel = "Findings ready";
        job.response = response;
        return;
      }
      job.status = "completed";
      job.stage = "done";
      job.stageLabel = "Findings ready";
      job.response = response;
    }, delay);
  }
  return { status: 202, body: envelope(job, true) };
}

function read(id, token) {
  const job = jobs.get(id);
  if (!job || job.token !== token) return { status: 404, body: { error: "job_not_found", message: "This investigation is no longer available. You can start a new one." } };
  return { status: 200, body: envelope(job, false) };
}

function cancel(id, token) {
  const job = jobs.get(id);
  if (!job || job.token !== token) return { status: 404, body: { error: "job_not_found", message: "This investigation is no longer available. You can start a new one." } };
  if (job.status === "running" || job.status === "queued") {
    job.status = "cancelled";
    job.stage = "done";
    job.stageLabel = "Findings ready";
    job.stopping = false;
    job.response = interrupted(randomUUID(), randomUUID());
    job.error = { code: "INVESTIGATION_CANCELLED", message: "The investigation was stopped. Partial observations were not recorded as findings." };
  }
  return { status: 200, body: envelope(job, false) };
}

const sampleParent = investigated(randomUUID(), randomUUID(), PARENT_TERRITORIES);
clarification(randomUUID(), "Ask without naming a brand");
whitespace(randomUUID());
competitor(randomUUID());
interrupted(randomUUID(), randomUUID());
returned(randomUUID(), sampleParent);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const send = (status, body) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    let payload = null;
    if (chunks.length > 0) {
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        send(400, { error: "invalid_job_request", message: "The question could not be accepted." });
        return;
      }
    }
    const token = request.headers["x-job-token"];
    const presented = typeof token === "string" ? token : "";
    const jobMatch = url.pathname.match(/^\/api\/agent\/jobs\/([^/]+)(\/cancel)?$/u);
    if (request.method === "POST" && url.pathname === "/api/agent/jobs") {
      const result = accept(payload);
      send(result.status, result.body);
      return;
    }
    if (jobMatch && request.method === "GET" && !jobMatch[2]) {
      const result = read(jobMatch[1], presented);
      send(result.status, result.body);
      return;
    }
    if (jobMatch && request.method === "POST" && jobMatch[2] === "/cancel") {
      const result = cancel(jobMatch[1], presented);
      send(result.status, result.body);
      return;
    }
    if (request.method === "GET" && url.pathname === "/health") {
      send(200, { status: "ok", fixtureType: "synthetic" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/ready") {
      // Sprint 9J: a private synthetic process with no operator token does not require one.
      send(200, { status: "ready", acceptingInvestigations: true, reasons: [], dependencies: { paidOperatorRequired: false } });
      return;
    }
    send(404, { error: "not_found", message: "This investigation is no longer available. You can start a new one." });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`synthetic atlas backend on ${PORT}\n`);
});
