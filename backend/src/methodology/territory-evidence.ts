/**
 * Territory evidence assembly: for each exemplar of a territory, build a canonical EvidencePacket
 * (brand profile vs exemplar profile, the panel ranking the exemplar appears in, and the territory's
 * brand-conditioned list) and run it through the Sprint 1 Cultural Evidence Core. The methodology
 * consumes the core's evidence-quality assessment; it does not re-implement it.
 *
 * Tag profiles enter these packets SET-ONLY (values stripped). Tag affinities are saturated [live] and
 * come from separate calls; the methodology never reads them, and stripping them makes that structural.
 */
import type { AnalysisIngredients, TerritoryConditionedEvidence, TerritoryEvidenceQuality } from "@cultural-elasticity/shared";
import { describeConditionedEvidence } from "../analysis/conditioned.js";
import { analyzeEvidencePacket } from "../analysis/ingredients.js";
import { EVIDENCE_PACKET_SCHEMA_VERSION, type ConditionedEntityEvidence, type CulturalProfile, type EvidencePacketInput, type Limitation } from "../evidence/schema.js";
import type { MethodologyInput, TerritoryExemplar, TerritoryRepresentation } from "./contracts.js";

export const TERRITORY_QUALITY_RULE =
  "Worst Cultural Evidence Core overall level across the territory's exemplar packets (LOW < MEDIUM < HIGH). " +
  "A declared exemplar without a tag profile makes its packet MISSING and caps the territory at MEDIUM (incomplete evidence).";

export type ExemplarEvidence = {
  exemplar: TerritoryExemplar;
  profile: CulturalProfile | undefined;
  ingredients: AnalysisIngredients | undefined;
};

export type TerritoryEvidence = {
  territory: TerritoryRepresentation;
  exemplars: ExemplarEvidence[];
  conditioned: ConditionedEntityEvidence | undefined;
  conditionedView: TerritoryConditionedEvidence | null;
  evidenceQuality: TerritoryEvidenceQuality;
  limitations: Limitation[];
};

/** A profile with numeric values removed: membership is all the methodology uses. */
export function setOnly(profile: CulturalProfile): CulturalProfile {
  return { ...profile, signals: profile.signals.map(({ numeric: _numeric, ...signal }) => signal) };
}

const LEVEL_ORDER = ["LOW", "MEDIUM", "HIGH"] as const;

export function assembleTerritoryEvidence(input: MethodologyInput, territory: TerritoryRepresentation): TerritoryEvidence {
  const profiles = new Map(input.exemplarProfiles.map((profile) => [profile.subject.id, profile]));
  const conditioned = territory.concept === undefined ? undefined : input.conditioned.find((c) => c.territory.id === territory.concept!.id);
  const limitations: Limitation[] = [];

  const exemplars = territory.exemplars.map((exemplar): ExemplarEvidence => {
    const profile = profiles.get(exemplar.id);
    if (profile === undefined) {
      limitations.push({ code: "EXEMPLAR_PROFILE_MISSING", detail: `${territory.id}: no tag profile for exemplar ${exemplar.label}; coherence and quality are incomplete` });
      return { exemplar, profile: undefined, ingredients: undefined };
    }
    // The first aggregated panel (by id) that contains this exemplar supplies its ranking context.
    const panel = [...input.panels].filter((p) => p.purpose !== "repeat" && p.ranking !== undefined).sort((a, b) => (a.id < b.id ? -1 : 1)).find((p) => p.assignments.some((a) => a.exemplarId === exemplar.id));
    const packet: EvidencePacketInput = {
      schemaVersion: EVIDENCE_PACKET_SCHEMA_VERSION,
      origin: input.origin,
      brand: setOnly(input.brand),
      target: setOnly(profile),
      ...(panel?.ranking !== undefined && { ranking: { ...panel.ranking, targetCandidateId: exemplar.id } }),
      ...(conditioned !== undefined && { conditionedEntities: [conditioned] }),
      limitations: input.limitations,
      provenance: input.provenance,
    };
    return { exemplar, profile, ingredients: analyzeEvidencePacket(packet) };
  });

  const perExemplar = exemplars.map((e) => ({
    exemplarId: e.exemplar.id,
    level: e.ingredients?.evidenceQuality.overall.level ?? ("MISSING" as const),
    drivers: e.ingredients?.evidenceQuality.overall.drivers ?? ["no tag profile"],
  }));
  const present = perExemplar.filter((p) => p.level !== "MISSING").map((p) => p.level as (typeof LEVEL_ORDER)[number]);
  let level: (typeof LEVEL_ORDER)[number] = present.length === 0 ? "LOW" : LEVEL_ORDER[Math.min(...present.map((l) => LEVEL_ORDER.indexOf(l)))]!;
  const drivers = [...new Set(perExemplar.flatMap((p) => p.drivers))].sort();
  if (perExemplar.some((p) => p.level === "MISSING") && level === "HIGH") level = "MEDIUM";
  if (present.length === 0) drivers.push("no exemplar evidence packet could be built");

  let conditionedView: TerritoryConditionedEvidence | null = null;
  if (conditioned === undefined) {
    limitations.push({ code: "CONDITIONED_NOT_COLLECTED", detail: `${territory.id}: no brand-conditioned territory evidence (reported as absent, never as zero)` });
  } else {
    const view = describeConditionedEvidence(conditioned);
    const declared = new Map(territory.exemplars.map((e) => [e.id, e.label]));
    conditionedView = {
      ...view,
      declaredExemplarsFound: view.scope.verified ? conditioned.entities.filter((e) => declared.has(e.id)).map((e) => ({ id: e.id, label: declared.get(e.id) as string, rank: e.rank })).sort((a, b) => a.rank - b.rank) : [],
    };
  }

  return {
    territory,
    exemplars,
    conditioned,
    conditionedView,
    evidenceQuality: { level, rule: TERRITORY_QUALITY_RULE, perExemplar: perExemplar.sort((a, b) => (a.exemplarId < b.exemplarId ? -1 : 1)), drivers },
    limitations,
  };
}
