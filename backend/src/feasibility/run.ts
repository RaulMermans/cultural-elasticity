/**
 * Sprint 0 feasibility investigation: Qloo evidence discovery only.
 *
 * Collects evidence and reports what Qloo returned. It computes no Elasticity score. The only
 * derived numbers are descriptive set overlaps on tag lists, labelled as such.
 */
import {
  evidencePacketSchema,
  type BridgeEvidence,
  type CandidateRanking,
  type ConceptRef,
  type CulturalSignal,
  type EvidencePacket,
  type ProvenanceRef,
  type RankedCandidate,
  type ResolvedConcept,
  type TagCandidateSet,
} from "../contracts/qloo.js";
import type { QlooClient, QlooOutcome } from "../qloo/client.js";
import { QlooContractError, QlooWorkflowError } from "../qloo/errors.js";
import { toConceptRefs, type ResolutionIssue } from "../qloo/normalize.js";
import { QLOO_CONTRACT_CHECKSUM } from "../qloo/types.js";
import { DEFAULT_INVESTIGATION, type InvestigationConfig } from "./config.js";

export type StepOutcome = "ok" | "empty" | "needs_input" | "failed" | "skipped";
export type StepRecord = {
  id: string;
  title: string;
  outcome: StepOutcome;
  detail: string;
  degraded?: boolean;
  partial?: boolean;
};
export type GateResult = { id: string; description: string; passed: boolean | null; observed: string };
export type FeasibilityRunResult = {
  status: "COMPLETED" | "BLOCKED";
  steps: StepRecord[];
  gates: GateResult[];
  packet: EvidencePacket | undefined;
};
export type RunOptions = {
  evidenceSource: "live" | "fixture";
  harnessVersion: string;
  now?: () => Date;
};

/** Facts established from the harness contract itself; true regardless of what live data shows. */
export const CONTRACT_LIMITATIONS: readonly string[] = [
  "Qloo exposes no graph-distance, path or topology endpoint (pinned API GET paths: /, /entities, /search, /v2/analysis/compare, /v2/audiences, /v2/audiences/types, /v2/insights, /v2/tags, /v2/tags/types, /v2/trending). No distance value is produced.",
  "Affinity and popularity are query-relative. They are comparable only between signals sharing one sourceCorrelationId (one Qloo call). The rank contract states this explicitly.",
  "Territories such as 'Boutique Hospitality' are not Qloo objects. They are represented by a Qloo tag plus exemplar entities, and both choices shape every downstream result.",
  "compare_audiences and audience_demographics accept or describe entities only, never tags, so a territory enters them only through its exemplars.",
  "compare_audiences, audience_demographics and trends results are not typed by the harness contract. They are stored as opaque, sanitized evidence and not interpreted.",
  "entity_tags returns at most 20 tags per call, so tag-overlap figures describe truncated top-N lists.",
  "Joint entity_tags calls weight every input entity, so a single brand is outnumbered by multiple exemplars. Exemplars are capped, but the call is still not symmetric.",
];

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const isoDate = (date: Date) => date.toISOString().slice(0, 10);

function describeIssues(issues: ResolutionIssue[]): string {
  if (issues.length === 0) return "Qloo requested more input (no candidates supplied).";
  return issues
    .map((issue) => {
      const names = issue.candidates.slice(0, 5).map((c) => `${c.label} [${c.qlooId}]`);
      return `${issue.input}: ${issue.kind}${names.length ? ` — candidates: ${names.join("; ")}` : ""}`;
    })
    .join(" | ");
}

function signalToResolved(signal: CulturalSignal, input: string, provenance: ProvenanceRef): ResolvedConcept {
  return {
    kind: signal.kind,
    input,
    label: signal.label,
    qlooId: signal.qlooId,
    ...(signal.type !== undefined ? { type: signal.type } : {}),
    match: "returned_by_qloo",
    confirmation: "unambiguous",
    alternatives: [],
    provenance: [provenance],
  };
}

