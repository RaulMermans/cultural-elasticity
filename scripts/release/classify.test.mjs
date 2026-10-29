// Regression tests for the release verdict. SYNTHETIC evidence only; each case is a failure this project shipped.
import assert from "node:assert/strict";
import test from "node:test";
import { backendChanges, classifyRelease, leakedSecrets } from "./classify.mjs";

const SHA = "a".repeat(40);
const OLD = "b".repeat(40);
const NOW = Date.parse("2026-10-28T12:00:00Z");
const WATCH = ["/backend/**", "/packages/shared/**", "/package.json", "/pnpm-lock.yaml", "/pnpm-workspace.yaml", "/tsconfig.base.json", "/railway.json"];

function healthy(overrides = {}) {
  const base = {
    releaseSha: SHA, now: NOW, expectAdmissions: "closed", publicMode: true,
    vercel: {
      project: { commandForIgnoringBuildStep: null, rootDirectory: "frontend", sourceFilesOutsideRootDirectory: true, ssoProtection: { deploymentType: "none" } },
      productionEnvNames: ["BACKEND_URL", "CE_INTERNAL_API_SECRET"],
      previewEnvNames: ["BACKEND_URL", "CE_INTERNAL_API_SECRET"],
      deployment: { status: "READY", target: "production", gitSha: SHA },
    },
    railway: {
      service: { source: { repo: "RaulMermans/cultural-elasticity", branch: "main", commitSha: null }, numReplicas: 1 },
      latest: { status: "SUCCESS", gitSha: SHA },
      serving: { status: "SUCCESS", gitSha: SHA },
      env: {
        names: ["NODE_ENV", "CE_PUBLIC_DEPLOYMENT", "CE_REPLICA_COUNT", "DATABASE_URL", "CE_INTERNAL_API_SECRET", "QLOO_API_KEY", "QLOO_API_BASE_URL", "ANTHROPIC_API_KEY", "CE_SPEND_BUDGET_USD", "CE_ACCEPT_INVESTIGATIONS", "CE_BASELINE_ENABLED", "CE_BASELINE_LIVE_ENABLED", "CE_BASELINE_TOTAL_QLOO_CALLS"],
        secretLengths: { CE_INTERNAL_API_SECRET: 64, CE_PAID_OPERATOR_TOKEN: 0 },
        flags: { nodeEnv: "production", publicDeployment: "1", replicaCount: "1", qlooHostHackathon: true, qlooSpacingMs: 7000, acceptInvestigations: "0", baselineEnabled: "0", baselineLiveEnabled: "0", baselineTotal: 0, processQlooLimit: null, spendBudgetUsd: 2.5, reserveUsd: 1, paidOperatorExpiresAt: null },
      },
    },
    backendChangedSinceRailway: null,
    ops: { revisionSha: SHA, jobs: { running: 0, queued: 0 }, runLedger: null, baselineBudget: { limitCalls: 0, usedCalls: 0 } },
    http: {
      health: { status: 200 },
      ready: { status: 503, body: { acceptingInvestigations: false, reasons: ["ADMISSIONS_PAUSED"], dependencies: { paidOperatorRequired: true } } },
      home: { status: 200 },
      admissions: { status: 200, body: { status: "paused" } },
      brandStatus: { status: 200, body: { enabled: false, admissionsOpen: false } },
      anonymousResolve: { status: 503 },
    },
    ci: { status: "success" },
    localPreflight: null,
  };
  return structuredClone({ ...base, ...overrides });
}

