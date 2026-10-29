/**
 * Measurement-first comparison feasibility (Sprint 9N, comparison-feasibility/v1): can THIS comparative
 * investigation still produce a relative position, and what single action makes the most justified progress?
 *
 * It adds no planner and no threshold. It reads what the runtime already derives — territory readiness, the
 * deterministic referencePlan (completion arithmetic, semantic candidates), the probe ledger — and names the result:
 *
 *   FEASIBLE    the set can be completed from evidence in hand: ≥ MIN_COMPARISON_SET meaningful represented
 *               territories, or enough references already probed with eligible members (or proposed)
 *   UNCERTAIN   completion depends on evidence not collected yet: the target is not anchored or represented, tag
 *               profiles that reveal candidates are missing, or meaningful candidates are still unprobed
 *   INFEASIBLE  the referencePlan is blocked (budget, turns, slots, no meaningful candidate, no reference yield),
 *               or the target has no usable panel: the run returns its supported partial finding
 *
 * UNCERTAIN is never INFEASIBLE: missing discovery evidence permits bounded, targeted discovery. The model sees this
 * view in focus.feasibility and cannot change it; the executor uses it only to refuse reference probes that cannot
 * change the outcome (referenceProbeRefusal), and only under the enforce policy.
 *
 * `repeat` answers a product question deterministically: asking the same thing again, would it likely end the same?
 * Blockers that are Qloo's evidence (no candidate, no yield, unsupported target, thin panel) repeat; the run's own
 * budget, turns or slots may not.
 */
import type { ComparisonFeasibility, ComparisonFeasibilityBlocker } from "@cultural-elasticity/shared";
import { memoRun } from "./derived-cache.js";
import type { RankableType } from "./contracts.js";
import { isReady, territoryReadiness } from "./readiness.js";
import { comparisonSetSize, REFERENCE_EMPTY_PROBE_LIMIT, referenceCandidates, referenceEntityType, referencePlan, referenceProbeLedger, targetTags, validTargetExemplars } from "./reference-strategy.js";
import { MIN_COMPARISON_SET } from "./router.js";
import { MEANINGFUL_EXEMPLAR_SUPPORT } from "./semantic-comparison.js";
import { activeTerritories, remainingQlooCalls, turnsAvailable, type AgentRunState } from "./state.js";
import type { FeasibilityView } from "./model/provider.js";

export const FEASIBILITY_RULES_VERSION = "comparison-feasibility/v1" as const;

/** Blockers that come from Qloo's evidence: the same question asked again would meet them again. */
const EVIDENCE_BLOCKERS: ReadonlySet<ComparisonFeasibilityBlocker> = new Set(["TARGET_UNSUPPORTED", "TARGET_CONCEPT_ONLY", "THIN_TARGET_PANEL", "NO_REFERENCE_YIELD", "NO_MEANINGFUL_REFERENCE_CANDIDATES"]);

export function comparativeRun(state: AgentRunState): boolean {
  const intent = state.interpretation?.intent;
  return (intent === "analyze_move" || intent === "compare_territories") && state.request.researchMode !== "single_hypothesis_v1";
}

/** The comparison-feasibility assessment of the current state, or null for a run that is not a comparison. */
export function assessComparisonFeasibility(state: AgentRunState): ComparisonFeasibility | null {
  if (!comparativeRun(state)) return null;
  return memoRun(state, "comparisonFeasibility", () => compute(state));
}

