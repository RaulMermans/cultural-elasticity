import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkRepositoryConfig, checkRemoteSnapshot } from "./check-deployment-contract.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const vercel = JSON.parse(readFileSync(root + "frontend/vercel.json", "utf8"));
const railway = JSON.parse(readFileSync(root + "railway.json", "utf8"));
const sha = "a".repeat(40);

const valid = () => ({
  releaseSha: sha,
  publicReleaseApproved: false,
  paidAdmissionsEnabled: false,
  vercel: {
    project: {
      commandForIgnoringBuildStep: null,
      rootDirectory: "frontend",
      sourceFilesOutsideRootDirectory: true,
      ssoProtection: { deploymentType: "all" },
      productionEnvNames: ["BACKEND_URL", "CE_INTERNAL_API_SECRET"],
    },
    deployment: { status: "READY", target: "production", gitSha: sha },
  },
  railway: {
    service: {
      source: { repo: "RaulMermans/cultural-elasticity", branch: "main", commitSha: null },
      numReplicas: 1,
    },
    deployment: { status: "SUCCESS", gitSha: sha },
  },
});

test("checked-in Vercel and Railway configuration matches the release contract", () => {
  assert.deepEqual(checkRepositoryConfig(vercel, railway), []);
});
test("a main-branch Vercel disable rule is rejected", () => {
  const config = structuredClone(vercel);
  config.git.deploymentEnabled.main = false;
  assert.ok(checkRepositoryConfig(config, railway).includes("VERCEL_MAIN_DISABLED_IN_REPO"));
});
test("missing Railway Dockerfile or backend watch triggers are rejected", () => {
  const config = structuredClone(railway);
  config.build.watchPatterns = config.build.watchPatterns.filter((p) => p !== "/packages/shared/**");
  config.build.dockerfilePath = "frontend/Dockerfile";
  const errors = checkRepositoryConfig(vercel, config);
  assert.ok(errors.includes("RAILWAY_WRONG_BUILD_TARGET"));
  assert.ok(errors.includes("RAILWAY_WATCH_MISSING:/packages/shared/**"));
});
test("a fully verified protected, paused snapshot may pass", () => {
  assert.deepEqual(checkRemoteSnapshot(valid()), []);
});
test("the former preview-only Vercel ignored-build rule cannot pass", () => {
  const snapshot = valid();
  snapshot.vercel.project.commandForIgnoringBuildStep = 'if [ "$VERCEL_ENV" = "preview" ]; then exit 1; else exit 0; fi';
  assert.ok(checkRemoteSnapshot(snapshot).includes("VERCEL_PRODUCTION_MAY_BE_SKIPPED"));
});
test("missing Vercel settings or credentials metadata never silently pass", () => {
  const snapshot = valid();
  delete snapshot.vercel.project.commandForIgnoringBuildStep;
  snapshot.vercel.project.productionEnvNames = [];
  const errors = checkRemoteSnapshot(snapshot);
  assert.ok(errors.includes("VERCEL_IGNORE_RULE_UNVERIFIED"));
  assert.ok(errors.includes("VERCEL_PRODUCTION_ENV_UNVERIFIED:BACKEND_URL"));
  assert.ok(errors.includes("VERCEL_PRODUCTION_ENV_UNVERIFIED:CE_INTERNAL_API_SECRET"));
});
test("Railway pinned to a sprint or older commit fails", () => {
  const snapshot = valid();
  snapshot.railway.service.source.branch = "sprint/9b-brand-intelligence-durability";
  snapshot.railway.service.source.commitSha = "b".repeat(40);
  snapshot.railway.deployment.gitSha = "b".repeat(40);
  const errors = checkRemoteSnapshot(snapshot);
  assert.ok(errors.includes("RAILWAY_WRONG_SOURCE_BRANCH"));
  assert.ok(errors.includes("RAILWAY_STALE_COMMIT_PIN"));
  assert.ok(errors.includes("RAILWAY_DEPLOYMENT_NOT_VERIFIED_AT_RELEASE_SHA"));
});
test("public exposure and paid research require verified separate approvals", () => {
  const snapshot = valid();
  snapshot.vercel.project.ssoProtection.deploymentType = "preview";
  snapshot.paidAdmissionsEnabled = true;
  const errors = checkRemoteSnapshot(snapshot);
  assert.ok(errors.includes("VERCEL_PROTECTION_NOT_ALL"));
  assert.ok(errors.includes("PAID_ADMISSIONS_STATUS_UNVERIFIED"));
});
test("a mere successful build at another SHA cannot pass release preflight", () => {
  const snapshot = valid();
  snapshot.vercel.deployment.gitSha = "b".repeat(40);
  assert.ok(checkRemoteSnapshot(snapshot).includes("VERCEL_DEPLOYMENT_NOT_VERIFIED_AT_RELEASE_SHA"));
});
