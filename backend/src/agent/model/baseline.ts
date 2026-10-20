/**
 * BaselinePolicyModel: a deterministic REFERENCE POLICY, not the production agent and not an LLM.
 *
 * It exists so the runtime can be exercised end to end, against the synthetic world and against live
 * Qloo, while no model credential is configured, and as the comparison arm for the model ("what value
 * does the model add?"). Results it drives are always labelled `model.kind = "baseline"` and carry the
 * AGENT_POLICY_NOT_LLM limitation; the agent model itself is then LIVE_AGENT_MODEL_VALIDATION_NOT_RUN.
 *
 * It has no natural-language understanding: it needs the request's structured fields (brand, and
 * territories or intent) and asks the user otherwise. It makes no semantic judgments. Its choices are
 * generic rules over Qloo evidence and the runtime's deterministic context sections (no brand, territory
 * or exemplar is named anywhere):
 *   concept      among Qloo tags named exactly like the territory (else the first two tags returned),
 *                the one with the most eligible brand-independent members (brand first, then place)
 *   exemplars    the top candidates by Qloo popularity, skipping name families and rejected ones; their tag
 *                profiles are fetched first so the runtime's quality evaluator can compare peers
 *   recovery     when a representation is refused, the next untried entity type with members, then an
 *                alternate Qloo concept for the same territory, then concept-only evidence
 *   references   the runtime's referenceCandidates (structure-derived, justified), probed with the target's
 *                entity type, proposed only when Qloo returns ≥ 2 eligible members
 *   frontier     concepts carried by Qloo-related brands but not by the brand, proposed after the same probe
 *   ambiguity    asks the user; after an answer, resolves the candidate the answer names (id or label)
 * It writes no synthesis: results get the deterministic template.
 * v2 (Sprint 4): candidate-profile prefetch, recovery, runtime reference candidates, skill-aware turns.
 */
import type { AgentModelInfo } from "@cultural-elasticity/shared";
import { labelFamily } from "../candidate-discovery.js";
import type { ModelTurn } from "../contracts.js";
import { slugify } from "../state.js";
import type { AgentDecisionContext, AgentModel } from "./provider.js";

type Member = { id: string; label: string; popularity: number | null; isBrand?: boolean };
type Memory = {
  tagsByQuery: Map<string, { id: string; label: string }[]>;
  pools: Map<string, Member[]>;
  frontierProposed: boolean;
  /** Pool probes issued last turn: one that produced no result was refused by the runtime (budget, value). */
  issuedProbes: string[];
};
type Territory = AgentDecisionContext["territories"][number];

const PROBE_TAGS = 2;
const EXACT_PROBES = 3;
const REFERENCE_PROBES = 4;
const FRONTIER_PROBES = 8;
const FRONTIER_CANDIDATES = 4;
const RELATED_PROFILES = 3;
/** A concept is usable as a reference/frontier panel only if Qloo returns at least this many eligible brands. */
const MIN_POOL = 2;
const COMPARISON_SET = 3;

const call = (tool: string, args: unknown, reasonSummary: string) => ({ action: "call_tool", tool, arguments: args, reasonSummary });
const poolKey = (tagId: string, type: string) => `${tagId}|${type}`;
const eligible = (members: Member[]) => members.filter((x) => !x.isBrand);

export class BaselinePolicyModel implements AgentModel {
  readonly info: AgentModelInfo = { id: "baseline-policy-v2", kind: "baseline", live: false };
  private readonly memory = new Map<string, Memory>();

  private mem(runId: string): Memory {
    let m = this.memory.get(runId);
    if (!m) {
      m = { tagsByQuery: new Map(), pools: new Map(), frontierProposed: false, issuedProbes: [] };
      this.memory.set(runId, m);
    }
    return m;
  }

