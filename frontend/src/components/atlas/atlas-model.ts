// Presentation of a validated query response. Positions and tones are not measurements.
// Spacing never encodes affinity, distance, confidence, or a recommendation.

import type { InvestigationOperation, QueryResponse, QueryTerritoryNode, TerritoryEvidenceStatus } from "@cultural-elasticity/shared";

export const ATLAS_COLUMN = 248;
export const ATLAS_ROW = 120;

export type AtlasTone = "idle" | "running" | "supported" | "partial" | "unsupported" | "hypothesis" | "interrupted" | "failed" | "incomplete";

export type AtlasDraft = {
  id: string;
  parentId: string | null;
  queryId: string;
  runId: string | null;
  territoryKey: string | null;
  kind: "brand" | "territory";
  label: string;
  statusLabel: string;
  detail: string;
  tone: AtlasTone;
  fromOperation: InvestigationOperation | null;
  mismatchedBrand: boolean;
  recorded: boolean;
};

const norm = (value: string | null | undefined) => (value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();

/** Decorative only. The same id always yields the same silhouette; the silhouette is not evidence. */
export function decorativeRadii(seed: string): string {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const part = (shift: number, min: number, span: number) => min + ((hash >>> shift) % span);
  return `${part(0, 46, 16)}% ${part(5, 54, 14)}% ${part(9, 42, 16)}% ${part(13, 50, 12)}% / ${part(3, 48, 14)}% ${part(7, 52, 12)}% ${part(11, 44, 14)}% ${part(1, 56, 10)}%`;
}

export function buildAtlas(responses: readonly QueryResponse[]): AtlasDraft[] {
  const nodes: AtlasDraft[] = [];
  const brandByRun = new Map<string, string>();
  const territoryByRunKey = new Map<string, string>();
  const index = new Map<string, AtlasDraft>();
  const represented = new Set<string>();

  const place = (node: AtlasDraft) => {
    if (index.has(node.id)) return;
    index.set(node.id, node);
    nodes.push(node);
    if (node.kind === "brand" && node.runId) brandByRun.set(node.runId, node.id);
    if (node.kind === "territory" && node.runId && node.territoryKey) territoryByRunKey.set(`${node.runId}:${node.territoryKey}`, node.id);
  };

  for (const response of responses) {
    const runId = response.investigation?.runId ?? null;
    if (response.investigation?.reused && runId && represented.has(runId)) continue;
    const link = response.investigation?.link ?? null;
    const operation = link?.operation ?? response.handoff?.operation ?? null;
    const parentRunId = link?.parentRunId ?? null;
    const mismatchedBrand = response.interpretation?.interpretationWarnings.some((warning) => warning.startsWith("INHERITED_BRAND_MISMATCH")) ?? false;
    const anchor = parentRunId && !mismatchedBrand ? anchorFor(parentRunId, operation, link?.selectedTerritoryKey ?? null, brandByRun, territoryByRunKey, nodes) : null;
    const rooted = !parentRunId || mismatchedBrand || operation === "NEW_INVESTIGATION" || operation === "CHANGE_BRAND" || !anchor;
    const brandId = `brand:${response.queryId}`;
    if (rooted) {
      place({
        id: brandId,
        parentId: operation === "CHANGE_BRAND" && !mismatchedBrand ? anchor : null,
        queryId: response.queryId,
        runId,
        territoryKey: null,
        kind: "brand",
        label: brandLabel(response),
        ...runCopy(response),
        fromOperation: operation === "CHANGE_BRAND" ? "CHANGE_BRAND" : null,
        mismatchedBrand,
        recorded: isRecorded(response),
      });
    }
    response.territories.forEach((territory, territoryIndex) => {
      const copy = territoryCopy(response, territory);
      place({
        id: runId && territory.territoryKey ? `territory:${runId}:${territory.territoryKey}` : `territory:${response.queryId}:${territoryIndex}:${norm(territory.name)}`,
        parentId: rooted ? brandId : anchor,
        queryId: response.queryId,
        runId,
        territoryKey: territory.territoryKey,
        kind: "territory",
        label: territory.name,
        statusLabel: copy.statusLabel,
        detail: copy.detail,
        tone: copy.tone,
        fromOperation: rooted ? null : operation,
        mismatchedBrand: false,
        recorded: isRecorded(response),
      });
    });
    if (runId) represented.add(runId);
  }
  return nodes;
}

export function layoutAtlas(nodes: readonly { id: string; parentId: string | null }[], previous: ReadonlyMap<string, { x: number; y: number }>): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const live = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    const prior = previous.get(node.id);
    if (prior) positions.set(node.id, { ...prior });
  }
  const byParent = new Map<string | null, string[]>();
  for (const node of nodes) {
    const list = byParent.get(node.parentId) ?? [];
    list.push(node.id);
    byParent.set(node.parentId, list);
  }
  const pending = nodes.filter((node) => !positions.has(node.id));
  let guard = pending.length * Math.max(pending.length, 1) + 2;
  while (pending.length > 0 && guard > 0) {
    guard -= 1;
    const next = pending[0]!;
    if (next.parentId && !positions.has(next.parentId) && live.has(next.parentId)) {
      pending.push(pending.shift()!);
      continue;
    }
    pending.shift();
    const parent = next.parentId ? positions.get(next.parentId) : undefined;
    const depth = depthOf(next.id, nodes, new Set());
    const x = 48 + depth * ATLAS_COLUMN;
    const placedSiblings = (byParent.get(next.parentId) ?? []).filter((id) => positions.has(id));
    let y = parent ? parent.y : 48;
    if (placedSiblings.length > 0) y = Math.max(...placedSiblings.map((id) => positions.get(id)!.y)) + ATLAS_ROW;
    while ([...positions.entries()].some(([id, point]) => live.has(id) && Math.abs(point.x - x) < 8 && Math.abs(point.y - y) < ATLAS_ROW - 12)) y += ATLAS_ROW;
    positions.set(next.id, { x, y });
  }
  return positions;
}