/** An approved operator window: admissions open, credential set, limits within approval. */
function openWindow() {
  const e = healthy({ expectAdmissions: "open" });
  Object.assign(e.railway.env.flags, { acceptInvestigations: "1", baselineEnabled: "1", baselineLiveEnabled: "1", baselineTotal: 21, processQlooLimit: 75, spendBudgetUsd: 2, reserveUsd: 0.5, paidOperatorExpiresAt: new Date(NOW + 3 * 3600_000).toISOString() });
  e.railway.env.names.push("CE_PAID_OPERATOR_TOKEN", "CE_PAID_OPERATOR_EXPIRES_AT", "CE_PROCESS_QLOO_CALL_LIMIT");
  e.railway.env.secretLengths.CE_PAID_OPERATOR_TOKEN = 64;
  e.ops.runLedger = { qloo_calls: null, model_usd_cents: null };
  e.ops.baselineBudget = { limitCalls: 21, usedCalls: 0 };
  e.http.ready = { status: 200, body: { acceptingInvestigations: true, reasons: [], dependencies: { paidOperatorRequired: true } } };
  e.http.brandStatus.body = { enabled: false, admissionsOpen: true };
  e.http.anonymousResolve = { status: 403 };
  return e;
}

const verdict = (e) => classifyRelease(e);

test("a healthy release with admissions intentionally paused is VERIFIED, not an infrastructure failure", () => {
  assert.deepEqual(verdict(healthy()), { verdict: "RELEASE_VERIFIED", failures: [], degradations: [], notes: ["CI_PASSED"] });
});

test("an approved, correctly bounded operator window is VERIFIED", () => {
  assert.equal(verdict(openWindow()).verdict, "RELEASE_VERIFIED");
});

test("Vercel and Railway serving incompatible revisions fails", () => {
  const e = healthy({ backendChangedSinceRailway: ["backend/src/api/health.ts"] });
  e.railway.serving.gitSha = OLD;
  e.ops.revisionSha = OLD;
  assert.ok(verdict(e).failures.includes("RAILWAY_STALE_FOR_BACKEND_CHANGE"));
});

test("a Railway watch-path skip is accepted only for a frontend-only change", () => {
  assert.deepEqual(backendChanges(["frontend/src/app/page.tsx", "docs/x.md"], WATCH), []);
  assert.deepEqual(backendChanges(["packages/shared/src/x.ts", "frontend/a.ts"], WATCH), ["packages/shared/src/x.ts"]);
  assert.deepEqual(backendChanges(["pnpm-lock.yaml"], WATCH), ["pnpm-lock.yaml"]);
  const e = healthy({ backendChangedSinceRailway: [] });
  e.railway.serving.gitSha = OLD;
  e.ops.revisionSha = OLD;
  const result = verdict(e);
  assert.equal(result.verdict, "RELEASE_VERIFIED");
  assert.ok(result.notes.includes("RAILWAY_FRONTEND_ONLY_SKEW_ACCEPTED"));
  e.backendChangedSinceRailway = null;
  assert.equal(verdict(e).verdict, "RELEASE_DEGRADED");
});

test("a Vercel deployment at another SHA, canceled or skipped by an ignore rule, fails", () => {
  const stale = healthy();
  stale.vercel.deployment.gitSha = OLD;
  assert.ok(verdict(stale).failures.includes("VERCEL_DEPLOYMENT_NOT_VERIFIED_AT_RELEASE_SHA"));
  const canceled = healthy();
  canceled.vercel.deployment.status = "CANCELED";
  canceled.vercel.project.commandForIgnoringBuildStep = "exit 0";
  const codes = verdict(canceled).failures;
  assert.ok(codes.includes("VERCEL_PRODUCTION_MAY_BE_SKIPPED") && codes.includes("VERCEL_DEPLOYMENT_NOT_VERIFIED_AT_RELEASE_SHA"));
});

test("Preview-only Vercel variables fail production; a broken Preview only degrades", () => {
  const e = healthy();
  e.vercel.productionEnvNames = ["BACKEND_URL"];
  assert.ok(verdict(e).failures.includes("VERCEL_PRODUCTION_ENV_UNVERIFIED:CE_INTERNAL_API_SECRET"));
  const preview = healthy();
  preview.vercel.previewEnvNames = ["BACKEND_URL"];
  assert.deepEqual(verdict(preview).degradations, ["VERCEL_PREVIEW_ENV_MISSING:CE_INTERNAL_API_SECRET"]);
});

