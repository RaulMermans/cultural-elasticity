/**
 * Sprint 10C genuine live research acceptance (REAL Qloo + Claude Haiku 5.5). Owner approval required.
 *
 *   pnpm durable:live -- --plan
 *       prints the pre-registered assignments and the worst-case reservation; no process, no provider call
 *   pnpm durable:live -- --approved-qloo <N> --approved-usd <USD> --env-file <file> --database-url <local url>
 *       runs them on a LOCAL durable worker against an isolated local database
 *
 * Isolation: one local worker process (127.0.0.1, NODE_ENV=development), its own database, its own run ledger keyed
 * by a session credential that is kept in the session directory, so a restart continues the same Qloo and model
 * ceilings instead of granting new ones. No production service, quota or migration is touched. Only QLOO_API_KEY and
 * ANTHROPIC_API_KEY are read from the env file; neither is printed or written.
 *
 * Assignment L4 is the recovery demonstration: the worker stops right after its second committed turn checkpoint
 * (no provider call in flight), is killed with SIGKILL, and a fresh worker resumes it from the journal.
 * Results stay in the session directory: raw results (for `pnpm eval:competence -- --audit <dir>`), run manifests and
 * a summary. A failed run is preserved as it happened.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBaselinePool, migrate } from "../../src/brand-baseline/db.js";
import { DurableAgentStore } from "../../src/agent/durable/store.js";
import { buildRunManifest } from "../../src/agent/durable/manifest.js";
import { DEFAULT_QLOO_CALLS } from "../../src/agent/contracts.js";
import { conservativeReserveUsd } from "../../src/ops/pricing.js";
import { PAID_OPERATOR_HEADER } from "../../src/config/production.js";

/** Pre-registered 2026-10-30 before any live result. None is a benchmark, holdout or fixture brand. */
export const ASSIGNMENTS = [
  { id: "L1", kind: "open_discovery", intent: "explore_frontier" as const, query: "What unexpected cultural territories could Fjällräven credibly stretch into?", interrupt: false },
  { id: "L2", kind: "targeted", intent: "analyze_move" as const, query: "Is specialty coffee culture a defensible extension for Bodum?", interrupt: false },
  { id: "L3", kind: "comparative", intent: "compare_territories" as const, query: "For Diptyque, compare boutique hotels, ceramics and jazz as cultural territories.", interrupt: false },
  { id: "L4", kind: "recovery_demonstration", intent: "analyze_move" as const, query: "Could Dyson credibly move into wellness retreats?", interrupt: true },
];

/**
 * Sprint 12 measurement and research-completion set (pre-registered 2026-10-30, before any Sprint 12 live result).
 * Development diagnostics named by the sprint brief, not holdouts. Selected with `--set s12`.
 * Expected readings are written down in docs/sprint-12/MEASUREMENT_AND_RESEARCH_COMPLETION.md §10 before the run.
 */
export const SPRINT12_ASSIGNMENTS = [
  { id: "S1", kind: "established_candidate", intent: "analyze_move" as const, query: "How well does circular economy fit Vinted as a cultural territory?", interrupt: false },
  { id: "S2", kind: "compound", intent: "analyze_move" as const, query: "Could Vinted credibly move into clothing repair and creative upcycling?", interrupt: false },
  { id: "S3", kind: "weak_or_unsupported", intent: "analyze_move" as const, query: "Could Vinted credibly move into space tourism?", interrupt: false },
  { id: "S4", kind: "brand_core", intent: "analyze_move" as const, query: "Is online marketplace culture a good territory for Vinted?", interrupt: false },
  { id: "S5", kind: "adjacent_candidate", intent: "analyze_move" as const, query: "Could Diptyque credibly move into ceramics?", interrupt: false },
  { id: "S6", kind: "adjacent_candidate", intent: "analyze_move" as const, query: "Could Dyson credibly move into wellness retreats?", interrupt: false },
];

const backend = fileURLToPath(new URL("../..", import.meta.url));
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/**
 * Worst case of the SELECTED assignments (Sprint 10D: `--only` used to be ignored here). Runs are sequential and a
 * settled run returns its unused model reservation, so at most one reservation is open at a time, plus the
 * interrupted run's, which is never returned. `modelReservedIfNoneSettlesUsd` is the bound if no release landed.
 */
