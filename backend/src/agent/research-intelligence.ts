/**
 * Sprint 11 research intelligence: deterministic support for the model's research judgment.
 *
 * The model decides what the user means, whether a Qloo concept preserves it, and which research approach answers the
 * question. This module only records those judgments and enforces their boundaries:
 *   - a research approach can only narrow work (compare → investigate), never add budget or evidence;
 *   - a concept the agent itself judged MISMATCHED cannot anchor a user-named territory, and any non-equivalent concept
 *     is carried into the result as a qualification (never as coverage of the user's concept);
 *   - the brand's own Qloo category tags mark established positioning (tag URN facet, never a name);
 *   - brand facts are cited context supplied by the requester, kept apart from Qloo evidence.
 * Nothing here names a brand, territory or concept (AGENTS.md generalization rules).
 */
import type { AgentTerritoryResult, BrandIntelligenceBrief, ConceptAlignment, Limitation, ResearchApproach, ResearchApproachRecord } from "@cultural-elasticity/shared";
import { addTerritory } from "./state.js";
import { tagFacet, tagRole } from "../methodology/tag-facets.js";
import { canonicalTagName } from "./concept-dedup.js";
import type { AgentRunState, TerritoryState } from "./state.js";

export const RESEARCH_POLICY_VERSION = "research-intelligence/v1";
export type ResearchPolicy = "v0" | "v1";

/**
 * CE_RESEARCH_POLICY=v0 restores the Sprint 10 research behaviour (evaluation arm A and rollback). Default v1 for an LLM
 * decision model; the deterministic baseline policy always runs v0 because it cannot judge meaning.
 */
export function researchPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): ResearchPolicy {
  return env.CE_RESEARCH_POLICY === "v0" ? "v0" : "v1";
}

/** A run hydrated from a checkpoint written before Sprint 11 has no policy and keeps the behaviour it started with. */
export function policyOf(state: AgentRunState): ResearchPolicy {
  return state.researchPolicy ?? "v0";
}

/** The approach a new run starts with: the caller's explicit mode, else the gate-approved brief, else the intent's default. */
export function initialApproach(state: AgentRunState): ResearchApproachRecord {
  const intent = state.interpretation?.intent ?? state.request.intent;
  if (state.request.researchMode === "single_hypothesis_v1") return { approach: "investigate", decidedBy: "caller", reason: "the caller asked for a single-hypothesis investigation" };
  if (state.researchScope) return { approach: "investigate", decidedBy: "runtime", reason: `compound question: ${state.researchScope.reason}; a comparison per part does not fit the same budget` };
  const brief = state.request.researchBrief;
  if (brief && approachFits(brief.approach, intent)) return { approach: brief.approach, decidedBy: "interpreter", reason: brief.approachReason };
  return { approach: intent === "explore_frontier" ? "explore" : "compare", decidedBy: "default", reason: "the default approach for this operation" };
}

/**
 * Sprint 12: Qloo calls one concept of a compound question needs for direct evidence (tag search, member pool, up to
 * four tag profiles, the brand-conditioned query). A planning estimate for the split, never a budget.
 */
export const CALLS_PER_COMPOUND_PART = 8;
/** Calls the run spends before any concept (brand resolution and the brand's tag profile). */
const RUN_OVERHEAD_CALLS = 2;

const contentWords = (v: string) => new Set(v.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/u).filter((w) => w.length >= 4).map((w) => w.replace(/(?<=\p{L}{3})s$/u, "")));

/**
 * Sprint 12: a compound question ("X and Y") becomes one user target per distinct concept of the gate-approved research
 * brief, so each part is investigated on its own evidence and evidence for one part is never read as evidence for
 * another. Applies only to a single user-named target of analyze_move under v1, when every brief concept shares a
 * content word with the user's own territory label (the parts are of that territory, not other subjects of the
 * sentence). Parts that do not fit the run's existing Qloo budget stay listed, without a target, as not investigated.
 * The run then investigates without a ranking: one comparison per part does not fit the same budget. No budget changes.
 */
