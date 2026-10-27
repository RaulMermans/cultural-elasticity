/**
 * Sprint 9I: cross-domain cultural relationships, projected deterministically from stored results.
 *
 * Three kinds are kept apart and never upgraded:
 *   DIRECT_QLOO_OBSERVATION   one Qloo call returned the target for a request that named the source
 *   DERIVED_PROFILE_OVERLAP   tags shared by separately observed profiles (computed, not a Qloo edge)
 *   AGENT_INTERPRETATION      validated model wording about the evidence (never evidence)
 *
 * Nothing here ranks, scores or measures distance. Every relationship is `rankable: false`: cross-domain
 * observations explain and suggest research directions; relative ranking stays in one-type, one-call panels.
 */
import type { AgentAnalysisResult, CulturalConnectionMap, CulturalNode, CulturalRelationship } from "./agent.js";
import type { AnyBrandBaselineResult } from "./brand-baseline.js";

export type ConnectionSources = {
  brand: { id: string; name: string };
  evidenceOrigin: "live" | "recorded" | "synthetic";
  baseline?: AnyBrandBaselineResult | null;
  runs?: readonly AgentAnalysisResult[];
  /** Observations kept per domain and source call, in Qloo's order (bounded; not a ranking). */
  maxPerDomain?: number;
};

const DEFAULT_MAX_PER_DOMAIN = 5;

const shortType = (type: string | null | undefined) => (type ? type.replace(/^urn:entity:/u, "") : "entity");

