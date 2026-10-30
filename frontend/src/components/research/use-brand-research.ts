"use client";

import { isBrandBaselineResult, type AnyBrandBaselineResult } from "@cultural-elasticity/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { RESOLUTION_COPY, TERMINAL_SCAN_STATUSES, apiErrorCopy, availabilityFromStatus, parseResearchEligibility, type BrandResearchAvailability, type ResearchEligibility } from "@/lib/research-copy";

/** `popularity` and `description` are Qloo's own resolution detail (Sprint 10D): shown to help the choice, never used to make it. */
export type Candidate = { qlooId: string; label: string; type?: string; popularity?: number; description?: string };
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

/** Every scan started in this browser, so earlier research can be reopened and extended. Never put in a URL. */
const LIBRARY_KEY = "ce-research-library";
export type LibraryEntry = { scanId: string; token: string; brand: string; startedAt: number };

function readLibrary(): LibraryEntry[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((item): item is LibraryEntry => typeof item?.scanId === "string" && typeof item?.token === "string" && typeof item?.brand === "string" && typeof item?.startedAt === "number") : [];
  } catch { return []; }
}

function writeLibrary(entries: LibraryEntry[]) {
  try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(entries.slice(-40))); } catch { /* Storage may be blocked; the library is a convenience. */ }
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
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const lookupVersion = useRef(0);
  const startKey = useRef<string | null>(null);
  const starting = useRef(false);

  const [eligibility, setEligibility] = useState<ResearchEligibility | null>(null);
  const statusVersion = useRef(0);

  /** A free read of what this caller can start; repeated after each paid start or refusal so the page stays honest. */
  const refreshStatus = useCallback(async () => {
    const version = ++statusVersion.current;
    try {
      const response = await fetch("/api/brands/status", { cache: "no-store" });
      const body = await json(response);
      if (version !== statusVersion.current) return;
      setAvailability(availabilityFromStatus(body, response.ok));
      setEligibility(response.ok ? parseResearchEligibility(body?.research) : null);
    } catch { if (version === statusVersion.current) { setAvailability("unavailable"); setEligibility(null); } }
  }, []);

  useEffect(() => {
    void refreshStatus();
    setPointer(readPointer());
    setLibrary(readLibrary());
    return () => { statusVersion.current++; };
  }, [refreshStatus]);

  useEffect(() => {
    if (!pointer) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/brands/baselines/${pointer.scanId}`, { headers: { "x-baseline-token": pointer.token }, cache: "no-store" });
        const body = await json(response);
        if (!active) return;
        if (!response.ok || !body) { setError(response.status === 404 ? "This scan could not be reopened. Its access may have expired; start a new scan." : apiErrorCopy(body?.error)); return; }
        const status = typeof body.scanStatus === "string" ? body.scanStatus : "RUNNING";
        const stages = Array.isArray(body.stages) ? body.stages.filter((stage): stage is { stage: string; status: string } => typeof stage?.stage === "string" && typeof stage?.status === "string") : [];
        const result = isBrandBaselineResult(body.result) ? body.result : null;
        setError("");
        setScan({ scanId: pointer.scanId, scanStatus: status, stages, result });
        // Stop reading once the scan has finished: a finished result does not change.
        if (!TERMINAL_SCAN_STATUSES.has(status)) timer = setTimeout(() => { void poll(); }, POLL_MS);
      } catch {
        if (active) setError("The research service can't be reached right now. The scan may still be running; return later to check its status.");
      }
    };
    void poll();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [pointer]);

  const resolve = useCallback(async (name: string, selectedQlooId?: string) => {
    const version = ++lookupVersion.current;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/brands/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, ...(selectedQlooId ? { selectedQlooId } : {}) }) });
      const body = await json(response);
      if (version !== lookupVersion.current) return;
      void refreshStatus();
      if (!response.ok && body?.status !== "TEMPORARILY_UNAVAILABLE") { setError(apiErrorCopy(body?.error)); setResolution(null); return; }
      if (!body || typeof body.status !== "string" || typeof body.resolutionId !== "string" || typeof body.accessToken !== "string") { setError(apiErrorCopy(null)); return; }
      setResolution(body as Resolution);
      if (RESOLUTION_COPY[body.status] && body.status !== "AMBIGUOUS") setError(RESOLUTION_COPY[body.status]!);
    } catch { if (version === lookupVersion.current) setError("The research service can't be reached right now. Please try again later."); }
    finally { if (version === lookupVersion.current) setBusy(false); }
  }, [refreshStatus]);

  const start = useCallback(async (): Promise<boolean> => {
    if (!resolution || resolution.status !== "RESOLVED" || starting.current) return false;
    starting.current = true;
    startKey.current ??= crypto.randomUUID();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/brands/baselines", { method: "POST", headers: { "content-type": "application/json", "x-baseline-token": resolution.accessToken }, body: JSON.stringify({ resolutionId: resolution.resolutionId, idempotencyKey: startKey.current }) });
      const body = await json(response);
      void refreshStatus();
      if (!response.ok || !body || typeof body.scanId !== "string" || typeof body.scanStatus !== "string") { setError(apiErrorCopy(body?.error)); return false; }
      const next = { scanId: body.scanId, token: resolution.accessToken };
      try { sessionStorage.setItem(POINTER_KEY, JSON.stringify(next)); } catch { /* Storage may be blocked; the scan still runs for this page. */ }
      setScan({ scanId: body.scanId, scanStatus: body.scanStatus, stages: [], result: null });
      setPointer(next);
      const entries = [...readLibrary().filter((item) => item.scanId !== next.scanId), { ...next, brand: resolution.entity?.label ?? "Brand research", startedAt: Date.now() }];
      writeLibrary(entries);
      setLibrary(entries);
      setResolution(null);
      startKey.current = null;
      return true;
    } catch { setError("The start request could not be confirmed. Check the current scan before starting again; the provider may already have received it."); return false; }
    finally { starting.current = false; setBusy(false); }
  }, [resolution, refreshStatus]);

  const clearResolution = useCallback(() => { lookupVersion.current++; startKey.current = null; setResolution(null); setBusy(false); setError(""); }, []);

  const openScan = useCallback((entry: LibraryEntry) => {
    const next = { scanId: entry.scanId, token: entry.token };
    try { sessionStorage.setItem(POINTER_KEY, JSON.stringify(next)); } catch { /* The scan still opens for this page. */ }
    setError("");
    setScan(null);
    setPointer(next);
  }, []);

  return { availability, eligibility, refreshStatus, resolution, scan, scanToken: pointer?.token ?? null, hasSessionScan: Boolean(pointer), busy, error, library, resolve, start, clearResolution, openScan };
}