function overlap(brandTags: CulturalSignal[], targetTags: CulturalSignal[]) {
  const brandIds = new Set(brandTags.map((t) => t.qlooId));
  const targetIds = new Set(targetTags.map((t) => t.qlooId));
  const shared = [...brandIds].filter((id) => targetIds.has(id));
  const union = new Set([...brandIds, ...targetIds]).size;
  return {
    sharedIds: shared,
    stats: { brandTopN: brandIds.size, targetTopN: targetIds.size, sharedCount: shared.length, jaccard: union === 0 ? null : shared.length / union },
  };
}

export async function runFeasibility(
  client: QlooClient,
  config: InvestigationConfig = DEFAULT_INVESTIGATION,
  options: RunOptions,
): Promise<FeasibilityRunResult> {
  const now = options.now ?? (() => new Date());
  const steps: StepRecord[] = [];
  const allProvenance: ProvenanceRef[] = [];
  const limitations: string[] = [...CONTRACT_LIMITATIONS];

  /** Runs one Qloo call, records its outcome, and returns data only for ok/partial/degraded. */
  async function step<T>(
    id: string,
    title: string,
    call: () => Promise<QlooOutcome<T>>,
    summarize: (data: T) => string,
  ): Promise<{ record: StepRecord; data?: T; provenance?: ProvenanceRef }> {
    let record: StepRecord;
    try {
      const outcome = await call();
      allProvenance.push(outcome.provenance);
      const flags = {
        ...(outcome.provenance.degraded ? { degraded: true } : {}),
        ...(outcome.provenance.partial ? { partial: true } : {}),
      };
      if (outcome.provenance.degraded) limitations.push(`${id}: Qloo marked this result degraded.`);
      if (outcome.provenance.partial) limitations.push(`${id}: Qloo returned partial data (${outcome.provenance.warnings.join("; ") || "no detail"}).`);
      if (outcome.kind === "ok") {
        record = { id, title, outcome: "ok", detail: summarize(outcome.data), ...flags };
        steps.push(record);
        return { record, data: outcome.data, provenance: outcome.provenance };
      }
      record =
        outcome.kind === "empty"
          ? { id, title, outcome: "empty", detail: outcome.summary ?? "No results.", ...flags }
          : { id, title, outcome: "needs_input", detail: describeIssues(outcome.issues), ...flags };
    } catch (error) {
      // Credential and transport failures are unrecoverable for the whole run: let them propagate.
      if (!(error instanceof QlooWorkflowError || error instanceof QlooContractError)) throw error;
      record = { id, title, outcome: "failed", detail: error.message };
    }
    steps.push(record);
    return { record };
  }

  function skip(id: string, title: string, reason: string) {
    steps.push({ id, title, outcome: "skipped", detail: reason });
  }

  // 1. Brand resolution. Without an unambiguous brand there is nothing to investigate.
  const brandStep = await step(
    "brand.resolve",
    `Resolve "${config.brand.query}" as ${config.brand.type}`,
    () => client.describe({ entity: config.brand.query, type: config.brand.type }),
    (d) => `${d.entity.label} [${d.entity.qlooId}] type=${d.entity.type ?? "n/a"} match=${d.entity.match ?? "n/a"}`,
  );
  if (!brandStep.data) {
    return { status: "BLOCKED", steps, gates: evaluateGates(undefined), packet: undefined };
  }
  const brand = brandStep.data.entity;

  // 2. Target representation: tag candidates for every phrasing.
  const tagCandidates: TagCandidateSet[] = [];
  for (const query of config.target.tagQueries) {
    const result = await step(
      `target.tag_candidates.${slug(query)}`,
      `find_tags "${query}"`,
      () => client.findTags({ query, semantic: true, limit: 10 }),
      (tags) => `${tags.length} candidates: ${tags.slice(0, 5).map((t) => `${t.label} [${t.qlooId}]`).join("; ")}`,
    );
    if (result.data && result.provenance) {
      tagCandidates.push({ query, candidates: toConceptRefs(result.data), provenance: result.provenance });
    }
  }

  let selectedTag: ResolvedConcept | undefined;
  const pinned = config.target.pinnedTagId;
  if (pinned) {
    const seen = tagCandidates.find((set) => set.candidates.some((c) => c.qlooId === pinned));
    const ref = seen?.candidates.find((c) => c.qlooId === pinned);
    selectedTag = {
      kind: "tag",
      input: pinned,
      label: ref?.label ?? pinned,
      qlooId: pinned,
      ...(ref?.type !== undefined ? { type: ref.type } : {}),
      confirmation: "pinned",
      alternatives: [],
      provenance: seen ? [seen.provenance] : [],
    };
    if (!seen) limitations.push(`Pinned target tag ${pinned} did not appear in any find_tags candidate list.`);
  } else {
    const first = tagCandidates.find((set) => set.candidates.length > 0);
    const top = first?.candidates[0];
    if (first && top) {
      selectedTag = {
        kind: "tag",
        input: first.query,
        label: top.label,
        qlooId: top.qlooId,
        ...(top.type !== undefined ? { type: top.type } : {}),
        match: "semantic_search_top_candidate",
        confirmation: "auto_selected_unconfirmed",
        alternatives: first.candidates.slice(1, 6),
        provenance: [first.provenance],
      };
      limitations.push(
        `Target tag was auto-selected as the first semantic candidate for "${first.query}" (${top.label} [${top.qlooId}]). It has not been confirmed by a human; pin it in config before relying on downstream results.`,
      );
    } else {
      limitations.push(`No Qloo tag candidates were found for any phrasing of "${config.target.label}".`);
    }
  }

  // 3. Exemplar entities for the territory (not conditioned on the brand, to avoid circularity).
  let exemplars: ResolvedConcept[] = [];
  if (selectedTag) {
    const tagId = selectedTag.qlooId;
    const result = await step(
      "target.exemplars",
      `recommend ${config.target.exemplarType} entities for tag ${tagId}`,
      () =>
        client.recommend({
          target_type: config.target.exemplarType,
          signal_tags: [tagId],
          include_tags: [tagId],
          limit: config.target.exemplarLimit,
          explain: false,
        }),
      (d) => `${d.entities.length} exemplars: ${d.entities.slice(0, 5).map((e) => e.label).join("; ")}`,
    );
    if (result.data && result.provenance) {
      const provenance = result.provenance;
      exemplars = result.data.entities.map((e) => signalToResolved(e, `${config.target.label} exemplar`, provenance));
    }
  } else {
    skip("target.exemplars", "Territory exemplars", "No target tag available.");
  }

  // 4. Brand cultural profile.
  const topN = config.tagTopN;
  const brandTags = await step(
    "brand.tags",
    `entity_tags for ${brand.label}`,
    () => client.entityTags({ entities: [brand.qlooId], limit: topN }),
    (d) => `${d.tags.length} tags (${d.tags.filter((t) => t.affinity !== undefined).length} with affinity)`,
  );
  const brandDemographics = await step(
    "brand.demographics",
    `audience_demographics for ${brand.label}`,
    () => client.audienceDemographics({ entity: brand.qlooId }),
    (d) => `keys=[${d.result.topLevelKeys.join(", ")}] numeric fields=${d.result.numericFieldPaths.length}`,
  );
  const brandRelated = await step(
    "brand.related",
    `recommend brands for ${brand.label}`,
    () => client.recommend({ target_type: "brand", signals: [brand.qlooId], limit: 10 }),
    (d) => `${d.entities.length} brands: ${d.entities.slice(0, 5).map((e) => e.label).join("; ")}`,
  );
  const end = now();
  const start = new Date(end.getTime() - config.momentumWindowDays * 86_400_000);
  const brandMomentum = await step(
    "brand.momentum",
    `trends for ${brand.label} ${isoDate(start)}..${isoDate(end)}`,
    () => client.trends({ entities: [brand.qlooId], entity_type: config.brand.type, start_date: isoDate(start), end_date: isoDate(end) }),
    (d) => `numeric fields=${d.result.numericFieldPaths.length}`,
  );

  // 5. Target cultural profile + brand-conditioned view of the territory.
  const exemplarIds = exemplars.slice(0, 10).map((e) => e.qlooId);
  const targetTags = exemplarIds.length
    ? await step(
        "target.tags",
        `entity_tags jointly for ${exemplarIds.length} exemplars`,
        () => client.entityTags({ entities: exemplarIds, limit: topN }),
        (d) => `${d.tags.length} tags`,
      )
    : (skip("target.tags", "Target tags", "No exemplars."), undefined);

  const targetAffinity = selectedTag
    ? await step(
        "target.affinity_to_brand",
        `recommend ${config.target.exemplarType} entities with signal=${brand.label}, filter=tag`,
        () =>
          client.recommend({
            target_type: config.target.exemplarType,
            signals: [brand.qlooId],
            include_tags: [selectedTag.qlooId],
            limit: config.target.exemplarLimit,
          }),
        (d) => `${d.entities.length} entities: ${d.entities.slice(0, 5).map((e) => `${e.label} (affinity ${e.affinity ?? "n/a"})`).join("; ")}`,
      )
    : (skip("target.affinity_to_brand", "Brand-conditioned territory", "No target tag."), undefined);

  // 6. Audience comparison (entities only).
  const comparison = exemplarIds.length
    ? await step(
        "audience.compare",
        `compare_audiences ${brand.label} vs ${exemplarIds.length} exemplars`,
        () => client.compareAudiences({ group_a: [brand.qlooId], group_b: exemplarIds, limit: 10 }),
        (d) => `keys=[${d.result.topLevelKeys.join(", ")}] numeric fields=${d.result.numericFieldPaths.slice(0, 8).join(", ")}`,
      )
    : (skip("audience.compare", "Audience comparison", "No exemplars."), undefined);

  // 7. Candidate ranking: one call, so affinities are mutually comparable.
  const entries: RankedCandidate[] = [];
  const resolvedOptions: { territory: string; concept: ResolvedConcept }[] = [];
  for (const candidate of config.ranking.candidates) {
    const result = await step(
      `ranking.resolve.${slug(candidate.exemplar)}`,
      `Resolve ranking exemplar "${candidate.exemplar}" (${candidate.territory})`,
      () => client.describe({ entity: candidate.exemplar, type: config.ranking.optionType }),
      (d) => `${d.entity.label} [${d.entity.qlooId}]`,
    );
    if (result.data) resolvedOptions.push({ territory: candidate.territory, concept: result.data.entity });
    else entries.push({ territory: candidate.territory, exemplarInput: candidate.exemplar, unresolvedReason: `${result.record.outcome}: ${result.record.detail}` });
  }
  const rankingProvenance: ProvenanceRef[] = resolvedOptions.flatMap((o) => o.concept.provenance);
  let comparableWithin: string | undefined;
  if (resolvedOptions.length >= 2) {
    const rank = await step(
      "ranking.rank",
      `rank ${resolvedOptions.length} exemplar ${config.ranking.optionType}s for ${brand.label}`,
      () => client.rank({ options: resolvedOptions.map((o) => o.concept.qlooId), option_type: config.ranking.optionType, signals: [brand.qlooId] }),
      (d) => d.ranked.map((r, i) => `${i + 1}. ${r.label} (affinity ${r.affinity ?? "n/a"})`).join("; "),
    );
    if (rank.provenance) rankingProvenance.push(rank.provenance);
    const ranked = rank.data?.ranked ?? [];
    if (rank.data) comparableWithin = rank.provenance?.correlationId;
    for (const option of resolvedOptions) {
      const index = ranked.findIndex((r) => r.qlooId === option.concept.qlooId);
      const hit = ranked[index];
      const exemplarInput = config.ranking.candidates.find((c) => c.territory === option.territory)?.exemplar ?? option.concept.input;
      entries.push({
        territory: option.territory,
        exemplarInput,
        exemplar: option.concept,
        ...(hit
          ? { position: index + 1, ...(hit.affinity !== undefined ? { affinity: hit.affinity } : {}), ...(hit.popularity !== undefined ? { popularity: hit.popularity } : {}) }
          : { unresolvedReason: rank.data ? "Resolved but not returned by rank." : `rank ${rank.record.outcome}: ${rank.record.detail}` }),
      });
    }
  } else {
    skip("ranking.rank", "Candidate ranking", `Only ${resolvedOptions.length} exemplar(s) resolved; ranking needs at least 2.`);
    for (const option of resolvedOptions) {
      entries.push({ territory: option.territory, exemplarInput: option.concept.input, exemplar: option.concept, unresolvedReason: "Ranking not run." });
    }
  }
  const order = config.ranking.candidates.map((c) => c.territory);
  entries.sort((a, b) => order.indexOf(a.territory) - order.indexOf(b.territory));
  const rankings: CandidateRanking[] = [
    {
      signal: brand,
      optionType: config.ranking.optionType,
      entries,
      ...(comparableWithin ? { comparableWithinCorrelationId: comparableWithin } : {}),
      assumptions: [
        `Each territory is represented by one human-chosen exemplar ${config.ranking.optionType}; the ranking reflects the exemplar, not the territory.`,
        "All options are ranked in a single call with the brand as the only signal, so affinities are comparable only within this call.",
        "Exemplars that did not resolve unambiguously are excluded rather than guessed.",
      ],
      provenance: rankingProvenance,
    },
  ];

  // 8. Bridge evidence: shared and jointly characterizing tags. No path semantics are claimed.
  const bridgeEvidence: BridgeEvidence[] = [];
  for (const bridge of config.bridges) {
    const id = `bridge.${slug(bridge.label)}`;
    let toExemplars: ResolvedConcept[] = [];
    if (bridge.exemplars === "target") {
      toExemplars = exemplars;
    } else {
      const spec = bridge.exemplars;
      for (const name of spec.names) {
        const known = resolvedOptions.find((o) => o.concept.input.toLowerCase() === name.toLowerCase());
        if (known) {
          toExemplars.push(known.concept);
          continue;
        }
        const result = await step(`${id}.resolve.${slug(name)}`, `Resolve bridge exemplar "${name}"`, () => client.describe({ entity: name, type: spec.type }), (d) => `${d.entity.label} [${d.entity.qlooId}]`);
        if (result.data) toExemplars.push(result.data.entity);
      }
    }
    if (toExemplars.length === 0 || !brandTags.data) {
      skip(id, `Bridge ${brand.label} → ${bridge.label}`, toExemplars.length === 0 ? "No exemplars resolved." : "Brand tags unavailable.");
      continue;
    }
    const toIds = toExemplars.slice(0, 10).map((e) => e.qlooId);
    const toTags =
      bridge.exemplars === "target" && targetTags?.data
        ? targetTags
        : await step(`${id}.target_tags`, `entity_tags for ${bridge.label} exemplars`, () => client.entityTags({ entities: toIds, limit: topN }), (d) => `${d.tags.length} tags`);
    const jointIds = [brand.qlooId, ...toIds.slice(0, config.jointTagExemplarCap)];
    const joint = await step(
      `${id}.joint_tags`,
      `entity_tags jointly for ${brand.label} + ${jointIds.length - 1} ${bridge.label} exemplar(s)`,
      () => client.entityTags({ entities: jointIds, limit: topN }),
      (d) => `${d.tags.length} joint tags: ${d.tags.slice(0, 6).map((t) => t.label).join("; ")}`,
    );
    if (!toTags.data || !joint.data) continue;
    const { sharedIds, stats } = overlap(brandTags.data.tags, toTags.data.tags);
    const sharedTags: ConceptRef[] = toConceptRefs(brandTags.data.tags.filter((t) => sharedIds.includes(t.qlooId)));
    bridgeEvidence.push({
      semantics: "qloo_supported_intermediate_cultural_signals",
      from: brand,
      toLabel: bridge.label,
      toExemplars,
      sharedTags,
      jointTags: joint.data.tags,
      overlap: stats,
      provenance: [brandTags.provenance, toTags.provenance, joint.provenance].filter((p): p is ProvenanceRef => p !== undefined),
    });
  }

  // 9. Assemble and validate the packet at the boundary.
  const packet = evidencePacketSchema.parse({
    schemaVersion: "0.1",
    generatedAt: now().toISOString(),
    evidenceSource: options.evidenceSource,
    harness: { version: options.harnessVersion, contractChecksum: QLOO_CONTRACT_CHECKSUM },
    brand: {
      subjects: [brand],
      tags: brandTags.data?.tags ?? [],
      ...(brandRelated.data ? { relatedEntities: brandRelated.data.entities } : {}),
      ...(brandDemographics.data ? { demographics: brandDemographics.data.result } : {}),
      ...(brandMomentum.data ? { momentum: brandMomentum.data.result } : {}),
      provenance: [brandStep.provenance, brandTags.provenance, brandRelated.provenance, brandDemographics.provenance, brandMomentum.provenance].filter(
        (p): p is ProvenanceRef => p !== undefined,
      ),
    },
    target: {
      representation: {
        label: config.target.label,
        tagCandidates,
        ...(selectedTag ? { selectedTag } : {}),
        exemplars,
        exemplarMethod: `Top ${config.target.exemplarLimit} ${config.target.exemplarType} entities from recommend with the selected tag as both signal and filter. Not conditioned on the brand.`,
      },
      ...(exemplars.length && targetTags?.data
        ? { profile: { subjects: exemplars, tags: targetTags.data.tags, provenance: [targetTags.provenance].filter((p): p is ProvenanceRef => p !== undefined) } }
        : {}),
    },
    ...(selectedTag && targetAffinity?.data && targetAffinity.provenance
      ? { targetAffinityToBrand: { signal: brand, filterTag: selectedTag, entities: targetAffinity.data.entities, provenance: [targetAffinity.provenance] } }
      : {}),
    ...(comparison?.data ? { audienceComparison: { groupA: [brand], groupB: exemplars.slice(0, 10), result: comparison.data.result } } : {}),
    rankings,
    bridgeEvidence,
    limitations,
    provenance: allProvenance,
  } satisfies EvidencePacket);

  return { status: "COMPLETED", steps, gates: evaluateGates(packet), packet };
}

