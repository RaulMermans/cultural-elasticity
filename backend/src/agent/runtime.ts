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
 *
 * Sprint 4: each turn the skill registry activates only the relevant skills; the model sees only their
 * tools, actions and context sections, and the executor refuses anything else. When a turn produces no
 * accepted action and the rejections are actionable, the model gets ONE bounded repair attempt with the
 * validator's reasons (no generic self-reflection). When no material evidence gap remains and the model
 * still proposes nothing acceptable, the runtime analyzes the ready territories itself.
 */
import type { AgentDecisionTrace, AgentRunResponse } from "@cultural-elasticity/shared";
import { runAnalysis } from "./analysis-runner.js";
import { applyConceptDedup } from "./concept-dedup.js";
import { buildDecisionContext, contextSize } from "./context.js";
import { agentDecisionSchema, agentRequestSchema, type AgentDecision, type AgentRequest, type InvestigationLimits } from "./contracts.js";
import { AgentInputError, RunNotFoundError, RunNotWaitingError } from "./errors.js";
import { assessEvidenceSufficiency } from "./evidence-sufficiency.js";
import { finalize, needsInputResponse } from "./finalizer.js";
import { gateFrontierCandidates, pruneForDiversity } from "./frontier.js";
import { isReady, territoryReadiness } from "./readiness.js";
import type { TerminalAction } from "./skills/contracts.js";
import { refs, SkillRegistry } from "./skills/registry.js";
import type { AgentDecisionContext, AgentModel } from "./model/provider.js";
import { recordPlanRevision } from "./planner.js";
import { MAX_REFERENCE_DEFERRALS, referencePlan } from "./reference-strategy.js";
import { RunStore } from "./run-store.js";
import { activeTerritories, createRunState, derivePhase, remainingQlooCalls, TERMINAL_STATUSES, transition, type AgentRunState } from "./state.js";
import { AGENT_ALLOWED_PERMISSIONS, executeToolCall, openToolTrace, type SkillGate } from "./tool-executor.js";
import type { AgentToolProvider } from "./tool-provider.js";
import { ToolRegistry } from "./tool-registry.js";

export type AgentRuntimeDeps = {
  model: AgentModel;
  provider: AgentToolProvider;
  registry?: ToolRegistry;
  skills?: SkillRegistry;
  store?: RunStore;
};

/** Rejection codes a repair attempt can act on (the validator's reason tells the model what to change). */
const REPAIRABLE = new Set(["INVALID_MODEL_OUTPUT", "INVALID_DECISION", "UNKNOWN_TOOL", "INVALID_ARGUMENTS", "NOT_EXPOSED", "WRONG_PHASE", "PRECONDITION", "NOT_READY", "FINISH_BEFORE_SUFFICIENCY", "NOTHING_ANALYZED", "UNKNOWN_RESULT_IDS", "NO_OPEN_AMBIGUITY", "REFERENCES_PENDING"]);

type TurnOutcome = { stop: "needs_input" | "finish" | "failed" | null; lastTurn: AgentDecisionContext["lastTurn"] };

export class AgentRuntime {
  private readonly registry: ToolRegistry;
  private readonly skills: SkillRegistry;
  readonly store: RunStore;

