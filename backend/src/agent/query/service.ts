/**
 * Query Intelligence service: the one entry point for natural-language investigation requests.
 *
 *   intake (zod) ─→ context (server-held runs only) ─→ ONE interpretation (model proposes)
 *   ─→ deterministic gate ─→ EXECUTABLE?  ─→ AgentRuntime.run(request, gate interpretation, link)
 *                          └→ otherwise    ─→ typed state (clarification, unsupported, partial, context unavailable)
 *
 * interpret() is a dry run: it never calls Qloo. execute() runs at most one investigation per query. confirm()
 * executes a query interpreted earlier (a dry run, or a supported alternative the user accepted) without
 * interpreting it again. The /api/agent/continue clarification path is separate and unchanged.
 */
import { createHash, randomUUID } from "node:crypto";
import { QUERY_SCHEMA_VERSION, type AgentRunResponse, type InvestigationLink, type QueryHandoff, type QueryIntent, type QueryInterpretation, type QueryReasonCode, type QueryResponse, type QueryState, type QueryTelemetry, type QueryTerritoryNode } from "@cultural-elasticity/shared";
import { priceUsd } from "../finalizer.js";
import type { AgentRuntime } from "../runtime.js";
import { resolveContext, interpreterContextView, type ResolvedContext } from "./context.js";
import type { ExplicitFields, QueryBody } from "./contracts.js";
import { runGate, type ExecutionPlan, type GateResult } from "./gate.js";
import type { InterpretOutcome, QueryInterpreter } from "./interpreter.js";

/** One interpreted query, kept (bounded, in memory) so it can be confirmed without a second interpretation. */
type QueryRecord = { queryId: string; plan: ExecutionPlan | null; alternative: ExecutionPlan | null; interpretation: QueryInterpretation; executed: boolean; telemetry: QueryTelemetry };

export class QueryStore {
  private readonly records = new Map<string, QueryRecord>();
  constructor(private readonly capacity = 200) {}
  put(record: QueryRecord): void {
    this.records.set(record.queryId, record);
    while (this.records.size > this.capacity) this.records.delete(this.records.keys().next().value as string);
  }
  get(queryId: string): QueryRecord | undefined {
    return this.records.get(queryId);
  }
}

export class QueryAlreadyExecutedError extends Error {
  constructor(readonly queryId: string) {
    super(`query ${queryId} was already executed`);
    this.name = "QueryAlreadyExecutedError";
  }
}

/** Real phases only. The atlas must not invent a stage the service did not emit. */
export type QueryProgress = { phase: "interpreting" | "investigating" | "preparing"; intent?: QueryHandoff["intent"] | null };

export type QueryHooks = {
  signal?: AbortSignal;
  onProgress?: (event: QueryProgress) => void;
  /** A real gate outcome, published before a long investigation. Territories are not yet investigated. */
  onPreview?: (response: QueryResponse) => void;
};

export type QueryServiceDeps = { runtime: AgentRuntime; interpreter: QueryInterpreter; queries?: QueryStore; log?: (telemetry: QueryTelemetry) => void };

export class QueryService {
  readonly queries: QueryStore;
  constructor(private readonly deps: QueryServiceDeps) {
    this.queries = deps.queries ?? new QueryStore();
  }

  /** Dry run: interpretation and validation only. No Qloo call, no run. */
  interpret(body: QueryBody, hooks?: QueryHooks): Promise<QueryResponse> {
    return this.handle(body, false, hooks);
  }

  /** Interprets and, if the gate approves, runs one investigation (new, or a follow-up of body.context). */
  execute(body: QueryBody, hooks?: QueryHooks): Promise<QueryResponse> {
    return this.handle(body, true, hooks);
  }

