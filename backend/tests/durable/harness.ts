/**
 * Sprint 10C process-interruption harness (SYNTHETIC: no provider call). Starts real backend worker processes
 * (scripts/durable/worker.ts) against a disposable PostgreSQL database, kills them with real signals, restarts them,
 * and reads the database and an independent dispatch oracle (one line per Qloo attempt that reached the transport).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "../../src/brand-baseline/db.js";

const backend = fileURLToPath(new URL("../..", import.meta.url));
let nextPort = 4600 + Math.floor(Math.random() * 200);

export type Worker = {
  port: number;
  process: ChildProcess;
  output: () => string;
  waitFor: (marker: string, timeoutMs?: number) => Promise<void>;
  kill: (signal?: NodeJS.Signals) => Promise<void>;
};

export function scratch(): string {
  return mkdtempSync(join(tmpdir(), "ce-durable-"));
}

export async function startWorker(env: Record<string, string>): Promise<Worker> {
  const port = nextPort++;
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/durable/worker.ts"], {
    cwd: backend,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      NODE_ENV: "test",
      CE_DURABLE_AGENT: "1",
      CE_ACCEPT_INVESTIGATIONS: "1",
      CE_AGENT_LEASE_MS: "1500",
      QLOO_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      PORT: String(port),
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let text = "";
  child.stdout!.on("data", (chunk) => (text += String(chunk)));
  child.stderr!.on("data", (chunk) => (text += String(chunk)));
  const waitFor = async (marker: string, timeoutMs = 30_000) => {
    const started = Date.now();
    while (!text.includes(marker)) {
      if (child.exitCode !== null) throw new Error(`worker exited (${child.exitCode}) before "${marker}":\n${text.slice(-2000)}`);
      if (Date.now() - started > timeoutMs) throw new Error(`timeout waiting for "${marker}":\n${text.slice(-2000)}`);
      await sleep(50);
    }
  };
  const worker: Worker = {
    port,
    process: child,
    output: () => text,
    waitFor,
    kill: async (signal = "SIGKILL") => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill(signal);
      await exited;
    },
  };
  await waitFor("CE_WORKER_READY");
  return worker;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type Created = { jobId: string; accessToken: string; status: string };

export async function post(worker: Worker, path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${worker.port}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

export async function getJob(worker: Worker, jobId: string, token: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${worker.port}/api/agent/jobs/${jobId}`, { headers: { "x-job-token": token } });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

export async function untilJob(worker: Worker, jobId: string, token: string, done: (view: Record<string, unknown>) => boolean, timeoutMs = 30_000): Promise<Record<string, unknown>> {
  const started = Date.now();
  for (;;) {
    const view = await getJob(worker, jobId, token);
    if (view.status === 200 && done(view.body)) return view.body;
    if (Date.now() - started > timeoutMs) throw new Error(`job ${jobId} did not settle: ${JSON.stringify(view.body).slice(0, 400)}\n${worker.output().slice(-1500)}`);
    await sleep(100);
  }
}

export const finished = (view: Record<string, unknown>) => !["queued", "running"].includes(String(view.status));

export function dispatches(log: string): { pid: number; operation: string; input: unknown }[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

export async function jobRow(pool: Database, jobId: string) {
  return (await pool.query("SELECT status, attempt, lease_epoch, error_code, run_id, cancel_requested, result IS NOT NULL AS has_result FROM agent_jobs WHERE id=$1", [jobId])).rows[0] as
    | { status: string; attempt: number; lease_epoch: number; error_code: string | null; run_id: string | null; cancel_requested: boolean; has_result: boolean }
    | undefined;
}

export async function callRows(pool: Database, jobId: string) {
  return (await pool.query("SELECT op_key, provider, operation, status, attempt, dispatch_count, lease_epoch FROM agent_provider_calls WHERE job_id=$1 ORDER BY reserved_at, op_key", [jobId])).rows as {
    op_key: string;
    provider: string;
    operation: string;
    status: string;
    attempt: number;
    dispatch_count: number;
    lease_epoch: number;
  }[];
}

export async function events(pool: Database, jobId: string) {
  return (await pool.query("SELECT event_type, detail FROM agent_events WHERE job_id=$1 ORDER BY id", [jobId])).rows as { event_type: string; detail: Record<string, unknown> }[];
}

/** Research result without run-specific ids and timings, to compare an interrupted job with an uninterrupted one. */
export function researchProjection(view: Record<string, unknown>): unknown {
  const result = (view.response as { investigation?: { result?: Record<string, unknown> } } | null)?.investigation?.result;
  if (!result) return null;
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        // The synthetic world numbers correlation ids per process; provenance is checked against the journal instead.
        if (/runId|Ms$|At$|latency|timing|spans|trace|metrics|queryId|operationId|correlation|sources/iu.test(key)) continue;
        out[key] = strip(item);
      }
      return out;
    }
    return value;
  };
  return strip({ status: result.status, brand: result.brand, territories: result.territories, summary: result.summary });
}

/** A SYNTHETIC comparison question: three territories, about 30 Qloo calls in the synthetic world. */
export const COMPARE = { query: "For Saffron & Salt compare tableware, skincare and slow travel", brand: "Saffron & Salt", territories: ["Tableware", "Skincare", "Slow Travel"] };
/** A SYNTHETIC ambiguous brand: the run stops with NEEDS_INPUT. */
export const AMBIGUOUS = { query: "Could Meridian enter skincare?", brand: "Meridian", territories: ["Skincare"] };

/** Every correlation id the result cites (provenance), to check against the committed journal. */
export function resultCorrelationIds(view: Record<string, unknown>): string[] {
  const result = (view.response as { investigation?: { result?: { territories?: unknown } } } | null)?.investigation?.result;
  const out = new Set<string>();
  const walk = (value: unknown, key = ""): void => {
    if (Array.isArray(value)) return value.forEach((v) => walk(v, key));
    if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>).forEach(([k, v]) => walk(v, k));
    if (typeof value === "string" && /^correlationIds?$/u.test(key)) out.add(value);
  };
  walk(result?.territories);
  return [...out];
}

export async function journalCorrelationIds(pool: Database, jobId: string): Promise<Set<string>> {
  const rows = (await pool.query("SELECT correlation_id FROM agent_provider_calls WHERE job_id=$1 AND status='COMPLETED' AND correlation_id IS NOT NULL", [jobId])).rows as { correlation_id: string }[];
  return new Set(rows.map((r) => r.correlation_id));
}
