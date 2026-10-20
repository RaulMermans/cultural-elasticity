/**
 * SkillEvalOutcome derivation: per-skill success and metrics from a FINISHED run (pure; reads the result
 * and its trace). This is the offline learning hook: eval code collects these per skill version. Nothing
 * here edits a skill, rewrites a prompt or persists anything.
 */
import type { AgentAnalysisResult } from "@cultural-elasticity/shared";
import { MIN_FRONTIER_SUPPORTED } from "../contracts.js";
import type { SkillEvalOutcome, SkillId } from "./contracts.js";

const ratio = (a: number, b: number) => (b === 0 ? null : Math.round((a / b) * 1000) / 1000);

export function skillOutcomes(result: AgentAnalysisResult): SkillEvalOutcome[] {
  const trace = result.trace;
  const usage = new Map(trace.skillUsage.map((u) => [u.skill.id, u]));
  const callsBy = (skill: string, tool?: string) => trace.toolCalls.filter((c) => c.skill?.id === skill && (!tool || c.tool === tool) && c.status !== "rejected");
  const territories = result.territories;
  const out: SkillEvalOutcome[] = [];
  const push = (skillId: SkillId, success: boolean, metrics: SkillEvalOutcome["metrics"], failureCategory?: SkillEvalOutcome["failureCategory"]) => {
    const u = usage.get(skillId);
    if (!u) return;
    out.push({ skillId, version: u.skill.version, runId: result.runId, success, ...(!success && failureCategory && { failureCategory }), metrics: { turns: u.turns, qlooCalls: u.qlooCalls, toolCalls: u.toolCalls, ...metrics } });
  };

  push("interpret_request", result.intent !== null, { intent: result.intent }, "MODEL_DECISION_ERROR");

  const describes = callsBy("resolve_brand", "qloo_resolve_entity").length;
  const ambiguous = trace.userClarifications.length > 0;
  push("resolve_brand", result.brand !== null, { describeCalls: describes, unnecessaryCalls: Math.max(0, describes - 1 - (ambiguous ? 1 : 0)), askedUser: ambiguous }, "ENTITY_RESOLUTION_ERROR");

  const inScope = territories.filter((t) => !t.representation.failure || t.representation.failure.code !== "DUPLICATE_TERRITORY");
  const anchored = inScope.filter((t) => t.resolvedConcept !== null).length;
  push("resolve_territory", anchored > 0, { territories: inScope.length, anchored, unresolved: inScope.length - anchored, findTagsCalls: callsBy("resolve_territory", "qloo_find_tags").length }, "TERRITORY_RESOLUTION_ERROR");

  const withConcept = territories.filter((t) => t.resolvedConcept !== null);
  const represented = withConcept.filter((t) => t.representation.exemplars.length > 0);
  const decisions = trace.representationQuality;
  const strategies = new Map<string, Set<string>>();
  for (const r of trace.representations) strategies.set(r.territoryKey, (strategies.get(r.territoryKey) ?? new Set()).add(String(r.attempt)));
  push(
    "build_territory_representation",
    represented.length > 0 || withConcept.every((t) => t.representation.strategy !== "UNSUPPORTED"),
    {
      anchored: withConcept.length,
      represented: represented.length,
      validRate: ratio(decisions.filter((d) => d.final === "VALID").length, decisions.length),
      qualityRejects: decisions.filter((d) => d.final === "REJECT").length,
      semanticVetoes: decisions.filter((d) => d.rule.startsWith("R2")).length,
      weakAccepted: decisions.filter((d) => d.final === "WEAK").length,
      averageAttempts: ratio(withConcept.reduce((n, t) => n + t.representation.attempts, 0), withConcept.length),
      fallbackUsed: withConcept.some((t) => t.representation.strategy === "CONDITIONED_ENTITY_EVIDENCE" || t.representation.attempts > 1),
    },
    "REPRESENTATION_ERROR",
  );

  const references = territories.filter((t) => t.role === "reference");
  push("build_comparison_set", territories.some((t) => t.role === "target" && t.analysisRoute === "FULL_RELATIVE_ANALYSIS"), { referencesProposed: references.length, referencesRepresented: references.filter((t) => t.representation.exemplars.length > 0).length }, "QLOO_DATA_LIMIT");

  const cs = result.comparisonSetConstruction;
  const frontierProposed = cs.proposed.filter((p) => p.role === "frontier_candidate");
  const frontierFinal = cs.final.filter((f) => f.role === "frontier_candidate" && f.route !== "INSUFFICIENT_EVIDENCE");
  const hypotheses = frontierProposed.filter((p) => p.source === "agent_hypothesis");
  push(
    "explore_candidate_territories",
    frontierFinal.length >= MIN_FRONTIER_SUPPORTED,
    {
      proposed: frontierProposed.length,
      final: frontierFinal.length,
      qlooSupportRate: ratio(frontierProposed.length - cs.rejected.filter((r) => r.stage === "qloo_support" || r.stage === "resolution").length, frontierProposed.length),
      duplicateRate: ratio(cs.rejected.filter((r) => r.stage === "dedup").length, frontierProposed.length),
      unsupportedHypothesisRate: ratio(cs.rejected.filter((r) => hypotheses.some((h) => h.key === r.key)).length, hypotheses.length),
      agentHypotheses: hypotheses.length,
      diversity: cs.diversity.assessment,
    },
    "CONCEPT_DUPLICATION_ERROR",
  );

  push("analyze_territories", result.status === "COMPLETE" && result.summary.claimValidation.passed, { methodologyRuns: result.methodologyRuns.length, finalSufficiency: result.finalSufficiency }, "ANALYSIS_ROUTE_ERROR");
  return out;
}
