"use client";

import { parseQueryResponse, type QueryResponse } from "@cultural-elasticity/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { parseJobEnvelope, publicFailure, type JobEnvelope } from "@/lib/job-envelope";
import { buildAtlas, layoutAtlas, type AtlasDraft } from "./atlas-model";

const STORAGE_KEY = "ce.atlas.handles";

type Handle = { jobId: string; token: string };

export type JobProgress = {
  jobId: string;
  token: string;
  status: string;
  stageLabel: string;
  stopping: boolean;
};

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function envelope(value: unknown): JobEnvelope | null {
  const parsed = parseJobEnvelope(value);
  return parsed.ok ? parsed.job : null;
}

function loadHandles(): Handle[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Handle => typeof item === "object" && item !== null && typeof (item as Handle).jobId === "string" && typeof (item as Handle).token === "string").slice(-12);
  } catch {
    return [];
  }
}

function saveHandles(handles: Handle[]) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(handles.slice(-12)));
}

export function useAtlas() {
  const [responses, setResponses] = useState<QueryResponse[]>([]);
  const [jobs, setJobs] = useState<JobProgress[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<string | null>(null);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [focusRequest, setFocusRequest] = useState<{ runId: string; territoryKey: string | null; queryId: string } | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [ready, setReady] = useState(false);

  const remember = useCallback((handle: Handle) => {
    const handles = [...loadHandles().filter((item) => item.jobId !== handle.jobId), handle];
    saveHandles(handles);
  }, []);

  const accept = useCallback((view: JobEnvelope) => {
    setJobs((current) => current.map((job) => (job.jobId === view.jobId ? { ...job, status: view.status, stageLabel: view.stageLabel, stopping: view.stopping } : job)));
    if (view.response) {
      const parsed = parseQueryResponse(view.response);
      if (!parsed.ok) {
        setNotice("The investigation returned something this atlas cannot show.");
        return;
      }
      setResponses((current) => {
        const index = current.findIndex((item) => item.queryId === parsed.response.queryId);
        const next = index < 0 ? [...current, parsed.response] : current.slice();
        if (index >= 0) next[index] = parsed.response;
        return next;
      });
      if (parsed.response.state === "RETURNED_TO_INVESTIGATION" && parsed.response.investigation) {
        setFocusRequest({
          runId: parsed.response.investigation.runId,
          territoryKey: parsed.response.interpretation?.references.selectedTerritoryKey ?? null,
          queryId: parsed.response.queryId,
        });
      }
    }
    if (view.status === "expired") setRecovery("This investigation is no longer held. You can start a new one.");
    if (view.status === "failed" && view.error) setNotice(view.error.message);
    if (view.status === "cancelled") setNotice("The investigation was stopped. Partial observations were not kept as findings.");
  }, []);

  const refresh = useCallback(async (handle: Handle) => {
    const response = await fetch(`/api/agent/jobs/${handle.jobId}`, { headers: { "x-job-token": handle.token }, cache: "no-store" });
    const body = await readJson(response);
    if (response.status === 404) {
      setRecovery("This investigation cannot be resumed. The server no longer has it. You can start a new one.");
      saveHandles(loadHandles().filter((item) => item.jobId !== handle.jobId));
      setJobs((current) => current.filter((job) => job.jobId !== handle.jobId));
      return;
    }
    const view = envelope(body);
    if (!response.ok || !view) {
      setNotice(publicFailure(response.status, body));
      return;
    }
    accept(view);
  }, [accept]);

  useEffect(() => {
    const handles = loadHandles();
    setJobs(handles.map((handle) => ({ ...handle, status: "running", stageLabel: "Checking the investigation", stopping: false })));
    setReady(true);
    for (const handle of handles) void refresh(handle);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const width = window.matchMedia("(max-width: 720px)");
    const sync = () => {
      setReducedMotion(motion.matches);
      setNarrow(width.matches);
    };
    sync();
    motion.addEventListener("change", sync);
    width.addEventListener("change", sync);
    return () => {
      motion.removeEventListener("change", sync);
      width.removeEventListener("change", sync);
    };
  }, [refresh]);

  useEffect(() => {
    const pending = jobs.filter((job) => job.status === "queued" || job.status === "running");
    if (pending.length === 0) return;
    const timer = setInterval(() => {
      for (const job of pending) void refresh(job);
    }, 1500);
    return () => clearInterval(timer);
  }, [jobs, refresh]);

  const submit = useCallback(async (body: unknown) => {
    setNotice(null);
    setRecovery(null);
    const response = await fetch("/api/agent/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await readJson(response);
    const view = envelope(payload);
    if (!response.ok || !view?.accessToken) {
      setNotice(publicFailure(response.status, payload));
      return;
    }
    const handle = { jobId: view.jobId, token: view.accessToken };
    remember(handle);
    setJobs((current) => [...current, { ...handle, status: view.status, stageLabel: view.stageLabel, stopping: view.stopping }]);
    accept(view);
  }, [accept, remember]);

  const cancel = useCallback(async (job: JobProgress) => {
    const response = await fetch(`/api/agent/jobs/${job.jobId}/cancel`, { method: "POST", headers: { "x-job-token": job.token } });
    const view = envelope(await readJson(response));
    if (!view) {
      setNotice("The investigation could not be stopped.");
      return;
    }
    accept(view);
  }, [accept]);

  const drafts = useMemo(() => buildAtlas(responses), [responses]);
  useEffect(() => {
    setPositions((current) => layoutAtlas(drafts, current));
  }, [drafts]);
  useEffect(() => {
    if (!focusRequest) return;
    const match = drafts.find((node) => node.runId === focusRequest.runId && focusRequest.territoryKey && node.territoryKey === focusRequest.territoryKey)
      ?? drafts.find((node) => node.runId === focusRequest.runId && node.kind === "territory")
      ?? drafts.find((node) => node.runId === focusRequest.runId);
    if (!match) return;
    setSelectedId(match.id);
    setFocusRequest(null);
  }, [focusRequest, drafts]);

  const nodes = drafts.map((draft) => ({ ...draft, ...(positions.get(draft.id) ?? { x: 48, y: 48 }) }));
  const selected = nodes.find((node) => node.id === selectedId) ?? null;
  const active = [...jobs].reverse().find((job) => job.status === "queued" || job.status === "running") ?? null;
  const latest = responses.at(-1) ?? null;

  return {
    ready,
    nodes,
    selected,
    select: (id: string | null) => {
      setSelectedId(id);
      setInspectorOpen(false);
    },
    inspectorOpen,
    openInspector: () => setInspectorOpen(true),
    closeInspector: () => setInspectorOpen(false),
    compareIds,
    toggleCompare: (id: string) => setCompareIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : current.length >= 6 ? current : [...current, id])),
    clearCompare: () => setCompareIds([]),
    responses,
    latest,
    active,
    jobs,
    notice,
    recovery,
    clearNotice: () => setNotice(null),
    fail: (message: string) => setNotice(message),
    dismissRecovery: () => {
      setRecovery(null);
      setResponses([]);
      setJobs([]);
      setSelectedId(null);
      saveHandles([]);
    },
    reducedMotion,
    narrow,
    submit,
    cancel,
    focusRun: (runId: string, territoryKey: string | null) => setFocusRequest({ runId, territoryKey, queryId: `focus:${runId}:${territoryKey ?? ""}` }),
    showRecorded: (incoming: QueryResponse[]) => {
      setNotice(null);
      setRecovery(null);
      setCompareIds([]);
      setInspectorOpen(false);
      setResponses(incoming);
      const first = incoming.find((item) => item.investigation && !item.investigation.reused) ?? incoming[0];
      const territory = first?.territories.find((item) => item.investigationState === "INVESTIGATED");
      if (first?.investigation?.runId) {
        setFocusRequest({ runId: first.investigation.runId, territoryKey: territory?.territoryKey ?? null, queryId: first.queryId });
      }
    },
    responseFor: (draft: AtlasDraft | null) => responses.find((item) => item.queryId === draft?.queryId) ?? null,
  };
}
