/**
 * ConceptDeduplicator: are two territory hypotheses the same cultural concept?
 *
 *   Layer 1 deterministic  DUPLICATE       same Qloo concept id; equal normalized labels; labels equal after
 *                                          safe plural normalization; anchored tags with the same canonical
 *                                          name in different namespaces (keyword:…:x vs lifestyle:…:x)
 *                          NEAR_DUPLICATE  equal morphological stems ("-ing", "-er", "-ers": a word family)
 *   Layer 2 structural     NEAR_DUPLICATE  brand-independent member pools overlap (Jaccard ≥ 0.6, or one
 *                                          pool nearly contained in the other); a shared accepted exemplar;
 *                                          the two concept tags co-occur in most profiles that carry either
 *   Layer 3 semantic       the model may label a pair DUPLICATE / NEAR_DUPLICATE / DISTINCT with a reason
 *                          (advisory, recorded separately)
 *
 * Combination rules (DEDUP_RULES_VERSION)
 *   - an exact deterministic DUPLICATE always stands (the model cannot override it);
 *   - a structural NEAR_DUPLICATE (Qloo evidence) stands;
 *   - a label-morphology NEAR_DUPLICATE may be downgraded to DISTINCT by the model, with its reason;
 *   - a DISTINCT pair the model labels DUPLICATE / NEAR_DUPLICATE becomes that (removal only).
 * Action: the later generated hypothesis (reference or frontier candidate) is dropped; a user-named target
 * is never dropped, only warned about.
 */
import type { ConceptDedupDecision, ConceptDedupVerdict } from "@cultural-elasticity/shared";
import { setOverlap } from "../analysis/overlap.js";
import type { AgentRunState, TerritoryState } from "./state.js";

export const DEDUP_RULES_VERSION = "concept-dedup-v1";

/** Member-pool Jaccard at or above this marks two territories as near-duplicates. */
export const NEAR_DUPLICATE_POOL_JACCARD = 0.6;
/** Overlap coefficient (|A∩B| / min) at or above this, with both pools ≥ 3, marks containment. */
export const NEAR_DUPLICATE_POOL_CONTAINMENT = 0.8;
/** Share of profiles carrying either concept tag that carry both. */
export const CO_OCCURRENCE_SHARE = 0.67;

const norm = (label: string) =>
  label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();

/** Safe plural normalization only ("stores" → "store", "boxes" kept as "boxe" never merges with "box"). */
function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us") && !word.endsWith("is")) return word.slice(0, -1);
  return word;
}

/** Morphological stem: singular, then "-ing" and repeated "-er" removed while a stem of ≥ 5 letters remains. */
function stem(word: string): string {
  let w = singular(word);
  if (w.length - 3 >= 5 && w.endsWith("ing")) w = w.slice(0, -3);
  while (w.length - 2 >= 5 && w.endsWith("er")) w = w.slice(0, -2);
  return w;
}

export const pluralKey = (label: string) => norm(label).split(" ").map(singular).join(" ");
export const stemKey = (label: string) => norm(label).split(" ").map(stem).join(" ");

/** "urn:tag:keyword:qloo:coffee" → "coffee" (the canonical name, namespace removed). */
export function canonicalTagName(tagId: string): string {
  return tagId.split(":").at(-1)?.toLowerCase() ?? tagId;
}

/**
 * Sprint 5A.1 canonical concept key: the canonical tag name with safe plural normalization per token
 * ("urn:tag:genre:media:cookbooks" → "cookbook"; "urn:tag:genre:qloo:self_help" → "self_help"). A label without a tag
 * is normalized the same way. Nothing else is merged here: no stemming of "-ing"/"-er", no synonyms.
 */
export function canonicalConceptKey(tagIdOrLabel: string): string {
  const name = tagIdOrLabel.startsWith("urn:") ? canonicalTagName(tagIdOrLabel) : tagIdOrLabel;
  return norm(name.replace(/_/gu, " ")).split(" ").filter(Boolean).map(singular).join("_");
}

/**
 * How two canonical keys relate: SAME (identical), ALIAS (one's tokens are contained in the other's, e.g. "folk" and
 * "folk_music" — a plausible alias, recorded as uncertain and never merged), or null (different names).
 */
export function canonicalRelation(a: string, b: string): "SAME" | "ALIAS" | null {
  if (a === b) return "SAME";
  const ta = new Set(a.split("_"));
  const tb = new Set(b.split("_"));
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  return small.size > 0 && [...small].every((t) => large.has(t)) ? "ALIAS" : null;
}