  /** Resumes a NEEDS_INPUT run. This is the existing continuation, wrapped so the atlas receives a QueryResponse. */
  async continueRun(runId: string, clarification: string, hooks?: QueryHooks): Promise<QueryResponse> {
    const telemetry = blankTelemetry(randomUUID(), clarification, []);
    telemetry.parentRunId = runId;
    if (hooks?.signal?.aborted) return this.cancelledResponse(telemetry, null, "Cancelled before the answer was applied.");
    hooks?.onProgress?.({ phase: "investigating", intent: null });
    const result = await this.deps.runtime.continue(runId, clarification, { signal: hooks?.signal });
    return this.finishRun(telemetry, null, result, hooks);
  }

  /** Executes a stored, already validated plan (the dry run's handoff or the accepted alternative). */
  async confirm(queryId: string, hooks?: QueryHooks): Promise<QueryResponse> {
    const record = this.queries.get(queryId);
    const telemetry = blankTelemetry(randomUUID(), "", []);
    if (!record) return this.respond({ telemetry, state: "CONTEXT_UNAVAILABLE", interpretation: null, errors: [{ code: "QUERY_NOT_FOUND", detail: `query ${queryId} is not held by this process (expired, evicted or restarted); send the question again` }] });
    if (record.executed) throw new QueryAlreadyExecutedError(queryId);
    if (record.interpretation.systemDirectives.length > 0) {
      record.plan = null;
      record.alternative = null;
      record.executed = true;
      return this.respond({
        telemetry: record.telemetry,
        state: "UNSUPPORTED_OPERATION",
        interpretation: record.interpretation,
        errors: [{ code: "DIRECTIVE_BLOCKS_CONFIRMATION", detail: "a rejected system directive cannot become executable through confirmation" }],
      });
    }
    const plan = record.plan ?? record.alternative;
    if (!plan) return this.respond({ telemetry: record.telemetry, state: stateFor(record.interpretation.disposition), interpretation: record.interpretation, errors: [{ code: "NOTHING_TO_CONFIRM", detail: "this query has no executable plan or supported alternative" }] });
    if (plan.link.parentRunId && !this.deps.runtime.store.get(plan.link.parentRunId)) {
      return this.respond({ telemetry: record.telemetry, state: "CONTEXT_UNAVAILABLE", interpretation: record.interpretation, errors: [{ code: "PARENT_NOT_FOUND", detail: `the parent run ${plan.link.parentRunId} is no longer held by this process` }] });
    }
    record.executed = true;
    const confirmed: QueryTelemetry = { ...record.telemetry, queryId: randomUUID() };
    return this.run(queryId, plan, record.interpretation, confirmed, record.alternative === plan, null, undefined, hooks);
  }

