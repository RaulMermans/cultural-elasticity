/**
 * RepresentationQualityEvaluator: is this candidate a good exemplar of this territory concept?
 *
 * Deterministic signals come only from Qloo evidence observed in the run. The model may add an ADVISORY
 * semantic judgment (relevance + reason); it is stored apart from the signals and combined with them by
 * the explicit rules below. It can veto a candidate's semantic fit; it can never add Qloo support.
 *
 * Hard constraints (any → REJECT)
 *   ENTITY_UNRESOLVED / MIXED_ENTITY_TYPES / BRAND_AS_EXEMPLAR / BRAND_CONDITIONED_SELECTION /
 *   EXEMPLAR_SEMANTIC_MISMATCH (Qloo does not link it to the concept) / DUPLICATE / NEAR_DUPLICATE (name
 *   family) / EXEMPLAR_EVIDENCE_EMPTY (fetched profile is empty)
 *
 * Weak signals (relative to peers, so media-heavy profiles across a whole pool do not count against it)
 *   PEER_OUTLIER       ≥ 2 peer candidates with fetched profiles share cultural tags with each other, and
 *                      this candidate shares none with any of them (the concept tag itself is not counted)
 *   CONCEPT_ABSENT     ≥ 2 peers have fetched profiles, at least half of them carry the concept (tag id or a
 *                      tag whose label contains the concept's word stem), and this candidate does not
 *   Without peer profiles there are no weak signals: quality is "unverified", not weak.
 *
 * Combination rules (QUALITY_RULES_VERSION)
 *   R1 deterministic REJECT                 → REJECT  (the model cannot rescue a hard failure)
 *   R2 model MISMATCH                       → REJECT  (semantic veto; removal only)
 *   R3 deterministic WEAK + model WEAK      → REJECT
 *   R4 deterministic WEAK (model ok/absent) → WEAK
 *   R5 deterministic VALID + model WEAK     → WEAK
 *   R6 otherwise                            → VALID
 */
import type { ExemplarQualityLevel, RepresentationFailureCode, SemanticRelevance } from "@cultural-elasticity/shared";
import { setOverlap } from "../analysis/overlap.js";
import { matchOperationalRule } from "../methodology/operational-tags.js";
import { labelFamily, labelTokens, type ExemplarCandidate } from "./candidate-discovery.js";
import type { RankableType } from "./contracts.js";
import type { AgentRunState } from "./state.js";

export const QUALITY_RULES_VERSION = "representation-quality-v1";

/** Minimum peers with fetched profiles before relative weak signals apply. */
export const MIN_QUALITY_PEERS = 2;

export type SemanticAssessment = { relevance: SemanticRelevance; reason: string };

export type QualityInput = {
  conceptId: string;
  conceptLabel: string;
  entityType: RankableType;
  candidateId: string;
  /** Eligible candidates for this concept and type (the peer set). */
  eligible: readonly ExemplarCandidate[];
  /** Exemplars already accepted in this proposal (name-family and duplicate checks). */
  acceptedSoFar: readonly { id: string; label: string }[];
  /** Exemplars of OTHER territories (cross-territory duplicates). */
  usedElsewhere: ReadonlyMap<string, string>;
  semantic: SemanticAssessment | null;
};

export type QualityVerdict = {
  deterministic: { level: ExemplarQualityLevel; signals: Record<string, string | number | boolean | null>; reasons: string[]; hardCode: RepresentationFailureCode | null };
  final: ExemplarQualityLevel;
  rule: string;
};

const cultural = (ids: readonly string[]) => ids.filter((id) => matchOperationalRule({ id }) === undefined);

/** True when a profile carries the concept tag, or a tag whose label shares a word stem with the concept label. */
function carriesConcept(state: AgentRunState, tagIds: readonly string[], conceptId: string, conceptLabel: string): boolean {
  if (tagIds.includes(conceptId)) return true;
  const stems = new Set(labelTokens(conceptLabel).filter((t) => t.length >= 4));
  if (stems.size === 0) return false;
  return tagIds.some((id) => labelTokens(state.tags.get(id)?.label ?? "").some((t) => stems.has(t)));
}