  private absorb(m: Memory, context: AgentDecisionContext): void {
    // A refused probe is never re-proposed: it counts as "no pool available" and the policy decides with what exists.
    const answered = new Set(
      (context.lastTurn?.results ?? []).flatMap((r) => {
        const d = r.data as { tagIds?: string[]; targetType?: string; conditionOnBrand?: boolean } | undefined;
        return r.tool === "qloo_recommend" && d?.tagIds?.length === 1 && d.conditionOnBrand === false ? [poolKey(d.tagIds[0]!, String(d.targetType))] : [];
      }),
    );
    for (const key of m.issuedProbes) if (!answered.has(key) && !m.pools.has(key)) m.pools.set(key, []);
    m.issuedProbes = [];
    for (const result of context.lastTurn?.results ?? []) {
      const data = result.data as Record<string, unknown> | undefined;
      if (result.tool === "qloo_find_tags" && data && typeof data.query === "string") m.tagsByQuery.set(data.query.toLowerCase(), (data.tags as { id: string; label: string }[]) ?? []);
      if (result.tool === "qloo_recommend" && data && data.conditionOnBrand === false) {
        const tagIds = data.tagIds as string[];
        if (tagIds.length === 1) m.pools.set(poolKey(tagIds[0]!, String(data.targetType)), (data.members as Member[]) ?? []);
      }
    }
  }