export function edgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const startX = from.x + 168;
  const startY = from.y + 36;
  const endX = to.x;
  const endY = to.y + 36;
  const bend = Math.max(36, (endX - startX) / 2);
  return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
}

type ObservedLayer = {
  concepts: { territoryKey: string; label: string; correlationIds: string[] }[];
  exemplars: { territoryKey: string; label: string }[];
};

function isObservedLayer(layer: unknown): layer is ObservedLayer {
  if (!layer || typeof layer !== "object") return false;
  const record = layer as Record<string, unknown>;
  return Array.isArray(record.concepts) && Array.isArray(record.exemplars);
}

function observedLayerOf(layers: object): ObservedLayer | null {
  for (const layer of Object.values(layers)) {
    if (isObservedLayer(layer)) return layer;
  }
  return null;
}

export type EvidenceSections = {
  observed: string[];
  calculated: string[];
  interpreted: string[];
  unavailable: string[];
  /** Investigation-wide notes. Never presented as support for one territory. */
  aggregate: string[];
  provenance: string[];
  synthetic: boolean;
  recorded: boolean;
  caution: string;
  scopeLabel: string;
  territorySpecific: boolean;
};

export type EvidenceScope = { territoryKey: string | null; territoryName: string | null; runId: string | null };

const TERRITORY_EVIDENCE_UNAVAILABLE = "Territory-specific evidence is unavailable.";

export function isRecorded(response: QueryResponse | null | undefined): boolean {
  return response?.interpretation?.interpretationWarnings.includes("RECORDED_EXAMPLE") ?? false;
}

