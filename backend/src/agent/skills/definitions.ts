/**
 * The runtime skills (Sprint 4, all version 1). Each wraps a competency the runtime already had in
 * Sprint 3, now with its own tool allowlist, context needs, budget and stopping conditions:
 *
 *   interpret_request              the goal → intent, brand, named territories
 *   resolve_brand                  the brand → one Qloo entity (or a question to the user)
 *   resolve_territory              each named / proposed territory → one Qloo concept (or dropped)
 *   build_territory_representation each concept → validated exemplars, or a recovery path
 *   build_comparison_set           single move / two-territory comparison → references of the same type
 *   explore_candidate_territories  frontier → Qloo-grounded + agent-hypothesized candidates, validated
 *   analyze_territories            ready territories → deterministic analysis, then finish
 *
 * Activation is just-in-time from state (see each `relevant`); several skills may be active in one turn
 * (e.g. one territory is being represented while another is being resolved). Sequences adapt to evidence:
 * no skill forces the next one.
 */
import type { AnalysisRoute } from "@cultural-elasticity/shared";
import { z } from "zod";
import { MIN_FRONTIER_SUPPORTED } from "../contracts.js";
import { viableFrontierCandidates } from "../frontier.js";
import { isReady, recoverable, territoryReadiness } from "../readiness.js";
import { comparisonSetSize, referenceEntityType, referencePlan } from "../reference-strategy.js";
import { MIN_COMPARISON_SET } from "../router.js";
import { activeTerritories, remainingQlooCalls, type AgentRunState } from "../state.js";
import type { SkillDefinition } from "./contracts.js";

const ALL_ROUTES: readonly AnalysisRoute[] = ["FULL_RELATIVE_ANALYSIS", "PARTIAL_CULTURAL_ANALYSIS", "DESCRIPTIVE_ANALYSIS", "INSUFFICIENT_EVIDENCE"];
const spent = (state: AgentRunState, id: string) => state.skillUsage.get(id)?.exhausted === true;
/** Discovery skills (references, frontier) need Qloo calls: a spent Qloo budget ends them too. */
const discoverySpent = (state: AgentRunState, id: string) => spent(state, id) || state.skillUsage.get(id)?.qlooSpent === true;
const open = (state: AgentRunState) => activeTerritories(state).filter((t) => t.status !== "analyzed");
const keys = z.array(z.string());

export { viableFrontierCandidates } from "../frontier.js";
/** Frontier exploration aims for one candidate more than the minimum, so one weak candidate does not end the set. */
export const FRONTIER_TARGET = MIN_FRONTIER_SUPPORTED + 1;

export const interpretRequestSkill: SkillDefinition<{ userQuery: string }, { intent: string | null }> = {
  id: "interpret_request",
  version: 1,
  purpose: "Turn the user's goal into a validated intent, brand and list of named territories.",
  intents: ["analyze_move", "compare_territories", "explore_frontier"],
  preconditions: ["no interpretation recorded yet"],
  relevant: (state) => state.interpretation === null,
  inputSchema: z.object({ userQuery: z.string() }),
  focus: (state) => ({ userQuery: state.request.userQuery }),
  outputSchema: z.object({ intent: z.string().nullable() }),
  outcome: (state) => ({ intent: state.interpretation?.intent ?? null }),
  allowedTools: ["interpret_request"],
  allowedActions: ["ask_user"],
  allowedRoutes: [],
  contextRequirements: [],
  budget: { maxTurns: 3, maxQlooCalls: 0 },
  stoppingConditions: ["interpretation accepted", "goal materially ambiguous → ask the user"],
  failureModes: ["MODEL_DECISION_ERROR", "TOOL_ARGUMENT_ERROR"],
  evalIds: ["ir-move", "ir-compare", "ir-frontier", "ir-explicit-intent-wins"],
  procedure: "Record intent, brand (as written) and the territories the user named with interpret_request. Fields fixed by the request must match. Ask the user only if the goal is materially ambiguous.",
};