  private async handle(body: QueryBody, execute: boolean, hooks?: QueryHooks): Promise<QueryResponse> {
    const queryId = randomUUID();
    const explicit: ExplicitFields = { ...(body.brand && { brand: body.brand }), ...(body.intent && { intent: body.intent }), ...(body.territories && { territories: body.territories }) };
    const telemetry = blankTelemetry(queryId, body.query, Object.keys(explicit));
    if (hooks?.signal?.aborted) return this.cancelledResponse(telemetry, null, "Cancelled before interpretation started.");
    hooks?.onProgress?.({ phase: "interpreting" });

    // Context first: an unavailable parent is reported before any model call.
    let context: ResolvedContext | null = null;
    if (body.context) {
      telemetry.parentRunId = body.context.runId;
      const resolved = resolveContext(this.deps.runtime.store, body.context.runId, body.context.selectedTerritoryKey);
      if (!resolved.ok) return this.respond({ telemetry, state: "CONTEXT_UNAVAILABLE", interpretation: null, errors: [resolved.failure] });
      context = resolved.context;
    }

    const outcome = await this.deps.interpreter.interpret({ query: body.query, explicit, context: context ? interpreterContextView(context) : null });
    recordUsage(telemetry, outcome, this.deps.interpreter.info.model);
    if (!outcome.ok) return this.respond({ telemetry, state: "INTERPRETATION_FAILED", interpretation: null, context, errors: [{ code: outcome.code, detail: outcome.detail }] });

    const gate = runGate({ query: body.query, explicit, proposal: outcome.proposal, context, interpreter: this.deps.interpreter.info });
    const interpretation = gate.interpretation;
    telemetry.intent = interpretation.primaryIntent;
    telemetry.secondaryIntents = interpretation.secondaryIntents;
    telemetry.inheritedFieldNames = [...(interpretation.brand.source === "INHERITED" ? ["brand"] : []), ...(interpretation.territories.some((t) => t.source === "INHERITED") ? ["territories"] : [])];
    telemetry.validationOutcome = interpretation.disposition;
    telemetry.clarificationRequired = interpretation.disposition === "NEEDS_CLARIFICATION";
    telemetry.selectedCapability = gate.plan?.handoff.intent ?? null;
    telemetry.errorCodes = interpretation.reasonCodes.map((r) => r.code);
    this.queries.put({ queryId, plan: gate.plan, alternative: gate.alternative?.plan ?? null, interpretation, executed: false, telemetry });

    if (gate.navigation) {
      const target = this.deps.runtime.store.get(gate.navigation.runId);
      return this.respond({ telemetry, state: "RETURNED_TO_INVESTIGATION", interpretation, context, gate, investigation: target ? { runId: target.runId, reused: true, link: target.link, result: target.final } : null });
    }
    if (!gate.plan || !execute) {
      telemetry.executionHandOffStatus = gate.plan ? "NOT_ATTEMPTED" : "REFUSED";
      return this.respond({ telemetry, state: stateFor(interpretation.disposition), interpretation, context, gate });
    }
    if (hooks?.signal?.aborted) {
      const stored = this.queries.get(queryId);
      if (stored) {
        stored.plan = null;
        stored.alternative = null;
        stored.executed = true;
      }
      return this.cancelledResponse(telemetry, interpretation, "Cancelled before an investigation started.");
    }
    this.queries.get(queryId)!.executed = true;
    return this.run(queryId, gate.plan, interpretation, telemetry, false, context, gate, hooks);
  }

  private async run(queryId: string, plan: ExecutionPlan, interpretation: QueryInterpretation, telemetry: QueryTelemetry, alternative: boolean, context: ResolvedContext | null = null, gate?: GateResult, hooks?: QueryHooks): Promise<QueryResponse> {
    if (hooks?.signal?.aborted) return this.cancelledResponse(telemetry, interpretation, "Cancelled before an investigation started.");
    telemetry.executionHandOffStatus = "HANDED_OFF";
    telemetry.selectedCapability = plan.handoff.intent;
    hooks?.onProgress?.({ phase: "investigating", intent: plan.handoff.intent });
    const preview = this.respond({ telemetry, state: "INVESTIGATION_STARTED", interpretation, context, gate, handoff: plan.handoff, silent: true });
    hooks?.onPreview?.(structuredClone(preview));
    const link = { ...plan.link, queryId };
    const result = await this.deps.runtime.run(plan.request, undefined, { interpretation: plan.interpretation, link, signal: hooks?.signal });
    telemetry.childRunId = result.runId;
    const warnings: string[] = [];
    // The inherited brand was handed over by id; the child re-resolved it in Qloo. A different entity is reported, not hidden.
    if (link.inheritedBrand && result.status !== "NEEDS_INPUT" && result.brand && result.brand.id !== link.inheritedBrand.id) warnings.push(`INHERITED_BRAND_MISMATCH: the child run resolved ${result.brand.id}, not the parent's ${link.inheritedBrand.id}`);
    if (alternative) warnings.push("SUPPORTED_ALTERNATIVE_EXECUTED: the user confirmed a smaller task; the original request was not performed in full");
    const shown: QueryInterpretation = warnings.length ? { ...interpretation, interpretationWarnings: [...interpretation.interpretationWarnings, ...warnings] } : interpretation;
    return this.finishRun(telemetry, shown, result, hooks, context, gate, plan.handoff, link);
  }

