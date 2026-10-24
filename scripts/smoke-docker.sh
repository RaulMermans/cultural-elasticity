#!/usr/bin/env bash
# Container startup smoke. Does not call Qloo or Haiku.
# Usage: bash scripts/smoke-docker.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${CE_SMOKE_IMAGE:-cultural-elasticity-api:smoke}"
NAME="${CE_SMOKE_NAME:-ce-backend-smoke}"
PORT="${CE_SMOKE_PORT:-4010}"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker build -f "$ROOT/backend/Dockerfile" -t "$IMAGE" "$ROOT"
cleanup
docker run -d --name "$NAME" -p "$PORT:4000" \
  -e NODE_ENV=production \
  -e CE_PUBLIC_DEPLOYMENT=1 \
  -e HOST=0.0.0.0 \
  -e PORT=4000 \
  -e CE_INTERNAL_API_SECRET=ce-smoke-internal-auth-secret-32ch \
  -e CE_OPERATOR_TOKEN=ce-smoke-operator-token-32chars-xx \
  -e CE_SPEND_BUDGET_USD=5 \
  -e CE_INVESTIGATION_RESERVE_USD=1 \
  -e CE_ACCEPT_INVESTIGATIONS=0 \
  -e QLOO_API_BASE_URL=https://hackathon.api.qloo.com \
  -e QLOO_CALL_SPACING_MS=7000 \
  -e QLOO_API_KEY=smoke-not-a-real-key \
  -e ANTHROPIC_API_KEY=smoke-not-a-real-key \
  "$IMAGE" >/dev/null

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null; then
    break
  fi
  sleep 1
done

health="$(curl -fsS "http://127.0.0.1:${PORT}/health")"
echo "$health" | grep -q 'cultural-elasticity-api'
ready_code="$(curl -s -o /tmp/ce-ready.json -w '%{http_code}' "http://127.0.0.1:${PORT}/ready")"
test "$ready_code" = "503"
grep -q ADMISSIONS_PAUSED /tmp/ce-ready.json
unauth="$(curl -s -o /tmp/ce-job.json -w '%{http_code}' -X POST "http://127.0.0.1:${PORT}/api/agent/jobs" -H 'content-type: application/json' -d '{"query":"Where next?"}')"
test "$unauth" = "401"

# Prove the pinned harness binary launches inside the image. --help does not call Qloo.
docker exec "$NAME" node --input-type=module -e '
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const entry = fileURLToPath(import.meta.resolve("@qloo/qloo-harness"));
const bin = join(dirname(entry), "bin.js");
if (!existsSync(bin)) process.exit(2);
function launch(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { out += chunk; });
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(args.join(" ") + " timed out")); }, 8000);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!/usage|mcp|exec|qloo/i.test(out)) reject(new Error("unexpected harness output"));
      else resolve(code);
    });
  });
}
await launch(["--help"]);
await launch(["exec", "--help"]);
process.stdout.write("HARNESS_STARTS\n");
'

# Sprint 8E: the MCP subprocess the agent uses (`qloo mcp`) must complete initialize + tools/list.
# Runs with networking disabled, so it provably makes no Qloo call.
docker run --rm -i -w /app --network none \
  -e QLOO_API_KEY=smoke-not-a-real-key \
  -e QLOO_API_BASE_URL=https://hackathon.api.qloo.com \
  "$IMAGE" node --input-type=module - <<'MCP'
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const bin = join(dirname(fileURLToPath(import.meta.resolve("@qloo/qloo-harness"))), "bin.js");
const child = spawn(process.execPath, [bin, "mcp"], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });
let buf = ""; const started = Date.now();
const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
const timer = setTimeout(() => { console.error("MCP handshake timed out"); child.kill("SIGTERM"); process.exit(3); }, 15000);
child.stdout.setEncoding("utf8").on("data", (c) => {
  buf += c; let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id === 1) { send({ jsonrpc: "2.0", method: "notifications/initialized" }); send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }); }
    if (msg.id === 2) {
      const tools = msg.result?.tools ?? [];
      clearTimeout(timer); child.kill("SIGTERM");
      if (tools.length === 0) { console.error("MCP tools/list returned no tools"); process.exit(4); }
      process.stdout.write(`MCP_HANDSHAKE_OK tools=${tools.length} startup_ms=${Date.now() - started}\n`); process.exit(0);
    }
  }
});
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ce-smoke", version: "0" } } });
MCP

echo "DOCKER_SMOKE_PASS"
