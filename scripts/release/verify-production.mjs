#!/usr/bin/env node
// Read-only production release verification (Sprint 9L). Gathers FRESH Vercel/Railway metadata and HTTP evidence,
// classifies it with classify.mjs and prints RELEASE_VERIFIED | RELEASE_DEGRADED | RELEASE_FAILED.
//
// It never starts paid work: the only POST is an anonymous brand resolution, which Railway refuses (503 paused or
// 403 operator_required) before any Qloo dispatch. Secret values are held in memory only to compute lengths and to
// call operator diagnostics; the report is scanned for them before it is printed or written.
//
// Usage: node scripts/release/verify-production.mjs [--release <sha>] [--expect-admissions closed|open|public]
//          [--public-mode] [--max-qloo 75] [--max-usd 2.00] [--out <report.json>]
// Needs: the Railway CLI linked to the project, Vercel CLI login (or VERCEL_TOKEN), gh (optional, for CI status).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { backendChanges, classifyRelease, leakedSecrets, RECOVERY } from "./classify.mjs";

export const TARGET = {
  repo: "RaulMermans/cultural-elasticity",
  vercelProjectId: "prj_AHQcMcLFwGUOpRmepvwcc89LyOYo",
  frontend: "https://cultural-elasticity-raulmermans-projects.vercel.app",
  backend: "https://cultural-elasticity-api-production.up.railway.app",
  railwayServiceId: "06b519c8-56a1-4e7d-99ea-358e03d69c16",
  railwayEnvironmentId: "b6af0e24-636a-458e-b6b0-47aebc474464",
  railwayProjectId: "cf7fb87c-d2fe-4ae0-8cea-1e8dcd065298",
};
const QLOO_HACKATHON_ORIGIN = "https://hackathon.api.qloo.com";
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function arg(name, fallback = null) {
  const ix = process.argv.indexOf(name);
  return ix >= 0 ? process.argv[ix + 1] ?? fallback : fallback;
}
function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 * 1024 * 1024 });
  } catch {
    return null;
  }
}
function json(text) {
  if (text == null) return null;
  const start = text.indexOf("{") >= 0 && (text.indexOf("[") < 0 || text.indexOf("{") < text.indexOf("[")) ? text.indexOf("{") : text.indexOf("[");
  try {
    return JSON.parse(text.slice(Math.max(0, start)));
  } catch {
    return null;
  }
}
async function http(url, init = {}) {
  try {
    const response = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(15_000) });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* HTML or empty */ }
    return { status: response.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

function vercelToken() {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN;
  // The CLI login token expires; any authenticated CLI call refreshes it in auth.json before we read it.
  run("vercel", ["whoami"]);
  for (const path of [join(homedir(), "Library/Application Support/com.vercel.cli/auth.json"), join(homedir(), ".local/share/com.vercel.cli/auth.json")]) {
    if (existsSync(path)) return json(readFileSync(path, "utf8"))?.token ?? null;
  }
  return null;
}

async function collectVercel(releaseSha) {
  const token = vercelToken();
  if (!token) return null;
  const get = async (path) => (await http(`https://api.vercel.com${path}`, { headers: { authorization: `Bearer ${token}` } })).body;
  const project = await get(`/v9/projects/${TARGET.vercelProjectId}`);
  const envs = await get(`/v10/projects/${TARGET.vercelProjectId}/env`);
  const deployments = await get(`/v6/deployments?projectId=${TARGET.vercelProjectId}&target=production&limit=10`);
  if (!project?.id || !Array.isArray(envs?.envs) || !Array.isArray(deployments?.deployments)) return null;
  const names = (target) => envs.envs.filter((env) => env.target?.includes(target)).map((env) => env.key);
  // The production alias serves the newest READY production deployment; report the release SHA's own state too.
  const ready = deployments.deployments.find((d) => d.state === "READY");
  const forRelease = deployments.deployments.find((d) => d.meta?.githubCommitSha === releaseSha);
  const chosen = forRelease && forRelease.state !== "READY" ? forRelease : ready;
  return {
    project: {
      commandForIgnoringBuildStep: project.commandForIgnoringBuildStep ?? null,
      rootDirectory: project.rootDirectory,
      sourceFilesOutsideRootDirectory: project.sourceFilesOutsideRootDirectory,
      ssoProtection: project.ssoProtection ? { deploymentType: project.ssoProtection.deploymentType } : { deploymentType: "none" },
      productionBranch: project.link?.productionBranch ?? null,
    },
    productionEnvNames: names("production"),
    previewEnvNames: names("preview"),
    deployment: chosen ? { status: chosen.state, target: "production", gitSha: chosen.meta?.githubCommitSha ?? null, ref: chosen.meta?.githubCommitRef ?? null } : null,
  };
}

function collectRailway(secrets) {
  const ids = ["--service", TARGET.railwayServiceId, "--environment", TARGET.railwayEnvironmentId];
  const vars = json(run("railway", ["variables", "--json", ...ids]));
  const instance = json(run("railway", ["api", `query { serviceInstance(serviceId:"${TARGET.railwayServiceId}", environmentId:"${TARGET.railwayEnvironmentId}") { numReplicas source { repo } } }`]))?.data?.serviceInstance;
  const trigger = json(run("railway", ["api", `query { deploymentTriggers(projectId:"${TARGET.railwayProjectId}", environmentId:"${TARGET.railwayEnvironmentId}", serviceId:"${TARGET.railwayServiceId}") { edges { node { branch repository } } } }`]))?.data?.deploymentTriggers?.edges?.[0]?.node;
  const deployments = json(run("railway", ["deployment", "list", "--json", ...ids]));
  if (!vars || !instance || !Array.isArray(deployments)) return null;
  const meaningful = deployments.filter((d) => !["SKIPPED", "REMOVED", "REMOVING"].includes(d.status));
  const latest = meaningful[0] ?? null;
  const serving = deployments.find((d) => d.status === "SUCCESS") ?? null;
  let snapshotFetchFailed = false;
  if (latest && (latest.status === "FAILED" || latest.status === "CRASHED")) {
    snapshotFetchFailed = /failed to fetch snapshot/iu.test(run("railway", ["logs", "--build", latest.id]) ?? "");
  }
  for (const name of ["CE_INTERNAL_API_SECRET", "CE_PAID_OPERATOR_TOKEN", "CE_OPERATOR_TOKEN", "QLOO_API_KEY", "ANTHROPIC_API_KEY", "DATABASE_URL"]) {
    if (vars[name]) secrets[name] = vars[name];
  }
  const number = (value) => (value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null);
  return {
    service: { source: { repo: trigger?.repository ?? instance.source?.repo ?? null, branch: trigger?.branch ?? null, commitSha: null }, numReplicas: instance.numReplicas },
    latest: latest ? { id: latest.id, status: latest.status, gitSha: latest.meta?.commitHash ?? null, snapshotFetchFailed } : null,
    serving: serving ? { id: serving.id, status: serving.status, gitSha: serving.meta?.commitHash ?? null } : null,
    env: {
      names: Object.keys(vars).filter((name) => !name.startsWith("RAILWAY_")),
      secretLengths: Object.fromEntries(["CE_INTERNAL_API_SECRET", "CE_PAID_OPERATOR_TOKEN"].map((name) => [name, vars[name]?.length ?? 0])),
      flags: {
        nodeEnv: vars.NODE_ENV ?? null,
        publicDeployment: vars.CE_PUBLIC_DEPLOYMENT ?? null,
        replicaCount: vars.CE_REPLICA_COUNT ?? null,
        qlooHostHackathon: (vars.QLOO_API_BASE_URL ?? "").replace(/\/+$/u, "") === QLOO_HACKATHON_ORIGIN,
        qlooSpacingMs: number(vars.QLOO_CALL_SPACING_MS),
        acceptInvestigations: vars.CE_ACCEPT_INVESTIGATIONS ?? "0",
        baselineEnabled: vars.CE_BASELINE_ENABLED ?? "0",
        baselineLiveEnabled: vars.CE_BASELINE_LIVE_ENABLED ?? "0",
        baselineTotal: number(vars.CE_BASELINE_TOTAL_QLOO_CALLS),
        processQlooLimit: number(vars.CE_PROCESS_QLOO_CALL_LIMIT),
        spendBudgetUsd: number(vars.CE_SPEND_BUDGET_USD),
        reserveUsd: number(vars.CE_INVESTIGATION_RESERVE_USD),
        paidOperatorExpiresAt: vars.CE_PAID_OPERATOR_EXPIRES_AT ?? null,
        publicEvaluation: vars.CE_PUBLIC_EVALUATION ?? null,
        publicEvaluationId: vars.CE_PUBLIC_EVALUATION_ID ?? null,
        publicEvaluationExpiresAt: vars.CE_PUBLIC_EVALUATION_EXPIRES_AT ?? null,
      },
    },
  };
}

async function collectOps(secrets) {
  const token = secrets.CE_OPERATOR_TOKEN;
  if (!token) return null;
  const headers = { "x-ce-operator": token };
  const status = await http(`${TARGET.backend}/ops/status`, { headers });
  const baselines = await http(`${TARGET.backend}/ops/baselines`, { headers });
  if (status.status !== 200) return null;
  return {
    revisionSha: status.body?.revision?.gitSha ?? null,
    jobs: status.body?.jobs ?? null,
    runLedger: status.body?.runLedger ?? null,
    qlooDispatch: status.body?.qlooDispatch ?? null,
    spend: status.body?.spend ? { configuredUsd: status.body.spend.configuredUsd, consumedUsd: status.body.spend.consumedUsd, reservedUsd: status.body.spend.reservedUsd } : null,
    baselineBudget: baselines.status === 200 && baselines.body?.qlooCallBudget ? baselines.body.qlooCallBudget : null,
    databaseReady: baselines.body?.databaseReady ?? null,
  };
}

async function collectHttp() {
  return {
    health: await http(`${TARGET.backend}/health`),
    ready: await http(`${TARGET.backend}/ready`),
    home: await http(`${TARGET.frontend}/`),
    admissions: await http(`${TARGET.frontend}/api/agent/admissions`),
    brandStatus: await http(`${TARGET.frontend}/api/brands/status`),
    // Anonymous: no cookie, no operator. Railway must refuse before any Qloo call.
    // In a public evaluation an anonymous resolution is admitted, so the probe is malformed (a one-letter name):
    // Railway refuses it with 400 after admission and before any quota or Qloo call.
    anonymousResolve: await http(`${TARGET.frontend}/api/brands/resolve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(arg("--expect-admissions", "closed") === "public" ? { name: "x" } : { name: "Release verification probe" }) }),
  };
}

function collectCi(sha) {
  const runs = json(run("gh", ["api", `repos/${TARGET.repo}/commits/${sha}/check-runs`]));
  const verify = runs?.check_runs?.find((check) => check.name === "verify");
  if (!verify) return { status: "not_run" };
  if (verify.conclusion === "success") return { status: "success" };
  const annotations = json(run("gh", ["api", `repos/${TARGET.repo}/check-runs/${verify.id}/annotations`])) ?? [];
  const neverStarted = annotations.some((a) => /not started|spending limit|payments have failed/iu.test(a.message ?? ""));
  return { status: neverStarted || verify.conclusion === "skipped" ? "not_run" : verify.status === "completed" ? "failure" : "pending" };
}

async function main() {
  run("git", ["fetch", "--quiet", "origin", "main"]);
  const releaseSha = arg("--release") ?? run("git", ["rev-parse", "origin/main"])?.trim();
  const secrets = {};
  const vercel = await collectVercel(releaseSha);
  const railway = collectRailway(secrets);
  let changed = null;
  if (railway?.serving?.gitSha && railway.serving.gitSha !== releaseSha) {
    const diff = run("git", ["diff", "--name-only", `${railway.serving.gitSha}..${releaseSha}`]);
    const patterns = json(readFileSync(join(root, "railway.json"), "utf8"))?.build?.watchPatterns ?? [];
    changed = diff === null ? null : backendChanges(diff.split("\n").filter(Boolean), patterns);
  }
  const preflightPath = join(root, ".release", `preflight-${releaseSha}.json`);
  const evidence = {
    releaseSha,
    now: Date.now(),
    expectAdmissions: arg("--expect-admissions", "closed"),
    publicMode: process.argv.includes("--public-mode"),
    approvedMaxQloo: Number(arg("--max-qloo", "75")),
    approvedMaxUsd: Number(arg("--max-usd", "2.00")),
    vercel,
    railway,
    backendChangedSinceRailway: changed,
    ops: await collectOps(secrets),
    http: await collectHttp(),
    ci: collectCi(releaseSha),
    localPreflight: existsSync(preflightPath) ? json(readFileSync(preflightPath, "utf8")) : null,
  };
  const result = classifyRelease(evidence);
  const report = JSON.stringify({ ...result, evidence }, null, 2);
  const leaks = leakedSecrets(report, secrets);
  if (leaks.length) {
    console.error(`RELEASE_FAILED: SECRET_IN_REPORT (${leaks.join(", ")}); nothing written`);
    process.exit(1);
  }
  const out = arg("--out");
  if (out) writeFileSync(out, report + "\n", { mode: 0o600 });
  const short = (sha) => (sha ? sha.slice(0, 7) : "unknown");
  console.log(`release ${short(releaseSha)} | vercel ${short(vercel?.deployment?.gitSha)} ${vercel?.deployment?.status ?? "?"} | railway ${short(railway?.serving?.gitSha)} ${railway?.serving?.status ?? "?"} (latest ${railway?.latest?.status ?? "?"}) | running ${short(evidence.ops?.revisionSha)}`);
  console.log(`ready ${evidence.http.ready.status} ${JSON.stringify(evidence.http.ready.body?.reasons ?? [])} | admissions ${evidence.http.admissions.body?.status ?? "?"} | anonymous resolve ${evidence.http.anonymousResolve.status} | baseline budget ${JSON.stringify(evidence.ops?.baselineBudget ?? null)} | ci ${evidence.ci.status}`);
  for (const code of result.failures) console.log(`[FAIL] ${code}${RECOVERY[code] ? " -> " + RECOVERY[code] : ""}`);
  for (const code of result.degradations) console.log(`[DEGRADED] ${code}${RECOVERY[code] ? " -> " + RECOVERY[code] : ""}`);
  for (const code of result.notes) console.log(`[NOTE] ${code}`);
  console.log(result.verdict);
  process.exitCode = result.verdict === "RELEASE_VERIFIED" ? 0 : result.verdict === "RELEASE_DEGRADED" ? 3 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
