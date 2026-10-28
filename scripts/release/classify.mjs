// Pure release classification (Sprint 9L). Input is a redacted evidence object gathered by verify-production.mjs;
// nothing here touches the network, the shell or a secret. Every defect this project actually shipped has a code.
import { checkRemoteSnapshot } from "../check-deployment-contract.mjs";

export const VERDICTS = ["RELEASE_VERIFIED", "RELEASE_DEGRADED", "RELEASE_FAILED"];
export const APPROVED_MAX_QLOO_CALLS = 75;
export const APPROVED_MAX_MODEL_USD = 2.0;
export const MAX_OPERATOR_WINDOW_MS = 4 * 60 * 60 * 1000;

export const REQUIRED_RAILWAY_ENV = [
  "NODE_ENV", "CE_PUBLIC_DEPLOYMENT", "CE_REPLICA_COUNT", "DATABASE_URL", "CE_INTERNAL_API_SECRET",
  "QLOO_API_KEY", "QLOO_API_BASE_URL", "ANTHROPIC_API_KEY", "CE_SPEND_BUDGET_USD",
  "CE_ACCEPT_INVESTIGATIONS", "CE_BASELINE_ENABLED", "CE_BASELINE_LIVE_ENABLED", "CE_BASELINE_TOTAL_QLOO_CALLS",
];
const IN_PROGRESS = new Set(["BUILDING", "DEPLOYING", "INITIALIZING", "QUEUED", "WAITING"]);