test("missing Production secrets on Railway fail", () => {
  const e = healthy();
  e.railway.env.names = e.railway.env.names.filter((n) => n !== "ANTHROPIC_API_KEY" && n !== "DATABASE_URL");
  const codes = verdict(e).failures;
  assert.ok(codes.includes("RAILWAY_ENV_MISSING:ANTHROPIC_API_KEY") && codes.includes("RAILWAY_ENV_MISSING:DATABASE_URL"));
});

test("an open window without an operator token or expiry fails", () => {
  const e = openWindow();
  e.railway.env.names = e.railway.env.names.filter((n) => n !== "CE_PAID_OPERATOR_TOKEN");
  e.railway.env.flags.paidOperatorExpiresAt = null;
  const codes = verdict(e).failures;
  assert.ok(codes.includes("OPERATOR_TOKEN_MISSING") && codes.includes("OPERATOR_EXPIRY_MISSING"));
});

test("an expired or over-long operator authorization fails while open and degrades once closed", () => {
  const expired = openWindow();
  expired.railway.env.flags.paidOperatorExpiresAt = new Date(NOW - 60_000).toISOString();
  assert.ok(verdict(expired).failures.includes("OPERATOR_AUTHORIZATION_EXPIRED"));
  const long = openWindow();
  long.railway.env.flags.paidOperatorExpiresAt = new Date(NOW + 48 * 3600_000).toISOString();
  assert.ok(verdict(long).failures.includes("OPERATOR_WINDOW_TOO_LONG"));
  const leftover = healthy();
  leftover.railway.env.names.push("CE_PAID_OPERATOR_TOKEN");
  leftover.railway.env.flags.paidOperatorExpiresAt = new Date(NOW - 60_000).toISOString();
  const result = verdict(leftover);
  assert.ok(result.degradations.includes("OPERATOR_TOKEN_LEFT_CONFIGURED") && result.degradations.includes("OPERATOR_AUTHORIZATION_EXPIRED_NOT_REVOKED"));
});

test("an anonymous paid request that is accepted, or controls that look enabled, fail", () => {
  const accepted = openWindow();
  accepted.http.anonymousResolve = { status: 200 };
  assert.ok(verdict(accepted).failures.includes("ANONYMOUS_PAID_START_ACCEPTED"));
  const brand = openWindow();
  brand.http.brandStatus.body.enabled = true;
  assert.ok(verdict(brand).failures.includes("ANONYMOUS_SEES_ENABLED_BRAND_SEARCH"));
  const ask = openWindow();
  ask.http.admissions.body.status = "accepting";
  assert.ok(verdict(ask).failures.includes("ANONYMOUS_SEES_ENABLED_ASK"));
});

test("readiness: paused is fine, a missing credential is not, and open admissions outside a window fail", () => {
  const missing = healthy();
  missing.http.ready.body.reasons = ["ADMISSIONS_PAUSED", "MISSING_QLOO_CREDENTIAL"];
  assert.deepEqual(verdict(missing).failures, ["BACKEND_NOT_READY:MISSING_QLOO_CREDENTIAL"]);
  const open = healthy();
  open.http.ready.body = { acceptingInvestigations: true, reasons: [], dependencies: { paidOperatorRequired: true } };
  assert.ok(verdict(open).failures.includes("BACKEND_ACCEPTING_WITHOUT_APPROVED_WINDOW"));
  const closedDuringWindow = openWindow();
  closedDuringWindow.http.ready.body = { acceptingInvestigations: false, reasons: ["ADMISSIONS_PAUSED"], dependencies: { paidOperatorRequired: true } };
  assert.ok(verdict(closedDuringWindow).failures.includes("BACKEND_NOT_ACCEPTING_DURING_WINDOW"));
});