function compute(state: AgentRunState): ComparisonFeasibility {
  const active = activeTerritories(state);
  const targets = active.filter((t) => t.role === "target");
  const target = targets.find((t) => t.representation) ?? targets.find((t) => t.concept) ?? targets[0] ?? null;
  const entityType = referenceEntityType(state);
  const plan = referencePlan(state);
  const candidates = referenceCandidates(state).filter((c) => c.semantic.status === "MEANINGFUL" && c.usable !== false && c.namespaceYield !== "unproductive");
  const probes = entityType ? referenceProbeLedger(state, entityType) : { made: 0, empty: 0, productive: 0 };
  const validExemplars = validTargetExemplars(state);
  const turnsLeft = turnsAvailable(state);
  const callsLeft = remainingQlooCalls(state);
  const base = {
    rulesVersion: FEASIBILITY_RULES_VERSION,
    iteration: state.usage.iterations,
    target: { key: target?.key ?? null, label: target?.label ?? null, anchored: Boolean(target?.concept), represented: Boolean(target?.representation), entityType: target?.representation?.entityType ?? null, validExemplars },
    compatibleEntityType: entityType,
    meaningfulTerritories: comparisonSetSize(state),
    requiredTerritories: MIN_COMPARISON_SET,
    missingReferences: plan.applicable ? plan.needed : Math.max(0, MIN_COMPARISON_SET - comparisonSetSize(state)),
    pendingReferences: plan.pending,
    candidates: { meaningful: candidates.length, probedWithMembers: candidates.filter((c) => c.usable === true).length, typeEvidenced: candidates.filter((c) => c.typeEvidence > 0).length, unprobed: candidates.filter((c) => c.usable === null).length },
    referenceProbes: { made: probes.made, empty: probes.empty, limit: REFERENCE_EMPTY_PROBE_LIMIT },
    capacity: { turnsLeft, qlooCallsLeft: callsLeft, turnsNeeded: plan.completion?.turnsNeeded ?? 0, callsNeeded: plan.completion?.callsNeeded ?? 0 },
  };
  const out = (status: ComparisonFeasibility["status"], blocker: ComparisonFeasibility["blocker"], nextAction: ComparisonFeasibility["nextAction"], stopReasons: string[] = []): ComparisonFeasibility => ({
    ...base,
    status,
    blocker,
    nextAction,
    stopReasons,
    repeat: blocker && EVIDENCE_BLOCKERS.has(blocker.code) && status === "INFEASIBLE" ? "LIKELY_REPEATS" : "MAY_CHANGE",
  });

  if (!state.brand.entity) return out("UNCERTAIN", null, { action: "qloo_resolve_entity", detail: "resolve the brand before anything can be compared" });
  if (!target) return out("UNCERTAIN", { code: "TARGET_NOT_ANCHORED", detail: "no target territory is in scope yet" }, null);

  if (!target.concept) {
    const r = territoryReadiness(state, target);
    if (r.state === "unsupported") return out("INFEASIBLE", { code: "TARGET_UNSUPPORTED", detail: `${target.label}: ${r.reason}` }, null, [`no Qloo tag tried for ${target.label} in this run returned entities; nothing can be placed relative to it`]);
    return out("UNCERTAIN", { code: "TARGET_NOT_ANCHORED", detail: `${target.label} is not anchored to a Qloo concept yet` }, { action: "anchor_territory", detail: `anchor ${target.label} to a Qloo concept that returned members` });
  }
  if (!target.representation) {
    const r = territoryReadiness(state, target);
    if (r.state === "ready" && r.mode === "concept_only") {
      return out("INFEASIBLE", { code: "TARGET_CONCEPT_ONLY", detail: `${target.label} has concept-level evidence only (${r.reason}): no exemplar panel, so no relative position` }, null, ["a relative position needs a validated exemplar panel for the target"]);
    }
    return out("UNCERTAIN", { code: "TARGET_NOT_REPRESENTED", detail: `${target.label} is anchored to ${target.concept.label} but has no validated exemplar panel yet` }, { action: "validate_territory_representation", detail: `validate a ${preferredPanelAdvice(state)} panel for ${target.label}` });
  }

  // The target is represented. From here the referencePlan decides; feasibility names its state.
  if (comparisonSetSize(state) >= MIN_COMPARISON_SET) return out("FEASIBLE", null, { action: "analyze", detail: `the comparison set has ${comparisonSetSize(state)} meaningful ${entityType} territories: analyze them together` });
  if (target.status === "analyzed" || !plan.applicable) return out("INFEASIBLE", null, null, [plan.reason || "the target was analyzed without a full comparison set"]);

  if (!plan.feasible) {
    const code: ComparisonFeasibilityBlocker =
      plan.blockedBy === "NO_MEANINGFUL_REFERENCE_CANDIDATES" && validExemplars < MEANINGFUL_EXEMPLAR_SUPPORT ? "THIN_TARGET_PANEL" : (plan.blockedBy ?? "NO_MEANINGFUL_REFERENCE_CANDIDATES");
    return out("INFEASIBLE", { code, detail: plan.reason }, readyAnalysis(state), [plan.reason]);
  }

  const covered = plan.pending.length + Math.min(plan.needed, base.candidates.probedWithMembers);
  if (plan.needed === 0 || covered >= plan.needed + plan.pending.length) {
    return out("FEASIBLE", null, { action: plan.pending.length ? "validate_territory_representation" : "propose_territory", detail: plan.outstanding ?? plan.reason });
  }
  if (plan.completion && /discovery pending/u.test(plan.completion.reason)) {
    return out("UNCERTAIN", { code: "REFERENCE_DISCOVERY_PENDING", detail: plan.reason }, { action: "qloo_get_entity_tags", detail: plan.outstanding ?? plan.reason });
  }
  const best = candidates.find((c) => c.usable === null);
  const thin = validExemplars < MEANINGFUL_EXEMPLAR_SUPPORT ? `; the target has ${validExemplars} validated exemplar(s), so only tags on the brand's own profile can be meaningful references` : "";
  return out(
    "UNCERTAIN",
    { code: validExemplars < MEANINGFUL_EXEMPLAR_SUPPORT ? "THIN_TARGET_PANEL" : "REFERENCE_PROBES_PENDING", detail: `${plan.needed} reference(s) needed; ${base.candidates.unprobed} meaningful candidate(s) not probed yet (${base.candidates.typeEvidenced} observed on ${entityType} profiles); ${probes.empty} of ${REFERENCE_EMPTY_PROBE_LIMIT} empty reference probes used${thin}` },
    best ? { action: "qloo_recommend", detail: `probe ${best.label} [${best.tagId}] with ${entityType}, conditionOnBrand=false${best.typeEvidence > 0 ? ` (on ${best.typeEvidence} ${entityType} profile(s) in this run)` : ""}` } : null,
  );
}