export function worstCase(selected: readonly { intent: keyof typeof DEFAULT_QLOO_CALLS; interrupt: boolean }[] = ASSIGNMENTS) {
  const reserveUsd = conservativeReserveUsd({});
  const qloo = selected.reduce((n, a) => n + DEFAULT_QLOO_CALLS[a.intent], 0);
  const interrupted = selected.filter((a) => a.interrupt).length;
  return {
    runs: selected.length,
    qloo,
    // One operator-authorized re-dispatch per interrupted run is the only way a call is ever sent twice.
    qlooWithAuthorizedRedispatch: qloo + interrupted,
    modelReservePerRunUsd: reserveUsd,
    modelMinimumApprovalUsd: Math.round(reserveUsd * (interrupted + (selected.length > interrupted ? 1 : 0)) * 100) / 100,
    modelReservedIfNoneSettlesUsd: Math.round(reserveUsd * selected.length * 100) / 100,
  };
}

/**
 * `retry` (Sprint 10D) adds one more attempt of an assignment, right after it, as `<id>#retry`. It is for an attempt
 * lost to an infrastructure failure; both attempts stay in the record.
 */
export function selectAssignments(only: readonly string[] | undefined, retry: readonly string[] = [], set: string | undefined = undefined) {
  return (set === "s12" ? SPRINT12_ASSIGNMENTS : ASSIGNMENTS).filter((a) => !only || only.includes(a.id)).flatMap((a) => (retry.includes(a.id) ? [a, { ...a, id: `${a.id}#retry` }] : [a]));
}