  async decide(context: AgentDecisionContext): Promise<ModelTurn> {
    const m = this.mem(context.runId);
    this.absorb(m, context);
    const max = context.budget.maxActionsPerTurn;
    const fields = context.requestFields;
    const can = (tool: string) => context.tools.some((t) => t.name === tool);

    if (!context.interpretation) {
      if (!fields.brand) return { decisions: [{ action: "ask_user", question: "Which brand should be investigated, and which territories (if any)?", ambiguity: "the baseline policy needs the request's brand field; it does not interpret free text" }] };
      const territories = fields.territories ?? [];
      const intent = fields.intent ?? (territories.length === 0 ? "explore_frontier" : territories.length === 1 ? "analyze_move" : "compare_territories");
      return { decisions: [call("interpret_request", { intent, brand: fields.brand, territories }, "interpretation from the request's structured fields")] };
    }
    const brand = context.brand;
    if (brand.status === "ambiguous") {
      const answer = context.clarifications.at(-1)?.toLowerCase();
      const named = answer ? brand.candidates.filter((c) => answer.includes(c.id.toLowerCase())) : [];
      const byLabel = answer && named.length === 0 ? brand.candidates.filter((c) => answer.includes(c.label.toLowerCase())) : [];
      const chosen = named.length === 1 ? named[0] : byLabel.length === 1 ? byLabel[0] : undefined;
      if (chosen) return { decisions: [call("qloo_resolve_entity", { name: chosen.id, type: "brand", role: "brand" }, "resolve the candidate the user chose")] };
      return { decisions: [{ action: "ask_user", question: `Qloo knows several entities called "${brand.input}": ${brand.candidates.map((c) => `${c.label} (${c.id})`).join("; ")}. Which one?`, ambiguity: "brand name is ambiguous in Qloo" }] };
    }
    if (brand.status === "not_found") return { decisions: [{ action: "ask_user", question: `Qloo has no brand named "${context.interpretation.brand}". What is its exact name?`, ambiguity: "brand not found in Qloo" }] };
    if (brand.status !== "resolved") return { decisions: [call("qloo_resolve_entity", { name: context.interpretation.brand, type: "brand", role: "brand" }, "resolve the brand")] };
    if (context.sufficiency.verdict === "SUFFICIENT") return { decisions: [{ action: "finish", resultIds: context.territories.filter((t) => t.analysisRoute).map((t) => t.key), reasonSummary: "deterministic sufficiency reached" }] };

    const actions: unknown[] = [];
    const intent = context.interpretation.intent;
    const ev = context.evidence;
    if (ev.brandProfile === null && can("qloo_get_entity_tags")) actions.push(call("qloo_get_entity_tags", { entityId: brand.id }, "brand tag profile"));
    if (intent === "explore_frontier" && ev.relatedEntities) {
      if (ev.relatedEntities.length === 0 && can("qloo_related_entities")) actions.push(call("qloo_related_entities", { entityId: brand.id, targetType: "brand", limit: 5 }, "Qloo-related brands for frontier discovery"));
      for (const r of ev.relatedEntities.slice(0, RELATED_PROFILES)) if (!r.profiled) actions.push(call("qloo_get_entity_tags", { entityId: r.id }, `tag profile of related brand ${r.label}`));
    }

    const open = context.territories.filter((t) => t.status !== "analyzed" && t.status !== "dropped");
    const handled = new Set<string>();
    // Targets without a concept: search, probe, anchor (then represent in the same turn).
    for (const t of open.filter((x) => !x.concept && x.readiness === "needs_concept")) {
      handled.add(t.key);
      const tags = m.tagsByQuery.get(t.label.toLowerCase());
      if (!tags) {
        actions.push(call("qloo_find_tags", { query: t.label, limit: 8 }, `Qloo concepts for ${t.label}`));
        continue;
      }
      if (tags.length === 0) {
        actions.push(call("drop_territory", { territoryKey: t.key, code: "TERRITORY_UNRESOLVED", reason: "Qloo tag search returned nothing" }, "no Qloo concept"));
        continue;
      }
      const exact = tags.filter((tag) => tag.label.trim().toLowerCase() === t.label.trim().toLowerCase());
      const probes = exact.length > 0 ? exact.slice(0, EXACT_PROBES) : tags.slice(0, PROBE_TAGS);
      const unprobed = probes.filter((tag) => !m.pools.has(poolKey(tag.id, "brand")));
      if (unprobed.length > 0) {
        for (const tag of unprobed) actions.push(call("qloo_recommend", { targetType: "brand", tagIds: [tag.id], conditionOnBrand: false, limit: 20 }, `brand-independent pool for ${tag.label}`));
        continue;
      }
      const count = (tagId: string, type: string) => eligible(m.pools.get(poolKey(tagId, type)) ?? []).length;
      const bestBrand = [...probes].sort((a, b) => count(b.id, "brand") - count(a.id, "brand"))[0]!;
      let chosen = bestBrand;
      if (count(bestBrand.id, "brand") < MIN_POOL) {
        const placeUnprobed = probes.filter((tag) => !m.pools.has(poolKey(tag.id, "place")));
        if (placeUnprobed.length > 0) {
          for (const tag of placeUnprobed) actions.push(call("qloo_recommend", { targetType: "place", tagIds: [tag.id], conditionOnBrand: false, limit: 20 }, `few brands for ${t.label}: probe places`));
          continue;
        }
        const bestPlace = [...probes].sort((a, b) => count(b.id, "place") - count(a.id, "place"))[0]!;
        if (count(bestPlace.id, "place") > count(bestBrand.id, "brand")) chosen = bestPlace;
      }
      actions.push(call("anchor_territory", { territoryKey: t.key, tagId: chosen.id }, "concept with the most Qloo-linked entities"));
      actions.push(...this.represent(m, t.key, chosen.id, [], null, context.budget.maxExemplarsPerTerritory, true));
    }

    // References: runtime reference candidates, probed with the target's entity type.
    // References wait until every target's representation is settled (its entity type decides the set).
    const targetsSettled = !open.some((t) => t.role === "target" && !t.representation && (t.readiness === "needs_concept" || t.readiness === "needs_representation"));
    if (ev.referenceCandidates && targetsSettled) {
      const targetType = context.territories.find((t) => t.role === "target" && t.representation)?.representation?.entityType ?? "brand";
      const represented = context.territories.filter((t) => t.status !== "dropped" && t.representation?.entityType === targetType).length;
      const pending = context.territories.filter((t) => t.role === "reference" && t.status !== "dropped" && !t.representation).length;
      const wanted = COMPARISON_SET - represented - pending;
      if (wanted > 0) {
        const usable = ev.referenceCandidates.filter((c) => c.usable === true).slice(0, wanted);
        for (const c of usable) {
          const key = slugify(c.label);
          actions.push(call("propose_territory", { label: c.label, role: "reference", origin: "qloo_evidence", rationale: c.justification.slice(0, 380) || "runtime reference candidate", evidenceTagIds: [c.tagId] }, "justified reference concept with Qloo members of the target's type"));
          actions.push(call("anchor_territory", { territoryKey: key, tagId: c.tagId }, "anchor to its Qloo tag"));
          actions.push(...this.represent(m, key, c.tagId, [], targetType, context.budget.maxExemplarsPerTerritory, false));
        }
        if (usable.length < wanted) {
          const probes = ev.referenceCandidates.filter((c) => c.usable === null && c.namespaceYield !== "unproductive").slice(0, REFERENCE_PROBES);
          for (const c of probes) actions.push(call("qloo_recommend", { targetType, tagIds: [c.tagId], conditionOnBrand: false, limit: 20 }, `probe whether Qloo has ${targetType} members for ${c.label}`));
        }
      }
    }
    // Frontier: concepts carried by related brands, probed then proposed.
    if (intent === "explore_frontier" && !m.frontierProposed && ev.frontierConcepts && ev.frontierConcepts.length > 0 && (ev.relatedEntities ?? []).slice(0, RELATED_PROFILES).every((r) => r.profiled)) {
      const concepts = ev.frontierConcepts.slice(0, FRONTIER_PROBES);
      const unprobed = concepts.filter((c) => !m.pools.has(poolKey(c.tagId, "brand")));
      if (unprobed.length > 0) for (const c of unprobed) actions.push(call("qloo_recommend", { targetType: "brand", tagIds: [c.tagId], conditionOnBrand: false, limit: 20 }, `probe whether Qloo has brands for ${c.label}`));
      else {
        const support = new Map(concepts.map((c) => [c.tagId, c.support]));
        for (const c of concepts.filter((x) => eligible(m.pools.get(poolKey(x.tagId, "brand"))!).length >= MIN_POOL).slice(0, FRONTIER_CANDIDATES)) {
          actions.push(call("propose_territory", { label: c.label, role: "frontier_candidate", origin: "qloo_evidence", rationale: `carried by ${support.get(c.tagId)} Qloo-related brand(s), not by the brand; Qloo returns brands for it`, evidenceTagIds: [c.tagId] }, "frontier concept with Qloo brand members"));
          actions.push(call("anchor_territory", { territoryKey: slugify(c.label), tagId: c.tagId }, "anchor to its Qloo tag"));
        }
        m.frontierProposed = true;
      }
    }

    // Anchored territories still needing a representation: represent, or recover.
    for (const t of open.filter((x) => x.concept && x.readiness === "needs_representation" && !handled.has(x.key))) {
      const targetType = t.role === "reference" ? (context.territories.find((x) => x.role === "target" && x.representation)?.representation?.entityType ?? null) : null;
      const rep = this.represent(m, t.key, t.concept!.id, (t.rejectedExemplars ?? []).map((r) => r.label), targetType, context.budget.maxExemplarsPerTerritory, t.role !== "reference", t);
      if (rep.length > 0) actions.push(...rep);
      else actions.push(...this.recover(m, t));
    }

    if (actions.length > 0) {
      const decisions = actions.slice(0, max);
      for (const d of decisions as { tool?: string; arguments?: { tagIds?: string[]; targetType?: string; conditionOnBrand?: boolean } }[]) {
        if (d.tool === "qloo_recommend" && d.arguments?.conditionOnBrand === false && d.arguments.tagIds?.length === 1) m.issuedProbes.push(poolKey(d.arguments.tagIds[0]!, String(d.arguments.targetType)));
      }
      return { decisions };
    }
    const ready = open.filter((t) => t.readiness === "ready" || t.readiness === "unsupported").map((t) => t.key);
    if (ready.length > 0 && context.actions.includes("analyze")) return { decisions: [{ action: "analyze", targetIds: ready.slice(0, 6), reasonSummary: "no further evidence to gather; analyze" }] };
    return { decisions: [{ action: "finish", resultIds: context.territories.filter((t) => t.analysisRoute).map((t) => t.key), reasonSummary: "all territories analyzed" }] };
  }