export function projectCulturalConnections(sources: ConnectionSources): CulturalConnectionMap {
  const max = sources.maxPerDomain ?? DEFAULT_MAX_PER_DOMAIN;
  const brand: CulturalNode = { kind: "brand", id: sources.brand.id, label: sources.brand.name, domain: "brand" };
  const relationships: CulturalRelationship[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  const add = (relationship: Omit<CulturalRelationship, "rankable" | "id">) => {
    const id = `${relationship.kind}:${relationship.from.id}:${relationship.to.id}`;
    if (seen.has(id)) return;
    seen.add(id);
    relationships.push({ ...relationship, id, rankable: false });
  };

  // Investigations first: they are what the user is examining. Baseline observations follow, in Qloo order.
  for (const run of sources.runs ?? []) {
    if (!run.brand || run.brand.id !== sources.brand.id) continue;
    const support = new Map((run.layers?.qlooEvidence.exemplars ?? []).map((item) => [`${item.territoryKey}:${item.id}`, item.supportCorrelationId]));
    for (const territory of run.territories) {
      if (!territory.resolvedConcept) continue;
      const concept: CulturalNode = { kind: "tag", id: territory.resolvedConcept.id, label: territory.resolvedConcept.label, domain: "tag" };
      const domain = shortType(territory.representation.entityType);

      for (const exemplar of territory.representation.exemplars.slice(0, max)) {
        const correlationId = support.get(`${territory.key}:${exemplar.id}`);
        if (!correlationId || exemplar.conceptSupport !== "tag_member") continue;
        add({
          kind: "DIRECT_QLOO_OBSERVATION",
          from: concept,
          to: { kind: "entity", id: exemplar.id, label: exemplar.label, domain: shortType(exemplar.type) },
          basis: `Qloo returned this ${shortType(exemplar.type)} as a member of the tag ${concept.label}.`,
          correlationIds: [correlationId],
          limitation: "Membership of a tag is not an affinity to the brand.",
        });
      }

      const conditioned = territory.conditionedEvidence;
      if (conditioned?.correlationId && conditioned.support === "SUPPORTED") {
        for (const entity of conditioned.topEntities.slice(0, max)) {
          add({
            kind: "DIRECT_QLOO_OBSERVATION",
            from: brand,
            // The conditioned view keeps labels and ranks only; this key names the observation, not a Qloo entity id.
            to: { kind: "entity", id: `observation:${conditioned.correlationId}#${entity.rank}`, label: entity.label, domain },
            basis: `Qloo returned this ${domain} for a request about ${sources.brand.name} filtered by the tag ${concept.label}.`,
            correlationIds: [conditioned.correlationId],
            limitation: "A brand-conditioned result is an observed co-occurrence, not a measured affinity, demand or partnership.",
          });
        }
      }

      const coherence = territory.coherence;
      if (coherence && coherence.exemplarsCompared > 0) {
        if (coherence.consistentlyShared.length === 0) {
          notes.push(`No cultural tag is shared by the ${sources.brand.name} profile and the ${territory.label} exemplar profiles (${coherence.exemplarsCompared} compared, venue metadata excluded).`);
        }
        for (const tag of coherence.consistentlyShared.slice(0, max)) {
          add({
            kind: "DERIVED_PROFILE_OVERLAP",
            from: brand,
            to: { kind: "territory", id: territory.key, label: territory.label, domain: "territory" },
            basis: `The tag ${tag.label} appears both in the ${sources.brand.name} profile and in every compared ${territory.label} exemplar profile. Computed from separate Qloo calls; Qloo did not return this as a relationship.`,
            correlationIds: territory.provenance.correlationIds,
            limitation: "Shared tags indicate a common cultural signal, not a distance or a ranking.",
          });
        }
      }
    }
    const targets = run.territories.filter((territory) => territory.role === "target");
    if (run.summary.source === "model" && run.summary.claimValidation.passed) {
      for (const territory of targets) {
        add({
          kind: "AGENT_INTERPRETATION",
          from: brand,
          to: { kind: "territory", id: territory.key, label: territory.label, domain: "territory" },
          basis: run.summary.text,
          correlationIds: territory.provenance.correlationIds,
          limitation: "Model interpretation that passed the claim validator. It is not a Qloo observation.",
        });
      }
    }
  }


  const baseline = sources.baseline;
  if (baseline && baseline.brand.qlooId === sources.brand.id) {
    const perCall = new Map<string, number>();
    const signals = [...baseline.fingerprint.signals].sort((a, b) => a.rankWithinCall - b.rankWithinCall);
    for (const signal of signals) {
      const key = `${signal.domain}:${signal.source.correlationId}`;
      const count = perCall.get(key) ?? 0;
      if (count >= max) continue;
      if (signal.source.sourceStatus === "degraded") continue;
      perCall.set(key, count + 1);
      if (signal.kind === "entity") {
        const scoped = signal.grounding?.typeEvidence !== "PROVIDER_CONFIRMED_TYPE";
        add({
          kind: "DIRECT_QLOO_OBSERVATION",
          from: brand,
          to: { kind: "entity", id: signal.id, label: signal.name, domain: signal.domain },
          basis: `Qloo returned this ${signal.domain} for a ${signal.source.operation} request about ${sources.brand.name} restricted to ${signal.domain}.`,
          correlationIds: [signal.source.correlationId],
          limitation: scoped ? "The entity type comes from the query scope, not a per-entity confirmation. Order is Qloo's, not a strength." : "Order is Qloo's, not a strength.",
        });
      } else {
        add({
          kind: "DIRECT_QLOO_OBSERVATION",
          from: brand,
          to: { kind: "tag", id: signal.id, label: signal.name, domain: "tag" },
          basis: `Qloo returned this tag in the ${signal.source.operation} profile of ${sources.brand.name}.`,
          correlationIds: [signal.source.correlationId],
          limitation: signal.source.sourceStatus === "partial" ? "The source call was partial." : null,
        });
      }
    }
  }

  const domains = [...new Set(relationships.map((item) => item.to.domain))];
  if (!relationships.some((item) => item.kind === "DERIVED_PROFILE_OVERLAP") && !notes.length) notes.push("No derived profile overlap is available in these results.");
  if (!relationships.some((item) => item.kind === "AGENT_INTERPRETATION")) notes.push("No validated model interpretation is attached; only observations and computed overlaps are shown.");
  return { schemaVersion: "ce-cultural-connections/0.1", brand: sources.brand, evidenceOrigin: sources.evidenceOrigin, domains, relationships, notes };
}
