/** Sprint 8F: deployment provenance, Railway watch paths, CI secret hygiene. SYNTHETIC. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { deploymentRevision } from "../src/ops/revision.js";
import { resetLifecycle } from "../src/ops/lifecycle.js";
import { resetSpend } from "../src/ops/spend.js";
import { resetAdmission } from "../src/api/admission.js";
import { resetMetrics } from "../src/ops/metrics.js";
import { BaselinePolicyModel } from "../src/agent/model/baseline.js";
import { RunStore } from "../src/agent/run-store.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { ScriptedQueryInterpreter } from "../src/agent/query/interpreter.js";
import { proposal } from "../scripts/synthetic/query-proposals.js";
import { scripted } from "./fixtures/synthetic/agent.js";
import {
  backendShouldRedeploy,
  pathMatchesWatchPattern,
  readRailwayWatchPatterns,
} from "../scripts/railway-watch-paths.js";

const SECRET = "ce-public-internal-auth-secret-32ch";
const OPERATOR = "ce-operator-token-value-32chars-xx";
const REVISION_KEYS = ["RAILWAY_GIT_COMMIT_SHA", "RAILWAY_GIT_BRANCH", "RAILWAY_GIT_REPO_OWNER", "RAILWAY_GIT_REPO_NAME", "CE_GIT_SHA", "CE_GIT_BRANCH", "CE_OPERATOR_TOKEN", "CE_INTERNAL_API_SECRET", "CE_PUBLIC_DEPLOYMENT"] as const;
const previous: Record<string, string | undefined> = {};

function snapshotEnv(): void {
  for (const key of REVISION_KEYS) previous[key] = process.env[key];
}

function restoreEnv(): void {
  for (const key of REVISION_KEYS) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  resetAdmission();
  resetSpend();
  resetMetrics();
  resetLifecycle();
}

function server() {
  const runtime = new AgentRuntime({ model: new BaselinePolicyModel(), provider: scripted(), store: new RunStore() });
  return buildApp({
    logLevel: "silent",
    agentRuntimeFactory: () => runtime,
    queryInterpreterFactory: () =>
      new ScriptedQueryInterpreter(() => proposal({ primaryIntent: "explore_frontier", brandsNamed: ["Northwind Atelier"] })),
  });
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ciWorkflow = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");

snapshotEnv();
afterEach(restoreEnv);

describe("deployment revision", () => {
  it("reports unknown when no Git identity is present", () => {
    for (const key of ["RAILWAY_GIT_COMMIT_SHA", "CE_GIT_SHA", "RAILWAY_GIT_BRANCH", "CE_GIT_BRANCH", "RAILWAY_GIT_REPO_OWNER", "RAILWAY_GIT_REPO_NAME"] as const) {
      delete process.env[key];
    }
    expect(deploymentRevision()).toEqual({
      repository: null,
      gitSha: null,
      gitBranch: null,
      source: "unknown",
    });
  });

  it("prefers Railway Git identity over an explicit SHA", () => {
    process.env.RAILWAY_GIT_COMMIT_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    process.env.RAILWAY_GIT_BRANCH = "main";
    process.env.RAILWAY_GIT_REPO_OWNER = "RaulMermans";
    process.env.RAILWAY_GIT_REPO_NAME = "cultural-elasticity";
    process.env.CE_GIT_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    expect(deploymentRevision()).toEqual({
      repository: "RaulMermans/cultural-elasticity",
      gitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      gitBranch: "main",
      source: "railway_git",
    });
  });

  it("uses CE_GIT_SHA when Railway Git is absent", () => {
    delete process.env.RAILWAY_GIT_COMMIT_SHA;
    process.env.CE_GIT_SHA = "cccccccccccccccccccccccccccccccccccccccc";
    process.env.CE_GIT_BRANCH = "sprint/8f-github-connected-deployments";
    expect(deploymentRevision()).toMatchObject({
      gitSha: "cccccccccccccccccccccccccccccccccccccccc",
      gitBranch: "sprint/8f-github-connected-deployments",
      source: "explicit",
    });
  });

  it("exposes revision on operator status and never prints secrets", async () => {
    process.env.CE_PUBLIC_DEPLOYMENT = "1";
    process.env.CE_INTERNAL_API_SECRET = SECRET;
    process.env.CE_OPERATOR_TOKEN = OPERATOR;
    process.env.RAILWAY_GIT_COMMIT_SHA = "dddddddddddddddddddddddddddddddddddddddd";
    process.env.RAILWAY_GIT_BRANCH = "main";
    process.env.RAILWAY_GIT_REPO_OWNER = "RaulMermans";
    process.env.RAILWAY_GIT_REPO_NAME = "cultural-elasticity";
    const app = server();
    expect((await app.inject({ method: "GET", url: "/ops/status" })).statusCode).toBe(404);
    const ok = await app.inject({ method: "GET", url: "/ops/status", headers: { "x-ce-operator": OPERATOR } });
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as { revision: ReturnType<typeof deploymentRevision> };
    expect(body.revision).toEqual({
      repository: "RaulMermans/cultural-elasticity",
      gitSha: "dddddddddddddddddddddddddddddddddddddddd",
      gitBranch: "main",
      source: "railway_git",
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain(OPERATOR);
    await app.close();
  });
});

describe("Railway backend watch paths", () => {
  const patterns = readRailwayWatchPatterns();

  it("keeps the Dockerfile context and lockfile in the watch set", () => {
    expect(patterns).toEqual([
      "/backend/**",
      "/packages/shared/**",
      "/package.json",
      "/pnpm-lock.yaml",
      "/pnpm-workspace.yaml",
      "/tsconfig.base.json",
      "/railway.json",
    ]);
  });

  it("does not rebuild the backend for a frontend-only change", () => {
    expect(backendShouldRedeploy(["frontend/src/app/page.tsx"], patterns)).toBe(false);
    expect(backendShouldRedeploy(["frontend/package.json", "docs/architecture.md"], patterns)).toBe(false);
  });

  it("rebuilds the backend when backend, shared, lockfile, or railway.json change", () => {
    expect(backendShouldRedeploy(["backend/src/index.ts"], patterns)).toBe(true);
    expect(backendShouldRedeploy(["backend/Dockerfile"], patterns)).toBe(true);
    expect(backendShouldRedeploy(["packages/shared/src/index.ts"], patterns)).toBe(true);
    expect(backendShouldRedeploy(["pnpm-lock.yaml"], patterns)).toBe(true);
    expect(backendShouldRedeploy(["package.json"], patterns)).toBe(true);
    expect(backendShouldRedeploy(["pnpm-workspace.yaml"], patterns)).toBe(true);
    expect(backendShouldRedeploy(["tsconfig.base.json"], patterns)).toBe(true);
    expect(backendShouldRedeploy(["railway.json"], patterns)).toBe(true);
  });

  it("does not treat a nested frontend package.json as the workspace root", () => {
    expect(pathMatchesWatchPattern("frontend/package.json", "/package.json")).toBe(false);
    expect(pathMatchesWatchPattern("package.json", "/package.json")).toBe(true);
  });
});

describe("CI paid-provider hygiene", () => {
  it("never interpolates provider or deploy secrets into pull-request CI", () => {
    expect(ciWorkflow).not.toMatch(/pull_request_target/u);
    expect(ciWorkflow).not.toMatch(/\$\{\{\s*secrets\.(ANTHROPIC_API_KEY|QLOO_API_KEY|RAILWAY_TOKEN|VERCEL_TOKEN|CE_INTERNAL_API_SECRET|CE_OPERATOR_TOKEN)\s*\}\}/u);
    expect(ciWorkflow).toMatch(/permissions:\s*\n\s+contents:\s+read/u);
    expect(ciWorkflow).toMatch(/pnpm eval:query/u);
    expect(ciWorkflow).not.toMatch(/eval:agent:live/u);
    expect(ciWorkflow).not.toMatch(/feasibility:qloo/u);
  });
});
