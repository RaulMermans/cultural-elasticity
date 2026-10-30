/**
 * Sprint 12 (direct-evidence/v1): the direct brand × concept observations of one target, read from run state at
 * finalization. Each fact names the Qloo call it came from. Nothing is computed beyond counting what Qloo returned,
 * and a count is never an affinity: the evidence assessment (shared `assessTerritoryEvidence`) reads these facts.
 */
import { nonTautologicalSignals, type AgentTerritoryResult, type DirectEvidenceFacts } from "@cultural-elasticity/shared";
import { canonicalTagName } from "./concept-dedup.js";
import type { AgentRunState, TerritoryState } from "./state.js";

export function directEvidenceFacts(state: AgentRunState, t: TerritoryState, r: AgentTerritoryResult): DirectEvidenceFacts {
  const brand = state.brand.entity;
  const concept = r.resolvedConcept;
  const same = (id: string) => Boolean(concept) && (id === concept!.id || canonicalTagName(id) === canonicalTagName(concept!.id));

  // The brand's own tag profile: this run's profile call first, else the baseline scan observation that grounded it.
  let brandProfile: DirectEvidenceFacts["brandProfile"] = { status: "NOT_OBSERVED", source: null, correlationId: null };
  const profile = brand ? state.profiles.get(brand.id) : undefined;
  if (concept && profile && ["ok", "partial", "degraded"].includes(profile.call.envelope.status)) {
    const hit = profile.tagIds.some(same);
    const correlationId = profile.call.envelope.execution.correlation_id;
    // A partial or degraded profile can show a tag but cannot show its absence.
    if (hit) brandProfile = { status: "CONTAINS_CONCEPT", source: "run_profile", correlationId };
    else if (profile.call.envelope.status === "ok") brandProfile = { status: "ABSENT", source: "run_profile", correlationId };
  }
  if (concept && brand && brandProfile.status !== "CONTAINS_CONCEPT") {
    const scan = state.tags.get(concept.id)?.sources.find((s) => s.kind === "profile" && s.subjectId === brand.id && s.correlationId !== profile?.call.envelope.execution.correlation_id);
    if (scan) brandProfile = { status: "CONTAINS_CONCEPT", source: "baseline_scan", correlationId: scan.correlationId };
  }

  // The brand-conditioned query on the concept tag; the one the result's conditioned evidence cites when there is one.
  const pools = concept && brand ? state.pools.filter((p) => p.conditionedOn === brand.id && p.tagIds.length === 1 && same(p.tagIds[0]!)) : [];
  const cited = r.conditionedEvidence?.correlationId ?? null;
  const pool = pools.find((p) => p.call.envelope.execution.correlation_id === cited) ?? pools.at(-1);
  const failedConditioned = state.trace.toolCalls.some((c) => c.tool === "qloo_recommend" && c.status === "failed" && (c.arguments as { conditionOnBrand?: unknown; tagIds?: unknown })?.conditionOnBrand === true && Array.isArray((c.arguments as { tagIds?: unknown }).tagIds) && ((c.arguments as { tagIds: string[] }).tagIds).some(same));
  let conditionedQuery: DirectEvidenceFacts["conditionedQuery"] = { status: failedConditioned ? "FAILED" : "NOT_RUN", entityCount: 0, correlationId: null };
  if (pool) {
    const status = pool.call.envelope.status;
    const members = new Set(pool.memberIds).size;
    const correlationId = pool.call.envelope.execution.correlation_id;
    conditionedQuery = status === "ok" || status === "empty"
      ? { status: members > 0 ? "RETURNED" : "CLEAN_EMPTY", entityCount: members, correlationId }
      : { status: "UNRELIABLE", entityCount: members, correlationId };
  }

  const searches = state.trace.toolCalls.filter((c) => c.tool === "qloo_find_tags" && c.status !== "rejected" && (c.arguments as { query?: unknown })?.query === t.label);
  const conceptSearch: DirectEvidenceFacts["conceptSearch"] = searches.some((c) => c.status === "ok") ? "FOUND"
    : searches.length > 0 && searches.every((c) => c.status === "empty") ? "CLEAN_EMPTY"
    : searches.some((c) => c.status === "failed") ? "FAILED" : "NOT_RUN";

  const used = new Set(r.representation.exemplars.map((e) => e.id));
  const latest = new Map<string, string>();
  for (const d of state.trace.representationQuality) if (d.territoryKey === t.key && used.has(d.candidateId) && d.modelAssessment) latest.set(d.candidateId, String(d.modelAssessment.relevance).toLowerCase());
  const count = (v: string) => [...latest.values()].filter((x) => x === v).length;
  const { kept, removed } = nonTautologicalSignals(r);
  return {
    version: "direct-evidence/v1",
    brandProfile,
    conditionedQuery,
    conceptSearch,
    exemplarJudgments: { strong: count("strong"), adequate: count("adequate"), weak: count("weak"), mismatch: count("mismatch"), unjudged: used.size - latest.size },
    sharedSignals: kept,
    tautologicalSignals: removed,
  };
}