  /**
   * Profile prefetch + representation proposal. Candidates come from the runtime context when present
   * (eligible, not rejected), otherwise from this turn's own pool memory.
   */
  private represent(m: Memory, territoryKey: string, tagId: string, rejected: string[], forcedType: string | null, max: number, prefetch: boolean, t?: Territory): unknown[] {
    const fromContext = (type: string) => (t?.exemplarCandidates ?? []).filter((c) => c.type === type).map((c) => ({ id: c.id, label: c.label, popularity: c.popularity, profiled: c.profiled }));
    const fromMemory = (type: string) => eligible(m.pools.get(poolKey(tagId, type)) ?? []).map((c) => ({ id: c.id, label: c.label, popularity: c.popularity, profiled: false }));
    const pool = (type: string) => (t?.exemplarCandidates ? fromContext(type) : fromMemory(type));
    const tried = new Set((t?.recovery as { strategies?: { entityType: string; status: string }[] } | undefined)?.strategies?.filter((s) => s.status !== "available").map((s) => s.entityType) ?? []);
    const types = forcedType ? [forcedType] : pool("brand").length >= MIN_POOL || pool("brand").length >= pool("place").length ? ["brand", "place"] : ["place", "brand"];
    for (const type of types.filter((x) => !tried.has(x))) {
      const candidates = pool(type).filter((c) => !rejected.includes(c.label));
      if (candidates.length === 0) continue;
      const chosen: typeof candidates = [];
      for (const c of [...candidates].sort((a, b) => (b.popularity ?? -1) - (a.popularity ?? -1) || a.label.localeCompare(b.label))) {
        if (chosen.length >= max + (prefetch ? 1 : 0)) break;
        if (chosen.some((x) => labelFamily(x.label, c.label))) continue;
        chosen.push(c);
      }
      const proposal = chosen.slice(0, max);
      const out: unknown[] = prefetch ? chosen.filter((c) => !c.profiled).map((c) => call("qloo_get_entity_tags", { entityId: c.id }, `tag profile of candidate ${c.label} for the quality check`)) : [];
      out.push(
        call(
          "validate_territory_representation",
          { territoryKey, entityType: type, exemplars: proposal.map((c) => ({ id: c.id, reason: `Qloo tag member${c.popularity !== null ? ` (popularity ${Number(c.popularity.toFixed(2))})` : ""}` })) },
          `${proposal.length} distinct, well-evidenced ${type} exemplars`,
        ),
      );
      return out;
    }
    return [];
  }