export function evidenceSections(response: QueryResponse, scope: EvidenceScope): EvidenceSections {
  const result = response.investigation?.result;
  const analysis = result && result.status !== "NEEDS_INPUT" ? result : null;
  const recorded = isRecorded(response);
  const base = {
    synthetic: analysis?.evidenceOrigin === "synthetic",
    recorded,
    caution: recorded
      ? "This is a recorded example of an earlier investigation. It is not a new live result, and it is not a prediction of commercial success."
      : "Supported evidence is not a prediction of commercial success.",
  };
  const empty = (scopeLabel: string, observed: string[], aggregate: string[] = []): EvidenceSections => ({
    observed,
    calculated: [],
    interpreted: [],
    unavailable: observed,
    aggregate,
    provenance: [],
    territorySpecific: false,
    scopeLabel,
    ...base,
  });
  if (!analysis) return empty("This investigation has no evidence record.", ["No evidence record is available for this investigation."]);
  if (scope.runId && response.investigation?.runId && scope.runId !== response.investigation.runId) {
    return empty(TERRITORY_EVIDENCE_UNAVAILABLE, [TERRITORY_EVIDENCE_UNAVAILABLE], analysis.limitations.map((limitation) => limitation.detail));
  }
  const askedForTerritory = Boolean(scope.territoryKey || scope.territoryName);
  const matches = analysis.territories.filter((item) => {
    if (scope.territoryKey) return item.key === scope.territoryKey;
    return scope.territoryName ? norm(item.label) === norm(scope.territoryName) : false;
  });
  if (askedForTerritory && matches.length !== 1) {
    return empty(TERRITORY_EVIDENCE_UNAVAILABLE, [TERRITORY_EVIDENCE_UNAVAILABLE], analysis.limitations.map((limitation) => limitation.detail));
  }
  const territory = matches[0] ?? null;
  const observed: string[] = [];
  const calculated: string[] = [];
  const interpreted: string[] = [];
  const unavailable: string[] = [];
  const provenance: string[] = [];
  const observedLayer = analysis.layers ? observedLayerOf(analysis.layers) : null;
  const concepts = (observedLayer?.concepts ?? []).filter((concept) => (territory ? concept.territoryKey === territory.key : true));
  const exemplars = (observedLayer?.exemplars ?? []).filter((exemplar) => (territory ? exemplar.territoryKey === territory.key : true));
  if (concepts.length > 0) observed.push(`Concepts observed: ${concepts.map((concept) => concept.label).join(", ")}.`);
  if (exemplars.length > 0) observed.push(`Examples connected: ${exemplars.slice(0, 6).map((exemplar) => exemplar.label).join(", ")}.`);
  for (const concept of concepts) provenance.push(...concept.correlationIds);
  if (analysis.layers) {
    const route = analysis.layers.systemAnalysis.routes.find((item) => (territory ? item.territoryKey === territory.key : false));
    if (!territory && analysis.layers.systemAnalysis.routes.length > 0) {
      calculated.push("Routes were calculated for the investigation. Open a territory to see its own route.");
    }
    if (route) calculated.push(`Analysis route: ${routeLabel(route.route)}.`);
    if (route?.classification) calculated.push(`Provisional class: ${route.classification}. This is not a recommendation.`);
    if (route?.robustness) calculated.push(`Representation robustness: ${route.robustness}.`);
    if (typeof route?.position === "number") calculated.push(`Position ${route.position} is only within this comparison, not an absolute score.`);
  }
  if (territory) {
    for (const line of territory.keyEvidence) calculated.push(line);
    for (const limitation of territory.limitations) unavailable.push(limitation.detail);
    provenance.push(...(territory.provenance?.correlationIds ?? []));
  } else if (analysis.summary.text) interpreted.push(analysis.summary.text);
  if (analysis.summary.text && territory) {
    interpreted.push("The investigation summary covers every territory in this run. It is not a separate finding for this one.");
  } else if (analysis) {
    interpreted.push(analysis.summary.source === "model" ? "This wording was written by the agent and checked against the calculated result." : "This wording was written from the calculated result.");
  }
  if (observed.length === 0) observed.push(territory ? "No separate record of observed cultural evidence was included for this territory." : "No separate record of observed cultural evidence was included.");
  if (calculated.length === 0) calculated.push("No calculated finding was recorded.");
  if (interpreted.length === 0) interpreted.push("No interpretation was recorded.");
  const uniqueUnavailable = [...new Set(unavailable)];
  if (uniqueUnavailable.length === 0) uniqueUnavailable.push("No further limitation was recorded.");
  const whole = [...(territory && analysis.summary.text ? [analysis.summary.text] : []), ...analysis.limitations.map((limitation) => limitation.detail)].filter((line) => !uniqueUnavailable.includes(line));
  return {
    observed,
    calculated,
    interpreted,
    unavailable: uniqueUnavailable,
    aggregate: territory ? whole : analysis.limitations.map((limitation) => limitation.detail),
    provenance: [...new Set(provenance.filter(Boolean))],
    territorySpecific: Boolean(territory),
    scopeLabel: territory ? `Evidence for ${territory.label}.` : "These observations are for the whole investigation, not one territory.",
    ...base,
  };
}