function preferredPanelAdvice(state: AgentRunState): string {
  return `${MEANINGFUL_EXEMPLAR_SUPPORT}+ exemplar`.concat(comparativeRun(state) ? " (two validated exemplars let their shared profile tags become meaningful references)" : "");
}

/** When the comparison cannot be completed, the useful next step is to analyze what is ready (a partial finding). */
function readyAnalysis(state: AgentRunState): ComparisonFeasibility["nextAction"] {
  const ready = activeTerritories(state).filter((t) => t.status !== "analyzed" && isReady(territoryReadiness(state, t)));
  return ready.length ? { action: "analyze", detail: `analyze ${ready.map((t) => t.key).join(", ")} now and report the supported partial finding` } : null;
}

/**
 * Executor guard (enforce policy only): a brand-independent probe of a REFERENCE concept (not a target's own tag) with the
 * comparison type, refused when it cannot change the outcome. Never applied to target, frontier or alignment probes.
 *   COMPARISON_INFEASIBLE              the referencePlan is blocked: no reference can complete the set in this run
 *   REFERENCE_PROBE_LIMIT              REFERENCE_EMPTY_PROBE_LIMIT empty reference probes, the missing references uncovered,
 *                                      and the candidate has no observed evidence of the type (Sprint 9O)
 *   REFERENCE_DISCOVERY_PENDING        the candidate has no observed evidence of the type while ≥ 2 validated target exemplars'
 *                                      profiles (which carry type-evidenced candidates) are still uncollected (deferral)
 *   REFERENCE_TYPE_EVIDENCE_PENDING    the candidate has no observed evidence of the type while enough candidates that do
 *                                      are still unprobed (a deferral: once they are probed, it is allowed)
 * The two deferrals apply only with DEFERRAL_TURN_SLACK turns beyond what completion needs.
 */
export const DEFERRAL_TURN_SLACK = 2;
export function referenceProbeRefusal(state: AgentRunState, tagId: string, type: RankableType): { code: string; reason: string } | null {
  if (state.feasibilityPolicy !== "enforce" || !comparativeRun(state)) return null;
  const entityType = referenceEntityType(state);
  if (!entityType || entityType !== type || targetTags(state).has(tagId)) return null;
  if (activeTerritories(state).some((t) => t.role !== "reference" && (t.concept?.id === tagId || t.sourceTagId === tagId))) return null;
  const f = assessComparisonFeasibility(state);
  if (!f || !f.target.represented || f.meaningfulTerritories >= MIN_COMPARISON_SET) return null;
  const proposedReference = activeTerritories(state).some((t) => t.role === "reference" && t.concept?.id === tagId);
  if (f.status === "INFEASIBLE" && !proposedReference) return { code: "COMPARISON_INFEASIBLE", reason: `a full comparison is not feasible in this run (${f.blocker?.detail ?? "blocked"}); analyze the ready territories and report the partial finding` };
  const probes = referenceProbeLedger(state, entityType);
  const all = referenceCandidates(state);
  const self = all.find((c) => c.tagId === tagId);
  // Sprint 9O: past the limit a candidate observed on profiles of the type is still worth its call (the bound is not proof).
  if (probes.empty >= REFERENCE_EMPTY_PROBE_LIMIT && f.candidates.probedWithMembers < f.missingReferences && !(self && self.typeEvidence > 0)) return { code: "REFERENCE_PROBE_LIMIT", reason: `${probes.empty} reference probes returned no eligible ${entityType} member (limit ${REFERENCE_EMPTY_PROBE_LIMIT}) and the missing references have no usable probed candidate; this candidate has no observed ${entityType} evidence in this run` };
  if (proposedReference) return null;
  // Deferrals below cost the run a turn; they apply only with turn slack (live L-C2 and s51-references-late: usable
  // references found with two turns left must be built at once, not deferred).
  if (f.capacity.turnsLeft - f.capacity.turnsNeeded < DEFERRAL_TURN_SLACK) return null;
  if (self && self.typeEvidence > 0) return null;
  // Live L-M2: brand-profile genres were probed before the target exemplars' profiles (which carry type-evidenced
  // candidates) were collected. With ≥ MEANINGFUL_EXEMPLAR_SUPPORT validated exemplars, those profiles come first.
  const unprofiled = activeTerritories(state).filter((t) => t.role === "target").flatMap((t) => (t.representation?.exemplars ?? []).filter((e) => e.quality === "VALID" && !state.profiles.has(e.id)));
  if (validTargetExemplars(state) >= MEANINGFUL_EXEMPLAR_SUPPORT && unprofiled.length > 0) {
    return { code: "REFERENCE_DISCOVERY_PENDING", reason: `collect the target exemplars' tag profiles first (qloo_get_entity_tags: ${unprofiled.slice(0, 4).map((e) => e.label).join(", ")}): tags on ${entityType} profiles are candidates with observed ${entityType} evidence; ${self ? `${self.label} [${tagId}]` : tagId} has none yet (deferred, not banned)` };
  }
  const better = all.filter((c) => c.tagId !== tagId && c.semantic.status === "MEANINGFUL" && c.usable === null && c.typeEvidence > 0 && c.namespaceYield !== "unproductive");
  const needed = Math.max(1, f.missingReferences - f.candidates.probedWithMembers);
  if (better.length >= needed) {
    return {
      code: "REFERENCE_TYPE_EVIDENCE_PENDING",
      reason: `${self ? `${self.label} [${tagId}]` : tagId} has no observed ${entityType} evidence in this run, while ${better.length} meaningful candidate(s) on ${entityType} profiles are unprobed: probe ${better.slice(0, 3).map((c) => `${c.label} [${c.tagId}]`).join(", ")} first (deferred, not banned)`,
    };
  }
  return null;
}