test("an open window must keep durable run accounting (a restart cannot reset the Qloo counter)", () => {
  const e = openWindow();
  e.ops.runLedger = null;
  assert.ok(verdict(e).failures.includes("RUN_LEDGER_NOT_DURABLE"));
});

test("a cumulative baseline quota at or below consumed usage fails; an unapplied limit degrades", () => {
  const below = openWindow();
  below.ops.baselineBudget = { limitCalls: 21, usedCalls: 21 };
  assert.ok(verdict(below).failures.includes("BASELINE_QUOTA_AT_OR_BELOW_USAGE"));
  const stale = openWindow();
  stale.ops.baselineBudget = { limitCalls: 0, usedCalls: 0 };
  const result = verdict(stale);
  assert.ok(result.degradations.includes("BASELINE_LIMIT_NOT_APPLIED") && result.failures.includes("BASELINE_QUOTA_AT_OR_BELOW_USAGE"));
});

test("limits beyond the owner's approval fail", () => {
  const e = openWindow();
  e.railway.env.flags.processQlooLimit = 200;
  e.railway.env.flags.spendBudgetUsd = 10;
  const codes = verdict(e).failures;
  assert.ok(codes.includes("QLOO_RUN_CEILING_NOT_WITHIN_APPROVAL") && codes.includes("MODEL_BUDGET_NOT_WITHIN_APPROVAL"));
});

test("a Railway SUCCESS with an unusable API still fails", () => {
  const e = healthy();
  e.http.health = { status: 0 };
  e.http.admissions = { status: 200, body: { status: "unavailable" } };
  const codes = verdict(e).failures;
  assert.ok(codes.includes("BACKEND_HEALTH_FAILED") && codes.includes("FRONTEND_BACKEND_DISCONNECTED"));
});

test("Railway deploy states: snapshot fetch failure, in progress, and a container not matching metadata", () => {
  const snapshot = healthy();
  snapshot.railway.latest = { status: "FAILED", gitSha: SHA, snapshotFetchFailed: true };
  assert.ok(verdict(snapshot).failures.includes("RAILWAY_SNAPSHOT_FETCH_FAILED"));
  const building = healthy();
  building.railway.latest = { status: "BUILDING", gitSha: SHA };
  assert.ok(verdict(building).degradations.includes("RAILWAY_DEPLOYMENT_IN_PROGRESS"));
  const mismatch = healthy();
  mismatch.ops.revisionSha = OLD;
  assert.ok(verdict(mismatch).failures.includes("RAILWAY_RUNNING_REVISION_MISMATCH"));
  const branch = healthy();
  branch.railway.service.source.branch = "sprint/9b";
  assert.ok(verdict(branch).failures.includes("RAILWAY_WRONG_SOURCE_BRANCH"));
});

test("CI that never started is CI_NOT_RUN unless a local preflight for the same SHA was recorded", () => {
  const notRun = healthy({ ci: { status: "not_run" } });
  assert.deepEqual(verdict(notRun).degradations, ["CI_NOT_RUN"]);
  notRun.localPreflight = { sha: OLD, ok: true };
  assert.deepEqual(verdict(notRun).degradations, ["CI_NOT_RUN"]);
  notRun.localPreflight = { sha: SHA, ok: true };
  assert.equal(verdict(notRun).verdict, "RELEASE_VERIFIED");
  assert.ok(verdict(healthy({ ci: { status: "failure" } })).failures.includes("CI_FAILED"));
});

test("paid jobs left running after the window degrade the release", () => {
  const e = healthy();
  e.ops.jobs = { running: 1, queued: 0 };
  assert.ok(verdict(e).degradations.includes("PAID_JOBS_ACTIVE_AFTER_WINDOW"));
});

test("missing provider metadata is never VERIFIED", () => {
  assert.notEqual(verdict(healthy({ vercel: null })).verdict, "RELEASE_VERIFIED");
  assert.notEqual(verdict(healthy({ railway: null, ops: null })).verdict, "RELEASE_VERIFIED");
});