type Finding = { verdict: ConceptDedupVerdict; layer: "deterministic" | "structural"; basis: string; morphologyOnly: boolean };

/** Layer 1 over labels and (when anchored) concept ids. */
export function deterministicDuplicate(a: { label: string; conceptId: string | null }, b: { label: string; conceptId: string | null }): Finding | null {
  if (a.conceptId && b.conceptId && a.conceptId === b.conceptId) return { verdict: "DUPLICATE", layer: "deterministic", basis: `same Qloo concept ${a.conceptId}`, morphologyOnly: false };
  if (norm(a.label) === norm(b.label)) return { verdict: "DUPLICATE", layer: "deterministic", basis: "identical normalized labels", morphologyOnly: false };
  if (pluralKey(a.label) === pluralKey(b.label)) return { verdict: "DUPLICATE", layer: "deterministic", basis: "labels differ only by plural form", morphologyOnly: false };
  if (a.conceptId && b.conceptId && canonicalTagName(a.conceptId) === canonicalTagName(b.conceptId)) {
    return { verdict: "DUPLICATE", layer: "deterministic", basis: `concepts share the canonical tag name "${canonicalTagName(a.conceptId)}" in different namespaces`, morphologyOnly: false };
  }
  if (stemKey(a.label) === stemKey(b.label)) return { verdict: "NEAR_DUPLICATE", layer: "deterministic", basis: `labels share the word stem "${stemKey(a.label)}"`, morphologyOnly: true };
  return null;
}

function poolOf(state: AgentRunState, t: TerritoryState): Set<string> | undefined {
  if (!t.concept) return undefined;
  const pools = state.pools.filter((p) => p.conditionedOn === null && p.tagIds.length === 1 && p.tagIds[0] === t.concept!.id && p.memberIds.length > 0);
  return pools.length ? new Set(pools.flatMap((p) => p.memberIds)) : undefined;
}

/** Layer 2 over Qloo structure observed in the run. */
export function structuralDuplicate(state: AgentRunState, a: TerritoryState, b: TerritoryState): Finding | null {
  const pa = poolOf(state, a);
  const pb = poolOf(state, b);
  if (pa && pb) {
    const overlap = setOverlap(pa, pb);
    if ((overlap.jaccard ?? 0) >= NEAR_DUPLICATE_POOL_JACCARD) return { verdict: "NEAR_DUPLICATE", layer: "structural", basis: `Qloo member pools overlap (Jaccard ${Math.round((overlap.jaccard ?? 0) * 100) / 100})`, morphologyOnly: false };
    if (pa.size >= 3 && pb.size >= 3 && (overlap.overlapCoefficient ?? 0) >= NEAR_DUPLICATE_POOL_CONTAINMENT) {
      return { verdict: "NEAR_DUPLICATE", layer: "structural", basis: `one Qloo member pool is nearly contained in the other (overlap coefficient ${Math.round((overlap.overlapCoefficient ?? 0) * 100) / 100})`, morphologyOnly: false };
    }
  }
  const ea = new Set(a.representation?.exemplars.map((e) => e.id) ?? []);
  const shared = (b.representation?.exemplars ?? []).filter((e) => ea.has(e.id));
  if (shared.length > 0) return { verdict: "NEAR_DUPLICATE", layer: "structural", basis: `shares exemplar(s) ${shared.map((e) => e.label).join(", ")}`, morphologyOnly: false };
  if (a.concept && b.concept) {
    const carrying = [...state.profiles.values()].filter((p) => p.tagIds.includes(a.concept!.id) || p.tagIds.includes(b.concept!.id));
    const both = carrying.filter((p) => p.tagIds.includes(a.concept!.id) && p.tagIds.includes(b.concept!.id));
    if (both.length >= 2 && both.length / carrying.length >= CO_OCCURRENCE_SHARE) return { verdict: "NEAR_DUPLICATE", layer: "structural", basis: `the two Qloo concept tags co-occur in ${both.length} of ${carrying.length} profiles carrying either`, morphologyOnly: false };
  }
  return null;
}

function modelJudgment(state: AgentRunState, a: TerritoryState, b: TerritoryState) {
  return [...state.dedupJudgments].reverse().find((j) => (j.aKey === a.key && j.bKey === b.key) || (j.aKey === b.key && j.bKey === a.key));
}

