#!/usr/bin/env node
// Release preflight (Sprint 9L): repository and static contracts for a release candidate, with no cloud access and
// no paid provider call. On success it records `.release/preflight-<sha>.json`, which verify-production.mjs accepts
// as the local equivalent while GitHub Actions cannot start (CI_NOT_RUN).
//
// Usage: node scripts/release/preflight.mjs [--sha <sha>] [--quick] [--allow-branch]
//   --quick         static contracts, unit tests and secrets only (skips build, evals and browser tests)
//   --allow-branch  check a branch head instead of requiring HEAD == origin/main (pre-merge review)
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const quick = process.argv.includes("--quick");
const allowBranch = process.argv.includes("--allow-branch");
const problems = [];

git("fetch", "--quiet", "origin", "main");
const remote = git("remote", "get-url", "origin");
if (!/RaulMermans\/cultural-elasticity(\.git)?$/u.test(remote)) problems.push("WRONG_REPOSITORY");
const head = git("rev-parse", "HEAD");
const main = git("rev-parse", "origin/main");
const shaIx = process.argv.indexOf("--sha");
const sha = shaIx >= 0 ? process.argv[shaIx + 1] : head;
if (sha !== head) problems.push("CHECKOUT_IS_NOT_RELEASE_SHA");
if (!allowBranch && head !== main) problems.push("HEAD_IS_NOT_ORIGIN_MAIN");
const dirty = git("status", "--porcelain", "--untracked-files=no");
if (dirty) problems.push("TRACKED_CHANGES_PRESENT");

// What the release touches, against the last commit on main it would replace.
const base = head === main ? git("rev-parse", "origin/main~1") : git("merge-base", "HEAD", "origin/main");
const files = git("diff", "--name-only", `${base}..${head}`).split("\n").filter(Boolean);
const areas = {
  frontend: files.some((f) => f.startsWith("frontend/")),
  backend: files.some((f) => f.startsWith("backend/")),
  shared: files.some((f) => f.startsWith("packages/shared/")),
  migrations: files.filter((f) => f.startsWith("backend/migrations/")),
  deployConfig: files.filter((f) => ["railway.json", "frontend/vercel.json", "backend/Dockerfile"].includes(f)),
};
console.log(`release ${sha.slice(0, 7)} vs ${base.slice(0, 7)}: ${files.length} files; frontend=${areas.frontend} backend=${areas.backend} shared=${areas.shared}`);
if (areas.migrations.length) console.log(`[APPROVAL] migrations changed (${areas.migrations.join(", ")}): needs a backup, rollback plan and separate approval`);
if (areas.frontend && !areas.backend && !areas.shared) console.log("[NOTE] frontend-only: Railway may legitimately SKIP this commit (watch paths)");

const steps = quick
  ? [["pnpm", "check:deployment-config"], ["pnpm", "check:secrets"], ["pnpm", "lint"], ["pnpm", "typecheck"], ["pnpm", "test"]]
  : [["pnpm", "check:deployment-config"], ["pnpm", "check:secrets"], ["pnpm", "lint"], ["pnpm", "typecheck"], ["pnpm", "test"], ["pnpm", "build"],
     ["pnpm", "eval:methodology"], ["pnpm", "eval:agent"], ["pnpm", "eval:query"], ["pnpm", "test:e2e"]];
const ran = [];
if (problems.length === 0) {
  for (const [cmd, ...args] of steps) {
    const label = [cmd, ...args].join(" ");
    process.stdout.write(`running ${label} ... `);
    const result = spawnSync(cmd, args, { cwd: root, stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
    const ok = result.status === 0;
    console.log(ok ? "ok" : "FAILED");
    ran.push({ step: label, ok });
    if (!ok) {
      console.error((result.stderr ?? "").split("\n").slice(-15).join("\n"));
      problems.push("STEP_FAILED:" + label);
      break;
    }
  }
}

for (const problem of problems) console.error(`[FAIL] ${problem}`);
const ok = problems.length === 0;
if (ok && !quick && !allowBranch) {
  mkdirSync(join(root, ".release"), { recursive: true });
  writeFileSync(join(root, ".release", `preflight-${sha}.json`), JSON.stringify({ sha, ok, at: new Date().toISOString(), steps: ran, areas, semantics: "local_offline_equivalent_of_ci; not live provider validation" }, null, 2) + "\n");
}
console.log(ok ? `PREFLIGHT_PASS${quick || allowBranch ? " (not recorded: quick or branch mode)" : ""}` : "PREFLIGHT_FAILED");
process.exitCode = ok ? 0 : 1;