/** Records the assessment in the trace when its status, blocker or next action changes. */
export function recordFeasibility(state: AgentRunState): void {
  // After the targets are analyzed the outcome rests on the snapshot; later states would only restate "analyzed".
  if (state.feasibilityAtAnalysis) return;
  const f = assessComparisonFeasibility(state);
  if (!f) return;
  const log = (state.trace.feasibility ??= []);
  const last = log.at(-1);
  if (last && last.status === f.status && last.blocker?.code === f.blocker?.code && last.nextAction?.action === f.nextAction?.action && last.meaningfulTerritories === f.meaningfulTerritories && last.referenceProbes.empty === f.referenceProbes.empty) return;
  log.push(f);
}

/** Called by the runtime just before an analysis that includes a target: the assessment the outcome rests on. */
export function snapshotFeasibilityBeforeAnalysis(state: AgentRunState, keys: readonly string[]): void {
  if (state.feasibilityAtAnalysis || !keys.some((k) => state.territories.find((t) => t.key === k)?.role === "target")) return;
  recordFeasibility(state);
  state.feasibilityAtAnalysis = assessComparisonFeasibility(state);
}

/** The assessment taken before the targets were analyzed, or the last one recorded (a run that never analyzed them). */
export function finalFeasibility(state: AgentRunState): ComparisonFeasibility | null {
  return state.feasibilityAtAnalysis ?? state.trace.feasibility?.at(-1) ?? null;
}

/** The agent-facing view: compact, deterministic, read-only. */
export function feasibilityView(f: ComparisonFeasibility): FeasibilityView {
  return {
    status: f.status,
    blocker: f.blocker ? `${f.blocker.code}: ${f.blocker.detail}` : null,
    nextAction: f.nextAction ? `${f.nextAction.action}: ${f.nextAction.detail}` : null,
    target: `${f.target.label ?? "none"} — ${f.target.represented ? `${f.target.validExemplars} validated ${f.target.entityType} exemplar(s)` : f.target.anchored ? "anchored, not represented" : "not anchored"}`,
    comparisonSet: `${f.meaningfulTerritories} of ${f.requiredTerritories} meaningful ${f.compatibleEntityType ?? "?"} territories; ${f.missingReferences} reference(s) missing${f.pendingReferences.length ? `; pending ${f.pendingReferences.join(", ")}` : ""}`,
    candidates: `${f.candidates.meaningful} meaningful (${f.candidates.probedWithMembers} probed with members, ${f.candidates.typeEvidenced} on ${f.compatibleEntityType ?? "?"} profiles, ${f.candidates.unprobed} unprobed)`,
    referenceProbes: `${f.referenceProbes.empty} empty of ${f.referenceProbes.made} made (limit ${f.referenceProbes.limit} empty)`,
    capacity: `${f.capacity.turnsLeft} turn(s), ${f.capacity.qlooCallsLeft} Qloo call(s) left; completion needs ${f.capacity.turnsNeeded} turn(s), about ${f.capacity.callsNeeded} call(s)`,
    stopReasons: f.stopReasons,
  };
}