function readKeys(file: string): { QLOO_API_KEY: string; ANTHROPIC_API_KEY: string } {
  const text = readFileSync(file, "utf8");
  const pick = (name: string) => text.split("\n").find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1).trim().replace(/^["']|["']$/gu, "") ?? "";
  return { QLOO_API_KEY: pick("QLOO_API_KEY"), ANTHROPIC_API_KEY: pick("ANTHROPIC_API_KEY") };
}

async function main(): Promise<number> {
  const only = arg("--only")?.split(",");
  const selected = selectAssignments(only, arg("--retry")?.split(","), arg("--set"));
  if (selected.length === 0) {
    console.error("NO_ASSIGNMENT_SELECTED");
    return 2;
  }
  const plan = worstCase(selected);
  if (process.argv.includes("--plan")) {
    console.log(JSON.stringify({ assignments: selected, worstCase: plan, model: "claude-haiku-5-5 (production default)" }, null, 2));
    return 0;
  }
  // Sprint 10D: --rehearse runs the identical harness on the SYNTHETIC worker (no key read, no provider call).
  const rehearse = process.argv.includes("--rehearse");
  const approvedQloo = Number(arg("--approved-qloo"));
  const approvedUsd = Number(arg("--approved-usd"));
  const envFile = arg("--env-file");
  const databaseUrl = arg("--database-url");
  if (!Number.isInteger(approvedQloo) || approvedQloo <= 0 || !Number.isFinite(approvedUsd) || approvedUsd <= 0 || (!envFile && !rehearse) || !databaseUrl) {
    console.error("usage: --approved-qloo <N> --approved-usd <USD> (--env-file <file> | --rehearse) --database-url <local postgres url> [--session <dir>] [--only L1,L4] [--new-allowance]");
    return 2;
  }
  if (!/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost)(:\d+)?\//u.test(databaseUrl)) {
    console.error("LIVE_DATABASE_NOT_LOCAL: the live acceptance only runs against a local, isolated database");
    return 2;
  }
  // A resumed session is checked against its ledger once the database is open (below).
  const resuming = Boolean(arg("--session") && existsSync(join(arg("--session")!, "summary.json")));
  if (!resuming && approvedQloo < plan.qlooWithAuthorizedRedispatch) {
    console.error(`APPROVAL_TOO_SMALL: the worst case is ${plan.qlooWithAuthorizedRedispatch} Qloo calls; reduce --only or raise the approval`);
    return 4;
  }
  if (approvedUsd < plan.modelMinimumApprovalUsd) {
    console.error(`APPROVAL_TOO_SMALL: the model reservations need at least $${plan.modelMinimumApprovalUsd.toFixed(2)}`);
    return 4;
  }
  const keys = rehearse ? { QLOO_API_KEY: "", ANTHROPIC_API_KEY: "" } : readKeys(envFile!);
  if (!rehearse && (!keys.QLOO_API_KEY || !keys.ANTHROPIC_API_KEY)) {
    console.error("LIVE_KEYS_MISSING: QLOO_API_KEY and ANTHROPIC_API_KEY must be in the env file (LIVE_QLOO_VALIDATION_NOT_RUN)");
    return 2;
  }
  const session = arg("--session") ?? join(backend, "feasibility-output", rehearse ? "durable-rehearsal" : "durable-live", new Date().toISOString().replace(/[:.]/gu, "-"));
  mkdirSync(session, { recursive: true });
  const credentialFile = join(session, ".session-credential");
  if (!existsSync(credentialFile)) writeFileSync(credentialFile, randomBytes(32).toString("hex"), { mode: 0o600 });
  const credential = readFileSync(credentialFile, "utf8").trim();

  const pool = createBaselinePool(databaseUrl);
  await migrate(pool);
  // Sprint 10D: a new session on a database that already carries another session's run ledger would grant a fresh
  // allowance. Resume with --session <dir>, or pass --new-allowance when the owner approved a separate one.
  const ledgerKey = `run:${createHash("sha256").update(credential).digest("hex").slice(0, 32)}:`;
  const others = await pool.query<{ n: string }>("SELECT count(*) AS n FROM baseline_budget_accounts WHERE budget_key LIKE 'run:%' AND budget_key NOT LIKE $1", [`${ledgerKey}%`]);
  if (Number(others.rows[0]?.n ?? 0) > 0 && !process.argv.includes("--new-allowance")) {
    await pool.end();
    console.error("ALLOWANCE_ALREADY_OPEN: this database holds another session's ledger; resume it with --session <dir> or pass --new-allowance");
    return 4;
  }
  const store = new DurableAgentStore(pool);
  const port = 4320;
  const env = (fault?: string): NodeJS.ProcessEnv => ({
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    NODE_ENV: "development",
    CE_PUBLIC_DEPLOYMENT: "0",
    CE_DURABLE_AGENT: "1",
    CE_DURABLE_PROVIDER: rehearse ? "synthetic" : "live",
    CE_AGENT_LEASE_MS: "5000",
    DATABASE_URL: databaseUrl,
    CE_ACCEPT_INVESTIGATIONS: "1",
    CE_PAID_OPERATOR_TOKEN: credential,
    CE_PROCESS_QLOO_CALL_LIMIT: String(approvedQloo),
    CE_SPEND_BUDGET_USD: approvedUsd.toFixed(2),
    ...(rehearse ? {} : { QLOO_API_BASE_URL: "https://hackathon.api.qloo.com", QLOO_API_KEY: keys.QLOO_API_KEY, ANTHROPIC_API_KEY: keys.ANTHROPIC_API_KEY }),
    PORT: String(port),
    ...(fault ? { CE_DURABLE_FAULT_INJECTION: "1", CE_DURABLE_FAULT: fault } : {}),
  });
  let child: ChildProcess | null = null;
  let output = "";
  const start = async (fault?: string) => {
    output = "";
    child = spawn(process.execPath, ["--import", "tsx", "scripts/durable/worker.ts"], { cwd: backend, env: env(fault), stdio: ["ignore", "pipe", "pipe"] });
    child.stdout!.on("data", (c) => (output += String(c)));
    child.stderr!.on("data", (c) => (output += String(c)));
    await waitFor(() => output.includes("CE_WORKER_READY"), 60_000, "worker ready");
  };
  const kill = async (signal: NodeJS.Signals) => {
    const c = child as ChildProcess | null;
    if (!c || c.exitCode !== null) return;
    const exited = new Promise<void>((resolve) => c.once("exit", () => resolve()));
    c.kill(signal);
    await exited;
  };
  const previous = existsSync(join(session, "summary.json")) ? (JSON.parse(readFileSync(join(session, "summary.json"), "utf8")) as { runs: Record<string, unknown>[] }).runs : [];
  const summary: Record<string, unknown>[] = previous.filter((r) => r.jobId);
  // A resumed session is bounded by what the ledger already used plus the worst case of every run not yet finished.
  const usedQloo = Number((await ledgerRowsOf(pool, ledgerKey)).find((r) => r.counter === "qloo_calls")?.used ?? 0);
  const remainingPlan = worstCase(selected.filter((a) => !summary.some((r) => r.id === a.id && r.status !== "running")));
  if (usedQloo + remainingPlan.qlooWithAuthorizedRedispatch > approvedQloo) {
    await pool.end();
    console.error(`APPROVAL_TOO_SMALL: ${usedQloo} Qloo calls already used + worst case ${remainingPlan.qlooWithAuthorizedRedispatch} exceeds ${approvedQloo}`);
    return 4;
  }
  const ledgerRows = () => ledgerRowsOf(pool, ledgerKey);
  // Written after every run (Sprint 10D), so a harness crash keeps everything that already happened.
  const persist = async () => {
    writeFileSync(join(session, "summary.json"), `${JSON.stringify({ approvedQloo, approvedUsd, worstCase: plan, runs: summary }, null, 2)}\n`);
    writeFileSync(join(session, "ledger.json"), `${JSON.stringify(await ledgerRows(), null, 2)}\n`);
  };
  const tokensFile = join(session, ".job-tokens.json");
  const tokens: Record<string, string> = existsSync(tokensFile) ? (JSON.parse(readFileSync(tokensFile, "utf8")) as Record<string, string>) : {};
  const finished = new Set(summary.filter((r) => r.status !== "running").map((r) => String(r.id)));
  // Sprint 10D: an admitted job that a previous harness never saw finish is ADOPTED, never resubmitted. A worker's
  // startup recovery resumes it from the journal; the harness only waits for it.
  const active = (await pool.query<{ id: string; query: string }>("SELECT id, request->'body'->>'query' AS query FROM agent_jobs WHERE status IN ('QUEUED','RUNNING','RECOVERING')")).rows;
  const adoptable = new Map(active.flatMap((row) => {
    const a = selected.find((item) => item.query === row.query && !item.id.endsWith("#retry"));
    return a ? [[a.id, row.id] as const] : [];
  }));
  try {
    for (const a of selected) {
      // A resumed session never repeats an admitted assignment (failed or not); one refused at admission sent nothing.
      if (finished.has(a.id)) continue;
      // A retry runs only when the original attempt ended without a completed investigation.
      if (a.id.endsWith("#retry") && summary.find((r) => r.id === a.id.replace(/#retry$/u, ""))?.status === "completed") {
        summary.push({ id: a.id, status: "skipped", reason: "ORIGINAL_COMPLETED" });
        await persist();
        continue;
      }
      const startedAt = Date.now();
      let jobId: string | undefined = adoptable.get(a.id) ?? (summary.find((r) => r.id === a.id)?.jobId as string | undefined);
      let interruption: Record<string, unknown> | null = null;
      const recovery = { adopted: Boolean(jobId), unplannedWorkerRestarts: 0 };
      try {
        if (jobId) {
          await start();
        } else {
          await start(a.interrupt ? "checkpoint.turn.after:2" : undefined);
          const created = await fetch(`http://127.0.0.1:${port}/api/agent/jobs`, {
            method: "POST",
            headers: { "content-type": "application/json", [PAID_OPERATOR_HEADER]: credential },
            body: JSON.stringify({ query: a.query }),
          });
          const job = (await created.json()) as { jobId?: string; accessToken?: string; error?: string };
          if (!job.jobId || !job.accessToken) {
            await kill("SIGTERM");
            summary.push({ id: a.id, admitted: false, status: created.status, error: job.error ?? null, ledgerAfter: await ledgerRows() });
            continue;
          }
          jobId = job.jobId;
          tokens[a.id] = job.accessToken;
          writeFileSync(tokensFile, JSON.stringify(tokens), { mode: 0o600 });
          // Recorded at admission, so a harness crash can never lead to a second submission.
          summary.push({ id: a.id, kind: a.kind, query: a.query, jobId, status: "running" });
          await persist();
          if (a.interrupt) {
            await waitFor(() => output.includes("CE_FAULT_REACHED checkpoint.turn.after") || jobSettled(output), 20 * 60_000, "checkpoint before interruption");
            if (!output.includes("CE_FAULT_REACHED checkpoint.turn.after")) throw new Error("the run ended before its interruption checkpoint");
            const before = await store.calls(job.jobId);
            await kill("SIGKILL");
            const killedAt = Date.now();
            await start();
            interruption = { killedAfterCheckpoint: 2, committedBeforeKill: before.filter((c) => c.status === "COMPLETED" || c.status === "FAILED").length, restartMs: Date.now() - killedAt };
          }
        }
        const id = jobId;
        // Waits on the durable record. A worker that died is replaced (at most twice); its recovery resumes the job.
        const deadline = Date.now() + 25 * 60_000;
        let status = (await store.getJob(id))?.status;
        while (status && ["QUEUED", "RUNNING", "RECOVERING"].includes(status) && Date.now() < deadline) {
          const c = child as ChildProcess | null;
          if ((!c || c.exitCode !== null || c.signalCode !== null) && recovery.unplannedWorkerRestarts < 2) {
            recovery.unplannedWorkerRestarts += 1;
            await start();
          }
          await new Promise((resolve) => setTimeout(resolve, 2_000));
          status = (await store.getJob(id))?.status;
        }
        // Without the access token the durable status is read directly, in the API's lowercase vocabulary.
        const view = tokens[a.id] ? await poll(port, id, tokens[a.id]!) : { status: (status ?? "unknown").toLowerCase(), error: null, response: (await store.getJob(id))?.result ?? null };
        const row = await store.getJob(id);
        const result = (view.response as { investigation?: { result?: unknown } } | null)?.investigation?.result ?? null;
        if (result) writeFileSync(join(session, `${a.id}-result.json`), `${JSON.stringify(result, null, 2)}\n`);
        writeFileSync(join(session, `${a.id}-view.json`), `${JSON.stringify(view, null, 2)}\n`);
        await kill("SIGTERM");
        const entry = { id: a.id, kind: a.kind, query: a.query, jobId, status: view.status, durableStatus: row?.status, error: view.error ?? null, attempts: row?.attempt, interruption, recovery, wallMs: Date.now() - startedAt, ledgerAfter: await ledgerRows() };
        const at = summary.findIndex((r) => r.id === a.id);
        if (at >= 0) summary[at] = entry;
        else summary.push(entry);
      } catch (error) {
        // A failure is preserved as it happened: whatever the journal holds is still written below.
        await kill("SIGTERM");
        const entry = { id: a.id, kind: a.kind, query: a.query, jobId: jobId ?? null, status: "harness_error", error: { code: "HARNESS_ERROR", message: String(error) }, interruption, recovery, wallMs: Date.now() - startedAt, workerTail: output.slice(-4_000), ledgerAfter: await ledgerRows() };
        const at = summary.findIndex((r) => r.id === a.id);
        if (at >= 0) summary[at] = entry;
        else summary.push(entry);
      } finally {
        if (jobId) {
          const manifest = await buildRunManifest(store, jobId).catch(() => null);
          writeFileSync(join(session, `${a.id}-manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`);
          const entry = summary.find((r) => r.id === a.id);
          if (entry) Object.assign(entry, { totals: manifest?.providerCalls.totals ?? null, labels: manifest?.labels ?? null });
        }
        await persist();
      }
    }
  } finally {
    await kill("SIGKILL");
    await persist().catch(() => undefined);
    await pool.end();
    console.log(`DURABLE_LIVE_SESSION ${session}`);
  }
  return 0;
}

async function ledgerRowsOf(pool: ReturnType<typeof createBaselinePool>, ledgerKey: string): Promise<{ counter: string; used: number; limit: number }[]> {
  const result = await pool
    .query<{ counter: string; used: number; limit: number }>(`SELECT replace(budget_key, $1, '') AS counter, used_calls AS used, limit_calls AS "limit" FROM baseline_budget_accounts WHERE budget_key LIKE $2 AND budget_key NOT LIKE '%quota%'`, [ledgerKey, `${ledgerKey}%`])
    .catch(() => ({ rows: [] as { counter: string; used: number; limit: number }[] }));
  return result.rows;
}

/** The worker logged the job's end (it finished before reaching an interruption point). */
function jobSettled(log: string): boolean {
  return /"event":"job_(completed|failed|cancelled)"/u.test(log);
}

async function waitFor(check: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function poll(port: number, jobId: string, token: string): Promise<Record<string, unknown>> {
  const started = Date.now();
  for (;;) {
    const response = await fetch(`http://127.0.0.1:${port}/api/agent/jobs/${jobId}`, { headers: { "x-job-token": token } }).catch(() => null);
    const body = response?.ok ? ((await response.json()) as Record<string, unknown>) : null;
    if (body && !["queued", "running"].includes(String(body.status))) return body;
    if (Date.now() - started > 25 * 60_000) return { status: "harness_timeout", error: { code: "HARNESS_TIMEOUT" }, response: null };
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await main();