test("a secret value in the report is detected before anything is printed", () => {
  const secret = "SYNTHETIC-secret-value-0123456789";
  assert.deepEqual(leakedSecrets(JSON.stringify({ a: `x${secret}y` }), { CE_INTERNAL_API_SECRET: secret, OTHER: "absent-value-000" }), ["CE_INTERNAL_API_SECRET"]);
  assert.deepEqual(leakedSecrets("{}", { SHORT: "abc" }), []);
});

test("a closed window keeps the last applied baseline limit without a false degradation", () => {
  const e = healthy();
  e.ops.baselineBudget = { limitCalls: 21, usedCalls: 7 };
  assert.equal(verdict(e).verdict, "RELEASE_VERIFIED");
});

/** Sprint 9M: an approved public evaluation. Anonymous visitors are admitted; caps and expiry are bounded. */
function publicEvaluation() {
  const e = healthy({ expectAdmissions: "public", approvedMaxQloo: 1000, approvedMaxUsd: 5 });
  Object.assign(e.railway.env.flags, {
    acceptInvestigations: "1", baselineEnabled: "1", baselineLiveEnabled: "1", baselineTotal: 408, processQlooLimit: 1000, spendBudgetUsd: 5, reserveUsd: 0.5,
    publicEvaluation: "1", publicEvaluationId: "syn-eval", publicEvaluationExpiresAt: new Date(NOW + 7 * 24 * 3600_000).toISOString(),
  });
  e.ops.runLedger = { qloo_calls: null, model_usd_cents: null };
  e.ops.baselineBudget = { limitCalls: 408, usedCalls: 8 };
  e.http.ready = { status: 200, body: { acceptingInvestigations: true, reasons: [], dependencies: { paidOperatorRequired: false } } };
  e.http.admissions.body.status = "accepting";
  e.http.brandStatus.body = { enabled: true, admissionsOpen: true };
  e.http.anonymousResolve = { status: 400 };
  return e;
}

test("an approved public evaluation is VERIFIED: anonymous research enabled, caps within approval, probe never dispatched", () => {
  assert.deepEqual(verdict(publicEvaluation()).failures, []);
  assert.equal(verdict(publicEvaluation()).verdict, "RELEASE_VERIFIED");
});

test("a public evaluation fails when judges are locked out, caps exceed approval, it is expired or open without approval", () => {
  const locked = publicEvaluation();
  locked.http.anonymousResolve = { status: 403 };
  assert.ok(verdict(locked).failures.includes("PUBLIC_EVALUATION_NOT_ADMITTING"));
  const dispatched = publicEvaluation();
  dispatched.http.anonymousResolve = { status: 200 };
  assert.ok(verdict(dispatched).failures.includes("PUBLIC_EVALUATION_PROBE_DISPATCHED"));
  const over = publicEvaluation();
  over.railway.env.flags.processQlooLimit = 5000;
  assert.ok(verdict(over).failures.includes("QLOO_RUN_CEILING_NOT_WITHIN_APPROVAL"));
  const expired = publicEvaluation();
  expired.railway.env.flags.publicEvaluationExpiresAt = new Date(NOW - 1000).toISOString();
  assert.ok(verdict(expired).failures.includes("PUBLIC_EVALUATION_EXPIRED"));
  const forever = publicEvaluation();
  forever.railway.env.flags.publicEvaluationExpiresAt = "2027-06-01T00:00:00Z";
  assert.ok(verdict(forever).failures.includes("PUBLIC_EVALUATION_WINDOW_TOO_LONG"));
  const unapproved = publicEvaluation();
  unapproved.expectAdmissions = "open";
  assert.ok(verdict(unapproved).failures.includes("PUBLIC_EVALUATION_OPEN_WITHOUT_APPROVAL"));
});
