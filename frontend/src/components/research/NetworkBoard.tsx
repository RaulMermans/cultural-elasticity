"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Point } from "@/components/atlas/atlas-model";
import { networkBounds, type NetworkNode } from "@/lib/research-network";

/** Card sizes per node kind. Size is a role, never a measure of importance, affinity or elasticity. */
export const CARD: Record<NetworkNode["kind"], { width: number; height: number; chars: number }> = {
  brand: { width: 230, height: 92, chars: 18 },
  direction: { width: 200, height: 78, chars: 22 },
  connection: { width: 150, height: 44, chars: 18 },
  inquiry: { width: 240, height: 84, chars: 26 },
  finding: { width: 180, height: 70, chars: 20 },
  bridge: { width: 230, height: 70, chars: 26 },
};

const KIND_LABEL: Record<NetworkNode["kind"], string> = { brand: "Brand", direction: "Direction", connection: "Qloo connection", inquiry: "Question", finding: "Territory", bridge: "Connection" };

function wrap(text: string, chars: number, lines: number): string[] {
  const out: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/u)) {
    if (!current) current = word;
    else if (`${current} ${word}`.length <= chars) current = `${current} ${word}`;
    else { out.push(current); current = word; }
  }
  if (current) out.push(current);
  if (out.length <= lines) return out;
  const kept = out.slice(0, lines);
  kept[lines - 1] = `${kept[lines - 1]!.slice(0, chars - 1).trimEnd()}…`;
  return kept;
}

type View = { x: number; y: number; k: number };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Space covered by floating panels, kept clear when the board fits the network. */
export type BoardInset = { top: number; right: number; bottom: number; left: number };

