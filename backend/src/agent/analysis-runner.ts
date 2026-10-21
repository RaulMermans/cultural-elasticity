/**
 * Deterministic analysis for an `analyze` decision.
 *
 *   territories ─→ representation plans ─→ comparison groups (router)
 *     ─→ budget-aware evidence plan (required first, optional by priority)
 *     ─→ Qloo calls: brand + exemplar tag profiles, one rank call per panel, brand-conditioned lists
 *     ─→ FULL groups: MethodologyInput → Cultural Elasticity Methodology v0 (unchanged Sprint 2 code)
 *     ─→ everything else: Sprint 1/2 calculators (coherence, conditioned view, evidence quality)
 *     ─→ capability availability → route → AgentTerritoryResult
 *
 * The agent chose the territories and representations. Panel construction, the comparison scope,
 * every calculation, the route and every number belong to this code. Missing evidence is reported as
 * NOT_COLLECTED / UNAVAILABLE, never as zero.
 */
import type {
  AgentTerritoryResult,
  AgentToolCallTrace,
  CapabilityAvailability,
  CapabilityStatus,
  CoherenceView,
  ConditionedEvidenceView,
  Limitation,
  TerritoryElasticity,
  TerritoryEvidenceQuality,
} from "@cultural-elasticity/shared";
import { describeConditionedEvidence } from "../analysis/conditioned.js";
import { mergeProvenance } from "../evidence/provenance.js";
import type { ConditionedEntityEvidence, CulturalProfile, ProvenanceRef, ResolvedEntity } from "../evidence/schema.js";
import { coherenceView } from "../methodology/coherence.js";
import { METHODOLOGY_INPUT_SCHEMA_VERSION, MethodologyInputError, type MethodologyInput, type MethodologyInputRaw, type TerritoryRepresentation } from "../methodology/contracts.js";
import { METHODOLOGY_VERSION } from "../methodology/config.js";
import { analyzeElasticity } from "../methodology/elasticity.js";
import { applyOperationalTagPolicy, OPERATIONAL_TAG_POLICY_VERSION } from "../methodology/operational-tags.js";
import { assembleTerritoryEvidence } from "../methodology/territory-evidence.js";
import { ElasticityInvariantError } from "../methodology/validate.js";
import { brandProfileFromEntityTags, callProvenance, conditionedEntitiesFromRecommend, emptyConditionedEvidence, rankingFromRank, type LiveCall } from "../qloo/live-adapter.js";
import { callQloo, PROFILE_TAKE, provenanceOf, recordPool, recordProfile } from "./qloo-gateway.js";
import { assessDiversity, planRepresentation } from "./representation-planner.js";
import { planComparisonGroups, selectAnalysisRoute, MIN_COMPARISON_SET, type ComparisonGroup } from "./router.js";
import { assessComparisonGroup } from "./semantic-comparison.js";
import { remainingQlooCalls, type AgentRunState, type TerritoryState } from "./state.js";
import type { AgentToolProvider } from "./tool-provider.js";
import type { RankableType } from "./contracts.js";

export type OpenTrace = (tool: string, permission: AgentToolCallTrace["permission"], args: unknown) => AgentToolCallTrace;

export type AnalysisOutcome = { ok: true; analyzed: string[]; summary: string } | { ok: false; code: string; reason: string };

/** Capture-level limitations attached to every agent methodology input (same facts as Sprint 2). */
export const AGENT_CAPTURE_LIMITATIONS: Limitation[] = [
  { code: "AFFINITY_SCALE_UNDOCUMENTED", detail: "Qloo documents no meaning, range or direction for response affinity; values are compared only within one call" },
  { code: "NO_GRAPH_DISTANCE", detail: "Qloo exposes no network hop count or path endpoint; nothing here is a measured network separation" },
  { code: "TERRITORY_EXEMPLARS_AGENT_SELECTED", detail: "exemplars were chosen by the agent from Qloo evidence in this run and validated by deterministic rules; see each territory's representation" },
  { code: "TAG_PROFILES_TRUNCATED_AT_TAKE", detail: `tag profiles are the top ${PROFILE_TAKE} returned at one fixed take (harness cap); overlap describes this representation only` },
];

type Panel = { id: string; purpose: "primary" | "alternate" | "repeat"; repeatOf?: string; exemplarIndex: number };

const PANEL_IDS = ["A", "B", "C"] as const;
const corr = (call: LiveCall) => call.envelope.execution.correlation_id;

type Need = { key: string; required: boolean; priority: number; run: () => Promise<void> };

/**
 * Qloo calls the REQUIRED analysis evidence of the given territories still needs (brand profile, one primary
 * rank panel per comparison group, primary exemplar profiles, brand-conditioned lists for territories outside a
 * group). The runtime keeps this many calls in reserve: investigation may not spend them.
 */