const generated = (t: TerritoryState) => t.role !== "target";

/** Decision for one ordered pair (a earlier than b). */
export function decidePair(state: AgentRunState, a: TerritoryState, b: TerritoryState): ConceptDedupDecision {
  const det = deterministicDuplicate({ label: a.label, conceptId: a.concept?.id ?? null }, { label: b.label, conceptId: b.concept?.id ?? null });
  const finding = det && !det.morphologyOnly ? det : (structuralDuplicate(state, a, b) ?? det);
  const judgment = modelJudgment(state, a, b);
  let verdict: ConceptDedupVerdict = finding?.verdict ?? "DISTINCT";
  let layer: ConceptDedupDecision["layer"] = finding?.layer ?? "deterministic";
  let basis = finding?.basis ?? "no deterministic or structural overlap observed";
  let applied = false;
  if (judgment) {
    if (!finding && judgment.verdict !== "DISTINCT") {
      [verdict, layer, basis, applied] = [judgment.verdict, "semantic", `model judgment: ${judgment.reason}`, true];
    } else if (finding?.morphologyOnly && finding.layer === "deterministic" && judgment.verdict === "DISTINCT") {
      [verdict, layer, basis, applied] = ["DISTINCT", "semantic", `model judged the word-family match distinct: ${judgment.reason}`, true];
    }
  }
  const droppable = verdict !== "DISTINCT" ? (generated(b) && b.status !== "analyzed" ? b : generated(a) && a.status !== "analyzed" && b.role === "target" ? a : null) : null;
  return {
    a: { key: a.key, label: a.label },
    b: { key: b.key, label: b.label },
    layer,
    verdict,
    basis,
    modelJudgment: judgment ? { verdict: judgment.verdict, reason: judgment.reason, applied } : null,
    action: verdict === "DISTINCT" ? "kept" : droppable ? "dropped" : "warned",
    dropped: droppable?.key ?? null,
  };
}

/** All non-DISTINCT decisions (plus model-applied DISTINCT overrides) among the territories. Pure: applies nothing. */
export function conceptDuplicates(state: AgentRunState, territories: readonly TerritoryState[]): ConceptDedupDecision[] {
  const out: ConceptDedupDecision[] = [];
  const gone = new Set<string>();
  for (let i = 0; i < territories.length; i += 1) {
    const b = territories[i]!;
    if (gone.has(b.key)) continue;
    for (let j = 0; j < i; j += 1) {
      const a = territories[j]!;
      if (gone.has(a.key)) continue;
      const decision = decidePair(state, a, b);
      if (decision.verdict === "DISTINCT") {
        // A model judgment that overrode a word-family finding is still a decision worth recording.
        if (decision.modelJudgment?.applied) out.push(decision);
        continue;
      }
      out.push(decision);
      if (decision.dropped) {
        gone.add(decision.dropped);
        if (decision.dropped === b.key) break;
      }
    }
  }
  return out;
}

/**
 * Applies dedup: drops the decided generated hypotheses and records every decision once. Returns dropped keys.
 * `final = false` (right after resolution) applies only exact and structural findings; word-family
 * near-duplicates without a model judgment wait until analysis, so the model can still judge them.
 */
export function applyConceptDedup(state: AgentRunState, territories: readonly TerritoryState[], final = true): string[] {
  const dropped: string[] = [];
  for (const d of conceptDuplicates(state, territories)) {
    if (!final && d.layer === "deterministic" && d.verdict === "NEAR_DUPLICATE" && !d.modelJudgment) continue;
    const seen = state.trace.conceptDedup.some((x) => x.a.key === d.a.key && x.b.key === d.b.key && x.verdict === d.verdict && x.action === d.action);
    if (!seen) state.trace.conceptDedup.push(d);
    if (!d.dropped) continue;
    const t = state.territories.find((x) => x.key === d.dropped);
    if (!t || t.status === "dropped") continue;
    const other = d.dropped === d.a.key ? d.b : d.a;
    t.status = "dropped";
    t.dropReason = { code: "DUPLICATE_TERRITORY", detail: `${d.verdict.toLowerCase().replace("_", "-")} of ${other.label} (${d.layer}: ${d.basis})` };
    state.candidateRejections.push({ key: t.key, stage: "dedup", code: "DUPLICATE_TERRITORY", reason: t.dropReason.detail });
    dropped.push(t.key);
  }
  return dropped;
}
