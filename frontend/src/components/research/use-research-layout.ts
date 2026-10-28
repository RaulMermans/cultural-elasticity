"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Point } from "@/components/atlas/atlas-model";

const storageKey = (scanId: string) => `ce.network.layout.${scanId}`;

/**
 * Where the user has placed cards on this scan's board. Placement is the user's arrangement only: it never encodes
 * affinity, distance or elasticity, and it is kept in this browser.
 */
export function useResearchLayout(scanId: string) {
  const [placed, setPlaced] = useState<Record<string, Point>>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    let saved: Record<string, Point> = {};
    try {
      const value: unknown = JSON.parse(localStorage.getItem(storageKey(scanId)) ?? "{}");
      if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const [id, point] of Object.entries(value as Record<string, unknown>)) {
          const p = point as Partial<Point> | null;
          if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) saved[id] = { x: p.x!, y: p.y! };
        }
      }
    } catch { saved = {}; }
    setPlaced(saved);
    setLoadedFor(scanId);
  }, [scanId]);

  useEffect(() => {
    if (loadedFor !== scanId) return;
    try { localStorage.setItem(storageKey(scanId), JSON.stringify(placed)); } catch { /* Storage may be blocked; the layout still works on this page. */ }
  }, [loadedFor, scanId, placed]);

  const move = useCallback((ids: readonly string[], current: ReadonlyMap<string, Point>, dx: number, dy: number) => {
    setPlaced((before) => {
      const next = { ...before };
      for (const id of ids) {
        const point = current.get(id);
        if (point) next[id] = { x: Math.round(point.x + dx), y: Math.round(point.y + dy) };
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => setPlaced({}), []);

  return useMemo(() => ({
    moved: Object.keys(placed).length > 0,
    move,
    reset,
    apply: (computed: Map<string, Point>) => {
      for (const [id, point] of Object.entries(placed)) if (computed.has(id)) computed.set(id, point);
      return computed;
    },
  }), [placed, move, reset]);
}