export function analysisReserve(state: AgentRunState, territories: readonly TerritoryState[]): number {
  const brand = state.brand.entity;
  if (!brand || territories.length === 0) return 0;
  const { groups } = planComparisonGroups(state, territories);
  const grouped = new Set(groups.flatMap((g) => g.territoryKeys));
  let reserve = state.profiles.has(brand.id) ? 0 : 1;
  reserve += groups.length;
  for (const t of territories) {
    const primary = t.representation?.exemplars[0];
    if (primary && !state.profiles.has(primary.id)) reserve += 1;
    if (t.concept && !grouped.has(t.key)) reserve += 1;
  }
  return reserve;
}

export async function runAnalysis(state: AgentRunState, provider: AgentToolProvider, keys: readonly string[], openTrace: OpenTrace): Promise<AnalysisOutcome> {
  const brand = state.brand.entity;
  if (!brand) return { ok: false, code: "ENTITY_UNRESOLVED", reason: "the brand is not resolved" };
  const unknown = keys.filter((k) => !state.territories.some((t) => t.key === k && t.status !== "dropped"));
  if (unknown.length > 0) return { ok: false, code: "TERRITORY_UNRESOLVED", reason: `unknown or dropped territories: ${unknown.join(", ")}` };
  const territories = keys.map((k) => state.territories.find((t) => t.key === k)!);

  const evidenceTrace = openTrace("analyze_evidence", "read_only_external", { territoryKeys: keys });
  const panelTrace = openTrace("build_candidate_panel", "read_only_external", { territoryKeys: keys });
  const limitations = new Map<string, Limitation[]>(territories.map((t) => [t.key, []]));
  const note = (key: string, limitation: Limitation) => limitations.get(key)?.push(limitation);

  // ---- Evidence plan ----
  const planned = planComparisonGroups(state, territories);
  const excluded = planned.excluded;
  let groups = semanticGate(state, planned.groups, excluded, (key, limitation) => limitations.get(key)?.push(limitation));
  const conditioned = new Map<string, { evidence: ConditionedEntityEvidence; empty: boolean }>();
  const rankCalls = new Map<string, LiveCall>(); // `${groupIndex}:${panelId}` → call

  const needProfile = (subjectId: string, label: string, ownerKey: string | null, required: boolean, priority: number): Need => ({
    key: `profile:${subjectId}`,
    required,
    priority,
    run: async () => {
      if (state.profiles.has(subjectId)) return;
      const result = await callQloo(state, provider, evidenceTrace, "entity_tags", { entities: [subjectId], limit: PROFILE_TAKE });
      if ("call" in result && result.outcome !== "needs_input") recordProfile(state, subjectId, result.call);
      else if (ownerKey) note(ownerKey, { code: "EXEMPLAR_PROFILE_NOT_COLLECTED", detail: `${label}: tag profile unavailable (${"code" in result ? result.code : result.outcome})` });
    },
  });
  const needConditioned = (t: TerritoryState, entityType: RankableType, required: boolean, priority: number): Need => ({
    key: `conditioned:${t.key}`,
    required,
    priority,
    run: async () => {
      const input = { target_type: entityType, signals: [brand.id], include_tags: [t.concept!.id], limit: 20, explain: false };
      const result = await callQloo(state, provider, evidenceTrace, "recommend", input);
      if (!("call" in result) || result.outcome === "needs_input") {
        note(t.key, { code: "CONDITIONED_CALL_FAILED", detail: `${t.label}: brand-conditioned list unavailable (${"code" in result ? result.code : result.outcome})` });
        return;
      }
      if (!state.pools.some((p) => corr(p.call) === corr(result.call))) recordPool(state, result.call, { tagIds: [t.concept!.id], targetType: entityType, conditionedOn: brand.id });
      const scope = { conditionedOn: { id: brand.id, label: brand.label }, territory: { id: t.concept!.id, label: t.concept!.label }, entityType: `urn:entity:${entityType}`, requestedLimit: 20 };
      conditioned.set(t.key, result.outcome === "empty" ? { evidence: emptyConditionedEvidence(result.call, scope), empty: true } : { evidence: conditionedEntitiesFromRecommend(result.call, scope), empty: false });
    },
  });
  const needPanel = (groupIndex: number, group: ComparisonGroup, panel: Panel, required: boolean, priority: number): Need => ({
    key: `panel:${groupIndex}:${panel.id}`,
    required,
    priority,
    run: async () => {
      const options = group.territoryKeys.map((k) => exemplarAt(state, k, panel.exemplarIndex).id);
      const result = await callQloo(state, provider, panelTrace, "rank", { options, option_type: group.entityType, signals: [brand.id] });
      if (result.outcome === "ok") rankCalls.set(`${groupIndex}:${panel.id}`, result.call);
      else for (const k of group.territoryKeys) note(k, { code: "PANEL_CALL_FAILED", detail: `panel ${panel.id}: rank call ${"code" in result ? result.code : result.outcome}` });
    },
  });

  const panelsFor = (group: ComparisonGroup): Panel[] => {
    const depth = Math.max(...group.territoryKeys.map((k) => state.territories.find((t) => t.key === k)!.representation!.exemplars.length));
    return PANEL_IDS.slice(0, depth).map((id, index) => ({ id, purpose: index === 0 ? "primary" : "alternate", exemplarIndex: index }));
  };

  const buildNeeds = (): Need[] => {
    const needs: Need[] = [needProfile(brand.id, brand.label, null, true, 0)];
    const grouped = new Set(groups.flatMap((g) => g.territoryKeys));
    groups.forEach((group, gi) => {
      const panels = panelsFor(group);
      needs.push(needPanel(gi, group, panels[0]!, true, 1));
      for (const panel of panels.slice(1)) needs.push(needPanel(gi, group, panel, false, 3));
      needs.push(needPanel(gi, group, { id: "A-repeat", purpose: "repeat", repeatOf: "A", exemplarIndex: 0 }, false, 8));
    });
    for (const t of territories) {
      const plan = planRepresentation(state, t);
      const exemplars = t.representation?.exemplars ?? [];
      if (exemplars[0]) needs.push(needProfile(exemplars[0].id, exemplars[0].label, t.key, true, 1));
      // Optional evidence order: robustness panels (3) > target/frontier alternates (4) > their
      // conditioned lists (5) > reference alternates (6) > reference conditioned (7) > repeat panel (8).
      const reference = t.role === "reference";
      for (const alt of exemplars.slice(1)) needs.push(needProfile(alt.id, alt.label, t.key, false, reference ? 6 : 4));
      if (t.concept && plan.entityType) {
        const inGroup = grouped.has(t.key);
        needs.push(needConditioned(t, plan.entityType, !inGroup, !inGroup ? 2 : reference ? 7 : 5));
      }
    }
    return needs;
  };

  const uncached = (need: Need) => {
    if (need.key.startsWith("profile:")) return state.profiles.has(need.key.slice("profile:".length)) ? 0 : 1;
    return 1;
  };
  let needs = buildNeeds();
  const requiredCost = () => needs.filter((n) => n.required).reduce((sum, n) => sum + uncached(n), 0);
  if (requiredCost() > remainingQlooCalls(state) && groups.length > 0) {
    for (const g of groups) for (const k of g.territoryKeys) excluded.push({ key: k, reason: "Qloo budget too small for rank panels" });
    groups = [];
    needs = buildNeeds();
  }
  // Seen keys are de-duplicated (two territories may share a profile need key only through a bug; keep first).
  const seen = new Set<string>();
  const ordered = [...needs].filter((n) => (seen.has(n.key) ? false : (seen.add(n.key), true))).sort((a, b) => Number(b.required) - Number(a.required) || a.priority - b.priority);
  const skipped: Need[] = [];
  for (const need of ordered) {
    if (uncached(need) > 0 && remainingQlooCalls(state) < 1) {
      skipped.push(need);
      continue;
    }
    await need.run();
  }
  for (const need of skipped) {
    const owner = need.key.startsWith("conditioned:") ? need.key.slice("conditioned:".length) : null;
    const detail = `${need.key.split(":")[0]} not collected: Qloo call budget (${state.limits.maxQlooCalls}) spent`;
    if (owner) note(owner, { code: "NOT_COLLECTED_BUDGET", detail });
    else for (const t of territories) note(t.key, { code: "NOT_COLLECTED_BUDGET", detail });
  }

  // Diversity was judged at proposal time, usually before exemplar profiles existed: re-assess now.
  for (const t of territories) {
    if (!t.representation) continue;
    const before = t.representation.diversity;
    Object.assign(t.representation, assessDiversity(state, t.representation.exemplars));
    if (before !== t.representation.diversity && t.representation.diversity === "low") t.representation.warnings.push("near-identical exemplar tag profiles were found after the representation was accepted");
  }

  const brandProfileRecord = state.profiles.get(brand.id);
  if (!brandProfileRecord) {
    evidenceTrace.status = "failed";
    evidenceTrace.summary = "brand tag profile unavailable";
    return { ok: false, code: "QLOO_EMPTY", reason: "the brand's tag profile could not be collected, so no analysis is possible" };
  }
  const brandSubject: ResolvedEntity = { id: brand.id, label: brand.label, type: brand.type, resolution: brand.resolution === "confirmed" ? "confirmed" : "unconfirmed", provenance: [callProvenance(brand.call)] };
  const brandProfile = brandProfileFromEntityTags(brandSubject, brandProfileRecord.call, PROFILE_TAKE);
  evidenceTrace.status = "ok";
  evidenceTrace.summary = `brand profile ${brandProfile.signals.length} tags; ${[...state.profiles.keys()].length - 1} exemplar/other profiles in run; ${conditioned.size} brand-conditioned list(s)`;

  // ---- FULL groups: the Sprint 2 methodology, unchanged ----
  const fullResults = new Map<string, { view: TerritoryElasticity; group: ComparisonGroup; runId: string }>();
  for (const [gi, group] of groups.entries()) {
    const panels = [...panelsFor(group), { id: "A-repeat", purpose: "repeat" as const, repeatOf: "A", exemplarIndex: 0 }].filter((p) => rankCalls.has(`${gi}:${p.id}`) || p.purpose !== "repeat");
    const raw = methodologyInput(state, brandProfile, group, panels, (panelId) => rankCalls.get(`${gi}:${panelId}`), conditioned);
    const methodologyTrace = openTrace("run_elasticity_methodology", "local_computation", { territoryKeys: group.territoryKeys, entityType: group.entityType, panels: panels.map((p) => p.id) });
    try {
      const result = analyzeElasticity(raw);
      const runId = `methodology-${state.methodologyRuns.length + 1}`;
      state.methodologyRuns.push({ id: runId, territoryKeys: group.territoryKeys, result });
      state.trace.methodologyInvocations.push({
        id: runId,
        territoryKeys: group.territoryKeys,
        entityType: group.entityType,
        panelIds: panels.filter((p) => rankCalls.has(`${gi}:${p.id}`)).map((p) => p.id),
        correlationIds: panels.flatMap((p) => (rankCalls.has(`${gi}:${p.id}`) ? [corr(rankCalls.get(`${gi}:${p.id}`)!)] : [])),
        methodologyVersion: result.methodologyVersion,
      });
      for (const view of result.territories) fullResults.set(view.territory.id, { view, group, runId });
      methodologyTrace.status = "ok";
      methodologyTrace.summary = result.territories.map((t) => `${t.territory.id}: ${t.classification.label}`).join("; ");
      const robustnessTrace = openTrace("assess_representation_robustness", "local_computation", { methodologyRun: runId });
      robustnessTrace.status = "ok";
      robustnessTrace.summary = result.territories.map((t) => `${t.territory.id} ${t.robustness.level}`).join(", ");
    } catch (error) {
      if (!(error instanceof MethodologyInputError) && !(error instanceof ElasticityInvariantError)) throw error;
      methodologyTrace.status = "failed";
      methodologyTrace.error = error.message.slice(0, 500);
      methodologyTrace.summary = "methodology not applicable to this evidence";
      for (const k of group.territoryKeys) note(k, { code: "METHODOLOGY_NOT_APPLICABLE", detail: error.message.slice(0, 300) });
    }
  }
  panelTrace.status = rankCalls.size > 0 ? "ok" : groups.length > 0 ? "failed" : "ok";
  panelTrace.summary = groups.length === 0 ? `no comparison set of ≥ ${MIN_COMPARISON_SET} rankable territories of one type` : `${rankCalls.size} rank panel(s) over ${groups.map((g) => g.territoryKeys.join("/")).join("; ")}`;

  // ---- Per-territory results ----
  for (const t of territories) {
    const full = fullResults.get(t.key);
    const reason = excluded.find((e) => e.key === t.key)?.reason;
    const result = full
      ? fullResult(state, t, full.view, full.group, conditioned.get(t.key), limitations.get(t.key)!)
      : partialResult(state, t, brandProfile, conditioned.get(t.key), [...limitations.get(t.key)!, ...(reason && t.representation && !/^(semantic comparison validator|structurally invalid|no semantically meaningful)/u.test(reason) ? [{ code: reason.includes("budget") ? "NOT_COLLECTED_BUDGET" : "COMPARISON_SET_TOO_SMALL", detail: reason }] : [])]);
    state.results.set(t.key, result);
    t.status = "analyzed";
  }
  const routes = territories.map((t) => `${t.label}: ${state.results.get(t.key)!.analysisRoute}`);
  return { ok: true, analyzed: territories.map((t) => t.key), summary: routes.join("; ") };
}

