/**
 * Deterministic discovery helpers. The model reasons about hypotheses; these functions only derive
 * what the observed Qloo evidence supports, so a hypothesis is never accepted because a model named it.
 *
 *   exemplarCandidates     brand-independent tag-member pools → eligible exemplar candidates, ordered by
 *                          evidence availability (Qloo popularity), with ineligible ones explained
 *   frontierConcepts       tags carried by Qloo-related entities but not by the brand (support-counted)
 *   (territory deduplication lives in concept-dedup.ts)
 *   labelFamily            "X" vs "X Collection": the same name family, so not distinct exemplars
 *
 * No list of territories, brands or exemplars exists in this module.
 */
import { setOverlap } from "../analysis/overlap.js";
import { matchOperationalRule } from "../methodology/operational-tags.js";
import type { RankableType } from "./contracts.js";
import type { AgentRunState } from "./state.js";

const STOPWORDS = new Set(["the", "and", "for", "with", "of", "a", "an", "&", "co", "inc", "ltd", "group"]);

export function labelTokens(label: string): string[] {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .split(/[^a-z0-9]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map((t) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t));
}

/** True when one label's tokens are a prefix-run of the other's ("Aster" ⊂ "Aster Collection"). */
export function labelFamily(a: string, b: string): boolean {
  const ta = labelTokens(a);
  const tb = labelTokens(b);
  if (ta.length === 0 || tb.length === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every((token, i) => long[i] === token);
}

export type ExemplarCandidate = {
  id: string;
  label: string;
  type: RankableType;
  popularity: number | null;
  conceptSupport: "tag_member" | "profile_tag";
  supportCorrelationId: string;
};

export type IneligibleCandidate = { id: string; label: string; reason: string };

/**
 * Exemplar candidates for a concept and entity type, from evidence already in the run:
 *   - members of a brand-INDEPENDENT pool for the concept (recommend with only tag signals), or
 *   - entities whose observed tag profile carries the concept tag.
 * Entities seen only in brand-conditioned lists are not candidates (that would let the brand choose
 * its own comparison exemplars). The brand itself is never a candidate.
 * Order: popularity desc (evidence availability), then label; NOT Qloo's pool order, which is
 * id order for tag-only signals [live].
 */
export function exemplarCandidates(state: AgentRunState, conceptId: string, type: RankableType): { eligible: ExemplarCandidate[]; ineligible: IneligibleCandidate[] } {
  const brandId = state.brand.entity?.id;
  const eligible = new Map<string, ExemplarCandidate>();
  const ineligible: IneligibleCandidate[] = [];
  for (const pool of state.pools) {
    if (pool.targetType !== type || !pool.tagIds.includes(conceptId)) continue;
    for (const id of pool.memberIds) {
      const entity = state.entities.get(id);
      if (!entity) continue;
      if (id === brandId) {
        ineligible.push({ id, label: entity.label, reason: "the brand itself" });
        continue;
      }
      if (pool.conditionedOn !== null) {
        if (!eligible.has(id)) ineligible.push({ id, label: entity.label, reason: "seen only in a brand-conditioned list" });
        continue;
      }
      const source = entity.sources.find((s) => s.correlationId === pool.call.envelope.execution.correlation_id);
      eligible.set(id, { id, label: entity.label, type, popularity: source?.popularity ?? null, conceptSupport: "tag_member", supportCorrelationId: pool.call.envelope.execution.correlation_id });
    }
  }
  for (const profile of state.profiles.values()) {
    if (profile.subjectId === brandId || eligible.has(profile.subjectId) || !profile.tagIds.includes(conceptId)) continue;
    const entity = state.entities.get(profile.subjectId);
    if (!entity || entity.type !== type) continue;
    eligible.set(entity.id, { id: entity.id, label: entity.label, type, popularity: null, conceptSupport: "profile_tag", supportCorrelationId: profile.call.envelope.execution.correlation_id });
  }
  const finalIneligible = ineligible.filter((c, i, all) => !eligible.has(c.id) && all.findIndex((x) => x.id === c.id) === i);
  const ordered = [...eligible.values()].sort((a, b) => (b.popularity ?? -1) - (a.popularity ?? -1) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  return { eligible: ordered, ineligible: finalIneligible };
}

/**
 * Picks up to `max` exemplars by generic quality rules, NOT "first three results":
 * evidence availability (popularity) first, skipping name-family duplicates of an already chosen
 * exemplar, and (when profiles are known) skipping near-identical tag profiles while alternatives exist.
 * Used by the deterministic baseline policy; an LLM agent may choose differently, and the validator
 * enforces the objective constraints either way.
 */
export function suggestExemplars(state: AgentRunState, candidates: ExemplarCandidate[], max: number): { chosen: ExemplarCandidate[]; skipped: IneligibleCandidate[] } {
  const chosen: ExemplarCandidate[] = [];
  const skipped: IneligibleCandidate[] = [];
  for (const candidate of candidates) {
    if (chosen.length >= max) break;
    const family = chosen.find((c) => labelFamily(c.label, candidate.label));
    if (family) {
      skipped.push({ id: candidate.id, label: candidate.label, reason: `same name family as ${family.label}` });
      continue;
    }
    const near = chosen.find((c) => profileJaccard(state, c.id, candidate.id) !== null && (profileJaccard(state, c.id, candidate.id) as number) >= NEAR_IDENTICAL_PROFILE_JACCARD);
    if (near) {
      skipped.push({ id: candidate.id, label: candidate.label, reason: `tag profile near-identical to ${near.label}` });
      continue;
    }
    chosen.push(candidate);
  }
  return { chosen, skipped };
}

/** Tag-profile Jaccard at or above this marks two exemplars as near-identical (diversity check only). */
export const NEAR_IDENTICAL_PROFILE_JACCARD = 0.8;

/** Jaccard of two observed tag profiles (operational tags excluded); null when either profile is unknown. */
export function profileJaccard(state: AgentRunState, a: string, b: string): number | null {
  const pa = state.profiles.get(a);
  const pb = state.profiles.get(b);
  if (!pa || !pb) return null;
  const cultural = (ids: string[]) => ids.filter((id) => matchOperationalRule({ id }) === undefined);
  return setOverlap(cultural(pa.tagIds), cultural(pb.tagIds)).jaccard;
}

export type FrontierConcept = { tagId: string; label: string; type: string; support: number; supportingEntities: string[] };

/**
 * Concepts Qloo associates with entities related to the brand, which the brand's own profile does not
 * carry: candidate frontier territories. Support = number of related entities whose observed profile
 * carries the tag. Operational tags are excluded. Requires the related entities' profiles to have been
 * fetched; returns [] otherwise (no evidence, no candidates).
 */
export function frontierConcepts(state: AgentRunState, minSupport = 2): FrontierConcept[] {
  const brandId = state.brand.entity?.id;
  if (!brandId) return [];
  const brandTags = new Set(state.profiles.get(brandId)?.tagIds ?? []);
  const relatedIds = new Set(state.related.filter((r) => r.subjectId === brandId).flatMap((r) => r.memberIds));
  const support = new Map<string, Set<string>>();
  for (const id of relatedIds) {
    const profile = state.profiles.get(id);
    if (!profile) continue;
    for (const tagId of new Set(profile.tagIds)) {
      if (brandTags.has(tagId) || matchOperationalRule({ id: tagId }) !== undefined) continue;
      support.set(tagId, (support.get(tagId) ?? new Set()).add(id));
    }
  }
  return [...support.entries()]
    .filter(([, ids]) => ids.size >= minSupport)
    .map(([tagId, ids]) => {
      const tag = state.tags.get(tagId);
      return { tagId, label: tag?.label ?? tagId, type: tag?.type ?? "unknown", support: ids.size, supportingEntities: [...ids].map((id) => state.entities.get(id)?.label ?? id).sort() };
    })
    .sort((a, b) => b.support - a.support || a.label.localeCompare(b.label) || a.tagId.localeCompare(b.tagId));
}
