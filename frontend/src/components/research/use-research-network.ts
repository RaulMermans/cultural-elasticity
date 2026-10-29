"use client";

import { parseQueryResponse } from "@cultural-elasticity/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseActivity, parseJobEnvelope, publicFailure, type JobEnvelope } from "@/lib/job-envelope";
import { canRetry, followUpContext, inquiryNodeId, isPending, needsRefresh, normName, type Inquiry, type InquiryOrigin, type NetworkNode } from "@/lib/research-network";

const POLL_MS = 2000;
const storageKey = (scanId: string) => `ce.network.${scanId}`;

/** The network of one scan stays in this browser, so it can be reopened and extended later. */
function load(scanId: string): Inquiry[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey(scanId)) ?? "[]");
    if (!Array.isArray(saved)) return [];
    return saved.filter((item): item is Inquiry => typeof item?.jobId === "string" && typeof item?.token === "string" && typeof item?.parentId === "string" && typeof item?.question === "string")
      .map((item) => {
        const parsed = item.response ? parseQueryResponse(item.response) : null;
        return { ...item, response: parsed?.ok ? parsed.response : null, activity: parseActivity(item.activity) };
      });
  } catch { return []; }
}

function save(scanId: string, inquiries: Inquiry[]) {
  try { localStorage.setItem(storageKey(scanId), JSON.stringify(inquiries.slice(-60))); } catch { /* Storage may be blocked; the network still works on this page. */ }
}

async function readJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

function merge(inquiry: Inquiry, view: JobEnvelope): Inquiry {
  const parsed = view.response ? parseQueryResponse(view.response) : null;
  return { ...inquiry, status: view.status, stageLabel: view.stageLabel, response: parsed?.ok ? parsed.response : inquiry.response, activity: view.activity.length ? view.activity : inquiry.activity ?? [] };
}