/**
 * Sprint 5A FULL gate: a structurally planned group is kept only if the semantic comparison validator accepts
 * it. Rejected references are removed; the rest is re-assessed, and if fewer than MIN_COMPARISON_SET remain the
 * group is not ranked: its territories degrade to PARTIAL / DESCRIPTIVE with the reason as a limitation.
 */
function semanticGate(state: AgentRunState, planned: ComparisonGroup[], excluded: { key: string; reason: string }[], note: (key: string, limitation: Limitation) => void): ComparisonGroup[] {
  const kept: ComparisonGroup[] = [];
  for (const group of planned) {
    const members = () => group.territoryKeys.map((k) => state.territories.find((t) => t.key === k)!);
    const first = assessComparisonGroup(state, group.entityType, members());
    let assessment = first;
    let current = group;
    if (first.rejectedReferences.length > 0) {
      const rejected = new Set(first.rejectedReferences.map((r) => r.territoryKey));
      current = { entityType: group.entityType, territoryKeys: group.territoryKeys.filter((k) => !rejected.has(k)) };
      for (const r of first.rejectedReferences) {
        excluded.push({ key: r.territoryKey, reason: `semantic comparison validator: ${r.explanation}` });
        note(r.territoryKey, { code: "SEMANTIC_REFERENCE_REJECTED", detail: r.explanation });
        state.candidateRejections.push({ key: r.territoryKey, stage: "semantic", code: r.reasonCode, reason: r.explanation });
      }
      if (current.territoryKeys.length >= MIN_COMPARISON_SET) assessment = { ...assessComparisonGroup(state, current.entityType, current.territoryKeys.map((k) => state.territories.find((t) => t.key === k)!)), rejectedReferences: first.rejectedReferences };
    }
    const usable = assessment.structuralStatus === "VALID" && assessment.semanticStatus === "MEANINGFUL" && current.territoryKeys.length >= MIN_COMPARISON_SET;
    state.semanticAssessments.push({ ...assessment, usedForFull: usable });
    if (usable) {
      kept.push(current);
      continue;
    }
    const why = assessment.structuralStatus === "INVALID" ? `structurally invalid comparison set (${assessment.structuralIssues.join("; ")})` : `no semantically meaningful comparison set (${assessment.semanticStatus}): ${first.rejectedReferences.map((r) => r.explanation).join("; ")}`;
    for (const k of current.territoryKeys) {
      excluded.push({ key: k, reason: why });
      note(k, { code: "SEMANTIC_COMPARISON_INVALID", detail: `${why}; a relative position is not reported` });
    }
  }
  return kept;
}