  /** Recovery when no available strategy has candidates: probe an untried type, try an alternate concept, else concept-only. */
  private recover(m: Memory, t: Territory): unknown[] {
    const recovery = t.recovery as { strategies: { entityType: string; status: string }[]; unprobedTypes: string[]; alternateConcepts: { id: string; label: string }[] } | undefined;
    if (!recovery || !t.concept) return [];
    const probedTypes = new Set(recovery.strategies.map((s) => s.entityType));
    for (const type of ["brand", "place"]) if (!probedTypes.has(type) && recovery.unprobedTypes.includes(type)) return [call("qloo_recommend", { targetType: type, tagIds: [t.concept.id], conditionOnBrand: false, limit: 20 }, `recovery: probe ${type} members for ${t.concept.label}`)];
    const alt = recovery.alternateConcepts[0];
    if (alt && t.role === "target" && !m.pools.has(poolKey(alt.id, "brand"))) return [call("anchor_territory", { territoryKey: t.key, tagId: alt.id }, `recovery: alternate Qloo concept ${alt.label}`), call("qloo_recommend", { targetType: "brand", tagIds: [alt.id], conditionOnBrand: false, limit: 20 }, `members for ${alt.label}`)];
    return [call("declare_concept_only", { territoryKey: t.key, reason: "no representation strategy with valid Qloo exemplars remains" }, "recovery: concept-level evidence instead of a weak panel")];
  }
}