  private finishRun(
    telemetry: QueryTelemetry,
    interpretation: QueryInterpretation | null,
    result: AgentRunResponse,
    hooks?: QueryHooks,
    context: ResolvedContext | null = null,
    gate?: GateResult,
    handoff?: QueryHandoff,
    link: InvestigationLink | null = null,
  ): QueryResponse {
    const stop = result.status === "NEEDS_INPUT" ? null : result.trace.stopReason;
    const cancelled = stop?.code === "INVESTIGATION_CANCELLED";
    if (!cancelled) hooks?.onProgress?.({ phase: "preparing", intent: handoff?.intent ?? null });
    const runLink = link ?? (result.status !== "NEEDS_INPUT" ? result.trace.investigationLink ?? null : null);
    return this.respond({
      telemetry,
      state: investigationState(result),
      interpretation,
      context,
      ...(gate && { gate }),
      ...(handoff && { handoff }),
      investigation: { runId: result.runId, reused: link === null, link: runLink, result },
      ...(cancelled && { errors: [{ code: "INVESTIGATION_CANCELLED", detail: stop?.detail ?? "the investigation was cancelled" }] }),
    });
  }

  private cancelledResponse(telemetry: QueryTelemetry, interpretation: QueryInterpretation | null, detail: string): QueryResponse {
    return this.respond({ telemetry, state: "INVESTIGATION_FAILED", interpretation, errors: [{ code: "INVESTIGATION_CANCELLED", detail }] });
  }

  private respond(input: {
    telemetry: QueryTelemetry;
    state: QueryState;
    interpretation: QueryInterpretation | null;
    context?: ResolvedContext | null;
    gate?: GateResult;
    handoff?: QueryHandoff;
    investigation?: QueryResponse["investigation"];
    errors?: QueryReasonCode[];
    /** Preview responses are not logged; the terminal response is. */
    silent?: boolean;
  }): QueryResponse {
    const { telemetry, state, gate } = input;
    telemetry.routingOutcome = state;
    if (input.errors) telemetry.errorCodes = [...telemetry.errorCodes, ...input.errors.map((e) => e.code)];
    const interpretation = input.interpretation && input.errors?.length ? { ...input.interpretation, reasonCodes: [...input.interpretation.reasonCodes, ...input.errors] } : input.interpretation;
    const result = input.investigation?.result ?? null;
    const response: QueryResponse = {
      schemaVersion: QUERY_SCHEMA_VERSION,
      queryId: telemetry.queryId,
      state,
      interpretation,
      reasons: [...(interpretation?.reasonCodes ?? input.errors ?? [])],
      handoff: input.handoff ?? gate?.plan?.handoff ?? null,
      supportedAlternative: gate?.alternative ? { description: gate.alternative.description, handoff: gate.alternative.plan.handoff, equivalent: false, confirmQueryId: telemetry.queryId } : null,
      context: input.context?.view ?? null,
      investigation: input.investigation ?? null,
      territories: territoryNodes(interpretation, result),
      nextOperations: nextOperations(state, result),
      telemetry,
    };
    if (!input.silent) this.deps.log?.(telemetry);
    return response;
  }
}

function blankTelemetry(queryId: string, query: string, explicitFields: string[]): QueryTelemetry {
  return {
    queryId,
    schemaVersion: QUERY_SCHEMA_VERSION,
    intent: null,
    secondaryIntents: [],
    explicitFields,
    inheritedFieldNames: [],
    clarificationRequired: false,
    validationOutcome: null,
    selectedCapability: null,
    routingOutcome: "INTERPRETED",
    parentRunId: null,
    childRunId: null,
    interpretationLatencyMs: 0,
    interpretationTokens: { input: 0, output: 0 },
    interpretationCostUsd: null,
    repairAttempts: 0,
    executionHandOffStatus: "NOT_ATTEMPTED",
    errorCodes: [],
    queryChars: query.length,
    queryHash: createHash("sha256").update(query).digest("hex").slice(0, 12),
  };
}

