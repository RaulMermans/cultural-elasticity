#!/usr/bin/env node
// Release config guard: static checks are offline. Remote checks consume ONLY reviewed,
// redacted provider metadata snapshots. Never put credentials or raw env values here.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const expectedRepo = "RaulMermans/cultural-elasticity";
const requiredWatch = ["/backend/**", "/packages/shared/**", "/pnpm-lock.yaml", "/package.json", "/pnpm-workspace.yaml", "/tsconfig.base.json", "/railway.json"];

export function checkRepositoryConfig(vercel, railway) {
  const errors = [];
  const enabled = vercel?.git?.deploymentEnabled;
  if (enabled === false || enabled?.main === false || enabled?.["*"] === false) {
    errors.push("VERCEL_MAIN_DISABLED_IN_REPO");
  }
  if (railway?.build?.builder !== "DOCKERFILE" || railway?.build?.dockerfilePath !== "backend/Dockerfile") {
    errors.push("RAILWAY_WRONG_BUILD_TARGET");
  }
  if (railway?.deploy?.healthcheckPath !== "/health") {
    errors.push("RAILWAY_HEALTHCHECK_MISSING");
  }
  for (const path of requiredWatch) {
    if (!railway?.build?.watchPatterns?.includes(path)) {
      errors.push("RAILWAY_WATCH_MISSING:" + path);
    }
  }
  return errors;
}

export function checkRemoteSnapshot(s) {
  const errors = [];
  const sha = s?.releaseSha;
  if (typeof sha !== "string" || !/^[a-f0-9]{40}$/u.test(sha)) errors.push("RELEASE_SHA_UNVERIFIED");

  const vp = s?.vercel?.project;
  const vd = s?.vercel?.deployment;
  const rs = s?.railway?.service;
  const rd = s?.railway?.deployment;

  // Null explicitly confirms no remote Ignored Build Step; omitted is unverified.
  if (!vp || !Object.hasOwn(vp, "commandForIgnoringBuildStep")) {
    errors.push("VERCEL_IGNORE_RULE_UNVERIFIED");
  } else if (vp.commandForIgnoringBuildStep !== null && vp.commandForIgnoringBuildStep !== "") {
    errors.push("VERCEL_PRODUCTION_MAY_BE_SKIPPED");
  }
  if (vp?.rootDirectory !== "frontend" || vp?.sourceFilesOutsideRootDirectory !== true) {
    errors.push("VERCEL_MONOREPO_SETTINGS_UNVERIFIED");
  }
  if (!s?.publicReleaseApproved && vp?.ssoProtection?.deploymentType !== "all") {
    errors.push("VERCEL_PROTECTION_NOT_ALL");
  }
  for (const name of ["BACKEND_URL", "CE_INTERNAL_API_SECRET"]) {
    if (!Array.isArray(vp?.productionEnvNames) || !vp.productionEnvNames.includes(name)) {
      errors.push("VERCEL_PRODUCTION_ENV_UNVERIFIED:" + name);
    }
  }
  if (vd?.status !== "READY" || vd?.target !== "production" || vd?.gitSha !== sha) {
    errors.push("VERCEL_DEPLOYMENT_NOT_VERIFIED_AT_RELEASE_SHA");
  }
  if (rs?.source?.repo !== expectedRepo || rs?.source?.branch !== "main") {
    errors.push("RAILWAY_WRONG_SOURCE_BRANCH");
  }
  if (rs?.source?.commitSha != null) errors.push("RAILWAY_STALE_COMMIT_PIN");
  if (rs?.numReplicas !== 1) errors.push("RAILWAY_MULTIREPLICA_UNSAFE");
  if (rd?.status !== "SUCCESS" || rd?.gitSha !== sha) {
    errors.push("RAILWAY_DEPLOYMENT_NOT_VERIFIED_AT_RELEASE_SHA");
  }
  if (s?.paidAdmissionsEnabled !== false) errors.push("PAID_ADMISSIONS_STATUS_UNVERIFIED");
  return errors;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const errors = checkRepositoryConfig(
    readJson(resolve(root, "frontend/vercel.json")),
    readJson(resolve(root, "railway.json")),
  );
  const ix = process.argv.indexOf("--snapshot");
  if (ix >= 0) {
    if (!process.argv[ix + 1]) errors.push("SNAPSHOT_PATH_MISSING");
    else {
      try { errors.push(...checkRemoteSnapshot(readJson(resolve(process.argv[ix + 1])))); }
      catch { errors.push("SNAPSHOT_UNREADABLE"); }
    }
  }
  for (const error of errors) console.error("[FAIL] " + error);
  if (errors.length) process.exitCode = 1;
  else console.log(ix < 0
    ? "OFFLINE_DEPLOYMENT_CONFIG_PASS; REMOTE_PLATFORM_STATE_NOT_VERIFIED"
    : "RELEASE_CONFIGURATION_CHECK_PASS; HOSTED_E2E_STILL_REQUIRED");
}
