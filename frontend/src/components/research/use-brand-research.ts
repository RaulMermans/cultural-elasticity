"use client";

import { isBrandBaselineResult, type AnyBrandBaselineResult } from "@cultural-elasticity/shared";
import { useCallback, useEffect, useState } from "react";
import { RESOLUTION_COPY, TERMINAL_SCAN_STATUSES, apiErrorCopy, type BrandResearchAvailability } from "@/lib/research-copy";

export type Candidate = { qlooId: string; label: string; type?: string };
export type Resolution = { resolutionId: string; accessToken: string; status: string; entity?: { qlooId: string; label: string }; candidates?: Candidate[] };
export type LiveScan = { scanId: string; scanStatus: string; stages: { stage: string; status: string }[]; result: AnyBrandBaselineResult | null };

/** The scan pointer and its access token stay in this tab's session storage. They are never put in a URL. */
const POINTER_KEY = "ce-baseline-current";
const POLL_MS = 2500;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
async function json(response: Response): Promise<Record<string, unknown> | null> {
  try { return record(await response.json()); } catch { return null; }
}
function readPointer(): { scanId: string; token: string } | null {
  try {
    const saved = record(JSON.parse(sessionStorage.getItem(POINTER_KEY) ?? "null"));
    return typeof saved?.scanId === "string" && typeof saved?.token === "string" ? { scanId: saved.scanId, token: saved.token } : null;
  } catch { return null; }
}

/**
 * Live brand research: availability, brand resolution and one scan. Nothing here runs on page load except the
 * free availability check and, if this tab already started a scan, reading that stored scan back.
 */
export function useBrandResearch() {
  const [availability, setAvailability] = useState<BrandResearchAvailability>("checking");
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [pointer, setPointer] = useState<{ scanId: string; token: string } | null>(null);
  const [scan, setScan] = useState<LiveScan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/brands/status", { cache: "no-store" }).then(async (response) => {
      const body = await json(response);
      if (active) setAvailability(response.ok && body ? body.enabled === true ? "available" : "paused" : "unavailable");
    }).catch(() => { if (active) setAvailability("unavailable"); });
    setPointer(readPointer());
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!pointer) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/brands/baselines/${pointer.scanId}`, { headers: { "x-baseline-token": pointer.token }, cache: "no-store" });
        const body = await json(response);
        if (!active) return;
        if (!response.ok || !body) { setError(apiErrorCopy(body?.error)); return; }
        const status = typeof body.scanStatus === "string" ? body.scanStatus : "RUNNING";
        const stages = Array.isArray(body.stages) ? body.stages.filter((stage): stage is { stage: string; status: string } => typeof stage?.stage === "string" && typeof stage?.status === "string") : [];
        const result = isBrandBaselineResult(body.result) ? body.result : null;
        setError("");
        setScan({ scanId: pointer.scanId, scanStatus: status, stages, result });
        // Stop reading once the scan has finished: a finished result does not change.
        if (!TERMINAL_SCAN_STATUSES.has(status)) timer = setTimeout(() => { void poll(); }, POLL_MS);
      } catch {
        if (active) setError("The research service can't be reached right now. Your research stays stored; try again later.");
      }
    };
    void poll();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [pointer]);

  const resolve = useCallback(async (name: string, selectedQlooId?: string) => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/brands/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, ...(selectedQlooId ? { selectedQlooId } : {}) }) });
      const body = await json(response);
      if (!response.ok && body?.status !== "TEMPORARILY_UNAVAILABLE") { setError(apiErrorCopy(body?.error)); setResolution(null); return; }
      if (!body || typeof body.status !== "string" || typeof body.resolutionId !== "string" || typeof body.accessToken !== "string") { setError(apiErrorCopy(null)); return; }
      setResolution(body as Resolution);
      if (RESOLUTION_COPY[body.status] && body.status !== "AMBIGUOUS") setError(RESOLUTION_COPY[body.status]!);
    } catch { setError("The research service can't be reached right now. Please try again later."); }
    finally { setBusy(false); }
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (!resolution || resolution.status !== "RESOLVED") return false;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/brands/baselines", { method: "POST", headers: { "content-type": "application/json", "x-baseline-token": resolution.accessToken }, body: JSON.stringify({ resolutionId: resolution.resolutionId, idempotencyKey: crypto.randomUUID() }) });
      const body = await json(response);
      if (!response.ok || !body || typeof body.scanId !== "string" || typeof body.scanStatus !== "string") { setError(apiErrorCopy(body?.error)); return false; }
      const next = { scanId: body.scanId, token: resolution.accessToken };
      try { sessionStorage.setItem(POINTER_KEY, JSON.stringify(next)); } catch { /* Storage may be blocked; the scan still runs for this page. */ }
      setScan({ scanId: body.scanId, scanStatus: body.scanStatus, stages: [], result: null });
      setPointer(next);
      setResolution(null);
      return true;
    } catch { setError("The research service can't be reached right now. Please try again later."); return false; }
    finally { setBusy(false); }
  }, [resolution]);

  const clearResolution = useCallback(() => { setResolution(null); setError(""); }, []);

  return { availability, resolution, scan, scanToken: pointer?.token ?? null, hasSessionScan: Boolean(pointer), busy, error, resolve, start, clearResolution };
}