export const resolveBrandSkill: SkillDefinition<{ query: string | null }, { brandId: string | null; ambiguous: boolean }> = {
  id: "resolve_brand",
  version: 1,
  purpose: "Resolve the brand to exactly one Qloo entity; never pick silently among ambiguous candidates.",
  intents: ["analyze_move", "compare_territories", "explore_frontier"],
  preconditions: ["interpretation recorded", "brand not resolved"],
  relevant: (state) => state.interpretation !== null && state.brand.entity === null,
  inputSchema: z.object({ query: z.string().nullable() }),
  focus: (state) => ({ query: state.brand.query }),
  outputSchema: z.object({ brandId: z.string().nullable(), ambiguous: z.boolean() }),
  outcome: (state) => ({ brandId: state.brand.entity?.id ?? null, ambiguous: state.brand.ambiguity !== null }),
  allowedTools: ["qloo_resolve_entity"],
  allowedActions: ["ask_user"],
  allowedRoutes: [],
  contextRequirements: [],
  budget: { maxTurns: 5, maxQlooCalls: 4 },
  stoppingConditions: ["brand resolved", "ambiguity → ask the user", "not found twice → INSUFFICIENT", "budget spent → INSUFFICIENT"],
  failureModes: ["ENTITY_RESOLUTION_ERROR", "QLOO_TOOL_ERROR"],
  evalIds: ["er-exact", "er-not-found", "er-type-evidence", "amb-ask", "amb-continue", "amb-no-silent-choice"],
  procedure: "Resolve the brand with qloo_resolve_entity (role brand, type brand). If Qloo returns several candidates, ask the user which one; after an answer, resolve the chosen candidate id.",
};

export const resolveTerritorySkill: SkillDefinition<{ territories: string[] }, { anchored: string[]; unresolved: string[] }> = {
  id: "resolve_territory",
  // v2 (Sprint 4 live fix): per-territory Qloo budget; a spent Qloo budget no longer deactivates anchoring.
  // v3 (Sprint 5A): probes across entity types (an empty type is not re-probed: barren-probe rule); state-grounded
  // recoveryGuidance and the probe ledger are shown per territory.
  // v4 (Sprint 5A.1): bounded probing (3 empty types per concept, 6 per territory; then unsupported), entity-type
  // alignment across a comparison (the shared type is probed on other concepts first; one bounded anchor deferral),
  // grounded candidates are tested on their own Qloo tag first.
  // v5 (Sprint 5A.2, live L-E1/L-E2): probe types are ranked per concept by Qloo evidence (members for the concept,
  // then for its tag namespace, then the comparison's shared type, then structural observations, then bounded
  // exploration) and shown as nextProbe; a type barren for 2 other concepts of the namespace is deferred; a grounding
  // tag that returns members anchors its candidate; tag searches named after the grounding tag stay attached.
  version: 5,
  purpose: "Anchor each territory to one Qloo concept tag, choosing among tags by the Qloo members they carry; drop territories Qloo cannot express.",
  intents: ["analyze_move", "compare_territories", "explore_frontier"],
  preconditions: ["brand resolved", "an in-scope territory has no concept and resolution is possible"],
  relevant: (state) => state.brand.entity !== null && !spent(state, "resolve_territory") && open(state).some((t) => territoryReadiness(state, t).state === "needs_concept"),
  inputSchema: z.object({ territories: keys }),
  focus: (state) => ({ territories: open(state).filter((t) => territoryReadiness(state, t).state === "needs_concept").map((t) => t.key) }),
  outputSchema: z.object({ anchored: keys, unresolved: keys }),
  outcome: (state) => ({ anchored: state.territories.filter((t) => t.concept).map((t) => t.key), unresolved: state.territories.filter((t) => !t.concept).map((t) => t.key) }),
  allowedTools: ["qloo_find_tags", "qloo_recommend", "anchor_territory", "drop_territory"],
  allowedActions: ["ask_user"],
  allowedRoutes: [],
  contextRequirements: ["observedTags"],
  // 1 tag search + up to 3 brand and 3 place probes per territory (+1 spare): 8.
  budget: { maxTurns: 5, maxQlooCalls: 8, perTerritory: true },
  stoppingConditions: ["every territory anchored or dropped", "Qloo budget spent → anchor with the evidence already gathered", "turn budget spent → remaining territories reported unsupported"],
  failureModes: ["TERRITORY_RESOLUTION_ERROR", "QLOO_DATA_LIMIT", "TOOL_SELECTION_ERROR"],
  evalIds: ["er-exact", "ie-unmeasurable", "gen-unseen-brand-territory", "s5-barren-probe-switches-type", "s51-probe-limit-unsupported", "s51-type-alignment-compare", "s52-frontier-namespace-type-evidence"],
  procedure:
    "Search Qloo tags for the territory (qloo_find_tags). Prefer a tag named like the territory; when several fit, probe brand-independent pools (qloo_recommend, conditionOnBrand=false, one tag per call) and anchor the tag whose members best express it. Choose each probe's entity type from the territory's nextProbe: it is ranked by Qloo evidence (CONCEPT_MEMBERS, then NAMESPACE_MEMBERS: the type other concepts of the same tag namespace returned members of, then COMPARISON_TYPE, STRUCTURAL, EXPLORATION). When several territories share a namespace with no evidence yet, their nextProbe types differ: probe them in parallel to test several types in one turn. A type that returned nothing for 2 other concepts of a namespace is deferred while the concept has other options. In a comparison, follow focus 'type alignment': when other territories already have members of one type, probe that type on this territory's other concepts before switching type. A concept is probed with at most 3 entity types that return nothing (further probes are refused); after 6 empty probes with no member the territory is unsupported. If no probe finds members, anchor the best-named tag anyway (analysis can still use concept-level evidence). Drop a territory only with a taxonomy code when Qloo has no concept for it.",
};