export function NetworkBoard({ nodes, positions, links = [], selectedId, onSelect, onMove, onTidy, moved, label, inset }: { nodes: NetworkNode[]; positions: ReadonlyMap<string, Point>; links?: { a: string; b: string; shared: { label: string }[] }[]; selectedId: string; onSelect: (id: string) => void; onMove: (id: string, dx: number, dy: number, origin: ReadonlyMap<string, Point>) => void; onTidy: () => void; moved: boolean; label: string; inset: BoardInset }) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1200, height: 720 });
  const [view, setView] = useState<View>({ x: 600, y: 360, k: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const touched = useRef(false);
  // A card drag moves the card's branch; a press that never moves is a click.
  const cardDrag = useRef<{ id: string; x: number; y: number; moved: boolean; origin: ReadonlyMap<string, Point> } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const suppressClick = useRef(false);

  const fit = useCallback(() => {
    const bounds = networkBounds(positions, 150);
    const narrow = size.width < 1000;
    const free = narrow ? { top: 60, right: 0, bottom: 60, left: 0 } : inset;
    const width = Math.max(200, size.width - free.left - free.right);
    const height = Math.max(200, size.height - free.top - free.bottom);
    const k = clamp(Math.min(width / bounds.width, height / bounds.height), 0.3, 1.1);
    setView({ k, x: free.left + width / 2 - (bounds.x + bounds.width / 2) * k, y: free.top + height / 2 - (bounds.y + bounds.height / 2) * k });
  }, [positions, size, inset]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height }); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Refit when the network grows, unless the user has moved the board themselves.
  const nodeCount = nodes.length;
  useEffect(() => { if (!touched.current) fit(); }, [fit, nodeCount]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      touched.current = true;
      const rect = element.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setView((current) => {
        const k = clamp(current.k * Math.exp(-event.deltaY * 0.0015), 0.25, 2.5);
        return { k, x: px - ((px - current.x) * k) / current.k, y: py - ((py - current.y) * k) / current.k };
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const zoom = (factor: number) => {
    touched.current = true;
    setView((current) => {
      const k = clamp(current.k * factor, 0.25, 2.5);
      const cx = size.width / 2;
      const cy = size.height / 2;
      return { k, x: cx - ((cx - current.x) * k) / current.k, y: cy - ((cy - current.y) * k) / current.k };
    });
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // Cards, ties and the zoom controls take their own clicks; capturing the pointer here would swallow them.
    if ((event.target as Element).closest(".rn-card, .rn-zoom, .rn-tie")) return;
    drag.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) { start.moved = true; touched.current = true; }
    setView((current) => ({ ...current, x: start.vx + dx, y: start.vy + dy }));
  };
  const onPointerUp = () => { drag.current = null; };

  const onCardDown = (event: PointerEvent<SVGGElement>, id: string) => {
    if (event.button !== 0) return;
    cardDrag.current = { id, x: event.clientX, y: event.clientY, moved: false, origin: new Map(positions) };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onCardMove = (event: PointerEvent<SVGGElement>) => {
    const start = cardDrag.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    if (!start.moved) { start.moved = true; touched.current = true; setDragging(start.id); }
    onMove(start.id, dx / view.k, dy / view.k, start.origin);
  };
  const onCardUp = () => {
    suppressClick.current = Boolean(cardDrag.current?.moved);
    cardDrag.current = null;
    setDragging(null);
  };
  const onCardClick = (id: string) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    onSelect(id);
  };

  const onKey = (event: KeyboardEvent<SVGGElement>, id: string) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(id); }
  };

  return (
    <div ref={host} className="rn-board" data-testid="network-canvas" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${24 * view.k}px ${24 * view.k}px` }}>
      <svg width="100%" height="100%" role="tree" aria-label={label}>
        <defs>
          <filter id="rn-shadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#1a1612" floodOpacity="0.14" /></filter>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {nodes.filter((node) => node.parentId && positions.has(node.parentId)).map((node) => {
            const from = positions.get(node.parentId!)!;
            const to = positions.get(node.id)!;
            const mx = (from.x + to.x) / 2;
            const my = (from.y + to.y) / 2;
            return <path key={`edge:${node.id}`} className="rn-wire" data-kind={node.kind} data-tone={node.tone} pathLength={1}
              d={`M ${from.x} ${from.y} Q ${mx * 0.82} ${my * 0.82} ${to.x} ${to.y}`} />;
          })}
          {nodes.filter((node) => node.kind === "bridge").flatMap((node) => {
            const [a, b] = node.id.slice(4).split("|");
            const at = positions.get(node.id);
            return [a, b].map((end) => {
              const to = end ? positions.get(end) : undefined;
              if (!at || !to) return null;
              return <path key={`bridge:${node.id}:${end}`} className="rn-bridge-wire" data-active={node.id === selectedId ? "true" : undefined} pathLength={1} d={`M ${at.x} ${at.y} L ${to.x} ${to.y}`} />;
            });
          })}
          {links.filter((link) => positions.has(link.a) && positions.has(link.b) && !positions.has(`tie:${link.a}|${link.b}`)).map((link) => {
            const from = positions.get(link.a)!;
            const to = positions.get(link.b)!;
            // Bow the tie sideways, away from the brand, so it reads as a bridge across branches, not a lineage edge.
            const mx = (from.x + to.x) / 2;
            const my = (from.y + to.y) / 2;
            const span = Math.hypot(to.x - from.x, to.y - from.y) || 1;
            const nx = -(to.y - from.y) / span;
            const ny = (to.x - from.x) / span;
            const away = nx * mx + ny * my < 0 ? -1 : 1;
            const bow = Math.max(140, span * 0.35);
            const cx = mx + nx * bow * away;
            const cy = my + ny * bow * away;
            const active = link.a === selectedId || link.b === selectedId;
            const bx = 0.25 * from.x + 0.5 * cx + 0.25 * to.x;
            const by = 0.25 * from.y + 0.5 * cy + 0.25 * to.y;
            const open = () => onSelect(`tie:${link.a}|${link.b}`);
            return <g key={`tie:${link.a}:${link.b}`} className="rn-tie" data-active={active ? "true" : undefined} data-testid="network-tie"
              role="button" tabIndex={0} aria-label={`Explore the connection: ${link.shared.length} shared Qloo signal${link.shared.length === 1 ? "" : "s"}`}
              onClick={open} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } }}>
              <title>{`Shares ${link.shared.length} Qloo signal${link.shared.length === 1 ? "" : "s"}: ${link.shared.slice(0, 5).map((item) => item.label).join(", ")}`}</title>
              <path d={`M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`} pathLength={1} />
              <circle cx={bx} cy={by} r={13} />
              <text x={bx} y={by + 4} textAnchor="middle">{link.shared.length}</text>
            </g>;
          })}
          {nodes.map((node, index) => {
            const point = positions.get(node.id)!;
            const card = CARD[node.kind];
            const lines = wrap(node.label, card.chars, node.kind === "connection" ? 1 : 2);
            const selected = node.id === selectedId;
            const top = -card.height / 2;
            return (
              <g key={node.id} className="rn-card" data-kind={node.kind} data-tone={node.tone} data-selected={selected ? "true" : undefined} data-dragging={dragging === node.id ? "true" : undefined}
                style={{ transform: `translate(${point.x}px, ${point.y}px)` }} role="treeitem" aria-selected={selected} tabIndex={0}
                aria-label={`${KIND_LABEL[node.kind]}: ${node.label}, ${node.status}`} data-testid={`network-node-${node.kind}`}
                onPointerDown={(event) => onCardDown(event, node.id)} onPointerMove={onCardMove} onPointerUp={onCardUp} onPointerCancel={onCardUp}
                onClick={() => onCardClick(node.id)} onKeyDown={(event) => onKey(event, node.id)}>
                <g className="rn-card__float" style={{ animationDelay: `${(index % 7) * -0.9}s` }}>
                  <g className="rn-card__pop">
                    {node.tone === "running" ? <rect className="rn-card__halo" x={-card.width / 2 - 8} y={top - 8} width={card.width + 16} height={card.height + 16} rx={22} /> : null}
                    <rect className="rn-card__body" x={-card.width / 2} y={top} width={card.width} height={card.height} rx={16} filter="url(#rn-shadow)" />
                    {node.kind !== "connection" ? <>
                      <circle className="rn-card__dot" cx={-card.width / 2 + 18} cy={top + 18} r={5} />
                      <text className="rn-card__kind" x={-card.width / 2 + 30} y={top + 22}>{node.kind === "brand" ? "Brand" : node.status}</text>
                      {lines.map((line, row) => <text key={row} className="rn-card__title" x={-card.width / 2 + 16} y={top + 46 + row * 20}>{line}</text>)}
                    </> : <text className="rn-card__title" x={0} y={5} textAnchor="middle">{lines[0]}</text>}
                  </g>
                </g>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="rn-zoom" role="group" aria-label="Zoom">
        <button type="button" onClick={() => zoom(1.2)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoom(1 / 1.2)} aria-label="Zoom out">−</button>
        <button type="button" onClick={() => { touched.current = false; fit(); }} aria-label="Fit the network">Fit</button>
        {moved ? <button type="button" onClick={() => { touched.current = false; onTidy(); }} aria-label="Tidy the layout" title="Put every card back in its place">Tidy</button> : null}
      </div>
    </div>
  );
}