function exemplarAt(state: AgentRunState, key: string, index: number) {
  const exemplars = state.territories.find((t) => t.key === key)!.representation!.exemplars;
  return exemplars[index] ?? exemplars[0]!;
}

function subjectFor(state: AgentRunState, id: string, label: string, type: string, call: LiveCall): ResolvedEntity {
  return { id, label, type: type.startsWith("urn:") ? type : `urn:entity:${type}`, resolution: "confirmed", provenance: [callProvenance(call)] };
}

function conceptProvenance(state: AgentRunState, conceptId: string): ProvenanceRef[] {
  const tag = state.tags.get(conceptId);
  return (tag?.sources ?? []).map((s) => provenanceOf(state, s.kind === "find_tags" ? "find_tags" : "entity_tags", s.correlationId));
}

function territoryRepresentation(state: AgentRunState, t: TerritoryState): MethodologyInputRaw["territories"][number] {
  const rep = t.representation!;
  return {
    id: t.key,
    label: t.label,
    concept: { id: t.concept!.id, label: t.concept!.label, type: t.concept!.type },
    exemplars: rep.exemplars.map((e, index) => ({
      id: e.id,
      label: e.label,
      type: `urn:entity:${e.type}`,
      role: index === 0 ? ("primary" as const) : ("alternate" as const),
      note: e.selectionReason,
      provenance: [provenanceOf(state, e.conceptSupport === "tag_member" ? "recommend" : "entity_tags", e.supportCorrelationId), ...(state.profiles.get(e.id) ? [callProvenance(state.profiles.get(e.id)!.call)] : [])],
    })),
    rejectedExemplars: t.rejectedExemplars.map((r) => ({ label: r.label, reason: `${r.code}: ${r.reason}` })),
    assumptions: [
      `Representation chosen by the agent from Qloo evidence: entities Qloo links to ${t.concept!.label} (${t.concept!.id}).`,
      ...rep.exemplars.map((e) => `${e.label}: ${e.conceptSupport === "tag_member" ? "returned by a brand-independent Qloo query for the concept" : "its Qloo tag profile carries the concept"}.`),
    ],
    approximationWarnings: [
      ...(rep.diversity === "adequate" ? [] : [`exemplar diversity ${rep.diversity}: ${rep.diversityDetail}`]),
      // [live] A tag-only pool is Qloo's first `limit` members in id order; popularity ranks only inside that window.
      ...(state.pools.some((p) => p.conditionedOn === null && p.tagIds.includes(t.concept!.id) && p.memberIds.length >= 20) ? ["exemplar candidates came from a truncated Qloo member window (id order, not relevance); popularity ordering applies inside that window only"] : []),
      ...rep.warnings,
    ],
    provenance: conceptProvenance(state, t.concept!.id),
  };
}

