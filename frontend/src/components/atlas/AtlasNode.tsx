"use client";

import { decorativeRadii, type AtlasDraft } from "./atlas-model";

export function AtlasNode({
  node,
  selected,
  compared,
  reducedMotion,
  guided,
  onSelect,
}: {
  node: AtlasDraft & { x: number; y: number };
  selected: boolean;
  compared: boolean;
  reducedMotion: boolean;
  guided: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className="atlas-node"
      data-testid={`node-${node.id}`}
      data-tone={node.tone}
      data-reduced={reducedMotion ? "true" : "false"}
      aria-pressed={selected}
      style={guided ? { borderRadius: decorativeRadii(node.id) } : { left: node.x, top: node.y, borderRadius: decorativeRadii(node.id) }}
      onClick={() => onSelect(node.id)}
    >
      <strong>{node.label}</strong>
      <small>{node.statusLabel}{compared ? " · Selected to compare" : ""}</small>
    </button>
  );
}