/** Railway watch patterns from railway.json ("/backend/**", "/package.json") as a path predicate. */
export function watchMatcher(patterns) {
  const rules = patterns.map((pattern) => pattern.replace(/^\//u, ""));
  return (file) => rules.some((rule) => (rule.endsWith("/**") ? file.startsWith(rule.slice(0, -2)) : file === rule));
}

/** Files between the SHA Railway serves and the release that Railway would have to rebuild for. */
export function backendChanges(changedFiles, patterns) {
  const matches = watchMatcher(patterns);
  return changedFiles.filter(matches);
}

/**
 * @returns {{ verdict: string, failures: string[], degradations: string[], notes: string[] }}
 */
export function classifyRelease(e) {
  const failures = [];
  const degradations = [];
  const notes = [];
  const expectOpen = e.expectAdmissions === "open";

  // 1. Provider metadata, reusing the static contract for the fields it already owns.
  if (!e.vercel) degradations.push("VERCEL_METADATA_NOT_VERIFIED");
  if (!e.railway) degradations.push("RAILWAY_METADATA_NOT_VERIFIED");
  if (e.vercel && e.railway) {
    const snapshot = {
      releaseSha: e.releaseSha,
      publicReleaseApproved: e.publicMode === true,
      paidAdmissionsEnabled: e.railway.env?.flags?.acceptInvestigations === "1" || e.railway.env?.flags?.baselineLiveEnabled === "1",
      vercel: { project: { ...e.vercel.project, productionEnvNames: e.vercel.productionEnvNames }, deployment: e.vercel.deployment },
      railway: { service: e.railway.service, deployment: { status: e.railway.serving?.status ?? null, gitSha: e.railway.serving?.gitSha ?? null } },
    };
    for (const code of checkRemoteSnapshot(snapshot)) {
      if (code === "RAILWAY_DEPLOYMENT_NOT_VERIFIED_AT_RELEASE_SHA") continue; // judged below, with the watch-path exception
      if (code === "PAID_ADMISSIONS_STATUS_UNVERIFIED") continue; // judged below against the declared expectation
      failures.push(code);
    }
  }

  // 2. Vercel: Preview-only variables broke production once; a broken Preview is a degradation, not a release failure.
  if (e.vercel) {
    for (const name of ["BACKEND_URL", "CE_INTERNAL_API_SECRET"]) {
      if (!e.vercel.previewEnvNames?.includes(name)) degradations.push("VERCEL_PREVIEW_ENV_MISSING:" + name);
    }
  }

  // 3. Railway: the latest deployment, the one actually serving, and the watch-path exception.
  if (e.railway) {
    const latest = e.railway.latest;
    if (latest && IN_PROGRESS.has(latest.status)) degradations.push("RAILWAY_DEPLOYMENT_IN_PROGRESS");
    else if (latest && (latest.status === "FAILED" || latest.status === "CRASHED") && latest.gitSha === e.releaseSha) {
      failures.push(latest.snapshotFetchFailed ? "RAILWAY_SNAPSHOT_FETCH_FAILED" : "RAILWAY_LATEST_DEPLOYMENT_FAILED");
    }
    const serving = e.railway.serving;
    if (!serving || serving.status !== "SUCCESS") failures.push("RAILWAY_NO_SUCCESSFUL_DEPLOYMENT");
    else if (serving.gitSha !== e.releaseSha) {
      if (e.backendChangedSinceRailway == null) degradations.push("RAILWAY_SKEW_NOT_ASSESSED");
      else if (e.backendChangedSinceRailway.length > 0) failures.push("RAILWAY_STALE_FOR_BACKEND_CHANGE");
      else notes.push("RAILWAY_FRONTEND_ONLY_SKEW_ACCEPTED");
    }
    if (e.ops?.revisionSha && serving?.gitSha && e.ops.revisionSha !== serving.gitSha) failures.push("RAILWAY_RUNNING_REVISION_MISMATCH");
    if (!e.ops?.revisionSha) degradations.push("RAILWAY_RUNNING_REVISION_NOT_VERIFIED");
  }

  // 4. Railway variables: names always; non-secret values were reduced to flags by the collector.
  const env = e.railway?.env;
  if (env) {
    for (const name of REQUIRED_RAILWAY_ENV) if (!env.names.includes(name)) failures.push("RAILWAY_ENV_MISSING:" + name);
    const f = env.flags;
    if (f.nodeEnv !== "production") failures.push("RAILWAY_NODE_ENV_NOT_PRODUCTION");
    if (f.publicDeployment !== "1") failures.push("RAILWAY_PUBLIC_RUNTIME_DISABLED");
    if (f.replicaCount !== "1") failures.push("RAILWAY_REPLICA_COUNT_NOT_ONE");
    if (f.qlooHostHackathon !== true) failures.push("RAILWAY_QLOO_HOST_UNSAFE");
    if (f.qlooSpacingMs !== null && f.qlooSpacingMs < 7000) failures.push("RAILWAY_QLOO_SPACING_UNSAFE");
    if (env.secretLengths.CE_INTERNAL_API_SECRET < 32) failures.push("RAILWAY_INTERNAL_SECRET_WEAK");
    const open = f.acceptInvestigations === "1" || f.baselineLiveEnabled === "1";
    if (open && !expectOpen) failures.push("ADMISSIONS_OPEN_WITHOUT_APPROVED_WINDOW");
    if (!open && expectOpen) failures.push("ADMISSIONS_EXPECTED_OPEN");
    const expiry = f.paidOperatorExpiresAt ? Date.parse(f.paidOperatorExpiresAt) : null;
    if (open) {
      if (!env.names.includes("CE_PAID_OPERATOR_TOKEN")) failures.push("OPERATOR_TOKEN_MISSING");
      else if ((env.secretLengths.CE_PAID_OPERATOR_TOKEN ?? 0) < 32) failures.push("OPERATOR_TOKEN_WEAK");
      if (expiry === null || !Number.isFinite(expiry)) failures.push("OPERATOR_EXPIRY_MISSING");
      else if (expiry <= e.now) failures.push("OPERATOR_AUTHORIZATION_EXPIRED");
      else if (expiry - e.now > MAX_OPERATOR_WINDOW_MS) failures.push("OPERATOR_WINDOW_TOO_LONG");
      if (f.processQlooLimit === null || f.processQlooLimit > (e.approvedMaxQloo ?? APPROVED_MAX_QLOO_CALLS)) failures.push("QLOO_RUN_CEILING_NOT_WITHIN_APPROVAL");
      if (f.spendBudgetUsd === null || f.spendBudgetUsd > (e.approvedMaxUsd ?? APPROVED_MAX_MODEL_USD)) failures.push("MODEL_BUDGET_NOT_WITHIN_APPROVAL");
    } else {
      if (env.names.includes("CE_PAID_OPERATOR_TOKEN")) degradations.push("OPERATOR_TOKEN_LEFT_CONFIGURED");
      if (expiry !== null && expiry <= e.now) degradations.push("OPERATOR_AUTHORIZATION_EXPIRED_NOT_REVOKED");
    }
    // The baseline budget is cumulative in PostgreSQL; the env value is the absolute limit applied at boot.
    const db = e.ops?.baselineBudget;
    if (db) {
      if (f.baselineTotal !== null && db.limitCalls !== f.baselineTotal) degradations.push("BASELINE_LIMIT_NOT_APPLIED");
      if (f.baselineLiveEnabled === "1" && db.limitCalls <= db.usedCalls) failures.push("BASELINE_QUOTA_AT_OR_BELOW_USAGE");
    } else if (f.baselineLiveEnabled === "1") degradations.push("BASELINE_BUDGET_NOT_VERIFIED");
    if (open && e.ops && e.ops.runLedger == null) failures.push("RUN_LEDGER_NOT_DURABLE");
  }

  // 5. HTTP: is the product actually usable, and are paid routes refused to anonymous visitors?
  const h = e.http ?? {};
  if (h.health?.status !== 200) failures.push("BACKEND_HEALTH_FAILED");
  const ready = h.ready?.body;
  if (!ready) failures.push("BACKEND_READY_UNREADABLE");
  else {
    const reasons = Array.isArray(ready.reasons) ? ready.reasons : [];
    const infra = reasons.filter((reason) => reason !== "ADMISSIONS_PAUSED");
    for (const reason of infra) failures.push("BACKEND_NOT_READY:" + reason);
    // ADMISSIONS_PAUSED on a 503 is the intended closed state, never an infrastructure failure.
    if (ready.acceptingInvestigations === true && !expectOpen) failures.push("BACKEND_ACCEPTING_WITHOUT_APPROVED_WINDOW");
    if (ready.acceptingInvestigations !== true && expectOpen) failures.push("BACKEND_NOT_ACCEPTING_DURING_WINDOW");
    if (ready.dependencies?.paidOperatorRequired !== true) failures.push("PAID_OPERATOR_NOT_REQUIRED");
  }
  if (h.home?.status === 401 && e.publicMode !== true) notes.push("FRONTEND_PROTECTED_HTTP_CHECKS_LIMITED");
  else if (h.home?.status !== 200) failures.push("FRONTEND_HOME_FAILED");
  if (h.home?.status === 200 && e.publicMode !== true) failures.push("VERCEL_PROTECTION_GATE_FAILED");
  if (h.home?.status === 200) {
    if (h.admissions?.body?.status === "unavailable" || h.admissions?.status !== 200) failures.push("FRONTEND_BACKEND_DISCONNECTED");
    if (h.admissions?.body?.status === "accepting") failures.push("ANONYMOUS_SEES_ENABLED_ASK");
    if (h.brandStatus?.status !== 200) failures.push("FRONTEND_BRAND_STATUS_FAILED");
    else if (h.brandStatus.body?.enabled === true) failures.push("ANONYMOUS_SEES_ENABLED_BRAND_SEARCH");
    else if (expectOpen && h.brandStatus.body?.admissionsOpen !== true) failures.push("BRAND_ADMISSIONS_NOT_OPEN_DURING_WINDOW");
    const anon = h.anonymousResolve?.status;
    if (anon === undefined) degradations.push("ANONYMOUS_PAID_START_NOT_PROBED");
    else if (anon >= 200 && anon < 300) failures.push("ANONYMOUS_PAID_START_ACCEPTED");
    else if (anon >= 500 && anon !== 503) failures.push("ANONYMOUS_PAID_START_SERVER_ERROR");
    else if (![403, 503].includes(anon)) degradations.push("ANONYMOUS_PAID_START_UNEXPECTED_STATUS");
  }

  // 6. Post-test safety and leftovers.
  if (!expectOpen && e.ops?.jobs && (e.ops.jobs.running > 0 || e.ops.jobs.queued > 0)) degradations.push("PAID_JOBS_ACTIVE_AFTER_WINDOW");

  // 7. CI. Billing has blocked GitHub Actions before: a job that never started is not a pass.
  if (e.ci?.status === "success") notes.push("CI_PASSED");
  else if (e.ci?.status === "failure") failures.push("CI_FAILED");
  else if (e.localPreflight?.sha === e.releaseSha && e.localPreflight.ok === true) notes.push("CI_NOT_RUN_LOCAL_PREFLIGHT_RECORDED");
  else degradations.push("CI_NOT_RUN");

  const unique = (list) => [...new Set(list)];
  const verdict = failures.length ? "RELEASE_FAILED" : degradations.length ? "RELEASE_DEGRADED" : "RELEASE_VERIFIED";
  return { verdict, failures: unique(failures), degradations: unique(degradations), notes: unique(notes) };
}

/** Fails if any secret value collected in memory appears in the text about to be printed or written. */
export function leakedSecrets(text, secrets) {
  return Object.entries(secrets).filter(([, value]) => typeof value === "string" && value.length >= 8 && text.includes(value)).map(([name]) => name);
}

/** Recovery hint per code, for the human summary and the release skill. */
export const RECOVERY = {
  RAILWAY_SNAPSHOT_FETCH_FAILED: "Transient Railway source fetch. Redeploy the same commit (`railway redeploy`); no code change.",
  RAILWAY_LATEST_DEPLOYMENT_FAILED: "Read `railway logs --build <id>`; fix the build on a branch. The previous SUCCESS keeps serving.",
  RAILWAY_STALE_FOR_BACKEND_CHANGE: "A backend/shared change was skipped or not deployed. Trigger a Railway build of the release SHA from GitHub main.",
  RAILWAY_DEPLOYMENT_IN_PROGRESS: "Wait for the build and rerun the verifier.",
  RAILWAY_RUNNING_REVISION_MISMATCH: "The container is not the metadata's deployment. Check the active deployment in Railway before anything else.",
  VERCEL_DEPLOYMENT_NOT_VERIFIED_AT_RELEASE_SHA: "Check the Vercel production build for the SHA (CANCELED means an Ignored Build Step).",
  "VERCEL_PRODUCTION_ENV_UNVERIFIED:BACKEND_URL": "Add BACKEND_URL for the Production target, then redeploy production.",
  "VERCEL_PRODUCTION_ENV_UNVERIFIED:CE_INTERNAL_API_SECRET": "Add CE_INTERNAL_API_SECRET for the Production target (from Railway, never printed), then redeploy.",
  OPERATOR_AUTHORIZATION_EXPIRED: "The window is over: close it with scripts/live-test-close.sh. Do not extend it without a new approval.",
  OPERATOR_TOKEN_LEFT_CONFIGURED: "Run scripts/live-test-close.sh to remove the operator token.",
  BASELINE_QUOTA_AT_OR_BELOW_USAGE: "Set CE_BASELINE_TOTAL_QLOO_CALLS to used + the approved allocation (see /ops/baselines).",
  BASELINE_LIMIT_NOT_APPLIED: "The baseline limit is applied at boot. Redeploy so the env value reaches PostgreSQL.",
  FRONTEND_BACKEND_DISCONNECTED: "Check Vercel Production BACKEND_URL / CE_INTERNAL_API_SECRET and Railway /health.",
  ANONYMOUS_PAID_START_ACCEPTED: "STOP. Close admissions immediately (scripts/live-test-close.sh); paid work is open to anyone.",
  ANONYMOUS_SEES_ENABLED_BRAND_SEARCH: "The frontend and backend disagree on caller authorization. Check both serve the release SHA.",
  CI_NOT_RUN: "Run `node scripts/release/preflight.mjs` on the release SHA to record equivalent local evidence.",
};