export function useResearchNetwork({ scanId, brand, scanToken }: { scanId: string; brand: string; scanToken: string | null }) {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // Saving waits until this scan's stored network has been read, so opening a network never overwrites it.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    setInquiries(load(scanId));
    setLoadedFor(scanId);
  }, [scanId]);

  useEffect(() => {
    if (loadedFor === scanId) save(scanId, inquiries);
  }, [loadedFor, scanId, inquiries]);

  const update = useCallback((jobId: string, change: (inquiry: Inquiry) => Inquiry) => {
    setInquiries((current) => current.map((item) => (item.jobId === jobId ? change(item) : item)));
  }, []);

  const refresh = useCallback(async (inquiry: Inquiry) => {
    try {
      const response = await fetch(`/api/agent/jobs/${encodeURIComponent(inquiry.jobId)}`, { headers: { "x-job-token": inquiry.token }, cache: "no-store" });
      if (response.status === 404) { update(inquiry.jobId, (item) => ({ ...item, lost: true })); return; }
      const parsed = parseJobEnvelope(await readJson(response));
      if (response.ok && parsed.ok) update(inquiry.jobId, (item) => merge(item, parsed.job));
    } catch { /* A missed poll is retried on the next tick. */ }
  }, [update]);

  // The interval follows the set of pending jobs, not every status change; it reads the latest list through a ref.
  const latest = useRef(inquiries);
  latest.current = inquiries;
  const pendingKey = inquiries.filter(isPending).map((item) => item.jobId).join(",");
  useEffect(() => {
    if (!pendingKey) return;
    const timer = setInterval(() => {
      for (const inquiry of latest.current.filter(isPending)) void refresh(inquiry);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pendingKey, refresh]);

  // Jobs restored from storage may have finished, or been lost, while the page was closed.
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (restored.current === scanId || !inquiries.length) return;
    restored.current = scanId;
    // Finished answers are already kept here; only unfinished ones are asked about again.
    for (const inquiry of inquiries) if (needsRefresh(inquiry)) void refresh(inquiry);
  }, [scanId, inquiries, refresh]);

  /** Starts one job and returns its id. A retry replaces the failed inquiry in place and keeps its branch. */
  const begin = useCallback(async (url: string, body: unknown, headers: Record<string, string>, inquiry: { parentId: string; origin: InquiryOrigin; question: string }, replaces?: Inquiry): Promise<string | null> => {
    if (starting) return null;
    setStarting(true);
    setNotice(null);
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
      const payload = await readJson(response);
      const parsed = parseJobEnvelope(payload);
      if (!response.ok || !parsed.ok || !parsed.job.accessToken) {
        setNotice(response.status === 503 ? "Live investigations are paused right now." : publicFailure(response.status, payload));
        return null;
      }
      const next = merge({ jobId: parsed.job.jobId, token: parsed.job.accessToken, ...inquiry, status: parsed.job.status, stageLabel: parsed.job.stageLabel, response: null, lost: false, createdAt: replaces?.createdAt ?? Date.now() }, parsed.job);
      setInquiries((current) => {
        if (current.some((item) => item.jobId === next.jobId)) return current;
        if (!replaces) return [...current, next];
        const oldId = inquiryNodeId(replaces.jobId);
        return current.map((item) => (item.jobId === replaces.jobId ? next : item.parentId === oldId ? { ...item, parentId: inquiryNodeId(next.jobId) } : item));
      });
      return next.jobId;
    } catch {
      setNotice("The start could not be confirmed. It may have reached the research service, so it will not be sent again automatically.");
      return null;
    } finally {
      setStarting(false);
    }
  }, [starting]);

  /** Deep investigation of a baseline direction. The server rereads the scan; the browser sends identifiers only. */
  const investigateDirection = useCallback((directionId: string, directionName: string, parentId: string) => {
    if (!scanToken) { setNotice("Live investigation needs the research session that found this direction."); return Promise.resolve(null); }
    return begin("/api/research/handoff/jobs", { scanId, territoryId: directionId, idempotencyKey: crypto.randomUUID() }, { "x-baseline-token": scanToken }, { parentId, origin: "direction", question: `Investigate ${directionName}` });
  }, [begin, scanId, scanToken]);

  /**
   * Sprint 10A: open discovery from the scan's own signals (related artists, places, films, books). The server rereads the
   * scan and hands its observations to the agent as starting points; the browser sends identifiers only.
   */
  const exploreSignals = useCallback(() => {
    if (!scanToken) { setNotice("Live investigation needs the research session that found these signals."); return Promise.resolve(null); }
    return begin("/api/research/handoff/jobs", { scanId, explore: true, idempotencyKey: crypto.randomUUID() }, { "x-baseline-token": scanToken }, { parentId: "brand", origin: "explore", question: `Explore ${brand}'s cross-domain signals` });
  }, [begin, brand, scanId, scanToken]);

  /**
   * A question from the composer. From an investigation or territory it is a follow-up of that run. From a direction
   * it is a new question on that direction's branch; when the text does not name the direction, the direction is
   * sent as the caller's explicit territory. Otherwise it is a new question about the brand.
   * Asking exactly what is already answered opens that answer instead of paying for it again.
   */
  const ask = useCallback((question: string, from: NetworkNode | null, placeUnder?: string) => {
    const context = followUpContext(from);
    const direction = !context && from?.kind === "direction" ? from : null;
    // placeUnder keeps a fresh brand question on the branch it was started from (e.g. a territory found there).
    // A question asked from an opened connection branches from that connection.
    const bridge = !context && from?.kind === "bridge" ? from : null;
    const parentId = placeUnder ?? (context && from ? from.id : direction ? direction.id : bridge ? bridge.id : "brand");
    const same = latest.current.find((item) => normName(item.question) === normName(question) && !canRetry(item));
    if (same) {
      setNotice("You already asked this, so its answer is open. Use Try again on a failed one to run it again.");
      return Promise.resolve(same.jobId);
    }
    const names = direction && !normName(question).includes(normName(direction.label)) ? { territories: [direction.label] } : {};
    const body = context ? { query: question, context } : { query: question, brand, ...names };
    return begin("/api/agent/jobs", body, {}, { parentId, origin: "question", question });
  }, [begin, brand]);

  const answer = useCallback((inquiry: Inquiry, clarification: string) => {
    const response = inquiry.response;
    const body = response?.state === "NEEDS_CLARIFICATION"
      ? { clarifyQueryId: response.queryId, clarification }
      : response?.investigation ? { continueRunId: response.investigation.runId, clarification } : null;
    if (!body) return Promise.resolve(null);
    return begin("/api/agent/jobs", body, {}, { parentId: `inq:${inquiry.jobId}`, origin: "question", question: clarification });
  }, [begin]);

  /**
   * Starts a failed or lost investigation again, from the same place in the network: a direction is reinvestigated
   * through the server handoff; a question is asked again from its parent (its run context, or the brand).
   */
  const retry = useCallback((inquiry: Inquiry, target: { directionId: string } | { from: NetworkNode | null }) => {
    const spec = { parentId: inquiry.parentId, origin: inquiry.origin, question: inquiry.question };
    if ("directionId" in target) {
      if (!scanToken) { setNotice("Live investigation needs the research session that found this direction."); return Promise.resolve(null); }
      return begin("/api/research/handoff/jobs", { scanId, territoryId: target.directionId, idempotencyKey: crypto.randomUUID() }, { "x-baseline-token": scanToken }, spec, inquiry);
    }
    // An exploration is started again through the same handoff, so it keeps the scan's signals.
    if (inquiry.origin === "explore") {
      if (!scanToken) { setNotice("Live investigation needs the research session that found these signals."); return Promise.resolve(null); }
      return begin("/api/research/handoff/jobs", { scanId, explore: true, idempotencyKey: crypto.randomUUID() }, { "x-baseline-token": scanToken }, spec, inquiry);
    }
    const context = followUpContext(target.from);
    const body = context ? { query: inquiry.question, context } : { query: inquiry.question, brand };
    return begin("/api/agent/jobs", body, {}, { ...spec, parentId: context && target.from ? target.from.id : "brand" }, inquiry);
  }, [begin, brand, scanId, scanToken]);

  const forget = useCallback((jobId: string) => setInquiries((current) => current.filter((item) => item.jobId !== jobId)), []);
  /** Removes inquiries from this browser's network. It never touches the server, and spend already made stays spent. */
  const forgetMany = useCallback((jobIds: readonly string[]) => {
    const gone = new Set(jobIds);
    setInquiries((current) => current.filter((item) => !gone.has(item.jobId)));
  }, []);

  const saveNow = useCallback(() => { if (loadedFor === scanId) save(scanId, latest.current); }, [loadedFor, scanId]);

  return { inquiries, notice, starting, investigateDirection, exploreSignals, ask, answer, retry, forget, forgetMany, saveNow, clearNotice: () => setNotice(null) };
}