function methodologyInput(
  state: AgentRunState,
  brandProfile: CulturalProfile,
  group: ComparisonGroup,
  panels: Panel[],
  rankCall: (panelId: string) => LiveCall | undefined,
  conditioned: Map<string, { evidence: ConditionedEntityEvidence }>,
): MethodologyInputRaw {
  const members = group.territoryKeys.map((k) => state.territories.find((t) => t.key === k)!);
  const exemplarProfiles = members.flatMap((t) =>
    t.representation!.exemplars.flatMap((e) => {
      const profile = state.profiles.get(e.id);
      return profile ? [brandProfileFromEntityTags(subjectFor(state, e.id, e.label, e.type, profile.call), profile.call, PROFILE_TAKE)] : [];
    }),
  );
  return {
    schemaVersion: METHODOLOGY_INPUT_SCHEMA_VERSION,
    origin: state.toolProvider.mode === "live" ? "live" : "synthetic",
    brand: brandProfile,
    tagTake: PROFILE_TAKE,
    territories: members.map((t) => territoryRepresentation(state, t)),
    exemplarProfiles,
    panels: panels.map((panel) => {
      const call = rankCall(panel.id);
      return {
        id: panel.id,
        purpose: panel.purpose,
        ...(panel.repeatOf !== undefined && { repeatOf: panel.repeatOf }),
        assignments: members.map((t) => ({ territoryId: t.key, exemplarId: exemplarAt(state, t.key, panel.exemplarIndex).id })),
        ...(call && { ranking: rankingFromRank(call, brandProfile.subject.id, undefined) }),
      };
    }),
    conditioned: members.flatMap((t) => (conditioned.has(t.key) ? [conditioned.get(t.key)!.evidence] : [])),
    limitations: [...AGENT_CAPTURE_LIMITATIONS, ...state.flags],
    provenance: [callProvenance(state.brand.entity!.call), ...brandProfile.provenance],
  };
}

