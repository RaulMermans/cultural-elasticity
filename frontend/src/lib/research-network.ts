/**
 * The unified research network: the brand, the directions its baseline found, and every investigation asked from
 * them. An edge means "investigated from". Position on the canvas is lineage only; it never encodes affinity,
 * distance, confidence, elasticity or a recommendation. Every status here is read from a validated server response.
 */
import type { QueryResponse } from "@cultural-elasticity/shared";
import { runCopy, territoryCopy, type AtlasTone, type Point } from "../components/atlas/atlas-model.ts";
import type { JobActivity } from "./job-envelope.ts";
import type { DirectionView } from "./research-view.ts";

export const BRAND_NODE = "brand";

export type InquiryOrigin = "direction" | "question";

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

export type NetworkKind = "brand" | "direction" | "connection" | "inquiry" | "finding";

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
  const assessment = result && result.status !== "NEEDS_INPUT" ? result.hypothesisAssessment : undefined;
  if (assessment) return ASSESSMENT_TONE[assessment.outcome] ?? { tone: "idle", status: "Investigated" };
  const copy = runCopy(response);
  return { tone: copy.tone, status: copy.statusLabel };
}

/** Qloo connections shown around an opened direction. They are what Qloo returned, never investigation steps. */
export type ExpandedDirection = { nodeId: string; connections: { key: string; name: string }[] };

export function buildNetwork(brand: string, directions: readonly DirectionView[], inquiries: readonly Inquiry[], expanded: ExpandedDirection | null = null): NetworkNode[] {
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
  const branchName = new Map<string, string>(directions.map((direction) => [directionNodeId(direction.key), normName(direction.name)]));
  const ordered = [...inquiries].sort((a, b) => a.createdAt - b.createdAt);
  for (const inquiry of ordered) {
    const id = inquiryNodeId(inquiry.jobId);
    if (ids.has(id)) continue;
    const state = inquiryState(inquiry);
    const runId = inquiry.response?.investigation?.runId ?? null;
    let parentId = ids.has(inquiry.parentId) ? inquiry.parentId : BRAND_NODE;
    const named = inquiry.response?.territories ?? [];
    if (parentId === BRAND_NODE && named[0]) {
      const name = normName(named[0].name);
      const existing = directionByName.get(name) ?? newDirectionId(name);
      if (!ids.has(existing)) {
        ids.add(existing);
        directionByName.set(name, existing);
        branchName.set(existing, name);
        nodes.push({ id: existing, parentId: BRAND_NODE, kind: "direction", label: named[0].name, tone: "hypothesis", status: "New direction", runId: null, territoryKey: null, directionKey: null, jobId: null });
      }
      parentId = existing;
    }
    ids.add(id);
    const branch = branchName.get(parentId) ?? null;
    if (branch) branchName.set(id, branch);
    nodes.push({ id, parentId, kind: "inquiry", label: inquiry.question, tone: state.tone, status: state.status, runId, territoryKey: null, directionKey: null, jobId: inquiry.jobId });
    // A direction investigation is about that direction; a question can name or discover other territories. The
    // branch's own territory is shown on the inquiry itself, never repeated as a finding.
    if (inquiry.origin !== "question" || !inquiry.response) continue;
    inquiry.response.territories.forEach((territory, index) => {
      if (branch && normName(territory.name) === branch) return;
      const copy = territoryCopy(inquiry.response!, territory);
      const findingId = `find:${inquiry.jobId}:${territory.territoryKey ?? index}`;
      if (ids.has(findingId)) return;
      ids.add(findingId);
      branchName.set(findingId, normName(territory.name));
      nodes.push({ id: findingId, parentId: id, kind: "finding", label: territory.name, tone: copy.tone, status: copy.statusLabel, runId, territoryKey: territory.territoryKey, directionKey: null, jobId: inquiry.jobId });
    });
  }
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
