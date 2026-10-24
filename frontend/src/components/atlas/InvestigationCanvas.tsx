"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AtlasConnection } from "./AtlasConnection";
import { AtlasNode } from "./AtlasNode";
import { atlasExtent, boxOf, neighborId, type AtlasBox, type AtlasDraft } from "./atlas-model";

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
  const stage = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  const [measured, setMeasured] = useState<Map<string, AtlasBox>>(new Map());
  const visible = useMemo(() => (guided ? guidedNodes(nodes, selectedId) : nodes), [guided, nodes, selectedId]);
  const layoutExtent = atlasExtent(nodes);
  const boxes = useMemo(() => {
    const next = new Map<string, AtlasBox>();
    for (const node of nodes) next.set(node.id, measured.get(node.id) ?? boxOf(node, node));
    return next;
  }, [nodes, measured]);
  const extent = useMemo(() => extentOf(nodes, boxes, layoutExtent), [nodes, boxes, layoutExtent]);

  useEffect(() => {
    if (preview) return;
    const selected = scroller.current?.querySelector<HTMLElement>("[aria-pressed='true']");
    selected?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
  }, [selectedId, reducedMotion, guided, preview]);

  useLayoutEffect(() => {
    if (guided) return;
    const root = stage.current;
    if (!root) return;
    const measure = () => {
      const next = new Map<string, AtlasBox>();
      for (const node of nodes) {
        const el = root.querySelector<HTMLElement>(`[data-node-id="${cssEscape(node.id)}"]`);
        next.set(node.id, el ? offsetBox(el, root) : boxOf(node, node));
      }
      setMeasured((current) => (sameBoxes(current, next) ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    for (const node of root.querySelectorAll(".atlas-node")) observer.observe(node);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [nodes, guided, selectedId]);

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
    <div
      className="canvas__stage"
      ref={stage}
      data-testid="atlas-stage"
      style={guided ? undefined : { width: extent.width, height: extent.height }}
    >
      {guided ? null : (
        <svg
          className="canvas__edges"
          aria-hidden="true"
          viewBox={`0 0 ${extent.width} ${extent.height}`}
          width={extent.width}
          height={extent.height}
          data-testid="atlas-edges"
        >
          {nodes.map((node) => {
            const parent = nodes.find((item) => item.id === node.parentId);
            if (!parent) return null;
            const from = boxes.get(parent.id);
            const to = boxes.get(node.id);
            if (!from || !to) return null;
            const active = node.id === selectedId || parent.id === selectedId;
            return <AtlasConnection key={`${parent.id}-${node.id}`} from={from} to={to} active={active} />;
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

  return (
    <div className="canvas" ref={scroller} data-testid="atlas-canvas" data-preview={preview ? "true" : "false"} role="group" aria-label="Investigation">
      {preview && !guided ? (
        <div
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

function extentOf(nodes: readonly Placed[], boxes: ReadonlyMap<string, AtlasBox>, fallback: { width: number; height: number }): { width: number; height: number } {
  let width = fallback.width;
  let height = fallback.height;
  for (const node of nodes) {
    const box = boxes.get(node.id);
    if (!box) continue;
    width = Math.max(width, box.x + box.width + 28);
    height = Math.max(height, box.y + box.height + 28);
  }
  return { width, height };
}

function sameBoxes(left: ReadonlyMap<string, AtlasBox>, right: ReadonlyMap<string, AtlasBox>): boolean {
  if (left.size !== right.size) return false;
  for (const [id, box] of right) {
    const prior = left.get(id);
    if (!prior) return false;
    if (Math.abs(prior.x - box.x) > 0.5 || Math.abs(prior.y - box.y) > 0.5 || Math.abs(prior.width - box.width) > 0.5 || Math.abs(prior.height - box.height) > 0.5) {
      return false;
    }
  }
  return true;
}

function offsetBox(el: HTMLElement, root: HTMLElement): AtlasBox {
  let x = 0;
  let y = 0;
  let current: HTMLElement | null = el;
  while (current && current !== root) {
    x += current.offsetLeft;
    y += current.offsetTop;
    current = current.offsetParent instanceof HTMLElement ? current.offsetParent : null;
  }
  return { x, y, width: el.offsetWidth, height: el.offsetHeight };
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/gu, "\\$&");
}
