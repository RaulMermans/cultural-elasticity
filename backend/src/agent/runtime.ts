/**
 * Agentic Investigation Runtime: one agent, typed tools, deterministic engine, bounded loop.
 *
 *   request ─→ deterministic intake (zod) ─→ loop:
 *       sufficiency (deterministic) ─→ stop? ─→ finalize
 *       model.decide(context built from state) ─→ validate each decision
 *       ─→ execute (tools / analyze / ask_user / finish) ─→ state updated by code ─→ trace
 *   ─→ finalize: deterministic results + validated synthesis
 *
 * Bounds: iterations, Qloo calls, representation attempts, candidate territories, exemplars, actions
 * per turn, retries, consecutive invalid turns, tool timeouts. The loop cannot run unbounded.
 */
import type { AgentDecisionTrace, AgentRunResponse } from "@cultural-elasticity/shared";
import { runAnalysis } from "./analysis-runner.js";
import { territoryDuplicates } from "./candidate-discovery.js";
import { buildDecisionContext } from "./context.js";
import { agentDecisionSchema, agentRequestSchema, type AgentDecision, type AgentRequest, type InvestigationLimits } from "./contracts.js";
import { AgentInputError, RunNotFoundError, RunNotWaitingError } from "./errors.js";
import { assessEvidenceSufficiency } from "./evidence-sufficiency.js";
import { finalize, needsInputResponse } from "./finalizer.js";
import type { AgentDecisionContext, AgentModel } from "./model/provider.js";
import { recordPlanRevision } from "./planner.js";
import { RunStore } from "./run-store.js";
import { activeTerritories, createRunState, derivePhase, remainingQlooCalls, TERMINAL_STATUSES, transition, type AgentRunState } from "./state.js";
import { executeToolCall, openToolTrace } from "./tool-executor.js";
import type { AgentToolProvider } from "./tool-provider.js";
import { ToolRegistry } from "./tool-registry.js";

export type AgentRuntimeDeps = {
  model: AgentModel;
  provider: AgentToolProvider;
  registry?: ToolRegistry;
  store?: RunStore;
};

type TurnOutcome = { stop: "needs_input" | "finish" | "failed" | null; lastTurn: AgentDecisionContext["lastTurn"] };

export class AgentRuntime {
  private readonly registry: ToolRegistry;
  readonly store: RunStore;

  constructor(private readonly deps: AgentRuntimeDeps) {
    this.registry = deps.registry ?? new ToolRegistry();
    this.store = deps.store ?? new RunStore();
  }

  /** Validates the request (throws AgentInputError) and runs until COMPLETE, NEEDS_INPUT, FAILED or BUDGET_EXHAUSTED. */
  async run(rawRequest: unknown, limits?: InvestigationLimits): Promise<AgentRunResponse> {
    const parsed = agentRequestSchema.safeParse(rawRequest);
    if (!parsed.success) throw new AgentInputError(parsed.error.issues.map((i) => ({ path: i.path.map(String).join(".") || "(root)", message: i.message })));
    const state = createRunState(parsed.data as AgentRequest, this.deps.model.info, { name: this.deps.provider.name, mode: this.deps.provider.mode, evidenceSource: this.deps.provider.evidenceSource }, limits);
    this.store.put(state);
    transition(state, "PLANNING", "request validated");
    return this.loop(state);
  }

  /** Resumes a NEEDS_INPUT run with the user's clarification. Budgets already spent stay spent. */
  async continue(runId: string, clarification: string): Promise<AgentRunResponse> {
    const state = this.store.get(runId);
    if (!state) throw new RunNotFoundError(runId);
    if (state.status !== "NEEDS_INPUT") throw new RunNotWaitingError(runId, state.status);
    const text = clarification.trim().slice(0, 1_000);
    if (!text) throw new AgentInputError([{ path: "clarification", message: "must be non-empty" }]);
    state.clarifications.push(text);
    state.trace.userClarifications.push(text);
    state.pendingQuestion = null;
    transition(state, "PLANNING", "user clarification received");
    return this.loop(state);
  }