export function evaluateExemplarQuality(state: AgentRunState, input: QualityInput): QualityVerdict {
  const signals: Record<string, string | number | boolean | null> = {};
  const reasons: string[] = [];
  const entity = state.entities.get(input.candidateId);
  const label = entity?.label ?? input.candidateId;
  const candidate = input.eligible.find((c) => c.id === input.candidateId);
  const profile = state.profiles.get(input.candidateId);

  signals.resolves = entity !== undefined;
  signals.correctType = entity ? (entity.type === undefined ? null : entity.type === input.entityType) : null;
  signals.isBrand = input.candidateId === state.brand.entity?.id;
  signals.linkedToConcept = candidate?.conceptSupport ?? null;
  signals.brandConditionedOnly = entity ? entity.sources.length > 0 && entity.sources.every((s) => s.kind === "conditioned") : false;
  signals.profileFetched = profile !== undefined;
  signals.profileTags = profile ? profile.tagIds.length : null;
  signals.popularity = candidate?.popularity ?? null;
  signals.duplicateOf = input.acceptedSoFar.some((e) => e.id === input.candidateId) ? "this proposal" : (input.usedElsewhere.get(input.candidateId) ?? null);
  signals.nameFamilyOf = input.acceptedSoFar.find((e) => e.id !== input.candidateId && labelFamily(e.label, label))?.label ?? null;

  let hardCode: RepresentationFailureCode | null = null;
  const hard = (code: RepresentationFailureCode, why: string) => {
    if (!hardCode) hardCode = code;
    reasons.push(`${code}: ${why}`);
  };
  if (!entity) hard("ENTITY_UNRESOLVED", "not observed in any Qloo response in this run");
  else if (signals.isBrand) hard("BRAND_AS_EXEMPLAR", "the brand cannot represent a territory it is compared with");
  else if (signals.duplicateOf) hard("DUPLICATE_EXEMPLAR", signals.duplicateOf === "this proposal" ? "proposed twice" : `already represents ${signals.duplicateOf}`);
  else if (signals.correctType === false) hard("MIXED_ENTITY_TYPES", `observed as ${entity.type}, representation type is ${input.entityType}`);
  else if (!candidate) {
    if (signals.brandConditionedOnly) hard("BRAND_CONDITIONED_SELECTION", "seen only in a brand-conditioned list; choose exemplars from brand-independent evidence");
    else hard("EXEMPLAR_SEMANTIC_MISMATCH", `Qloo has not linked it to ${input.conceptLabel} in this run (no tag-pool membership, no profile tag)`);
  } else if (signals.nameFamilyOf) hard("NEAR_DUPLICATE_EXEMPLAR", `same name family as ${signals.nameFamilyOf}`);
  else if (profile && profile.tagIds.length === 0) hard("EXEMPLAR_EVIDENCE_EMPTY", "Qloo returned an empty tag profile");

  // Relative weak signals over peers with fetched profiles.
  const peers = input.eligible.filter((c) => c.id !== input.candidateId && state.profiles.has(c.id) && (state.profiles.get(c.id)!.tagIds.length ?? 0) > 0);
  signals.peersWithProfiles = peers.length;
  const weak: string[] = [];
  if (!hardCode && profile && profile.tagIds.length > 0 && peers.length >= MIN_QUALITY_PEERS) {
    // The concept tag itself is shared by construction (pool membership); the outlier test looks past it.
    const own = cultural(profile.tagIds).filter((id) => id !== input.conceptId);
    const peerTags = peers.map((p) => cultural(state.profiles.get(p.id)!.tagIds).filter((id) => id !== input.conceptId));
    const sharedWithPeers = peerTags.map((tags) => setOverlap(own, tags).sharedCount);
    let cohesivePeers = false;
    for (let i = 0; i < peerTags.length && !cohesivePeers; i += 1) for (let j = i + 1; j < peerTags.length; j += 1) if (setOverlap(peerTags[i]!, peerTags[j]!).sharedCount > 0) cohesivePeers = true;
    signals.maxSharedWithPeer = Math.max(...sharedWithPeers);
    if (cohesivePeers && sharedWithPeers.every((n) => n === 0)) weak.push("PEER_OUTLIER: shares no cultural tag with any peer candidate, while the peers share tags with each other");
    const peersCarrying = peers.filter((p) => carriesConcept(state, state.profiles.get(p.id)!.tagIds, input.conceptId, input.conceptLabel)).length;
    const own_ = carriesConcept(state, profile.tagIds, input.conceptId, input.conceptLabel);
    signals.conceptInProfile = own_;
    signals.peersCarryingConcept = peersCarrying;
    if (!own_ && peersCarrying * 2 >= peers.length && peersCarrying > 0) weak.push(`CONCEPT_ABSENT: its Qloo profile does not carry ${input.conceptLabel}, while ${peersCarrying} of ${peers.length} peer profiles do`);
  } else if (!hardCode) {
    reasons.push(profile ? `quality unverified: fewer than ${MIN_QUALITY_PEERS} peer profiles to compare with` : "quality unverified: its tag profile has not been fetched");
  }
  reasons.push(...weak);
  const detLevel: ExemplarQualityLevel = hardCode ? "REJECT" : weak.length > 0 ? "WEAK" : "VALID";

  const model = input.semantic?.relevance ?? null;
  let final: ExemplarQualityLevel;
  let rule: string;
  if (detLevel === "REJECT") [final, rule] = ["REJECT", "R1 deterministic hard constraint"];
  else if (model === "MISMATCH") [final, rule] = ["REJECT", "R2 model semantic veto (advisory judgment, removal only)"];
  else if (detLevel === "WEAK" && model === "WEAK") [final, rule] = ["REJECT", "R3 deterministic weak signal + model weak judgment"];
  else if (detLevel === "WEAK") [final, rule] = ["WEAK", "R4 deterministic weak signal"];
  else if (model === "WEAK") [final, rule] = ["WEAK", "R5 model weak judgment"];
  else [final, rule] = ["VALID", "R6 no hard failure, no weak signal"];
  return { deterministic: { level: detLevel, signals, reasons, hardCode }, final, rule };
}