export const buildRepresentationSkill: SkillDefinition<{ territories: string[] }, { represented: string[]; conceptOnly: string[] }> = {
  id: "build_territory_representation",
  // v2 (Sprint 4 live fix): per-territory Qloo budget; a spent Qloo budget no longer deactivates validation.
  // v3 (Sprint 5A): recovery contract v2 — recoveryGuidance names the failed strategy, remaining strategies,
  // untried supported entity types, alternate concepts, attempts left and the tool for each step.
  // v4 (Sprint 5A.1): recovery priority (reuse a type with members → the comparison's shared type → remaining probe
  // slots → alternate concept → concept-only); exhausted concepts are not probed again.
  version: 4,
  purpose: "Represent each anchored territory with distinct, well-evidenced Qloo exemplars; recover with another strategy when the candidate pool is weak; never force a weak panel.",
  intents: ["analyze_move", "compare_territories", "explore_frontier"],
  preconditions: ["brand resolved", "an in-scope territory is anchored without a representation and strategies remain"],
  relevant: (state) => state.brand.entity !== null && !spent(state, "build_territory_representation") && open(state).some((t) => territoryReadiness(state, t).state === "needs_representation" || recoverable(state, t)),
  inputSchema: z.object({ territories: keys }),
  focus: (state) => ({ territories: open(state).filter((t) => territoryReadiness(state, t).state === "needs_representation" || recoverable(state, t)).map((t) => t.key) }),
  outputSchema: z.object({ represented: keys, conceptOnly: keys }),
  outcome: (state) => ({ represented: state.territories.filter((t) => t.representation).map((t) => t.key), conceptOnly: state.territories.filter((t) => t.concept && !t.representation).map((t) => t.key) }),
  allowedTools: ["qloo_recommend", "qloo_get_entity_tags", "validate_territory_representation", "declare_concept_only", "qloo_find_tags", "anchor_territory", "drop_territory"],
  allowedActions: [],
  allowedRoutes: ALL_ROUTES,
  contextRequirements: ["exemplarCandidates", "representationRecovery"],
  budget: { maxTurns: 6, maxQlooCalls: 8, perTerritory: true },
  stoppingConditions: [
    "a representation with ≥ 1 VALID exemplar is accepted (prefer 3 distinct ones)",
    "a (concept, entity type) strategy failed twice → exhausted, try another type or concept",
    "no strategy left → concept-only evidence (declare_concept_only)",
  ],
  failureModes: ["REPRESENTATION_ERROR", "EXEMPLAR_SEMANTIC_ERROR", "QLOO_DATA_LIMIT"],
  evalIds: ["ex-quality-selection", "ex-single-member", "rv-brand-conditioned", "rv-fabricated-id", "rv-place-representation", "sk-quality-outlier", "sk-quality-weak-recovery", "sk-semantic-veto", "sk-strategy-exhausted", "s5-recovery-untried-type", "s51-probe-limit-unsupported"],
  procedure:
    "Fetch Qloo members of the concept (qloo_recommend, conditionOnBrand=false) for a fitting entity type. Fetch tag profiles of the leading candidates (qloo_get_entity_tags) so quality can be checked against peers. Propose up to 3 distinct exemplars with validate_territory_representation; you may attach a semantic judgment per exemplar (relevance strong/adequate/weak/mismatch + reason): it is advisory and can only remove a candidate. If a strategy fails or the pool is weak, follow the territory's recoveryGuidance in order: an available strategy, the comparison's shared entity type on another concept, an untried supported entity type (within the remaining probe slots), an alternate Qloo concept, then declare_concept_only. Never re-propose rejected exemplars, a refused strategy or an exhausted concept.",
};