function coherenceSummary(raw: CoherenceView, filtered: CoherenceView): AgentTerritoryResult["coherence"] {
  if (filtered.status !== "available" && raw.status !== "available") return null;
  return {
    rawSharedMedian: raw.summary?.sharedCountMedian ?? null,
    filteredSharedMedian: filtered.summary?.sharedCountMedian ?? null,
    filteredBand: filtered.band,
    exemplarsCompared: filtered.summary?.exemplarsCompared ?? raw.summary?.exemplarsCompared ?? 0,
    consistentlyShared: (filtered.summary?.consistentlyShared ?? []).map(({ id, label }) => ({ id, label })),
  };
}

function conditionedSummary(view: ConditionedEvidenceView | null): AgentTerritoryResult["conditionedEvidence"] {
  if (!view) return null;
  return { support: view.support, entityCount: view.entityCount, topEntities: view.topEntities.map((e) => ({ label: e.label, rank: e.rank })), correlationId: view.scope.verified ? (view.scope.correlationId ?? null) : null };
}

function representationView(state: AgentRunState, t: TerritoryState): AgentTerritoryResult["representation"] {
  const plan = planRepresentation(state, t);
  const rep = t.representation;
  const exemplars = (rep?.exemplars ?? []).map((e, i) => ({ id: e.id, label: e.label, type: e.type, role: i === 0 ? ("primary" as const) : ("alternate" as const), selectionReason: e.selectionReason, conceptSupport: e.conceptSupport, popularity: e.popularity, quality: e.quality }));
  const summary = !t.concept
    ? "no Qloo concept anchors this territory"
    : rep
      ? `${plan.strategy}: ${rep.exemplars.length} ${rep.entityType} exemplar(s) linked by Qloo to ${t.concept.label} (${t.concept.id}): ${rep.exemplars.map((e) => e.label).join(", ")}`
      : `${plan.strategy}: Qloo concept ${t.concept.label} (${t.concept.id}) without a validated exemplar panel`;
  return {
    strategy: plan.strategy,
    entityType: plan.entityType,
    exemplars,
    rejectedExemplars: t.rejectedExemplars,
    diversity: rep?.diversity ?? "unknown",
    diversityDetail: rep?.diversityDetail ?? "no exemplars",
    attempts: t.attempts,
    summary,
    failure: t.dropReason ?? (!t.concept ? { code: "TERRITORY_UNRESOLVED", detail: "no Qloo concept was anchored" } : null),
  };
}

function capabilityConditioned(t: TerritoryState, plan: ReturnType<typeof planRepresentation>, collected: { empty: boolean } | undefined): CapabilityStatus {
  if (collected) return collected.empty ? "EMPTY" : "AVAILABLE";
  return t.concept && plan.entityType ? "NOT_COLLECTED" : "UNAVAILABLE";
}

function representationCapability(t: TerritoryState): CapabilityAvailability["representation"] {
  if (!t.concept) return "UNSUPPORTED";
  return (t.representation?.exemplars.length ?? 0) >= 2 ? "SUPPORTED" : "PARTIAL";
}

function provenanceSummary(state: AgentRunState, refs: readonly ProvenanceRef[]): AgentTerritoryResult["provenance"] {
  const merged = mergeProvenance(refs);
  return { correlationIds: [...new Set(merged.flatMap((r) => (r.correlationId ? [r.correlationId] : [])))].sort(), sources: [...new Set(merged.map((r) => r.source))].sort() };
}