  private async loop(state: AgentRunState): Promise<AgentRunResponse> {
    let lastTurn: AgentDecisionContext["lastTurn"] = null;
    try {
      for (;;) {
        this.syncPhase(state);
        const sufficiency = assessEvidenceSufficiency(state);
        const lastVerdict = state.trace.sufficiency.at(-1);
        if (!lastVerdict || lastVerdict.verdict !== sufficiency.verdict || lastVerdict.reasons.join() !== sufficiency.reasons.join()) {
          state.trace.sufficiency.push({ iteration: state.usage.iterations, verdict: sufficiency.verdict, reasons: [...sufficiency.reasons, ...sufficiency.nextSteps] });
        }
        // Sufficient with no iteration left: finalize without granting an extra turn.
        if (sufficiency.verdict === "SUFFICIENT" && state.usage.iterations >= state.limits.maxAgentIterations) return await this.complete(state, "sufficient at the iteration budget");
        if (state.finishRequested || sufficiency.verdict === "INSUFFICIENT") return await this.complete(state, sufficiency.verdict === "INSUFFICIENT" ? "evidence insufficient" : "agent finished");
        if (sufficiency.verdict === "BUDGET_EXHAUSTED") return await this.exhausted(state, sufficiency.reasons.join("; "));
        if (sufficiency.verdict === "NEEDS_USER_INPUT" && state.pendingQuestion) return needsInputResponse(state);

        state.usage.iterations += 1;
        const turn = await this.turn(state, lastTurn, sufficiency.verdict);
        lastTurn = turn.lastTurn;
        if (turn.stop === "needs_input") return needsInputResponse(state);
        if (turn.stop === "failed") return await this.fail(state, `model produced no valid action for ${state.limits.maxInvalidTurns} consecutive turns`);
        if (turn.stop === "finish") return await this.complete(state, "agent finished");
      }
    } catch (error) {
      state.trace.errors.push({ iteration: state.usage.iterations, code: "RUNTIME_ERROR", detail: error instanceof Error ? error.message.slice(0, 500) : String(error) });
      return this.fail(state, "runtime error");
    }
  }

  private syncPhase(state: AgentRunState): void {
    if (TERMINAL_STATUSES.includes(state.status) || state.status === "NEEDS_INPUT") return;
    const phase = derivePhase(state);
    if (phase !== state.status && phase !== "NEEDS_INPUT") transition(state, phase, "evidence changed the working phase");
  }