  constructor(private readonly deps: AgentRuntimeDeps) {
    this.registry = deps.registry ?? new ToolRegistry();
    this.skills = deps.skills ?? new SkillRegistry();
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
          state.trace.sufficiency.push({ iteration: state.usage.iterations, verdict: sufficiency.verdict, reasons: [...sufficiency.reasons, ...sufficiency.nextSteps], nextActions: sufficiency.nextActions, materialGap: sufficiency.materialGap });
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
    const active = this.skills.select(state);
    const exposure = this.skills.exposure(state, this.registry, active);
    state.activeSkills = refs(active);
    const turnSkills = new Map(active.map((s) => [s.id, s]));
    const gate: SkillGate = { skills: this.skills, active, exposed: new Set(exposure.tools), actions: exposure.actions, seen: [] };
    const decisionsTrace: AgentDecisionTrace[] = [];
    const turnTrace: AgentRunState["trace"]["turns"][number] = {
      iteration: state.usage.iterations,
      decisions: decisionsTrace,
      usage: null,
      latencyMs: 0,
      skills: refs(active),
      toolsExposed: [...exposure.tools, ...exposure.actions],
      modelAttempts: 0,
      repairReason: null,
      firstAttemptValid: false,
    };
    state.trace.turns.push(turnTrace);

    let results: NonNullable<AgentDecisionContext["lastTurn"]>["results"] = [];
    let rejections: NonNullable<AgentDecisionContext["lastTurn"]>["rejections"] = [];
    let accepted = 0;
    let stop: TurnOutcome["stop"] = null;
    let repair: AgentDecisionContext["repair"] = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const context = buildDecisionContext(state, this.registry, lastTurn, { active, exposure, repair });
      const size = contextSize(context);
      turnTrace.contextChars = Math.max(turnTrace.contextChars ?? 0, size.chars);
      turnTrace.contextTokensEstimate = Math.max(turnTrace.contextTokensEstimate ?? 0, size.tokensEstimate);
      turnTrace.modelAttempts = attempt;
      results = [];
      rejections = [];
      // Each attempt starts from the turn-start exposure the model was shown.
      Object.assign(gate, { active, exposed: new Set(exposure.tools), actions: exposure.actions });
      const outcome = await this.attempt(state, context, turnTrace, decisionsTrace, results, rejections, exposure.actions, gate);
      accepted = outcome.accepted;
      stop = outcome.stop;
      if (attempt === 1) turnTrace.firstAttemptValid = outcome.valid;
      const repairable = rejections.filter((r) => REPAIRABLE.has(r.code));
      if (accepted > 0 || stop || repairable.length === 0 || attempt === 2) break;
      repair = { attempt: 2, rejections: repairable.slice(0, 8) };
      turnTrace.repairReason = repairable.map((r) => `${r.code}: ${r.reason}`).join(" | ").slice(0, 400);
    }
    if (turnTrace.invalidOutput && accepted > 0) delete turnTrace.invalidOutput;
    // Turn budgets count the skills the model was shown; skills activated mid-turn are traced (and get
    // tool-call attribution) but do not spend a turn.
    this.skills.recordTurn(state, active);
    for (const s of gate.seen ?? []) turnSkills.set(s.id, s);
    turnTrace.skills = refs([...turnSkills.values()]);

