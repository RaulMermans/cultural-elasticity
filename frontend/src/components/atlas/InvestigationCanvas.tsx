"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  const [fit, setFit] = useState(1);
  const visible = useMemo(() => (guided ? guidedNodes(nodes, selectedId) : nodes), [guided, nodes, selectedId]);
  const extent = atlasExtent(nodes);
  useEffect(() => {
    if (preview) return;
    const selected = scroller.current?.querySelector<HTMLElement>("[aria-pressed='true']");
    selected?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
  }, [selectedId, reducedMotion, guided, preview]);
  useEffect(() => {
    if (!preview) return;
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      const pad = 28;
      const sx = (el.clientWidth - pad) / extent.width;
      const sy = (el.clientHeight - pad) / extent.height;
      if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) return;
      setFit(Math.min(1, sx, sy) * 0.94);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [preview, extent.width, extent.height]);

  const tree = (
    <>
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
    </>
  );

  return (
    <div className="canvas" ref={scroller} data-testid="atlas-canvas" data-preview={preview ? "true" : "false"} role="group" aria-label="Investigation">
      {preview && !guided ? (
        <div
          className="canvas__stage"
          style={{
            width: extent.width,
            height: extent.height,
            transform: `scale(${fit})`,
            transformOrigin: "0 0",
          }}
        >
          {tree}
        </div>
      ) : tree}
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
