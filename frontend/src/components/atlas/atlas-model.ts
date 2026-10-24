// Presentation of a validated query response. Positions and tones are not measurements.
// Spacing never encodes affinity, distance, confidence, or a recommendation.

import type { InvestigationOperation, QueryResponse, QueryTerritoryNode, TerritoryEvidenceStatus } from "@cultural-elasticity/shared";

export const PANEL_WIDTH = 216;
export const PANEL_MIN_HEIGHT = 76;
export const COLUMN_GAP = 48;
export const ROW_GAP = 24;
export const TREE_GAP = 48;
export const ATLAS_MARGIN = 28;
/** @deprecated Use COLUMN_GAP. Kept so older layout notes still resolve. */
export const ATLAS_COLUMN = PANEL_WIDTH + COLUMN_GAP;
/** @deprecated Use measured node heights. */
export const ATLAS_ROW = PANEL_MIN_HEIGHT + ROW_GAP;

export type AtlasTone = "idle" | "running" | "supported" | "partial" | "unsupported" | "hypothesis" | "interrupted" | "failed" | "incomplete";
export type Point = { x: number; y: number };
export type AtlasBox = Point & { width: number; height: number };
export type LayoutNode = { id: string; parentId: string | null; label?: string; kind?: "brand" | "territory" };

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

export function nodeSize(node: LayoutNode): { width: number; height: number } {
  const width = node.kind === "brand" ? 188 : PANEL_WIDTH;
  const title = (node.label ?? "Territory").trim();
  const charsPerLine = node.kind === "brand" ? 16 : 20;
  const words = title.split(/\s+/u);
  const wrappedLines = Math.max(
    1,
    words.reduce((lines, word) => {
      const current = lines[lines.length - 1] ?? "";
      if (!current) return [word];
      if (`${current} ${word}`.length <= charsPerLine) {
        lines[lines.length - 1] = `${current} ${word}`;
        return lines;
      }
      return [...lines, word];
    }, [] as string[]).length,
  );
  const height = Math.max(PANEL_MIN_HEIGHT, 16 + wrappedLines * 24 + 8 + 20 + 16);
  return { width, height };
}

export function boxOf(node: LayoutNode, point: Point): AtlasBox {
  return { ...point, ...nodeSize(node) };
}

export function boxesOverlap(a: AtlasBox, b: AtlasBox, gap = 12): boolean {
  return !(a.x + a.width + gap <= b.x || b.x + b.width + gap <= a.x || a.y + a.height + gap <= b.y || b.y + b.height + gap <= a.y);
}

export function overlappingPairs(boxes: readonly AtlasBox[]): [number, number][] {
  const pairs: [number, number][] = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (boxesOverlap(boxes[i]!, boxes[j]!, 8)) pairs.push([i, j]);
    }
  }
  return pairs;
}

export function shortStatus(tone: AtlasTone, statusLabel: string): string {
  switch (tone) {
    case "supported":
      return "Supported";
    case "partial":
      return "Partial";
    case "unsupported":
      return "No evidence";
    case "hypothesis":
      return "Hypothesis";
    case "incomplete":
      return "Incomplete";
    case "interrupted":
      return "Interrupted";
    case "failed":
      return "Could not finish";
    case "running":
      return "Investigating";
    default:
      return statusLabel;
  }
}