export const buildComparisonSetSkill: SkillDefinition<{ entityType: string | null; size: number }, { size: number; references: string[] }> = {
  id: "build_comparison_set",
  // v2 (Sprint 5A): semantic comparison validation (only MEANINGFUL references count; venue attributes and weak ties
  // are refused), the deterministic referencePlan (exact outstanding requirement, feasibility within the budget),
  // and deferral of target analysis while a meaningful set is still feasible.
  // v3 (Sprint 5A.1): completion arithmetic (turns counted with the open turn; probed usable references need no probe),
  // the completion contract, refusal of reference probes in a namespace already barren for the type, and a reference
  // proposed with one accepted evidence tag is anchored at proposal (one step fewer per reference).
  // v4 (Sprint 9N): comparison-feasibility/v1 in focus.feasibility; candidates observed on profiles of the comparison
  // type rank first; reference probes that cannot change the outcome are refused (COMPARISON_INFEASIBLE,
  // REFERENCE_PROBE_LIMIT) and type-less probes are deferred while better-evidenced candidates or the target exemplars'
  // profiles are pending and turns allow it.
  // v5 (Sprint 9O): the runtime runs one reference search before the model chooses references (reference-discovery.ts):
  // it collects the validated target exemplars' profiles and probes the best type-evidenced MEANINGFUL candidates, so
  // the model chooses among references whose Qloo yield is known. A candidate with type evidence stays probeable past
  // REFERENCE_EMPTY_PROBE_LIMIT.
  version: 5,
  purpose: "Give a single move or a two-territory comparison a semantically meaningful comparison set of ≥ 3 represented territories of one entity type, or establish that none is feasible (then the result is an honest PARTIAL).",
  intents: ["analyze_move", "compare_territories"],
  preconditions: ["a target is represented", `fewer than ${MIN_COMPARISON_SET} meaningful represented territories of its entity type`, "a meaningful reference set is still feasible within the budget, or the profiles needed to find one are missing"],
  relevant: (state) => {
    const intent = state.interpretation?.intent;
    if ((intent !== "analyze_move" && intent !== "compare_territories") || state.request.researchMode === "single_hypothesis_v1" || !state.brand.entity || discoverySpent(state, "build_comparison_set")) return false;
    if (referenceEntityType(state) === null || comparisonSetSize(state) >= MIN_COMPARISON_SET) return false;
    if (state.territories.length >= state.limits.maxCandidateTerritories || remainingQlooCalls(state) < 2) return false;
    const brandProfiled = state.profiles.has(state.brand.entity.id);
    const exemplarsProfiled = activeTerritories(state).every((t) => t.role !== "target" || (t.representation?.exemplars ?? []).every((e) => state.profiles.has(e.id)));
    return !brandProfiled || !exemplarsProfiled || referencePlan(state).feasible;
  },
  inputSchema: z.object({ entityType: z.string().nullable(), size: z.number() }),
  focus: (state) => ({ entityType: referenceEntityType(state), size: comparisonSetSize(state) }),
  outputSchema: z.object({ size: z.number(), references: keys }),
  outcome: (state) => ({ size: comparisonSetSize(state), references: activeTerritories(state).filter((t) => t.role === "reference").map((t) => t.key) }),
  allowedTools: ["qloo_get_entity_tags", "qloo_recommend", "propose_territory", "anchor_territory", "validate_territory_representation", "assess_concept_duplicates", "drop_territory"],
  allowedActions: [],
  allowedRoutes: ["FULL_RELATIVE_ANALYSIS"],
  contextRequirements: ["referenceCandidates", "brandProfile", "exemplarCandidates", "conceptDedup"],
  budget: { maxTurns: 4, maxQlooCalls: 10 },
  stoppingConditions: [`≥ ${MIN_COMPARISON_SET} meaningful represented territories of one entity type`, "referencePlan not feasible (no meaningful candidate, budget, turns or slots) → analysis stays partial", "focus.feasibility INFEASIBLE (incl. NO_REFERENCE_YIELD after the bounded empty reference probes) → analyze, partial", "budget spent"],
  failureModes: ["REFERENCE_CONSTRUCTION_FAILURE", "SEMANTIC_REFERENCE_ERROR", "QLOO_DATA_LIMIT", "CONCEPT_DUPLICATION_ERROR"],
  evalIds: ["ex-quality-selection", "sk-quality-outlier", "sk-reference-place-type", "ir-move", "s5-meaningless-reference-refused", "s5-references-before-analysis", "s51-references-late-still-feasible", "s51-reference-namespace-barren", "s9n-reference-probes-deferred"],
  procedure:
    "Read focus.feasibility first: FEASIBLE = complete the set now; UNCERTAIN = do its nextAction (bounded discovery); INFEASIBLE = stop building references and analyze (an honest PARTIAL). focus.outstanding states how many meaningful references are still needed. Prefer candidates with typeEvidence > 0 (seen on profiles of the target's entity type). Pick from referenceCandidates (only semantic MEANINGFUL ones are listed; evidence.referencePlan lists rejected ones and why). If a candidate is untested (probe null), probe its brand-independent pool with the TARGET's entity type (qloo_recommend). For a candidate with ≥ 2 eligible members: propose_territory (role reference, origin qloo_evidence, evidenceTagIds [its tag], semantic = is it a meaningful cultural alternative to the target at the same level?) — it is anchored to that tag at once — and validate_territory_representation with that same entity type, in the SAME turn (references left unvalidated at the last turn are lost). Then analyze all territories together. If no meaningful reference is feasible, analyze and accept a PARTIAL result.",
};

