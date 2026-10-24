"use client";

import { useEffect, useMemo, useRef } from "react";
import { AtlasConnection } from "./AtlasConnection";
import { AtlasNode } from "./AtlasNode";
import { atlasExtent, boxOf, neighborId, type AtlasDraft } from "./atlas-model";

type Placed = AtlasDraft & { x: number; y: number };

export function InvestigationCanvas({
  nodes,
  selectedId,
  compareIds,
  reducedMotion,
  guided,
  preview = false,
  onSelect,
}: {
  nodes: Placed[];
  selectedId: string | null;
  compareIds: string[];
  reducedMotion: boolean;
  guided: boolean;
  preview?: boolean;
  onSelect: (id: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => (guided ? guidedNodes(nodes, selectedId) : nodes), [guided, nodes, selectedId]);
  const extent = atlasExtent(nodes);
  useEffect(() => {
    const selected = scroller.current?.querySelector<HTMLElement>("[aria-pressed='true']");
    selected?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
  }, [selectedId, reducedMotion, guided]);

  return (
    <div className="canvas" ref={scroller} data-testid="atlas-canvas" role="group" aria-label="Investigation">
      {guided ? null : (
        <svg className="canvas__edges" aria-hidden="true" viewBox={`0 0 ${extent.width} ${extent.height}`} width={extent.width} height={extent.height}>
          {nodes.map((node) => {
            const parent = nodes.find((item) => item.id === node.parentId);
            if (!parent) return null;
            const active = node.id === selectedId || parent.id === selectedId;
            return <AtlasConnection key={`${parent.id}-${node.id}`} from={boxOf(parent, parent)} to={boxOf(node, node)} active={active} />;
          })}
        </svg>
      )}
      <div role="list" style={guided ? undefined : { width: extent.width, height: extent.height }}>
        {visible.map((node) => (
          <div role="listitem" key={node.id}>
            <AtlasNode
              node={node}
              selected={node.id === selectedId}
              compared={compareIds.includes(node.id)}
              reducedMotion={reducedMotion}
              guided={guided}
              onSelect={onSelect}
              onNeighbor={preview ? undefined : (direction) => {
                const next = neighborId(nodes, node.id, direction);
                if (next) onSelect(next);
              }}
            />
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
  const siblings = nodes.filter((node) => node.parentId === selected.parentId && node.id !== selected.id);
  return [parent, selected, ...children, ...siblings].filter((node): node is Placed => Boolean(node));
}
