/**
 * BaselinePolicyModel: a deterministic REFERENCE POLICY, not the production agent and not an LLM.
 *
 * It exists so the runtime can be exercised end to end, against the synthetic world and against live
 * Qloo, while no model credential is configured. Results it drives are always labelled
 * `model.kind = "baseline"` and carry the AGENT_POLICY_NOT_LLM limitation; the agent model itself is
 * then LIVE_AGENT_MODEL_VALIDATION_NOT_RUN.
 *
 * It has no natural-language understanding: it needs the request's structured fields (brand, and
 * territories or intent) and asks the user otherwise. Its choices are generic rules over Qloo evidence
 * (no brand, territory or exemplar is named anywhere):
 *   concept      among Qloo tags named exactly like the territory (else the first two tags returned),
 *                the one with the largest brand-independent pool
 *   type         brand pools first; place pools when Qloo has no brands for the concept
 *   exemplars    up to the limit by Qloo popularity, skipping name-family duplicates and rejected ones
 *   references   for a single move or a two-territory comparison: concepts from the brand's own Qloo
 *                profile, proposed only after a probe shows Qloo has ≥ 2 brands for them
 *   frontier     concepts carried by Qloo-related brands but not by the brand, proposed only after the
 *                same probe
 *   ambiguity    asks the user; after an answer, resolves the candidate the answer names (id or label)
 * It writes no synthesis: results get the deterministic template.
 * Because the same rules run for every case, different analysis routes come only from different Qloo
 * structure, never from different code paths.
 */
import type { AgentModelInfo } from "@cultural-elasticity/shared";
import { matchOperationalRule } from "../../methodology/operational-tags.js";
import { labelFamily } from "../candidate-discovery.js";
import type { ModelTurn } from "../contracts.js";
import { MIN_COMPARISON_SET } from "../router.js";
import { slugify } from "../state.js";
import type { AgentDecisionContext, AgentModel } from "./provider.js";

type Member = { id: string; label: string; popularity: number | null; isBrand?: boolean };
type Memory = {
  tagsByQuery: Map<string, { id: string; label: string }[]>;
  pools: Map<string, Member[]>;
  referencesProposed: boolean;
  frontierProposed: boolean;
};

const PROBE_TAGS = 2;
const EXACT_PROBES = 3;
const REFERENCE_PROBES = 6;
const FRONTIER_PROBES = 8;
const FRONTIER_CANDIDATES = 4;
const RELATED_PROFILES = 3;
/** A concept is usable as a reference/frontier panel only if Qloo returns at least this many eligible brands. */
const MIN_POOL = 2;

const call = (tool: string, args: unknown, reasonSummary: string) => ({ action: "call_tool", tool, arguments: args, reasonSummary });
const poolKey = (tagId: string, type: string) => `${tagId}|${type}`;

export class BaselinePolicyModel implements AgentModel {
  readonly info: AgentModelInfo = { id: "baseline-policy-v1", kind: "baseline", live: false };
  private readonly memory = new Map<string, Memory>();

  private mem(runId: string): Memory {
    let m = this.memory.get(runId);
    if (!m) {
      m = { tagsByQuery: new Map(), pools: new Map(), referencesProposed: false, frontierProposed: false };
      this.memory.set(runId, m);
    }
    return m;
  }