export const exploreCandidatesSkill: SkillDefinition<{ viable: number; target: number }, { candidates: string[]; dropped: string[] }> = {
  id: "explore_candidate_territories",
  // v2 (Sprint 5A): venue-listing attributes are excluded from frontierConcepts and refused as candidates; an
  // advisory semantic judgment (weak/mismatch) drops a candidate before analysis.
  // v3 (Sprint 5A.1): two-stage discovery — a fixed evidence base (related take 8, first 6 related profiles in Qloo
  // order) feeds a canonical, deduplicated, stably ordered candidate pool; candidates keep their grounding tag as
  // canonical identity and are tested on it first.
  // v4 (Sprint 5A.2, live L-E1/L-E2): a candidate whose grounding tag returns members is anchored to it by the runtime;
  // an alternate anchor must be the same concept (same canonical name or alias) with observed members while the
  // grounding tag has none; in the last two turns, candidates with members are represented and analyzed first.
  // v5 (Sprint 8D): Channel A evidence base before ungrounded probes; agent hypotheses with empty probes do not fill
  // the viable-candidate target while unused frontierConcepts remain.
  // v6 (Sprint 10A): frontier-pool/v2 (taxonomy concepts interleaved across facets before free keywords; each concept
  // states its facet, whether the brand's own profile carries it, and the entities behind it); seeds from an authorized
  // baseline scan may be profiled (at most 3) and feed the pool; proposals cite the observed signals that motivated
  // them (motivatedBy, validated as observed). Support rules are unchanged.
  version: 6,
  purpose: "Generate distinct frontier candidates from two channels (Qloo-grounded concepts and agent hypotheses), each of which must still pass Qloo validation.",
  intents: ["explore_frontier"],
  preconditions: ["explore_frontier", "brand resolved", `fewer than ${FRONTIER_TARGET} viable candidates`, "room in the candidate and call budgets"],
  relevant: (state) =>
    state.interpretation?.intent === "explore_frontier" &&
    state.brand.entity !== null &&
    !discoverySpent(state, "explore_candidate_territories") &&
    viableFrontierCandidates(state) < FRONTIER_TARGET &&
    state.territories.length < state.limits.maxCandidateTerritories &&
    remainingQlooCalls(state) >= 2,
  inputSchema: z.object({ viable: z.number(), target: z.number() }),
  focus: (state) => ({ viable: viableFrontierCandidates(state), target: FRONTIER_TARGET }),
  outputSchema: z.object({ candidates: keys, dropped: keys }),
  outcome: (state) => ({ candidates: activeTerritories(state).filter((t) => t.role === "frontier_candidate").map((t) => t.key), dropped: state.territories.filter((t) => t.status === "dropped").map((t) => t.key) }),
  allowedTools: ["qloo_get_entity_tags", "qloo_related_entities", "qloo_find_tags", "qloo_recommend", "propose_territory", "anchor_territory", "assess_concept_duplicates", "drop_territory"],
  allowedActions: [],
  allowedRoutes: ALL_ROUTES,
  contextRequirements: ["brandProfile", "relatedEntities", "frontierConcepts", "conceptDedup"],
  budget: { maxTurns: 6, maxQlooCalls: 20 },
  stoppingConditions: [`${FRONTIER_TARGET} viable, distinct candidates`, "candidate or call budget reached", "no Qloo-supported concept left"],
  failureModes: ["CONCEPT_DUPLICATION_ERROR", "TERRITORY_RESOLUTION_ERROR", "QLOO_DATA_LIMIT"],
  evalIds: ["ir-frontier", "dtd-unsupported-hypothesis", "dtd-near-duplicate", "sk-frontier-two-channels", "sk-frontier-morph-duplicate", "sk-dedup-model-distinct", "s5-frontier-incidental-excluded", "s51-frontier-evidence-base", "s51-frontier-canonical-anchor", "s52-frontier-namespace-type-evidence", "s10a-discovery-mechanics"],
  procedure:
    "Channel A first: fetch the brand profile, the Qloo-related brands, and the tag profiles of the first 6 related brands in Qloo's order (the fixed evidence base). frontierConcepts is the resulting candidate pool (canonical, deduplicated, ordered by support). Probe tags already in frontierConcepts (or already proposed candidates) as soon as they appear; do not probe hypothesized concepts that are not in that pool until the remaining related profiles are collected. Propose candidates from the pool with origin qloo_evidence and their tag in evidenceTagIds; test each on that tag first with the entity type its nextProbe recommends (Qloo evidence, not a fixed place/brand order). A grounding tag that returns members anchors its candidate automatically; validate its representation next. Anchor another tag only when the grounding tag returned no members and the other tag is the same concept (same canonical name) with observed members; a different concept is proposed as its own candidate. Prefer candidates that can share one entity type (focus type alignment). An agent hypothesis that returned no members does not fill the candidate target: propose the next unused frontierConcepts entry instead of another empty probe. Do not retry a profile, tag query or probe the last turn refused (NO_VALUE_ACTION, DUPLICATE_ACTION, FRONTIER_EVIDENCE_PENDING). In the last two turns, represent and analyze the candidates that have members instead of probing new ones. Channel B (agent hypothesis): after the evidence base is collected you may propose a non-obvious lateral territory (origin agent_hypothesis); it must then be found in Qloo tags, anchored, and shown to have Qloo members, or it is dropped. Aim for candidates that are coherent cultural territories, distinct from each other (not venue amenities, decor or service options); give your semantic judgment when proposing; label likely duplicates with assess_concept_duplicates. Discovery mix (Sprint 10A): frontierConcepts states each concept's facet and domainRelation (OUTSIDE_BRAND_PROFILE_FACETS: the brand's own Qloo profile has no tag of that facet). Where the evidence allows, choose a mix: the best-supported concepts and at least one concept from outside the brand's profile facets; never pick a weakly supported concept only because it is unfamiliar, and do not fill a quota. Seeds are entities the brand's baseline scan returned (for example related artists or books): when several seeds look like one scene or genre, profile up to 3 of them (qloo_get_entity_tags) so their shared tags enter frontierConcepts, or propose an agent_hypothesis citing them in motivatedBy. A seed is an observation about the brand's audience list, never evidence that the brand has affinity with a territory; the territory still needs Qloo members. Always pass motivatedBy with the ids of the signals that led you to a candidate.",
};