export function splitCompoundTarget(state: AgentRunState): void {
  if (policyOf(state) !== "v1" || state.territoryGrounding) return;
  const intent = state.interpretation?.intent ?? state.request.intent;
  const concepts = state.request.researchBrief?.concepts ?? [];
  const targets = state.territories.filter((t) => t.role === "target");
  if (intent !== "analyze_move" || concepts.length < 2 || targets.length !== 1 || targets[0]!.origin !== "user" || targets[0]!.status !== "open") return;
  const original = targets[0]!;
  const words = contentWords(original.label);
  const names = [...new Map(concepts.map((c) => [c.name.trim().toLowerCase(), c.name.trim()])).values()];
  if (names.length < 2 || !names.every((n) => [...contentWords(n)].some((w) => words.has(w)))) return;
  if (names.some((n) => n.toLowerCase() === original.label.trim().toLowerCase())) return;
  const affordable = Math.max(1, Math.floor((state.limits.maxQlooCalls - RUN_OVERHEAD_CALLS) / CALLS_PER_COMPOUND_PART));
  const fit = Math.min(affordable, state.limits.maxCandidateTerritories);
  if (fit < 2) return;
  state.territories = state.territories.filter((t) => t !== original);
  const parts = names.map((name, i) => i < fit
    ? { name, territoryKey: addTerritory(state, { label: name, role: "target", origin: "user", rationale: `named by the user as part of the compound question "${original.label}"` }).key as string | null }
    : { name, territoryKey: null });
  state.researchScope = {
    originalTerritory: original.label,
    concepts: parts,
    decidedBy: "runtime",
    reason: parts.some((p) => p.territoryKey === null)
      ? `the question names ${names.length} concepts; ${fit} fit the run's Qloo budget and are investigated separately, the rest are reported as not investigated`
      : `the question names ${names.length} concepts; each is investigated separately on its own evidence`,
  };
}

/** explore belongs to open discovery only; investigate and compare to a named direction. */
export function approachFits(approach: ResearchApproach, intent: string | undefined): boolean {
  if (intent === "explore_frontier") return approach === "explore";
  if (intent === "analyze_move") return approach === "investigate" || approach === "compare";
  if (intent === "compare_territories") return approach === "compare" || approach === "investigate";
  return false;
}

/**
 * True when the run builds no comparison set: an explicit single-hypothesis request, or (v1) an investigation the
 * interpreter or the agent chose. Every place that would otherwise require references reads this.
 */
export function withoutComparison(state: AgentRunState): boolean {
  if (state.request.researchMode === "single_hypothesis_v1") return true;
  return policyOf(state) === "v1" && state.researchApproach?.approach === "investigate";
}

/** The agent may reframe a comparison into an investigation once, before any target is analyzed. */
export function reframeRefusal(state: AgentRunState): string | null {
  if (policyOf(state) !== "v1") return "research approaches are not available under research policy v0";
  if (state.researchApproach?.approach !== "compare") return `the run already follows the ${state.researchApproach?.approach ?? "default"} approach`;
  if (state.territories.some((t) => t.role === "target" && t.status === "analyzed")) return "a target is already analyzed; the approach can no longer change";
  return null;
}

/** Labels that name the same concept once case, punctuation and a plural "s" are ignored. */
export function sameConceptName(label: string, tagId: string, tagLabel: string): boolean {
  const norm = (v: string) => v.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/u).map((w) => w.replace(/(?<=\p{L}{3})s$/u, "")).join(" ");
  const want = norm(label);
  return want === norm(tagLabel) || want === norm(canonicalTagName(tagId).replaceAll("_", " "));
}

/** A user-named target needs an explicit concept judgment unless the tag carries the territory's own name. */
export function alignmentRequired(state: AgentRunState, t: TerritoryState, tag: { id: string; label: string }): boolean {
  return policyOf(state) === "v1" && t.role === "target" && t.origin === "user" && !sameConceptName(t.label, tag.id, tag.label);
}

/** Runtime-recorded alignment for a same-named anchor (no model judgment involved). */
export function nameAlignment(t: TerritoryState, tag: { id: string; label: string }): ConceptAlignment {
  return { userConcept: t.label, qlooConcept: { id: tag.id, label: tag.label }, relation: "EQUIVALENT", reason: "the Qloo concept carries the territory's own name", uncovered: [], decidedBy: "runtime" };
}

