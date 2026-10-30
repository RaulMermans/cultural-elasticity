/**
 * Skill registry: just-in-time skill selection, tool/action exposure and skill budgets.
 *
 *   selectSkills(state)     the skills relevant now (deterministic; from intent, state, readiness and
 *                           unresolved requirements). If none is relevant once the brand is resolved,
 *                           analyze_territories is the fallback, so the run can always analyze or finish.
 *   exposure(state)         the union of the active skills' tools and terminal actions, filtered by
 *                           phase. The model is offered nothing else, and the executor refuses anything else.
 *   attribute / recordTurn  usage per skill; a skill whose turn or Qloo-call budget is spent is
 *                           exhausted and deactivated (its work is then reported with what exists).
 */
import { policyOf } from "../research-intelligence.js";
import type { SkillRef } from "@cultural-elasticity/shared";
import { activeTerritories, derivePhase, type AgentRunState } from "../state.js";
import type { ToolRegistry } from "../tool-registry.js";
import { skillRef, type SkillDefinition, type SkillId, type TerminalAction } from "./contracts.js";
import { analyzeTerritoriesSkill, SKILLS } from "./definitions.js";

export class SkillRegistry {
  private readonly byId: Map<string, SkillDefinition>;
  constructor(readonly skills: readonly SkillDefinition[] = SKILLS) {
    this.byId = new Map(skills.map((s) => [s.id, s]));
  }

  get(id: SkillId | string): SkillDefinition | undefined {
    return this.byId.get(id);
  }

  list(): SkillDefinition[] {
    return [...this.skills];
  }

  /** Active skills for the current state, in registry order. */
  select(state: AgentRunState): SkillDefinition[] {
    if (state.pendingQuestion) return [];
    const intent = state.interpretation?.intent;
    const active = this.skills.filter((s) => (!intent || s.intents.includes(intent)) && !this.exhausted(state, s) && s.relevant(state));
    if (active.length === 0 && state.brand.entity) return [this.byId.get(analyzeTerritoriesSkill.id) ?? analyzeTerritoriesSkill];
    return active;
  }

  exhausted(state: AgentRunState, skill: SkillDefinition): boolean {
    return state.skillUsage.get(skill.id)?.exhausted === true;
  }

  /** Tools (phase-available) and terminal actions the active skills expose. */
  exposure(state: AgentRunState, tools: ToolRegistry, active: readonly SkillDefinition[] = this.select(state)): { tools: string[]; actions: TerminalAction[] } {
    const phase = derivePhase(state);
    const names = new Set(active.flatMap((s) => s.allowedTools));
    const v0 = policyOf(state) === "v0";
    const exposed = tools.list().filter((t) => names.has(t.name) && t.phases.includes(phase) && !(v0 && t.v1Only)).map((t) => t.name);
    const actions = [...new Set(active.flatMap((s) => s.allowedActions))];
    return { tools: exposed, actions };
  }

  /** The first active skill whose allowlist contains the tool (or action). */
  attribute(active: readonly SkillDefinition[], toolOrAction: string): SkillDefinition | undefined {
    return active.find((s) => s.allowedTools.includes(toolOrAction) || (s.allowedActions as readonly string[]).includes(toolOrAction));
  }

  private usage(state: AgentRunState, skill: SkillDefinition) {
    let entry = state.skillUsage.get(skill.id);
    if (!entry) {
      entry = { skill: skillRef(skill), turns: 0, qlooCalls: 0, toolCalls: 0, exhausted: false };
      state.skillUsage.set(skill.id, entry);
    }
    return entry;
  }

  /** The skill's Qloo-call limit now (scaled by in-scope territories for per-territory skills). */
  qlooLimit(state: AgentRunState, skill: SkillDefinition): number {
    return skill.budget.maxQlooCalls * (skill.budget.perTerritory ? Math.max(1, activeTerritories(state).length) : 1);
  }

  /** Only the turn budget deactivates a skill; a spent Qloo budget is enforced per call by the executor. */
  private refresh(state: AgentRunState, skill: SkillDefinition) {
    const entry = this.usage(state, skill);
    entry.exhausted = entry.turns >= skill.budget.maxTurns;
    entry.qlooSpent = skill.budget.maxQlooCalls > 0 && entry.qlooCalls >= this.qlooLimit(state, skill);
  }

  /** Called once per model turn with the skills that were active for it. */
  recordTurn(state: AgentRunState, active: readonly SkillDefinition[]): void {
    for (const skill of active) {
      this.usage(state, skill).turns += 1;
      this.refresh(state, skill);
    }
  }

  recordToolCall(state: AgentRunState, skill: SkillDefinition | undefined, qlooCalls: number): void {
    if (!skill) return;
    const entry = this.usage(state, skill);
    entry.toolCalls += 1;
    entry.qlooCalls += qlooCalls;
    this.refresh(state, skill);
  }

  /** Remaining Qloo calls a skill may still spend (Infinity when it has no Qloo budget of its own). */
  qlooCallsLeft(state: AgentRunState, skill: SkillDefinition): number {
    if (skill.budget.maxQlooCalls === 0) return 0;
    return Math.max(0, this.qlooLimit(state, skill) - (state.skillUsage.get(skill.id)?.qlooCalls ?? 0));
  }
}

export const refs = (skills: readonly SkillDefinition[]): SkillRef[] => skills.map(skillRef);
