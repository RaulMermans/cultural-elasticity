"use client";

import { nodeSize, shortStatus, type AtlasDraft } from "./atlas-model";

export function AtlasNode({
  node,
  selected,
  compared,
  reducedMotion,
  guided,
  onSelect,
  onNeighbor,
}: {
  node: AtlasDraft & { x: number; y: number };
  selected: boolean;
  compared: boolean;
  reducedMotion: boolean;
  guided: boolean;
  onSelect: (id: string) => void;
  onNeighbor?: (direction: "parent" | "child" | "previous" | "next") => void;
}) {
  const size = nodeSize(node);
  return (
    <button
      type="button"
      className="atlas-node"
      data-testid={`node-${node.id}`}
      data-tone={node.tone}
      data-kind={node.kind}
      data-compared={compared ? "true" : "false"}
      data-reduced={reducedMotion ? "true" : "false"}
      aria-pressed={selected}
      style={guided ? { width: "100%" } : { left: node.x, top: node.y, width: size.width, minHeight: size.height }}
      onClick={() => onSelect(node.id)}
      onKeyDown={(event) => {
        if (!onNeighbor) return;
        const map = { ArrowLeft: "parent", ArrowRight: "child", ArrowUp: "previous", ArrowDown: "next" } as const;
        const direction = map[event.key as keyof typeof map];
        if (!direction) return;
        event.preventDefault();
        onNeighbor(direction);
      }}
    >
      <span className="atlas-node__mark" aria-hidden="true" />
      <span className="atlas-node__body">
        <strong>{node.label}</strong>
        <small>{shortStatus(node.tone, node.statusLabel)}{compared ? " · Compare" : ""}</small>
      </span>
    </button>
  );
}