    recordPlanRevision(state, decisionsTrace.find((d) => d.accepted)?.reasonSummary ?? null);
    // A turn whose only refusals are bounded reference deferrals is a steering step, not an invalid model turn.
    const deferralOnly = rejections.length > 0 && rejections.every((r) => r.code === "REFERENCES_PENDING");
    if (accepted === 0) {
      if (!deferralOnly) state.usage.invalidTurnsInRow += 1;
      if (verdict === "SUFFICIENT") {
        state.trace.errors.push({ iteration: state.usage.iterations, code: "RUNTIME_FINALIZED_ON_SUFFICIENCY", detail: "the model did not finish after sufficiency; the runtime finalized" });
        state.trace.stopReason = { code: "RUNTIME_FINALIZED_ON_SUFFICIENCY", detail: "evidence was sufficient and the model proposed no acceptable action" };
        return { stop: "finish", lastTurn: { results, rejections } };
      }
      const assessment = assessEvidenceSufficiency(state);
      const ready = activeTerritories(state).filter((t) => t.status !== "analyzed" && isReady(territoryReadiness(state, t)));
      if (!assessment.materialGap && ready.length > 0 && state.brand.entity) {
        state.trace.errors.push({ iteration: state.usage.iterations, code: "RUNTIME_ANALYZED_NO_MATERIAL_GAP", detail: `no material evidence gap remained and the model proposed no acceptable action; the runtime analyzed ${ready.map((t) => t.key).join(", ")}` });
        await this.analyzeKeys(state, ready.map((t) => t.key));
        state.usage.invalidTurnsInRow = 0;
        return { stop: null, lastTurn: { results, rejections } };
      }
      if (this.invalidLimitReached(state, verdict)) return { stop: "failed", lastTurn: { results, rejections } };
    } else {
      state.usage.invalidTurnsInRow = 0;
    }
    return { stop, lastTurn: { results, rejections } };
  }

  /** One model call and the validation/execution of its decisions. */
  private async attempt(
    state: AgentRunState,
    context: AgentDecisionContext,
    turnTrace: AgentRunState["trace"]["turns"][number],
    decisionsTrace: AgentDecisionTrace[],
    results: NonNullable<AgentDecisionContext["lastTurn"]>["results"],
    rejections: NonNullable<AgentDecisionContext["lastTurn"]>["rejections"],
    actions: readonly TerminalAction[],
    gate: SkillGate,
  ): Promise<{ accepted: number; stop: TurnOutcome["stop"]; valid: boolean }> {
    let raw: unknown[] | { invalid: string };
    const started = Date.now();
    try {
      const modelTurn = await this.deps.model.decide(context);
      raw = modelTurn.decisions;
      if (modelTurn.usage) {
        const u = turnTrace.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
        u.inputTokens += modelTurn.usage.inputTokens;
        u.outputTokens += modelTurn.usage.outputTokens;
        u.cacheReadTokens = (u.cacheReadTokens ?? 0) + (modelTurn.usage.cacheReadTokens ?? 0);
        u.cacheCreationTokens = (u.cacheCreationTokens ?? 0) + (modelTurn.usage.cacheCreationTokens ?? 0);
        turnTrace.usage = u;
        state.usage.inputTokens += modelTurn.usage.inputTokens + (modelTurn.usage.cacheReadTokens ?? 0) + (modelTurn.usage.cacheCreationTokens ?? 0);
        state.usage.outputTokens += modelTurn.usage.outputTokens;
        state.usage.cacheReadTokens += modelTurn.usage.cacheReadTokens ?? 0;
        state.usage.cacheCreationTokens += modelTurn.usage.cacheCreationTokens ?? 0;
        state.usage.uncachedInputTokens += modelTurn.usage.inputTokens;
      }
    } catch (error) {
      raw = { invalid: `model call failed: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}` };
    }
    turnTrace.latencyMs += Date.now() - started;
    if (!Array.isArray(raw) || raw.length === 0) {
      const reason = Array.isArray(raw) ? "no decisions" : raw.invalid;
      turnTrace.invalidOutput = reason;
      rejections.push({ action: "turn", code: "INVALID_MODEL_OUTPUT", reason });
      decisionsTrace.push({ action: "turn", reasonSummary: "", accepted: false, rejection: `INVALID_MODEL_OUTPUT: ${reason}` });
      return { accepted: 0, stop: null, valid: false };
    }

    let accepted = 0;
    let invalid = 0;
    let stop: TurnOutcome["stop"] = null;
    const reject = (action: string, code: string, reason: string, extra: Partial<AgentDecisionTrace> = {}) => {
      invalid += 1;
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
      if (decision.action !== "call_tool" && !gate.actions.includes(decision.action)) {
        reject(decision.action, "NOT_EXPOSED", `${decision.action} is not offered by the active skills (${gate.active.map((s) => s.id).join(", ") || "none"})`, { reasonSummary: "reasonSummary" in decision ? (decision.reasonSummary ?? "") : "" });
        continue;
      }
      const outcome = await this.execute(state, decision, results, reject, gate, actions);
      if (outcome.accepted) {
        accepted += 1;
        this.refreshGate(state, gate);
        decisionsTrace.push({ action: decision.action, ...(decision.action === "call_tool" && { tool: decision.tool, arguments: decision.arguments }), reasonSummary: "reasonSummary" in decision ? (decision.reasonSummary ?? "") : "", accepted: true });
      }
      if (outcome.stop) stop = outcome.stop;
    }
    return { accepted, stop, valid: invalid === 0 && accepted > 0 };
  }

  /** Exposure follows state: after an accepted action, skills are re-selected for the rest of the turn. */
  private refreshGate(state: AgentRunState, gate: SkillGate): void {
    // Deduplicate as soon as resolution evidence exists (exact + structural only; see applyConceptDedup).
    applyConceptDedup(state, activeTerritories(state), false);
    const active = this.skills.select(state);
    const exposure = this.skills.exposure(state, this.registry, active);
    gate.active = active;
    gate.exposed = new Set(exposure.tools);
    gate.actions = exposure.actions;
    gate.seen = [...(gate.seen ?? []), ...active];
  }

  private invalidLimitReached(state: AgentRunState, _verdict: string): boolean {
    return state.usage.invalidTurnsInRow >= state.limits.maxInvalidTurns;
  }

  /** Deterministic pre-analysis gates (frontier validation, dedup, diversity), then analysis. */
  private async analyzeKeys(state: AgentRunState, keys: string[]): Promise<Awaited<ReturnType<typeof runAnalysis>>> {
    let kept = gateFrontierCandidates(state, keys);
    applyConceptDedup(state, activeTerritories(state));
    kept = kept.filter((k) => state.territories.some((t) => t.key === k && t.status !== "dropped"));
    if (state.interpretation?.intent === "explore_frontier") kept = pruneForDiversity(state, kept);
    if (kept.length === 0) return { ok: false, code: "NOTHING_TO_ANALYZE", reason: "every requested territory was unsupported, a duplicate, or out of scope" };
    transition(state, "ANALYZING", `analyze ${kept.join(", ")}`);
    const started = Date.now();
    const outcome = await runAnalysis(state, this.deps.provider, kept, (tool, permission, args) => openToolTrace(state, tool, permission, args));
    state.timing.analysisMs += Date.now() - started;
    transition(state, "INVESTIGATING", "analysis step done");
    return outcome;
  }

  private async execute(
    state: AgentRunState,
    decision: AgentDecision,
    results: NonNullable<AgentDecisionContext["lastTurn"]>["results"],
    reject: (action: string, code: string, reason: string, extra?: Partial<AgentDecisionTrace>) => void,
    gate: SkillGate,
    _actions: readonly TerminalAction[],
  ): Promise<{ accepted: boolean; stop: TurnOutcome["stop"] }> {
    switch (decision.action) {
      case "call_tool": {
        const execution = await executeToolCall(state, this.registry, this.deps.provider, decision.tool, decision.arguments, AGENT_ALLOWED_PERMISSIONS, gate);
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
        const requested = [...new Set(decision.targetIds)];
        const notReady = requested.flatMap((k) => {
          const t = state.territories.find((x) => x.key === k);
          if (!t) return [];
          const r = territoryReadiness(state, t);
          return r.state === "needs_concept" || r.state === "needs_representation" ? [`${k} (${r.reason})`] : [];
        });
        if (notReady.length > 0) {
          reject("analyze", "NOT_READY", `not ready for analysis: ${notReady.join("; ")}. Resolve or represent them first, declare_concept_only, or drop them`, { reasonSummary: decision.reasonSummary });
          return { accepted: false, stop: null };
        }
        // Sprint 5A: analyzing a target locks its route. While a meaningful comparison set is still feasible within
        // the budget, the decision is deferred (bounded: after MAX_REFERENCE_DEFERRALS the runtime stops deferring).
        const plan = referencePlan(state);
        if (plan.feasible && state.referenceDeferrals < MAX_REFERENCE_DEFERRALS && requested.some((k) => state.territories.find((t) => t.key === k)?.role === "target")) {
          state.referenceDeferrals += 1;
          reject("analyze", "REFERENCES_PENDING", `${plan.outstanding ?? plan.reason} (deferred once; if you analyze again now, the analysis proceeds and the result is PARTIAL)`, { reasonSummary: decision.reasonSummary });
          return { accepted: false, stop: null };
        }
        const outcome = await this.analyzeKeys(state, requested);
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
        const assessment = assessEvidenceSufficiency(state);
        const verdict = assessment.verdict;
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
        // Blockers are territory-level gaps (an in-scope territory not yet resolved or represented). More
        // references or frontier candidates would improve a result; their absence does not block finishing.
        const blocker = assessment.nextActions.find((a) => a.value === "HIGH" && a.target !== null && a.action !== "analyze" && a.action !== "finish");
        if (verdict === "MORE_EVIDENCE_USEFUL" && blocker && remainingQlooCalls(state) > 0) {
          reject("finish", "FINISH_BEFORE_SUFFICIENCY", `an unresolved blocker remains: ${blocker.action}${blocker.target ? ` (${blocker.target})` : ""}: ${blocker.reason}`, { reasonSummary: decision.reasonSummary });
          return { accepted: false, stop: null };
        }
        state.finishRequested = true;
        return { accepted: true, stop: "finish" };
      }
    }
  }

  private async complete(state: AgentRunState, reason: string): Promise<AgentRunResponse> {
    state.trace.stopReason ??= { code: reason === "evidence insufficient" ? "EVIDENCE_INSUFFICIENT" : reason === "agent finished" ? "AGENT_FINISHED" : "SUFFICIENT_AT_BUDGET", detail: reason };
    transition(state, "COMPLETE", reason);
    return this.finish(state);
  }

  private async exhausted(state: AgentRunState, reason: string): Promise<AgentRunResponse> {
    // Iterations are spent but represented territories may still be analyzable within the Qloo budget:
    // analysis is deterministic and needs no further agent decision.
    const pending = activeTerritories(state).filter((t) => t.status !== "analyzed" && t.concept !== null).map((t) => t.key);
    if (state.brand.entity && pending.length > 0 && remainingQlooCalls(state) > 0) {
      transition(state, "ANALYZING", "final deterministic analysis after the iteration budget");
      gateFrontierCandidates(state, pending);
      applyConceptDedup(state, activeTerritories(state));
      const kept = pending.filter((k) => state.territories.some((t) => t.key === k && t.status !== "dropped"));
      const started = Date.now();
      if (kept.length > 0) await runAnalysis(state, this.deps.provider, kept, (tool, permission, args) => openToolTrace(state, tool, permission, args));
      state.timing.analysisMs += Date.now() - started;
    }
    state.trace.stopReason ??= { code: "AGENT_BUDGET_EXHAUSTED", detail: reason };
    transition(state, "BUDGET_EXHAUSTED", reason);
    return this.finish(state);
  }

  private async fail(state: AgentRunState, reason: string): Promise<AgentRunResponse> {
    if (!TERMINAL_STATUSES.includes(state.status)) {
      transition(state, "FAILED", reason);
    }
    state.trace.errors.push({ iteration: state.usage.iterations, code: "RUN_FAILED", detail: reason });
    state.trace.stopReason ??= { code: "RUN_FAILED", detail: reason };
    return this.finish(state);
  }

  private async finish(state: AgentRunState): Promise<AgentRunResponse> {
    state.trace.skillUsage = [...state.skillUsage.values()].map(({ skill, turns, qlooCalls, toolCalls }) => ({ skill, turns, qlooCalls, toolCalls }));
    const result = await finalize(state, this.deps.model);
    state.final = result;
    return result;
  }
}
