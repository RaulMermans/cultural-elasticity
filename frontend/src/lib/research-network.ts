/**
 * The unified research network: the brand, the directions its baseline found, and every investigation asked from
 * them. An edge means "investigated from". Position on the canvas is lineage only; it never encodes affinity,
 * distance, confidence, elasticity or a recommendation. Every status here is read from a validated server response.
 */
import { researchAssessmentOf, type AgentAnalysisResult, type AgentRunResponse, type EvidenceOutcome, type QueryResponse } from "@cultural-elasticity/shared";
import { runCopy, territoryCopy, type AtlasTone, type Point } from "../components/atlas/atlas-model.ts";
import type { JobActivity } from "./job-envelope.ts";
import type { DirectionView } from "./research-view.ts";

export const BRAND_NODE = "brand";

/** Sprint 10A: "explore" is open discovery started from the scan's signals (the explore handoff). */
export type InquiryOrigin = "direction" | "question" | "explore";

/** One investigation in the network. Its job token reads the job's public view; it starts nothing. */
export type Inquiry = {
  jobId: string;
  token: string;
  parentId: string;
  origin: InquiryOrigin;
  question: string;
  status: string;
  stageLabel: string;
  response: QueryResponse | null;
  /** The server no longer holds the job (expired, or the process restarted). */
  lost: boolean;
  /** The agent's live steps, as the server last reported them. */
  activity?: JobActivity[];
  createdAt: number;
};

export type NetworkKind = "brand" | "direction" | "connection" | "inquiry" | "finding" | "bridge";

/**
 * An opened tie between two territory cards that share Qloo identifiers. Questions asked from it branch from the
 * connection itself. It has no lineage parent: it sits between its two ends.
 */
export type Bridge = { id: string; a: string; b: string; label: string; aLabel: string; bLabel: string };
export const bridgeId = (a: string, b: string) => `tie:${a}|${b}`;

export type NetworkNode = {
  id: string;
  parentId: string | null;
  kind: NetworkKind;
  label: string;
  tone: AtlasTone;
  status: string;
  /** Agent run this node belongs to, for follow-up questions. */
  runId: string | null;
  territoryKey: string | null;
  directionKey: string | null;
  jobId: string | null;
};

const PENDING = new Set(["queued", "running"]);

export const directionNodeId = (key: string) => `dir:${key}`;
export const inquiryNodeId = (jobId: string) => `inq:${jobId}`;
/** A direction opened by a question, for a territory the baseline did not list. */
export const newDirectionId = (name: string) => `new:${name}`;
export const normName = (value: string) => value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();

/** The nearest card above a node (or the node itself) that stands for one territory: a direction or a finding. */
export function territoryAncestor(nodes: readonly NetworkNode[], id: string): NetworkNode | null {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let node = byId.get(id) ?? null;
  for (let guard = 0; node && guard < 64; guard += 1) {
    if (node.kind === "direction" || node.kind === "finding") return node;
    node = node.parentId ? byId.get(node.parentId) ?? null : null;
  }
  return null;
}

/** Every id from the node up to the brand. */
export function lineageOf(nodes: readonly NetworkNode[], id: string): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const out: string[] = [];
  let node = byId.get(id) ?? null;
  for (let guard = 0; node && guard < 64; guard += 1) { out.push(node.id); node = node.parentId ? byId.get(node.parentId) ?? null : null; }
  return out;
}

/** The territory a branch is about: the label of the nearest direction above the node, if any. */
export function branchDirection(nodes: readonly NetworkNode[], id: string): NetworkNode | null {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let node = byId.get(id) ?? null;
  for (let guard = 0; node && guard < 64; guard += 1) {
    if (node.kind === "direction") return node;
    node = node.parentId ? byId.get(node.parentId) ?? null : null;
  }
  return null;
}

const ASSESSMENT_TONE: Record<string, { tone: AtlasTone; status: string }> = {
  WORTH_FURTHER_INVESTIGATION: { tone: "supported", status: "Worth pursuing" },
  INCONCLUSIVE: { tone: "partial", status: "Inconclusive" },
  NOT_SUPPORTED_BY_CURRENT_EVIDENCE: { tone: "unsupported", status: "Not supported" },
  UNABLE_TO_COMPLETE_RESEARCH: { tone: "incomplete", status: "Could not complete" },
};