  private async turn(state: AgentRunState, lastTurn: AgentDecisionContext["lastTurn"], verdict: string): Promise<TurnOutcome> {
    const context = buildDecisionContext(state, this.registry, lastTurn);
    const started = Date.now();
    const decisionsTrace: AgentDecisionTrace[] = [];
    const results: NonNullable<AgentDecisionContext["lastTurn"]>["results"] = [];
    const rejections: NonNullable<AgentDecisionContext["lastTurn"]>["rejections"] = [];
    const turnTrace: AgentRunState["trace"]["turns"][number] = { iteration: state.usage.iterations, decisions: decisionsTrace, usage: null, latencyMs: 0 };
    state.trace.turns.push(turnTrace);

    let raw: unknown[] | { invalid: string };
    try {
      const modelTurn = await this.deps.model.decide(context);
      raw = modelTurn.decisions;
      if (modelTurn.usage) {
        turnTrace.usage = modelTurn.usage;
        state.usage.inputTokens += modelTurn.usage.inputTokens;
        state.usage.outputTokens += modelTurn.usage.outputTokens;
      }
    } catch (error) {
      raw = { invalid: `model call failed: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}` };
    }
    turnTrace.latencyMs = Date.now() - started;

    const invalidTurn = (reason: string): TurnOutcome => {
      turnTrace.invalidOutput = reason;
      state.usage.invalidTurnsInRow += 1;
      rejections.push({ action: "turn", code: "INVALID_MODEL_OUTPUT", reason });
      return { stop: this.invalidLimitReached(state, verdict) ? (verdict === "SUFFICIENT" ? "finish" : "failed") : null, lastTurn: { results, rejections } };
    };
    if (!Array.isArray(raw)) return invalidTurn(raw.invalid);
    if (raw.length === 0) return invalidTurn("no decisions");

    let accepted = 0;
    let stop: TurnOutcome["stop"] = null;
    const reject = (action: string, code: string, reason: string, extra: Partial<AgentDecisionTrace> = {}) => {
      decisionsTrace.push({ action, reasonSummary: extra.reasonSummary ?? "", accepted: false, rejection: `${code}: ${reason}`, ...extra });
      rejections.push({ action: extra.tool ?? action, code, reason });
    };

    for (const [index, item] of raw.entries()) {
      if (stop) {
        reject("ignored", "AFTER_TERMINAL_ACTION", "a terminal action (analyze/ask_user/finish) must be the last decision of a turn");
        continue;
      }
      if (index >= state.limits.maxActionsPerTurn) {
        reject("ignored", "TOO_MANY_ACTIONS", `at most ${state.limits.maxActionsPerTurn} actions per turn`);
        continue;
      }
      const parsed = agentDecisionSchema.safeParse(item);
      if (!parsed.success) {
        reject(typeof (item as { action?: unknown })?.action === "string" ? String((item as { action: string }).action) : "unknown", "INVALID_DECISION", parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "));
        continue;
      }
      const decision = parsed.data;
      const outcome = await this.execute(state, decision, results, reject);
      if (outcome.accepted) {
        accepted += 1;
        decisionsTrace.push({ action: decision.action, ...(decision.action === "call_tool" && { tool: decision.tool, arguments: decision.arguments }), reasonSummary: "reasonSummary" in decision ? (decision.reasonSummary ?? "") : "", accepted: true });
      }
      if (outcome.stop) stop = outcome.stop;
    }
    recordPlanRevision(state, decisionsTrace.find((d) => d.accepted)?.reasonSummary ?? null);
    if (accepted === 0) {
      state.usage.invalidTurnsInRow += 1;
      if (verdict === "SUFFICIENT") {
        state.trace.errors.push({ iteration: state.usage.iterations, code: "RUNTIME_FINALIZED_ON_SUFFICIENCY", detail: "the model did not finish after sufficiency; the runtime finalized" });
        return { stop: "finish", lastTurn: { results, rejections } };
      }
      if (this.invalidLimitReached(state, verdict)) return { stop: "failed", lastTurn: { results, rejections } };
    } else {
      state.usage.invalidTurnsInRow = 0;
    }
    return { stop, lastTurn: { results, rejections } };
  }

  private invalidLimitReached(state: AgentRunState, _verdict: string): boolean {
    return state.usage.invalidTurnsInRow >= state.limits.maxInvalidTurns;
  }

  private async execute(
    state: AgentRunState,
    decision: AgentDecision,
    results: NonNullable<AgentDecisionContext["lastTurn"]>["results"],
    reject: (action: string, code: string, reason: string, extra?: Partial<AgentDecisionTrace>) => void,
  ): Promise<{ accepted: boolean; stop: TurnOutcome["stop"] }> {
    switch (decision.action) {
      case "call_tool": {
        const execution = await executeToolCall(state, this.registry, this.deps.provider, decision.tool, decision.arguments);
        if (!execution.accepted) {
          reject("call_tool", execution.code, execution.reason, { tool: decision.tool, arguments: decision.arguments, reasonSummary: decision.reasonSummary });
          return { accepted: false, stop: null };
        }
        results.push({ tool: decision.tool, status: execution.result.status, summary: execution.result.summary, ...(execution.result.data !== undefined && { data: execution.result.data }) });
        return { accepted: true, stop: null };
      }
      case "analyze": {
        const verdict = assessEvidenceSufficiency(state).verdict;
        if (verdict === "NEEDS_USER_INPUT") {
          reject("analyze", "NEEDS_USER_INPUT", "resolve the open ambiguity first", { reasonSummary: decision.reasonSummary });
          return { accepted: false, stop: null };
        }
        const keys = this.dropFrontierDuplicates(state, [...new Set(decision.targetIds)]);
        if (keys.length === 0) {
          reject("analyze", "NOTHING_TO_ANALYZE", "every requested territory was a duplicate or is out of scope", { reasonSummary: decision.reasonSummary });
          return { accepted: false, stop: null };
        }
        transition(state, "ANALYZING", `analyze ${keys.join(", ")}`);
        const outcome = await runAnalysis(state, this.deps.provider, keys, (tool, permission, args) => openToolTrace(state, tool, permission, args));
        transition(state, "INVESTIGATING", "analysis step done");
        if (!outcome.ok) {
          reject("analyze", outcome.code, outcome.reason, { reasonSummary: decision.reasonSummary });
          return { accepted: false, stop: null };
        }
        results.push({ tool: "analyze", status: "ok", summary: outcome.summary });
        return { accepted: true, stop: null };
      }
      case "ask_user": {
        const open = !state.interpretation || (state.brand.ambiguity && !state.brand.entity) || (state.brand.notFound && !state.brand.entity) || activeTerritories(state).some((t) => !t.concept && t.status !== "analyzed");
        if (!open) {
          reject("ask_user", "NO_OPEN_AMBIGUITY", "nothing requires the user; resolve with Qloo evidence", { reasonSummary: decision.reasonSummary ?? "" });
          return { accepted: false, stop: null };
        }
        const options = state.brand.ambiguity && !state.brand.entity ? state.brand.ambiguity.candidates.map((c) => ({ id: c.qlooId, label: c.label, ...(c.type !== undefined && { type: c.type }) })) : [];
        state.pendingQuestion = { question: decision.question, ambiguity: decision.ambiguity, options };
        transition(state, "NEEDS_INPUT", decision.ambiguity);
        return { accepted: true, stop: "needs_input" };
      }
      case "finish": {
        const verdict = assessEvidenceSufficiency(state).verdict;
        const unknown = decision.resultIds.filter((id) => !state.territories.some((t) => t.key === id));
        if (unknown.length > 0) {
          reject("finish", "UNKNOWN_RESULT_IDS", unknown.join(", "), { reasonSummary: decision.reasonSummary });
          return { accepted: false, stop: null };
        }
        if (verdict === "NEEDS_USER_INPUT") {
          reject("finish", "NEEDS_USER_INPUT", "an ambiguity is open; ask the user", { reasonSummary: decision.reasonSummary });
          return { accepted: false, stop: null };
        }
        const pending = activeTerritories(state).some((t) => t.status !== "analyzed");
        if (verdict === "MORE_EVIDENCE_USEFUL" && state.results.size === 0 && pending && remainingQlooCalls(state) > 0) {
          reject("finish", "NOTHING_ANALYZED", "territories are pending and nothing has been analyzed yet; analyze what has evidence or drop unsupported territories", { reasonSummary: decision.reasonSummary });
          return { accepted: false, stop: null };
        }
        state.finishRequested = true;
        return { accepted: true, stop: "finish" };
      }
    }
  }

  /** Frontier candidates that duplicate an earlier territory are dropped before analysis (DUPLICATE_TERRITORY). */
  private dropFrontierDuplicates(state: AgentRunState, keys: string[]): string[] {
    for (const finding of territoryDuplicates(state, activeTerritories(state))) {
      const t = state.territories.find((x) => x.key === finding.key);
      if (!t || t.role !== "frontier_candidate" || t.status === "analyzed") continue;
      t.status = "dropped";
      t.dropReason = { code: "DUPLICATE_TERRITORY", detail: `duplicates ${finding.duplicateOf}: ${finding.detail}` };
    }
    return keys.filter((k) => state.territories.some((t) => t.key === k && t.status !== "dropped"));
  }

  private async complete(state: AgentRunState, reason: string): Promise<AgentRunResponse> {
    transition(state, "COMPLETE", reason);
    return this.finish(state);
  }

  private async exhausted(state: AgentRunState, reason: string): Promise<AgentRunResponse> {
    // Iterations are spent but represented territories may still be analyzable within the Qloo budget:
    // analysis is deterministic and needs no further agent decision.
    const pending = activeTerritories(state).filter((t) => t.status !== "analyzed" && t.concept !== null).map((t) => t.key);
    if (state.brand.entity && pending.length > 0 && remainingQlooCalls(state) > 0) {
      transition(state, "ANALYZING", "final deterministic analysis after the iteration budget");
      await runAnalysis(state, this.deps.provider, pending, (tool, permission, args) => openToolTrace(state, tool, permission, args));
    }
    transition(state, "BUDGET_EXHAUSTED", reason);
    return this.finish(state);
  }

  private async fail(state: AgentRunState, reason: string): Promise<AgentRunResponse> {
    if (!TERMINAL_STATUSES.includes(state.status)) {
      transition(state, "FAILED", reason);
    }
    state.trace.errors.push({ iteration: state.usage.iterations, code: "RUN_FAILED", detail: reason });
    return this.finish(state);
  }

  private async finish(state: AgentRunState): Promise<AgentRunResponse> {
    const result = await finalize(state, this.deps.model);
    state.final = result;
    return result;
  }
}