/** The brand's own Qloo classification tag this concept matches, by id or canonical name (URN facet, never the tag's name). */
export function brandCoreTag(state: AgentRunState, conceptId: string): { tagId: string; label: string } | null {
  const brand = state.brand.entity;
  const profile = brand ? state.profiles.get(brand.id) : undefined;
  if (!profile) return null;
  const canonical = canonicalTagName(conceptId);
  for (const id of profile.tagIds) {
    const facet = tagFacet(id);
    if (!facet || tagRole(facet) !== "BRAND_CLASSIFICATION") continue;
    if (id === conceptId || canonicalTagName(id) === canonical) return { tagId: id, label: state.tags.get(id)?.label ?? canonicalTagName(id).replaceAll("_", " ") };
  }
  return null;
}

/** Result qualifications from the agent's concept judgment and the brand-core check. Limitations only: no number changes. */
export function researchLimitations(state: AgentRunState, r: Pick<AgentTerritoryResult, "label" | "role" | "resolvedConcept" | "conceptAlignment" | "brandCore">): Limitation[] {
  const out: Limitation[] = [];
  const a = r.conceptAlignment;
  if (a && a.relation !== "EQUIVALENT") {
    const scope = a.relation === "RELATED_DIFFERENT"
      ? `Qloo's "${a.qlooConcept.label}" is related to, but not the same as, "${a.userConcept}". The evidence describes ${a.qlooConcept.label}, not ${a.userConcept}`
      : `Qloo's "${a.qlooConcept.label}" covers only part of "${a.userConcept}"${a.uncovered.length ? ` (not covered: ${a.uncovered.join(", ")})` : ""}`;
    out.push({ code: "CONCEPT_NOT_EQUIVALENT", detail: `${scope}. Agent judgment: ${a.reason}` });
  }
  if (r.brandCore && r.role === "target") {
    out.push({ code: "BRAND_CORE_CATEGORY", detail: `Qloo categorises the brand itself as "${r.brandCore.label}". This is its established positioning, not an extension: a relative position here compares cultural affinity within this set and says nothing about how far the brand would stretch.` });
  }
  if (r.role === "target" && state.researchApproach?.reframedFrom) {
    out.push({ code: "COMPARISON_DECLINED", detail: `The agent investigated this direction without a comparison set: ${state.researchApproach.reason}` });
  }
  return out;
}

/**
 * Brand Intelligence Brief: cited facts (requester-supplied, not independently verified), the brand's own Qloo profile
 * split into classification and other observed tags, and what remains unverified. Interpretation is never stored here.
 */
export function brandIntelligenceBrief(state: AgentRunState): BrandIntelligenceBrief | null {
  const brand = state.brand.entity;
  const input = state.request.brandContext;
  const profile = brand ? state.profiles.get(brand.id) : undefined;
  if (!input && !profile) return null;
  const label = (id: string) => state.tags.get(id)?.label ?? canonicalTagName(id).replaceAll("_", " ");
  const classified = (profile?.tagIds ?? []).map((id) => ({ id, role: tagFacet(id) ? tagRole(tagFacet(id)!) : null }));
  const unverified: string[] = [];
  if (!input?.facts.length) unverified.push("No cited business facts were supplied; the brand's business model and positioning come only from Qloo's profile.");
  if (profile && !classified.some((t) => t.role === "BRAND_CLASSIFICATION")) unverified.push("Qloo returned no category tags for the brand, so established positioning cannot be told apart from a new direction.");
  if (!profile) unverified.push("The brand's Qloo profile was not fetched in this run.");
  return {
    version: "brand-intelligence/v1",
    facts: (input?.facts ?? []).map((f, i) => ({ ...f, ref: i + 1, origin: "requester_supplied" as const })),
    positioning: input?.positioning ?? null,
    qlooObserved: profile
      ? {
          categoryTags: classified.filter((t) => t.role === "BRAND_CLASSIFICATION").slice(0, 8).map((t) => ({ id: t.id, label: label(t.id) })),
          otherTags: classified.filter((t) => t.role === "AUDIENCE_TASTE").slice(0, 12).map((t) => ({ id: t.id, label: label(t.id) })),
          correlationId: profile.call.envelope.execution.correlation_id ?? null,
        }
      : null,
    unverified,
  };
}