/** Sprint 12: the card status of a completed investigation is its research conclusion (evidence-assessment/v1). */
const OUTCOME_TONE: Record<EvidenceOutcome, AtlasTone> = {
  ESTABLISHED_ASSOCIATION: "supported",
  OBSERVED_ASSOCIATION: "supported",
  LIMITED_EVIDENCE: "partial",
  NO_SUPPORT_IN_TESTED_SCOPE: "unsupported",
  CONCEPT_NOT_REPRESENTED: "unsupported",
  INCOMPLETE: "incomplete",
};

function conclusionState(result: AgentAnalysisResult): { tone: AtlasTone; status: string } | null {
  if (result.status === "FAILED" || !Array.isArray(result.territories) || !result.territories.some((t) => t.role === "target")) return null;
  const assessed = researchAssessmentOf(result).territories;
  if (assessed.length === 1) return { tone: OUTCOME_TONE[assessed[0]!.outcome], status: assessed[0]!.label };
  return { tone: assessed.some((a) => a.outcome === "ESTABLISHED_ASSOCIATION" || a.outcome === "OBSERVED_ASSOCIATION") ? "supported" : "partial", status: `${assessed.length} concepts assessed` };
}

/**
 * Sprint 9L: the follow-up that can turn an unmeasured reading into a measured one. Elasticity is only measured by a
 * comparison inside one Qloo call, so: if no comparison was tried, ask the comparative question (the runtime builds
 * and validates its own references); if one was tried and still measured nothing, compare with two of the brand's
 * other directions. Null when there is nothing concrete to propose (the user names references instead).
 */
export function measureQuestion(brand: string, target: string, result: AgentRunResponse | null | undefined, directions: readonly string[]): string | null {
  // Sprint 9N: a comparison attempt that Qloo's evidence blocked (feasibility LIKELY_REPEATS) counts as compared, so the
  // one-click follow-up is a named comparison, never the same "how far" question again.
  const done = result && result.status !== "NEEDS_INPUT" ? result : null;
  const compared = Boolean(done && (done.territories.some((territory) => territory.role === "reference") || done.comparisonFeasibility?.repeat === "LIKELY_REPEATS"));
  if (!compared) return `How far can ${brand} extend into ${target}?`;
  // Sprint 12: once a comparison was tried, the brand's other directions are not offered as references: they were never
  // checked as meaningful alternatives to this question (the decision card names the evidence-based next step instead).
  void directions;
  return null;
}

/** The state of one inquiry, from its job and validated response only. */
export function inquiryState(inquiry: Inquiry): { tone: AtlasTone; status: string } {
  const response = inquiry.response;
  // A finished answer kept in this browser stays readable after the server lets the job go.
  const kept = Boolean(response) && !PENDING.has(inquiry.status);
  if (inquiry.lost && !kept) return { tone: "failed", status: "No longer available" };
  if (PENDING.has(inquiry.status)) return { tone: "running", status: "Investigating" };
  if (!response) {
    if (inquiry.status === "cancelled") return { tone: "interrupted", status: "Stopped" };
    if (inquiry.status === "expired") return { tone: "failed", status: "No longer available" };
    return { tone: "failed", status: "Could not finish" };
  }
  if (response.state === "NEEDS_CLARIFICATION" || response.state === "INVESTIGATION_NEEDS_INPUT") return { tone: "hypothesis", status: "Needs your answer" };
  if (!response.investigation && (response.state === "UNSUPPORTED_OPERATION" || response.state === "PARTIALLY_SUPPORTED" || response.state === "INTERPRETATION_FAILED" || response.state === "CONTEXT_UNAVAILABLE")) {
    return { tone: "unsupported", status: "Not run" };
  }
  const result = response.investigation?.result;
  const done = result && result.status !== "NEEDS_INPUT" ? result : undefined;
  const concluded = done ? conclusionState(done) : null;
  if (concluded) return concluded;
  const assessment = done?.hypothesisAssessment;
  if (assessment) return ASSESSMENT_TONE[assessment.outcome] ?? { tone: "idle", status: "Investigated" };
  const copy = runCopy(response);
  return { tone: copy.tone, status: copy.statusLabel };
}