export function reasonCopy(code: string, capability: string | null): string {
  if (code === "SYSTEM_DIRECTIVE_REFUSED" || code === "DIRECTIVE_BLOCKS_CONFIRMATION" || capability === "SYSTEM_DIRECTIVE") {
    return "That message included an instruction to the system. Those instructions are not followed.";
  }
  if (capability === "compare_brands" || code === "UNSUPPORTED_OPERATION" && capability === "compare_brands") {
    return "Comparing two brands is recognized, and it is not available yet. A territory comparison is a different question.";
  }
  const named: Record<string, string> = {
    compare_brands: "Comparing two brands is recognized, and it is not available yet.",
    competitor_whitespace: "Looking for space a competitor leaves open is recognized, and it is not available yet.",
    bridge_builder: "Finding a bridge between territories is recognized, and it is not available yet.",
    multi_brand_portfolio_analysis: "A portfolio across several brands is recognized, and it is not available yet.",
    out_of_scope: "This question sits outside cultural expansion.",
    BRAND_MISSING: "Which brand should the investigation follow?",
    BRAND_AMBIGUOUS: "More than one brand was named. The investigation follows one brand at a time.",
    PARENT_NOT_FOUND: "The earlier investigation is no longer available. You can start a new one.",
    QUERY_NOT_FOUND: "That confirmation has expired. You can ask the question again.",
    CONTEXT_UNAVAILABLE: "The earlier investigation is no longer available.",
    ANCESTOR_UNAVAILABLE: "That earlier step is no longer held.",
    CROSS_RUN_BRAND: "These territories come from different brands. Their earlier results are not one comparison.",
    REFINEMENT_NOT_A_CONCEPT: "That asks to look closer without naming a cultural concept.",
    CLARIFICATION_REQUIRED: "One detail is still missing.",
    LOW_CONFIDENCE: "The question needs to be a little more specific.",
    COMPOUND_NOT_EXECUTED: "Only one investigation can run from a single question.",
    UNSUPPORTED_SECONDARY_OBJECTIVE: "Part of the question is recognized and not available yet.",
    INHERITED_BRAND_MISMATCH: "The follow-up resolved a different brand, so it is shown on its own.",
  };
  return named[capability ?? ""] ?? named[code] ?? "This investigation could not continue in the way the question asked.";
}

function brandLabel(response: QueryResponse): string {
  const result = response.investigation?.result;
  if (result && result.status !== "NEEDS_INPUT" && result.brand) return result.brand.label;
  return response.interpretation?.brand.name ?? "This investigation";
}

function runCopy(response: QueryResponse): { statusLabel: string; detail: string; tone: AtlasTone } {
  if (response.reasons.some((reason) => reason.code === "INVESTIGATION_CANCELLED")) {
    return { tone: "interrupted", statusLabel: "Interrupted", detail: "Stopped before the investigation finished." };
  }
  switch (response.state) {
    case "INVESTIGATION_STARTED":
      return { tone: "running", statusLabel: "Investigating", detail: "The investigation is still gathering evidence." };
    case "INVESTIGATION_COMPLETED":
      return { tone: "idle", statusLabel: "Investigated", detail: "Open a territory to see what the evidence supports." };
    case "INVESTIGATION_INCOMPLETE":
      return { tone: "incomplete", statusLabel: "Incomplete", detail: "Stopped before enough evidence was collected." };
    case "INVESTIGATION_FAILED":
      return { tone: "failed", statusLabel: "Could not finish", detail: "The investigation ended before a finding." };
    case "INVESTIGATION_NEEDS_INPUT":
      return { tone: "running", statusLabel: "A question is waiting", detail: "The investigation needs one answer before it can continue." };
    default:
      return { tone: "idle", statusLabel: "Not yet investigated", detail: "Named, and not yet sent for investigation." };
  }
}