function recordUsage(telemetry: QueryTelemetry, outcome: InterpretOutcome, model: string | undefined): void {
  const u = outcome.usage;
  telemetry.interpretationLatencyMs = outcome.latencyMs;
  telemetry.repairAttempts = outcome.repairs;
  telemetry.interpretationTokens = { input: u.inputTokens + (u.cacheReadTokens ?? 0) + (u.cacheCreationTokens ?? 0), output: u.outputTokens };
  const usd = model ? priceUsd(model, { uncachedInputTokens: u.inputTokens, cacheReadTokens: u.cacheReadTokens ?? 0, cacheCreationTokens: u.cacheCreationTokens ?? 0, outputTokens: u.outputTokens }) : null;
  telemetry.interpretationCostUsd = usd === null ? null : Math.round(usd * 1_000_000) / 1_000_000;
}

function stateFor(disposition: QueryInterpretation["disposition"]): QueryState {
  switch (disposition) {
    case "EXECUTABLE":
      return "INTERPRETED";
    case "NEEDS_CLARIFICATION":
      return "NEEDS_CLARIFICATION";
    case "PARTIALLY_SUPPORTED":
      return "PARTIALLY_SUPPORTED";
    case "UNSUPPORTED":
      return "UNSUPPORTED_OPERATION";
    case "CONTEXT_UNAVAILABLE":
      return "CONTEXT_UNAVAILABLE";
    case "NAVIGATION":
      return "RETURNED_TO_INVESTIGATION";
  }
}

function investigationState(result: AgentRunResponse): QueryState {
  if (result.status === "NEEDS_INPUT") return "INVESTIGATION_NEEDS_INPUT";
  if (result.status === "COMPLETE") return "INVESTIGATION_COMPLETED";
  if (result.status === "BUDGET_EXHAUSTED") return "INVESTIGATION_INCOMPLETE";
  return "INVESTIGATION_FAILED";
}

const norm = (s: string) => s.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();

/**
 * Atlas territory nodes. A requested territory the runtime never received is NOT_INVESTIGATED; one it handled is
 * INVESTIGATED with the result's own evidence status and route (which may say UNSUPPORTED). Frontier candidates the
 * runtime discovered are listed too.
 */
function territoryNodes(interpretation: QueryInterpretation | null, result: AgentRunResponse | null): QueryTerritoryNode[] {
  const done = result && result.status !== "NEEDS_INPUT" ? result.territories : [];
  const nodes: QueryTerritoryNode[] = (interpretation?.territories ?? []).map((t) => {
    const hit = done.find((r) => r.role === "target" && norm(r.label) === norm(t.name));
    return hit ? { name: t.name, investigationState: "INVESTIGATED", territoryKey: hit.key, evidenceStatus: hit.evidenceStatus ?? null, analysisRoute: hit.analysisRoute } : { name: t.name, investigationState: "NOT_INVESTIGATED", territoryKey: null, evidenceStatus: null, analysisRoute: null };
  });
  for (const r of done) {
    if (nodes.some((n) => n.territoryKey === r.key)) continue;
    if (r.role === "frontier_candidate" || r.role === "target") nodes.push({ name: r.label, investigationState: "INVESTIGATED", territoryKey: r.key, evidenceStatus: r.evidenceStatus ?? null, analysisRoute: r.analysisRoute });
  }
  return nodes;
}

/** Follow-up operations the runtime can execute from this state (a capability list, not content suggestions). */
function nextOperations(state: QueryState, result: AgentRunResponse | null): QueryIntent[] {
  const hasBrand = result && result.status !== "NEEDS_INPUT" && result.brand !== null;
  if (!hasBrand) return [];
  if (state !== "INVESTIGATION_COMPLETED" && state !== "INVESTIGATION_INCOMPLETE" && state !== "RETURNED_TO_INVESTIGATION") return [];
  const hasTarget = result.territories.some((t) => t.role === "target" || t.role === "frontier_candidate");
  return ["explore_frontier", "analyze_move", "compare_territories", ...(hasTarget ? (["refine_territory", "switch_territory"] as const) : []), ...(result.trace.investigationLink?.parentRunId ? (["return_to_parent"] as const) : [])];
}
