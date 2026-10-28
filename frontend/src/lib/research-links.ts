/**
 * Cross-branch links: two cards on different branches of the network that Qloo evidence ties together. A link exists
 * only when both carry the same Qloo identifier (a shared cultural signal, an example entity, or a concept), read
 * from results already on the board. It is set membership, never a similarity score: no affinity is compared across
 * calls, nothing is weighted, and a link is not cultural distance.
 */
import type { AgentRunResponse, AgentTerritoryResult } from "@cultural-elasticity/shared";
import { normName } from "./research-network.ts";

export type EvidenceKind = "taste" | "example" | "concept";
export type EvidenceItem = { id: string; label: string; kind: EvidenceKind };
/** lineage: the card's own id and every id above it, so a card is never tied to its own ancestors or descendants. */
export type LinkSource = { nodeId: string; lineage: readonly string[]; name: string; items: EvidenceItem[] };
export type CrossLink = { a: string; b: string; shared: EvidenceItem[] };

/** The territory a result is about, and the Qloo identifiers it carries. */
export function territoryItems(result: AgentRunResponse | null | undefined, territoryKey: string | null): { name: string; items: EvidenceItem[] } | null {
  if (!result || result.status === "NEEDS_INPUT") return null;
  const territories = (result as Exclude<AgentRunResponse, { status: "NEEDS_INPUT" }>).territories;
  const territory: AgentTerritoryResult | undefined = territoryKey ? territories.find((item) => item.key === territoryKey) : territories.length === 1 ? territories[0] : undefined;
  if (!territory) return null;
  const items: EvidenceItem[] = [
    ...(territory.resolvedConcept ? [{ id: territory.resolvedConcept.id, label: territory.resolvedConcept.label, kind: "concept" as const }] : []),
    ...(territory.coherence?.consistentlyShared ?? []).map((signal) => ({ id: signal.id, label: signal.label, kind: "taste" as const })),
    ...territory.representation.exemplars.map((exemplar) => ({ id: exemplar.id, label: exemplar.label, kind: "example" as const })),
  ].filter((item) => item.id);
  return { name: territory.label, items };
}

const KIND_ORDER: Record<EvidenceKind, number> = { concept: 0, taste: 1, example: 2 };

/**
 * Links between territory cards that share at least one identifier and do not grow from one another. The same
 * territory investigated twice is not a link. Ordered by how many identifiers they share, then by node id, so the result is deterministic.
 */
export function crossLinks(sources: readonly LinkSource[], max = 10): CrossLink[] {
  const links: CrossLink[] = [];
  for (let i = 0; i < sources.length; i += 1) {
    for (let j = i + 1; j < sources.length; j += 1) {
      const a = sources[i]!;
      const b = sources[j]!;
      if (a.lineage.includes(b.nodeId) || b.lineage.includes(a.nodeId) || normName(a.name) === normName(b.name)) continue;
      const theirs = new Set(b.items.map((item) => item.id));
      const shared = [...new Map(a.items.filter((item) => theirs.has(item.id)).map((item) => [item.id, item])).values()]
        .sort((x, y) => KIND_ORDER[x.kind] - KIND_ORDER[y.kind] || x.label.localeCompare(y.label));
      if (shared.length) links.push(a.nodeId < b.nodeId ? { a: a.nodeId, b: b.nodeId, shared } : { a: b.nodeId, b: a.nodeId, shared });
    }
  }
  return links.sort((x, y) => y.shared.length - x.shared.length || x.a.localeCompare(y.a) || x.b.localeCompare(y.b)).slice(0, max);
}

/** Questions that look into what two tied territories share. Templates over the tie's own labels; nothing inferred. */
export function connectionQuestions(brand: string, a: string, b: string, shared: readonly EvidenceItem[]): { question: string; why: string }[] {
  const common = shared.find((item) => item.kind !== "example" && normName(item.label) !== normName(a) && normName(item.label) !== normName(b));
  return [
    { question: `Compare ${a} with ${b} for ${brand}`, why: "Measures both in one Qloo comparison, so you can see which fits better." },
    ...(common ? [{ question: `How far can ${brand} extend into ${common.label}?`, why: `Investigates what they have in common, ${common.label}, as a territory of its own.` }] : []),
    // One investigation per question: an open search between two named territories is a compound request the
    // query gate refuses, so the third proposal is a single comparison that includes their shared ground.
    ...(common ? [{ question: `Compare ${a}, ${b} and ${common.label} for ${brand}`, why: `Ranks both next to what they share, in one Qloo comparison.` }] : []),
  ];
}