function fullResult(state: AgentRunState, t: TerritoryState, view: TerritoryElasticity, group: ComparisonGroup, collected: { evidence: ConditionedEntityEvidence; empty: boolean } | undefined, extra: Limitation[]): AgentTerritoryResult {
  const plan = planRepresentation(state, t);
  const capabilities: CapabilityAvailability = {
    representation: representationCapability(t),
    relativePosition: view.relativePosition.status === "available" ? "AVAILABLE" : "INSUFFICIENT",
    robustness: view.robustness.level === "INSUFFICIENT" ? "INSUFFICIENT" : "AVAILABLE",
    coherence: view.coherenceFiltered.status === "available" ? "AVAILABLE" : "NOT_COLLECTED",
    conditionedEvidence: capabilityConditioned(t, plan, collected),
    classification: "AVAILABLE",
  };
  const labels = group.territoryKeys.map((k) => state.territories.find((x) => x.key === k)!.label);
  const position = view.relativePosition;
  const result: AgentTerritoryResult = {
    ...baseResult(state, t),
    analysisRoute: selectAnalysisRoute(capabilities),
    capabilities,
    comparisonSet: { territoryKeys: group.territoryKeys, labels, methodologyVersion: METHODOLOGY_VERSION, semanticStatus: "MEANINGFUL" },
    relativePosition: { position: position.position, of: position.of, medianPercentile: position.medianPercentile, medianRank: position.medianRank },
    robustness: { level: view.robustness.level, percentileSpread: view.robustness.percentileSpread, panelledExemplars: view.robustness.panelledExemplars, declaredExemplars: view.robustness.declaredExemplars, reasons: view.robustness.reasons },
    coherence: coherenceSummary(view.coherenceRaw, view.coherenceFiltered),
    conditionedEvidence: conditionedSummary(view.conditionedEvidence),
    evidenceQuality: { level: view.evidenceQuality.level, drivers: view.evidenceQuality.drivers },
    classification: { label: view.classification.label, status: "PROVISIONAL", reasons: view.classification.reasons },
    limitations: dedupe([...view.limitations, ...extra]),
    provenance: provenanceSummary(state, view.provenance),
  };
  result.keyEvidence = keyEvidence(result);
  return result;
}

function partialResult(state: AgentRunState, t: TerritoryState, brandProfile: CulturalProfile, collected: { evidence: ConditionedEntityEvidence; empty: boolean } | undefined, extra: Limitation[]): AgentTerritoryResult {
  const plan = planRepresentation(state, t);
  const exemplars = t.representation?.exemplars ?? [];
  const profiles = exemplars.map((e) => {
    const record = state.profiles.get(e.id);
    return { exemplar: { id: e.id, label: e.label }, profile: record ? brandProfileFromEntityTags(subjectFor(state, e.id, e.label, e.type, record.call), record.call, PROFILE_TAKE) : undefined };
  });
  const brandFiltered = applyOperationalTagPolicy(brandProfile).filtered;
  const raw = coherenceView("RAW", brandProfile, profiles, null);
  const filtered = coherenceView("CULTURAL_FILTERED", brandFiltered, profiles.map((p) => ({ exemplar: p.exemplar, profile: p.profile ? applyOperationalTagPolicy(p.profile).filtered : undefined })), OPERATIONAL_TAG_POLICY_VERSION);
  const conditionedView = collected ? describeConditionedEvidence(collected.evidence) : null;

  let quality: TerritoryEvidenceQuality | null = null;
  const presentProfiles = profiles.filter((p) => p.profile).map((p) => p.profile!);
  if (exemplars.length > 0 && presentProfiles.length > 0 && t.concept) {
    // Same Cultural Evidence Core assessment as the methodology, without a ranking (none exists here).
    const pseudoInput = {
      schemaVersion: METHODOLOGY_INPUT_SCHEMA_VERSION,
      origin: state.toolProvider.mode === "live" ? "live" : "synthetic",
      brand: brandProfile,
      tagTake: PROFILE_TAKE,
      territories: [],
      exemplarProfiles: presentProfiles,
      panels: [],
      conditioned: collected ? [collected.evidence] : [],
      limitations: [...AGENT_CAPTURE_LIMITATIONS],
      provenance: brandProfile.provenance,
    } as unknown as MethodologyInput;
    const rep = territoryRepresentation(state, t) as unknown as TerritoryRepresentation;
    quality = assembleTerritoryEvidence(pseudoInput, rep).evidenceQuality;
  }

  const capabilities: CapabilityAvailability = {
    representation: representationCapability(t),
    relativePosition: "UNAVAILABLE",
    robustness: "UNAVAILABLE",
    coherence: filtered.status === "available" ? "AVAILABLE" : exemplars.length > 0 ? "NOT_COLLECTED" : "UNAVAILABLE",
    conditionedEvidence: capabilityConditioned(t, plan, collected),
    classification: "UNAVAILABLE",
  };
  const limitations: Limitation[] = [...extra, ...(conditionedView?.limitations ?? [])];
  if (!t.concept) limitations.push({ code: "TERRITORY_UNRESOLVED", detail: `${t.label}: no Qloo concept anchors this territory, so nothing can be measured` });
  if (exemplars.length === 0 && t.concept) limitations.push({ code: "NO_VALID_REPRESENTATION", detail: `${t.label}: no validated exemplar panel; relative position, robustness and classification are unavailable` });
  limitations.push({ code: "NO_RELATIVE_POSITION", detail: `${t.label}: route ${selectAnalysisRoute(capabilities)} reports no relative position or classification` });
  const result: AgentTerritoryResult = {
    ...baseResult(state, t),
    analysisRoute: selectAnalysisRoute(capabilities),
    capabilities,
    comparisonSet: null,
    relativePosition: null,
    robustness: null,
    coherence: coherenceSummary(raw, filtered),
    conditionedEvidence: conditionedSummary(conditionedView),
    evidenceQuality: quality ? { level: quality.level, drivers: quality.drivers } : null,
    classification: null,
    limitations: dedupe(limitations),
    provenance: provenanceSummary(state, mergeProvenance(raw.perExemplar.flatMap((p) => p.provenance), conditionedView?.provenance ?? [], t.concept ? conceptProvenance(state, t.concept.id) : [])),
  };
  result.keyEvidence = keyEvidence(result);
  return result;
}