/**
 * Feasibility gates. They describe whether Qloo returned the evidence each dimension needs.
 * They are not quality scores and they do not decide GO/NO-GO on their own.
 */
export function evaluateGates(packet: EvidencePacket | undefined): GateResult[] {
  const brand = packet?.brand.subjects[0];
  const representation = packet?.target.representation;
  const tagsWithAffinity = packet?.brand.tags.filter((t) => t.affinity !== undefined).length ?? 0;
  const numericCompare = packet?.audienceComparison?.result.numericFieldPaths ?? [];
  const ranking = packet?.rankings?.[0];
  const rankedWithAffinity = ranking?.entries.filter((e) => e.affinity !== undefined).length ?? 0;
  const hospitalityBridge = packet?.bridgeEvidence?.find((b) => b.toLabel === representation?.label);

  return [
    {
      id: "G1",
      description: "Brand resolves unambiguously to a brand entity",
      passed: packet ? brand?.confirmation === "unambiguous" && (brand.type ?? "").includes("brand") : false,
      observed: brand ? `${brand.label} [${brand.qlooId}] type=${brand.type ?? "n/a"}` : "not resolved",
    },
    {
      id: "G2",
      description: "Target territory has a Qloo tag and ≥5 exemplar entities",
      passed: packet ? Boolean(representation?.selectedTag) && (representation?.exemplars.length ?? 0) >= 5 : null,
      observed: representation
        ? `tag=${representation.selectedTag ? `${representation.selectedTag.label} (${representation.selectedTag.confirmation})` : "none"}; exemplars=${representation.exemplars.length}`
        : "n/a",
    },
    {
      id: "G3",
      description: "Brand has ≥10 Qloo tags with numeric affinity",
      passed: packet ? tagsWithAffinity >= 10 : null,
      observed: `${tagsWithAffinity} tags with affinity`,
    },
    {
      id: "G4",
      description: "compare_audiences returns at least one numeric field",
      passed: packet ? numericCompare.length > 0 : null,
      observed: packet?.audienceComparison ? `numeric fields: ${numericCompare.slice(0, 6).join(", ") || "none"}` : "not returned",
    },
    {
      id: "G5",
      description: "Single-call rank returns affinity for ≥4 territory exemplars",
      passed: packet ? rankedWithAffinity >= 4 : null,
      observed: `${rankedWithAffinity} of ${ranking?.entries.length ?? 0} with affinity`,
    },
    {
      id: "G6",
      description: "Brand + territory joint tags are non-empty",
      passed: packet ? (hospitalityBridge?.jointTags.length ?? 0) > 0 : null,
      observed: hospitalityBridge ? `${hospitalityBridge.jointTags.length} joint, ${hospitalityBridge.overlap.sharedCount} shared` : "not computed",
    },
  ];
}