/** Qloo connections shown around an opened direction. They are what Qloo returned, never investigation steps. */
export type ExpandedDirection = { nodeId: string; connections: { key: string; name: string }[] };

export function buildNetwork(brand: string, directions: readonly DirectionView[], inquiries: readonly Inquiry[], expanded: ExpandedDirection | null = null, bridges: readonly Bridge[] = []): NetworkNode[] {
  const nodes: NetworkNode[] = [{ id: BRAND_NODE, parentId: null, kind: "brand", label: brand, tone: "idle", status: "Brand", runId: null, territoryKey: null, directionKey: null, jobId: null }];
  const ids = new Set([BRAND_NODE]);
  for (const direction of directions) {
    const id = directionNodeId(direction.key);
    ids.add(id);
    nodes.push({ id, parentId: BRAND_NODE, kind: "direction", label: direction.name, tone: "hypothesis", status: "Direction", runId: null, territoryKey: null, directionKey: direction.key, jobId: null });
    if (expanded?.nodeId !== id) continue;
    for (const connection of expanded.connections) {
      const connectionId = `con:${direction.key}:${connection.key}`;
      if (ids.has(connectionId)) continue;
      ids.add(connectionId);
      nodes.push({ id: connectionId, parentId: id, kind: "connection", label: connection.name, tone: "idle", status: "Qloo connection", runId: null, territoryKey: null, directionKey: direction.key, jobId: null });
    }
  }
  // Every inquiry lives on a direction's branch. A question about the brand joins the direction it names, or opens a
  // new direction for a territory the baseline did not list. Matching is by the territory name the server returned.
  const directionByName = new Map(directions.map((direction) => [normName(direction.name), directionNodeId(direction.key)]));
  // The territories each branch is already about. A connection is about both of its ends.
  const branchName = new Map<string, string[]>(directions.map((direction) => [directionNodeId(direction.key), [normName(direction.name)]]));
  const findingByName = new Map<string, string>();
  const bridgeById = new Map(bridges.map((bridge) => [bridge.id, bridge]));
  // A bridge appears once both of its ends are on the board.
  const openBridge = (id: string) => {
    const bridge = bridgeById.get(id);
    if (!bridge || ids.has(id) || !ids.has(bridge.a) || !ids.has(bridge.b)) return;
    ids.add(id);
    branchName.set(id, [normName(bridge.aLabel), normName(bridge.bLabel)]);
    nodes.push({ id, parentId: null, kind: "bridge", label: bridge.label, tone: "idle", status: "Connection", runId: null, territoryKey: null, directionKey: null, jobId: null });
  };
  const ordered = [...inquiries].sort((a, b) => a.createdAt - b.createdAt);
  for (const inquiry of ordered) {
    const id = inquiryNodeId(inquiry.jobId);
    if (ids.has(id)) continue;
    openBridge(inquiry.parentId);
    const state = inquiryState(inquiry);
    const runId = inquiry.response?.investigation?.runId ?? null;
    let parentId = ids.has(inquiry.parentId) ? inquiry.parentId : BRAND_NODE;
    const named = inquiry.response?.territories ?? [];
    // A broad question (where could the brand go?) stays on the brand; its candidates become findings under it.
    const intent = inquiry.response?.handoff?.intent ?? null;
    const aboutOne = intent ? intent !== "explore_frontier" : named.length === 1;
    if (parentId === BRAND_NODE && named[0] && aboutOne) {
      const name = normName(named[0].name);
      // Grow from where the territory already is: a baseline direction, then a card where it was found, then a new direction.
      const existing = directionByName.get(name) ?? findingByName.get(name) ?? newDirectionId(name);
      if (!ids.has(existing)) {
        ids.add(existing);
        directionByName.set(name, existing);
        branchName.set(existing, [name]);
        nodes.push({ id: existing, parentId: BRAND_NODE, kind: "direction", label: named[0].name, tone: "hypothesis", status: "New direction", runId: null, territoryKey: null, directionKey: null, jobId: null });
      }
      parentId = existing;
    }
    ids.add(id);
    const branch = branchName.get(parentId) ?? null;
    if (branch) branchName.set(id, branch);
    nodes.push({ id, parentId, kind: "inquiry", label: inquiry.question, tone: state.tone, status: state.status, runId, territoryKey: null, directionKey: null, jobId: inquiry.jobId });
    // A direction investigation is about that direction; a question or an exploration can name or discover other
    // territories. The branch's own territories (a connection's two ends) are never repeated as findings.
    if (inquiry.origin === "direction" || !inquiry.response) continue;
    inquiry.response.territories.forEach((territory, index) => {
      if (branch?.includes(normName(territory.name))) return;
      const copy = territoryCopy(inquiry.response!, territory);
      const findingId = `find:${inquiry.jobId}:${territory.territoryKey ?? index}`;
      if (ids.has(findingId)) return;
      ids.add(findingId);
      branchName.set(findingId, [normName(territory.name)]);
      if (!findingByName.has(normName(territory.name))) findingByName.set(normName(territory.name), findingId);
      nodes.push({ id: findingId, parentId: id, kind: "finding", label: territory.name, tone: copy.tone, status: copy.statusLabel, runId, territoryKey: territory.territoryKey, directionKey: null, jobId: inquiry.jobId });
    });
  }
  for (const bridge of bridges) openBridge(bridge.id);
  return nodes;
}