function baseResult(state: AgentRunState, t: TerritoryState): Pick<AgentTerritoryResult, "key" | "label" | "role" | "origin" | "rationale" | "resolvedConcept" | "representation" | "keyEvidence"> {
  return { key: t.key, label: t.label, role: t.role, origin: t.origin, rationale: t.rationale, resolvedConcept: t.concept, representation: representationView(state, t), keyEvidence: [] };
}

/** Result for a territory that was never analyzed (dropped, unresolved or not investigated). */
export function unanalyzedResult(state: AgentRunState, t: TerritoryState, code: "NOT_INVESTIGATED" | "BUDGET_EXHAUSTED"): AgentTerritoryResult {
  const capabilities: CapabilityAvailability = {
    representation: representationCapability(t),
    relativePosition: "UNAVAILABLE",
    robustness: "UNAVAILABLE",
    coherence: t.representation ? "NOT_COLLECTED" : "UNAVAILABLE",
    conditionedEvidence: t.concept ? "NOT_COLLECTED" : "UNAVAILABLE",
    classification: "UNAVAILABLE",
  };
  const failure = t.dropReason ?? { code, detail: code === "BUDGET_EXHAUSTED" ? "the run's budget ended before this territory was analyzed" : "the agent did not analyze this territory" };
  const result: AgentTerritoryResult = {
    ...baseResult(state, t),
    analysisRoute: "INSUFFICIENT_EVIDENCE",
    capabilities,
    comparisonSet: null,
    relativePosition: null,
    robustness: null,
    coherence: null,
    conditionedEvidence: null,
    evidenceQuality: null,
    classification: null,
    limitations: [{ code: failure.code, detail: `${t.label}: ${failure.detail}` }],
    provenance: provenanceSummary(state, t.concept ? conceptProvenance(state, t.concept.id) : []),
  };
  result.representation = { ...result.representation, failure: result.representation.failure ?? failure };
  result.keyEvidence = keyEvidence(result);
  return result;
}

const fmt = (value: number) => String(Number(value.toFixed(3)));

/** Deterministic statements, each restating a value present in the result. */
export function keyEvidence(r: AgentTerritoryResult): string[] {
  const lines: string[] = [];
  if (r.relativePosition && r.comparisonSet) {
    lines.push(
      `Relative position ${r.relativePosition.position ?? "n/a"} of ${r.relativePosition.of} (median panel percentile ${r.relativePosition.medianPercentile === null ? "n/a" : fmt(r.relativePosition.medianPercentile)}) within the comparison set ${r.comparisonSet.labels.join(", ")}.`,
    );
  }
  if (r.robustness) lines.push(`Representation robustness ${r.robustness.level} (${r.robustness.panelledExemplars} of ${r.robustness.declaredExemplars} exemplars panelled; percentile spread ${r.robustness.percentileSpread === null ? "n/a" : fmt(r.robustness.percentileSpread)}).`);
  if (r.classification) lines.push(`Provisional class ${r.classification.label}, relative to this comparison set only.`);
  if (r.coherence) lines.push(`Shared cultural signals (operational tags filtered): median ${r.coherence.filteredSharedMedian ?? "n/a"} across ${r.coherence.exemplarsCompared} exemplar(s)${r.coherence.filteredBand ? ` (${r.coherence.filteredBand})` : ""}.`);
  if (r.conditionedEvidence) {
    lines.push(
      r.conditionedEvidence.entityCount === 0
        ? "A brand-conditioned Qloo query for this concept returned no entities."
        : `A brand-conditioned Qloo query for this concept returned ${r.conditionedEvidence.entityCount} entities (${r.conditionedEvidence.support}); top: ${r.conditionedEvidence.topEntities.map((e) => e.label).join(", ")}.`,
    );
  }
  if (r.evidenceQuality) lines.push(`Evidence quality ${r.evidenceQuality.level}.`);
  if (lines.length === 0) lines.push(`No measurable evidence: ${r.representation.failure?.detail ?? r.representation.summary}.`);
  return lines;
}

function dedupe(limitations: Limitation[]): Limitation[] {
  const seen = new Set<string>();
  return limitations.filter((l) => {
    const key = `${l.code}\u0000${l.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