export function neighborId(nodes: readonly LayoutNode[], selectedId: string, direction: "parent" | "child" | "previous" | "next"): string | null {
  const selected = nodes.find((node) => node.id === selectedId);
  if (!selected) return null;
  if (direction === "parent") return selected.parentId;
  const siblings = nodes.filter((node) => node.parentId === selected.parentId);
  const index = siblings.findIndex((node) => node.id === selectedId);
  if (direction === "previous") return index > 0 ? siblings[index - 1]!.id : null;
  if (direction === "next") return index >= 0 && index < siblings.length - 1 ? siblings[index + 1]!.id : null;
  const child = nodes.find((node) => node.parentId === selectedId);
  return child?.id ?? null;
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

export function layoutAtlas(nodes: readonly LayoutNode[], previous: ReadonlyMap<string, Point>): Map<string, Point> {
  const positions = new Map<string, Point>();
  const live = new Set(nodes.map((node) => node.id));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string | null, string[]>();
  for (const node of nodes) {
    const list = children.get(node.parentId) ?? [];
    list.push(node.id);
    children.set(node.parentId, list);
  }
  for (const node of nodes) {
    const prior = previous.get(node.id);
    if (prior) positions.set(node.id, { ...prior });
  }

  const subtreeHeight = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return nodeSize(byId.get(id) ?? { id, parentId: null }).height;
    seen.add(id);
    const size = nodeSize(byId.get(id) ?? { id, parentId: null });
    const kids = (children.get(id) ?? []).filter((kid) => live.has(kid));
    if (kids.length === 0) return size.height;
    return Math.max(size.height, kids.reduce((sum, kid, index) => sum + subtreeHeight(kid, seen) + (index > 0 ? ROW_GAP : 0), 0));
  };

  const placeSubtree = (id: string, x: number, y: number, locked: boolean): number => {
    const node = byId.get(id) ?? { id, parentId: null };
    const size = nodeSize(node);
    const kids = (children.get(id) ?? []).filter((kid) => live.has(kid));
    const keep = locked && positions.has(id);
    if (kids.length === 0) {
      if (!keep) positions.set(id, { x, y });
      const point = positions.get(id)!;
      return point.y + size.height;
    }
    const childX = (keep ? positions.get(id)!.x : x) + size.width + COLUMN_GAP;
    let childY = keep ? positions.get(id)!.y : y;
    const placedKids = kids.filter((kid) => positions.has(kid) && previous.has(kid));
    if (keep && placedKids.length > 0) {
      childY = Math.max(...placedKids.map((kid) => {
        const kidSize = nodeSize(byId.get(kid) ?? { id: kid, parentId: id });
        return positions.get(kid)!.y + kidSize.height;
      })) + ROW_GAP;
    }
    const start = childY;
    for (const kid of kids) {
      const kidLocked = previous.has(kid);
      if (kidLocked && positions.has(kid)) {
        childY = Math.max(childY, placeSubtree(kid, childX, positions.get(kid)!.y, true));
        continue;
      }
      childY = placeSubtree(kid, childX, childY, false) + ROW_GAP;
    }
    const childrenBottom = kids.length > 0 ? childY - (placedKids.length === kids.length ? 0 : ROW_GAP) : start;
    const childrenHeight = Math.max(size.height, childrenBottom - start);
    if (!keep) {
      const parentY = y + Math.max(0, (childrenHeight - size.height) / 2);
      positions.set(id, { x, y: parentY });
    }
    const point = positions.get(id)!;
    return Math.max(point.y + size.height, childrenBottom);
  };

  const roots = nodes.filter((node) => !node.parentId || !live.has(node.parentId));
  let cursorY = ATLAS_MARGIN;
  for (const root of roots) {
    const locked = previous.has(root.id);
    const height = subtreeHeight(root.id, new Set());
    const origin = positions.get(root.id);
    placeSubtree(root.id, origin?.x ?? ATLAS_MARGIN, origin?.y ?? cursorY, locked);
    if (!locked) cursorY += height + TREE_GAP;
  }
  for (const node of nodes) {
    if (!positions.has(node.id)) {
      const size = nodeSize(node);
      positions.set(node.id, { x: ATLAS_MARGIN, y: cursorY });
      cursorY += size.height + ROW_GAP;
    }
  }
  resolveCollisions(nodes, positions);
  return positions;
}

function resolveCollisions(nodes: readonly LayoutNode[], positions: Map<string, Point>): void {
  for (let pass = 0; pass < 48; pass += 1) {
    let moved = false;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const boxA = boxOf(a, positions.get(a.id)!);
        const boxB = boxOf(b, positions.get(b.id)!);
        if (!boxesOverlap(boxA, boxB, 12)) continue;
        const lower = boxA.y <= boxB.y ? b : a;
        const top = boxA.y <= boxB.y ? boxA : boxB;
        const current = positions.get(lower.id)!;
        positions.set(lower.id, { x: current.x, y: top.y + top.height + ROW_GAP });
        moved = true;
      }
    }
    if (!moved) return;
  }
}

export function edgeAnchors(from: AtlasBox, to: AtlasBox): { startX: number; startY: number; midX: number; endX: number; endY: number } {
  const startX = from.x + from.width;
  const startY = from.y + from.height / 2;
  const endX = to.x;
  const endY = to.y + to.height / 2;
  const gap = endX - startX;
  const midX = startX + Math.max(16, Math.min(gap / 2, 28));
  return { startX, startY, midX, endX, endY };
}

export function edgePath(from: AtlasBox, to: AtlasBox): string {
  const { startX, startY, midX, endX, endY } = edgeAnchors(from, to);
  return `M ${startX} ${startY} H ${midX} V ${endY} H ${endX}`;
}

export function atlasExtent(nodes: readonly (LayoutNode & Point)[]): { width: number; height: number } {
  let width = 640;
  let height = 420;
  for (const node of nodes) {
    const size = nodeSize(node);
    width = Math.max(width, node.x + size.width + ATLAS_MARGIN);
    height = Math.max(height, node.y + size.height + ATLAS_MARGIN);
  }
  return { width, height };
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
    const keyEvidence = territory?.keyEvidence ?? [];
    if (keyEvidence.length > 0) {
      for (const line of keyEvidence) calculated.push(line);
    } else {
      if (route) calculated.push(`Analysis route: ${routeLabel(route.route)}.`);
      if (route?.classification) calculated.push(`Provisional class: ${route.classification}. This is not a recommendation.`);
      if (route?.robustness) calculated.push(`Representation robustness: ${route.robustness}.`);
      if (typeof route?.position === "number") calculated.push(`Position ${route.position} is only within this comparison, not an absolute score.`);
    }
  }
  if (territory) {
    if (!analysis.layers && territory.keyEvidence) {
      for (const line of territory.keyEvidence) calculated.push(line);
    }
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