  private absorb(m: Memory, context: AgentDecisionContext): void {
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
    if (!context.evidence.brandProfile) actions.push(call("qloo_get_entity_tags", { entityId: brand.id }, "brand tag profile"));
    if (intent === "explore_frontier") {
      if (context.evidence.relatedEntities.length === 0) actions.push(call("qloo_related_entities", { entityId: brand.id, targetType: "brand", limit: 5 }, "Qloo-related brands for frontier discovery"));
      for (const r of context.evidence.relatedEntities.slice(0, RELATED_PROFILES)) if (!r.profiled) actions.push(call("qloo_get_entity_tags", { entityId: r.id }, `tag profile of related brand ${r.label}`));
    }

    const open = context.territories.filter((t) => t.status !== "analyzed" && t.status !== "dropped");
    const anchoredNow = new Set<string>();
    for (const t of open.filter((x) => !x.concept && x.role === "target")) {
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
      // Choose (tag, type) by eligible members: a brand pool with ≥ MIN_POOL wins; otherwise place pools are
      // probed and a richer place pool wins over a thin brand pool. Purely evidence-driven.
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
      actions.push(call("anchor_territory", { territoryKey: t.key, tagId: chosen.id }, `concept with the most Qloo-linked entities`));
      anchoredNow.add(t.key);
      const rep = representation(m, t.key, chosen.id, t.rejectedExemplars.map((r) => r.label), context.budget.maxExemplarsPerTerritory);
      if (rep) actions.push(rep);
    }

    const targetCount = context.territories.filter((t) => t.role === "target" && t.status !== "dropped").length;
    if ((intent === "analyze_move" || intent === "compare_territories") && targetCount < MIN_COMPARISON_SET && !m.referencesProposed && context.evidence.brandProfile) {
      const used = new Set(context.territories.flatMap((t) => (t.concept ? [t.concept.id] : [])));
      const candidates = context.evidence.brandProfile.filter((tag) => !used.has(tag.id) && matchOperationalRule({ id: tag.id }) === undefined).slice(0, REFERENCE_PROBES);
      const proposals = probeThenPropose(m, candidates.map((c) => ({ tagId: c.id, label: c.label })), MIN_COMPARISON_SET - targetCount, "reference", () => "a concept on the brand's own Qloo profile for which Qloo returns brands; used as a comparison reference", context.budget.maxExemplarsPerTerritory);
      actions.push(...proposals.actions);
      if (proposals.done) m.referencesProposed = true;
    }
    if (intent === "explore_frontier" && !m.frontierProposed && context.evidence.frontierConcepts.length > 0 && context.evidence.relatedEntities.slice(0, RELATED_PROFILES).every((r) => r.profiled)) {
      const concepts = context.evidence.frontierConcepts.slice(0, FRONTIER_PROBES);
      const support = new Map(concepts.map((c) => [c.tagId, c.support]));
      const proposals = probeThenPropose(m, concepts, FRONTIER_CANDIDATES, "frontier_candidate", (tagId) => `carried by ${support.get(tagId)} Qloo-related brand(s), not by the brand; Qloo returns brands for it`, context.budget.maxExemplarsPerTerritory);
      actions.push(...proposals.actions);
      if (proposals.done) m.frontierProposed = true;
    }

    for (const t of open.filter((x) => x.concept && !x.representation && x.attemptsLeft > 0 && !anchoredNow.has(x.key))) {
      const rep = representation(m, t.key, t.concept!.id, t.rejectedExemplars.map((r) => r.label), context.budget.maxExemplarsPerTerritory);
      if (rep) actions.push(rep);
    }

    if (actions.length > 0) return { decisions: actions.slice(0, max) };
    const pending = open.map((t) => t.key);
    if (pending.length > 0) return { decisions: [{ action: "analyze", targetIds: pending.slice(0, 6), reasonSummary: "no further evidence to gather; analyze" }] };
    return { decisions: [{ action: "finish", resultIds: context.territories.filter((t) => t.analysisRoute).map((t) => t.key), reasonSummary: "all territories analyzed" }] };
  }
}

/**
 * Probe each candidate concept's brand-independent brand pool first (one call each); once every probe is
 * back, propose + anchor + represent only concepts with ≥ MIN_POOL eligible brands. `done` = proposed.
 */
function probeThenPropose(m: Memory, concepts: { tagId: string; label: string }[], wanted: number, role: "reference" | "frontier_candidate", rationale: (tagId: string) => string, maxExemplars: number): { actions: unknown[]; done: boolean } {
  const unprobed = concepts.filter((c) => !m.pools.has(poolKey(c.tagId, "brand")));
  if (unprobed.length > 0) return { actions: unprobed.map((c) => call("qloo_recommend", { targetType: "brand", tagIds: [c.tagId], conditionOnBrand: false, limit: 20 }, `probe whether Qloo has brands for ${c.label}`)), done: false };
  const usable = concepts.filter((c) => eligible(m.pools.get(poolKey(c.tagId, "brand"))!).length >= MIN_POOL).slice(0, wanted);
  const actions: unknown[] = [];
  for (const c of usable) {
    actions.push(call("propose_territory", { label: c.label, role, origin: "qloo_evidence", rationale: rationale(c.tagId), evidenceTagIds: [c.tagId] }, `${role === "reference" ? "reference" : "frontier"} concept with Qloo brand members`));
    actions.push(call("anchor_territory", { territoryKey: slugify(c.label), tagId: c.tagId }, "anchor to its Qloo tag"));
    const rep = representation(m, slugify(c.label), c.tagId, [], maxExemplars);
    if (rep) actions.push(rep);
  }
  return { actions, done: true };
}

function eligible(members: Member[]): Member[] {
  return members.filter((x) => !x.isBrand);
}

function representation(m: Memory, territoryKey: string, tagId: string, rejected: string[], max: number) {
  const size = (type: string) => eligible(m.pools.get(poolKey(tagId, type)) ?? []).length;
  // Brand when Qloo has enough brands; otherwise whichever type has more members.
  const types: ("brand" | "place")[] = size("brand") >= MIN_POOL || size("brand") >= size("place") ? ["brand", "place"] : ["place", "brand"];
  for (const type of types) {
    const pool = m.pools.get(poolKey(tagId, type));
    if (!pool || eligible(pool).length === 0) continue;
    const chosen: Member[] = [];
    for (const member of [...eligible(pool)].sort((a, b) => (b.popularity ?? -1) - (a.popularity ?? -1) || a.label.localeCompare(b.label))) {
      if (chosen.length >= max) break;
      if (rejected.includes(member.label) || chosen.some((c) => labelFamily(c.label, member.label))) continue;
      chosen.push(member);
    }
    if (chosen.length === 0) return undefined;
    return call(
      "validate_territory_representation",
      { territoryKey, entityType: type, exemplars: chosen.map((c) => ({ id: c.id, reason: `Qloo tag member${c.popularity !== null ? ` (popularity ${Number(c.popularity.toFixed(2))})` : ""}` })) },
      `${chosen.length} distinct, well-evidenced ${type} exemplars`,
    );
  }
  return undefined;
}