export const analyzeTerritoriesSkill: SkillDefinition<{ ready: string[] }, { analyzed: string[] }> = {
  id: "analyze_territories",
  // v2 (Sprint 5A): analysis of targets is deferred (bounded, REFERENCES_PENDING) while a meaningful comparison set
  // is still feasible; FULL additionally requires the semantic comparison validator's acceptance.
  version: 3,
  purpose: "Run the deterministic analysis for ready territories and finish when sufficiency allows.",
  intents: ["analyze_move", "compare_territories", "explore_frontier"],
  preconditions: ["brand resolved", "a territory is ready (validated panel, or concept-only/unsupported with nothing left to try), a result exists, or every territory is analyzed"],
  relevant: (state) => state.brand.entity !== null && (open(state).length === 0 || state.results.size > 0 || open(state).some((t) => isReady(territoryReadiness(state, t)))),
  inputSchema: z.object({ ready: keys }),
  focus: (state) => ({ ready: open(state).filter((t) => isReady(territoryReadiness(state, t))).map((t) => t.key) }),
  outputSchema: z.object({ analyzed: keys }),
  outcome: (state) => ({ analyzed: state.territories.filter((t) => t.status === "analyzed").map((t) => t.key) }),
  allowedTools: ["assess_evidence_sufficiency", "drop_territory"],
  allowedActions: ["analyze", "finish"],
  allowedRoutes: ALL_ROUTES,
  contextRequirements: ["analysisResults"],
  // Passive skill (available whenever something is ready): bounded by the run's iteration budget (30 max).
  budget: { maxTurns: 30, maxQlooCalls: 0 },
  stoppingConditions: ["deterministic sufficiency is SUFFICIENT or INSUFFICIENT", "no material evidence gap remains"],
  failureModes: ["ANALYSIS_ROUTE_ERROR", "EVIDENCE_SUFFICIENCY_ERROR", "METHODOLOGY_ERROR"],
  evalIds: ["ie-descriptive", "ie-unmeasurable", "bc-qloo-budget", "fs-faithful", "sk-early-stop", "s5-references-before-analysis"],
  procedure: "In single_hypothesis_v1, investigate only the target: use the observed concept and its members to test a brand-conditioned Qloo relationship, then analyze when further calls cannot change the qualitative conclusion. Do not construct references for that mode. Otherwise analyze ready territories together; a FULL relative position requires ≥ 3 meaningful represented territories of one type, and target analysis is deferred once while feasible references remain. Finish when sufficiency allows. Every route, number and class comes from code.",
};

/** Registry order is the attribution order for shared tools (earlier skill wins). */
export const SKILLS: readonly SkillDefinition[] = [
  interpretRequestSkill,
  resolveBrandSkill,
  resolveTerritorySkill,
  buildRepresentationSkill,
  buildComparisonSetSkill,
  exploreCandidatesSkill,
  analyzeTerritoriesSkill,
] as unknown as readonly SkillDefinition[];