function territoryCopy(response: QueryResponse, territory: QueryTerritoryNode): { statusLabel: string; detail: string; tone: AtlasTone } {
  if (response.reasons.some((reason) => reason.code === "INVESTIGATION_CANCELLED") || response.state === "INVESTIGATION_FAILED") {
    return { tone: "interrupted", statusLabel: "Interrupted", detail: "Stopped before this could become a finding." };
  }
  if (response.state === "INVESTIGATION_INCOMPLETE" && territory.investigationState !== "INVESTIGATED") {
    return { tone: "incomplete", statusLabel: "Incomplete", detail: "The investigation stopped before enough evidence was collected." };
  }
  if (response.state === "INVESTIGATION_STARTED" || territory.investigationState === "NOT_INVESTIGATED") {
    if (response.state === "INVESTIGATION_STARTED") return { tone: "running", statusLabel: "Investigating", detail: "Not yet a finding." };
    return { tone: "idle", statusLabel: "Not yet investigated", detail: "Named, and not yet sent for investigation." };
  }
  return evidenceCopy(territory.evidenceStatus);
}

function evidenceCopy(status: TerritoryEvidenceStatus | null): { statusLabel: string; detail: string; tone: AtlasTone } {
  switch (status) {
    case "EVIDENCE_SUPPORTED_TERRITORY":
      return { tone: "supported", statusLabel: "Evidence supports a comparison", detail: "A comparison could be made from the evidence. This is not a recommendation." };
    case "PARTIAL_EVIDENCE":
      return { tone: "partial", statusLabel: "Partial evidence", detail: "Some evidence is available, and the picture is not complete." };
    case "UNSUPPORTED":
      return { tone: "unsupported", statusLabel: "No usable evidence", detail: "The investigation ran, and no usable evidence was found." };
    case "HYPOTHESIS_PENDING_VALIDATION":
      return { tone: "hypothesis", statusLabel: "Hypothesis", detail: "Proposed, and not yet validated." };
    default:
      return { tone: "idle", statusLabel: "Investigated", detail: "The investigation finished without a separate evidence mark." };
  }
}

function routeLabel(route: string): string {
  switch (route) {
    case "FULL_RELATIVE_ANALYSIS":
      return "a full comparison within one set";
    case "PARTIAL_CULTURAL_ANALYSIS":
      return "a partial cultural reading";
    case "DESCRIPTIVE_ANALYSIS":
      return "a descriptive reading";
    case "INSUFFICIENT_EVIDENCE":
      return "not enough evidence";
    default:
      return route;
  }
}

function anchorFor(
  parentRunId: string,
  operation: InvestigationOperation | null,
  selectedTerritoryKey: string | null,
  brandByRun: Map<string, string>,
  territoryByRunKey: Map<string, string>,
  nodes: readonly AtlasDraft[],
): string | null {
  const territory = selectedTerritoryKey ? territoryByRunKey.get(`${parentRunId}:${selectedTerritoryKey}`) ?? null : null;
  const brand = brandByRun.get(parentRunId) ?? null;
  if (operation === "SWITCH_TERRITORY" || operation === "CHANGE_BRAND") {
    if (brand) return brand;
    const sibling = nodes.find((node) => node.runId === parentRunId);
    return sibling?.parentId ?? territory;
  }
  return territory ?? brand ?? nodes.find((node) => node.runId === parentRunId)?.id ?? null;
}

function depthOf(id: string, nodes: readonly { id: string; parentId: string | null }[], seen: Set<string>): number {
  if (seen.has(id)) return 0;
  seen.add(id);
  const node = nodes.find((item) => item.id === id);
  if (!node?.parentId) return 0;
  return depthOf(node.parentId, nodes, seen) + 1;
}