const FIRST_RING = 300;
const RING_STEP = 270;
/** Arc length kept free per card on a ring, so cards on the same ring never overlap. */
const CARD_ARC = 250;

/**
 * Radial tree: the brand in the middle, each step outward one investigation further. Each subtree gets an arc in
 * proportion to its leaves, so branches never cross. Deterministic for the same nodes.
 */
export function layoutNetwork(nodes: readonly Pick<NetworkNode, "id" | "parentId">[]): Map<string, Point> {
  const children = new Map<string | null, string[]>();
  for (const node of nodes) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node.id]);
  const leaves = new Map<string, number>();
  const count = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return 1;
    seen.add(id);
    const kids = children.get(id) ?? [];
    const total = kids.length ? kids.reduce((sum, kid) => sum + count(kid, seen), 0) : 1;
    leaves.set(id, total);
    return total;
  };
  const perDepth: number[] = [];
  const visited = new Set<string>();
  const depthOf = (id: string, depth: number) => {
    if (visited.has(id)) return;
    visited.add(id);
    perDepth[depth] = (perDepth[depth] ?? 0) + 1;
    for (const kid of children.get(id) ?? []) depthOf(kid, depth + 1);
  };
  for (const root of children.get(null) ?? []) depthOf(root, 0);
  const rings: number[] = [0];
  for (let depth = 1; depth < perDepth.length; depth += 1) {
    const needed = ((perDepth[depth] ?? 0) * CARD_ARC) / (2 * Math.PI);
    rings[depth] = Math.max(depth === 1 ? FIRST_RING : rings[depth - 1]! + RING_STEP, needed);
  }
  const positions = new Map<string, Point>();
  const place = (id: string, depth: number, start: number, end: number) => {
    if (positions.has(id)) return;
    const angle = (start + end) / 2;
    const radius = rings[depth] ?? 0;
    positions.set(id, { x: Math.round(Math.cos(angle) * radius), y: Math.round(Math.sin(angle) * radius) });
    const kids = children.get(id) ?? [];
    const total = kids.reduce((sum, kid) => sum + (leaves.get(kid) ?? 1), 0);
    let cursor = start;
    for (const kid of kids) {
      const span = ((end - start) * (leaves.get(kid) ?? 1)) / Math.max(1, total);
      place(kid, depth + 1, cursor, cursor + span);
      cursor += span;
    }
  };
  for (const root of children.get(null) ?? []) {
    count(root);
    place(root, 0, -Math.PI / 2, (3 * Math.PI) / 2);
  }
  return positions;
}

