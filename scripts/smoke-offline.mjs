#!/usr/bin/env node
/**
 * Offline release smoke. No Qloo call. No Haiku call.
 *   node scripts/smoke-offline.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function check(ok, message) {
  if (!ok) failures.push(message);
}

check(readFileSync(resolve(root, "backend/Dockerfile"), "utf8").includes("node:22"), "Dockerfile uses Node 22");
check(!readFileSync(resolve(root, "backend/Dockerfile"), "utf8").includes("QLOO_API_KEY="), "Dockerfile bakes no key");

if (failures.length) {
  console.error(`OFFLINE_SMOKE_FAIL\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("OFFLINE_SMOKE_PASS");
