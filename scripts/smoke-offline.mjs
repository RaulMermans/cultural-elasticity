#!/usr/bin/env node
/**
 * Offline release smoke. No Qloo call. No Haiku call.
 *   node scripts/smoke-offline.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifact = JSON.parse(readFileSync(resolve(root, "frontend/src/demo/recorded-example.json"), "utf8"));
const meta = JSON.parse(readFileSync(resolve(root, "frontend/src/demo/recorded-example.meta.json"), "utf8"));
const secret = /sk-ant-|QLOO_API_KEY|ANTHROPIC_API_KEY|authorization|bearer\s+/iu;
const failures = [];

function check(ok, message) {
  if (!ok) failures.push(message);
}

check(artifact.kind === "RECORDED_EXAMPLE", "artifact kind");
check(meta.kind === "RECORDED_EXAMPLE", "meta kind");
check(artifact.sourceSha256 === meta.sourceSha256, "source hash");
check(Array.isArray(artifact.responses) && artifact.responses.length === 2, "parent and child responses");
check(artifact.responses[0]?.state === "INVESTIGATION_INCOMPLETE", "parent remains incomplete");
check(!secret.test(JSON.stringify(artifact)), "no secret pattern");
check(readFileSync(resolve(root, "backend/Dockerfile"), "utf8").includes("node:22"), "Dockerfile uses Node 22");
check(!readFileSync(resolve(root, "backend/Dockerfile"), "utf8").includes("QLOO_API_KEY="), "Dockerfile bakes no key");

if (failures.length) {
  console.error(`OFFLINE_SMOKE_FAIL\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("OFFLINE_SMOKE_PASS");
console.log(`recorded ${artifact.recordedAt} sha256 ${artifact.sourceSha256}`);