/**
 * Lays out the tree, then places each bridge between its two ends (bowed away from the brand, like its tie) and
 * fans the questions asked from it outward from there.
 */
export function layoutWithBridges(nodes: readonly NetworkNode[], bridges: readonly Bridge[]): Map<string, Point> {
  const byParent = new Map<string, string[]>();
  for (const node of nodes) if (node.parentId) byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node.id]);
  const hanging = new Set<string>();
  const collect = (id: string) => { for (const kid of byParent.get(id) ?? []) if (!hanging.has(kid)) { hanging.add(kid); collect(kid); } };
  const present = nodes.filter((node) => node.kind === "bridge").map((node) => node.id);
  for (const id of present) { hanging.add(id); collect(id); }
  const positions = layoutNetwork(nodes.filter((node) => !hanging.has(node.id)));
  for (const id of present) {
    const bridge = bridges.find((item) => item.id === id);
    const from = bridge ? positions.get(bridge.a) : undefined;
    const to = bridge ? positions.get(bridge.b) : undefined;
    if (!from || !to) continue;
    const point = bridgePoint(from, to);
    positions.set(id, point);
    const fan = (parent: string, origin: Point, angle: number, depth: number) => {
      const kids = byParent.get(parent) ?? [];
      kids.forEach((kid, index) => {
        if (positions.has(kid)) return;
        const spread = kids.length > 1 ? (index - (kids.length - 1) / 2) * 0.55 : 0;
        const a = angle + spread;
        const at = { x: Math.round(origin.x + Math.cos(a) * 250), y: Math.round(origin.y + Math.sin(a) * 250) };
        positions.set(kid, at);
        fan(kid, at, a, depth + 1);
      });
    };
    fan(id, point, Math.atan2(point.y, point.x) || -Math.PI / 2, 1);
  }
  return positions;
}

/** Where a tie between two cards bows to: sideways, away from the brand at the centre. Shared by tie and bridge. */
export function bridgePoint(from: Point, to: Point): Point {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const span = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const nx = -(to.y - from.y) / span;
  const ny = (to.x - from.x) / span;
  const away = nx * mx + ny * my < 0 ? -1 : 1;
  const bow = Math.max(140, span * 0.35);
  // The midpoint of a quadratic curve with this control point.
  return { x: Math.round(mx + (nx * bow * away) / 2), y: Math.round(my + (ny * bow * away) / 2) };
}

export function networkBounds(positions: ReadonlyMap<string, Point>, margin = 150): { x: number; y: number; width: number; height: number } {
  const points = [...positions.values()];
  if (!points.length) return { x: -margin, y: -margin, width: margin * 2, height: margin * 2 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs) - margin;
  const y = Math.min(...ys) - margin;
  return { x, y, width: Math.max(...xs) + margin - x, height: Math.max(...ys) + margin - y };
}

/** Follow-up context for a question asked from a node; null asks a new question about the brand. */
export function followUpContext(node: NetworkNode | null): { runId: string; selectedTerritoryKey?: string } | null {
  if (!node?.runId) return null;
  return node.territoryKey ? { runId: node.runId, selectedTerritoryKey: node.territoryKey } : { runId: node.runId };
}

/** Whether the server still has to be asked about this inquiry: it is running, or it never returned an answer. */
export function needsRefresh(inquiry: Inquiry): boolean {
  return !inquiry.lost && (PENDING.has(inquiry.status) || !inquiry.response);
}

export function isPending(inquiry: Inquiry): boolean {
  return !inquiry.lost && PENDING.has(inquiry.status);
}

const RETRYABLE = new Set(["No longer available", "Could not finish", "Stopped", "Could not complete"]);

/** A failed, stopped or lost investigation may be started again by the user; a result already kept is never rerun. */
export function canRetry(inquiry: Inquiry): boolean {
  return RETRYABLE.has(inquiryState(inquiry).status);
}
