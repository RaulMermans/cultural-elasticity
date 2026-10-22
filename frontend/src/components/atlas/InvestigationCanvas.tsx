"use client";

import { useEffect, useMemo, useRef } from "react";
import { AtlasConnection } from "./AtlasConnection";
import { AtlasNode } from "./AtlasNode";
import type { AtlasDraft } from "./atlas-model";

type Placed = AtlasDraft & { x: number; y: number };

export function InvestigationCanvas({
  nodes,
  selectedId,
  compareIds,
  reducedMotion,
  guided,
  onSelect,
}: {
  nodes: Placed[];
  selectedId: string | null;
  compareIds: string[];
  reducedMotion: boolean;
  guided: boolean;
  onSelect: (id: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => (guided ? guidedNodes(nodes, selectedId) : nodes), [guided, nodes, selectedId]);
  const width = Math.max(640, ...nodes.map((node) => node.x + 220));
  const height = Math.max(460, ...nodes.map((node) => node.y + 140));
  useEffect(() => {
    const selected = scroller.current?.querySelector<HTMLElement>("[aria-pressed='true']");
    selected?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
  }, [selectedId, reducedMotion, guided]);

  return (
    <div className="canvas" ref={scroller} data-testid="atlas-canvas" role="group" aria-label="Investigation">
      {guided ? null : (
        <svg className="canvas__edges" aria-hidden="true" viewBox={`0 0 ${width} ${height}`}>
          {nodes.map((node) => {
            const parent = nodes.find((item) => item.id === node.parentId);
            return parent ? <AtlasConnection key={`${parent.id}-${node.id}`} from={parent} to={node} /> : null;
          })}
        </svg>
      )}
      <div role="list">
        {visible.map((node) => (
          <div role="listitem" key={node.id}>
            <AtlasNode node={node} selected={node.id === selectedId} compared={compareIds.includes(node.id)} reducedMotion={reducedMotion} guided={guided} onSelect={onSelect} />
          </div>
        ))}
      </div>
    </div>
  );
}

function guidedNodes(nodes: Placed[], selectedId: string | null): Placed[] {
  const selected = nodes.find((node) => node.id === selectedId) ?? nodes[0];
  if (!selected) return [];
  const parent = nodes.find((node) => node.id === selected.parentId);
  const children = nodes.filter((node) => node.parentId === selected.id);
  return [parent, selected, ...children].filter((node): node is Placed => Boolean(node));
}
